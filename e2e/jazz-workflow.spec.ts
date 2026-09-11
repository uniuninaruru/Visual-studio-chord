import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  const skip = page.getByRole("button", { name: "スキップ" });
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByRole("button", { name: "この設定で生成", exact: true })).toBeVisible();
}

test("fresh jazz profiles generate, blues keeps a 12-bar grid, and JSON preserves the contract", async ({ page }) => {
  await openApp(page);

  const settings = page.getByLabel("生成設定");
  const jazzStyle = settings.getByRole("combobox", { name: "ジャズスタイル" });
  const jazzForm = settings.getByRole("combobox", { name: "ジャズフォーム" });
  const bars = settings.getByRole("combobox", { name: "小節数" });
  const generate = settings.getByRole("button", { name: "この設定で生成", exact: true });

  await expect(jazzStyle).toHaveValue("swing");
  await expect(jazzForm).toHaveValue("aaba");

  for (const profile of ["swing", "ballad", "bebop", "modern", "neoSoul"]) {
    await jazzStyle.selectOption(profile);
    await expect(jazzStyle).toHaveValue(profile);
    await generate.click();
    await expect(page.getByText("同じシードで再現できる新しい曲を生成しました。")).toBeVisible();
  }

  await jazzForm.selectOption("blues");
  await expect(bars).toHaveValue("12");
  await expect(settings).toContainText("12小節ブルース");
  await generate.click();
  await expect(page.locator(".workspace-header")).toContainText("12 bars");

  const status = page.getByLabel("現在のアプリ状態");
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(status).toContainText(/Playing · Bar \d+/);
  await page.getByRole("button", { name: "停止", exact: true }).click();

  await page.getByRole("button", { name: "書き出し", exact: true }).click();
  const exportPanel = page.locator("#export-panel");
  await expect(exportPanel).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await exportPanel.getByRole("button", { name: "JSON 編集データ", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const document = JSON.parse(await readFile(downloadPath!, "utf8")) as {
    composition: {
      settings: { style: string; bars: number; jazz?: unknown };
      bars: unknown[];
      totalTicks: number;
      ticksPerBar: number;
    };
  };
  expect(document.composition.settings.style).toBe("jazz");
  expect(document.composition.settings.bars).toBe(12);
  expect(document.composition.settings.jazz).toEqual({
    version: 1,
    style: "neoSoul",
    form: "blues",
    chromaticism: 0.35,
    interaction: 0.6,
  });
  expect(document.composition.bars).toHaveLength(12);
  expect(document.composition.totalTicks).toBe(document.composition.ticksPerBar * 12);

  // Switching is explicit in both directions. In particular, a legacy
  // project whose generic style is already "jazz" must still have a reliable
  // button to opt into the dedicated settings block.
  await settings.getByRole("button", { name: /旧プリセット/ }).click();
  await expect(jazzStyle).toBeHidden();
  await expect(settings.getByRole("combobox", { name: "スタイル" })).toHaveValue("jazz");
  await settings.getByRole("button", { name: /ジャズ生成へ切り替え/ }).click();
  await expect(jazzStyle).toBeVisible();
});
