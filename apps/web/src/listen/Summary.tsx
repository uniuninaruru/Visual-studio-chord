import type { EngineTally } from "./session";

interface SummaryProps {
  tally: Record<string, EngineTally>;
  saveStatus: string | null;
  onSave: () => void;
}

export function Summary({ tally, saveStatus, onSave }: SummaryProps) {
  return (
    <section className="summary" aria-labelledby="summary-heading">
      <h2 id="summary-heading">全ケースの判定が終わりました</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">版</th>
            <th scope="col">勝ち</th>
            <th scope="col">引き分け</th>
            <th scope="col">負け</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(tally).map(([engine, entry]) => (
            <tr key={engine}>
              <th scope="row">{engine}</th>
              <td>{entry.wins}</td>
              <td>{entry.ties}</td>
              <td>{entry.losses}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="summary-actions">
        <button type="button" className="primary" onClick={onSave}>結果を保存</button>
        {saveStatus && <p role="status">{saveStatus}</p>}
      </div>
    </section>
  );
}
