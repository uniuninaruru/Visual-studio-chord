import { useEffect } from "react";
import { useComposerStore } from "../state";

export interface EditorKeyboardShortcutOptions {
  /** Escape closes the diagnostics panel before any other shortcut runs. */
  diagnosticsOpen: boolean;
  closeDiagnostics: () => void;
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
 * while a text field or contenteditable has focus.
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

      if (event.key === "Escape" && diagnosticsOpen) {
        closeDiagnostics();
        return;
      }
      if (editingText) return;

      if (event.code === "Space") {
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
    hasSelectedNotes,
    play,
    pause,
    deleteSelectedNotes,
    onToast,
  ]);
}
