import { expect, test, type Page } from "@playwright/test";

async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  const skip = page.getByRole("button", { name: "スキップ" });
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByRole("button", { name: "4つのパーツを作る", exact: true })).toBeVisible();
}

test("builds, assembles, selects, and undoes a repeated section arrangement", async ({ page }) => {
  await openApp(page);

  await page.getByRole("button", { name: "4つのパーツを作る", exact: true }).click();
  const intro = page.getByTestId("section-source-source-intro");
  await expect(intro).toBeVisible();
  await intro.getByRole("combobox", { name: "Introの小節数" }).selectOption("16");
  await expect(intro).toContainText("未反映");
  await intro.getByRole("button", { name: "この設定で生成", exact: true }).click();
  await expect(intro).toContainText("生成済み");

  const aInstance = page.locator(".section-instance-card").filter({ hasText: "Aメロ" }).first();
  await aInstance.getByRole("button", { name: "Aをくり返す", exact: true }).click();

  // Keep an eight-bar section before A so the requested 1200px scroll exposes
  // an A-melo segment while the Intro remains the edited 16-bar source.
  const bInstance = page.locator(".section-instance-card").filter({ hasText: "Bメロ" }).first();
  await bInstance.getByRole("button", { name: "Bを左へ移動", exact: true }).click();
  await page.locator(".section-instance-card").filter({ hasText: "Bメロ" }).first()
    .getByRole("button", { name: "Bを左へ移動", exact: true }).click();
  const introInstance = page.locator(".section-instance-card").filter({ hasText: "Intro" }).first();
  await introInstance.getByRole("button", { name: "Introを右へ移動", exact: true }).click();
  await page.locator(".section-instance-card").filter({ hasText: "Intro" }).first()
    .getByRole("button", { name: "Introを右へ移動", exact: true }).click();
  await expect(page.getByText("合計 48 / 128 小節").first()).toBeVisible();

  await page.locator(".section-join-control").first().getByRole("combobox").selectOption("direct");
  await page.getByRole("button", { name: "1曲にまとめる", exact: true }).click();

  await expect(page.locator(".workspace-header")).toContainText("48 bars");
  await expect(page.locator(".chord-cell")).toHaveCount(48);
  await expect(page.getByTestId("section-ruler").getByRole("button")).toHaveCount(5);
  await expect(page.locator(".section-resolved-link").first()).toBeVisible();
  await expect(page.locator(".section-resolved-link").first()).toContainText("そのまま自然につなぐ");

  await page.setViewportSize({ width: 390, height: 844 });
  const lane = page.locator(".chord-lane-section");
  await lane.scrollIntoViewIfNeeded();
  await lane.evaluate((element) => {
    element.scrollLeft = 1200;
  });
  expect(await lane.evaluate((element) => element.scrollLeft)).toBe(1200);
  await expect(page.getByRole("heading", { name: "完成曲の構成" })).toBeVisible();
  const laneBox = await lane.boundingBox();
  expect(laneBox).not.toBeNull();
  const headingContentBox = await page.locator(".section-ruler-heading-content").boundingBox();
  expect(headingContentBox).not.toBeNull();
  if (laneBox && headingContentBox) {
    expect(headingContentBox.x).toBeGreaterThanOrEqual(laneBox.x);
    expect(headingContentBox.x + headingContentBox.width).toBeLessThanOrEqual(laneBox.x + laneBox.width);
  }
  const aSegments = page.getByTestId("section-ruler").getByRole("button", { name: /Aメロ/ });
  let visibleAIndex = -1;
  for (let index = 0; index < await aSegments.count(); index += 1) {
    const box = await aSegments.nth(index).boundingBox();
    if (box && laneBox && box.x + box.width > laneBox.x && box.x < laneBox.x + laneBox.width) {
      visibleAIndex = index;
      break;
    }
  }
  expect(visibleAIndex).toBeGreaterThanOrEqual(0);
  const visibleAContentBox = await aSegments.nth(visibleAIndex).locator(".section-ruler-segment-content").boundingBox();
  expect(visibleAContentBox).not.toBeNull();
  if (laneBox && visibleAContentBox) {
    expect(visibleAContentBox.x).toBeGreaterThanOrEqual(laneBox.x);
    expect(visibleAContentBox.x + visibleAContentBox.width).toBeLessThanOrEqual(laneBox.x + laneBox.width);
  }
  const bodyWidth = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(bodyWidth.body).toBe(bodyWidth.viewport);

  const repeatedSection = page.getByTestId("section-ruler").getByRole("button", { name: /Aメロ/ }).last();
  await repeatedSection.click();
  await expect(page.locator(".selection-summary")).toContainText("33〜40小節を選択中");
  await expect(page.locator(".loop-readout")).toContainText("33–40 小節ループ");

  await page.setViewportSize({ width: 1280, height: 844 });
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.locator(".workspace-header")).toContainText("8 bars");
  await expect(page.locator(".section-arrangement-summary").getByText("まだ1曲にまとめていません")).toBeVisible();
});
