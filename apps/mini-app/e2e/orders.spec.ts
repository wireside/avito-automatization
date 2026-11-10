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
    if (u.pathname.endsWith('/actions'))
      return route.fulfill({ json: { writesEnabled: true, operations: [] } });
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
      page.getByRole('button', { name: 'Собрать заказ', exact: true }),
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
    .getByRole('button', { name: 'Собрать заказ', exact: true })
    .click();
  await page
    .getByRole('combobox', {
      name: 'Вариант на складе — только при первом сопоставлении',
      exact: true,
    })
    .click();
  await page.getByRole('option').filter({ hasText: '48' }).click();
  await page
    .getByRole('button', { name: 'Начать сборку', exact: true })
    .click();
  await expect.poll(() => commands.length).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Начать сборку', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Начать сборку', exact: true })
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

for (const width of [320, 390, 430, 1512]) {
  test(`order toolbar has real spacing and mobile navigation uniform contrast at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 932 });
    await setup(page);
    await page
      .getByRole('button', { name: `Открыть заказ ${firstId}`, exact: true })
      .click();
    const toolbar = page.getByTestId('order-toolbar');
    await expect(toolbar.locator('button')).toHaveCount(2);
    const buttons = await toolbar.locator('button').all();
    const boxes = await Promise.all(buttons.map((b) => b.boundingBox()));
    expect(boxes.length).toBe(2);
    const [a, b] = boxes;
    expect(
      a && b && (b.x >= a.x + a.width + 8 || b.y >= a.y + a.height + 8),
    ).toBeTruthy();
    if (width < 960) {
      const nav = page.locator('.mobile-navigation');
      const colours = await nav.locator('.v-btn').evaluateAll((elements) =>
        elements.map((el) => ({
          color: getComputedStyle(el).color,
          opacity: getComputedStyle(el).opacity,
          icon: getComputedStyle(el.querySelector('.design-icon')!)
            .backgroundColor,
          mask: getComputedStyle(el.querySelector('.design-icon')!).maskImage,
        })),
      );
      expect(new Set(colours.map((c) => c.color)).size).toBe(1);
      expect(new Set(colours.map((c) => c.icon)).size).toBe(1);
      expect(colours.every((c) => c.opacity === '1')).toBe(true);
      expect(
        await nav
          .locator('.design-icon')
          .evaluateAll((els) =>
            els.every((el) => getComputedStyle(el).maskImage !== 'none'),
          ),
      ).toBe(true);
      await expect(nav.locator('.v-btn--active')).toHaveCount(1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/avito-review/order-detail-${width}.png`,
      fullPage: true,
    });
  });
}
test('confirms a real order through our durable action API and reuses UUID after a lost response', async ({
  page,
}) => {
  await setup(page);
  const commands: unknown[] = [];
  let queued = false;
  await page.route('**/api/v1/orders/*/actions', async (route) => {
    if (route.request().method() === 'POST') {
      commands.push(route.request().postDataJSON());
      if (commands.length === 1) return route.abort('failed');
      queued = true;
      return route.fulfill({
        json: {
          operationId: '00000000-0000-4000-8000-000000000123',
          replayed: true,
        },
      });
    }
    return route.fulfill({
      json: {
        writesEnabled: true,
        operations: queued
          ? [
              {
                id: '00000000-0000-4000-8000-000000000123',
                action: 'confirm',
                status: 'PENDING',
                errorCode: null,
                createdAt: new Date().toISOString(),
                labelReady: false,
              },
            ]
          : [],
      },
    });
  });
  await page
    .getByRole('button', { name: `Открыть заказ ${firstId}`, exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Подтвердить заказ · обязательно',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', { name: 'Подтвердить', exact: true })
    .click();
  await expect(dialog.getByText(/Нет ответа сервера/)).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Повторить запрос', exact: true })
    .click();
  await expect(
    page.getByText('Подтвердить заказ · В очереди', { exact: true }),
  ).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[0]).toEqual(commands[1]);
  expect(commands[0]).toEqual({
    requestId: expect.any(String),
    action: 'confirm',
    data: {},
  });
});
test('keeps provider writes disabled on screen when the backend flag is off', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/v1/orders/*/actions', (route) =>
    route.fulfill({ json: { writesEnabled: false, operations: [] } }),
  );
  await page
    .getByRole('button', { name: `Открыть заказ ${firstId}`, exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Подтвердить заказ · обязательно',
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      'Отправка действий в Авито выключена владельцем на сервере.',
      { exact: true },
    ),
  ).toBeVisible();
});

test('sends tracking, return routing, courier interval and label requests through the same order card', async ({
  page,
}) => {
  await setup(page);
  await page.route(`**/api/v1/orders/${firstId}`, (route) =>
    route.fulfill({
      json: {
        ok: true,
        order: {
          ...order(),
          availableActions: [
            { name: 'setTrackNumber', required: true },
            { name: 'acceptReturnOrder', required: false },
          ],
        },
        fetchedAt: new Date().toISOString(),
        mode: 'read_only',
      },
    }),
  );
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/v1/orders/*/actions', (route) => {
    if (route.request().method() === 'POST') {
      commands.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        json: {
          operationId: '00000000-0000-4000-8000-000000000123',
          replayed: false,
        },
      });
    }
    return route.fulfill({ json: { writesEnabled: true, operations: [] } });
  });
  const interval = {
    date: '2026-11-12T00:00:00Z',
    timeIntervals: [
      {
        startDate: '2026-11-12T10:00:00Z',
        endDate: '2026-11-12T12:00:00Z',
        title: '10:00–12:00',
        type: 'fixed',
      },
    ],
  };
  await page.route('**/api/v1/orders/*/courier-options', (route) =>
    route.fulfill({
      json: {
        address: 'Адрес склада',
        name: 'Иван Иванов',
        phone: '+79999999999',
        dateOptions: [interval],
      },
    }),
  );
  await page
    .getByRole('button', { name: `Открыть заказ ${firstId}`, exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Указать трек-номер · обязательно',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Трек-номер', exact: true })
    .fill('TRACK-NEW');
  await dialog
    .getByRole('button', { name: 'Подтвердить', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(commands[0]).toMatchObject({
    action: 'setTrackNumber',
    data: { trackingNumber: 'TRACK-NEW' },
  });
  await page
    .getByRole('button', {
      name: 'Выбрать отделение для возврата',
      exact: true,
    })
    .click();
  await dialog
    .getByRole('textbox', { name: 'Индекс отделения Почты России' })
    .fill('123456');
  await dialog
    .getByRole('textbox', { name: 'ФИО получателя' })
    .fill('Иван Иванов');
  await dialog
    .getByRole('textbox', { name: 'Телефон с кодом страны' })
    .fill('+79999999999');
  await dialog
    .getByRole('button', { name: 'Подтвердить', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(commands[1]).toMatchObject({
    action: 'acceptReturnOrder',
    data: {
      terminalNumber: '123456',
      name: 'Иван Иванов',
      phone: '+79999999999',
    },
  });
  await page
    .getByRole('button', { name: 'Вызвать курьера', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Показать время курьера' }).click();
  await expect(
    dialog.getByRole('combobox', { name: 'Время приезда' }),
  ).toBeEnabled();
  await dialog.locator('.v-select .v-field').click();
  await page.getByRole('option').first().click();
  await dialog
    .getByRole('button', { name: 'Подтвердить', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(commands[2]).toMatchObject({
    action: 'setCourierDeliveryRange',
    data: {
      address: 'Адрес склада',
      name: 'Иван Иванов',
      phone: '+79999999999',
      startDate: interval.timeIntervals[0]!.startDate,
      endDate: interval.timeIntervals[0]!.endDate,
      intervalType: 'fixed',
    },
  });
  await page.getByRole('button', { name: 'Этикетка PDF', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Подтвердить', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(commands[3]).toMatchObject({ action: 'label', data: {} });
});
