import { expect, test, type Page } from "@playwright/test";

async function openApp(page: Page, expectDesktopSettings = true): Promise<void> {
  await page.goto("/");
  const skip = page.getByRole("button", { name: "スキップ" });
  if (await skip.isVisible()) await skip.click();
  if (expectDesktopSettings) {
    await expect(page.getByRole("button", { name: "この設定で生成" })).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: "生成設定", exact: true })).toBeVisible();
  }
}

test("first-use path generates, plays, previews, adopts, and undoes without a server", async ({ page }) => {
  await openApp(page);
  const status = page.getByLabel("現在のアプリ状態");
  await expect(status).toContainText("Stopped · Bar 1");
  await expect(status).toContainText("Browser mode", { timeout: 5_000 });

  await page.getByRole("button", { name: "この設定で生成" }).click();
  await expect(page.getByText("同じシードで再現できる新しい曲を生成しました。")).toBeVisible();

  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(status).toContainText(/Playing · Bar \d+/);
  await page.keyboard.press("Space");
  await expect(status).toContainText(/Paused · Bar \d+/);

  await page.locator(".chord-content").first().click();
  await expect(status).toContainText("1–1 小節ループ");
  await page.getByRole("button", { name: "選択範囲を再生成" }).click();
  await expect(page.locator("article[data-candidate='A']")).toBeVisible();
  await expect(page.locator("article[data-candidate='C']")).toBeVisible();

  const candidateA = page.locator("article[data-candidate='A']");
  await candidateA.getByRole("button", { name: "Like", exact: true }).click();
  await expect(page.getByText(/Like を記録しました/)).toBeVisible();
  await candidateA.getByRole("button", { name: "この候補を採用" }).click();
  await expect(page.getByText(/候補 A を採用し、履歴へ保存しました/)).toBeVisible();

  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText(/Undoしました/)).toBeVisible();
});

test("offline and API mismatch states preserve browser editing", async ({ page, context }) => {
  await page.route("**/api/health", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ apiVersion: "2", requestId: "mismatch", status: "ok" }),
  }));
  await page.route("**/api/device", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ apiVersion: "1", requestId: "device" }),
  }));
  await page.route("**/api/models", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ apiVersion: "1", requestId: "models" }),
  }));
  await openApp(page);

  const status = page.getByLabel("現在のアプリ状態");
  await expect(status).toContainText("API mismatch · Browser mode");
  await context.setOffline(true);
  await expect(status).toContainText("Offline · API mismatch · Browser mode");
  await page.getByRole("button", { name: "この設定で生成" }).click();
  await expect(page.getByText("同じシードで再現できる新しい曲を生成しました。")).toBeVisible();
});

test("pending structural edits keep the audible meter, tempo, and loop visible", async ({ page }) => {
  await openApp(page);
  const status = page.getByLabel("現在のアプリ状態");

  // By the bar, not by counting chords. A bar holds however many chords the
  // harmonic rhythm gives it -- the shipped defaults put two in some bars --
  // so the seventh chord button and the seventh bar stopped being the same
  // thing, and this test was quietly asserting one chord per bar.
  await page.locator('.chord-cell[data-bar="6"] .chord-content').first().click();
  await expect(status).toContainText("7–7 小節ループ");
  await page.getByLabel("編集反映タイミング").selectOption("nextLoop");
  await page.getByRole("button", { name: "再生", exact: true }).click();

  await page.getByLabel("BPM").fill("180");
  await page.getByLabel("拍子").selectOption("3/4");
  await page.getByLabel("小節数").selectOption("4");
  await page.getByRole("button", { name: "この設定で生成" }).click();

  await expect(page.locator(".readout-meta")).toHaveText("120 BPM");
  await expect(status).toContainText("Edited · Apply at next loop");
  await expect(status).toContainText("Loop7–7 小節ループ");
  await expect(status).toContainText("Pending loop: 全体ループ");
  await expect(page.locator(".workspace-header")).toContainText("3/4 · 4 bars");
});

test("diagnostics is keyboard-dismissible and narrow screens retain primary controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, false);

  await expect(page.getByRole("button", { name: "再生", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成設定", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "生成設定", exact: true }).click();
  await expect(page.getByLabel("生成設定")).toHaveClass(/mobile-open/);
  await page.getByRole("button", { name: "閉じる", exact: true }).first().click();

  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "環境診断" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "環境診断" })).toBeHidden();
});
