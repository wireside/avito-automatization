import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { readConfig } from '../config/index.js';
import { configureTelegramBot, createTelegramBot } from '../telegram/index.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const envPath = new URL('../../../../.env', import.meta.url);
const initial = readConfig();
if (
  initial.NODE_ENV === 'production' ||
  initial.TELEGRAM_MODE !== 'polling' ||
  !initial.TELEGRAM_BOT_TOKEN
) {
  throw new Error(
    'dev:telegram requires local polling mode and a configured token',
  );
}

let stopping = false;
let tunnel: ChildProcess | undefined;
let development: ChildProcess | undefined;
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function stop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* Already stopped. */
  }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopping = true;
    stop(tunnel);
    stop(development);
  });
}

// Local development only. SSH reconnects may allocate a different hostname;
// refresh .env, API, Vite and Telegram menu together before declaring readiness.
while (!stopping) {
  let stage = 'tunnel';
  try {
    tunnel = spawn(
      'ssh',
      [
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'ServerAliveInterval=15',
        '-o',
        'ServerAliveCountMax=3',
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'ConnectTimeout=15',
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'IdentityFile=/dev/null',
        '-T',
        '-R',
        '80:127.0.0.1:5173',
        'nokey@localhost.run',
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const tunnelEnded = new Promise<void>((resolve) => {
      tunnel!.once('close', () => resolve());
      tunnel!.once('error', () => resolve());
    });
    let output = '';
    const urlFound = new Promise<string>((resolve) => {
      const scan = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16_384);
        const match = /https:\/\/([a-z0-9]+\.lhr\.life)\b/.exec(output);
        if (match?.[0]) resolve(match[0]);
      };
      tunnel!.stdout!.on('data', scan);
      tunnel!.stderr!.on('data', scan);
    });
    const url = await Promise.race([
      urlFound,
      tunnelEnded.then(() => {
        throw new Error('Tunnel ended');
      }),
      pause(25_000).then(() => {
        throw new Error('Tunnel startup timed out');
      }),
    ]);
    if (stopping) break;
    const overrides = {
      MINI_APP_URL: url,
      MINI_APP_ORIGIN: url,
      MINI_APP_TUNNEL_HOST: new URL(url).hostname,
      VITE_API_BASE_URL: '',
    };
    let envFile = await readFile(envPath, 'utf8');
    for (const [key, value] of Object.entries(overrides)) {
      const pattern = new RegExp(`^${key}=.*$`, 'm');
      envFile = pattern.test(envFile)
        ? envFile.replace(pattern, `${key}=${value}`)
        : `${envFile}\n${key}=${value}\n`;
    }
    await writeFile(envPath, envFile, { mode: 0o600 });
    development = spawn('pnpm', ['dev'], {
      cwd: root,
      env: { ...process.env, ...overrides },
      detached: true,
      stdio: 'inherit',
    });
    const developmentEnded = new Promise<void>((resolve) => {
      development!.once('close', () => resolve());
      development!.once('error', () => resolve());
    });
    const bot = createTelegramBot(initial.TELEGRAM_BOT_TOKEN, url);
    stage = 'telegram-menu';
    await configureTelegramBot(bot, url, initial.TELEGRAM_SETUP_CHAT_ID);
    stage = 'public-app';
    let reachable = false;
    for (let attempt = 0; attempt < 20 && !stopping; attempt++) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(5_000),
        });
        reachable =
          response.ok && (await response.text()).includes('Авито Операции');
        if (reachable) break;
      } catch {
        /* The app or tunnel is still starting. */
      }
      await pause(1_000);
    }
    if (!reachable) throw new Error('Public application is unreachable');
    console.log(
      `Mini App is reachable: ${url}. Reopen it from a NEW /app response.`,
    );
    await Promise.race([tunnelEnded, developmentEnded]);
  } catch {
    if (!stopping)
      console.error(
        `Development connection failed (${stage}); reconnecting in 3 seconds.`,
      );
  } finally {
    stop(tunnel);
    stop(development);
    await pause(1_000);
  }
  if (!stopping) await pause(3_000);
}
