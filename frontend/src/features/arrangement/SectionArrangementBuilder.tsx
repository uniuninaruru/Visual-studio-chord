import { useEffect, useMemo, useState } from "react";
import { ChordEditor } from "../editor/ChordEditor";
import {
  getProgressionTemplate,
  getSectionArrangementTemplate,
  sectionArrangementTemplatesForRole,
  STYLE_PRESETS,
  SUPPORTED_MODES,
  PITCH_CLASSES,
} from "../../music";
import type { ChordEdit, UpdateTiming } from "../../state";
import type { SectionArrangementAssemblyResult } from "../../music";
import type {
  Mode,
  SectionArrangementPlan,
  SectionArrangementRole,
  SectionDesign,
  SectionLinkMode,
  SectionSourceDefinition,
  SectionTemplateId,
  StylePresetId,
} from "../../types/music";
import { formatBarBeat, modeLabel } from "../../utils/musicFormat";

type OperationFeedback = {
  kind: "success" | "error";
  message: string;
  planId?: string | null;
  revision?: number | null;
};

type AssemblyErrorState = OperationFeedback & {
  planId: string | null;
  revision: number | null;
};

export interface SectionArrangementBuilderProps {
  plan?: SectionArrangementPlan;
  pendingCommit: boolean;
  updateTiming: UpdateTiming;
  onInitialize: () => boolean;
  onUpdateSection: (sectionId: string, patch: Partial<Omit<SectionDesign, "id" | "role">>) => boolean;
  onRegenerateSection: (sectionId: string) => boolean;
  onEditSectionChord: (sectionId: string, chordId: string, edit: ChordEdit) => boolean;
  onAddInstance: (sourceId: string, afterInstanceId?: string) => string | null;
  onDuplicateInstance: (instanceId: string) => string | null;
  onRemoveInstance: (instanceId: string) => boolean;
  onMoveInstance: (instanceId: string, direction: -1 | 1) => boolean;
  onSetLinkMode: (linkId: string, mode: SectionLinkMode) => boolean;
  onAssemble: () => SectionArrangementAssemblyResult;
  onNotify: (message: string) => void;
  onChordEditorOpenChange?: (open: boolean) => void;
}

const ROLE_LABELS: Readonly<Record<SectionArrangementRole, string>> = {
  intro: "Intro",
  aMelo: "Aメロ",
  bMelo: "Bメロ",
  cMelo: "Cメロ",
};

const ROLE_COPY: Readonly<Record<SectionArrangementRole, string>> = {
  intro: "曲の入口。空気感と最初のフックを決めます。",
  aMelo: "物語を進めるパート。歌の土台を作ります。",
  bMelo: "展開を持ち上げるパート。次のサビへ導きます。",
  cMelo: "いちばん印象を残すパート。解放感や対比を作ります。",
};

const SECTION_TEMPLATE_COPY: Readonly<Record<SectionTemplateId, { label: string; description: string }>> = {
  "intro-ambient": { label: "静かな導入", description: "余白を残した空気感から始めます。" },
  "intro-hook": { label: "導入フック", description: "最初から覚えやすい動きを置きます。" },
  "a-narrative": { label: "物語を進める", description: "歌を支える自然な流れを作ります。" },
  "a-groove": { label: "グルーヴ重視", description: "反復感のあるリズムで前へ進めます。" },
  "b-build": { label: "ビルドアップ", description: "サビ前に緊張感を積み上げます。" },
  "b-lift": { label: "リフト", description: "メロディが高揚する足場を作ります。" },
  "c-release": { label: "解放", description: "広がりのある到達点を作ります。" },
  "c-contrast": { label: "コントラスト", description: "前のパートと違う表情を見せます。" },
};

const MODE_LABELS: Readonly<Record<Mode, string>> = {
  major: "メジャー",
  naturalMinor: "ナチュラル・マイナー",
  harmonicMinor: "ハーモニック・マイナー",
  dorian: "ドリアン",
  mixolydian: "ミクソリディアン",
};

const STYLE_LABELS: Readonly<Record<StylePresetId, string>> = {
  pop: "ポップ",
  "j-pop": "J-Pop",
  rock: "ロック",
  jazz: "ジャズ",
  "lo-fi": "Lo-fi",
  edm: "EDM",
  ballad: "バラード",
  "game-music": "ゲーム音楽",
  random: "おまかせ",
};

const SECTION_LENGTHS = [8, 16, 24, 32] as const;
const LINK_LABELS: Readonly<Record<SectionLinkMode, string>> = {
  auto: "おまかせ",
  direct: "そのまま",
  dominant: "次へ導く",
  pivot: "共通コード",
};

const TECHNIQUE_LABELS: Readonly<Record<string, string>> = {
  direct: "そのまま自然につなぐ",
  pivot: "共通コードで転調する",
  secondaryDominant: "セカンダリードミナントで導く",
  commonTone: "共通音を保ってつなぐ",
  voiceLeading: "ボイスリーディングでつなぐ",
  tritoneSub: "裏コードで導く",
  backdoor: "バックドアで導く",
  diminishedApproach: "ディミニッシュで近づける",
  chromaticApproach: "半音アプローチで近づける",
  subdominantPrep: "サブドミナントで準備する",
};

const TIMING_LABELS: Readonly<Record<UpdateTiming, string>> = {
  immediate: "すぐに再生へ反映",
  nextBeat: "次の拍から再生へ反映",
  nextBar: "次の小節から再生へ反映",
  nextLoop: "次のループから再生へ反映",
};

function compatibleTemplates(role: SectionArrangementRole, mode: Mode) {
  return sectionArrangementTemplatesForRole(role).filter((template) =>
    getProgressionTemplate(template.progressionId)?.modes.includes(mode),
  );
}

function roleForSource(source: SectionSourceDefinition): string {
  return ROLE_LABELS[source.design.role] ?? source.design.role;
}

function safeIssueMessage(result: Extract<SectionArrangementAssemblyResult, { ok: false }>): string {
  const codes = new Set(result.issues.map((item) => item.code));
  if ([...codes].some((code) => code === "section.dirty")) {
    return "未反映のパーツがあります。対象パーツを生成してから、もう一度まとめてください。現在の曲は変更されていません。";
  }
  if ([...codes].some((code) => code.includes("pivot"))) {
    return "共通コードを作れないつなぎがあります。該当するつなぎをおまかせに戻して再試行してください。現在の曲は変更されていません。";
  }
  return "1曲にまとめられませんでした。設定を確認して再試行してください。現在の曲は変更されていません。";
}

function timingMessage(pendingCommit: boolean, updateTiming: UpdateTiming): string {
  return pendingCommit ? TIMING_LABELS[updateTiming] : "すぐに再生へ反映";
}

export function SectionArrangementBuilder({
  plan,
  pendingCommit,
  updateTiming,
  onInitialize,
  onUpdateSection,
  onRegenerateSection,
  onEditSectionChord,
  onAddInstance,
  onDuplicateInstance,
  onRemoveInstance,
  onMoveInstance,
  onSetLinkMode,
  onAssemble,
  onNotify,
  onChordEditorOpenChange,
}: SectionArrangementBuilderProps) {
  const [expanded, setExpanded] = useState(true);
  const [selectedChord, setSelectedChord] = useState<{
    planId: string;
    revision: number;
    sectionId: string;
    chordId: string;
  } | null>(null);
  const [operationFeedback, setOperationFeedback] = useState<OperationFeedback | null>(null);
  const [assemblyError, setAssemblyError] = useState<AssemblyErrorState | null>(null);

  const sourceById = useMemo(
    () => new Map((plan?.sections ?? []).map((source) => [source.design.id, source])),
    [plan],
  );
  const totalBars = useMemo(
    () => plan?.sequence.reduce((total, instance) => total + (sourceById.get(instance.sourceSectionId)?.design.bars ?? 0), 0) ?? 0,
    [plan, sourceById],
  );
  const referencedDirty = useMemo(
    () => [...new Set((plan?.sequence ?? [])
      .map((instance) => sourceById.get(instance.sourceSectionId))
      .filter((source): source is SectionSourceDefinition => Boolean(source?.dirty)))],
    [plan, sourceById],
  );
  const invalidPivotLinks = useMemo(() => (plan?.links ?? []).filter((link) => {
    const from = plan?.sequence.find((instance) => instance.id === link.fromInstanceId);
    const to = plan?.sequence.find((instance) => instance.id === link.toInstanceId);
    const fromSource = from ? sourceById.get(from.sourceSectionId) : undefined;
    const toSource = to ? sourceById.get(to.sourceSectionId) : undefined;
    return link.mode === "pivot"
      && fromSource?.design.key === toSource?.design.key
      && fromSource?.design.mode === toSource?.design.mode;
  }), [plan, sourceById]);
  const resolvedByLink = useMemo(
    () => new Map((plan?.resolvedLinks ?? []).map((link) => [link.linkId, link])),
    [plan],
  );
  const selectedSource = selectedChord ? sourceById.get(selectedChord.sectionId) : undefined;
  const selectedSourceChord = selectedSource?.dirty
    ? undefined
    : selectedSource?.material.chords.find((chord) => chord.id === selectedChord?.chordId);
  const effectiveSelectedChord = selectedSourceChord
    && selectedChord
    && plan
    && selectedChord.planId === plan.id
    && selectedChord.revision === plan.revision
    ? selectedChord
    : null;

  useEffect(() => {
    onChordEditorOpenChange?.(effectiveSelectedChord !== null);
    return () => onChordEditorOpenChange?.(false);
  }, [effectiveSelectedChord, onChordEditorOpenChange]);

  const status = !plan
    ? "never"
    : plan.assembledRevision === null
      ? "never"
      : plan.assembledRevision !== plan.revision
        ? "stale"
        : plan.manualSongEdited
          ? "manual"
          : "current";
  const statusLabel = status === "never"
    ? "まだ1曲にまとめていません"
    : status === "stale"
      ? "パーツまたは順番の変更が未反映です"
      : status === "manual"
        ? "完成曲に手動編集があります"
        : `完成曲へ反映済み${pendingCommit ? `（${timingMessage(true, updateTiming)}）` : ""}`;
  const assemblyLabel = status === "never"
    ? "1曲にまとめる"
    : status === "manual"
      ? "手動編集を置き換えてまとめ直す"
      : status === "stale"
        ? "変更を反映してまとめ直す"
        : "反映済み";
  const blockers = [
    ...referencedDirty.map((source) => ({
      key: `dirty-${source.design.id}`,
      message: `${roleForSource(source)}「${source.design.name}」は未反映です。`,
      sectionId: source.design.id,
      kind: "dirty" as const,
    })),
    ...invalidPivotLinks.map((link) => ({
      key: `pivot-${link.id}`,
      message: "同じキー・モードのセクションには共通コードによる転調がありません。",
      linkId: link.id,
      kind: "pivot" as const,
    })),
  ];

  const notify = (message: string) => {
    setOperationFeedback({ kind: "success", message });
    onNotify(message);
  };

  const notifyError = (message: string) => {
    setOperationFeedback({ kind: "error", message, planId: plan?.id ?? null, revision: plan?.revision ?? null });
    onNotify(message);
  };

  const commitName = (source: SectionSourceDefinition, draft: string, restore: () => void) => {
    const value = draft.trim();
    if (!value || value === source.design.name) {
      if (!value) {
        restore();
        notifyError("表示名は空欄にできません。元の名前へ戻しました。現在の曲は変更されていません。");
      }
      return;
    }
    if (onUpdateSection(source.design.id, { name: value })) {
      notify(`${roleForSource(source)}の名前を更新しました。Undoで戻せます。`);
    } else {
      restore();
      notifyError("パーツ名を更新できませんでした。元の名前へ戻しました。現在の曲は変更されていません。");
    }
  };

  const updateDesign = (source: SectionSourceDefinition, patch: Partial<Omit<SectionDesign, "id" | "role">>) => {
    if (onUpdateSection(source.design.id, patch)) {
      notify(`${roleForSource(source)}の設定を更新しました。生成すると内容が反映されます。`);
    } else {
      notifyError("パーツ設定を更新できませんでした。現在の曲は変更されていません。");
    }
  };

  const regenerate = (source: SectionSourceDefinition) => {
    if (onRegenerateSection(source.design.id)) {
      notify(`${roleForSource(source)}を生成しました。1曲にまとめるまで完成曲は変わりません。`);
    } else {
      notifyError(`${roleForSource(source)}を生成できませんでした。現在の曲は変更されていません。設定を確認してください。`);
    }
  };

  const moveInstance = (instanceId: string, direction: -1 | 1) => {
    if (onMoveInstance(instanceId, direction)) {
      notify("順番を変更しました。Undoで戻せます。");
    } else {
      notifyError("順番を変更できませんでした。現在の曲は変更されていません。");
    }
  };

  const duplicateInstance = (instanceId: string) => {
    if (onDuplicateInstance(instanceId)) {
      notify("パーツをくり返しました。Undoで戻せます。");
    } else {
      notifyError("パーツをくり返せませんでした。現在の曲は変更されていません。128小節以内か確認してください。");
    }
  };

  const removeInstance = (instanceId: string) => {
    if (onRemoveInstance(instanceId)) {
      notify("パーツを外しました。Undoで戻せます。");
    } else {
      notifyError("パーツを外せませんでした。現在の曲は変更されていません。最後の1パーツは残してください。");
    }
  };

  const addInstance = (sourceId: string, sourceLabel: string) => {
    if (onAddInstance(sourceId)) {
      notify(`${sourceLabel}を末尾に追加しました。Undoで戻せます。`);
    } else {
      notifyError(`${sourceLabel}を追加できませんでした。現在の曲は変更されていません。128小節以内か確認してください。`);
    }
  };

  const setLinkMode = (linkId: string, mode: SectionLinkMode, successMessage: string) => {
    if (onSetLinkMode(linkId, mode)) {
      notify(successMessage);
    } else {
      notifyError("つなぎ方を更新できませんでした。現在の曲は変更されていません。");
    }
  };

  const assemble = () => {
    setAssemblyError(null);
    const result = onAssemble();
    if (!result.ok) {
      const message = safeIssueMessage(result);
      setAssemblyError({
        kind: "error",
        message,
        planId: plan?.id ?? null,
        revision: plan?.revision ?? null,
      });
      setOperationFeedback(null);
      onNotify(message);
      return;
    }
    const message = `${result.composition.settings.bars}小節の完成曲へ反映しました。再生中なら${TIMING_LABELS[updateTiming]}。`;
    notify(message);
  };

  const visibleAssemblyError = assemblyError
    && plan
    && assemblyError.planId === plan.id
    && assemblyError.revision === plan.revision
    ? assemblyError.message
    : null;
  const visibleOperationFeedback = operationFeedback
    && (operationFeedback.kind !== "error"
      || (operationFeedback.planId === (plan?.id ?? null)
        && operationFeedback.revision === (plan?.revision ?? null)))
    ? operationFeedback
    : null;

  const primaryDisabled = status === "current" || blockers.length > 0;
  const jazzSectionWorkflow = plan?.sections.some((source) => source.material.settings.jazz !== undefined) ?? false;

  return (
    <section className="lane-section section-arrangement-builder" aria-labelledby="section-arrangement-title">
      <div className="lane-heading section-arrangement-heading">
        <div>
          <p className="eyebrow">SONG FORM</p>
          <h2 id="section-arrangement-title">Intro・Aメロ・Bメロ・Cメロを組み立てる</h2>
        </div>
        {plan && (
          <button
            type="button"
            className="secondary-button section-arrangement-toggle"
            aria-expanded={expanded}
            aria-controls="section-arrangement-content"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "折りたたむ" : "開く"}
          </button>
        )}
      </div>

      {!plan ? (
        <div className="section-arrangement-empty">
          <p>パーツを別々に作り、順番を決めてから一つの完成曲にまとめられます。</p>
          <p>現在の曲は、<strong>「1曲にまとめる」</strong>まで変更されません。</p>
          <button type="button" className="primary-button" onClick={() => {
            if (onInitialize()) notify("Intro・Aメロ・Bメロ・Cメロを作りました。順番と各パーツを編集できます。");
            else notifyError("パーツを作成できませんでした。現在の曲は変更されていません。");
          }}>
            4つのパーツを作る
          </button>
        </div>
      ) : (
        <>
          <div className="section-arrangement-summary" role="status" aria-live="polite">
            <span><strong>合計 {totalBars} / 128 小節</strong></span>
            <span>{statusLabel}</span>
          </div>
          {jazzSectionWorkflow && (
            <p className="field-hint section-jazz-notice">
              Jazz専用パイプラインを使うパーツは、各パーツの8 / 16 / 24 / 32小節グリッドに合わせてプロファイルを継承します。AABA / 12-bar bluesではなく、組み立て後はFreeフォームとして保存します。下の旧スタイル選択は無効です。
            </p>
          )}
          <div id="section-arrangement-content" hidden={!expanded}>
          <div className="section-arrangement-steps" aria-label="セクション作成の手順">
            <span className="is-active">1 パーツを作る</span>
            <span>2 順番を決める</span>
            <span>3 1曲にまとめる</span>
          </div>

          <div className="section-source-grid">
            {plan.sections.map((source) => {
              const design = source.design;
              const templates = compatibleTemplates(design.role, design.mode);
              const regenerateLabel = source.dirty ? "この設定で生成" : "別案を生成";
              const chordEditReason = source.dirty ? "先にこの設定で生成してください" : undefined;
              return (
                <article className="section-source-card" key={design.id} data-testid={`section-source-${design.id}`}>
                  <div className="section-source-card-heading">
                    <div>
                      <p className="section-role-label">{ROLE_LABELS[design.role]}</p>
                      <p className="section-role-description">{ROLE_COPY[design.role]}</p>
                    </div>
                    <span className={source.dirty ? "section-dirty-badge" : "section-clean-badge"}>
                      {source.dirty ? "未反映" : "生成済み"}
                    </span>
                  </div>
                  <label className="field section-name-field">
                    <span>表示名</span>
                    <input
                      key={`${design.id}-${design.name}`}
                      aria-label={`${ROLE_LABELS[design.role]}の表示名`}
                      defaultValue={design.name}
                      onBlur={(event) => commitName(source, event.currentTarget.value, () => { event.currentTarget.value = design.name; })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitName(source, event.currentTarget.value, () => { event.currentTarget.value = design.name; });
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          event.currentTarget.value = design.name;
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </label>
                  <div className="section-primary-fields">
                    <label className="field">
                      <span>テンプレート</span>
                      <select
                        aria-label={`${ROLE_LABELS[design.role]}のテンプレート`}
                        value={templates.some((template) => template.id === design.templateId)
                          ? design.templateId
                          : templates[0]?.id ?? design.templateId}
                        onChange={(event) => updateDesign(source, { templateId: event.target.value as SectionTemplateId })}
                      >
                        {templates.map((template) => {
                          const copy = SECTION_TEMPLATE_COPY[template.id];
                          return <option key={template.id} value={template.id}>{copy?.label ?? template.label}</option>;
                        })}
                      </select>
                      <small className="section-template-description">
                        {SECTION_TEMPLATE_COPY[design.templateId]?.description}
                      </small>
                    </label>
                    <label className="field">
                      <span>長さ</span>
                      <select
                        aria-label={`${ROLE_LABELS[design.role]}の小節数`}
                        value={design.bars}
                        onChange={(event) => updateDesign(source, { bars: Number(event.target.value) as SectionDesign["bars"] })}
                      >
                        {SECTION_LENGTHS.map((bars) => <option key={bars} value={bars}>{bars}小節</option>)}
                      </select>
                    </label>
                  </div>
                  <details className="section-details">
                    <summary>細かく調整</summary>
                    <div className="section-detail-fields">
                      <label className="field">
                        <span>キー</span>
                        <select aria-label={`${ROLE_LABELS[design.role]}のキー`} value={design.key} onChange={(event) => updateDesign(source, { key: event.target.value as SectionDesign["key"] })}>
                          {PITCH_CLASSES.map((pitch) => <option key={pitch} value={pitch}>{pitch}</option>)}
                        </select>
                      </label>
                      <label className="field">
                        <span>モード</span>
                        <select aria-label={`${ROLE_LABELS[design.role]}のモード`} value={design.mode} onChange={(event) => {
                          const mode = event.target.value as Mode;
                          const valid = compatibleTemplates(design.role, mode);
                          const current = getSectionArrangementTemplate(design.templateId);
                          updateDesign(source, {
                            mode,
                            ...(current && getProgressionTemplate(current.progressionId)?.modes.includes(mode)
                              ? {}
                              : { templateId: valid[0]?.id ?? design.templateId }),
                          });
                        }}>
                          {SUPPORTED_MODES.map((mode) => <option key={mode} value={mode}>{MODE_LABELS[mode] ?? modeLabel(mode)}</option>)}
                        </select>
                      </label>
                      <label className="field">
                        <span>スタイル</span>
                        <select
                          aria-label={`${ROLE_LABELS[design.role]}のスタイル`}
                          value={design.style}
                          disabled={source.material.settings.jazz !== undefined}
                          onChange={(event) => updateDesign(source, { style: event.target.value as StylePresetId })}
                        >
                          {[...Object.keys(STYLE_PRESETS) as StylePresetId[], "random" as const].map((style) => <option key={style} value={style}>{STYLE_LABELS[style]}</option>)}
                        </select>
                        {source.material.settings.jazz !== undefined && (
                          <small className="section-template-description">
                            Jazzプロファイルは生成設定から継承します。旧スタイルを変えるにはBasicでLegacyへ切り替えてください。
                          </small>
                        )}
                      </label>
                    </div>
                  </details>
                  {source.dirty && <p className="section-dirty-message">未反映。前回の内容を保持しています。この設定で生成すると更新されます。</p>}
                  <div className="section-material-summary">
                    <span>{source.material.chords.length}コード</span>
                    <span>{source.material.notes.length}ノート</span>
                    <span>{source.material.settings.bars}小節</span>
                  </div>
                  <div className="section-chord-strip" aria-label={`${ROLE_LABELS[design.role]}のコード一覧`}>
                    {source.material.chords.map((chord) => {
                      const barBeat = formatBarBeat(chord.startTick, source.material.ppq, source.material.ticksPerBar);
                      return (
                        <button
                          type="button"
                          key={chord.id}
                          className="section-chord-chip"
                          disabled={source.dirty}
                          title={chordEditReason ?? `${barBeat} ${chord.symbol}を編集`}
                          aria-label={`${ROLE_LABELS[design.role]} ${barBeat} ${chord.symbol}を編集`}
                          onClick={() => setSelectedChord({
                            planId: plan.id,
                            revision: plan.revision,
                            sectionId: design.id,
                            chordId: chord.id,
                          })}
                        >
                          <span>{barBeat}</span><strong>{chord.symbol}</strong>
                        </button>
                      );
                    })}
                  </div>
                  {source.dirty && <p className="section-chord-disabled-reason">先にこの設定で生成してください</p>}
                  <button type="button" className="secondary-button section-regenerate-button" onClick={() => regenerate(source)}>
                    {regenerateLabel}
                  </button>
                  {effectiveSelectedChord && selectedSourceChord && selectedSource?.design.id === design.id && (
                    <ChordEditor
                      chord={selectedSourceChord}
                      locked={false}
                      onApply={(edit) => {
                        const applied = onEditSectionChord(design.id, selectedSourceChord.id, edit);
                        if (applied) {
                          notify(`${ROLE_LABELS[design.role]}のコードを更新しました。1曲にまとめるまで完成曲は変わりません。`);
                        } else {
                          notifyError("パーツのコードを更新できませんでした。現在の曲は変更されていません。");
                        }
                        return applied;
                      }}
                      onClose={() => setSelectedChord(null)}
                    />
                  )}
                </article>
              );
            })}
          </div>

          <div className="section-sequence-block">
            <div className="section-subheading">
              <div><h3>2 順番を決める</h3><p>並べ替え、くり返し、不要なパーツの取り外しができます。</p></div>
              <strong>合計 {totalBars} / 128 小節</strong>
            </div>
            <div className="section-sequence-scroll" aria-label="完成曲の順番">
              {plan.sequence.map((instance, index) => {
                const source = sourceById.get(instance.sourceSectionId);
                if (!source) return null;
                const leftDisabled = index === 0;
                const rightDisabled = index === plan.sequence.length - 1;
                const repeatDisabled = totalBars + source.design.bars > 128;
                const removeDisabled = plan.sequence.length <= 1;
                return (
                  <div className="section-instance-card" key={instance.id}>
                    <div><span className="section-instance-index">{index + 1}</span><strong>{ROLE_LABELS[source.design.role]}</strong><span>{source.design.name}</span></div>
                    <small>{source.design.bars}小節</small>
                    <div className="section-instance-controls">
                      <button type="button" className="icon-text-button" disabled={leftDisabled} title={leftDisabled ? "先頭のパーツです" : "左へ移動"} aria-label={`${source.design.name}を左へ移動`} onClick={() => moveInstance(instance.id, -1)}>←</button>
                      <button type="button" className="icon-text-button" disabled={rightDisabled} title={rightDisabled ? "末尾のパーツです" : "右へ移動"} aria-label={`${source.design.name}を右へ移動`} onClick={() => moveInstance(instance.id, 1)}>→</button>
                      <button type="button" className="icon-text-button" disabled={repeatDisabled} title={repeatDisabled ? "128小節を超えるため追加できません" : "このパーツをくり返す"} aria-label={`${source.design.name}をくり返す`} onClick={() => duplicateInstance(instance.id)}>くり返す</button>
                      <button type="button" className="icon-text-button danger" disabled={removeDisabled} title={removeDisabled ? "最後の1パーツは外せません" : "このパーツを外す"} aria-label={`${source.design.name}を外す`} onClick={() => removeInstance(instance.id)}>外す</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="section-add-buttons" aria-label="パーツを末尾に追加">
              {plan.sections.map((source) => {
                const disabled = totalBars + source.design.bars > 128;
                return <button key={source.design.id} type="button" className="secondary-button" disabled={disabled} title={disabled ? "128小節を超えるため追加できません" : `${roleForSource(source)}を末尾に追加`} onClick={() => addInstance(source.design.id, roleForSource(source))}>末尾に{ROLE_LABELS[source.design.role]}を追加</button>;
              })}
            </div>
            <div className="section-joins">
              {plan.sequence.slice(1).map((to, index) => {
                const from = plan.sequence[index];
                if (!from) return null;
                const link = plan.links.find((candidate) => candidate.fromInstanceId === from.id && candidate.toInstanceId === to.id);
                const fromSource = sourceById.get(from.sourceSectionId);
                const toSource = sourceById.get(to.sourceSectionId);
                if (!link || !fromSource || !toSource) return null;
                const sameKeyMode = fromSource.design.key === toSource.design.key && fromSource.design.mode === toSource.design.mode;
                const resolved = resolvedByLink.get(link.id);
                return (
                  <div className="section-join-control" key={link.id}>
                    <span className="section-join-label">{ROLE_LABELS[fromSource.design.role]} → {ROLE_LABELS[toSource.design.role]}</span>
                    <label className="field">
                      <span>つなぎ方</span>
                      <select aria-label={`${fromSource.design.name}から${toSource.design.name}へのつなぎ方`} value={link.mode} onChange={(event) => setLinkMode(link.id, event.target.value as SectionLinkMode, "つなぎ方を更新しました。Undoで戻せます。")}>
                        {(Object.keys(LINK_LABELS) as SectionLinkMode[]).map((mode) => <option key={mode} value={mode} disabled={mode === "pivot" && sameKeyMode}>{LINK_LABELS[mode]}</option>)}
                      </select>
                    </label>
                    {link.mode === "pivot" && sameKeyMode && <div className="section-link-blocker" role="alert">同じキー・モードでは「共通コード」は使えません。<button type="button" className="text-button" onClick={() => setLinkMode(link.id, "auto", "つなぎ方をおまかせに戻しました。Undoで戻せます。")}>おまかせに戻す</button></div>}
                    {resolved && <div className="section-resolved-link"><strong>{TECHNIQUE_LABELS[resolved.technique] ?? resolved.technique}</strong><details><summary>技術的な説明</summary><p>{resolved.label}。{resolved.explanation}</p></details></div>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="section-assembly-block">
            <div className="section-subheading"><div><h3>3 1曲にまとめる</h3><p>各パーツは独立したまま、ここで初めて完成曲へ反映します。</p></div><span className="section-assembly-status">{statusLabel}</span></div>
            {status === "manual" && <p className="section-manual-warning">完成曲側の手動編集を置き換えます。実行後もUndoで戻せます。</p>}
            {blockers.length > 0 && <div className="section-blocker-list" role="status"><strong>先に解決してください</strong>{blockers.map((blocker) => <div key={blocker.key}><span>{blocker.message}</span>{blocker.kind === "dirty" && <button type="button" className="text-button" onClick={() => { if (blocker.sectionId && onRegenerateSection(blocker.sectionId)) notify("未反映のパーツを生成しました。もう一度まとめてください。"); else notifyError("未反映のパーツを生成できませんでした。現在の曲は変更されていません。"); }}>生成する</button>}{blocker.kind === "pivot" && <button type="button" className="text-button" onClick={() => { if (blocker.linkId) setLinkMode(blocker.linkId, "auto", "つなぎ方をおまかせに戻しました。Undoで戻せます。"); }}>おまかせに戻す</button>}</div>)}</div>}
            {visibleAssemblyError && <p className="section-assembly-error" role="alert">{visibleAssemblyError}</p>}
            {visibleOperationFeedback && <p className={visibleOperationFeedback.kind === "error" ? "section-operation-error" : "section-operation-message"} role={visibleOperationFeedback.kind === "error" ? "alert" : "status"} aria-live="polite">{visibleOperationFeedback.message}</p>}
            <button type="button" className="primary-button section-assemble-button" disabled={primaryDisabled} onClick={assemble}>{assemblyLabel}</button>
          </div>
          </div>
        </>
      )}
    </section>
  );
}

export default SectionArrangementBuilder;
