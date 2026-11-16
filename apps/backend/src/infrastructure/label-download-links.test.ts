import { expect, it, vi } from 'vitest';
import { createLabelDownloadLinks } from './label-download-links.js';
const user = {
  id: 'user',
  telegramId: '42',
  displayName: null,
  roles: ['OWNER'],
};
const operationId = '00000000-0000-4000-8000-000000000111';
it('encrypts label-scoped claims, survives another instance and rejects tampering, expiry and revoked access', async () => {
  let now = Date.parse('2026-11-17T12:00:00Z');
  const findActiveUser = vi.fn().mockResolvedValue(user);
  const deps = {
    key: Buffer.alloc(32, 7).toString('base64'),
    keyId: 'test',
    publicUrl: 'https://api.example.com',
    findActiveUser,
    now: () => now,
  };
  const links = createLabelDownloadLinks(deps);
  const link = links.issue(user, '123', operationId);
  const url = new URL(link.url),
    ticket = url.hash.slice(1);
  expect(url.pathname).toBe('/avito/label');
  expect(url.search).toBe('');
  expect(Buffer.from(ticket, 'base64url').toString()).not.toContain(
    operationId,
  );
  expect(Date.parse(link.expiresAt) - now).toBe(600000);
  const other = createLabelDownloadLinks(deps);
  await expect(other.resolve(ticket)).resolves.toEqual({
    user,
    orderId: '123',
    operationId,
  });
  await expect(other.resolve('A' + ticket.slice(1))).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  await expect(
    createLabelDownloadLinks({
      ...deps,
      key: Buffer.alloc(32, 8).toString('base64'),
    }).resolve(ticket),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  findActiveUser.mockResolvedValueOnce(undefined);
  await expect(links.resolve(ticket)).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  findActiveUser.mockResolvedValueOnce({ ...user, id: 'replacement' });
  await expect(links.resolve(ticket)).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  now += 600000;
  findActiveUser.mockClear();
  await expect(links.resolve(ticket)).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  expect(findActiveUser).not.toHaveBeenCalled();
});
