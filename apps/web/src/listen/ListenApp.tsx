import { useCallback, useEffect, useMemo, useState } from "react";
import { CaseList } from "./CaseList";
import { caseMeta, caseTitle } from "./format";
import { JudgePanel } from "./JudgePanel";
import { ComparePlayer, type Instrument } from "./player";
import { availableEngines, caseSet, loadRender } from "./renders";
import { saveResult } from "./results";
import {
  createSession, isComplete, isSession, judge, sessionResult, tally,
  type Session, type Side, type Verdict,
} from "./session";
import { Summary } from "./Summary";
import { TransportPanel } from "./TransportPanel";

const STORAGE_KEY = "vsc.listening.session";
const caseIds = caseSet.cases.map((listeningCase) => listeningCase.id);

function readStoredSession(engines: readonly string[]): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSession(parsed) || !parsed.engines.every((engine) => engines.includes(engine))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storeSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Judgments then last only as long as the page; nothing else depends on it.
  }
}

function secureRandom(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0]! / 2 ** 32;
}

function nextOpenCase(session: Session, after: string): string {
  const start = caseIds.indexOf(after);
  const ordered = [...caseIds.slice(start + 1), ...caseIds.slice(0, start + 1)];
  return ordered.find((caseId) => !session.judgments[caseId]) ?? after;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function ListenApp() {
  const engines = useMemo(() => availableEngines(), []);
  const [player] = useState(() => new ComparePlayer());
  const [session, setSession] = useState<Session | null>(() => readStoredSession(engines));
  const [pair, setPair] = useState<[string, string]>(() => [engines[0] ?? "", engines.at(-1) ?? ""]);
  const [caseId, setCaseId] = useState(() => caseIds[0]!);
  const [note, setNote] = useState(() => (session?.judgments[caseIds[0]!]?.note ?? ""));
  const [side, setSide] = useState<Side>("A");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [instrument, setInstrument] = useState<Instrument | "loading" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const listeningCase = caseSet.cases.find((candidate) => candidate.id === caseId)!;
  const pairing = session?.pairings.find((candidate) => candidate.caseId === caseId);
  const aEngine = pairing ? pairing.A : engines[0];
  const bEngine = pairing ? pairing.B : undefined;
  const complete = session !== null && isComplete(session);

  useEffect(() => {
    if (!aEngine) return;
    let cancelled = false;
    Promise.all([loadRender(aEngine, caseId), bEngine ? loadRender(bEngine, caseId) : Promise.resolve(undefined)])
      .then(([a, b]) => {
        if (cancelled) return;
        player.setSide("A");
        player.load({ A: a, B: b });
        setSide("A");
        setPlaying(false);
        setPosition(0);
        setDuration(player.durationSeconds);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [player, aEngine, bEngine, caseId]);

  useEffect(() => {
    const unsubscribe = player.onEnd(() => {
      setPlaying(false);
      setPosition(0);
    });
    return () => {
      unsubscribe();
      player.stop();
    };
  }, [player]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      setPosition(player.positionSeconds);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, player]);

  const togglePlay = useCallback(async () => {
    if (player.playing) {
      player.pause();
      setPlaying(false);
      return;
    }
    setInstrument((current) => current ?? "loading");
    await player.play();
    setInstrument(await player.prepare());
    setPlaying(true);
  }, [player]);

  const stop = useCallback(() => {
    player.stop();
    setPlaying(false);
    setPosition(0);
  }, [player]);

  const seek = useCallback((seconds: number) => {
    player.seek(seconds);
    setPosition(seconds);
  }, [player]);

  const chooseSide = useCallback((next: Side) => {
    player.setSide(next);
    setSide(next);
  }, [player]);

  const selectCase = useCallback((next: string) => {
    setCaseId(next);
    setNote(session?.judgments[next]?.note ?? "");
    setSaveStatus(null);
  }, [session]);

  const giveVerdict = useCallback((verdict: Verdict) => {
    if (!session) return;
    const next = judge(session, caseId, verdict, note);
    setSession(next);
    storeSession(next);
    if (!isComplete(next)) selectCase(nextOpenCase(next, caseId));
  }, [session, caseId, note, selectCase]);

  const startSession = useCallback(() => {
    const next = createSession(caseIds, pair, secureRandom);
    setSession(next);
    storeSession(next);
    selectCase(caseIds[0]!);
  }, [pair, selectCase]);

  const discardSession = useCallback(() => {
    if (session && Object.keys(session.judgments).length > 0
      && !window.confirm("このセッションの判定を破棄します。よろしいですか？")) return;
    setSession(null);
    storeSession(null);
    setNote("");
  }, [session]);

  const save = useCallback(async () => {
    if (!session) return;
    setSaveStatus("保存しています…");
    const outcome = await saveResult(sessionResult(session));
    setSaveStatus("savedTo" in outcome ? `${outcome.savedTo} に保存しました。` : `${outcome.downloaded} をダウンロードしました。`);
  }, [session]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === " ") {
        event.preventDefault();
        void togglePlay();
      } else if (bEngine && (event.key === "a" || event.key === "b")) {
        chooseSide(event.key === "a" ? "A" : "B");
      } else if (session && bEngine && ["1", "2", "3"].includes(event.key)) {
        giveVerdict(event.key === "1" ? "A" : event.key === "2" ? "same" : "B");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, chooseSide, giveVerdict, session, bEngine]);

  const judgedCount = session ? Object.keys(session.judgments).length : 0;

  return (
    <div className="listen">
      <header className="listen-header">
        <h1>試聴比較</h1>
        {session ? (
          <div className="session-bar">
            <span className="progress">判定 {judgedCount} / {caseIds.length}</span>
            <button type="button" className="quiet" onClick={discardSession}>セッションを終える</button>
          </div>
        ) : engines.length >= 2 ? (
          <div className="session-bar">
            {([0, 1] as const).map((index) => (
              <label key={index} className="engine-select">
                <span>{index === 0 ? "版1" : "版2"}</span>
                <select
                  value={pair[index]}
                  onChange={(event) => setPair((current) => {
                    const next: [string, string] = [...current];
                    next[index] = event.target.value;
                    return next;
                  })}
                >
                  {engines.map((engine) => <option key={engine} value={engine}>{engine}</option>)}
                </select>
              </label>
            ))}
            <button type="button" className="primary" disabled={pair[0] === pair[1]} onClick={startSession}>
              聴き比べを始める
            </button>
          </div>
        ) : null}
      </header>

      <div className="listen-body">
        <nav className="listen-cases" aria-label="ケース">
          <CaseList cases={caseSet.cases} currentId={caseId} judgments={session?.judgments ?? null} onSelect={selectCase} />
        </nav>

        <main className="listen-main">
          {complete && <Summary tally={tally(session)} saveStatus={saveStatus} onSave={() => void save()} />}

          <h2 className="case-heading">{caseTitle(listeningCase)}</h2>
          <p className="case-sub">{caseMeta(listeningCase)}</p>

          {loadError ? (
            <p className="error" role="alert">この版の書き出しを読み込めませんでした（{loadError}）。eval/renders を確認してください。</p>
          ) : (
            <TransportPanel
              playing={playing}
              position={position}
              duration={duration}
              side={side}
              hasB={bEngine !== undefined}
              instrument={instrument}
              onToggle={() => void togglePlay()}
              onStop={stop}
              onSeek={seek}
              onSide={chooseSide}
            />
          )}

          {session ? (
            <JudgePanel
              verdict={session.judgments[caseId]?.verdict}
              note={note}
              onNote={setNote}
              onVerdict={giveVerdict}
            />
          ) : (
            <p className="notice">
              {engines.length < 2
                ? `比較できる版はまだ ${engines[0] ?? "なし"} だけです。新しい版の書き出しを eval/renders/ に置くと、ここでブラインドの聴き比べができます。`
                : "上で2つの版を選んで「聴き比べを始める」を押すと、どちらが A かを伏せたまま判定できます。"}
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
