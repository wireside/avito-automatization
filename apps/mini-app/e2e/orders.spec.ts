import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
const firstId = '50000000000472798';
const secondId = '50000000000472819';
function order(
  id = firstId,
  status = 'on_confirmation',
  imageUrl: string | null = null,
) {
  return {
    id,
    marketplaceId: `7${id}`,
    status,
    createdAt: '2026-10-30T09:05:00Z',
    updatedAt: '2026-10-30T09:48:00Z',
    items: [
      {
        avitoId: '123456789',
        title: 'Джинсы прямые',
        quantity: 1,
        priceMinor: 249000,
        imageUrl,
      },
    ],
    priceMinor: 249000,
    schedules: {
      confirmTill: '2026-10-30T14:00:00Z',
      shipTill: '2026-10-31T18:00:00Z',
    },
    delivery: {
      serviceName: 'СДЭК',
      serviceType: 'pvz',
      trackingNumber: 'TRACK-TEST-123',
      dispatchNumber: 'DISPATCH-TEST',
    },
    availableActions:
      status === 'on_confirmation' ? [{ name: 'confirm', required: true }] : [],
  };
}
async function setup(page: Page, imageUrl: string | null = null) {
  const writes: string[] = [];
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Telegram={WebApp:{initData:"test-data",ready(){},expand(){}}};',
    }),
  );
  await page.route('**/api/v1/auth/telegram/verify', (route) =>
    route.fulfill({
      json: {
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          displayName: 'Богдан',
          roles: ['OWNER'],
        },
      },
    }),
  );
  await page.route('**/api/v1/inventory**', (route) =>
    route.fulfill({
      json: {
        ok: true,
        warehouse: { id: 'test', name: 'Основной склад' },
        totals: { onHand: 0, available: 0, quarantine: 0 },
        items: [],
        hasMore: false,
      },
    }),
  );
  await page.route('**/api/v1/orders**', (route) => {
    if (route.request().method() !== 'GET') {
      writes.push(route.request().url());
      return route.fulfill({ status: 500 });
    }
    const u = new URL(route.request().url());
    if (/\/orders\//.test(u.pathname))
      return route.fulfill({
        json: {
          ok: true,
          order: order(
            u.pathname.split('/').at(-1),
            'on_confirmation',
            imageUrl,
          ),
          fetchedAt: new Date().toISOString(),
          mode: 'read_only',
        },
      });
    const status = u.searchParams.get('status');
    return route.fulfill({
      json: {
        ok: true,
        orders: [
          order(
            u.searchParams.get('page') === '2' ? secondId : firstId,
            status || 'on_confirmation',
            imageUrl,
          ),
        ],
        hasMore: u.searchParams.get('page') !== '2',
        fetchedAt: new Date().toISOString(),
        mode: 'read_only',
      },
    });
  });
  await page.goto('/');
  const desktop = (page.viewportSize()?.width ?? 0) >= 960;
  if (desktop)
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByText('Заказы', { exact: true })
      .click();
  else await page.getByRole('button', { name: 'Заказы', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Заказы', exact: true }),
  ).toBeVisible();
  await expect(page.locator(`[data-order-id="${firstId}"]`)).toBeVisible();
  return writes;
}
for (const width of [430, 1512]) {
  test(`orders list and detail are read-only at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 982 });
    const writes = await setup(page);
    await expect(
      page.getByText('Данные Авито', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator(`[data-order-id="${firstId}"]`)).toContainText(
      `№${firstId}`,
    );
    if (width < 960) {
      const number = page
        .getByRole('button', { name: `Открыть заказ ${firstId}`, exact: true })
        .locator('.order-number');
      expect(
        await number.evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth + 1 &&
            element.scrollHeight <= element.clientHeight + 1,
        ),
      ).toBe(true);
    }
    await page
      .getByRole('button', { name: `Открыть заказ ${firstId}`, exact: true })
      .click();
    await expect(page.getByTestId('order-tracking')).toContainText(
      'TRACK-TEST-123',
    );
    await expect(
      page.getByRole('button', { name: 'Взять заказ в работу', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Сопоставление со складом и резерв доступны/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Обновить заказы' }).click();
    expect(writes).toEqual([]);
    await page.getByRole('button', { name: '← Заказы', exact: true }).click();
    await expect(page.locator(`[data-order-id="${firstId}"]`)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const image = page.locator('img[data-illustration="denim"]').first();
    await expect(image).toBeVisible();
    const geometry = await image.boundingBox();
    expect(geometry?.width).toBe(40);
    expect(geometry?.height).toBe(54);
    await page.screenshot({
      path: `/tmp/avito-orders/orders-${width}.png`,
      fullPage: true,
    });
  });
}
test('filters by provider status, paginates, and labels search as page-local', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'В пути', exact: true }).click();
  await expect(page.getByText('В пути', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(page.locator(`[data-order-id="${secondId}"]`)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Далее', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Номер или товар на странице' })
    .fill('Неизвестный товар');
  await expect(
    page.getByText('На этой странице ничего не найдено.'),
  ).toBeVisible();
});
test('shows a recoverable provider error and stale data warning', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/v1/orders?**', (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'AVITO_UNAVAILABLE', requestId: 'safe-correlation' },
    }),
  );
  await page.getByRole('button', { name: 'Обновить заказы' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Не удалось получить свежие данные Авито' }),
  ).toBeVisible();
  await expect(
    page.getByText('Ниже показаны данные предыдущего обновления.'),
  ).toBeVisible();
  await expect(page.locator(`[data-order-id="${firstId}"]`)).toBeVisible();
});

test('polls fresh Avito status while the list is open', async ({ page }) => {
  await page.clock.install();
  await setup(page);
  await page.route('**/api/v1/orders?**', (route) =>
    route.fulfill({
      json: {
        ok: true,
        orders: [order(firstId, 'in_transit')],
        hasMore: false,
        fetchedAt: new Date().toISOString(),
        mode: 'read_only',
      },
    }),
  );
  await page.clock.fastForward(31000);
  await expect(page.locator(`[data-order-id="${firstId}"]`)).toContainText(
    'В пути',
  );
});

test('keeps the intake input when switching from warehouse to orders and back', async ({
  page,
}) => {
  await setup(page);
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  await nav.getByText('Склад', { exact: true }).click();
  const input = page.getByRole('textbox', {
    name: 'USB-сканер или строка DataMatrix',
  });
  await input.fill('UNSENT');
  await nav.getByText('Заказы', { exact: true }).click();
  await nav.getByText('Склад', { exact: true }).click();
  await expect(input).toHaveValue('UNSENT');
});

test('shows the listing photo and falls back without breaking order navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const imageUrl = 'https://01.img.avito.st/image/test-listing.jpg';
  await page.route(imageUrl, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: readFileSync(
        'apps/mini-app/src/assets/figma/orders-denim.svg',
        'utf8',
      ),
    }),
  );
  await setup(page, imageUrl);
  const image = page.getByAltText('Фото объявления Авито').first();
  await expect(image).toBeVisible();
  expect(
    await image.evaluate(
      (element) => (element as HTMLImageElement).naturalWidth,
    ),
  ).toBeGreaterThan(0);
  await expect(
    page.getByRole('button', { name: `Открыть заказ ${firstId}`, exact: true }),
  ).toContainText(`№${firstId}`);
  await page
    .getByRole('button', { name: `Открыть заказ ${firstId}`, exact: true })
    .click();
  await expect(page.getByAltText('Фото объявления Авито')).toBeVisible();
  await page.getByRole('button', { name: '← Заказы', exact: true }).click();
  await page.unroute(imageUrl);
  await page.route(imageUrl, (route) => route.abort());
  await page.reload();
  await page.getByRole('button', { name: 'Заказы', exact: true }).click();
  await expect(
    page.locator('img[data-illustration="denim"]').first(),
  ).toBeVisible();
});

for (const width of [320, 390, 430]) {
  test(`entire card opens from product and keyboard at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 932 });
    const writes = await setup(page);
    const card = page.getByRole('button', {
      name: `Открыть заказ ${firstId}`,
      exact: true,
    });
    await expect(card.locator('button')).toHaveCount(0);
    await card.getByText('Джинсы прямые', { exact: true }).click();
    await expect(page.getByTestId('order-tracking')).toBeVisible();
    await page.getByRole('button', { name: '← Заказы', exact: true }).click();
    await card.focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('order-tracking')).toBeVisible();
    await page.getByRole('button', { name: '← Заказы', exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator('.v-application')
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe('rgb(5, 6, 7)');
    await page.screenshot({
      path: `/tmp/avito-redesign-${width}.png`,
      fullPage: true,
    });
    expect(writes).toEqual([]);
  });
}
test('desktop row opens by clicking product and with Enter', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  await setup(page);
  const row = page.locator(`[data-order-id="${firstId}"]`);
  await row.getByText('Джинсы прямые', { exact: true }).click();
  await expect(page.getByTestId('order-tracking')).toBeVisible();
  await page.getByRole('button', { name: '← Заказы', exact: true }).click();
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('order-tracking')).toBeVisible();
});

test('takes a real-order snapshot into packing, remembers the exact mapping request after a lost response', async ({
  page,
}) => {
  await setup(page);
  const variantId = '00000000-0000-4000-8000-000000000090';
  await page.route('**/api/v1/inventory**', (r) =>
    r.fulfill({
      json: {
        ok: true,
        warehouse: {
          id: '00000000-0000-4000-8000-000000000030',
          name: 'Склад',
        },
        totals: { onHand: 1, available: 1, quarantine: 0 },
        items: [
          {
            id: variantId,
            productId: null,
            productName: null,
            article: null,
            name: 'Джинсы прямые',
            size: '48',
            color: 'Синий',
            gtins: ['04660430764543'],
            onHand: 1,
            available: 1,
            quarantine: 0,
            reserved: 0,
            defective: 0,
          },
        ],
        hasMore: false,
      },
    }),
  );
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/v1/marking/**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (r.request().method() === 'POST') {
      commands.push(r.request().postDataJSON() as Record<string, unknown>);
      if (commands.length === 1) return r.abort('failed');
      return r.fulfill({
        json: {
          ok: true,
          replayed: true,
          result: { shipmentId: '00000000-0000-4000-8000-000000000050' },
        },
      });
    }
    const data = path.endsWith('integrations')
      ? {
          avitoConfigured: true,
          signerConfigured: true,
          documentsEnabled: false,
          avitoWritesEnabled: false,
          seller_configured: true,
          chz_authorized: true,
          signer_online: true,
          signer_last_seen_at: null,
          certificate_expires_at: null,
        }
      : path.endsWith('overview')
        ? { packed: 0, ready: 0, issues: 0, pending: 0, calendar_days: 40 }
        : [];
    return r.fulfill({ json: { data } });
  });
  await page
    .getByRole('button', { name: `Открыть заказ ${firstId}`, exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Взять заказ в работу', exact: true })
    .click();
  await page
    .getByRole('combobox', {
      name: 'Вариант на складе — только при первом сопоставлении',
      exact: true,
    })
    .click();
  await page.getByRole('option').filter({ hasText: '48' }).click();
  await page
    .getByRole('button', { name: 'Взять в работу', exact: true })
    .click();
  await expect.poll(() => commands.length).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Взять в работу', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Взять в работу', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Очередь упаковки', exact: true }),
  ).toBeVisible();
  expect(commands[0]).toEqual(commands[1]);
  expect(commands[0]).toEqual({
    requestId: expect.any(String),
    externalOrderId: firstId,
    mappings: [{ externalItemId: '123456789', variantId }],
  });
});
