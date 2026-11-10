import type { AvitoActionCommandDto } from '@avito/contracts';
export function createOrderActionsApi(initData: string) {
  async function request(orderId: string, path: string, body?: unknown) {
    let response: Response;
    try {
      response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/orders/${encodeURIComponent(orderId)}/${path}`,
        {
          method: body === undefined ? 'GET' : 'POST',
          cache: 'no-store',
          headers: {
            authorization: `tma ${initData}`,
            ...(body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(30000),
        },
      );
    } catch {
      throw new Error(
        'Нет ответа сервера. Повторите тот же запрос — повторного действия не будет.',
      );
    }
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      throw new Error(result.message ?? 'Не удалось выполнить действие Авито.');
    }
    return response;
  }
  return {
    async get(orderId: string, path: string) {
      return (await request(orderId, path)).json() as Promise<unknown>;
    },
    async post(orderId: string, command: AvitoActionCommandDto) {
      return (
        await request(orderId, 'actions', command)
      ).json() as Promise<unknown>;
    },
    async courier(orderId: string, address?: string) {
      return (
        await request(orderId, 'courier-options', address ? { address } : {})
      ).json() as Promise<unknown>;
    },
    async reconcile(orderId: string, id: string) {
      return (
        await request(
          orderId,
          `actions/${encodeURIComponent(id)}/reconcile`,
          {},
        )
      ).json() as Promise<unknown>;
    },
    async download(orderId: string, id: string) {
      const r = await request(
        orderId,
        `actions/${encodeURIComponent(id)}/label`,
      );
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `avito-${orderId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
  };
}
