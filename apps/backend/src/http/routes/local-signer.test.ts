import { afterEach, it, expect, vi } from 'vitest';
import { buildApp } from '../app.js';
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(() => Promise.all(apps.splice(0).map((a) => a.close())));
it('isolates local signer bearer auth from Telegram and never exposes payloads anonymously', async () => {
  const claim = vi.fn().mockResolvedValue(null),
    submit = vi.fn();
  const token = 'test-only-' + 'x'.repeat(40);
  const app = await buildApp(
    {
      LOG_LEVEL: 'silent',
      MINI_APP_ORIGIN: 'https://example.test',
      TELEGRAM_WEBHOOK_SECRET: undefined,
    },
    {
      verifyTelegramSession: () =>
        Promise.resolve({ ok: false, code: 'USER_NOT_ALLOWED' }),
      checkReadiness: () => Promise.resolve({ postgres: 'ok', redis: 'ok' }),
      localSigner: { claim, submit },
      localSignerToken: token,
    },
  );
  apps.push(app);
  const request = {
    method: 'POST' as const,
    url: '/api/v1/local-signer/claim',
    payload: { signerId: 'local-1' },
  };
  expect((await app.inject(request)).statusCode).toBe(401);
  expect(
    (await app.inject({ ...request, headers: { authorization: 'tma signed' } }))
      .statusCode,
  ).toBe(401);
  expect(claim).not.toHaveBeenCalled();
  const r = await app.inject({
    ...request,
    headers: { authorization: 'Bearer ' + token },
  });
  expect(r.statusCode).toBe(200);
  expect(r.headers['cache-control']).toBe('no-store');
  expect(r.json()).toEqual({ task: null });
  expect(claim).toHaveBeenCalledWith({
    signerId: 'local-1',
    acceptSimulation: false,
  });
});
