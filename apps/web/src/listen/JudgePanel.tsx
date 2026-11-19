import type { Verdict } from "./session";

interface JudgePanelProps {
  verdict: Verdict | undefined;
  note: string;
  onNote: (note: string) => void;
  onVerdict: (verdict: Verdict) => void;
}

const CHOICES: { verdict: Verdict; label: string; key: string }[] = [
  { verdict: "A", label: "A が良い", key: "1" },
  { verdict: "same", label: "同じくらい", key: "2" },
  { verdict: "B", label: "B が良い", key: "3" },
];

export function JudgePanel({ verdict, note, onNote, onVerdict }: JudgePanelProps) {
  return (
    <section className="judge" aria-labelledby="judge-heading">
      <h2 id="judge-heading">どちらが良かったですか</h2>
      <div className="choices">
        {CHOICES.map((choice) => (
          <button
            key={choice.verdict}
            type="button"
            className="choice"
            aria-pressed={verdict === choice.verdict}
            onClick={() => onVerdict(choice.verdict)}
          >
            {choice.label}
            <kbd>{choice.key}</kbd>
          </button>
        ))}
      </div>
      <label className="note">
        <span>気づいたこと（任意）</span>
        <textarea
          rows={2}
          value={note}
          placeholder="例：サビ前のつなぎが唐突、左手がこもる"
          onChange={(event) => onNote(event.target.value)}
        />
      </label>
    </section>
  );
}
