import { expect, test } from '@playwright/test';

test('requests opening through Telegram and hides protected modules', async ({
  page,
}) => {
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  );
  await page.goto('/');
  await expect(page.getByText('Откройте приложение из Telegram')).toBeVisible();
  await expect(page.getByRole('button', { name: /Упаковка/ })).toHaveCount(0);
});

test('shows modules after server verification', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Telegram = { WebApp: { initData: "test-data", ready() {}, expand() {} } };',
    }),
  );
  await page.route('**/api/v1/auth/telegram/verify', (route) =>
    route.fulfill({
      json: { user: { id: 'test', displayName: 'Владелец', roles: ['OWNER'] } },
    }),
  );
  await page.goto('/');
  await expect(page.getByText('Доступ подтверждён')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(nav.locator('.v-list-item')).toHaveCount(4);
  await expect(
    page.getByRole('button', { name: 'Приёмка', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Остатки', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Журнал приёмки', exact: true }),
  ).toBeVisible();
  await nav.getByText('Продажи', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Заказы', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Упаковка', exact: true }),
  ).toBeVisible();
});

test('explains missing access and hides modules', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Telegram = { WebApp: { initData: "test-data", ready() {}, expand() {} } };',
    }),
  );
  await page.route('**/api/v1/auth/telegram/verify', (route) =>
    route.fulfill({ status: 403, json: { code: 'USER_NOT_ALLOWED' } }),
  );
  await page.goto('/');
  await expect(page.getByText(/Доступ пока не выдан/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Упаковка/ })).toHaveCount(0);
});
