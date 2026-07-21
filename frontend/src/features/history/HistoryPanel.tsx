import type { HistoryEntry } from "../../state/editorStore";

export interface HistoryPanelProps {
  entries: readonly HistoryEntry[];
  currentHistoryId: string | null;
  compareIds: readonly string[];
  onCompareChange: (historyIds: readonly string[]) => void;
  onRename: (historyId: string, name: string) => void;
  onRestore: (historyId: string) => void;
}

interface ChordDifference {
  total: number;
  details: string[];
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function chordDifference(left: HistoryEntry, right: HistoryEntry): ChordDifference {
  const leftChords = left.composition.chords;
  const rightChords = right.composition.chords;
  const details: string[] = [];
  let total = 0;
  const length = Math.max(leftChords.length, rightChords.length);

  for (let index = 0; index < length; index += 1) {
    const leftSymbol = leftChords[index]?.symbol ?? "—";
    const rightSymbol = rightChords[index]?.symbol ?? "—";
    if (leftSymbol === rightSymbol) continue;
    total += 1;
    if (details.length < 4) {
      details.push(`${index + 1}: ${leftSymbol} → ${rightSymbol}`);
    }
  }

  return { total, details };
}

function normalizedCompareIds(
  compareIds: readonly string[],
  entries: readonly HistoryEntry[],
): string[] {
  const available = new Set(entries.map((entry) => entry.id));
  return [...new Set(compareIds)].filter((id) => available.has(id)).slice(0, 2);
}

export function HistoryPanel({
  entries,
  currentHistoryId,
  compareIds,
  onCompareChange,
  onRename,
  onRestore,
}: HistoryPanelProps) {
  const selectedCompareIds = normalizedCompareIds(compareIds, entries);
  const left = entries.find((entry) => entry.id === selectedCompareIds[0]);
  const right = entries.find((entry) => entry.id === selectedCompareIds[1]);
  const difference = left && right ? chordDifference(left, right) : null;

  const toggleComparison = (historyId: string) => {
    if (selectedCompareIds.includes(historyId)) {
      onCompareChange(selectedCompareIds.filter((id) => id !== historyId));
      return;
    }
    const next = selectedCompareIds.length < 2
      ? [...selectedCompareIds, historyId]
      : [selectedCompareIds[1] as string, historyId];
    onCompareChange(next);
  };

  return (
    <section className="history-panel" aria-labelledby="history-panel-title">
      <header className="history-panel-heading">
        <div>
          <p className="eyebrow">VERSION HISTORY</p>
          <h2 id="history-panel-title">バージョン履歴</h2>
        </div>
        <span className="history-compare-count">比較 {selectedCompareIds.length} / 2</span>
      </header>

      {left && right && difference && (
        <section className="history-comparison" aria-label="選択したバージョンの比較">
          <header>
            <strong>{left.name}</strong>
            <span aria-hidden="true">→</span>
            <strong>{right.name}</strong>
          </header>
          {difference.total === 0 ? (
            <p>コード進行は同一です。</p>
          ) : (
            <>
              <p>{difference.total}個のコードが異なります。</p>
              <ul>
                {difference.details.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
              {difference.total > difference.details.length && (
                <small>ほか {difference.total - difference.details.length}件</small>
              )}
            </>
          )}
        </section>
      )}

      {entries.length === 0 ? (
        <p className="history-empty-state">保存されたバージョンはまだありません。</p>
      ) : (
        <ol className="history-entry-list">
          {[...entries].reverse().map((entry) => {
            const isCurrent = entry.id === currentHistoryId;
            const isCompared = selectedCompareIds.includes(entry.id);

            return (
              <li
                key={entry.id}
                className={`history-entry${isCurrent ? " is-current" : ""}`}
              >
                <div className="history-entry-main">
                  <label className="history-name-field">
                    <span className="sr-only">履歴名</span>
                    <input
                      key={`${entry.id}:${entry.name}`}
                      type="text"
                      defaultValue={entry.name}
                      onBlur={(event) => {
                        const name = event.currentTarget.value.trim();
                        if (name && name !== entry.name) {
                          onRename(entry.id, name);
                        } else {
                          event.currentTarget.value = entry.name;
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                          event.currentTarget.value = entry.name;
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </label>
                  <div className="history-entry-meta">
                    {isCurrent && <strong className="history-current-marker">現在</strong>}
                    <span>{formatTimestamp(entry.timestamp)}</span>
                    <span>seed {entry.seed}</span>
                    {entry.range && (
                      <span>{entry.range.startBar + 1}–{entry.range.endBar}小節</span>
                    )}
                  </div>
                </div>
                <div className="history-entry-actions">
                  <button
                    className="history-compare-button"
                    type="button"
                    aria-pressed={isCompared}
                    onClick={() => toggleComparison(entry.id)}
                  >
                    {isCompared ? "比較から外す" : "比較"}
                  </button>
                  <button
                    className="secondary-button history-restore-button"
                    type="button"
                    disabled={isCurrent}
                    onClick={() => onRestore(entry.id)}
                  >
                    {isCurrent ? "使用中" : "復元"}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
