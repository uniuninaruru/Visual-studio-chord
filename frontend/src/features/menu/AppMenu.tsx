import { useEffect, useId, useRef, useState } from "react";
import type { MixerSettings } from "../../audio/transport";
import { DEFAULT_MIXER } from "../../audio/transport";
import {
  BUILD_CREDITS,
  GUIDE,
  MUSIC_CREDITS,
  RELEASE_NOTES,
  RUNTIME_CREDITS,
  type Credit,
} from "./content";

/**
 * The menu behind the three lines.
 *
 * A dialog rather than a page, because everything in it is reference material
 * read beside the work rather than instead of it -- and closing it must put the
 * user back exactly where they were, mid-edit.
 *
 * The mixer lives here rather than in the transport bar on purpose. Volume is
 * set once and then left alone; a fader beside the play button would take space
 * from controls that are used continuously.
 */

export type MenuTab = "guide" | "release" | "license" | "settings";

const TABS: ReadonlyArray<{ id: MenuTab; label: string }> = [
  { id: "guide", label: "使い方" },
  { id: "settings", label: "設定" },
  { id: "release", label: "更新履歴" },
  { id: "license", label: "ライセンス" },
];

export interface AppMenuProps {
  open: boolean;
  onClose: () => void;
  mixer: MixerSettings;
  onMixerChange: (patch: Partial<MixerSettings>) => void;
  /** Reopens the first-use tutorial, which lives outside this dialog. */
  onOpenTutorial: () => void;
  onOpenDiagnostics: () => void;
  appVersion: string;
}

function CreditList({ title, credits }: { title: string; credits: readonly Credit[] }) {
  return (
    <section className="menu-credit-group">
      <h3>{title}</h3>
      <ul className="menu-credit-list">
        {credits.map((credit) => (
          <li key={credit.name}>
            <div className="menu-credit-head">
              <a href={credit.url} target="_blank" rel="noreferrer noopener">{credit.name}</a>
              {credit.version ? <span className="menu-credit-version">{credit.version}</span> : null}
              <span className="menu-credit-license">{credit.license}</span>
            </div>
            {credit.note ? <p className="menu-credit-note">{credit.note}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface FaderProps {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
}

function Fader({ label, hint, value, onChange }: FaderProps) {
  const id = useId();
  return (
    <div className="menu-fader">
      <label htmlFor={id}>
        <span className="menu-fader-label">{label}</span>
        <span className="menu-fader-value">{Math.round(value * 100)}%</span>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      {hint ? <p className="menu-fader-hint">{hint}</p> : null}
    </div>
  );
}

export function AppMenu({
  open,
  onClose,
  mixer,
  onMixerChange,
  onOpenTutorial,
  onOpenDiagnostics,
  appVersion,
}: AppMenuProps) {
  const [tab, setTab] = useState<MenuTab>("guide");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Focus moves into the dialog on open so a keyboard user is not left behind
  // in the page underneath, and Escape closes it from anywhere inside.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    const node = panelRef.current;
    node?.addEventListener("keydown", onKeyDown);
    return () => node?.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="menu-overlay" role="presentation" onClick={onClose}>
      <div
        className="menu-panel"
        role="dialog"
        aria-modal="true"
        aria-label="メニュー"
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="menu-header">
          <h2>Visual studio chord</h2>
          <span className="menu-version">v{appVersion}</span>
          <button type="button" className="menu-close" onClick={onClose} ref={closeRef}>
            閉じる
          </button>
        </header>

        <div className="menu-tabs" role="tablist" aria-label="メニューの項目">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`menu-tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`menu-panel-${entry.id}`}
              className={tab === entry.id ? "menu-tab selected" : "menu-tab"}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div
          className="menu-body"
          role="tabpanel"
          id={`menu-panel-${tab}`}
          aria-labelledby={`menu-tab-${tab}`}
          tabIndex={0}
        >
          {tab === "guide" ? (
            <>
              <p className="menu-lead">
                ブラウザだけで動きます。生成も再生も書き出しも、この端末の中で完結します。
              </p>
              {GUIDE.map((section) => (
                <section key={section.heading} className="menu-guide-section">
                  <h3>{section.heading}</h3>
                  {section.intro ? <p className="menu-guide-intro">{section.intro}</p> : null}
                  <ol className="menu-guide-steps">
                    {section.steps.map((step) => (
                      <li key={step.title}>
                        <div className="menu-step-head">
                          <strong>{step.title}</strong>
                          {step.where ? <span className="menu-step-where">{step.where}</span> : null}
                        </div>
                        <p>{step.body}</p>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
              <div className="menu-actions">
                <button type="button" onClick={() => { onOpenTutorial(); onClose(); }}>
                  はじめてのガイドをもう一度見る
                </button>
                <button type="button" onClick={() => { onOpenDiagnostics(); onClose(); }}>
                  環境診断を開く
                </button>
              </div>
            </>
          ) : null}

          {tab === "settings" ? (
            <>
              <section className="menu-guide-section">
                <h3>音量</h3>
                <p className="menu-guide-intro">
                  再生しながら動かせます。すでに鳴っている音はそのまま鳴り終わり、次の音から変わります。
                </p>
                <Fader
                  label="全体"
                  value={mixer.master}
                  onChange={(master) => onMixerChange({ master })}
                />
                <Fader
                  label="コード"
                  value={mixer.chords}
                  onChange={(chords) => onMixerChange({ chords })}
                />
                <Fader
                  label="メロディ"
                  value={mixer.melody}
                  onChange={(melody) => onMixerChange({ melody })}
                />
                <Fader
                  label="ベース"
                  value={mixer.bass}
                  onChange={(bass) => onMixerChange({ bass })}
                />
              </section>
              <section className="menu-guide-section">
                <h3>響き</h3>
                <Fader
                  label="リバーブ"
                  hint="0にすると残響なしの素の音になります。ボイシングの細部を確かめたいときに下げてください。"
                  value={mixer.reverb}
                  onChange={(reverb) => onMixerChange({ reverb })}
                />
              </section>
              <div className="menu-actions">
                <button type="button" onClick={() => onMixerChange({ ...DEFAULT_MIXER })}>
                  音量を初期値に戻す
                </button>
              </div>
              <p className="menu-note">
                生成に関する設定（キー・スタイル・小節数など）は左の「生成設定」にあります。ここにあるのは、
                出来上がった曲をどう鳴らすかだけです。曲そのものは変わりません。
              </p>
            </>
          ) : null}

          {tab === "release" ? (
            <>
              {RELEASE_NOTES.map((note) => (
                <section key={note.version} className="menu-release">
                  <h3>
                    v{note.version}
                    <span className="menu-release-date">{note.date}</span>
                  </h3>
                  <p className="menu-release-headline">{note.headline}</p>
                  <ul>
                    {note.changes.map((change) => <li key={change}>{change}</li>)}
                  </ul>
                </section>
              ))}
            </>
          ) : null}

          {tab === "license" ? (
            <>
              <p className="menu-lead">
                このアプリが使っているものと、参照したものです。
              </p>
              <CreditList title="実行時" credits={RUNTIME_CREDITS} />
              <CreditList title="開発時" credits={BUILD_CREDITS} />
              <CreditList title="音楽面で参照したもの" credits={MUSIC_CREDITS} />
              <p className="menu-note">
                楽曲データはこのアプリに同梱していません。参照したコーパスは統計を測るために使い、
                そこから採用した数値は現在ありません。生成に使う進行や重みは、公開されている音楽理論と
                実務書の記述に基づいて書かれたものです。
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
