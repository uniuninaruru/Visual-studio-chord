import { useEffect } from "react";
import { useComposerStore } from "../state";

export interface EditorKeyboardShortcutOptions {
  /** Escape closes the diagnostics panel before any other shortcut runs. */
  diagnosticsOpen: boolean;
  closeDiagnostics: () => void;
  /** A mobile settings or inspector sheet, which Escape closes next. */
  mobilePanelOpen: boolean;
  closeMobilePanel: () => void;
  hasSelectedNotes: boolean;
  play: () => void;
  pause: () => void;
  deleteSelectedNotes: () => void;
  onToast: (message: string) => void;
}

/**
 * Global editor shortcuts: Space, undo/redo, Delete, Escape.
 *
 * Typing must never be hijacked, so every shortcut except Escape is suppressed
 * while a text field or contenteditable has focus. Space is suppressed more
 * widely than that: any focused control that answers to Space on its own keeps
 * it, because taking it would mean a keyboard user cannot press a button.
 *
 * Playback status and history are read from the store imperatively rather than
 * captured from props. The listener is registered once per dependency change and
 * a captured value would be stale by the time a key is pressed.
 */
export function useEditorKeyboardShortcuts(
  options: EditorKeyboardShortcutOptions,
): void {
  const {
    diagnosticsOpen,
    closeDiagnostics,
    mobilePanelOpen,
    closeMobilePanel,
    hasSelectedNotes,
    play,
    pause,
    deleteSelectedNotes,
    onToast,
  } = options;

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target;
      const editingText = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable);

      if (event.key === "Escape") {
        // Innermost first: a mobile sheet opens over the page, and the
        // diagnostics panel opens over everything.
        if (diagnosticsOpen) {
          closeDiagnostics();
          return;
        }
        if (mobilePanelOpen) {
          closeMobilePanel();
          return;
        }
      }
      if (editingText) return;

      if (event.code === "Space") {
        // Not while a control that answers to Space itself has focus.
        //
        // Space activates a focused button, and preventDefault here cancels
        // that -- so a keyboard user who tabbed to 生成 and pressed Space got
        // playback and no generation. Verified in the running app before the
        // guard: with the generate button focused, the event came back with
        // defaultPrevented true and the button never fired.
        //
        // Checked against the focused element rather than the event target,
        // because this listener is on window and the target of a key pressed
        // with nothing focused is the body.
        const focused = document.activeElement;
        const answersToSpace = focused instanceof HTMLElement && (
          focused.tagName === "BUTTON"
          || focused.tagName === "SUMMARY"
          || focused.getAttribute("role") === "button"
          || focused.getAttribute("role") === "tab"
          || focused.getAttribute("role") === "radio"
          || focused.getAttribute("role") === "checkbox"
          || (focused instanceof HTMLAnchorElement && focused.hasAttribute("href"))
          || (focused instanceof HTMLInputElement
            && (focused.type === "checkbox" || focused.type === "radio"
              || focused.type === "range" || focused.type === "file"))
        );
        if (answersToSpace) return;
        event.preventDefault();
        if (useComposerStore.getState().playback.status === "playing") pause();
        else play();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        const state = useComposerStore.getState();
        const changed = event.shiftKey ? state.redo() : state.undo();
        onToast(
          changed
            ? event.shiftKey ? "Redoしました。" : "Undoしました。"
            : "これ以上履歴がありません。",
        );
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && hasSelectedNotes) {
        event.preventDefault();
        deleteSelectedNotes();
      }
    };

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [
    diagnosticsOpen,
    closeDiagnostics,
    mobilePanelOpen,
    closeMobilePanel,
    hasSelectedNotes,
    play,
    pause,
    deleteSelectedNotes,
    onToast,
  ]);
}
