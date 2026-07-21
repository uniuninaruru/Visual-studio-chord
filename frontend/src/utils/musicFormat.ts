const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

const MODE_LABELS = {
  major: "Major",
  naturalMinor: "Natural Minor",
  harmonicMinor: "Harmonic Minor",
  dorian: "Dorian",
  mixolydian: "Mixolydian",
} as const;

export function modeLabel(mode: keyof typeof MODE_LABELS): string {
  return MODE_LABELS[mode];
}

export function midiNoteName(midi: number): string {
  const pitchClass = NOTE_NAMES[((midi % 12) + 12) % 12] ?? "C";
  return `${pitchClass}${Math.floor(midi / 12) - 1}`;
}

export function formatBarBeat(tick: number, ppq: number, ticksPerBar: number): string {
  const safeTick = Math.max(0, tick);
  const bar = Math.floor(safeTick / ticksPerBar) + 1;
  const withinBar = safeTick % ticksPerBar;
  const beat = Math.floor(withinBar / ppq) + 1;
  const sixteenth = Math.floor((withinBar % ppq) / Math.max(1, ppq / 4)) + 1;
  return `${bar}.${beat}.${sixteenth}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
