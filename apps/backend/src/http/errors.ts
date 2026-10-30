import type { ApiErrorCode, ApiErrorResponse } from '@avito/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const failures = {
  AVITO_NOT_CONFIGURED: [503, 'Доступ к заказам Авито не настроен.'],
  AVITO_ACCESS_DENIED: [
    503,
    'Авито не предоставил доступ к заказам. Проверьте разрешения интеграции.',
  ],
  AVITO_UNAVAILABLE: [
    503,
    'Не удалось получить заказы Авито. Повторите позже.',
  ],
  AVITO_RATE_LIMITED: [
    429,
    'Авито ограничил частоту запросов. Повторите позже.',
  ],
  ORDER_NOT_FOUND: [404, 'Заказ не найден в Авито.'],
  ORDER_ACTIONS_DISABLED: [
    409,
    'Включён режим просмотра. Подтверждение заказа не отправлено в Авито.',
  ],
  UNAUTHORIZED: [
    401,
    'Передайте подписанную сессию Telegram в заголовке Authorization.',
  ],
  TELEGRAM_NOT_CONFIGURED: [
    503,
    'Авторизация Telegram на сервере не настроена.',
  ],
  MALFORMED: [401, 'Некорректные данные сессии Telegram.'],
  INVALID_SIGNATURE: [401, 'Подпись сессии Telegram недействительна.'],
  EXPIRED: [401, 'Сессия Telegram истекла. Откройте приложение снова.'],
  TELEGRAM_USER_MISSING: [401, 'В сессии Telegram отсутствует пользователь.'],
  USER_NOT_ALLOWED: [403, 'Доступ пользователю не выдан или отозван.'],
  FORBIDDEN: [403, 'Недостаточно прав для этой операции.'],
  INVALID_REQUEST: [400, 'Проверьте параметры запроса.'],
  INVALID_JSON: [400, 'Тело запроса должно содержать корректный JSON.'],
  UNSUPPORTED_MEDIA_TYPE: [
    415,
    'Для тела запроса используйте Content-Type: application/json.',
  ],
  PAYLOAD_TOO_LARGE: [413, 'Превышен допустимый размер запроса.'],
  NOT_FOUND: [404, 'Маршрут не найден.'],
  INTERNAL_ERROR: [
    500,
    'Не удалось выполнить запрос. Если результат приёмки неизвестен, повторите тот же запрос с прежним UUID.',
  ],
  INVENTORY_NOT_CONFIGURED: [503, 'Складской сервис на сервере не настроен.'],
  MARKING_STORAGE_NOT_CONFIGURED: [
    503,
    'На сервере не настроено защищённое хранение маркировки.',
  ],
  INVALID_MARKING: [
    422,
    'Нужен полный DataMatrix одежды с сохранёнными разделителями GS.',
  ],
  INVALID_GTIN: [
    422,
    'Не совпадает контрольная цифра GTIN. Повторите сканирование.',
  ],
  IDEMPOTENCY_CONFLICT: [
    409,
    'Этот UUID запроса уже использован с другими данными скана.',
  ],
  CATALOG_NOT_FOUND: [
    422,
    'Товар не найден в Национальном каталоге и не добавлен на склад.',
  ],
  CATALOG_UNAVAILABLE: [
    503,
    'Национальный каталог недоступен. Товар не добавлен; повторите отправку позже.',
  ],
  CATALOG_NOT_CONFIGURED: [
    503,
    'На сервере не настроен доступ к Национальному каталогу. Товар не добавлен.',
  ],
  CATALOG_AMBIGUOUS: [
    409,
    'По GTIN найдено несколько карточек. Товар не добавлен на склад.',
  ],
  CATALOG_ARCHIVED: [409, 'Товар архивирован. Требуется проверка каталога.'],
  WAREHOUSE_UNAVAILABLE: [503, 'Склад или ячейка приёмки недоступны.'],
} satisfies Record<ApiErrorCode, readonly [number, string]>;
export function sendApiError(
  reply: FastifyReply,
  request: FastifyRequest,
  code: ApiErrorCode,
) {
  const [status, message] = failures[code];
  const body: ApiErrorResponse = {
    ok: false,
    code,
    message,
    requestId: request.id,
  };
  return reply.code(status).send(body);
}
export function registerHttpErrors(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const transportCode =
      error instanceof Error && 'code' in error ? error.code : undefined;
    const code: ApiErrorCode =
      transportCode === 'FST_ERR_CTP_BODY_TOO_LARGE'
        ? 'PAYLOAD_TOO_LARGE'
        : transportCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
          ? 'UNSUPPORTED_MEDIA_TYPE'
          : [
                'FST_ERR_CTP_INVALID_JSON_BODY',
                'FST_ERR_CTP_EMPTY_JSON_BODY',
              ].includes(String(transportCode))
            ? 'INVALID_JSON'
            : [
                  'FST_ERR_CTP_INVALID_CONTENT_LENGTH',
                  'FST_ERR_VALIDATION',
                ].includes(String(transportCode))
              ? 'INVALID_REQUEST'
              : 'INTERNAL_ERROR';
    // Error messages, causes and validation issues may contain raw marking/session/SQL data.
    if (code === 'INTERNAL_ERROR')
      request.log.error({ code }, 'HTTP request failed');
    return sendApiError(reply, request, code);
  });
  app.setNotFoundHandler((request, reply) =>
    sendApiError(reply, request, 'NOT_FOUND'),
  );
}
