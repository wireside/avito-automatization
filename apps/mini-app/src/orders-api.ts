import {
  orderResponseSchema,
  ordersPageResponseSchema,
  type ApiErrorResponse,
} from '@avito/contracts';
export { type MarketplaceOrderDto } from '@avito/contracts';
export const orderStatuses = [
  { value: '', title: 'Все' },
  { value: 'on_confirmation', title: 'Подтвердить' },
  { value: 'ready_to_ship', title: 'К отправке' },
  { value: 'in_transit', title: 'В пути' },
  { value: 'on_return', title: 'Возвраты' },
  { value: 'delivered', title: 'Доставлены' },
  { value: 'canceled', title: 'Отменены' },
  { value: 'in_dispute', title: 'Споры' },
  { value: 'closed', title: 'Закрыты' },
];
export function orderStatusLabel(status: string) {
  return (
    (
      {
        on_confirmation: 'Ждёт подтверждения',
        ready_to_ship: 'Ожидает отправки',
        in_transit: 'В пути',
        on_return: 'На возврате',
        delivered: 'Доставлен',
        canceled: 'Отменён',
        in_dispute: 'Открыт спор',
        closed: 'Закрыт',
      } as Record<string, string>
    )[status] ?? `Статус Авито: ${status}`
  );
}
export class OrdersApiError extends Error {
  constructor(
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}
export function createOrdersApi(initData: string) {
  async function get(path: string, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/orders${path}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: { authorization: `tma ${initData}` },
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
        },
      );
    } catch {
      throw new OrdersApiError(
        'Нет ответа сервера. Проверьте соединение и обновите заказы.',
      );
    }
    if (!response.ok) {
      const body = (await response
        .json()
        .catch(() => ({}))) as Partial<ApiErrorResponse>;
      const messages: Record<string, string> = {
        AVITO_NOT_CONFIGURED: 'Доступ к заказам Авито не настроен.',
        AVITO_ACCESS_DENIED:
          'Авито не предоставил доступ к заказам. Обратитесь к администратору.',
        AVITO_UNAVAILABLE:
          'Не удалось получить свежие данные Авито. Повторите позже.',
        AVITO_RATE_LIMITED: 'Слишком частые обновления. Подождите и повторите.',
        ORDER_NOT_FOUND: 'Заказ больше не доступен в Авито.',
        FORBIDDEN: 'Нет прав на просмотр заказов.',
      };
      throw new OrdersApiError(
        response.status === 401
          ? 'Сессия истекла. Откройте приложение снова из Telegram.'
          : (messages[body.code ?? ''] ?? 'Не удалось загрузить заказы.'),
        body.requestId,
      );
    }
    return response.json() as Promise<unknown>;
  }
  return {
    async list(query: { page: number; status: string }, signal?: AbortSignal) {
      const params = new URLSearchParams({
        page: String(query.page),
        limit: '20',
      });
      if (query.status) params.set('status', query.status);
      const parsed = ordersPageResponseSchema.safeParse(
        await get(`?${params}`, signal),
      );
      if (!parsed.success)
        throw new OrdersApiError(
          'Сервер вернул некорректный список заказов. Повторите позже.',
        );
      return parsed.data;
    },
    async detail(id: string, signal?: AbortSignal) {
      const parsed = orderResponseSchema.safeParse(
        await get(`/${encodeURIComponent(id)}`, signal),
      );
      if (!parsed.success)
        throw new OrdersApiError(
          'Сервер вернул некорректную карточку заказа. Повторите позже.',
        );
      return parsed.data;
    },
  };
}
