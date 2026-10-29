import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SectionArrangementBuilder } from "../src/features/arrangement/SectionArrangementBuilder";
import {
  DEFAULT_GENERATOR_SETTINGS,
  assembleSectionArrangement,
  createDefaultSectionArrangement,
} from "../src/music";
import type { SectionArrangementPlan } from "../src/types/music";
import type { SectionArrangementAssemblyResult } from "../src/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function planFixture(): SectionArrangementPlan {
  return createDefaultSectionArrangement({
    ...DEFAULT_GENERATOR_SETTINGS,
    seed: "arrangement-builder-component",
  });
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string, eventName = "change"): void {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event(eventName, { bubbles: true }));
}

function baseProps(plan: SectionArrangementPlan | undefined = planFixture()) {
  return {
    plan,
    pendingCommit: false,
    updateTiming: "nextBar" as const,
    onInitialize: vi.fn(() => true),
    onUpdateSection: vi.fn(() => true),
    onRegenerateSection: vi.fn(() => true),
    onEditSectionChord: vi.fn(() => true),
    onAddInstance: vi.fn(() => "instance-new"),
    onDuplicateInstance: vi.fn(() => "instance-copy"),
    onRemoveInstance: vi.fn(() => true),
    onMoveInstance: vi.fn(() => true),
    onSetLinkMode: vi.fn(() => true),
    onAssemble: vi.fn<() => SectionArrangementAssemblyResult>(() => ({
      ok: false,
      issues: [{ code: "test.failure", message: "test failure" }],
    })),
    onNotify: vi.fn(),
    onChordEditorOpenChange: vi.fn(),
  };
}

describe("SectionArrangementBuilder", () => {
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

  function render(overrides: Partial<ReturnType<typeof baseProps>> = {}) {
    const props = { ...baseProps(), ...overrides };
    act(() => root.render(<SectionArrangementBuilder {...props} />));
    return props;
  }

  it("shows the empty disclosure and initializes four parts", () => {
    const props = render({ plan: undefined });
    expect(host.textContent).toContain("SONG FORM");
    expect(host.textContent).toContain("4つのパーツを作る");
    expect(host.textContent).toContain("現在の曲は");
    act(() => host.querySelector<HTMLButtonElement>(".section-arrangement-empty .primary-button")?.click());
    expect(props.onInitialize).toHaveBeenCalledOnce();
  });

  it("renders all four source cards with only the four allowed lengths", () => {
    render();
    expect(host.querySelectorAll("[data-testid^='section-source-']")).toHaveLength(4);
    for (const select of host.querySelectorAll<HTMLSelectElement>("select[aria-label$='の小節数']")) {
      expect([...select.options].map((option) => Number(option.value))).toEqual([8, 16, 24, 32]);
    }
    expect(host.textContent).toContain("1 パーツを作る");
    expect(host.textContent).toContain("2 順番を決める");
    expect(host.textContent).toContain("3 1曲にまとめる");
  });

  it("makes inherited jazz source styles explicit and keeps legacy source styles editable", () => {
    const jazzPlan = createDefaultSectionArrangement({
      ...DEFAULT_GENERATOR_SETTINGS,
      style: "jazz",
      jazz: {
        version: 1,
        style: "swing",
        form: "aaba",
        chromaticism: 0.35,
        interaction: 0.6,
      },
      seed: "arrangement-builder-jazz",
    });
    render({ plan: jazzPlan });
    const jazzStyle = host.querySelector<HTMLSelectElement>("select[aria-label='Introのスタイル']");
    expect(jazzStyle?.disabled).toBe(true);
    expect(host.textContent).toContain("Jazzプロファイルは生成設定から継承します");
    expect(host.textContent).toContain("Freeフォームとして保存します");

    const legacy = planFixture();
    render({ plan: legacy });
    const legacyStyle = host.querySelector<HTMLSelectElement>("select[aria-label='Introのスタイル']");
    expect(legacyStyle?.disabled).toBe(false);
    expect(host.textContent).not.toContain("Jazzプロファイルは生成設定から継承します");
  });

  it("filters templates by mode and sends a compatible template atomically", () => {
    const fixture = planFixture();
    fixture.sections[0]!.design.templateId = "intro-hook";
    const props = render({ plan: fixture });
    const mode = host.querySelector<HTMLSelectElement>("select[aria-label='Introのモード']")!;
    act(() => setValue(mode, "mixolydian"));
    expect(props.onUpdateSection).toHaveBeenCalledWith("source-intro", { mode: "mixolydian", templateId: "intro-ambient" });
    const template = "intro-ambient";
    const templateSelect = host.querySelector<HTMLSelectElement>("select[aria-label='Introのテンプレート']")!;
    expect([...templateSelect.options].some((option) => option.value === template)).toBe(true);
  });

  it("commits a source name on blur or Enter and restores on Escape", () => {
    const props = render();
    const input = host.querySelector<HTMLInputElement>("input[aria-label='Introの表示名']")!;
    act(() => {
      input.focus();
      setValue(input, "Opening", "input");
      input.blur();
    });
    expect(props.onUpdateSection).toHaveBeenCalledWith("source-intro", { name: "Opening" });

    const second = render();
    const secondInput = host.querySelector<HTMLInputElement>("input[aria-label='Introの表示名']")!;
    act(() => setValue(secondInput, "Opening Again", "input"));
    act(() => secondInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(second.onUpdateSection).toHaveBeenCalledWith("source-intro", { name: "Opening Again" });

    const third = render();
    const thirdInput = host.querySelector<HTMLInputElement>("input[aria-label='Introの表示名']")!;
    act(() => setValue(thirdInput, "discard", "input"));
    act(() => thirdInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(third.onUpdateSection).not.toHaveBeenCalled();
    expect(thirdInput.value).toBe("Intro");

    const blank = render();
    const blankInput = host.querySelector<HTMLInputElement>("input[aria-label='Introの表示名']")!;
    act(() => {
      blankInput.focus();
      setValue(blankInput, "   ", "input");
      blankInput.blur();
    });
    expect(blankInput.value).toBe("Intro");
    expect(blank.onUpdateSection).not.toHaveBeenCalled();
    expect(host.querySelector(".section-operation-error")?.textContent).toContain("空欄にできません");
    expect(host.querySelector(".section-operation-error")?.getAttribute("role")).toBe("alert");
  });

  it("syncs an externally changed name while preserving only active input", () => {
    const fixture = planFixture();
    const props = render({ plan: fixture });
    const input = host.querySelector<HTMLInputElement>("input[aria-label='Introの表示名']")!;
    act(() => {
      input.focus();
      setValue(input, "入力中", "input");
    });
    const updated = structuredClone(fixture);
    updated.revision += 1;
    updated.sections[0]!.design.name = "外部から更新";
    act(() => root.render(<SectionArrangementBuilder {...props} plan={updated} />));
    expect(host.querySelector<HTMLInputElement>("input[aria-label='Introの表示名']")?.value).toBe("外部から更新");
  });

  it("shows the written dirty state, disables chord editing, and reports regeneration", () => {
    const dirty = planFixture();
    dirty.sections[0]!.dirty = true;
    const props = render({ plan: dirty });
    expect(host.textContent).toContain("未反映");
    expect(host.textContent).toContain("前回の内容を保持しています。この設定で生成すると更新されます。");
    expect(host.textContent).toContain("先にこの設定で生成してください");
    expect([...host.querySelectorAll<HTMLButtonElement>(".section-chord-chip")].at(0)?.disabled).toBe(true);
    act(() => host.querySelector<HTMLButtonElement>(".section-regenerate-button")?.click());
    expect(props.onRegenerateSection).toHaveBeenCalledWith("source-intro");
    expect(props.onNotify).toHaveBeenCalledWith(expect.stringContaining("生成しました"));
  });

  it("closes a source chord editor when the source becomes dirty", () => {
    const fixture = planFixture();
    const props = render({ plan: fixture });
    act(() => host.querySelector<HTMLButtonElement>(".section-chord-chip")?.click());
    expect(host.querySelector("[role='dialog']")).not.toBeNull();
    const dirty = structuredClone(fixture);
    dirty.revision += 1;
    dirty.sections[0]!.dirty = true;
    act(() => root.render(<SectionArrangementBuilder {...props} plan={dirty} />));
    expect(host.querySelector("[role='dialog']")).toBeNull();
    expect(props.onChordEditorOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("opens the reused ChordEditor for a clean source and applies its callback", () => {
    const props = render();
    act(() => host.querySelector<HTMLButtonElement>(".section-chord-chip")?.click());
    expect(host.querySelector("[role='dialog']")).not.toBeNull();
    expect(props.onChordEditorOpenChange).toHaveBeenCalledWith(true);
    act(() => host.querySelector<HTMLButtonElement>(".chord-editor-dialog .secondary-button")?.click());
    expect(props.onChordEditorOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("exposes sequence callbacks and disables edge and last-removal actions", () => {
    const props = render();
    expect(host.querySelector<HTMLButtonElement>("button[aria-label='Introを左へ移動']")?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>("button[aria-label='Cを右へ移動']")?.disabled).toBe(true);
    act(() => host.querySelector<HTMLButtonElement>("button[aria-label='Aを左へ移動']")?.click());
    act(() => host.querySelector<HTMLButtonElement>("button[aria-label='Aをくり返す']")?.click());
    act(() => host.querySelector<HTMLButtonElement>("button[aria-label='Aを外す']")?.click());
    act(() => host.querySelector<HTMLButtonElement>(".section-add-buttons button")?.click());
    expect(props.onMoveInstance).toHaveBeenCalledWith("instance-aMelo", -1);
    expect(props.onDuplicateInstance).toHaveBeenCalledWith("instance-aMelo");
    expect(props.onRemoveInstance).toHaveBeenCalledWith("instance-aMelo");
    expect(props.onAddInstance).toHaveBeenCalledWith("source-intro");
  });

  it("shows error feedback when a topology callback declines the operation", () => {
    const props = render({
      onMoveInstance: vi.fn(() => false),
      onDuplicateInstance: vi.fn(() => null as unknown as string),
      onRemoveInstance: vi.fn(() => false),
      onAddInstance: vi.fn(() => null as unknown as string),
      onSetLinkMode: vi.fn(() => false),
    });
    act(() => host.querySelector<HTMLButtonElement>("button[aria-label='Aを左へ移動']")?.click());
    expect(host.querySelector(".section-operation-error")?.getAttribute("role")).toBe("alert");
    expect(host.textContent).toContain("現在の曲は変更されていません");
    act(() => host.querySelector<HTMLButtonElement>("button[aria-label='Aをくり返す']")?.click());
    act(() => host.querySelector<HTMLButtonElement>("button[aria-label='Aを外す']")?.click());
    act(() => host.querySelector<HTMLButtonElement>(".section-add-buttons button")?.click());
    act(() => host.querySelector<HTMLSelectElement>(".section-join-control select")?.dispatchEvent(new Event("change", { bubbles: true })));
    expect(props.onNotify).toHaveBeenCalledWith(expect.stringContaining("現在の曲は変更されていません"));
  });

  it("renders stable join controls, resolved explanations, and a same-key pivot blocker", () => {
    const fixture = planFixture();
    const firstLink = fixture.links[0]!;
    fixture.resolvedLinks = [{
      linkId: firstLink.id,
      fromInstanceId: firstLink.fromInstanceId,
      toInstanceId: firstLink.toInstanceId,
      boundaryBar: 8,
      mode: "auto",
      technique: "commonTone",
      label: "Common tone",
      explanation: "The shared tone remains in the upper voice.",
    }];
    fixture.links[0] = { ...firstLink, mode: "pivot" };
    const props = render({ plan: fixture });
    expect(host.textContent).toContain("共通音を保ってつなぐ");
    expect(host.textContent).toContain("技術的な説明");
    expect(host.textContent).toContain("同じキー・モードでは");
    act(() => host.querySelector<HTMLButtonElement>(".section-link-blocker .text-button")?.click());
    expect(props.onSetLinkMode).toHaveBeenCalledWith(firstLink.id, "auto");
  });

  it("blocks referenced dirty sources but permits unreferenced dirty sources", () => {
    const referenced = planFixture();
    referenced.sections[0]!.dirty = true;
    const blocked = render({ plan: referenced });
    expect(host.querySelector(".section-blocker-list")).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>(".section-assemble-button")?.disabled).toBe(true);

    const unreferenced = planFixture();
    unreferenced.sections[0]!.dirty = true;
    unreferenced.sequence = unreferenced.sequence.slice(1);
    const permitted = render({ plan: unreferenced });
    expect(host.querySelector(".section-blocker-list")).toBeNull();
    expect(host.querySelector<HTMLButtonElement>(".section-assemble-button")?.disabled).toBe(false);
    expect(blocked.onAssemble).not.toHaveBeenCalled();
    expect(permitted.onAssemble).not.toHaveBeenCalled();
  });

  it("derives never, stale, current, pending, and manual assembly copy", () => {
    const never = render();
    expect(host.textContent).toContain("まだ1曲にまとめていません");

    const stale = planFixture();
    stale.assembledRevision = 0;
    stale.revision = 1;
    const staleProps = render({ plan: stale });
    expect(host.textContent).toContain("パーツまたは順番の変更が未反映です");
    expect(staleProps.onAssemble).not.toHaveBeenCalled();

    const current = planFixture();
    current.assembledRevision = current.revision;
    const currentProps = render({ plan: current, pendingCommit: true });
    expect(host.textContent).toContain("完成曲へ反映済み");
    expect(host.textContent).toContain("次の小節から再生へ反映");
    expect(host.querySelector<HTMLButtonElement>(".section-assemble-button")?.disabled).toBe(true);
    expect(currentProps.onAssemble).not.toHaveBeenCalled();

    const manual = planFixture();
    manual.assembledRevision = manual.revision;
    manual.manualSongEdited = true;
    render({ plan: manual });
    expect(host.textContent).toContain("完成曲に手動編集があります");
    expect(host.textContent).toContain("完成曲側の手動編集を置き換えます");
    expect(never.onAssemble).not.toHaveBeenCalled();
  });

  it("reports assembly success and failure through live feedback", () => {
    const fixture = planFixture();
    const assembled = assembleSectionArrangement(fixture, DEFAULT_GENERATOR_SETTINGS);
    if (!assembled.ok) throw new Error("Fixture assembly failed.");
    const success = render({ onAssemble: vi.fn(() => assembled) });
    act(() => host.querySelector<HTMLButtonElement>(".section-assemble-button")?.click());
    expect(host.querySelector(".section-operation-message")?.textContent).toContain("32小節");
    expect(success.onNotify).toHaveBeenCalledWith(expect.stringContaining("32小節"));

    const failure = render({ onAssemble: vi.fn(() => ({ ok: false, issues: [{ code: "link.pivotUnavailable", message: "internal detail" }] })) });
    act(() => host.querySelector<HTMLButtonElement>(".section-assemble-button")?.click());
    const alerts = host.querySelectorAll("[role='alert']");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toContain("共通コードを作れない");
    expect(alerts[0]?.textContent).not.toContain("internal detail");
    expect(failure.onNotify).toHaveBeenCalledWith(expect.stringContaining("現在の曲は変更されていません"));
  });

  it("clears an assembly error when the plan revision changes", () => {
    const fixture = planFixture();
    const props = render({
      plan: fixture,
      onAssemble: vi.fn(() => ({ ok: false, issues: [{ code: "link.pivotUnavailable", message: "internal detail" }] })),
    });
    act(() => host.querySelector<HTMLButtonElement>(".section-assemble-button")?.click());
    expect(host.querySelector(".section-assembly-error")).not.toBeNull();
    const revised = structuredClone(fixture);
    revised.revision += 1;
    act(() => root.render(<SectionArrangementBuilder {...props} plan={revised} />));
    expect(host.querySelector(".section-assembly-error")).toBeNull();
    expect(host.querySelector(".section-operation-error")).toBeNull();
  });

  it("keeps the bar and status summary visible while collapsed", () => {
    render();
    const toggle = host.querySelector<HTMLButtonElement>(".section-arrangement-toggle")!;
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".section-arrangement-summary")?.textContent).toContain("合計 32 / 128 小節");
    expect(host.querySelector("#section-arrangement-content")?.hasAttribute("hidden")).toBe(true);
  });
});
