import {
  markingReadSchema,
  markingCommandSchema,
  markingRequests,
  type MarkingAction,
} from '@avito/contracts';
export const markingLabels: Record<string, string> = {
  DRAFT: 'Упаковка',
  PACKED: 'Упаковано',
  READY: 'Готово к передаче',
  HANDED_OVER: 'Передано перевозчику',
  DELIVERED: 'Доставлено',
  CANCELLED: 'Отменено',
  PENDING: 'Ожидает',
  ACCEPTED: 'Принято',
  NOT_SENT: 'Не отправлено',
  CONFIRMED: 'Подтверждено',
  REJECTED: 'Отклонено',
  MANUAL_ATTENTION: 'Нужна помощь',
  UNKNOWN_RESULT: 'Результат неизвестен',
  PREPARING: 'Подготовка',
  WAITING_SIGNATURE: 'Ожидаем подпись',
  SUBMITTED: 'Отправлено',
  PROCESSING: 'Обрабатывается',
  SHIPMENT_NOT_PACKED: 'Посылка ещё не упакована или уже подготовлена',
  MARKINGS_NOT_ACCEPTED: 'Авито ещё не подтвердил маркировки',
  NOT_SHIPPED: 'Передача посылки ещё не зафиксирована',
  FUTURE_EVENT: 'Фактическое время не может быть в будущем',
  SIGNATURE_VERIFICATION_UNAVAILABLE: 'Проверка подписи ещё не подключена',
  SIGNATURE_PAYLOAD_MISMATCH: 'Подпись относится к другим байтам документа',
  LEASED: 'Задание у подписанта',
  RECEIVED: 'Подпись получена, но не проверена',
  VERIFIED: 'Подпись проверена',
  IN_CIRCULATION: 'В обороте',
  WITHDRAWN: 'Выведен из оборота',
  UNKNOWN: 'Нет подтверждённых данных',
  AVAILABLE: 'Доступен на складе',
  QUARANTINE: 'Карантин',
  PACKING: 'Упаковка',
  RESERVED: 'В резерве',
  DEFECTIVE: 'Брак',
  IN_TRANSIT: 'В пути',
  DOCUMENT_SUBMISSION_DISABLED: 'Отправка документов ЧЗ выключена владельцем',
  AVITO_WRITES_DISABLED: 'Изменения Авито выключены владельцем',
  CHZ_AUTH_REQUIRED: 'Требуется авторизация ЧЗ через подписант',
  SIGNER_WAITING: 'Ожидаем подпись владельца',
  SIGNER_CERTIFICATE_NOT_CONFIGURED: 'Не настроен сертификат подписанта',
  SUBMISSION_RESULT_UNKNOWN: 'Результат отправки неизвестен — нужна сверка',
  CHZ_PROCESSING: 'Документ обрабатывается в ЧЗ',
  CHZ_CODE_RESPONSE_INCOMPLETE: 'ЧЗ не вернул результат по коду',
  ORDER_MAPPING_REQUIRED: 'Укажите вариант товара для объявления',
  LEGAL_PROVIDER_DISABLED: 'Интеграция не подключена',
  SUPPLY_NOT_CONFIRMED: 'Нет подтверждения документов поставщика',
  OWNERSHIP_NOT_VERIFIED: 'Не подтверждено право распоряжения товаром',
  CODE_NOT_IN_CIRCULATION: 'Код не готов к продаже',
  LEGAL_CHECK_STALE: 'Проверка устарела',
  LEGAL_OPERATION_PENDING: 'ЧЗ ещё обрабатывает предыдущую операцию',
  LEGAL_NOT_READY: 'Товар юридически не готов',
  WRONG_UNIT: 'Эта вещь не входит в посылку',
  INVALID_MARKING: 'Не распознан полный DataMatrix',
  INVALID_GTIN: 'Неверная контрольная цифра GTIN',
  DOCUMENT_REJECTED: 'ЧЗ отклонил часть документа',
  DOCUMENT_STATE_MISMATCH: 'Результат документа не совпал с состоянием кода',
  JOB_FAILED: 'Фоновая обработка остановилась',
  LEGAL_DEADLINE_EXCEEDED: 'Нарушен срок передачи сведений',
  HANDOVER_OUTSIDE_APP: 'Передано до завершения оформления',
  PREPARED_NOT_HANDED_OVER: 'Подготовленная посылка долго не передана',
  DAMAGED_CODE: 'Повреждена маркировка',
  WRONG_ITEM: 'Вернулась другая вещь',
  COMPOSITION_FROZEN: 'Состав посылки уже зафиксирован',
  INVALID_TRANSITION: 'Действие недоступно в текущем состоянии',
  RECONCILE_BEFORE_COMPENSATION: 'Сначала требуется сверка документа',
  CALENDAR_INCOMPLETE: 'Не загружен полный календарь',
  FORBIDDEN: 'Недостаточно прав',
  ENTITY_NOT_FOUND: 'Объект не найден',
  INVALID_REQUEST: 'Проверьте заполненные поля',
  IDEMPOTENCY_CONFLICT: 'Этот запрос уже использован с другими данными',
  PREPARATION_EXPIRED: 'Подготовка просрочена — нужна помощь владельца',
};
export const markingLabel = (value: string | null | undefined) =>
  value
    ? (markingLabels[value] ??
      (/^[A-Z][A-Z0-9_]+$/.test(value) ? 'Требует уточнения' : value))
    : 'Нет данных';
export const displayDate = (value: string | null | undefined) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('ru-RU')
    : 'Не указано';
export const displayMoney = (value: string | number | null | undefined) =>
  value == null
    ? 'Не указана'
    : Number.isSafeInteger(Number(value))
      ? new Intl.NumberFormat('ru-RU', {
          style: 'currency',
          currency: 'RUB',
          maximumFractionDigits: 2,
        }).format(Number(value) / 100)
      : 'Сумма вне диапазона';
export class MarkingApiError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain: boolean,
    readonly blockers: string[] = [],
    readonly requestId?: string,
  ) {
    super(markingLabel(code));
  }
}
export function createMarkingApi(initData: string) {
  async function fetchJson(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/marking/${path}`,
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
      throw new MarkingApiError(
        'Нет ответа сервера. Результат запроса неизвестен.',
        !!body,
      );
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new MarkingApiError('Не удалось прочитать ответ сервера.', !!body);
    }
    if (!response.ok) {
      const e = value as {
        code?: string;
        blockers?: string[];
        requestId?: string;
      };
      throw new MarkingApiError(
        response.status === 401
          ? 'Сессия истекла. Откройте приложение снова.'
          : (e.code ?? 'Ошибка сервера'),
        !!body && (response.status >= 500 || response.status === 408),
        Array.isArray(e.blockers) ? e.blockers : [],
        e.requestId,
      );
    }
    return value;
  }
  return {
    async read<T>(
      path: string,
      schema: { parse: (value: unknown) => T },
      signal?: AbortSignal,
    ) {
      try {
        const response = markingReadSchema.parse(
          await fetchJson(path, undefined, signal),
        );
        return { ...response, data: schema.parse(response.data) };
      } catch (error) {
        if (error instanceof MarkingApiError) throw error;
        throw new MarkingApiError(
          'Сервер вернул неожиданные данные. Повторите позже.',
          false,
        );
      }
    },
    async command(action: MarkingAction, input: unknown) {
      const parsed = markingRequests[action].safeParse(input);
      if (!parsed.success) throw new MarkingApiError('INVALID_REQUEST', false);
      const result = markingCommandSchema.safeParse(
        await fetchJson(`commands/${action}`, parsed.data),
      );
      if (!result.success)
        throw new MarkingApiError(
          'Не удалось подтвердить результат запроса.',
          true,
        );
      return result.data;
    },
    async download(id: string) {
      const response = markingReadSchema.parse(
        await fetchJson(`documents/${encodeURIComponent(id)}/export`),
      );
      const blob = new Blob([JSON.stringify(response, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `document-${id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
