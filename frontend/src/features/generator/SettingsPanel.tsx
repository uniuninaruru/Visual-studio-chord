import { useState } from "react";
import type { BackendConnection } from "../../api/inferenceClient";
import { Icon } from "../../components/Icon";
import { DEFAULT_HARMONY_SETTINGS } from "../../music";
import type { GeneratorSettingsPatch } from "../../state";
import type {
  BarCount,
  GeneratorSettings,
  Mode,
  PitchClassName,
  StylePresetId,
  TimeSignature,
} from "../../types/music";

const KEY_OPTIONS: PitchClassName[] = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

const STYLES: Array<{ value: StylePresetId; label: string }> = [
  { value: "pop", label: "Pop" },
  { value: "j-pop", label: "J-Pop" },
  { value: "rock", label: "Rock" },
  { value: "jazz", label: "Jazz" },
  { value: "lo-fi", label: "Lo-fi" },
  { value: "edm", label: "EDM" },
  { value: "ballad", label: "Ballad" },
  { value: "game-music", label: "Game Music" },
  { value: "random", label: "Random" },
];

interface SettingsPanelProps {
  settings: GeneratorSettings;
  backend: BackendConnection;
  mobileOpen: boolean;
  onPatch: (patch: GeneratorSettingsPatch) => void;
  onGenerate: () => void;
  onReset: () => void;
  onOpenDiagnostics: () => void;
  onMobileClose: () => void;
}

export function SettingsPanel({
  settings,
  backend,
  mobileOpen,
  onPatch,
  onGenerate,
  onReset,
  onOpenDiagnostics,
  onMobileClose,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<"basic" | "advanced" | "developer">("basic");
  const motif = settings.motif ?? { enabled: false, lengthBars: 1, transformationRate: 0.65 };
  const harmony = {
    complexity: settings.harmony?.complexity ?? DEFAULT_HARMONY_SETTINGS.complexity,
    borrowedChordRate:
      settings.harmony?.borrowedChordRate ?? DEFAULT_HARMONY_SETTINGS.borrowedChordRate,
    secondaryDominantRate:
      settings.harmony?.secondaryDominantRate
      ?? DEFAULT_HARMONY_SETTINGS.secondaryDominantRate,
    explorationRate:
      settings.harmony?.explorationRate ?? DEFAULT_HARMONY_SETTINGS.explorationRate,
    voiceLeadingStrength:
      settings.harmony?.voiceLeadingStrength ?? DEFAULT_HARMONY_SETTINGS.voiceLeadingStrength,
  };
  const advancedHarmonyEnabled = harmony.complexity === "advanced";
  const backendCanInfer = backend.state === "connected" && backend.inferenceAuthorized;
  const deviceLabel =
    backendCanInfer
      ? backend.models.activeRuntime === "cpu"
        ? "Local CPU"
        : backend.device.deviceName || `Local ${backend.models.activeRuntime.toUpperCase()}`
      : backend.state === "checking"
        ? "確認中"
        : "Browser";

  return (
    <aside className={`settings-panel ${mobileOpen ? "mobile-open" : ""}`} aria-label="生成設定">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">GENERATOR</p>
          <h2>生成設定</h2>
        </div>
        <div className="panel-actions">
          <button className="text-button mobile-close-button" type="button" onClick={onMobileClose}>閉じる</button>
          <button className="icon-button quiet" type="button" onClick={onReset} title="初期設定へ戻す">
            <Icon name="settings" />
          </button>
        </div>
      </div>

      <div className="settings-tabs" role="tablist" aria-label="設定レベル">
        {(["basic", "advanced", "developer"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "active" : ""}
            onClick={() => setActiveTab(tab)}
          >
            {tab[0]?.toUpperCase()}{tab.slice(1)}
          </button>
        ))}
      </div>

      <section className="settings-section" hidden={activeTab !== "basic"}>
        <div className="section-label">ハーモニー</div>
        <div className="field-grid two-columns">
          <label className="field">
            <span>キー</span>
            <select
              aria-label="キー"
              value={settings.key}
              onChange={(event) => onPatch({ key: event.target.value as PitchClassName })}
            >
              {KEY_OPTIONS.map((key) => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>スケール</span>
            <select
              aria-label="スケール"
              value={settings.mode}
              onChange={(event) => onPatch({ mode: event.target.value as Mode })}
            >
              <option value="major">Major</option>
              <option value="naturalMinor">Natural Minor</option>
              <option value="harmonicMinor">Harmonic Minor</option>
              <option value="dorian">Dorian</option>
              <option value="mixolydian">Mixolydian</option>
            </select>
          </label>
        </div>

        <label className="field">
          <span>スタイル / ムード</span>
          <select
            aria-label="スタイル"
            value={settings.style}
            onChange={(event) => onPatch({ style: event.target.value as StylePresetId })}
          >
            {STYLES.map((style) => (
              <option key={style.value} value={style.value}>{style.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="settings-section" hidden={activeTab !== "basic"}>
        <div className="section-label">タイムライン</div>
        <label className="field range-field">
          <span>BPM <strong>{settings.bpm}</strong></span>
          <input
            aria-label="BPM"
            type="range"
            min="40"
            max="240"
            step="1"
            value={settings.bpm}
            onChange={(event) => onPatch({ bpm: Number(event.target.value) })}
          />
          <div className="range-scale"><span>40</span><span>240</span></div>
        </label>
        <div className="field-grid two-columns">
          <label className="field">
            <span>拍子</span>
            <select
              aria-label="拍子"
              value={settings.timeSignature}
              onChange={(event) => onPatch({ timeSignature: event.target.value as TimeSignature })}
            >
              <option value="4/4">4 / 4</option>
              <option value="3/4">3 / 4</option>
              <option value="6/8">6 / 8</option>
            </select>
          </label>
          <label className="field">
            <span>小節数</span>
            <select
              aria-label="小節数"
              value={settings.bars}
              onChange={(event) => onPatch({ bars: Number(event.target.value) as BarCount })}
            >
              <option value={4}>4 bars</option>
              <option value={8}>8 bars</option>
              <option value={16}>16 bars</option>
            </select>
          </label>
        </div>
      </section>

      <section className="settings-section" hidden={activeTab !== "advanced"}>
        <div className="section-label">ハーモニー / メロディ</div>
        <label className="field">
          <span>コードの複雑さ</span>
          <select
            aria-label="コードの複雑さ"
            value={harmony.complexity}
            onChange={(event) => onPatch({
              harmony: {
                ...harmony,
                complexity: event.target.value as "triads" | "sevenths" | "advanced",
              },
            })}
          >
            <option value="triads">Triads</option>
            <option value="sevenths">7th chords</option>
            <option value="advanced">Advanced / 借用和音</option>
          </select>
        </label>
        <label className="field range-field">
          <span>借用和音率 <strong>{Math.round(harmony.borrowedChordRate * 100)}%</strong></span>
          <input
            aria-label="借用和音率"
            aria-describedby="borrowed-chord-rate-hint"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={harmony.borrowedChordRate}
            disabled={!advancedHarmonyEnabled}
            onChange={(event) => onPatch({
              harmony: { ...harmony, borrowedChordRate: Number(event.target.value) },
            })}
          />
          <span className="field-hint" id="borrowed-chord-rate-hint">
            Advanced時のみ有効。100% = スタイル既定、0% = 無効。
          </span>
        </label>
        <label className="field range-field">
          <span>
            セカンダリードミナント率
            {' '}<strong>{Math.round(harmony.secondaryDominantRate * 100)}%</strong>
          </span>
          <input
            aria-label="セカンダリードミナント率"
            aria-describedby="secondary-dominant-rate-hint"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={harmony.secondaryDominantRate}
            disabled={!advancedHarmonyEnabled}
            onChange={(event) => onPatch({
              harmony: { ...harmony, secondaryDominantRate: Number(event.target.value) },
            })}
          />
          <span className="field-hint" id="secondary-dominant-rate-hint">
            Advanced時のみ有効。100% = スタイル既定、0% = 無効。
          </span>
        </label>
        <label className="field range-field">
          <span>探索率 <strong>{Math.round(harmony.explorationRate * 100)}%</strong></span>
          <input
            aria-label="ハーモニー探索率"
            aria-describedby="harmony-exploration-rate-hint"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={harmony.explorationRate}
            disabled={!advancedHarmonyEnabled}
            onChange={(event) => onPatch({
              harmony: { ...harmony, explorationRate: Number(event.target.value) },
            })}
          />
          <span className="field-hint" id="harmony-exploration-rate-hint">
            Advanced時のみ有効。100% = スタイル既定、0% = 無効。
          </span>
        </label>
        <label className="field range-field">
          <span>
            ボイスリーディング強度
            {' '}<strong>{Math.round(harmony.voiceLeadingStrength * 100)}%</strong>
          </span>
          <input
            aria-label="ボイスリーディング強度"
            aria-describedby="voice-leading-strength-hint"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={harmony.voiceLeadingStrength}
            onChange={(event) => onPatch({
              harmony: { ...harmony, voiceLeadingStrength: Number(event.target.value) },
            })}
          />
          <span className="field-hint" id="voice-leading-strength-hint">
            100% = 前のコードからの移動を最小化、0% = 前のコードを考慮しない。
          </span>
        </label>
        <label className="field range-field">
          <span>密度 <strong>{Math.round(settings.melody.density * 100)}%</strong></span>
          <input
            aria-label="メロディ密度"
            type="range"
            min="0.15"
            max="1"
            step="0.05"
            value={settings.melody.density}
            onChange={(event) => onPatch({ melody: { density: Number(event.target.value) } })}
          />
        </label>
        <label className="field range-field">
          <span>シンコペーション <strong>{Math.round(settings.melody.syncopation * 100)}%</strong></span>
          <input
            aria-label="シンコペーション"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.melody.syncopation}
            onChange={(event) => onPatch({ melody: { syncopation: Number(event.target.value) } })}
          />
        </label>
        <label className="field range-field">
          <span>跳躍量 <strong>{Math.round(settings.melody.leapProbability * 100)}%</strong></span>
          <input
            aria-label="メロディ跳躍量"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.melody.leapProbability}
            onChange={(event) => onPatch({ melody: { leapProbability: Number(event.target.value) } })}
          />
        </label>
        <label className="field range-field">
          <span>コードトーン率 <strong>{Math.round(settings.melody.chordToneRate * 100)}%</strong></span>
          <input
            aria-label="コードトーン率"
            type="range"
            min="0.35"
            max="1"
            step="0.05"
            value={settings.melody.chordToneRate}
            onChange={(event) => onPatch({ melody: { chordToneRate: Number(event.target.value) } })}
          />
        </label>
        <div className="field-grid two-columns">
          <label className="field">
            <span>最低音</span>
            <select
              aria-label="メロディ最低音"
              value={settings.melody.minMidi}
              onChange={(event) => onPatch({ melody: { minMidi: Number(event.target.value) } })}
            >
              <option value={48}>C3</option>
              <option value={55}>G3</option>
              <option value={60}>C4</option>
            </select>
          </label>
          <label className="field">
            <span>最高音</span>
            <select
              aria-label="メロディ最高音"
              value={settings.melody.maxMidi}
              onChange={(event) => onPatch({ melody: { maxMidi: Number(event.target.value) } })}
            >
              <option value={72}>C5</option>
              <option value={76}>E5</option>
              <option value={84}>C6</option>
            </select>
          </label>
        </div>
        <label className="field checkbox-field">
          <span>モチーフ展開</span>
          <input
            aria-label="モチーフ展開"
            type="checkbox"
            checked={motif.enabled}
            onChange={(event) => onPatch({ motif: { ...motif, enabled: event.target.checked } })}
          />
        </label>
        {motif.enabled && (
          <>
            <label className="field">
              <span>モチーフ長</span>
              <select
                aria-label="モチーフ長"
                value={motif.lengthBars}
                onChange={(event) => onPatch({
                  motif: { ...motif, lengthBars: Number(event.target.value) as 1 | 2 },
                })}
              >
                <option value={1}>1 bar</option>
                <option value={2}>2 bars</option>
              </select>
            </label>
            <label className="field range-field">
              <span>変形率 <strong>{Math.round(motif.transformationRate * 100)}%</strong></span>
              <input
                aria-label="モチーフ変形率"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={motif.transformationRate}
                onChange={(event) => onPatch({
                  motif: { ...motif, transformationRate: Number(event.target.value) },
                })}
              />
            </label>
          </>
        )}
      </section>

      <section className="settings-section seed-section" hidden={activeTab !== "basic"}>
        <label className="field">
          <span>再現シード</span>
          <input
            aria-label="再現シード"
            type="text"
            value={String(settings.seed)}
            onChange={(event) => onPatch({ seed: event.target.value })}
            spellCheck="false"
          />
        </label>
        <p className="field-hint">同じ設定とシードは同じ曲を生成します。</p>
      </section>

      <section className="settings-section developer-settings" hidden={activeTab !== "developer"}>
        <div className="section-label">推論と診断</div>
        <dl className="developer-setting-list">
          <div><dt>Backend</dt><dd>{backendCanInfer ? "Local API" : backend.state === "connected" ? "Browser fallback（access required）" : "Browser fallback"}</dd></div>
          <div><dt>Device</dt><dd>{backend.state === "connected" ? backend.device.deviceName : "Browser CPU"}</dd></div>
          <div><dt>Model</dt><dd>{backend.state === "connected" ? backend.models.activeModel : "browser-linear-v1"}</dd></div>
          <div><dt>Precision</dt><dd>FP32</dd></div>
          <div><dt>Batch size</dt><dd>64（OOM時に自動縮小）</dd></div>
          <div><dt>Server URL</dt><dd>Same origin / API proxy</dd></div>
        </dl>
        <button className="secondary-button diagnostics-open-button" type="button" onClick={onOpenDiagnostics}>
          Diagnosticsを開く
        </button>
        <p className="field-hint">CUDA、ONNX、MPSを理解しなくてもAutoで安全な実行モードを選びます。</p>
      </section>

      <div className="generator-footer">
        <div className={`device-pill ${backend.state}`}>
          <span className="status-dot" />
          <Icon name="server" />
          <span>{deviceLabel}</span>
        </div>
        <button className="primary-button generate-button" type="button" onClick={onGenerate}>
          <Icon name="sparkles" />
          この設定で生成
        </button>
      </div>
    </aside>
  );
}
