import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReharmonizationPanel } from "../src/features/editor/ReharmonizationPanel";
import { useReharmonization } from "../src/hooks/useReharmonization";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import { reharmonizeChord, melodyPitchClassesOver } from "../src/music/reharmonization";
import type { ChordEvent, GeneratedComposition } from "../src/types/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function composition(): GeneratedComposition {
  return generateComposition({ ...DEFAULT_GENERATOR_SETTINGS, seed: "reharm-ui" });
}

function candidatesFor(piece: GeneratedComposition, chord: ChordEvent) {
  const index = piece.chords.findIndex((entry) => entry.id === chord.id);
  return reharmonizeChord({
    original: chord,
    melodyPitchClasses: melodyPitchClassesOver(piece.notes, chord),
    next: piece.chords[index + 1],
    key: piece.settings.key,
    mode: piece.settings.mode,
    style: piece.settings.style,
    limit: 6,
  });
}

type ApplyChord = (
  chordId: string,
  edit: Partial<ChordEvent> & { symbol: string },
) => boolean;

/** Drives the hook the way App does, so the wiring is what is under test. */
function Harness(props: {
  piece: GeneratedComposition;
  chord: ChordEvent | null;
  lockedBars: readonly number[];
  onAudition: (midis: readonly number[]) => void;
  onApply: ApplyChord;
  onToast: (message: string) => void;
}) {
  const state = useReharmonization(
    { composition: props.piece, chord: props.chord, lockedBars: props.lockedBars },
    { onAudition: props.onAudition, onApply: props.onApply, onToast: props.onToast },
  );
  return (
    <ReharmonizationPanel
      chord={props.chord}
      candidates={state.candidates}
      unavailableReason={state.unavailableReason}
      auditioningSymbol={state.auditioningSymbol}
      onAudition={state.audition}
      onApply={state.apply}
    />
  );
}

describe("reharmonization from the editor", () => {
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

  function render(node: React.ReactElement) {
    act(() => root.render(node));
  }

  it("offers the engine's candidates with technique, score, and a reason", () => {
    const piece = composition();
    const chord = piece.chords[1]!;
    // The fixture is only useful if the engine actually returns something.
    expect(candidatesFor(piece, chord).length).toBeGreaterThan(0);

    render(
      <Harness
        piece={piece}
        chord={chord}
        lockedBars={[]}
        onAudition={vi.fn()}
        onApply={vi.fn<ApplyChord>(() => true)}
        onToast={vi.fn()}
      />,
    );

    const rendered = host.querySelectorAll(".reharmonization-candidate");
    expect(rendered.length).toBe(candidatesFor(piece, chord).length);
    const first = rendered[0]!;
    expect(first.querySelector(".reharmonization-symbol")?.textContent).toBeTruthy();
    expect(first.querySelector(".reharmonization-technique")?.textContent).toBeTruthy();
    expect(first.querySelector(".reharmonization-score")?.textContent).toMatch(/%$/);
    // The "reason" the issue asked for is the engine's own explanation.
    expect(first.querySelector(".reharmonization-explanation")?.textContent).toBeTruthy();
  });

  it("auditioning sounds pitches without touching the composition", () => {
    const piece = composition();
    const chord = piece.chords[1]!;
    const onAudition = vi.fn();
    const onApply = vi.fn<ApplyChord>(() => true);

    render(
      <Harness
        piece={piece}
        chord={chord}
        lockedBars={[]}
        onAudition={onAudition}
        onApply={onApply}
        onToast={vi.fn()}
      />,
    );

    act(() => {
      host.querySelector<HTMLButtonElement>(".reharmonization-candidate .secondary-button")?.click();
    });

    expect(onAudition).toHaveBeenCalledTimes(1);
    const midis = onAudition.mock.calls[0]![0] as readonly number[];
    expect(midis.length).toBeGreaterThan(0);
    expect(midis.every((midi) => Number.isInteger(midi) && midi >= 0 && midi <= 127)).toBe(true);
    // Auditioning must never be a disguised edit.
    expect(onApply).not.toHaveBeenCalled();
  });

  it("applying edits only on the explicit action, and says Undo restores it", () => {
    const piece = composition();
    const chord = piece.chords[1]!;
    const onApply = vi.fn<ApplyChord>(() => true);
    const onToast = vi.fn();

    render(
      <Harness
        piece={piece}
        chord={chord}
        lockedBars={[]}
        onAudition={vi.fn()}
        onApply={onApply}
        onToast={onToast}
      />,
    );

    act(() => {
      host.querySelector<HTMLButtonElement>(".reharmonization-candidate .primary-button")?.click();
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    const [chordId, edit] = onApply.mock.calls[0]!;
    expect(chordId).toBe(chord.id);
    expect(edit.symbol).toBeTruthy();
    expect(onToast.mock.calls.at(-1)?.[0]).toContain("Undo");
  });

  it("a slash-chord candidate carries its bass as data, not inside the symbol", () => {
    // replaceChordSymbol parses the symbol and its expression does not accept
    // slash notation, so the bass has to travel as a field or it is lost.
    const piece = composition();
    for (const chord of piece.chords) {
      const slash = candidatesFor(piece, chord).find((entry) => entry.bass !== undefined);
      if (!slash) continue;
      const onApply = vi.fn<ApplyChord>(() => true);
      render(
        <Harness
          piece={piece}
          chord={chord}
          lockedBars={[]}
          onAudition={vi.fn()}
          onApply={onApply}
          onToast={vi.fn()}
        />,
      );
      const buttons = [...host.querySelectorAll<HTMLButtonElement>(
        ".reharmonization-candidate .primary-button",
      )];
      const index = candidatesFor(piece, chord).findIndex((entry) => entry.bass !== undefined);
      act(() => buttons[index]?.click());
      const [, edit] = onApply.mock.calls[0]!;
      expect(edit.bass).toBe(slash.bass);
      return;
    }
    // No slash candidate in this fixture is not a failure of the code.
  });

  it("refuses a locked bar instead of silently editing it", () => {
    const piece = composition();
    const chord = piece.chords[1]!;
    const lockedBar = Math.floor(chord.startTick / piece.ticksPerBar);
    const onApply = vi.fn<ApplyChord>(() => true);

    render(
      <Harness
        piece={piece}
        chord={chord}
        lockedBars={[lockedBar]}
        onAudition={vi.fn()}
        onApply={onApply}
        onToast={vi.fn()}
      />,
    );

    expect(host.querySelectorAll(".reharmonization-candidate").length).toBe(0);
    expect(host.textContent).toContain("ロック");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("explains itself when nothing is selected", () => {
    render(
      <Harness
        piece={composition()}
        chord={null}
        lockedBars={[]}
        onAudition={vi.fn()}
        onApply={vi.fn<ApplyChord>(() => true)}
        onToast={vi.fn()}
      />,
    );

    expect(host.querySelectorAll(".reharmonization-candidate").length).toBe(0);
    expect(host.textContent).toContain("コードを選ぶと");
  });

  it("every button is reachable by the words printed on it", () => {
    const piece = composition();
    render(
      <Harness
        piece={piece}
        chord={piece.chords[1]!}
        lockedBars={[]}
        onAudition={vi.fn()}
        onApply={vi.fn<ApplyChord>(() => true)}
        onToast={vi.fn()}
      />,
    );

    for (const button of host.querySelectorAll("button")) {
      const label = button.getAttribute("aria-label");
      if (label === null) continue;
      // WCAG 2.5.3: aria-label replaces the accessible name, so it has to
      // contain the visible text or voice control cannot reach the button.
      expect(label).toContain(button.textContent);
    }
  });
});
