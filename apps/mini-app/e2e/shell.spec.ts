import { expect, test } from '@playwright/test';

test('shows the operational shell', async ({ page }) => {
  await page.route(
    'https://telegram.org/js/telegram-web-app.js*',
    async (route) => {
      await route.fulfill({ contentType: 'application/javascript', body: '' });
    },
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Добрый день' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Начать смену' }),
  ).toBeVisible();
  await expect(page.getByText('Упаковка')).toBeVisible();
});
