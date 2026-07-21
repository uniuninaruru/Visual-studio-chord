import { expect, test } from "@playwright/test";

const SHARED_TOKEN =
  process.env.MTC_LAN_E2E_TOKEN ?? "lan_e2e_token_1234567890abcdef";
const SESSION_KEY = "music-theory-composer:lan-access";

test("authenticated LAN session works through the proxy on a 390px screen", async ({ page }) => {
  await page.goto(`/#access=${SHARED_TOKEN}`);

  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  await expect.poll(() => page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    SESSION_KEY,
  )).toBe(SHARED_TOKEN);

  const skip = page.getByRole("button", { name: "スキップ" });
  if (await skip.isVisible()) await skip.click();

  const status = page.getByLabel("現在のアプリ状態");
  await expect(status).toContainText("Local server connected", { timeout: 15_000 });
  await expect(status).toContainText("Local CPU");

  await page.getByRole("button", { name: "生成設定", exact: true }).click();
  const settings = page.getByLabel("生成設定");
  await expect(settings).toHaveClass(/mobile-open/);
  await settings.getByRole("button", { name: "この設定で生成" }).click();
  await expect(page.getByText("同じシードで再現できる新しい曲を生成しました。")).toBeVisible();
  await settings.getByRole("button", { name: "閉じる", exact: true }).click();

  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(status).toContainText(/Playing · Bar \d+/);
  await page.keyboard.press("Space");
  await expect(status).toContainText(/Paused · Bar \d+/);

  await page.locator(".chord-content").first().click();
  const rankResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/rank") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "選択範囲を再生成" }).click();
  const rankResponse = await rankResponsePromise;

  expect(rankResponse.status()).toBe(200);
  expect(await rankResponse.request().headerValue("x-mtc-token")).toBe(SHARED_TOKEN);
  await expect(page.locator("article[data-candidate='A']")).toBeVisible();
  await expect(status).toContainText(/Local CPU|Local MOCK|Local server connected/);
});
