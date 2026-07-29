import { Icon } from "../../components/Icon";
import type {
  HarmonyPreferredDevice,
  ModelInfo,
} from "../../api/inferenceTypes";
import type {
  BarRange,
  RegenerationStrength,
  RegenerationTarget,
} from "../../types/music";

interface RegenerationDockProps {
  selectedRange: BarRange | null;
  lockedCount: number;
  target: RegenerationTarget;
  strength: RegenerationStrength;
  processing: boolean;
  harmonyModel: ModelInfo | null;
  preferredDevice: HarmonyPreferredDevice;
  onTargetChange: (target: RegenerationTarget) => void;
  onStrengthChange: (strength: RegenerationStrength) => void;
  onPreferredDeviceChange: (device: HarmonyPreferredDevice) => void;
  onRegenerate: () => void;
  onSelectAll: () => void;
}

const TARGETS: Array<{ value: RegenerationTarget; label: string }> = [
  { value: "all", label: "コード＋メロディ" },
  { value: "chords", label: "コードのみ" },
  { value: "melody", label: "メロディのみ" },
  { value: "pitch", label: "音高のみ" },
  { value: "rhythm", label: "リズムのみ" },
];

export function RegenerationDock({
  selectedRange,
  lockedCount,
  target,
  strength,
  processing,
  harmonyModel,
  preferredDevice,
  onTargetChange,
  onStrengthChange,
  onPreferredDeviceChange,
  onRegenerate,
  onSelectAll,
}: RegenerationDockProps) {
  return (
    <section className="regeneration-dock" aria-label="部分再生成">
      <div className="selection-status">
        <span className="selection-icon"><Icon name="sparkles" /></span>
        <div>
          <strong>{selectedRange ? `${selectedRange.startBar + 1}–${selectedRange.endBar} 小節を選択中` : "再生成する範囲を選択"}</strong>
          <span>{lockedCount > 0 ? `${lockedCount}小節を保護中` : "ロックした小節は変更されません"}</span>
        </div>
      </div>

      <div className="target-control" role="group" aria-label="再生成対象">
        {TARGETS.map((item) => (
          <button
            key={item.value}
            className={target === item.value ? "active" : ""}
            type="button"
            onClick={() => onTargetChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="regeneration-actions">
        {target === "chords" && (
          <label className="strength-control neural-device-control">
            <span>推論デバイス</span>
            <select
              aria-label="ニューラルハーモニーの推論デバイス"
              value={preferredDevice}
              onChange={(event) =>
                onPreferredDeviceChange(event.target.value as HarmonyPreferredDevice)}
              title="Autoは利用可能なアクセラレータを検出します。未確定中はCPUと表示しません。"
            >
              <option value="auto">Auto</option>
              <option value="mps">Apple MPS</option>
              <option value="cuda">CUDA</option>
              <option value="cpu">CPU</option>
            </select>
          </label>
        )}
        <label className="strength-control">
          <span>
            {target === "chords" && harmonyModel
              ? "変化量（Theory fallback）"
              : "変化量"}
          </span>
          <select
            aria-label="再生成の変化量"
            value={strength}
            onChange={(event) => onStrengthChange(event.target.value as RegenerationStrength)}
          >
            <option value="subtle">Subtle</option>
            <option value="moderate">Moderate</option>
            <option value="strong">Strong</option>
          </select>
        </label>
        <span
          id="regeneration-engine-note"
          className={`regeneration-engine-note${harmonyModel?.mock ? " is-mock" : ""}`}
          role="status"
        >
          {target !== "chords"
            ? "Theory generator"
            : harmonyModel
              ? harmonyModel.mock
                ? "Explicit Mock · untrained"
                : "Neural Harmony · trained checkpoint"
              : "Neural unavailable · Theory fallback"}
        </span>
        {target === "chords" && harmonyModel && (
          <span
            id="neural-conditioning-note"
            className="neural-conditioning-note"
          >
            Neural条件はメロディ・調性・固定コードのみ。スタイル・Mood・密度・
            複雑度・変化量はTheory fallbackとクライアント検証にのみ使われます。
          </span>
        )}
        {selectedRange ? (
          <button
            className="primary-button regenerate-button"
            type="button"
            onClick={onRegenerate}
            disabled={processing}
            aria-busy={processing}
            aria-describedby={target === "chords" && harmonyModel
              ? "regeneration-engine-note neural-conditioning-note"
              : "regeneration-engine-note"}
            title={processing
              ? "候補を生成しています。再生と編集は継続できます。"
              : target === "chords" && !harmonyModel
                ? "学習済みcheckpointまたは明示的Mockが利用できないため、理論生成へ安全にフォールバックします。"
                : "採用するまで編集中の曲は変更されません。"}
          >
            <Icon name="sparkles" />
            {processing ? "候補を生成中…" : "選択範囲を再生成"}
          </button>
        ) : (
          <button className="secondary-button select-all-button" type="button" onClick={onSelectAll}>
            曲全体を選択
          </button>
        )}
      </div>
    </section>
  );
}
