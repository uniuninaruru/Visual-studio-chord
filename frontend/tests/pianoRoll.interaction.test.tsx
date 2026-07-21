import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PianoRoll } from "../src/features/pianoRoll/PianoRoll";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const composition = generateComposition({
  ...DEFAULT_GENERATOR_SETTINGS,
  seed: "piano-roll-interactions",
});

function pointerEvent(type: string, options: MouseEventInit & { pointerId: number }): MouseEvent {
  const event = new MouseEvent(type, options);
  Object.defineProperty(event, "pointerId", { value: options.pointerId });
  return event;
}

describe("PianoRoll interactions", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onNoteSelect = vi.fn();
  const onNoteMove = vi.fn();
  const onAddNote = vi.fn();

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onNoteSelect.mockReset();
    onNoteMove.mockReset();
    onAddNote.mockReset();

    act(() => {
      root.render(
        <PianoRoll
          composition={composition}
          currentTick={0}
          selectedRange={null}
          selectedNoteIds={[]}
          onNoteSelect={onNoteSelect}
          onNoteMove={onNoteMove}
          onAddNote={onAddNote}
          onCopyNotes={vi.fn()}
          onPasteNotes={vi.fn()}
          onDuplicateNotes={vi.fn()}
          onQuantizeNotes={vi.fn()}
          onDeleteNotes={vi.fn()}
          canPaste={false}
          clipboardNoteCount={0}
        />,
      );
    });

    const canvas = host.querySelector<HTMLElement>(".piano-canvas");
    if (!canvas) throw new Error("Piano canvas was not rendered");
    canvas.getBoundingClientRect = () => ({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 970,
      bottom: 380,
      width: 960,
      height: 360,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("adds a grid-quantized note by double-clicking empty space", () => {
    const canvas = host.querySelector<HTMLElement>(".piano-canvas");
    expect(canvas).not.toBeNull();
    act(() => {
      canvas?.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        clientX: 250,
        clientY: 200,
      }));
    });

    expect(onAddNote).toHaveBeenCalledOnce();
    const [, startTick] = onAddNote.mock.calls[0] as [number, number];
    expect(startTick % (composition.ppq / 4)).toBe(0);
  });

  it("reports modifier selection and a quantized two-axis drag", () => {
    const noteButton = host.querySelector<HTMLButtonElement>("[data-note-id]");
    expect(noteButton).not.toBeNull();
    if (!noteButton) return;

    act(() => {
      noteButton.dispatchEvent(pointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 7,
        shiftKey: true,
      }));
    });
    expect(onNoteSelect).toHaveBeenCalledWith(composition.notes[0], true);

    act(() => {
      noteButton.dispatchEvent(pointerEvent("pointermove", {
        bubbles: true,
        button: 0,
        clientX: 160,
        clientY: 80,
        pointerId: 7,
      }));
      noteButton.dispatchEvent(pointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        clientX: 160,
        clientY: 80,
        pointerId: 7,
      }));
    });

    expect(onNoteMove).toHaveBeenCalledOnce();
    const expectedDeltaTick = Math.round(
      ((60 / 960) * composition.totalTicks) / (composition.ppq / 4),
    ) * (composition.ppq / 4);
    expect(onNoteMove).toHaveBeenCalledWith(
      composition.notes[0],
      expect.objectContaining({ deltaTick: expectedDeltaTick, semitones: 1 }),
    );
  });
});
