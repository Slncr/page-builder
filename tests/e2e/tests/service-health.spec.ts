import { expect, test } from "@playwright/test";

const apiBaseUrl =
  process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8000";
const healthPath = process.env.E2E_API_HEALTH_PATH ?? "/health/ready";

test("backend health endpoint is ready", async ({ request }) => {
  const response = await request.get(new URL(healthPath, apiBaseUrl).toString());

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"] ?? "").toContain(
    "application/json",
  );
});

test("editor shell can be enabled in authenticated environments", async ({
  page,
}) => {
  const editorPath = process.env.E2E_EDITOR_PATH;
  test.skip(!editorPath, "Set E2E_EDITOR_PATH to exercise the editor shell");

  const token = process.env.E2E_EDITOR_TOKEN;
  if (token) {
    await page.context().setExtraHTTPHeaders({
      Authorization: `Bearer ${token}`,
    });
  }

  const response = await page.goto(editorPath!, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator("body")).toBeVisible();
});
