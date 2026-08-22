import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChordEditor } from "../src/features/editor/ChordEditor";
import { MINIMAL_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import type { ChordEvent } from "../src/types/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function chord(overrides: Partial<ChordEvent> = {}): ChordEvent {
  const generated = generateComposition({
    ...MINIMAL_GENERATOR_SETTINGS,
    bars: 4,
    seed: "chord-editor-component",
  }).chords[0]!;
  return { ...generated, ...overrides };
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", {
    bubbles: true,
  }));
}

describe("ChordEditor", () => {
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
    document.body.innerHTML = "";
  });

  function render(
    selected: ChordEvent = chord(),
    overrides: Partial<React.ComponentProps<typeof ChordEditor>> = {},
  ) {
    const props: React.ComponentProps<typeof ChordEditor> = {
      chord: selected,
      locked: false,
      onApply: vi.fn(() => true),
      onClose: vi.fn(),
      ...overrides,
    };
    act(() => root.render(<ChordEditor {...props} />));
    return props;
  }

  it("shows current acoustic values and applies one structured edit", () => {
    const selected = chord({
      root: "D",
      quality: "minor7",
      tensions: ["9"],
      bass: "A",
      inversion: 0,
    });
    const props = render(selected);
    const dialog = host.querySelector<HTMLElement>("[role=dialog]");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("chord-editor-title");
    expect(dialog?.getAttribute("aria-describedby")).toBe("chord-editor-description");

    const selects = [...host.querySelectorAll<HTMLSelectElement>("select")];
    expect(selects[0]?.value).toBe("D");
    expect(selects[1]?.value).toBe("minor7");
    expect(selects[2]?.value).toBe("A");
    expect(selects[3]?.value).toBe("0");
    expect([...host.querySelectorAll<HTMLInputElement>("input[type=checkbox]")]
      .find((input) => input.nextElementSibling?.textContent === "9")?.checked).toBe(true);

    setValue(selects[0]!, "F#");
    setValue(selects[1]!, "major7");
    setValue(selects[2]!, "");
    act(() => host.querySelector<HTMLButtonElement>("button.primary-button")!.click());

    expect(props.onApply).toHaveBeenCalledOnce();
    expect(props.onApply).toHaveBeenCalledWith({
      root: "F#",
      quality: "major7",
      tensions: ["9"],
      bass: null,
      inversion: 0,
    });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("cancels on button or Escape without applying", () => {
    const props = render();
    act(() => host.querySelector<HTMLButtonElement>("button.secondary-button")!.click());
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onApply).not.toHaveBeenCalled();

    const second = render(chord({ root: "E" }));
    const dialog = host.querySelector<HTMLElement>("[role=dialog]")!;
    act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(second.onClose).toHaveBeenCalledOnce();
    expect(second.onApply).not.toHaveBeenCalled();
  });

  it("focuses the first form control, traps Tab, and returns focus on close", () => {
    const opener = document.createElement("button");
    opener.textContent = "open";
    document.body.append(opener);
    opener.focus();
    render();
    const dialog = host.querySelector<HTMLElement>("[role=dialog]")!;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), select:not([disabled]), input:not([disabled])",
    )];
    expect(document.activeElement).toBe(focusable.find((element) => element.tagName === "SELECT"));

    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    last.focus();
    act(() => last.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab", bubbles: true, cancelable: true,
    })));
    expect(document.activeElement).toBe(first);

    first.focus();
    act(() => first.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab", shiftKey: true, bubbles: true, cancelable: true,
    })));
    expect(document.activeElement).toBe(last);

    act(() => root.render(null));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("disables locked editing with a written reason", () => {
    const props = render(chord(), { locked: true });
    expect(host.textContent).toContain("ロックされた小節のため入力と適用は無効です");
    expect([...host.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")]
      .every((element) => element.disabled)).toBe(true);
    expect(host.querySelector<HTMLButtonElement>("button.primary-button")?.disabled).toBe(true);
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("moves focus inside a locked dialog and returns it after Escape", () => {
    const opener = document.createElement("button");
    opener.textContent = "open locked editor";
    document.body.append(opener);
    opener.focus();
    const props = render(chord(), { locked: true });
    const dialog = host.querySelector<HTMLElement>("[role=dialog]")!;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), select:not([disabled]), input:not([disabled])",
    )];
    expect(focusable.length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(focusable[0]);

    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    last.focus();
    act(() => last.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab", bubbles: true, cancelable: true,
    })));
    expect(document.activeElement).toBe(first);
    act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    expect(props.onClose).toHaveBeenCalledOnce();

    act(() => root.render(null));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("forces root position for tension and slash-bass chords", () => {
    const props = render(chord({ root: "C", tensions: ["9"], bass: "G", inversion: 0 }));
    const inversion = [...host.querySelectorAll<HTMLSelectElement>("select")].at(-1)!;
    expect([...inversion.options].filter((option) => option.value !== "0")
      .every((option) => option.disabled)).toBe(true);

    const root = host.querySelectorAll<HTMLSelectElement>("select")[0]!;
    setValue(root, "A");
    act(() => host.querySelector<HTMLButtonElement>("button.primary-button")!.click());
    expect(props.onApply).toHaveBeenCalledWith(expect.objectContaining({ inversion: 0 }));
  });

  it("does not call the store for an unchanged edit", () => {
    const props = render(chord({ tensions: [], bass: undefined, inversion: 0 }));
    const apply = host.querySelector<HTMLButtonElement>("button.primary-button")!;
    expect(apply.disabled).toBe(true);
    expect(host.textContent).toContain("変更内容を選ぶと適用できます");
    expect(apply.getAttribute("aria-describedby")).toBe("chord-editor-apply-help");
    expect(props.onApply).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
