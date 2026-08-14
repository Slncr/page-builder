import { expect, test } from "@playwright/test";

const gatewayBaseUrl = process.env.E2E_GATEWAY_BASE_URL;

test("integrated gateway exposes the prefixed UI and API", async ({ request }) => {
  test.skip(!gatewayBaseUrl, "Set E2E_GATEWAY_BASE_URL for gateway integration");

  const redirect = await request.get(
    new URL("/page-builder", gatewayBaseUrl).toString(),
    { maxRedirects: 0 },
  );
  expect(redirect.status()).toBe(308);
  expect(redirect.headers().location).toBe("/page-builder/");

  const ui = await request.get(
    new URL("/page-builder/", gatewayBaseUrl).toString(),
  );
  expect(ui.status()).toBeLessThan(500);
  expect(await ui.text()).toContain('<div id="root"></div>');

  const api = await request.get(
    new URL(
      "/api/page-builder/v1/public/resolve?path=%2F",
      gatewayBaseUrl,
    ).toString(),
  );
  expect(api.status()).toBe(200);
  expect(api.headers()["content-type"] ?? "").toContain("application/json");
});
