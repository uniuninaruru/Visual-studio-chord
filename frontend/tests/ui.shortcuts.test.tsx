import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useEditorKeyboardShortcuts } from "../src/hooks/useEditorKeyboardShortcuts";
import type { EditorKeyboardShortcutOptions } from "../src/hooks/useEditorKeyboardShortcuts";

/**
 * The global shortcuts, and what they must not take.
 *
 * Space is the expected play/pause key in any music tool, and it is also how a
 * keyboard user presses a focused button. Only one of those can win per press,
 * and which one depends entirely on what has focus -- so that, rather than the
 * event's target, is what this hook has to read: the listener is on window, and
 * a key pressed with nothing focused targets the body.
 */

let host: HTMLDivElement;
let root: Root;

function Probe(props: EditorKeyboardShortcutOptions) {
  useEditorKeyboardShortcuts(props);
  return null;
}

function mount(overrides: Partial<EditorKeyboardShortcutOptions> = {}) {
  const props: EditorKeyboardShortcutOptions = {
    diagnosticsOpen: false,
    closeDiagnostics: vi.fn(),
    mobilePanelOpen: false,
    closeMobilePanel: vi.fn(),
    hasSelectedNotes: false,
    play: vi.fn(),
    pause: vi.fn(),
    deleteSelectedNotes: vi.fn(),
    onToast: vi.fn(),
    ...overrides,
  };
  act(() => root.render(<Probe {...props} />));
  return props;
}

/**
 * Dispatched from whatever has focus, which is where a real keypress starts.
 *
 * Firing at window directly would leave event.target as window, and the
 * typing guard reads the target -- so a test that skipped the bubble would
 * report the guard broken when it is not.
 */
function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key, code: key === " " ? "Space" : key, bubbles: true, cancelable: true, ...init,
  });
  const from = document.activeElement ?? window;
  act(() => { from.dispatchEvent(event); });
  return event;
}

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

describe("the global editor shortcuts", () => {
  it("plays on Space when nothing has focus", () => {
    const props = mount();
    const event = press(" ");
    expect(props.play).toHaveBeenCalledOnce();
    expect(event.defaultPrevented, "the page must not scroll").toBe(true);
  });

  it("leaves Space to a focused button, which is how it is pressed", () => {
    // Measured in the running app before this guard: with the generate button
    // focused, Space came back defaultPrevented and the button never fired, so
    // a keyboard user could not press any button in the app.
    const props = mount();
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const event = press(" ");
    expect(props.play, "playback must not steal it").not.toHaveBeenCalled();
    expect(event.defaultPrevented, "the button's own activation must survive").toBe(false);
  });

  it("leaves Space to every other control that answers to it", () => {
    const props = mount();
    for (const make of [
      () => Object.assign(document.createElement("summary"), { tabIndex: 0 }),
      () => Object.assign(document.createElement("input"), { type: "checkbox" }),
      () => Object.assign(document.createElement("input"), { type: "range" }),
      () => {
        const link = document.createElement("a");
        link.href = "#x";
        return link;
      },
      () => {
        const tab = document.createElement("div");
        tab.setAttribute("role", "tab");
        tab.tabIndex = 0;
        return tab;
      },
    ]) {
      const element = make();
      document.body.append(element);
      element.focus();
      press(" ");
      element.remove();
    }
    expect(props.play).not.toHaveBeenCalled();
  });

  it("still plays when a plain div has focus", () => {
    // The guard must be a list of what answers to Space, not a list of what
    // does not: anything else keeps the shortcut.
    const props = mount();
    const panel = document.createElement("div");
    panel.tabIndex = 0;
    document.body.append(panel);
    panel.focus();
    press(" ");
    expect(props.play).toHaveBeenCalledOnce();
  });

  it("never hijacks typing", () => {
    const props = mount({ hasSelectedNotes: true });
    const field = document.createElement("input");
    field.type = "text";
    document.body.append(field);
    field.focus();
    press(" ");
    press("z", { metaKey: true });
    press("Delete");
    expect(props.play).not.toHaveBeenCalled();
    expect(props.deleteSelectedNotes).not.toHaveBeenCalled();
  });

  it("closes the innermost thing on Escape", () => {
    // Both open: the diagnostics panel is over the mobile sheet, so it goes
    // first and the sheet stays.
    const both = mount({ diagnosticsOpen: true, mobilePanelOpen: true });
    press("Escape");
    expect(both.closeDiagnostics).toHaveBeenCalledOnce();
    expect(both.closeMobilePanel).not.toHaveBeenCalled();

    const sheet = mount({ diagnosticsOpen: false, mobilePanelOpen: true });
    press("Escape");
    expect(sheet.closeMobilePanel).toHaveBeenCalledOnce();
  });

  it("closes on Escape even from inside a text field", () => {
    // The one shortcut that must survive typing: a sheet opened over the page
    // has a text field in it, and Escape is how it is dismissed.
    const props = mount({ mobilePanelOpen: true });
    const field = document.createElement("input");
    field.type = "text";
    document.body.append(field);
    field.focus();
    press("Escape");
    expect(props.closeMobilePanel).toHaveBeenCalledOnce();
  });

  it("deletes selected notes, and only when there are some", () => {
    const none = mount({ hasSelectedNotes: false });
    press("Delete");
    expect(none.deleteSelectedNotes).not.toHaveBeenCalled();

    const some = mount({ hasSelectedNotes: true });
    press("Backspace");
    expect(some.deleteSelectedNotes).toHaveBeenCalledOnce();
  });

  it("deletes a selected chord when no notes are selected", () => {
    const deleteSelectedChord = vi.fn();
    const props = mount({ hasSelectedChord: true, deleteSelectedChord });
    press("Backspace");
    expect(deleteSelectedChord).toHaveBeenCalledOnce();
    expect(props.deleteSelectedNotes).not.toHaveBeenCalled();
  });

  it("gives selected notes priority over selected chord deletion", () => {
    const deleteSelectedChord = vi.fn();
    const props = mount({
      hasSelectedNotes: true,
      hasSelectedChord: true,
      deleteSelectedChord,
    });
    press("Delete");
    expect(props.deleteSelectedNotes).toHaveBeenCalledOnce();
    expect(deleteSelectedChord).not.toHaveBeenCalled();
  });
});
