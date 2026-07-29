import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VariationPanel,
  type VariationCandidate,
} from "../src/features/variations/VariationPanel";
import { sortVariationCandidates } from "../src/features/variations/variationRanking";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function candidate(
  sourceIndex: number,
  rawScore: number,
): VariationCandidate {
  const composition = generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS,
    seed: `rank-source-${sourceIndex}`,
  });
  return {
    composition,
    sourceIndex,
    preference: {
      category: "combined",
      rawScore,
      score: Math.tanh(rawScore),
      confidence: 0.5,
      feedbackCount: 2,
    },
  };
}

describe("VariationPanel ranked candidates", () => {
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

  it("sorts scores stably while every action keeps the original preview index", () => {
    const onAudition = vi.fn();
    const onAdopt = vi.fn();
    const onFeedback = vi.fn();
    const ranked = sortVariationCandidates([
      candidate(0, 0.1),
      candidate(1, 0.9),
      candidate(2, 0.5),
    ]);

    expect(ranked.map(({ sourceIndex }) => sourceIndex)).toEqual([1, 2, 0]);

    act(() => {
      root.render(
        <VariationPanel
          candidates={ranked}
          activeAuditionIndex={1}
          onAudition={onAudition}
          onAdopt={onAdopt}
          onFeedback={onFeedback}
        />,
      );
    });

    const cards = host.querySelectorAll<HTMLElement>("article[data-candidate]");
    // Labels retain candidate identity even though score changes display order.
    expect([...cards].map((card) => card.dataset.candidate)).toEqual(["B", "C", "A"]);
    expect(cards[0]?.textContent).toContain("試聴中");

    act(() => {
      cards[0]?.querySelector<HTMLButtonElement>(".variation-adopt-button")?.click();
      cards[0]?.querySelectorAll<HTMLButtonElement>(".preference-action")[0]?.click();
      cards[0]?.querySelector<HTMLButtonElement>(".variation-audition-button")?.click();
    });

    expect(onAdopt).toHaveBeenCalledWith(1);
    expect(onFeedback).toHaveBeenCalledWith(1, "like");
    expect(onAudition).toHaveBeenCalledWith(null);
  });

  it("uses original order as the deterministic tie-break", () => {
    const ranked = sortVariationCandidates([
      candidate(2, 0.4),
      candidate(0, 0.4),
      candidate(1, 0.4),
    ]);

    expect(ranked.map(({ sourceIndex }) => sourceIndex)).toEqual([0, 1, 2]);
  });

  it("labels neural previews, explicit mock state, validation, and provenance", () => {
    const neuralCandidate = candidate(0, 0.3);
    neuralCandidate.neural = {
      candidateId: "mock-candidate",
      modelId: "mock-harmonyforge-bimask-v1",
      device: "cpu",
      backend: "mock",
      dtype: "float32",
      mock: true,
      trained: false,
      checkpointSha256: null,
      tokenizerSha256: "tokenizer",
      sourceCommit: null,
      candidateCount: 3,
      batchSize: 1,
      cpuFallbackUsed: false,
      fallbackReason: null,
      neuralMeanLogProbability: null,
      meanConfidence: 0.5,
      hardRuleVector: {},
      clientTheoryValidated: true,
      rebasedAgainstNewerEdits: true,
      theoryWarnings: ["Cadence metadata warning"],
      arrangementWarnings: [],
    };

    act(() => {
      root.render(
        <VariationPanel
          candidates={[neuralCandidate]}
          activeAuditionIndex={null}
          onAudition={vi.fn()}
          onAdopt={vi.fn()}
          onFeedback={vi.fn()}
        />,
      );
    });

    expect(host.textContent).toContain("Mock · untrained");
    expect(host.textContent).toContain("Client gateValidated · 1 warnings");
    expect(host.textContent).toContain("checkpointなし");
    expect(host.textContent).toContain("3候補 · batch 1");
    expect(host.textContent).toContain("Rebased");
    expect(
      host.querySelector(".variation-neural-badge")?.getAttribute("aria-label"),
    ).toContain("未学習Mock");
    expect(
      host.querySelector(".variation-adopt-button")?.getAttribute("aria-label"),
    ).toContain("プレビューを採用して履歴へ保存");
  });
});
