import { fetch as proxyFetch, ProxyAgent } from 'undici';

export type AvitoResponse = Pick<
  Response,
  'ok' | 'status' | 'headers' | 'json' | 'body'
>;
export type AvitoFetch = (
  url: string,
  init: {
    method: 'GET' | 'POST';
    redirect: 'error';
    headers?: Record<string, string>;
    body?: string | URLSearchParams;
    signal: AbortSignal;
  },
) => Promise<AvitoResponse>;

export function createAvitoTransport(proxyUrl?: string) {
  const proxy = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const request: AvitoFetch = proxy
    ? (url, init) => proxyFetch(url, { ...init, dispatcher: proxy })
    : fetch;
  let closing: Promise<void> | undefined;

  return {
    fetch: request,
    close() {
      closing ??= proxy ? proxy.close() : Promise.resolve();
      return closing;
    },
  };
}
