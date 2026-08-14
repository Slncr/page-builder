import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const publicPath = process.env.E2E_PUBLIC_PATH ?? "/";

test("public page renders without serious axe violations", async ({ page }) => {
  const response = await page.goto(publicPath, { waitUntil: "domcontentloaded" });

  expect(response, `No document response for ${publicPath}`).not.toBeNull();
  expect(response!.status(), `Unexpected status for ${publicPath}`).toBeLessThan(
    500,
  );
  await expect(page.locator("body")).toBeVisible();

  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const blockingViolations = scan.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );

  expect(
    blockingViolations,
    JSON.stringify(blockingViolations, null, 2),
  ).toEqual([]);
});
