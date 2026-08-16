import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WorkspaceTools, type WorkspaceTool } from "../src/features/editor/WorkspaceTools";

/**
 * Five tools as one region.
 *
 * They were five panels stacked in the centre column, every one permanently
 * expanded and never more than one in use, so a reader looking for the history
 * scrolled past four panels about something else. They are modes, so they are
 * tabs — and the two things a tab group has to get right here are that nothing
 * loses its state when it goes off screen, and that content arriving from
 * elsewhere on the page is not silently filed behind a tab nobody is on.
 */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function tools(overrides: Partial<Record<string, Partial<WorkspaceTool>>> = {}): WorkspaceTool[] {
  return [
    { id: "fix", label: "直す", render: () => <p>fix body</p>, ...overrides.fix },
    { id: "find", label: "探す", render: () => <input data-testid="query" />, ...overrides.find },
    { id: "compare", label: "比べる", render: () => <p>compare body</p>, ...overrides.compare },
  ];
}

const render = (list: WorkspaceTool[]) =>
  act(() => root.render(<WorkspaceTools tools={list} />));

const tabFor = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".workspace-tool-tab")]
    .find((button) => button.textContent?.startsWith(label))!;

const panels = () =>
  [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]')].map((panel) => panel.hidden);

describe("the tool region", () => {
  it("opens on the first tool and shows only that one", () => {
    render(tools());
    expect(tabFor("直す").getAttribute("aria-selected")).toBe("true");
    expect(panels()).toEqual([false, true, true]);
  });

  it("keeps every panel mounted, so nothing loses what was typed into it", () => {
    // Unmounting would be the cheaper implementation and the wrong one: a
    // search query, a half-chosen comparison and a candidate part-way through
    // auditioning all live in these panels.
    render(tools());
    const field = host.querySelector<HTMLInputElement>('[data-testid="query"]')!;
    field.value = "4536";
    act(() => tabFor("探す").click());
    act(() => tabFor("直す").click());
    expect(host.querySelector<HTMLInputElement>('[data-testid="query"]')!.value).toBe("4536");
  });

  it("hides rather than removes, which is what takes a panel out of tab order", () => {
    render(tools());
    const hidden = [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
      .filter((panel) => panel.hidden);
    expect(hidden).toHaveLength(2);
    // Still in the tree, so anything that queries the DOM for them finds them.
    expect(host.textContent).toContain("compare body");
  });

  it("comes forward when content arrives from outside the region", () => {
    // The variation list is filled by the regeneration dock at the bottom of
    // the screen. Generating candidates and having nothing visibly happen
    // would be worse than the scroll this replaces.
    render(tools());
    expect(tabFor("直す").getAttribute("aria-selected")).toBe("true");
    render(tools({ compare: { claimsFocus: true } }));
    expect(tabFor("比べる").getAttribute("aria-selected")).toBe("true");
  });

  it("does not keep pulling the user back while the claim stays true", () => {
    // Rising edge only. The candidates stay on screen after they arrive, so a
    // claim that is merely still true must not fight a deliberate move away.
    render(tools({ compare: { claimsFocus: true } }));
    expect(tabFor("比べる").getAttribute("aria-selected")).toBe("true");
    act(() => tabFor("直す").click());
    render(tools({ compare: { claimsFocus: true } }));
    expect(tabFor("直す").getAttribute("aria-selected")).toBe("true");
  });

  it("marks a tool that has something in it without moving anyone", () => {
    render(tools({ compare: { hasContent: true } }));
    expect(tabFor("直す").getAttribute("aria-selected"), "still here").toBe("true");
    expect(tabFor("比べる").querySelector(".workspace-tool-marker")).not.toBeNull();
    expect(tabFor("直す").querySelector(".workspace-tool-marker")).toBeNull();
  });

  it("moves between tabs with the arrow keys, and wraps", () => {
    render(tools());
    const first = tabFor("直す");
    act(() => {
      first.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowLeft", bubbles: true, cancelable: true,
      }));
    });
    expect(tabFor("比べる").getAttribute("aria-selected"), "wraps backwards").toBe("true");
  });

  it("keeps only the selected tab in the page's tab order", () => {
    // A tablist is one stop, not one stop per tab.
    render(tools());
    expect(tabFor("直す").tabIndex).toBe(0);
    expect(tabFor("探す").tabIndex).toBe(-1);
  });
});
