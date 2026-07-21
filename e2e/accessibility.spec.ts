import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

interface CompactViolation {
  id: string;
  impact: string | null;
  targets: string[][];
}

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    // The piano-roll notes are precision canvas controls. Their equivalent
    // keyboard path and editable values are exposed through the Inspector.
    .exclude(".piano-note")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations: CompactViolation[] = results.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    }));
  expect(violations).toEqual([]);
}

test("first-use, workspace, and diagnostics have no serious automated WCAG violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: /サンプル曲から始められます/ })).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByRole("button", { name: "スキップ" }).click();
  await expect(page.getByRole("button", { name: "この設定で生成" })).toBeVisible();
  await expectNoSeriousViolations(page);

  const firstNote = page.locator(".piano-note").first();
  await expect(firstNote).toHaveAttribute("aria-label", /小節目、長さ\d+ tick/);
  await firstNote.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("インスペクター").getByRole("heading", { name: "ノート" })).toBeVisible();

  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "環境診断" })).toBeVisible();
  await expectNoSeriousViolations(page);
});
