import type { GeneratedComposition, GeneratorSettings } from "../types/music";
import { analyzeTensionCurve } from "./tensionCurve";
import { findCounterpointIssues } from "./counterpoint";
import { generateComposition } from "./generator";
import { validateComposition } from "./validation";

export interface AutoFixChange {
  id: string;
  label: string;
  reason: string;
}

export interface AutoFixResult {
  sourceCompositionId: string;
  preview: GeneratedComposition;
  changes: AutoFixChange[];
  checks: string[];
}

function recommendedGroove(style: GeneratorSettings["style"]) {
  switch (style) {
    case "jazz":
      return "swing8" as const;
    case "lo-fi":
    case "ballad":
      return "laidBack" as const;
    case "rock":
    case "edm":
      return "backbeat" as const;
    case "game-music":
      return "pushed" as const;
    default:
      return "straight" as const;
  }
}

/**
 * Creates a deterministic, fully validated replacement without touching the
 * current project. The caller must explicitly adopt `preview`, which keeps
 * Auto Fix undoable and prevents an analysis click from overwriting music.
 */
export function createAutoFixPreview(
  composition: GeneratedComposition,
): AutoFixResult {
  const tension = analyzeTensionCurve({
    chords: composition.chords,
    notes: composition.notes,
    ticksPerBar: composition.ticksPerBar,
    bars: composition.settings.bars,
    melodyRange: [
      composition.settings.melody.minMidi,
      composition.settings.melody.maxMidi,
    ],
  });
  const tensionValues = tension.map((point) => point.totalTension);
  const tensionRange = tensionValues.length === 0
    ? 0
    : Math.max(...tensionValues) - Math.min(...tensionValues);
  const settings = structuredClone(composition.settings);
  const changes: AutoFixChange[] = [];

  if (!settings.phraseGrammar?.enabled) {
    settings.phraseGrammar = { enabled: true };
    changes.push({
      id: "phrase",
      label: "メロディをフレーズ単位に整理",
      reason: "始まり・盛り上がり・着地が分かる流れにします。",
    });
  }
  if (!settings.melodicSkeleton?.enabled) {
    settings.melodicSkeleton = { enabled: true };
    changes.push({
      id: "skeleton",
      label: "メロディの山と着地点を追加",
      reason: tensionRange < 0.18
        ? "現在の緊張カーブが平坦なので、聞きどころを作ります。"
        : "全体の流れを保ちながら、フレーズの目的音を先に決めます。",
    });
  }
  if (!settings.voiceLeading?.enabled) {
    settings.voiceLeading = { enabled: true, profile: "pop" };
    changes.push({
      id: "voice-leading",
      label: "コードの各音をなめらかに接続",
      reason: "急な音の飛びと不自然な並行を減らします。",
    });
  }
  if (!settings.harmonicRhythm) {
    settings.harmonicRhythm = {
      changesPerBar: 1,
      barsPerChord: 1,
      cadentialAcceleration: true,
    };
    changes.push({
      id: "harmonic-rhythm",
      label: "終わりに向かうコード速度を調整",
      reason: "通常は落ち着かせ、着地直前だけ少し前へ進めます。",
    });
  }
  if (!settings.nonChordTones?.enabled) {
    settings.nonChordTones = {
      enabled: true,
      rate: settings.style === "jazz" ? 0.4 : 0.25,
      types: ["passingTone", "neighborTone"],
    };
    changes.push({
      id: "ornaments",
      label: "安全な経過音を少量追加",
      reason: "コードに戻ることが保証された音だけを使います。",
    });
  }
  if (!settings.groove?.enabled) {
    settings.groove = {
      enabled: true,
      template: recommendedGroove(settings.style),
      amount: 0.55,
    };
    changes.push({
      id: "groove",
      label: "スタイルに合うノリを追加",
      reason: "音程は変えず、タイミングと強さだけを控えめに調整します。",
    });
  }
  if (settings.bars >= 8 && !settings.arrangement?.counterpoint?.enabled) {
    settings.arrangement = {
      ...settings.arrangement,
      counterpoint: {
        enabled: true,
        position: "below",
        independence: 0.7,
      },
    };
    changes.push({
      id: "counterpoint",
      label: "主旋律の下に対旋律を追加",
      reason: "平行5度・8度と声部交差を避ける規則で生成します。",
    });
  }

  const preview = generateComposition(settings);
  const validation = validateComposition(preview);
  if (!validation.valid) {
    throw new Error("Auto Fix preview failed the composition validator.");
  }

  const checks = [
    `データ検証: ${validation.errors.length}エラー`,
    `追加声部: ${preview.voices?.length ?? 0}本`,
  ];
  const counterpoint = preview.voices?.find((voice) => voice.role === "countermelody");
  if (counterpoint) {
    const below = settings.arrangement?.counterpoint?.position !== "above";
    const issues = findCounterpointIssues(
      below ? counterpoint.notes : preview.notes,
      below ? preview.notes : counterpoint.notes,
    );
    const serious = issues.filter(
      (issue) =>
        issue.type === "parallelFifth"
        || issue.type === "parallelOctave"
        || issue.type === "voiceCrossing",
    );
    checks.push(`対旋律チェック: 重大な問題${serious.length}件`);
  }
  checks.push(`再現シード: ${String(settings.seed)}`);

  return {
    sourceCompositionId: composition.id,
    preview,
    changes,
    checks,
  };
}
