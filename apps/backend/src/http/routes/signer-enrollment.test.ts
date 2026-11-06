import { it, expect, vi } from 'vitest';
import {
  createSignerEnrollment,
  type SignerEnrollmentStore,
} from '@avito/domain';
import { buildApp } from '../app.js';
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  telegramId: '42',
  displayName: null,
  roles: ['OWNER'],
};
it('protects installer issue, never puts a ticket in server-rendered HTML, and binds agent identity', async () => {
  const store = {
    createTicket: vi.fn().mockResolvedValue({
      ticket: 'a'.repeat(43),
      expiresAt: '2027-01-01T00:00:00.000Z',
    }),
    validTicket: vi.fn().mockResolvedValue(true),
    register: vi.fn(),
    decide: vi.fn(),
    list: vi.fn(),
    binding: vi.fn(),
    status: vi.fn().mockResolvedValue({ status: 'PENDING' }),
    hasActive: vi.fn(),
    notification: vi.fn(),
    notified: vi.fn(),
  } satisfies SignerEnrollmentStore;
  const enrollment = createSignerEnrollment({
    store,
    publicUrl: 'https://api.example.com',
    inspectCertificate: vi.fn(),
  });
  const service = {
    claim: vi.fn().mockResolvedValue(null),
    submit: vi.fn(),
    heartbeat: vi.fn(),
  };
  const app = await buildApp(
    {
      LOG_LEVEL: 'silent',
      MINI_APP_ORIGIN: 'https://app.example.com',
      TELEGRAM_WEBHOOK_SECRET: undefined,
    },
    {
      verifyTelegramSession: () => Promise.resolve({ ok: true, user }),
      checkReadiness: () => Promise.resolve({ postgres: 'ok', redis: 'ok' }),
      signerEnrollment: enrollment,
      signerInstaller: () => Promise.resolve(new Uint8Array([80, 75])),
      authenticateSigner: (t) =>
        Promise.resolve(
          t === 'device-token'
            ? {
                binding: {
                  signerId: 'WIN',
                  sellerInn: '123456789012',
                  certificateThumbprint: 'A'.repeat(40),
                },
                service,
              }
            : null,
        ),
    },
  );
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/local-signer/install-link',
        })
      ).statusCode,
    ).toBe(401);
    const issued = await app.inject({
      method: 'POST',
      url: '/api/v1/local-signer/install-link',
      headers: { authorization: 'tma session' },
    });
    expect(issued.json<{ url: string }>().url).toBe(
      'https://api.example.com/signer/install#' + 'a'.repeat(43),
    );
    user.roles = ['VIEWER'];
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/local-signer/install-link',
          headers: { authorization: 'tma session' },
        })
      ).statusCode,
    ).toBe(403);
    user.roles = ['OWNER'];
    const page = await app.inject({ method: 'GET', url: '/signer/install' });
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect(page.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    expect(page.body).not.toContain('a'.repeat(43));
    const zip = await app.inject({
      method: 'POST',
      url: '/api/v1/local-signer/install',
      payload: { ticket: 'a'.repeat(43) },
    });
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toContain('application/zip');
    expect(zip.headers['cache-control']).toBe('no-store');
    const route = '/api/v1/local-signer/claim';
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route,
          headers: { authorization: 'Bearer device-token' },
          payload: { signerId: 'OTHER' },
        })
      ).statusCode,
    ).toBe(403);
    expect(service.claim).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route,
          headers: { authorization: 'Bearer device-token' },
          payload: { signerId: 'WIN' },
        })
      ).json(),
    ).toEqual({ task: null });
  } finally {
    await app.close();
  }
});
