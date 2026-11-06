import { test, expect, type Page } from '@playwright/test';
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = uuid(1),
  uid = uuid(2),
  docId = uuid(3);
const raw = `010466043076454321TEST000000001\u001d91ABCD\u001d92${'A'.repeat(44)}`;
const at = '2026-11-04T09:00:00.000Z';
async function setup(
  page: Page,
  options: {
    role?: string;
    lost?: boolean;
    status?: string;
    docStatus?: string;
  } = {},
) {
  const requests: { action: string; body: Record<string, unknown> }[] = [];
  let packed = false,
    lost = !!options.lost,
    status = options.status ?? 'DRAFT',
    prepared: string | null = null;
  let handedAt: string | null = status === 'HANDED_OVER' ? at : null;
  const shipment = () => ({
    id: sid,
    order_id: uuid(8),
    parcel_code: 'DEMO-1042',
    status,
    prepared_at: prepared,
    handed_over_at: handedAt,
    items: [
      {
        shipment_item_id: uuid(9),
        unit_id: uid,
        name: 'Джинсы прямые',
        size_label: '48 RU',
        color: 'Синий',
        masked_code: '0466… · •••0001',
        physical_state: status === 'HANDED_OVER' ? 'IN_TRANSIT' : 'PACKING',
        legal_state: prepared ? 'WITHDRAWN' : 'IN_CIRCULATION',
        packed_at: packed ? at : null,
        avito_marking_status: packed ? 'ACCEPTED' : 'NOT_SENT',
        unit_price_kopecks: '249000',
        legal_operation_status: prepared ? 'CONFIRMED' : null,
      },
    ],
  });
  const document = {
    id: docId,
    status: options.docStatus ?? 'MANUAL_ATTENTION',
    created_at: at,
    signing_status: 'RECEIVED',
    verification_source: null,
    items: [
      {
        id: uuid(20),
        unitId: uid,
        maskedCode: '0466… · •••0001',
        status: 'CONFIRMED',
      },
      {
        id: uuid(21),
        unitId: uuid(22),
        maskedCode: '0466… · •••0002',
        status: 'REJECTED',
        errorCode: 'DOCUMENT_REJECTED',
      },
    ],
  };
  await page.route('https://telegram.org/js/telegram-web-app.js*', (r) =>
    r.fulfill({
      contentType: 'application/javascript',
      body: 'window.Telegram={WebApp:{initData:"test",ready(){},expand(){}}}',
    }),
  );
  await page.route('**/api/v1/auth/telegram/verify', (r) =>
    r.fulfill({
      json: {
        user: {
          id: uuid(99),
          displayName: 'Сотрудник',
          roles: [options.role ?? 'OWNER'],
        },
      },
    }),
  );
  await page.route('**/api/v1/inventory**', (r) =>
    r.fulfill({
      json: {
        ok: true,
        warehouse: { id: uuid(30), name: 'Основной' },
        totals: { onHand: 1, available: 1, quarantine: 0 },
        items: [],
        hasMore: false,
      },
    }),
  );
  await page.route('**/api/v1/marking/**', async (r) => {
    const path = new URL(r.request().url()).pathname.split('/marking/')[1]!;
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      const action = path.split('/').at(-1)!;
      requests.push({ action, body });
      if (action === 'pack') {
        packed = true;
        status = 'PACKED';
        if (lost) {
          lost = false;
          return r.abort('failed');
        }
      }
      if (action === 'prepare') {
        prepared = new Date().toISOString();
        status = 'READY';
      }
      if (action === 'handover') {
        status = 'HANDED_OVER';
        handedAt = String(body.occurredAt);
      }
      return r.fulfill({
        json: {
          ok: true,
          replayed:
            requests.filter((x) => x.body.requestId === body.requestId).length >
            1,
          result: { shipmentId: sid },
        },
      });
    }
    let data: unknown = [];
    if (path === 'integrations')
      data = {
        avitoConfigured: true,
        signerConfigured: true,
        documentsEnabled: false,
        avitoWritesEnabled: false,
        seller_configured: true,
        chz_authorized: false,
        signer_online: false,
        signer_last_seen_at: null,
        certificate_expires_at: null,
      };
    if (path === 'overview')
      data = { packed: 0, ready: 0, issues: 0, pending: 0, calendar_days: 30 };
    if (path === 'shipments')
      data = [
        {
          id: sid,
          order_id: uuid(8),
          parcel_code: 'DEMO-1042',
          status,
          external_order_id: 'TEST-ORDER',
          created_at: at,
        },
      ];
    if (path === `shipments/${sid}`) data = shipment();
    if (path === 'documents' || path === `documents/${docId}`)
      data =
        path === 'documents'
          ? [document]
          : {
              ...document,
              items: document.items.map((i) => ({
                ...i,
                unit_id: i.unitId,
                masked_code: i.maskedCode,
              })),
            };
    if (path.endsWith('/export'))
      data = {
        documentId: docId,
        legalCompleted: false,
        payloadBase64: 'VEVTVA==',
      };
    return r.fulfill({
      json: { data },
    });
  });
  await page.goto('/');
  const mobile = (page.viewportSize()?.width ?? 1280) < 960;
  if (mobile)
    await page.getByRole('button', { name: 'Упаковка', exact: true }).click();
  else
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByText('Упаковка', { exact: true })
      .click();
  await page.getByRole('button', { name: 'Открыть посылку DEMO-1042' }).click();
  return requests;
}
for (const width of [390, 1440])
  test(`packing to handover uses new API at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const requests = await setup(page, { lost: true });
    const input = page
      .getByRole('textbox', { name: 'USB-сканер или строка DataMatrix' })
      .filter({ visible: true });
    await input.fill(raw);
    await input.press('Enter');
    await expect(
      page.getByText('Результат неизвестен.', { exact: false }).first(),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Повторить исходный запрос' })
      .click();
    await expect(page.getByTestId('packing-progress')).toHaveText('1 из 1');
    expect(requests[0]?.body).toEqual(requests[1]?.body);
    expect(requests[0]?.body.raw).toBe(raw);
    expect(requests.every((x) => x.action !== 'receive')).toBe(true);
    await page
      .getByRole('button', { name: 'Подготовить к передаче', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Передал перевозчику', exact: true })
      .click();
    await page
      .getByRole('textbox', { name: 'Номер или ссылка подтверждения передачи' })
      .fill('carrier-receipt-test');
    await page
      .getByRole('checkbox', { name: 'Подтверждаю фактическое событие' })
      .check();
    await page
      .getByRole('button', { name: 'Подтвердить', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Принять возврат', exact: true }),
    ).toBeVisible();
    expect(
      requests.find((x) => x.action === 'handover')?.body.occurredOutsideApp,
    ).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({
      path: `/tmp/marking-workspace-${width}.png`,
      fullPage: true,
    });
  });
test('viewer never gets write actions', async ({ page }) => {
  await setup(page, { role: 'VIEWER', status: 'READY' });
  await expect(
    page.getByText('Подписант: не в сети', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Передал перевозчику', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Настройки', exact: true }),
  ).toHaveCount(0);
});
test('document partial results, received signature and explicit export', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('tab', { name: 'Документы', exact: true }).click();
  await expect(
    page.getByText('Подпись: Подпись получена, но не проверена'),
  ).toBeVisible();
  await expect(page.getByText('Подтверждено', { exact: true })).toBeVisible();
  await expect(page.getByText('Отклонено', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Открыть документ', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Скачать документ', exact: true })
    .click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать JSON', exact: true }).click();
  expect((await download).suggestedFilename()).toBe(`document-${docId}.json`);
});
test('return requests payment evidence only for paid returns', async ({
  page,
}) => {
  const requests = await setup(page, { status: 'HANDED_OVER' });
  await page
    .getByRole('button', { name: 'Принять возврат', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Номер документа', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Код возвращённой вещи', { exact: true }).fill(raw);
  await page.getByLabel('Подтверждённый факт оплаты', { exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await page
    .getByRole('option', { name: 'Оплаты не было', exact: true })
    .click();
  await page
    .getByLabel('Подтверждение получения возврата', { exact: true })
    .fill('return-receipt-test');
  await page
    .getByLabel('Фактическая дата и время', { exact: true })
    .fill('2026-11-04T12:00');
  await page
    .getByRole('checkbox', { name: 'Подтверждаю фактическое событие' })
    .check();
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(
    page.getByText(
      'Возврат получен. Исправная вещь будет доступна только после юридического восстановления.',
    ),
  ).toBeVisible();
  expect(requests.find((x) => x.action === 'return')?.body.paid).toBe(false);
  expect(
    requests.find((x) => x.action === 'return')?.body.primaryDocument,
  ).toBeUndefined();
});

test('settings submit contract fields and viewer has no export', async ({
  page,
}) => {
  const requests = await setup(page);
  await page
    .getByRole('navigation', { name: 'Основная навигация' })
    .getByText('Настройки', { exact: true })
    .click();
  await expect(
    page.getByText('Состояние подключения показано выше', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Добавить реквизиты склада', exact: true })
    .click();
  for (const [label, value] of [
    ['ИНН ИП · 12 цифр', '123456789012'],
    ['Идентификатор склада', uuid(30)],
    ['ФИАС', uuid(31)],
    ['Адрес склада', 'Тестовый адрес склада'],
    ['Подтверждение кассовой / договорной схемы', 'test-contract-reference'],
  ])
    await page.getByLabel(label!, { exact: true }).fill(value!);
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect
    .poll(() => requests.some((r) => r.action === 'configure'))
    .toBe(true);
  expect(
    Object.keys(requests.find((r) => r.action === 'configure')!.body).sort(),
  ).toEqual(
    [
      'requestId',
      'sellerInn',
      'warehouseId',
      'fiasId',
      'address',
      'fiscalEvidenceReference',
    ].sort(),
  );
});

test('legal details are loaded only after expanding a unit', async ({
  page,
}) => {
  let calls = 0;
  await setup(page);
  await page.route('**/api/v1/inventory?**', (r) =>
    r.fulfill({
      json: {
        ok: true,
        warehouse: { id: uuid(30), name: 'Склад' },
        totals: { onHand: 1, available: 1, quarantine: 0 },
        hasMore: false,
        items: [
          {
            id: uuid(40),
            productId: null,
            productName: null,
            name: 'Джинсы',
            article: null,
            color: 'Синий',
            size: '48',
            gtins: ['04660430764543'],
            onHand: 1,
            available: 1,
            quarantine: 0,
            reserved: 0,
            defective: 0,
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/inventory/variants/*/units?**', (r) =>
    r.fulfill({
      json: {
        ok: true,
        hasMore: false,
        items: [
          {
            id: uid,
            variantId: uuid(40),
            name: 'Джинсы',
            maskedCode: '0466… · •••0001',
            internalCode: 'U-TEST',
            state: 'AVAILABLE',
            location: 'Склад',
            receivedAt: at,
            receiptNumber: 'SCAN-TEST',
          },
        ],
      },
    }),
  );
  await page.route(`**/api/v1/marking/units/${uid}`, (r) => {
    calls++;
    return r.fulfill({
      json: {
        data: {
          id: uid,
          current_state: 'AVAILABLE',
          masked_code: '0466… · •••0001',
          legal_state: null,
          ownership_verified: null,
          observed_at: null,
          received_legally: false,
          pending: false,
          blockers: ['SUPPLY_NOT_CONFIRMED'],
        },
      },
    });
  });
  await page
    .getByRole('navigation', { name: 'Основная навигация' })
    .getByText('Склад', { exact: true })
    .click();
  await page.getByRole('tab', { name: 'Остатки', exact: true }).click();
  // Refresh the existing warehouse query, without touching the marking endpoint.
  await page
    .getByRole('button', { name: 'Обновить склад', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Показать экземпляры', exact: true })
    .first()
    .click();
  expect(calls).toBe(0);
  await page.getByRole('button', { name: /Юридическое состояние/ }).click();
  await expect(
    page.getByText('Проверяем документы', { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(1);
});

test('viewer sees document results without export or correction controls', async ({
  page,
}) => {
  await setup(page, { role: 'VIEWER' });
  await page.getByRole('tab', { name: 'Документы', exact: true }).click();
  await page
    .getByRole('button', { name: 'Открыть документ', exact: true })
    .click();
  await expect(
    page.getByText('Подпись: Подпись получена, но не проверена'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Скачать документ', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Исправить отклонённые строки',
      exact: true,
    }),
  ).toHaveCount(0);
});

test('owner requests a Windows installer without entering any agent credentials', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/v1/local-signer/install-link', (r) =>
    r.fulfill({
      json: {
        url: 'https://api.example.com/signer/install#' + 'a'.repeat(43),
        expiresAt: '2027-01-01T00:00:00.000Z',
      },
    }),
  );
  await page
    .getByRole('navigation', { name: 'Основная навигация' })
    .getByText('Настройки', { exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Подключить Windows', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Ссылка для Windows · 30 минут' }),
  ).toHaveValue('https://api.example.com/signer/install#' + 'a'.repeat(43));
  await expect(
    page.getByRole('link', { name: 'Открыть установку' }),
  ).toHaveAttribute('rel', 'noopener noreferrer');
});
