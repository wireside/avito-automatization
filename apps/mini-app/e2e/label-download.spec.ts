import { test, expect } from '@playwright/test';
import { labelDownloadPage } from '../../backend/src/http/label-download-page.js';
test('external label page downloads PDF via POST without exposing ticket in requests', async ({
  page,
}) => {
  const ticket = 'encrypted-fixture';
  await page.route('**/avito/label', (r) =>
    r.fulfill({
      contentType: 'text/html; charset=utf-8',
      headers: { 'content-security-policy': labelDownloadPage.csp },
      body: labelDownloadPage.html,
    }),
  );
  await page.route('**/api/v1/avito-label/download', (r) => {
    expect(r.request().method()).toBe('POST');
    expect(r.request().url()).not.toContain(ticket);
    expect(r.request().postDataJSON()).toEqual({ ticket });
    return r.fulfill({
      contentType: 'application/pdf',
      body: Buffer.from('%PDF-fixture'),
    });
  });
  await page.goto('/avito/label#' + ticket);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать PDF', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('avito-label.pdf');
  await expect(
    page.getByText('Загрузка PDF запрошена.', { exact: false }),
  ).toBeVisible();
});
test('external label page explains expired tickets and permits retry', async ({
  page,
}) => {
  await page.route('**/avito/label', (r) =>
    r.fulfill({ contentType: 'text/html', body: labelDownloadPage.html }),
  );
  await page.route('**/api/v1/avito-label/download', (r) =>
    r.fulfill({ status: 401 }),
  );
  await page.goto('/avito/label#expired');
  await page.getByRole('button', { name: 'Скачать PDF', exact: true }).click();
  await expect(
    page.getByText('Вернитесь в заказ и получите новую ссылку.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скачать PDF' })).toBeEnabled();
});
