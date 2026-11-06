import { describe, it, expect, afterAll } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createSignerEnrollment } from '@avito/domain';
import { createDatabaseClient } from './client.js';
import { createSignerEnrollmentStore } from './signer-enrollment.js';
import { grantOwnerAccess, findActiveUserWithRoles } from './users.js';
const url =
  process.env.RUN_MARKING_TESTS === 'true'
    ? process.env.DATABASE_URL
    : undefined;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
(url ? describe : describe.skip)(
  'Telegram signer enrollment with PostgreSQL',
  () => {
    const db = createDatabaseClient(url ?? 'postgresql://unused'),
      store = createSignerEnrollmentStore(db.db);
    const expiry = new Date(Date.now() + 86400000).toISOString(),
      cert = {
        sellerInn: '123456789012',
        certificateThumbprint: 'A'.repeat(40),
        certificateExpiresAt: expiry,
      };
    const flow = createSignerEnrollment({
      store,
      publicUrl: 'https://api.example.com',
      inspectCertificate: () => cert,
    });
    const owners: string[] = [];
    async function owner() {
      const telegramId = 'enroll_' + randomUUID();
      await grantOwnerAccess(db.db, telegramId, randomUUID());
      const u = (await findActiveUserWithRoles(db.db, telegramId))!;
      owners.push(u.id);
      return u;
    }
    async function registration(u: Awaited<ReturnType<typeof owner>>) {
      const link = await flow.issue(u),
        token = randomBytes(32).toString('hex');
      return {
        token,
        input: {
          ticket: new URL(link.url).hash.slice(1),
          signerId: 'WIN_' + randomUUID().replaceAll('-', ''),
          deviceTokenHash: hash(token),
          pairingCode: '123456',
          certificateBase64: 'fixture-public-certificate',
        },
      };
    }
    afterAll(async () => {
      for (const id of owners) {
        await db.db.execute(
          sql`UPDATE signer_installations SET status='REVOKED' WHERE owner_id=${id} AND status IN ('ACTIVE','PENDING')`,
        );
      }
      await db.db.execute(
        sql`UPDATE integration_operations SET status='CANCELLED' WHERE operation_type='signer.notify' AND status='PENDING'`,
      );
      await db.pool.end();
    });
    it('requires owner authority and does not allow an unapproved agent to claim work', async () => {
      const u = await owner();
      await expect(flow.issue({ ...u, roles: ['ADMIN'] })).rejects.toThrow(
        'FORBIDDEN',
      );
      const f = await registration(u),
        device = await flow.register(f.input);
      expect(await flow.authorize(f.token)).toBeNull();
      expect(await flow.status(f.token)).toEqual({ status: 'PENDING' });
      expect(await flow.register(f.input)).toEqual(device);
      await expect(
        flow.register({ ...f.input, deviceTokenHash: hash('another-device') }),
      ).rejects.toThrow('INSTALL_LINK_USED');
      const other = await owner();
      await expect(flow.decide(other, device.id, true)).rejects.toThrow(
        'ENTITY_NOT_FOUND',
      );
      await flow.decide(u, device.id, true);
      expect(await flow.authorize(f.token)).toMatchObject({
        signerId: f.input.signerId,
        sellerInn: cert.sellerInn,
        certificateThumbprint: cert.certificateThumbprint,
      });
      await flow.decide(u, device.id, true);
      expect(await store.hasActive()).toBe(true);
      const op = (
        await db.db.execute<{ id: string }>(
          sql`SELECT id FROM integration_operations WHERE aggregate_id=${device.id} AND operation_type='signer.notify'`,
        )
      ).rows[0];
      expect(op).toBeDefined();
      const stored = (
        await db.db.execute<{ token_hash: string }>(
          sql`SELECT token_hash FROM signer_enrollments WHERE token_hash=${hash(f.input.ticket)}`,
        )
      ).rows[0]!;
      expect(stored.token_hash).not.toBe(f.input.ticket);
    });
    it('replaces the former credential atomically and keeps the public pin immutable', async () => {
      const u = await owner(),
        f = await registration(u),
        d = await flow.register(f.input);
      await flow.decide(u, d.id, true);
      expect(await flow.authorize(f.token)).not.toBeNull();
      const other = await owner(),
        next = await registration(other),
        nd = await flow.register(next.input);
      await flow.decide(other, nd.id, true);
      expect(await flow.authorize(f.token)).toBeNull();
      expect(await flow.authorize(next.token)).not.toBeNull();
      await expect(
        db.db.execute(
          sql`UPDATE signer_installations SET seller_inn='999999999999' WHERE id=${nd.id}`,
        ),
      ).rejects.toThrow();
    });
    it('retains approval requests durably, supports rejection, and rejects expired links', async () => {
      const u = await owner(),
        f = await registration(u),
        d = await flow.register(f.input);
      const job = (
        await db.db.execute<{ id: string }>(
          sql`SELECT id FROM integration_operations WHERE aggregate_id=${d.id}`,
        )
      ).rows[0]!;
      expect(await store.notification(job.id)).toMatchObject({
        pairingCode: '123456',
        telegramId: u.telegramId,
      });
      await store.notified(d.id, 123);
      expect(await store.notification(job.id)).toBeNull();
      await flow.decide(u, d.id, false);
      expect(await flow.authorize(f.token)).toBeNull();
      expect(await flow.status(f.token)).toEqual({ status: 'REJECTED' });
      const expired = randomBytes(32).toString('base64url');
      await db.db.execute(
        sql`INSERT INTO signer_enrollments(owner_id,token_hash,expires_at,created_at) VALUES(${u.id},${hash(expired)},now()-interval '1 second',now()-interval '31 minutes')`,
      );
      await expect(flow.download(expired)).rejects.toThrow(
        'INSTALL_LINK_EXPIRED',
      );
    });
  },
);
