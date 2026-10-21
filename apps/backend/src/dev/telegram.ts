import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readConfig } from '../config/index.js';
import { configureTelegramBot, createTelegramBot } from '../telegram/index.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
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

// Local API tunnel for a Mini App hosted on GitHub Pages.
// Runtime overrides are passed to children; local configuration is never written.
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
        `80:127.0.0.1:${initial.PORT}`,
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
    const miniAppUrl = initial.MINI_APP_URL!;
    const overrides = {
      TELEGRAM_MODE: 'polling',
      MINI_APP_URL: miniAppUrl,
      MINI_APP_ORIGIN: new URL(miniAppUrl).origin,
    };
    development = spawn(
      'pnpm',
      [
        'exec',
        'concurrently',
        '-n',
        'api,worker',
        '-c',
        'blue,magenta',
        'npm --prefix apps/backend run dev:api',
        'npm --prefix apps/backend run dev:worker',
      ],
      {
        cwd: root,
        env: { ...process.env, ...overrides },
        detached: true,
        stdio: 'inherit',
      },
    );
    const developmentEnded = new Promise<void>((resolve) => {
      development!.once('close', () => resolve());
      development!.once('error', () => resolve());
    });
    const bot = createTelegramBot(initial.TELEGRAM_BOT_TOKEN, miniAppUrl);
    stage = 'telegram-menu';
    await configureTelegramBot(bot, miniAppUrl, initial.TELEGRAM_SETUP_CHAT_ID);
    stage = 'public-api';
    let reachable = false;
    for (let attempt = 0; attempt < 20 && !stopping; attempt++) {
      try {
        const response = await fetch(`${url}/health/ready`, {
          signal: AbortSignal.timeout(5_000),
        });
        reachable = response.ok;
        if (reachable) break;
      } catch {
        /* The app or tunnel is still starting. */
      }
      await pause(1_000);
    }
    if (!reachable) throw new Error('Public API is not ready');
    console.log(
      `Mini App: ${miniAppUrl}\nAPI tunnel: ${url}\nPublish frontend for this tunnel (separate terminal):\nVITE_API_BASE_URL=${url} npm run deploy\n.env is unchanged. After a tunnel reconnect, rebuild/deploy for its new URL.`,
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
