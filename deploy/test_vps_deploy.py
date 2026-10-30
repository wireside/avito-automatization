"""Exercise deployment failure boundaries with fake Docker/curl, never a live VPS."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

FAKE = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
state_path = Path(os.environ['FAKE_STATE'])
s = json.loads(state_path.read_text())
a = sys.argv[1:]
name = Path(sys.argv[0]).name
s['calls'].append([name] + a)
def done(text='', code=0):
    state_path.write_text(json.dumps(s))
    if text: print(text)
    sys.exit(code)
if name == 'sleep': done()
if name == 'curl':
    done(code=int(s['scenario'] == 'api_failure' and s['api'] == 'new'))
if a[0] == 'load':
    sys.stdin.buffer.read()
    done('Loaded test image')
if a[:2] == ['image', 'inspect']:
    target = a[-1]
    if target == 'avito-backend:previous': done(code=1)
    if 'revision' in a[3]: done('a' * 40)
    done('new')
if a[0] == 'inspect':
    fmt, target = a[2], a[3]
    if 'State.Running' in fmt:
        done('true:1' if s['scenario'] == 'worker_failure' and s['worker'] == 'new' else 'true:0')
    done(s['api'] if target == 'api-id' else s['worker'])
if a[0] == 'tag':
    if a[-1] == 'avito-backend:dev': s['alias'] = 'new' if a[1].startswith('avito-backend:ci-') else a[1]
    if a[-1] == 'avito-backend:previous': s['previous'] = a[1]
    done()
if a[:2] == ['image', 'rm']: done()
if a[0] == 'compose':
    b = a[1:]
    if b == ['config', '--quiet']: done()
    profile = None
    if b[:1] == ['--profile']:
        profile, b = b[1], b[2:]
    if b == ['config', '--format', 'json']:
        services = ['api', 'worker']
        if profile == 'tools' and s['scenario'] != 'missing_migrate':
            services.append('migrate')
        done(json.dumps({'services': {n: {'image': 'avito-backend:dev'} for n in services}}))
    if b[:2] == ['ps', '-q']: done(b[-1] + '-id')
    if b[0] == 'exec':
        if 'pg_dump' in b: done('test database dump')
        if 'redis-cli' in b: done('PONG')
        done()
    if b[0] == 'stop': s['worker'] = 'stopped'; done()
    if b[0] == 'run': done(code=int(s['scenario'] == 'migration_failure'))
    if b[0] == 'up':
        for service in ('api','worker'):
            if service in b: s[service] = s['alias']
        done()
done('Unexpected mock command: ' + repr(a), 99)
'''


class DeploymentTests(unittest.TestCase):
    def deploy(self, scenario='success', corrupt=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            app = root / 'app'
            app.mkdir()
            (app / '.env').write_text('SECRET=never-print-this\n')
            (app / 'compose.yaml').touch()
            incoming = app / '.incoming' / '1-1'
            incoming.mkdir(parents=True)
            import gzip
            archive = gzip.compress(b'test image archive')
            (incoming / 'backend-image.tar.gz').write_bytes(archive)
            digest = '0' * 64 if corrupt else hashlib.sha256(archive).hexdigest()
            (incoming / 'backend-image.tar.gz.sha256').write_text(digest + '  backend-image.tar.gz\n')
            state = root / 'state.json'
            state.write_text(json.dumps({'scenario': scenario, 'api': 'old', 'worker': 'old', 'alias': 'old', 'calls': []}))
            bin_dir = root / 'bin'
            bin_dir.mkdir()
            for name in ('docker', 'curl', 'sleep'):
                p = bin_dir / name
                p.write_text(FAKE)
                p.chmod(0o755)
            # macOS lacks flock; use Python's POSIX flock for the test wrapper.
            flock = bin_dir / 'flock'
            flock.write_text('#!/usr/bin/env python3\nimport fcntl,sys\nfcntl.flock(int(sys.argv[-1]), fcntl.LOCK_EX | fcntl.LOCK_NB)\n')
            flock.chmod(0o755)
            result = subprocess.run(['bash', str(Path(__file__).with_name('vps-deploy.sh')), 'avito-backend:ci-1-1', str(incoming), 'a' * 40], env={**os.environ, 'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'], 'AVITO_DEPLOY_DIR': str(app), 'FAKE_STATE': str(state)}, capture_output=True, text=True)
            final = json.loads(state.read_text())
            self.assertNotIn('never-print-this', result.stdout + result.stderr)
            self.assertEqual((app / '.env').read_text(), 'SECRET=never-print-this\n')
            self.assertFalse((incoming / 'backend-image.tar.gz').exists())
            self.assertFalse(any('down' in c or 'prune' in c for c in final['calls']))
            return result, final, len(list((app / 'backups').glob('*.dump'))) if (app / 'backups').exists() else 0

    def test_success_keeps_previous_image_and_database_backup(self):
        result, state, backups = self.deploy()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((state['api'], state['worker'], state['previous']), ('new', 'new', 'old'))
        self.assertEqual(backups, 1)
        migration = next(i for i,c in enumerate(state['calls']) if c[:3] == ['docker','compose','run'])
        replacement = next(i for i,c in enumerate(state['calls']) if c[:3] == ['docker','compose','up'])
        self.assertLess(migration, replacement)

    def test_missing_migration_service_fails_before_application_changes(self):
        result, state, backups = self.deploy('missing_migrate')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Missing Compose service: migrate', result.stderr)
        self.assertNotIn('Traceback', result.stderr)
        self.assertEqual((state['api'], state['worker'], state['alias']), ('old', 'old', 'old'))
        self.assertEqual(backups, 0)
        self.assertFalse(any(c[:3] == ['docker', 'compose', 'stop'] for c in state['calls']))

    def test_failed_migration_leaves_old_api_and_restarts_old_worker(self):
        result, state, backups = self.deploy('migration_failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((state['api'], state['worker'], state['alias']), ('old','old','old'))
        self.assertEqual(backups, 1)

    def test_failed_readiness_restores_both_processes(self):
        result, state, _ = self.deploy('api_failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((state['api'], state['worker'], state['alias']), ('old','old','old'))

    def test_restarting_worker_rolls_back(self):
        result, state, _ = self.deploy('worker_failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((state['api'], state['worker']), ('old','old'))

    def test_corrupt_upload_never_stops_worker_or_runs_migrations(self):
        result, state, backups = self.deploy(corrupt=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((state['api'], state['worker']), ('old','old'))
        self.assertEqual(backups, 0)
        self.assertFalse(any(c[:3] == ['docker','compose','stop'] for c in state['calls']))


if __name__ == '__main__':
    unittest.main()
