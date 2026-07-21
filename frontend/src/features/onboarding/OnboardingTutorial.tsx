import { useEffect, useRef, useState } from "react";

interface OnboardingTutorialProps {
  onClose: () => void;
}

const STEPS = [
  {
    title: "サンプル曲から始められます",
    body: "最初から安全なサンプル曲が開いています。左のBasic設定を変えて「この設定で生成」を押すと、新しい曲を作れます。",
  },
  {
    title: "Playで聴く",
    body: "上部のPlayを押すと再生します。Playback、現在の小節、ループ範囲は常に状態バーへ表示されます。Spaceキーでも再生・一時停止できます。",
  },
  {
    title: "小節を選んで候補を作る",
    body: "コードレーンの小節を選び、下部の再生成を押します。A/B/Cはプレビューで、採用するまで編集中の曲を上書きしません。",
  },
  {
    title: "好みは明示的に学習",
    body: "Like、Dislike、Favoriteなどを押すと、この端末内で好みを学習します。根拠が少ないうちは好みを断定しません。",
  },
  {
    title: "GPUは任意です",
    body: "CUDA、MPS、Core ML、DirectMLは高速化用です。利用できなくてもLocal CPU、Browser、Theory-onlyの順に切り替わり、生成・再生・編集を続けられます。",
  },
] as const;

function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex]:not([tabindex='-1'])"));
}

export function OnboardingTutorial({ onClose }: OnboardingTutorialProps) {
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = focusable(dialogRef.current);
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  const current = STEPS[step] as (typeof STEPS)[number];
  return (
    <div className="onboarding-backdrop">
      <div
        ref={dialogRef}
        className="onboarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
      >
        <div className="onboarding-progress" aria-label={`${STEPS.length}ステップ中${step + 1}`}>
          {STEPS.map((item, index) => (
            <span key={item.title} className={index <= step ? "active" : ""}>{index + 1}</span>
          ))}
        </div>
        <p className="eyebrow">QUICK START · {step + 1}/{STEPS.length}</p>
        <h2 id="onboarding-title">{current.title}</h2>
        <p id="onboarding-description" aria-live="polite">{current.body}</p>
        <div className="onboarding-actions">
          <button className="text-button" type="button" onClick={onClose}>スキップ</button>
          <div>
            <button
              className="secondary-button"
              type="button"
              disabled={step === 0}
              onClick={() => setStep((currentStep) => Math.max(0, currentStep - 1))}
            >
              戻る
            </button>
            {step < STEPS.length - 1 ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => setStep((currentStep) => Math.min(STEPS.length - 1, currentStep + 1))}
              >
                次へ
              </button>
            ) : (
              <button className="primary-button" type="button" onClick={onClose}>始める</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
