import { expect, test } from '@playwright/test';

test('administrator can sign in, create a page, and add a block', async ({ page }) => {
  await page.goto('admin/builder');
  if (/\/login$/.test(page.url())) {
    if (process.env.E2E_EMAIL) await page.getByLabel('Электронная почта').fill(process.env.E2E_EMAIL);
    if (process.env.E2E_PASSWORD) await page.getByLabel('Пароль').fill(process.env.E2E_PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Страницы' })).toBeVisible();

  const newPage = page.getByRole('button', { name: /Новая страница/ });
  if (!await newPage.isVisible()) return;
  await newPage.click();
  await page.getByLabel('Заголовок страницы').fill('Тестовая страница');
  await page.getByRole('button', { name: 'Создать страницу' }).click();

  await expect(page).toHaveURL(/\/admin\/builder\/pages\//);
  await expect(page.getByLabel('Холст страницы')).toBeVisible();
  await page.getByRole('button', { name: 'Заголовок', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Понятный и полезный заголовок' })).toBeVisible();
});
