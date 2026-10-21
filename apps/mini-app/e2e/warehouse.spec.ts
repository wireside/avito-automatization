import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
const gtin = '04660430764543';
const raw = `01${gtin}21TEST000000001\u001d91ABCD\u001d92${'A'.repeat(44)}`;
const unit = {
  id: 'unit-1',
  internalCode: 'U-1234',
  variantId: 'variant-1',
  name: 'Товар ' + gtin,
  maskedCode: gtin + ' · •••0001',
  state: 'QUARANTINE',
  location: 'Приёмка',
  receiptId: 'receipt-1',
  receiptNumber: 'SCAN-test',
  receivedAt: '2026-10-20T12:00:00Z',
};
async function telegram(page: Page, roles = ['OWNER']) {
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Telegram={WebApp:{initData:"test-data",ready(){},expand(){}}}',
    }),
  );
  await page.route('**/api/v1/auth/telegram/verify', (route) =>
    route.fulfill({
      json: { user: { id: 'test', displayName: 'Владелец', roles } },
    }),
  );
}
function pageData(count: number) {
  return {
    ok: true,
    warehouse: { id: 'warehouse', name: 'Основной склад' },
    totals: { onHand: count, available: 0, quarantine: count },
    items: count
      ? [
          {
            id: 'variant-1',
            productId: null,
            productName: null,
            article: null,
            name: 'Товар ' + gtin,
            color: null,
            size: null,
            gtins: [gtin],
            reviewStatus: 'UNRESOLVED',
            onHand: count,
            available: 0,
            quarantine: count,
            reserved: 0,
            defective: 0,
          },
        ]
      : [],
    hasMore: false,
  };
}
test('USB scan is saved, displayed, deduplicated and remains visible after reload', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await telegram(page);
  let count = 0;
  let calls = 0;
  await page.route('**/api/v1/inventory?*', (route) =>
    route.fulfill({ json: pageData(count) }),
  );
  await page.route('**/api/v1/inventory/variants/*/units?*', (route) =>
    route.fulfill({ json: { ok: true, items: [unit], hasMore: false } }),
  );
  await page.route('**/api/v1/inventory/receipts/scan', async (route) => {
    const body = route.request().postDataJSON() as {
      raw: string;
      requestId: string;
    };
    expect(body.raw).toBe(raw);
    expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(route.request().headers().authorization).toBe('tma test-data');
    const outcome = calls++ === 0 ? 'ACCEPTED' : 'DUPLICATE';
    count = 1;
    await route.fulfill({
      status: outcome === 'ACCEPTED' ? 201 : 200,
      json: { ok: true, outcome, unit, replayed: false },
    });
  });
  await page.goto('/');
  await expect(page.getByText('На складе пока пусто')).toBeVisible();
  const input = page.getByLabel('USB-сканер или строка DataMatrix');
  await input.fill(raw);
  await input.press('Enter');
  await expect(
    page.getByText('Товар добавлен на склад', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('1 шт.')).toBeVisible();
  await expect(input).toHaveValue('');
  await input.fill(raw);
  await input.press('Tab');
  await expect(
    page.getByText('Этот товар уже добавлен', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('1 шт.')).toBeVisible();
  await page.getByRole('button', { name: 'Показать экземпляры' }).click();
  await expect(page.getByText('SCAN-test')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть экземпляры' }).click();
  await page.reload();
  await page.getByRole('tab', { name: 'Остатки', exact: true }).click();
  await expect(page.getByText('1 шт.')).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({
    path: testInfo.outputPath('warehouse-mobile.png'),
    fullPage: true,
  });
});
test('retries an ambiguous response with the same request ID', async ({
  page,
}) => {
  await telegram(page);
  let requestId = '';
  let calls = 0;
  await page.route('**/api/v1/inventory?*', (route) =>
    route.fulfill({ json: pageData(calls > 1 ? 1 : 0) }),
  );
  await page.route('**/api/v1/inventory/receipts/scan', async (route) => {
    const body = route.request().postDataJSON() as { requestId: string };
    if (calls++ === 0) {
      requestId = body.requestId;
      await route.abort('failed');
    } else {
      expect(body.requestId).toBe(requestId);
      await route.fulfill({
        json: { ok: true, outcome: 'ACCEPTED', unit, replayed: true },
      });
    }
  });
  await page.goto('/');
  const input = page.getByLabel('USB-сканер или строка DataMatrix');
  await input.fill(raw);
  await input.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Повторить отправку' }),
  ).toBeVisible();
  await expect(input).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить отправку' }).click();
  await expect(page.getByText('1 шт.')).toBeVisible();
});
test('read-only user can view stock without intake controls', async ({
  page,
}) => {
  await telegram(page, ['VIEWER']);
  await page.route('**/api/v1/inventory?*', (route) =>
    route.fulfill({ json: pageData(1) }),
  );
  await page.goto('/');
  await expect(page.getByText('1 шт.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Сканировать камерой' }),
  ).toHaveCount(0);
});
test('camera errors are explained without a false successful receipt', async ({
  page,
}) => {
  await telegram(page);
  await page.route('**/api/v1/inventory?*', (route) =>
    route.fulfill({ json: pageData(0) }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: () =>
          Promise.reject(new DOMException('Denied', 'NotAllowedError')),
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Сканировать камерой' }).click();
  await expect(page.getByText(/Не удалось открыть камеру/)).toBeVisible();
  await expect(
    page.getByText('Товар добавлен на склад', { exact: true }),
  ).toHaveCount(0);
});

test('camera decodes a GS1 DataMatrix frame and stops the stream after receipt', async ({
  page,
}) => {
  await telegram(page);
  let count = 0;
  await page.route('**/api/v1/inventory?*', (route) =>
    route.fulfill({ json: pageData(count) }),
  );
  await page.route('**/api/v1/inventory/receipts/scan', async (route) => {
    const body = route.request().postDataJSON() as {
      raw: string;
      scannerProfile: string;
    };
    expect(body.raw).toBe('\u001d' + raw);
    expect(body.scannerProfile).toBe('camera-gs1-v1');
    count = 1;
    await route.fulfill({
      status: 201,
      json: { ok: true, outcome: 'ACCEPTED', unit, replayed: false },
    });
  });
  const fixture = readFileSync(
    new URL('./fixtures/clothing-data-matrix.svg', import.meta.url),
  );
  await page.addInitScript(
    async (imageDataUrl) => {
      const image = new Image();
      image.src = imageDataUrl;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext('2d')!;
      const paint = () => {
        context.fillStyle = 'white';
        context.fillRect(0, 0, 640, 480);
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 156, 76, 328, 328);
      };
      paint();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: () => {
            const stream = canvas.captureStream(12);
            const redraw = () => {
              paint();
              if (
                stream.getTracks().some((track) => track.readyState === 'live')
              )
                requestAnimationFrame(redraw);
            };
            requestAnimationFrame(redraw);
            return Promise.resolve(stream);
          },
        },
      });
    },
    'data:image/svg+xml;base64,' + fixture.toString('base64'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Сканировать камерой' }).click();
  await expect(
    page.getByText('Товар добавлен на склад', { exact: true }),
  ).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText('1 шт.')).toBeVisible();
  await expect(page.getByLabel('Камера сканера')).toHaveCount(0);
});

for (const viewport of [
  { width: 393, height: 852 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1512, height: 982 },
  { width: 1728, height: 1117 },
]) {
  test(`SHTANISHKIN intake fits ${viewport.width}px and renders local design assets`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await telegram(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/v1/inventory?*', (route) =>
      route.fulfill({ json: pageData(1) }),
    );
    await page.route('**/api/v1/inventory/receipts/scan', (route) =>
      route.fulfill({
        status: 201,
        json: {
          ok: true,
          outcome: 'ACCEPTED',
          unit: { ...unit, name: 'Брюки Basic' },
          replayed: false,
        },
      }),
    );
    await page.goto('/');
    const input = page.getByLabel('USB-сканер или строка DataMatrix');
    await input.fill(raw);
    await input.press('Enter');
    await expect(page.getByTestId('scan-result')).toContainText(
      'Товар добавлен на склад',
    );
    await expect(page.getByTestId('scan-result')).toContainText('+1');
    await expect(input).toBeFocused();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.locator('body').evaluate((element) => element.scrollWidth),
    ).toBe(viewport.width);
    const assets = await page.locator('img').evaluateAll((images) =>
      images
        .filter(
          (image): image is HTMLImageElement =>
            image instanceof HTMLImageElement,
        )
        .map((image) => ({
          src: image.currentSrc,
          loaded: image.complete && image.naturalWidth > 0,
          width: image.width,
          expected: Number(image.getAttribute('width')),
          visible: image.getClientRects().length > 0,
        })),
    );
    for (const asset of assets.filter((asset) => asset.visible)) {
      expect(asset.src).not.toContain('figma.com');
      expect(asset.loaded).toBe(true);
      expect(asset.width).toBe(asset.expected);
    }
    const metrics = await page
      .locator('.text-headline-large')
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          font: style.fontFamily,
          size: style.fontSize,
          line: style.lineHeight,
          height:
            element.parentElement?.parentElement?.getBoundingClientRect()
              .height,
        };
      });
    expect(metrics.font).toContain('Inter');
    expect(metrics.size).toBe('30px');
    expect(metrics.line).toBe('36px');
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`intake-${viewport.width}.png`),
      fullPage: true,
    });
    await page.getByRole('tab', { name: 'Остатки', exact: true }).click();
    await expect(page.getByText('1 шт.', { exact: true })).toBeVisible();
    await expect(page.locator('body')).toHaveJSProperty(
      'scrollWidth',
      viewport.width,
    );
  });
}

test('search and pagination use HTTP parameters and preserve global totals', async ({
  page,
}) => {
  await telegram(page, ['VIEWER']);
  const requests: URL[] = [];
  await page.route('**/api/v1/inventory?*', (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    return route.fulfill({
      json: { ...pageData(1), hasMore: url.searchParams.get('offset') === '0' },
    });
  });
  await page.goto('/');
  await expect(page.getByText('1 шт.', { exact: true })).toBeVisible();
  await page.getByLabel('Поиск по складу').fill('чёрный M');
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect
    .poll(() => requests.at(-1)?.searchParams.get('search'))
    .toBe('чёрный M');
  await page.getByRole('button', { name: 'Следующие товары' }).click();
  await expect
    .poll(() => requests.at(-1)?.searchParams.get('offset'))
    .toBe('40');
  expect(requests.at(-1)?.searchParams.get('search')).toBe('чёрный M');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  // A fresh previous page is served from the Vue Query cache.
  await expect(
    page.getByRole('button', { name: 'Назад', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Поиск по складу')).toHaveValue('чёрный M');
  await page.getByRole('button', { name: 'Обновить склад' }).click();
  await expect
    .poll(() => requests.at(-1)?.searchParams.get('offset'))
    .toBe('0');
});

test('validation failure keeps the code and never shows a successful receipt', async ({
  page,
}) => {
  await telegram(page);
  await page.route('**/api/v1/inventory?*', (route) =>
    route.fulfill({ json: pageData(0) }),
  );
  await page.route('**/api/v1/inventory/receipts/scan', (route) =>
    route.fulfill({
      status: 422,
      json: {
        ok: false,
        code: 'INVALID_MARKING',
        message: 'Invalid marking',
        requestId: 'test-request',
      },
    }),
  );
  await page.goto('/');
  const input = page.getByLabel('USB-сканер или строка DataMatrix');
  await input.fill('invalid');
  await input.press('Enter');
  await expect(
    page.getByText('Не удалось добавить товар', { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue('invalid');
  await expect(input).toBeEnabled();
  await expect(page.getByTestId('scan-result')).toHaveCount(0);
});

test('USB keyboard FNC1 shortcut preserves GS bytes', async ({ page }) => {
  await telegram(page);
  await page.route('**/api/v1/inventory?*', (route) =>
    route.fulfill({ json: pageData(0) }),
  );
  let received = '';
  await page.route('**/api/v1/inventory/receipts/scan', (route) => {
    received = (route.request().postDataJSON() as { raw: string }).raw;
    return route.fulfill({
      status: 201,
      json: { ok: true, outcome: 'ACCEPTED', unit, replayed: false },
    });
  });
  await page.goto('/');
  const input = page.getByLabel('USB-сканер или строка DataMatrix');
  await input.fill('01' + gtin + '21TEST000000001');
  await input.press('End');
  await input.press('Control+]');
  await input.press('Enter');
  await expect.poll(() => received).toBe('01' + gtin + '21TEST000000001\u001d');
});

test('consecutive USB scans are queued without losing bytes or request identity', async ({
  page,
}) => {
  await telegram(page);
  await page.route('**/api/v1/inventory?*', (route) =>
    route.fulfill({ json: pageData(2) }),
  );
  const seen: { raw: string; requestId: string }[] = [];
  let releaseFirst: () => void = () => {};
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route('**/api/v1/inventory/receipts/scan', async (route) => {
    const input = route.request().postDataJSON() as {
      raw: string;
      requestId: string;
    };
    seen.push(input);
    const index = seen.length;
    if (index === 1) await firstResponse;
    await route.fulfill({
      status: 201,
      json: {
        ok: true,
        outcome: 'ACCEPTED',
        unit: { ...unit, id: `unit-${index}` },
        replayed: false,
      },
    });
  });
  await page.goto('/');
  const input = page.getByLabel('USB-сканер или строка DataMatrix');
  await input.fill(raw);
  await input.press('Enter');
  const second = raw.replace('TEST000000001', 'TEST000000002');
  await input.fill(second);
  await input.press('Enter');
  await expect(page.getByText(/В очереди: 2/)).toBeVisible();
  releaseFirst();
  await expect.poll(() => seen.length).toBe(2);
  expect(seen.map((scan) => scan.raw)).toEqual([raw, second]);
  expect(seen[0]?.requestId).not.toBe(seen[1]?.requestId);
  await expect(page.getByText('За эту сессию принято: 2')).toBeVisible();
  await expect(input).toHaveValue('');
});

test('confirms a committed receipt before a delayed stock refresh completes', async ({
  page,
}) => {
  await telegram(page);
  let reads = 0;
  let release: () => void = () => {};
  const refresh = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/inventory?*', async (route) => {
    const count = reads++;
    if (count > 0) await refresh;
    await route.fulfill({ json: pageData(count > 0 ? 1 : 0) });
  });
  await page.route('**/api/v1/inventory/receipts/scan', (route) =>
    route.fulfill({
      status: 201,
      json: { ok: true, outcome: 'ACCEPTED', unit, replayed: false },
    }),
  );
  await page.goto('/');
  await expect(page.getByText('На складе пока пусто')).toBeVisible();
  const input = page.getByLabel('USB-сканер или строка DataMatrix');
  await input.fill(raw);
  await input.press('Enter');
  await expect(page.getByTestId('scan-result')).toContainText(
    'Товар добавлен на склад',
  );
  await expect(page.getByTestId('scan-result')).toContainText('+1');
  release();
});

test('camera layout uses the design reticle and stops tracks when backgrounded', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await telegram(page);
  await page.route('**/api/v1/inventory?*', (route) =>
    route.fulfill({ json: pageData(0) }),
  );
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#232426';
    context.fillRect(0, 0, 640, 480);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: () => {
          const stream = canvas.captureStream(12);
          const redraw = () => {
            context.fillStyle = '#232426';
            context.fillRect(0, 0, 640, 480);
            if (
              stream.getTracks().some((track) => track.readyState === 'live')
            ) {
              requestAnimationFrame(redraw);
            }
          };
          requestAnimationFrame(redraw);
          Object.defineProperty(window, '__testCameraStream', {
            value: stream,
            configurable: true,
          });
          return Promise.resolve(stream);
        },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Сканировать камерой' }).click();
  await expect(page.getByLabel('Камера сканера')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & { __testCameraStream?: MediaStream }
          ).__testCameraStream?.getVideoTracks()[0]?.readyState,
      ),
    )
    .toBe('live');
  await expect(page.getByLabel('Открываем камеру')).toBeHidden();
  const reticle = page.locator('.camera-reticle img');
  await expect(reticle).toHaveAttribute('width', '242');
  await expect(reticle).toHaveAttribute('height', '264');
  await page.screenshot({
    path: testInfo.outputPath('camera-mobile.png'),
    fullPage: false,
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByLabel('Камера сканера')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (
        window as Window & { __testCameraStream?: MediaStream }
      ).__testCameraStream
        ?.getTracks()
        .every((track) => track.readyState === 'ended'),
    ),
  ).toBe(true);
});
