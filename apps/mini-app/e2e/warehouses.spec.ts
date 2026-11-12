import { test, expect, type Page } from '@playwright/test';
const mainId = '00000000-0000-4000-8000-000000000030';
const secondId = '00000000-0000-4000-8000-000000000031';
const fiasId = '00000000-0000-4000-8000-000000000032';
async function setup(
  page: Page,
  options: {
    empty?: boolean;
    waiting?: boolean;
    unconnected?: boolean;
    role?: string;
    lost?: boolean;
  } = {},
) {
  let currentInn: string | null = options.unconnected ? null : '123456789012';
  let authorized = !options.waiting && !options.unconnected,
    saved = false,
    lost = !!options.lost;
  const saves: Record<string, unknown>[] = [],
    scans: Record<string, unknown>[] = [],
    reads: string[] = [];
  let placeCalls = 0;
  const warehouses = () => [
    {
      id: mainId,
      name: 'Основной склад',
      isDefault: true,
      address: null,
      configured: false,
    },
    ...(saved
      ? [
          {
            id: secondId,
            name: 'Склад на Лесной',
            isDefault: false,
            address: 'Москва, Лесная, 1',
            configured: true,
          },
        ]
      : []),
  ];
  await page.route('https://telegram.org/js/telegram-web-app.js*', (r) =>
    r.fulfill({
      contentType: 'application/javascript',
      body: 'window.Telegram={WebApp:{initData:"test",ready(){},expand(){}}}',
    }),
  );
  await page.route('**/api/v1/**', async (r) => {
    const url = new URL(r.request().url()),
      path = url.pathname;
    if (path === '/api/v1/auth/telegram/verify')
      return r.fulfill({
        json: {
          user: {
            id: 'test',
            displayName: 'Владелец',
            roles: [options.role ?? 'OWNER'],
          },
        },
      });
    if (path === '/api/v1/chz/connection') {
      if (r.request().method() === 'POST')
        currentInn = String(
          (r.request().postDataJSON() as { sellerInn: string }).sellerInn,
        );
      return r.fulfill({
        json: {
          ok: true,
          sellerInn: currentInn,
          canChangeInn: !!options.unconnected,
          signerActive: false,
          authorized,
        },
      });
    }
    if (path === '/api/v1/chz/places') {
      placeCalls++;
      return r.fulfill({
        json: {
          ok: true,
          sellerInn: '123456789012',
          items: options.empty
            ? []
            : [{ fiasId, address: 'Москва, Лесная, 1' }],
          incompleteCount: options.empty ? 1 : 0,
        },
      });
    }
    if (path === '/api/v1/warehouses') {
      if (r.request().method() === 'GET')
        return r.fulfill({ json: { ok: true, items: warehouses() } });
      const body = r.request().postDataJSON() as Record<string, unknown>;
      saves.push(body);
      saved = true;
      if (lost) {
        lost = false;
        return r.abort('failed');
      }
      return r.fulfill({
        json: { ok: true, warehouseId: body.warehouseId ?? secondId },
      });
    }
    if (path === '/api/v1/inventory') {
      reads.push(url.searchParams.get('warehouseId') ?? 'MAIN');
      return r.fulfill({
        json: {
          ok: true,
          warehouse: {
            id: url.searchParams.get('warehouseId') ?? mainId,
            name:
              url.searchParams.get('warehouseId') === secondId
                ? 'Склад на Лесной'
                : 'Основной склад',
          },
          totals: { onHand: 0, available: 0, quarantine: 0 },
          items: [],
          hasMore: false,
        },
      });
    }
    if (path === '/api/v1/inventory/receipts/scan') {
      scans.push(r.request().postDataJSON() as Record<string, unknown>);
      return r.fulfill({
        status: 422,
        json: { ok: false, code: 'INVALID_MARKING' },
      });
    }
    if (path.endsWith('/integrations'))
      return r.fulfill({
        json: {
          data: {
            avitoConfigured: true,
            signerConfigured: true,
            documentsEnabled: false,
            avitoWritesEnabled: false,
            seller_configured: true,
            chz_authorized: authorized,
            signer_online: true,
            signer_last_seen_at: null,
            certificate_expires_at: null,
          },
        },
      });
    if (path.endsWith('/overview'))
      return r.fulfill({ json: { data: { calendar_days: 30 } } });
    return r.fulfill({ json: { data: [] } });
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Выбрать склад' }),
  ).toBeVisible();
  return {
    saves,
    scans,
    reads,
    authorize: () => {
      authorized = true;
    },
    placeCalls: () => placeCalls,
  };
}
async function add(page: Page) {
  await page.getByRole('button', { name: 'Выбрать склад' }).click();
  await page
    .getByRole('listitem')
    .filter({ hasText: /^Добавить склад$/ })
    .click();
  await page
    .getByLabel('Название склада', { exact: true })
    .fill('Склад на Лесной');
}
for (const width of [390, 1440])
  test(`adds a warehouse from one CHZ address and switches the real intake target at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await setup(page);
    await expect(
      page.getByRole('button', { name: 'Выбрать склад' }),
    ).toHaveText('Основной склад');
    await add(page);
    await expect(
      page.getByText('В ЧЗ найден один адрес.', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByLabel('Адрес отгрузки', { exact: true }),
    ).toHaveValue('Москва, Лесная, 1');
    await expect(page.getByLabel('ФИАС', { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`warehouse-address-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Подтвердить адрес' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(Object.keys(state.saves[0]!).sort()).toEqual(
      ['requestId', 'name', 'fiasId'].sort(),
    );
    await expect(
      page.getByRole('button', { name: 'Выбрать склад' }),
    ).toHaveText('Склад на Лесной');
    await expect.poll(() => state.reads.includes(secondId)).toBe(true);
    await page
      .getByLabel('USB-сканер или строка DataMatrix', { exact: true })
      .fill('test-code');
    await page
      .getByLabel('USB-сканер или строка DataMatrix', { exact: true })
      .press('Enter');
    await expect.poll(() => state.scans[0]?.warehouseId).toBe(secondId);
  });
test('explains missing and incomplete MOD data and blocks saving', async ({
  page,
}) => {
  await setup(page, { empty: true });
  await add(page);
  await expect(
    page.getByText('Часть мест в ЧЗ не содержит адреса', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('Откройте личный кабинет ЧЗ', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Обновить адреса' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Подтвердить адрес' }),
  ).toBeDisabled();
});
test('waits for authorization before loading places and then loads them automatically', async ({
  page,
}) => {
  const state = await setup(page, { waiting: true });
  await add(page);
  await expect(
    page.getByText('Ожидаем авторизацию ЧЗ.', { exact: false }),
  ).toBeVisible();
  expect(state.placeCalls()).toBe(0);
  state.authorize();
  await expect(page.getByLabel('Адрес отгрузки', { exact: true })).toHaveValue(
    'Москва, Лесная, 1',
    { timeout: 10000 },
  );
});
test('retries a save with the same request identity after a lost response', async ({
  page,
}) => {
  const state = await setup(page, { lost: true });
  await add(page);
  await page.getByRole('button', { name: 'Подтвердить адрес' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => state.saves.length).toBe(1);
  await page.getByRole('button', { name: 'Подтвердить адрес' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.saves[0]).toEqual(state.saves[1]);
});
test('warehouse staff can choose warehouses but cannot add or configure them', async ({
  page,
}) => {
  await setup(page, { role: 'WAREHOUSE' });
  await page.getByRole('button', { name: 'Выбрать склад' }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: /^Добавить склад$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Настроить выбранный склад' }),
  ).toHaveCount(0);
});

test('saves the CHZ INN before requiring a warehouse address', async ({
  page,
}) => {
  const state = await setup(page, { unconnected: true });
  await page
    .getByRole('navigation', { name: 'Основная навигация' })
    .getByText('Настройки', { exact: true })
    .click();
  await page
    .getByLabel('ИНН ИП · 12 цифр', { exact: true })
    .fill('123456789012');
  await page.getByRole('button', { name: 'Сохранить ИНН' }).click();
  await expect(
    page.getByText('Подключите Windows-подписант ниже', { exact: false }),
  ).toBeVisible();
  expect(state.saves).toHaveLength(0);
  await page
    .getByLabel('ИНН ИП · 12 цифр', { exact: true })
    .fill('999999999999');
  await expect(
    page.getByRole('button', { name: 'Сохранить ИНН' }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Настроить адрес', exact: true }),
  ).toBeVisible();
});
