import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createAvitoTransport } from './avito-transport.js';

it('uses the regular fetch with no proxy configured', async () => {
  const transport = createAvitoTransport();
  expect(transport.fetch).toBe(fetch);
  await transport.close();
});

it('routes token, read and write requests through CONNECT without direct fallback', async () => {
  const targets: (string | undefined)[] = [];
  const proxy = createServer();
  proxy.on('connect', (request, socket) => {
    targets.push(request.url);
    socket.end(
      'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
    );
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const address = proxy.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected a TCP proxy');
  const directFetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected direct fetch'));
  const transport = createAvitoTransport(`http://127.0.0.1:${address.port}`);
  try {
    for (const [path, method] of [
      ['/token', 'POST'],
      ['/order-management/1/orders', 'GET'],
      ['/order-management/1/markings', 'POST'],
    ] as const) {
      await expect(
        transport.fetch(`https://api.avito.ru${path}`, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(2000),
        }),
      ).rejects.toThrow();
    }
    expect(targets).toEqual(Array<string>(3).fill('api.avito.ru:443'));
    expect(directFetch).not.toHaveBeenCalled();
  } finally {
    directFetch.mockRestore();
    await transport.close();
    await new Promise<void>((resolve, reject) =>
      proxy.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
