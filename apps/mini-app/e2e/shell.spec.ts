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
  await expect(
    page
      .getByRole('navigation', { name: 'Основная навигация' })
      .locator('.v-list-item')
      .filter({ hasText: 'Заказы' }),
  ).toHaveAttribute('aria-disabled', 'false');
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
