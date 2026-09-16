import { useMemo, useState } from "react";
import {
  analyzeHarmonyStatistics,
  suggestNextChords,
  type StatisticalProfile,
  type StatisticalChordSuggestion,
} from "../../music/statisticalHarmony";
import type { BarRange, ChordEvent, GeneratedComposition } from "../../types/music";

export interface HarmonyInsightsPanelProps {
  composition: GeneratedComposition;
  analysisScope: BarRange | null;
  targetLabel: string;
  selectedChord: ChordEvent | null;
  lockedBars?: readonly number[];
  onAudition: (notes: readonly number[]) => void;
  onApply: (suggestion: StatisticalChordSuggestion) => boolean;
  onToast?: (message: string) => void;
}

const PROFILES: readonly { id: StatisticalProfile; label: string; hint: string }[] = [
  { id: "familiar", label: "滑らか", hint: "ボイスリーディングの移動コストが低い候補" },
  { id: "balanced", label: "バランス", hint: "滑らかさと変化のバランス" },
  { id: "adventurous", label: "変化", hint: "理論上有効な変化の大きい候補" },
];

function percent(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : `${(value * 100).toFixed(1)}%`;
}

function rangeText(range: BarRange | null): string {
  return range ? `${range.startBar + 1}〜${range.endBar}小節` : "曲全体";
}

export function HarmonyInsightsPanel({
  composition,
  analysisScope,
  targetLabel,
  selectedChord,
  lockedBars = [],
  onAudition,
  onApply,
  onToast,
}: HarmonyInsightsPanelProps) {
  const [profile, setProfile] = useState<StatisticalProfile>("balanced");
  const insights = useMemo(
    () => analyzeHarmonyStatistics(composition, analysisScope),
    [composition, analysisScope],
  );
  const suggestions = useMemo(
    () => suggestNextChords(composition, { profile, targetChord: selectedChord ?? undefined }),
    [composition, profile, selectedChord],
  );
  const targetStart = selectedChord?.startTick ?? 0;
  const targetEnd = selectedChord ? selectedChord.startTick + selectedChord.durationTick : 0;
  const lockedTargetBars = selectedChord
    ? lockedBars.filter((bar) => {
      const barStart = bar * composition.ticksPerBar;
      const barEnd = barStart + composition.ticksPerBar;
      return targetStart < barEnd && targetEnd > barStart;
    })
    : [];
  const canApply = selectedChord !== null && lockedTargetBars.length === 0;
  const targetBarLabel = selectedChord
    ? `${Math.floor(selectedChord.startTick / composition.ticksPerBar) + 1}小節`
    : "コード未選択";
  const applyBlockedReason = !selectedChord
    ? "Chord Laneでコードを選択してから適用"
    : lockedTargetBars.length > 0
      ? "対象コードのロックされた小節を解除してから適用"
      : null;
  const transitionPercent = (value: number | null): string => insights.transitionCount > 0
    ? percent(value)
    : "—";

  return (
    <section className="harmony-insights" aria-label="コード統計インサイト">
      <header className="harmony-insights-header">
        <div>
          <h2>コード統計</h2>
          <p className="harmony-insights-scope" role="status">
            解析範囲: <strong>{targetLabel || rangeText(analysisScope)}</strong>
          </p>
          <p className="harmony-insights-scope" role="status">
            置換対象: <strong>{selectedChord ? `${targetBarLabel} ${selectedChord.symbol}` : "未選択（候補は試聴のみ）"}</strong>
          </p>
        </div>
        <span className="harmony-insights-source">ローカル音楽診断</span>
      </header>

      <div className="harmony-insights-provenance" role="note">
        {insights.empiricalStatisticsAvailable && insights.provenance ? (
          <>
            <strong>経験的根拠:</strong> {insights.source}。<br />
            直接観測頻度と補間推定確率は、入力された統計プロバイダーの値です。どちらも音楽的な良さの点数ではありません。統計で比べるのはコードの根音と種類だけです。音の並べ方・テンション・転回形は適用後に編集できます。
          </>
        ) : (
          <>
            <strong>経験的統計:</strong> 実曲コーパスは読み込まれていません。遷移の頻度や確率は表示せず、内蔵のコード理論・ボイスリーディング・スタイル診断だけを表示します。
          </>
        )}
      </div>

      <div className="harmony-insights-metrics" aria-label="統計指標">
        <div><strong>{transitionPercent(insights.geometricMeanConditionalProbability)}</strong><span>遷移の経験的確率（コーパス未読込時は—）</span></div>
        <div><strong>{insights.meanSurprisalBits === null ? "—" : insights.transitionCount > 0 ? `${insights.meanSurprisalBits.toFixed(2)} bit` : "—"}</strong><span>平均サプライズ（コーパス未読込時は—）</span></div>
        <div><strong>{transitionPercent(insights.supportedTransitionRate)}</strong><span>観測済み遷移率</span></div>
        <div><strong>{percent(insights.complexChordRate)}</strong><span>複雑度（3軸合成）</span></div>
        <div><strong>{percent(insights.extensionRate)}</strong><span>拡張音・テンション率</span></div>
        <div><strong>{percent(insights.nonDiatonicRate)}</strong><span>非ダイアトニック率</span></div>
        <div><strong>{percent(insights.advancedQualityRate)}</strong><span>高度なコード品質率</span></div>
        <div><strong>{percent(insights.guideToneCoverageRate)}</strong><span>ガイドトーン算出可能率</span></div>
        <div><strong>{percent(insights.guideToneStepwiseMotionRate)}</strong><span>ガイドトーン順次進行率</span></div>
        <div><strong>{insights.melodyOnsetsPerBar.toFixed(1)}</strong><span>旋律オンセット密度（小節あたり）</span></div>
        <div><strong>{percent(insights.durationWeightedMelodyNonChordTension)}</strong><span>旋律の非コード音（長さ加重）</span></div>
        <div><strong>{percent(insights.actualBassStepwiseMotionRate)}</strong><span>実ベースの順次進行</span></div>
        <div><strong>{percent(insights.syncopationRate)}</strong><span>旋律シンコペーション</span></div>
      </div>
      <p className="harmony-insights-formula">複雑度 = {insights.complexChordFormula}。どの指標も高いほど良いとは限りません。</p>

      <div className="harmony-insights-profiles" role="group" aria-label="提案プロファイル">
        {PROFILES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={profile === entry.id}
            title={entry.hint}
            className={profile === entry.id ? "harmony-insights-profile selected" : "harmony-insights-profile"}
            onClick={() => setProfile(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {!selectedChord && (
        <p className="harmony-insights-empty" role="status">
          {analysisScope ? "選択範囲を解析しています。" : "曲全体を解析しています。"} 次のコードは曲末尾の文脈から試聴できます。適用するにはChord Laneで対象コードをクリックしてください。
        </p>
      )}
      {lockedTargetBars.length > 0 && (
        <p className="harmony-insights-warning" role="alert">
          対象コードの全tick範囲（{targetBarLabel}）にロックされた小節があるため、適用できません。ロックを外してから再試行してください。
        </p>
      )}

      <div className="harmony-insights-suggestions" aria-live="polite">
        <h3>{selectedChord ? "選択コードの置き換え候補" : "曲末の次コード候補（試聴のみ）"}</h3>
        {suggestions.length === 0 ? (
          <p className="harmony-insights-empty">このモードで、根拠のある候補が見つかりませんでした。</p>
        ) : (
          <ul>
            {suggestions.map((suggestion) => (
              <li key={JSON.stringify(suggestion.step)}>
                <div className="harmony-insights-suggestion-main">
                  <strong>{suggestion.romanNumeral}</strong>
                  <span>{suggestion.chord.symbol}</span>
                </div>
                <p>{suggestion.reasons.join(" / ")}</p>
                <small>
                  {suggestion.probability === null
                    ? `経験的頻度なし・${suggestion.source}・ボイスリーディングコスト ${suggestion.voiceLeadingCost.toFixed(2)}`
                    : `補間推定確率 ${(suggestion.probability * 100).toFixed(2)}%・直接観測頻度 ${((suggestion.rawConditionalProbability ?? 0) * 100).toFixed(2)}%・${suggestion.exactGramCount ?? 0}出現 / ${suggestion.orderUsed === 1 ? `コーパス総token ${suggestion.contextCount ?? 0}出現` : `文脈${suggestion.contextCount ?? 0}出現`}・${suggestion.orderUsed}-gram・サプライズ ${(suggestion.surprisalBits ?? 0).toFixed(2)} bit`}
                </small>
                <div className="harmony-insights-actions">
                  <button
                    type="button"
                    aria-label={`${suggestion.chord.symbol}を試聴`}
                    onClick={() => onAudition(suggestion.chord.notes)}
                  >
                    試聴
                  </button>
                  <button
                    type="button"
                    disabled={!canApply}
                    aria-label={canApply
                      ? `${suggestion.chord.symbol}を${targetBarLabel}の${selectedChord?.symbol}に適用`
                      : `${suggestion.chord.symbol}は適用できません。${applyBlockedReason}`}
                    title={applyBlockedReason ?? undefined}
                    onClick={() => {
                      if (!selectedChord) {
                        onToast?.("先にChord Laneで対象コードを選択してください。曲全体は自動変更しません。");
                        return;
                      }
                      // The host owns the Store action and its pending-commit
                      // aware toast. This prevents a generic immediate-success
                      // message from contradicting next-bar playback timing.
                      onApply(suggestion);
                    }}
                  >
                    {selectedChord ? `${targetBarLabel}のコードに適用` : "コードを選択して適用"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
