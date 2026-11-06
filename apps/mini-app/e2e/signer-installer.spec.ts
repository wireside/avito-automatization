import { test, expect } from '@playwright/test';
import { signerInstallPage } from '../../backend/src/http/signer-install-page.js';
test('installer landing page downloads using POST and never sends the ticket in its URL', async ({
  page,
}) => {
  const ticket = 'a'.repeat(43);
  await page.route('**/signer/install', (r) =>
    r.fulfill({
      contentType: 'text/html; charset=utf-8',
      headers: { 'content-security-policy': signerInstallPage.csp },
      body: signerInstallPage.html,
    }),
  );
  let sent: unknown;
  await page.route('**/api/v1/local-signer/install', (r) => {
    sent = r.request().postDataJSON() as unknown;
    expect(r.request().url()).not.toContain(ticket);
    expect(r.request().method()).toBe('POST');
    return r.fulfill({
      contentType: 'application/zip',
      body: Buffer.from([80, 75, 3, 4]),
    });
  });
  await page.goto('/signer/install#' + ticket);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать установщик' }).click();
  expect((await download).suggestedFilename()).toBe('AvitoSigner-Windows.zip');
  expect(sent).toEqual({ ticket });
  await expect(
    page.getByText('Распакуйте архив и запустите Установить.cmd.', {
      exact: false,
    }),
  ).toBeVisible();
});
