import type {
  ApiErrorResponse,
  InventoryPageResponse,
  InventoryScanRequest,
  InventoryScanResponse,
  InventoryUnitDto,
  InventoryVariantDto,
} from '@avito/contracts';
export type StockVariant = InventoryVariantDto;
export type StockUnit = InventoryUnitDto;
export type StockPage = InventoryPageResponse;
export type ScanInput = InventoryScanRequest;
export type ScanResult = InventoryScanResponse;
const messages: Record<string, string> = {
  INVALID_MARKING:
    'Код не распознан. Нужен полный DataMatrix одежды с разделителями GS. Проверьте настройки сканера.',
  INVALID_GTIN: 'Не совпадает контрольная цифра GTIN. Повторите сканирование.',
  MARKING_STORAGE_NOT_CONFIGURED:
    'Приёмка пока недоступна: на сервере не настроен ключ хранения маркировки.',
  INVENTORY_NOT_CONFIGURED:
    'Склад пока не подключён. Обратитесь к администратору.',
  WAREHOUSE_UNAVAILABLE:
    'Ячейка приёмки недоступна. Обратитесь к администратору.',
  CATALOG_ARCHIVED: 'Товар архивирован. Требуется проверка каталога.',
  IDEMPOTENCY_CONFLICT:
    'Запрос уже использован для другого скана. Отсканируйте товар заново.',
  FORBIDDEN: 'Ваша роль не позволяет выполнить эту операцию.',
  USER_NOT_ALLOWED: 'Доступ отозван. Обратитесь к владельцу.',
};
export class InventoryApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly requestId?: string,
  ) {
    super(message);
  }
}
export function createInventoryApi(initData: string) {
  return async <T>(
    path: string,
    input?: ScanInput,
    signal?: AbortSignal,
  ): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/inventory${path}`,
        {
          method: input ? 'POST' : 'GET',
          cache: 'no-store',
          headers: {
            authorization: `tma ${initData}`,
            ...(input ? { 'content-type': 'application/json' } : {}),
          },
          ...(input ? { body: JSON.stringify(input) } : {}),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
            : AbortSignal.timeout(20_000),
        },
      );
    } catch {
      throw new InventoryApiError(
        'Нет ответа сервера. Повторите отправку: повторная попытка не добавит вторую вещь.',
        true,
      );
    }
    if (!response.ok) {
      const body = (await response
        .json()
        .catch(() => ({}))) as Partial<ApiErrorResponse>;
      throw new InventoryApiError(
        response.status === 401
          ? 'Сессия истекла. Откройте приложение снова из бота.'
          : (messages[body.code ?? ''] ??
              'Не удалось выполнить операцию. Попробуйте ещё раз.'),
        response.status >= 500 || response.status === 429,
        body.requestId ?? response.headers.get('x-correlation-id') ?? undefined,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new InventoryApiError(
        'Не удалось прочитать ответ сервера. Повторите отправку с тем же кодом.',
        true,
      );
    }
  };
}
