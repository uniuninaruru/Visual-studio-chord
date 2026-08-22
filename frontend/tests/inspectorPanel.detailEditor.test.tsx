import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectorPanel } from "../src/features/editor/InspectorPanel";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition, validateComposition } from "../src/music";
import type { BackendConnection } from "../src/api/inferenceTypes";
import type { GeneratedComposition } from "../src/types/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function piece(): GeneratedComposition {
  return generateComposition({ ...DEFAULT_GENERATOR_SETTINGS, seed: "inspector-detail-editor" });
}

describe("Inspector detailed chord editor entry", () => {
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

  function render(overrides: Partial<React.ComponentProps<typeof InspectorPanel>> = {}) {
    const composition = piece();
    const props: React.ComponentProps<typeof InspectorPanel> = {
      composition,
      mobileOpen: false,
      selectedNote: null,
      selectedChord: null,
      selectedRange: null,
      validation: validateComposition(composition),
      backend: { state: "browser", message: "", reason: "browser-only" } satisfies BackendConnection,
      onEditChord: vi.fn(),
      onOpenChordEditor: vi.fn(),
      onMoveNote: vi.fn(),
      onDeleteNote: vi.fn(),
      onClearSelection: vi.fn(),
      onExportJson: vi.fn(),
      onExportMidi: vi.fn(),
      onImportJson: vi.fn(),
      onImportMelody: vi.fn(),
      onMobileClose: vi.fn(),
      ...overrides,
    };
    act(() => root.render(<InspectorPanel {...props} />));
    return { composition, props };
  }

  it("shows and invokes the entry only for a selected chord", () => {
    const notePiece = piece();
    render({ selectedNote: notePiece.notes[0]! });
    expect([...host.querySelectorAll("button")]
      .some((button) => button.textContent?.trim() === "響きを編集")).toBe(false);

    const { composition, props } = render({ selectedChord: notePiece.chords[0]! });
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.trim() === "響きを編集");
    expect(button).toBeDefined();
    act(() => button?.click());
    expect(props.onOpenChordEditor).toHaveBeenCalledOnce();
    expect(host.textContent).toContain(composition.chords[0]!.symbol);
  });
});
