import type { ListeningCase } from "@vsc/core";

const STYLE_LABELS: Record<string, string> = {
  pop: "ポップ",
  "j-pop": "J-POP",
  ballad: "バラード",
  jazz: "ジャズ",
};

const MODE_LABELS: Record<string, string> = {
  major: "メジャー",
  naturalMinor: "マイナー",
  harmonicMinor: "和声的短音階",
  dorian: "ドリアン",
  mixolydian: "ミクソリディアン",
};

export function keyLabel(key: string): string {
  return key.slice(0, 1) + key.slice(1).replace("b", "♭").replace("#", "♯");
}

export function caseTitle(listeningCase: ListeningCase): string {
  const style = STYLE_LABELS[listeningCase.style] ?? listeningCase.style;
  const mode = MODE_LABELS[listeningCase.mode] ?? listeningCase.mode;
  return `${style} · ${keyLabel(listeningCase.key)} ${mode}`;
}

export function caseMeta(listeningCase: ListeningCase): string {
  return `${listeningCase.bpm} BPM · ${listeningCase.bars}小節`;
}

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
