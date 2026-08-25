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
  { id: "familiar", label: "定番", hint: "頻度の高い候補" },
  { id: "balanced", label: "バランス", hint: "定番度と意外性" },
  { id: "adventurous", label: "意外", hint: "観測済みの低頻度候補" },
];

function percent(value: number): string {
  return `${(Number.isFinite(value) ? value * 100 : 0).toFixed(1)}%`;
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
  const transitionPercent = (value: number): string => insights.transitionCount > 0
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
        <span className="harmony-insights-source">POP909 / ブラウザ3-gram</span>
      </header>

      <div className="harmony-insights-provenance" role="note">
        <strong>根拠:</strong> POP909 909曲・1,131 tonal sequences・93,904 tokens。<br />
        直接観測頻度はこの文脈で実際に現れた割合、補間推定確率は直接観測に短い文脈と全体傾向を組み合わせた推定値です。どちらも良さの点数ではありません。出現数は曲数ではなく、コーパス内の反復を含む出現回数です。統計で比べるのはコードの根音と種類だけです。音の並べ方・テンション・転回形は適用後に編集できます。
      </div>

      <div className="harmony-insights-metrics" aria-label="統計指標">
        <div><strong>{transitionPercent(insights.geometricMeanConditionalProbability)}</strong><span>遷移の補間推定確率・幾何平均</span></div>
        <div><strong>{insights.transitionCount > 0 ? `${insights.meanSurprisalBits.toFixed(2)} bit` : "—"}</strong><span>平均サプライズ（低いほど頻出）</span></div>
        <div><strong>{transitionPercent(insights.supportedTransitionRate)}</strong><span>観測済み遷移率</span></div>
        <div><strong>{percent(insights.complexChordRate)}</strong><span>複雑度（3軸合成）</span></div>
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
                  補間推定確率 {(suggestion.probability * 100).toFixed(2)}%・直接観測頻度 {(suggestion.rawConditionalProbability * 100).toFixed(2)}%・{suggestion.exactGramCount}出現 / {suggestion.orderUsed === 1 ? `コーパス総token ${suggestion.contextCount}出現` : `文脈${suggestion.contextCount}出現`}・{suggestion.orderUsed}-gram・サプライズ {suggestion.surprisalBits.toFixed(2)} bit
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
