import { PROGRESSION_TEMPLATES } from "../../music";
import type { GeneratorSettingsPatch } from "../../state";
import type {
  GeneratorSettings,
  ArpeggioSettings,
  TensionSettings,
  GrooveTemplateName,
  MelodyScaleName,
  SongFormId,
} from "../../types/music";

type ArpeggioPattern = NonNullable<ArpeggioSettings["pattern"]>;
type TensionCeiling = NonNullable<TensionSettings["ceiling"]>;

interface PhaseControlsProps {
  settings: GeneratorSettings;
  onPatch: (patch: GeneratorSettingsPatch) => void;
}

const GROOVES: Array<{ value: GrooveTemplateName; label: string }> = [
  { value: "straight", label: "まっすぐ" },
  { value: "swing8", label: "8分スウィング" },
  { value: "swing16", label: "16分スウィング" },
  { value: "shuffle", label: "シャッフル" },
  { value: "bossa", label: "ボサノヴァ" },
  { value: "laidBack", label: "少し後ろノリ" },
  { value: "pushed", label: "少し前ノリ" },
  { value: "backbeat", label: "バックビート" },
];

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="phase-toggle">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function PhaseControls({ settings, onPatch }: PhaseControlsProps) {
  const counterpoint = settings.arrangement?.counterpoint ?? {
    enabled: false,
    position: "below" as const,
    independence: 0.65,
  };
  const canon = settings.arrangement?.canon ?? {
    enabled: false,
    delayBeats: 2,
    interval: 7,
    inverted: false,
  };
  const polyrhythm = settings.arrangement?.polyrhythm ?? {
    enabled: false,
    pulses: 3,
    spanBars: 1,
  };
  const patchArrangement = (
    patch: Partial<NonNullable<GeneratorSettings["arrangement"]>>,
  ) => onPatch({
    arrangement: {
      ...settings.arrangement,
      ...patch,
    },
  });
  const harmonicPace = settings.harmonicRhythm?.barsPerChord === 2
    ? "slow"
    : (settings.harmonicRhythm?.changesPerBar ?? 1) > 1
      ? "busy"
      : "normal";
  const harmonyColor =
    settings.harmony?.complexity === "advanced"
      ? (settings.harmony.explorationRate ?? 0) >= 0.65
        ? "adventurous"
        : "colorful"
      : settings.harmony?.complexity === "sevenths"
        ? "rich"
        : "simple";

  return (
    <section className="phase-controls" aria-labelledby="phase-controls-title">
      <div className="section-label" id="phase-controls-title">曲づくりアシスト（Phase A〜D）</div>
      <p className="field-hint phase-intro">
        難しい理論名を知らなくても大丈夫です。開いた項目だけが生成に反映されます。
      </p>

      <details className="phase-card" open>
        <summary>
          <span className="phase-badge">A</span>
          <span><strong>曲の流れ</strong><small>コード進行・構成・自然なつながり</small></span>
        </summary>
        <div className="phase-card-body">
          <label className="field">
            <span>曲の構成</span>
            <select
              aria-label="曲の構成"
              value={settings.songForm?.form ?? "none"}
              onChange={(event) => onPatch({
                songForm: {
                  ...settings.songForm,
                  form: event.target.value as SongFormId,
                },
              })}
            >
              <option value="none">ひと続き（シンプル）</option>
              <option value="verseChorus">Aメロ → Bメロ → サビ</option>
              <option value="aaba">A → A → B → A</option>
              <option value="throughComposed">場面ごとに変化</option>
            </select>
          </label>
          <label className="field">
            <span>コードの変わる速さ</span>
            <select
              aria-label="コードの変わる速さ"
              value={harmonicPace}
              onChange={(event) => {
                const value = event.target.value;
                onPatch({
                  harmonicRhythm: value === "slow"
                    ? { barsPerChord: 2, changesPerBar: 1, cadentialAcceleration: true }
                    : value === "busy"
                      ? { barsPerChord: 1, changesPerBar: 2, cadentialAcceleration: true }
                      : { barsPerChord: 1, changesPerBar: 1, cadentialAcceleration: true },
                });
              }}
            >
              <option value="slow">ゆっくり（2小節ごと）</option>
              <option value="normal">標準（1小節ごと）</option>
              <option value="busy">細かい（1小節に2回）</option>
            </select>
          </label>
          <label className="field">
            <span>コードの彩り</span>
            <select
              aria-label="コードの彩り"
              value={harmonyColor}
              onChange={(event) => {
                const value = event.target.value;
                const current = settings.harmony ?? {
                  complexity: "triads" as const,
                  borrowedChordRate: 1,
                  secondaryDominantRate: 1,
                  explorationRate: 1,
                  voiceLeadingStrength: 1,
                };
                onPatch({
                  harmony: value === "simple"
                    ? {
                        ...current,
                        complexity: "triads",
                        borrowedChordRate: 0,
                        secondaryDominantRate: 0,
                        explorationRate: 0,
                      }
                    : value === "rich"
                      ? {
                          ...current,
                          complexity: "sevenths",
                          borrowedChordRate: 0,
                          secondaryDominantRate: 0,
                          explorationRate: 0.25,
                        }
                      : value === "colorful"
                        ? {
                            ...current,
                            complexity: "advanced",
                            borrowedChordRate: 0.55,
                            secondaryDominantRate: 0.6,
                            explorationRate: 0.5,
                          }
                        : {
                            ...current,
                            complexity: "advanced",
                            borrowedChordRate: 0.85,
                            secondaryDominantRate: 0.85,
                            explorationRate: 0.8,
                          },
                  ...(value === "colorful" || value === "adventurous"
                    ? {
                        functionalHarmony: {
                          enabled: true,
                          exploration: value === "adventurous" ? 0.7 : 0.4,
                        },
                      }
                    : {}),
                });
              }}
            >
              <option value="simple">シンプル（三和音中心）</option>
              <option value="rich">豊か（7thを追加）</option>
              <option value="colorful">カラフル（借用・二次ドミナント）</option>
              <option value="adventurous">冒険的（代理・テンション多め）</option>
            </select>
            <span className="field-hint">
              借用和音は1〜2個で戻し、二次ドミナントは次のコードへ解決させます。
            </span>
          </label>
          <label className="field">
            <span>定番コード進行</span>
            <select
              aria-label="定番コード進行"
              value={settings.progressionId ?? ""}
              onChange={(event) => onPatch({
                progressionId: event.target.value || undefined,
              })}
            >
              <option value="">スタイルから自動選択</option>
              {PROGRESSION_TEMPLATES.map((progression) => (
                <option key={progression.id} value={progression.id}>
                  {progression.label}{progression.numeric ? `（${progression.numeric}）` : ""}
                </option>
              ))}
            </select>
          </label>
          <Toggle
            label="フレーズを文章のように組み立てる"
            description="始まり・盛り上がり・着地を作ります"
            checked={settings.phraseGrammar?.enabled ?? false}
            onChange={(enabled) => onPatch({ phraseGrammar: { enabled } })}
          />
          <Toggle
            label="コードの役割から流れを作る"
            description="落ち着き → 展開 → 緊張 → 解決"
            checked={settings.functionalHarmony?.enabled ?? false}
            onChange={(enabled) => onPatch({
              functionalHarmony: {
                enabled,
                exploration: settings.functionalHarmony?.exploration ?? 0.35,
              },
            })}
          />
          <Toggle
            label="左手・右手のピアノボイシング"
            description="左手はベース、右手は3声。共通音を残して滑らかにつなぎます"
            checked={settings.voiceLeading?.enabled ?? false}
            onChange={(enabled) => onPatch({
              voiceLeading: {
                enabled,
                profile: settings.voiceLeading?.profile ?? "pop",
              },
            })}
          />
        </div>
      </details>

      <details className="phase-card">
        <summary>
          <span className="phase-badge">B</span>
          <span><strong>歌えるメロディ</strong><small>骨格・装飾音・モチーフ</small></span>
        </summary>
        <div className="phase-card-body">
          <Toggle
            label="メロディに山と着地点を作る"
            description="フレーズ設計も一緒にONになります"
            checked={settings.melodicSkeleton?.enabled ?? false}
            onChange={(enabled) => onPatch({
              melodicSkeleton: { enabled },
              ...(enabled ? { phraseGrammar: { enabled: true } } : {}),
            })}
          />
          <Toggle
            label="経過音や飾り音を足す"
            description="コード外の音も、必ず自然に解決させます"
            checked={settings.nonChordTones?.enabled ?? false}
            onChange={(enabled) => onPatch({
              nonChordTones: {
                enabled,
                rate: settings.nonChordTones?.rate ?? 0.35,
                types: settings.nonChordTones?.types,
              },
            })}
          />
          {settings.nonChordTones?.enabled && (
            <label className="field range-field">
              <span>飾り音の量 <strong>{Math.round((settings.nonChordTones.rate ?? 0.35) * 100)}%</strong></span>
              <input
                type="range"
                min="0.1"
                max="0.8"
                step="0.05"
                value={settings.nonChordTones.rate ?? 0.35}
                onChange={(event) => onPatch({
                  nonChordTones: {
                    ...settings.nonChordTones,
                    enabled: true,
                    rate: Number(event.target.value),
                  },
                })}
              />
            </label>
          )}
        </div>
      </details>

      <details className="phase-card">
        <summary>
          <span className="phase-badge">C</span>
          <span><strong>和音を豊かに</strong><small>転調・別モード・ペンタトニック</small></span>
        </summary>
        <div className="phase-card-body">
          <label className="field">
            <span>最後のサビで転調</span>
            <select
              aria-label="最後のサビで転調"
              value={settings.songForm?.finalLift ?? 0}
              disabled={!settings.songForm || settings.songForm.form === "none"}
              onChange={(event) => onPatch({
                songForm: {
                  ...(settings.songForm ?? { form: "verseChorus" }),
                  finalLift: Number(event.target.value),
                },
              })}
            >
              <option value={0}>転調しない</option>
              <option value={1}>半音上げる</option>
              <option value={2}>全音上げる</option>
            </select>
            {(!settings.songForm || settings.songForm.form === "none") && (
              <span className="field-hint">Phase Aで「曲の構成」を選ぶと使えます。</span>
            )}
          </label>
          <Toggle
            label="転調の境目を共通コードでつなぐ"
            description="共通コードがない場合は安全に直接転調します"
            checked={settings.pivotModulation?.enabled ?? false}
            onChange={(enabled) => onPatch({ pivotModulation: { enabled } })}
          />
          <Toggle
            label="コードとメロディを別モードにする"
            description="少し不思議でゲーム音楽的な色になります"
            checked={settings.songForm?.polytonal ?? false}
            onChange={(polytonal) => onPatch({
              songForm: {
                ...(settings.songForm ?? { form: "verseChorus" }),
                polytonal,
              },
            })}
          />
          <label className="field">
            <span>メロディの音数</span>
            <select
              aria-label="メロディスケール"
              value={settings.songForm?.melodyScale ?? "diatonic"}
              onChange={(event) => onPatch({
                songForm: {
                  ...(settings.songForm ?? { form: "verseChorus" }),
                  melodyScale: event.target.value as MelodyScaleName,
                },
              })}
            >
              <option value="diatonic">通常の7音</option>
              <option value="yonaNuki">ヨナ抜き（明るい5音）</option>
              <option value="niroNuki">ニロ抜き（暗い5音）</option>
            </select>
          </label>
        </div>
      </details>

      <details className="phase-card">
        <summary>
          <span className="phase-badge">D</span>
          <span><strong>ノリと多声部</strong><small>グルーヴ・対旋律・カノン・ポリリズム</small></span>
        </summary>
        <div className="phase-card-body">
          <Toggle
            label="音を均等に散らすリズム"
            description="少ない打点でも隙間が偏らないユークリッドリズム"
            checked={settings.euclideanRhythm?.enabled ?? false}
            onChange={(enabled) => onPatch({
              euclideanRhythm: {
                enabled,
                onsets: settings.euclideanRhythm?.onsets ?? 5,
                steps: settings.euclideanRhythm?.steps ?? 8,
                rotation: settings.euclideanRhythm?.rotation ?? 0,
              },
            })}
          />
          <Toggle
            label="人が弾くようなノリを足す"
            description="音の位置と強さを安全な範囲で揺らします"
            checked={settings.groove?.enabled ?? false}
            onChange={(enabled) => onPatch({
              groove: {
                enabled,
                template: settings.groove?.template ?? "laidBack",
                amount: settings.groove?.amount ?? 0.65,
              },
            })}
          />
          {settings.groove?.enabled && (
            <label className="field">
              <span>ノリの種類</span>
              <select
                value={settings.groove.template}
                onChange={(event) => onPatch({
                  groove: {
                    ...settings.groove!,
                    template: event.target.value as GrooveTemplateName,
                  },
                })}
              >
                {GROOVES.map((groove) => (
                  <option key={groove.value} value={groove.value}>{groove.label}</option>
                ))}
              </select>
            </label>
          )}

          <div className="phase-subheading">追加する声部</div>
          <Toggle
            label="対旋律"
            description="主旋律を邪魔しない、もう一本のメロディ"
            checked={counterpoint.enabled}
            onChange={(enabled) => patchArrangement({
              counterpoint: { ...counterpoint, enabled },
            })}
          />
          {counterpoint.enabled && (
            <label className="field">
              <span>対旋律の位置</span>
              <select
                value={counterpoint.position ?? "below"}
                onChange={(event) => patchArrangement({
                  counterpoint: {
                    ...counterpoint,
                    enabled: true,
                    position: event.target.value as "above" | "below",
                  },
                })}
              >
                <option value="below">主旋律の下</option>
                <option value="above">主旋律の上</option>
              </select>
            </label>
          )}
          <Toggle
            label="カノン"
            description="主旋律を少し遅らせて追いかけます"
            checked={canon.enabled}
            onChange={(enabled) => patchArrangement({
              canon: { ...canon, enabled },
            })}
          />
          {canon.enabled && (
            <label className="field">
              <span>追いかける間隔</span>
              <select
                value={canon.delayBeats}
                onChange={(event) => patchArrangement({
                  canon: { ...canon, enabled: true, delayBeats: Number(event.target.value) },
                })}
              >
                <option value={1}>1拍後</option>
                <option value={2}>2拍後</option>
                <option value={4}>1小節後</option>
              </select>
            </label>
          )}
          <Toggle
            label="ポリリズム低音"
            description="小節の拍とは違う数で割ったパルスを鳴らします"
            checked={polyrhythm.enabled}
            onChange={(enabled) => patchArrangement({
              polyrhythm: { ...polyrhythm, enabled },
            })}
          />
          {polyrhythm.enabled && (
            <label className="field">
              <span>1小節のパルス数</span>
              <select
                value={polyrhythm.pulses}
                onChange={(event) => patchArrangement({
                  polyrhythm: {
                    ...polyrhythm,
                    enabled: true,
                    pulses: Number(event.target.value),
                  },
                })}
              >
                <option value={3}>3（3対4）</option>
                <option value={5}>5（5対4）</option>
                <option value={7}>7（7対4）</option>
              </select>
            </label>
          )}
        </div>
      </details>
      <details className="phase-card">
        <summary>
          <span className="phase-badge">E</span>
          <span><strong>演奏の表情</strong><small>強弱・音域・分散和音・テンション</small></span>
        </summary>
        <div className="phase-body">
          <Toggle
            label="強弱をつける"
            description="小節の中の位置と、和音の中の声部で弾く強さを変えます"
            checked={settings.dynamics?.enabled ?? false}
            onChange={(enabled) => onPatch({
              dynamics: { enabled, depth: settings.dynamics?.depth ?? 0.35 },
            })}
          />
          {settings.dynamics?.enabled && (
            <label className="field">
              <span>強弱の幅</span>
              <select
                value={settings.dynamics.depth ?? 0.35}
                onChange={(event) => onPatch({
                  dynamics: { enabled: true, depth: Number(event.target.value) },
                })}
              >
                <option value={0.2}>控えめ</option>
                <option value={0.35}>標準</option>
                <option value={0.6}>はっきり</option>
                <option value={0.85}>大きく</option>
              </select>
            </label>
          )}
          <Toggle
            label="メロディに合わせて和音を配置する"
            description="メロディを覆わない高さと形を、和音ごとに選び直します"
            checked={settings.melodyVoicing?.enabled ?? false}
            onChange={(enabled) => onPatch({ melodyVoicing: { enabled } })}
          />
          <Toggle
            label="ベースを低い音域で鳴らす"
            description="和音の最低音をベースらしい高さまで下げます。転回はそのまま保ちます"
            checked={settings.bassRegister?.enabled ?? false}
            onChange={(enabled) => onPatch({ bassRegister: { enabled } })}
          />
          <Toggle
            label="和音を分散させて弾く"
            description="一度に鳴らさず順に弾きます。ベースは支えとして伸ばしたままにします"
            checked={settings.arpeggio?.enabled ?? false}
            onChange={(enabled) => onPatch({
              arpeggio: {
                enabled,
                rate: settings.arpeggio?.rate ?? 2,
                pattern: settings.arpeggio?.pattern ?? "up",
              },
            })}
          />
          {settings.arpeggio?.enabled && (
            <>
              <label className="field">
                <span>弾く向き</span>
                <select
                  value={settings.arpeggio.pattern ?? "up"}
                  onChange={(event) => onPatch({
                    arpeggio: {
                      ...settings.arpeggio,
                      enabled: true,
                      pattern: event.target.value as ArpeggioPattern,
                    },
                  })}
                >
                  <option value="up">低い音から上へ</option>
                  <option value="down">高い音から下へ</option>
                  <option value="upDown">上って下りる</option>
                </select>
              </label>
              <label className="field">
                <span>細かさ</span>
                <select
                  value={settings.arpeggio.rate ?? 2}
                  onChange={(event) => onPatch({
                    arpeggio: {
                      ...settings.arpeggio,
                      enabled: true,
                      rate: Number(event.target.value),
                    },
                  })}
                >
                  <option value={1}>1拍にひとつ</option>
                  <option value={2}>8分音符</option>
                  <option value={4}>16分音符</option>
                </select>
              </label>
            </>
          )}
          <Toggle
            label="テンションを加える"
            description="9th や 13th の色を足します。和音ごとに濁らない音だけを選びます"
            checked={settings.tensions?.enabled ?? false}
            onChange={(enabled) => onPatch({
              tensions: {
                enabled,
                rate: settings.tensions?.rate ?? 0.5,
                ceiling: settings.tensions?.ceiling ?? "13",
              },
            })}
          />
          {settings.tensions?.enabled && (
            <>
              <label className="field">
                <span>どのくらいの和音に足すか</span>
                <select
                  value={settings.tensions.rate ?? 0.5}
                  onChange={(event) => onPatch({
                    tensions: {
                      ...settings.tensions,
                      enabled: true,
                      rate: Number(event.target.value),
                    },
                  })}
                >
                  <option value={0.25}>ときどき</option>
                  <option value={0.5}>半分ほど</option>
                  <option value={1}>すべて</option>
                </select>
              </label>
              <label className="field">
                <span>どこまで高い音を使うか</span>
                <select
                  value={settings.tensions.ceiling ?? "13"}
                  onChange={(event) => onPatch({
                    tensions: {
                      ...settings.tensions,
                      enabled: true,
                      ceiling: event.target.value as TensionCeiling,
                    },
                  })}
                >
                  <option value="9">9th まで</option>
                  <option value="11">11th まで</option>
                  <option value="13">13th まで</option>
                </select>
              </label>
            </>
          )}
        </div>
      </details>
    </section>
  );
}