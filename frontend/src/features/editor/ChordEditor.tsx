import { useEffect, useMemo, useRef, useState } from "react";
import type { StructuredChordEdit } from "../../state";
import { intervalsForQuality } from "../../music";
import { PITCH_CLASSES } from "../../music/scales";
import type { ChordEvent, ChordQuality, Tension } from "../../types/music";

const QUALITY_OPTIONS: readonly { value: ChordQuality; label: string }[] = [
  { value: "major", label: "メジャー" },
  { value: "minor", label: "マイナー" },
  { value: "dominant7", label: "ドミナント7" },
  { value: "major7", label: "メジャー7" },
  { value: "minor7", label: "マイナー7" },
  { value: "diminished", label: "ディミニッシュ" },
  { value: "halfDiminished7", label: "ハーフディミニッシュ7" },
  { value: "diminished7", label: "ディミニッシュ7" },
  { value: "augmented", label: "オーギュメント" },
  { value: "minorMajor7", label: "マイナー・メジャー7" },
  { value: "augmentedMajor7", label: "オーギュメント・メジャー7" },
  { value: "sus2", label: "サス2" },
  { value: "sus4", label: "サス4" },
  { value: "add9", label: "アド9" },
  { value: "minorAdd9", label: "マイナー・アド9" },
];

const TENSION_OPTIONS: readonly Tension[] = ["6", "9", "b9", "#9", "11", "#11", "13", "b13"];

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )].filter((element) => !element.hasAttribute("hidden"));
}

function hasExtendedChord(tensions: readonly Tension[], bass: string): boolean {
  return tensions.length > 0 || bass !== "";
}

type BassValue = NonNullable<ChordEvent["bass"]> | "";

interface ChordEditorProps {
  chord: ChordEvent;
  locked: boolean;
  onApply: (edit: StructuredChordEdit) => boolean;
  onClose: () => void;
}

export function ChordEditor({ chord, locked, onApply, onClose }: ChordEditorProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const [root, setRoot] = useState(chord.root);
  const [quality, setQuality] = useState<ChordQuality>(chord.quality);
  const [tensions, setTensions] = useState<Tension[]>([...(chord.tensions ?? [])]);
  const [bass, setBass] = useState<BassValue>(chord.bass ?? "");
  const [inversion, setInversion] = useState(
    hasExtendedChord(chord.tensions ?? [], chord.bass ?? "") ? 0 : chord.inversion,
  );
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  const extended = hasExtendedChord(tensions, bass);
  const inversionCount = intervalsForQuality(quality).length;
  const normalizedInversion = extended ? 0 : Math.min(inversion, Math.max(0, inversionCount - 1));
  const inversionChanged = !extended && normalizedInversion !== chord.inversion;
  const changed =
    root !== chord.root
    || quality !== chord.quality
    || tensions.join(",") !== (chord.tensions ?? []).join(",")
    || bass !== (chord.bass ?? "")
    || inversionChanged;
  const inversionReason = extended
    ? "テンションまたはスラッシュベースを含むコードは、基本形のみ適用できます。"
    : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = previousFocusRef.current;
    const first = dialog.querySelector<HTMLElement>(".chord-editor-form select:not([disabled])")
      ?? focusableElements(dialog)[0];
    (first ?? dialog).focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const firstFocusable = focusable[0]!;
      const lastFocusable = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  const tensionSet = useMemo(() => new Set(tensions), [tensions]);
  const toggleTension = (tension: Tension) => {
    setTensions((current) => current.includes(tension)
      ? current.filter((item) => item !== tension)
      : [...current, tension]);
    setApplyMessage(null);
  };

  const apply = () => {
    if (locked) {
      setApplyMessage("このコードはロックされた小節にあるため変更できません。解除してから適用してください。");
      return;
    }
    if (!changed) {
      setApplyMessage("変更がないため適用しません。");
      return;
    }
    const applied = onApply({
      root,
      quality,
      tensions,
      bass: bass === "" ? null : bass,
      inversion: normalizedInversion,
    });
    if (applied) onClose();
    else setApplyMessage("変更を適用できませんでした。値が同じか、隣接区間またはロックを確認してください。");
  };

  return (
    <div className="chord-editor-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="chord-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chord-editor-title"
        aria-describedby="chord-editor-description"
        tabIndex={-1}
      >
        <div className="chord-editor-heading">
          <div>
            <p className="eyebrow">CHORD SOUND</p>
            <h2 id="chord-editor-title">響きを編集</h2>
          </div>
          <button type="button" className="text-button" onClick={onClose}>キャンセル</button>
        </div>
        <p id="chord-editor-description" className="chord-editor-description">
          {chord.symbol} の root、品質、テンション、ベース、転回形を編集します。適用するまで正式データは変わりません。
        </p>

        <div className="chord-editor-form">
          <label className="field">
            <span>ルート</span>
            <select value={root} onChange={(event) => { setRoot(event.target.value as typeof root); setApplyMessage(null); }} disabled={locked}>
              {PITCH_CLASSES.map((pitch) => <option key={pitch} value={pitch}>{pitch}</option>)}
            </select>
          </label>
          <label className="field">
            <span>品質</span>
            <select value={quality} onChange={(event) => { setQuality(event.target.value as ChordQuality); setApplyMessage(null); }} disabled={locked}>
              {QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <fieldset className="chord-editor-fieldset" disabled={locked}>
          <legend>テンション</legend>
          <div className="chord-editor-tension-grid">
            {TENSION_OPTIONS.map((tension) => (
              <label key={tension} className="chord-editor-check">
                <input
                  type="checkbox"
                  checked={tensionSet.has(tension)}
                  disabled={locked}
                  onChange={() => toggleTension(tension)}
                />
                <span>{tension}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="chord-editor-form">
          <label className="field">
            <span>スラッシュベース</span>
            <select value={bass} onChange={(event) => { setBass(event.target.value as BassValue); setApplyMessage(null); }} disabled={locked}>
              <option value="">なし</option>
              {PITCH_CLASSES.map((pitch) => <option key={pitch} value={pitch}>{pitch}</option>)}
            </select>
          </label>
          <label className="field">
            <span>転回形</span>
            <select
              value={normalizedInversion}
              onChange={(event) => { setInversion(Number(event.target.value)); setApplyMessage(null); }}
              disabled={locked}
            >
              {Array.from({ length: inversionCount }, (_, index) => (
                <option key={index} value={index} disabled={extended && index !== 0}>
                  {index === 0 ? "基本形" : `第${index}転回`}
                </option>
              ))}
            </select>
          </label>
        </div>

        {inversionReason && <p className="chord-editor-hint">{inversionReason}</p>}
        {locked && <p id="chord-editor-locked-reason" className="chord-editor-hint is-warning">ロックされた小節のため入力と適用は無効です。キャンセルまたはEscは使用できます。</p>}
        {!locked && !changed && !applyMessage && (
          <p id="chord-editor-apply-help" className="chord-editor-hint">変更内容を選ぶと適用できます。</p>
        )}
        {applyMessage && <p id="chord-editor-apply-message" className="chord-editor-message" role="status">{applyMessage}</p>}

        <div className="chord-editor-actions">
          <button type="button" className="secondary-button" onClick={onClose}>キャンセル</button>
          <button
            type="button"
            className="primary-button"
            onClick={apply}
            disabled={locked || !changed}
            aria-describedby={locked
              ? "chord-editor-locked-reason"
              : !changed
                ? "chord-editor-apply-help"
                : applyMessage
                  ? "chord-editor-apply-message"
                  : undefined}
          >
            適用
          </button>
        </div>
      </div>
    </div>
  );
}
