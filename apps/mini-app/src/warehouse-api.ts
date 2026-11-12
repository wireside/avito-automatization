export class WarehouseApiError extends Error {
  constructor(readonly code: string) {
    super(warehouseError(code));
  }
}
export function warehouseError(code: string) {
  return (
    (
      {
        NETWORK_ERROR:
          'Нет ответа сервера. Повторите попытку с теми же данными; сохранённый склад не будет создан дважды.',
        INVALID_RESPONSE:
          'Не удалось прочитать ответ сервера. Повторите попытку.',
        UNAUTHORIZED:
          'Сессия истекла. Откройте приложение снова из Telegram-бота.',
        CHZ_AUTH_REQUIRED:
          'Ожидаем авторизацию ЧЗ. Включите Windows-компьютер с подписантом и подключите токен УКЭП.',
        SELLER_NOT_CONFIGURED: 'Сначала подключите Честный знак в настройках.',
        SELLER_ACCOUNT_MISMATCH:
          'ИНН не совпадает с подключённым ИП или сертификатом. Проверьте реквизиты подключения.',
        CHZ_PLACE_NOT_FOUND:
          'Этот адрес больше не доступен в ЧЗ. Обновите список и выберите адрес заново.',
        CONFIGURATION_IN_USE:
          'Адрес нельзя менять, пока у склада есть незавершённые продажи. Завершите их или добавьте другой склад.',
        WAREHOUSE_UNAVAILABLE: 'Склад недоступен. Обновите список складов.',
        CHZ_RATE_LIMITED:
          'ЧЗ временно ограничил запросы. Повторите загрузку позже.',
        CHZ_PLACES_CHANGED:
          'Список адресов в ЧЗ изменился во время загрузки. Обновите его.',
        CHZ_PLACES_RESPONSE_MISMATCH:
          'ЧЗ вернул адреса другого участника или товарной группы. Повторите загрузку позже.',
        CHZ_INVALID_RESPONSE:
          'ЧЗ вернул неполные или некорректные данные. Повторите загрузку позже.',
        IDEMPOTENCY_CONFLICT:
          'Данные этой попытки изменились. Закройте форму и откройте её снова.',
        INVALID_REQUEST: 'Проверьте название склада и выбранный адрес.',
        FORBIDDEN: 'Недостаточно прав для настройки складов.',
      } as Record<string, string>
    )[code] ??
    'Не удалось получить ответ. Повторите попытку; сохранённый склад не будет создан дважды.'
  );
}
export function createWarehouseApi(initData: string) {
  return async <T>(
    path: string,
    schema: { parse(value: unknown): T },
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/${path}`,
        {
          method: body ? 'POST' : 'GET',
          cache: 'no-store',
          headers: {
            authorization: `tma ${initData}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
            : AbortSignal.timeout(20000),
        },
      );
    } catch {
      throw new WarehouseApiError('NETWORK_ERROR');
    }
    const data: unknown = await response.json().catch(() => {
      throw new WarehouseApiError('INVALID_RESPONSE');
    });
    if (!response.ok) {
      const code =
        data && typeof data === 'object' && 'code' in data
          ? String(data.code)
          : 'UNAVAILABLE';
      throw new WarehouseApiError(code);
    }
    try {
      return schema.parse(data);
    } catch {
      throw new WarehouseApiError('INVALID_RESPONSE');
    }
  };
}
