import { expect, test } from "@playwright/test";

test("home links to the listening page", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Visual studio chord v2" })).toBeVisible();
  await page.getByRole("link", { name: "試聴比較" }).click();
  await expect(page.getByRole("heading", { name: "試聴比較" })).toBeVisible();
});

test("listening page lists the fixed set and loads the first render", async ({ page }) => {
  await page.goto("./listen/");
  await expect(page.getByRole("navigation", { name: "ケース" }).getByRole("button")).toHaveCount(12);
  await expect(page.getByRole("heading", { name: "ポップ · C メジャー" })).toBeVisible();
  // A loaded render has a length; an unloaded one reads 0:00.
  await expect(page.locator(".clock")).toHaveText("0:00 / 0:34");
  await expect(page.getByRole("button", { name: "再生" })).toBeEnabled();
});

test("choosing another case loads its render", async ({ page }) => {
  await page.goto("./listen/");
  await page.getByRole("button", { name: /ジャズ · B♭ メジャー/ }).click();
  await expect(page.getByRole("heading", { name: "ジャズ · B♭ メジャー" })).toBeVisible();
  await expect(page.locator(".clock")).toHaveText("0:00 / 0:51");
});
