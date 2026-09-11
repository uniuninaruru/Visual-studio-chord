import { useState } from "react";
import type { BackendConnection } from "../../api/inferenceClient";
import { Icon } from "../../components/Icon";
import { DEFAULT_HARMONY_SETTINGS } from "../../music";
import { DEFAULT_JAZZ_SETTINGS } from "../../music/jazzProfiles";
import type { GeneratorSettingsPatch } from "../../state";
import type {
  BarCount,
  GeneratorSettings,
  JazzSettings,
  JazzStyleId,
  Mode,
  PitchClassName,
  StylePresetId,
  TimeSignature,
} from "../../types/music";
import { PhaseControls } from "./PhaseControls";

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

const JAZZ_STYLES: Array<{ value: JazzStyleId; label: string }> = [
  { value: "swing", label: "スウィング / Swing" },
  { value: "ballad", label: "バラード / Ballad" },
  { value: "bebop", label: "ビバップ / Bebop" },
  { value: "modern", label: "モダン / Modern" },
  { value: "neoSoul", label: "ネオソウル / Neo-Soul" },
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
  const jazzSettings = settings.jazz ?? DEFAULT_JAZZ_SETTINGS;
  const jazzEnabled = settings.jazz !== undefined;
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
        <div className="section-label">{jazzEnabled ? "Jazz theory / offline" : "ハーモニー"}</div>
        {!jazzEnabled && <>
          <label className="field">
            <span>作曲方式</span>
            <select aria-label="作曲方式" value={settings.melody.phraseDesign ? "phrase" : "classic"}
              onChange={(event) => onPatch({ melody: { phraseDesign: event.target.value === "phrase", hookStrength: settings.melody.hookStrength ?? 0.75 } })}>
              <option value="phrase">フレーズ主導 · 主題と応答</option>
              <option value="classic">従来の生成</option>
            </select>
            <span className="field-hint">{settings.melody.phraseDesign
              ? "短い主題を育て、サビで再び聴かせます。設定は生成時に反映されます。"
              : "以前の曲を再現する方式です。新しい生成を試すには「フレーズ主導」を選んで生成してください。"}</span>
          </label>
          {settings.melody.phraseDesign && <label className="field range-field">
            <span>フックのまとまり <strong>{Math.round((settings.melody.hookStrength ?? 0.75) * 100)}%</strong></span>
            <input aria-label="フックのまとまり" type="range" min="0" max="1" step="0.05"
              value={settings.melody.hookStrength ?? 0.75}
              onChange={(event) => onPatch({ melody: { hookStrength: Number(event.target.value) } })} />
            <span className="field-hint">低いほど自由に展開し、高いほど主題の形を保ちます。</span>
          </label>}
        </>}
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

        {jazzEnabled ? (
          <>
            <label className="field">
              <span>ジャズスタイル / Jazz style</span>
              <select
                aria-label="ジャズスタイル"
                value={jazzSettings.style}
                onChange={(event) => onPatch({
                  jazz: { ...jazzSettings, style: event.target.value as JazzStyleId },
                })}
              >
                {JAZZ_STYLES.map((style) => (
                  <option key={style.value} value={style.value}>{style.label}</option>
                ))}
              </select>
              <span className="field-hint">5つのプロファイルはオフラインのジャズ理論ルールで動作します。</span>
            </label>
            <label className="field">
              <span>フォーム / Form</span>
              <select
                aria-label="ジャズフォーム"
                value={jazzSettings.form}
                onChange={(event) => {
                  const form = event.target.value as JazzSettings["form"];
                  onPatch({
                    jazz: { ...jazzSettings, form },
                    ...(form === "blues" && ![12, 24, 48].includes(settings.bars)
                      ? { bars: 12 as BarCount }
                      : {}),
                  });
                }}
              >
                <option value="aaba">AABA</option>
                <option value="blues">12-bar blues</option>
                <option value="modal">Modal</option>
                <option value="free">Free</option>
              </select>
              <span className="field-hint">
                {jazzSettings.form === "blues"
                  ? "12小節ブルース。小節数は12 / 24 / 48のみです。"
                  : "曲の骨格を選びます。生成前に設定として保存されます。"}
              </span>
            </label>
            <label className="field range-field">
              <span>クロマティシズム / Chromaticism <strong>{Math.round(jazzSettings.chromaticism * 100)}%</strong></span>
              <input
                aria-label="クロマティシズム"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={jazzSettings.chromaticism}
                onChange={(event) => onPatch({ jazz: { ...jazzSettings, chromaticism: Number(event.target.value) } })}
              />
              <span className="field-hint">低いほどダイアトニック、高いほどアプローチ音や半音の彩りが増えます。</span>
            </label>
            <label className="field range-field">
              <span>バンドの掛け合い / Interaction <strong>{Math.round(jazzSettings.interaction * 100)}%</strong></span>
              <input
                aria-label="バンドの掛け合い"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={jazzSettings.interaction}
                onChange={(event) => onPatch({ jazz: { ...jazzSettings, interaction: Number(event.target.value) } })}
              />
              <span className="field-hint">低いほど独立したコンピング、高いほどリードの余白を聴いて応答します。</span>
            </label>
            <button
              className="text-button jazz-legacy-switch"
              type="button"
              onClick={() => onPatch({ jazz: null })}
            >
              旧プリセット（Legacy generation）へ切り替え
            </button>
          </>
        ) : (
          <label className="field">
            <span>スタイル / ムード</span>
            <select
              aria-label="スタイル"
              value={settings.style}
              onChange={(event) => {
                const style = event.target.value as StylePresetId;
                onPatch(style === "jazz"
                  ? { style, jazz: DEFAULT_JAZZ_SETTINGS }
                  : { style });
              }}
            >
              {STYLES.map((style) => (
                <option key={style.value} value={style.value}>{style.label}</option>
              ))}
            </select>
            <span className="field-hint">Jazzを選ぶと専用プロファイル設定へ切り替わります。旧プロジェクトは従来方式のままです。</span>
            <button
              className="text-button jazz-engine-switch"
              type="button"
              onClick={() => onPatch({ style: "jazz", jazz: DEFAULT_JAZZ_SETTINGS })}
            >
              ジャズ生成へ切り替え / Use jazz engine
            </button>
          </label>
        )}
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
              <option value={4} disabled={jazzSettings?.form === "blues"}>4 bars</option>
              <option value={8} disabled={jazzSettings?.form === "blues"}>8 bars</option>
              <option value={12}>12 bars</option>
              <option value={16} disabled={jazzSettings?.form === "blues"}>16 bars</option>
              <option value={24}>24 bars</option>
              <option value={32} disabled={jazzSettings?.form === "blues"}>32 bars</option>
              <option value={48}>48 bars</option>
            </select>
            {jazzSettings?.form === "blues" && (
              <span className="field-hint">12-bar bluesでは12 / 24 / 48小節だけ選べます。</span>
            )}
          </label>
        </div>
      </section>

      <section className="settings-section" hidden={activeTab !== "advanced"}>
        <div className="section-label">ハーモニー / メロディ</div>
        {jazzEnabled && (
          <p className="field-hint legacy-controls-notice">
            Jazz専用パイプラインでは、下記の旧ハーモニー・モチーフ用コントロールは使われません。キー / モード / BPM / 拍子 / 小節数と、メロディの音域・密度・休符・ベロシティは有効です。
          </p>
        )}
        <fieldset disabled={jazzEnabled} className="legacy-settings-fieldset">
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
        </fieldset>
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
          <span>休符率 <strong>{Math.round(settings.melody.restRate * 100)}%</strong></span>
          <input
            aria-label="休符率"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.melody.restRate}
            onChange={(event) => onPatch({ melody: { restRate: Number(event.target.value) } })}
          />
          <span className="field-hint">Jazzのラインに余白を作ります。バラードではスタイル側の余白も加わります。</span>
        </label>
        <label className="field range-field">
          <span>ベロシティ <strong>{settings.melody.velocity}</strong></span>
          <input
            aria-label="メロディベロシティ"
            type="range"
            min="1"
            max="127"
            step="1"
            value={settings.melody.velocity}
            onChange={(event) => onPatch({ melody: { velocity: Number(event.target.value) } })}
          />
          <div className="range-scale"><span>1</span><span>127</span></div>
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
            disabled={jazzEnabled}
            onChange={(event) => onPatch({ melody: { syncopation: Number(event.target.value) } })}
          />
          {jazzEnabled && <span className="field-hint">Jazzスタイルのアーティキュレーションが決めるため、この旧設定は無効です。</span>}
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
            disabled={jazzEnabled}
            onChange={(event) => onPatch({ melody: { leapProbability: Number(event.target.value) } })}
          />
          {jazzEnabled && <span className="field-hint">Jazzスタイルのフレーズ規則が決めるため、この旧設定は無効です。</span>}
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
            disabled={jazzEnabled}
            onChange={(event) => onPatch({ melody: { chordToneRate: Number(event.target.value) } })}
          />
          {jazzEnabled && <span className="field-hint">Jazzのガイドトーン規則が決めるため、この旧設定は無効です。</span>}
        </label>
        <div className="field-grid two-columns">
          <label className="field">
            <span>最低音</span>
            <select
              aria-label="メロディ最低音"
              value={settings.melody.minMidi}
              onChange={(event) => onPatch({ melody: { minMidi: Number(event.target.value) } })}
            >
              <option value={21}>A0（88鍵の最低音）</option>
              <option value={28}>E1</option>
              <option value={36}>C2</option>
              <option value={43}>G2</option>
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
              <option value={88}>E6</option>
              <option value={96}>C7</option>
              <option value={108}>C8（88鍵の最高音）</option>
            </select>
          </label>
        </div>
        <label className="field checkbox-field">
          <span>モチーフ展開</span>
          <input
            aria-label="モチーフ展開"
            type="checkbox"
            checked={motif.enabled}
            disabled={jazzEnabled}
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
                disabled={jazzEnabled}
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
                disabled={jazzEnabled}
                onChange={(event) => onPatch({
                  motif: { ...motif, transformationRate: Number(event.target.value) },
                })}
              />
            </label>
          </>
        )}
      </section>

      <div hidden={activeTab !== "advanced"}>
        {jazzEnabled ? (
          <section className="phase-controls legacy-controls-notice" aria-label="Jazz controls notice">
            <div className="section-label">Jazz専用設定</div>
            <p className="field-hint">
              このパイプラインはBasicのJazz style / Form / Chromaticism / Interactionに加えて、キー・モード・BPM・拍子・小節数とAdvancedのメロディ音域・密度・休符率・ベロシティを使用します。旧ハーモニー詳細を使いたい場合は、Basicの切替で旧プリセットへ戻してください。
            </p>
          </section>
        ) : (
          <PhaseControls settings={settings} onPatch={onPatch} />
        )}
      </div>

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
