import { useMemo, useState } from "react";
import {
  degreeDigitsOf,
  romanOf,
  searchProgressions,
  type ProgressionSearchResult,
} from "../../music/progressionSearch";
import {
  DEVICE_LABELS,
  type ProgressionDevice,
} from "../../music/progressionVariants";
import type { Mode } from "../../types/music";

/**
 * Finding one progression among a thousand.
 *
 * The catalogue is thirty-six named progressions; the derived set is those
 * under documented devices, and it is around fifteen hundred. That is past the
 * point where a list can be read, so this is a search box rather than a menu.
 *
 * Every result says where it came from. A derived entry is never presented as
 * a named progression -- it carries the name it was derived from and the
 * devices applied, because "the royal road with a secondary dominant" is a
 * true description and "a progression called X" would not be.
 */

const USAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "すべて" },
  { value: "verse", label: "Aメロ" },
  { value: "preChorus", label: "Bメロ" },
  { value: "chorus", label: "サビ" },
  { value: "bridge", label: "ブリッジ" },
  { value: "any", label: "指定なし" },
];

const DEVICES = Object.keys(DEVICE_LABELS) as ProgressionDevice[];

export interface ProgressionSearchPanelProps {
  mode: Mode;
  /** Applies a progression to the current selection, when the host can. */
  onApply?: (result: ProgressionSearchResult) => void;
  /** Sounds it without changing the piece. */
  onAudition?: (result: ProgressionSearchResult) => void;
  /** What onApply would overwrite, named so the button can say it. */
  target?: string;
}

const PAGE = 40;

export function ProgressionSearchPanel({
  mode,
  onApply,
  onAudition,
  target,
}: ProgressionSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [usage, setUsage] = useState("");
  const [devices, setDevices] = useState<ProgressionDevice[]>([]);
  const [cataloguedOnly, setCataloguedOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);

  // Enumerating fifteen hundred progressions on every keystroke would be
  // wasteful; the search itself is cheap once the set exists, and the set
  // depends only on the mode and the filters.
  const results = useMemo(
    () => searchProgressions({ mode, query, usage: usage || undefined, devices, cataloguedOnly }),
    [mode, query, usage, devices, cataloguedOnly],
  );

  const toggleDevice = (device: ProgressionDevice) => {
    setShown(PAGE);
    setDevices((current) => current.includes(device)
      ? current.filter((entry) => entry !== device)
      : [...current, device]);
  };

  return (
    <section className="progression-search" aria-label="コード進行を探す">
      <header className="progression-search-header">
        <h2>コード進行を探す</h2>
        <p>
          度数（<code>4536</code>）、ローマ数字（<code>IV V iii vi</code>）、名前（<code>王道</code>）、
          技法（<code>サブドミナントマイナー</code>）のどれでも検索できます。
        </p>
      </header>

      <div className="progression-search-controls">
        <input
          type="search"
          className="progression-search-input"
          value={query}
          placeholder="4536 / IV V iii vi / 王道 / b2"
          aria-label="コード進行を検索"
          onChange={(event) => { setQuery(event.target.value); setShown(PAGE); }}
        />
        <label className="progression-search-usage">
          <span>使いどころ</span>
          <select
            value={usage}
            onChange={(event) => { setUsage(event.target.value); setShown(PAGE); }}
          >
            {USAGES.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label className="progression-search-catalogued">
          <input
            type="checkbox"
            checked={cataloguedOnly}
            onChange={(event) => { setCataloguedOnly(event.target.checked); setShown(PAGE); }}
          />
          <span>名前のついたものだけ</span>
        </label>
      </div>

      <div className="progression-search-devices" role="group" aria-label="技法で絞る">
        {DEVICES.map((device) => (
          <button
            key={device}
            type="button"
            aria-pressed={devices.includes(device)}
            className={devices.includes(device) ? "device-chip selected" : "device-chip"}
            disabled={cataloguedOnly}
            onClick={() => toggleDevice(device)}
          >
            {DEVICE_LABELS[device]}
          </button>
        ))}
      </div>

      <p className="progression-search-count" role="status">
        {results.length === 0
          ? "見つかりませんでした。度数（4536）や名前（王道）でも試せます。"
          : `${results.length} 件`}
      </p>

      <ul className="progression-search-results">
        {results.slice(0, shown).map((result) => (
          <li key={result.variant.id} className="progression-result">
            <div className="progression-result-main">
              <strong className="progression-roman">{romanOf(result.variant, mode)}</strong>
              <span className="progression-digits">{degreeDigitsOf(result.variant)}</span>
            </div>
            <div className="progression-result-meta">
              <span className="progression-name">{result.variant.label}</span>
              {result.variant.devices.length > 0 && (
                // Said plainly, because a derived progression is not a named
                // one and presenting it as one would be a small lie repeated
                // fifteen hundred times.
                <span className="progression-derived">
                  「{result.variant.baseId}」から派生
                </span>
              )}
              {result.reasons.length > 0 && (
                <span className="progression-reasons">{result.reasons.join(" / ")}</span>
              )}
            </div>
            {(onAudition || onApply) && (
              <div className="progression-result-actions">
                {onAudition && (
                  <button type="button" onClick={() => onAudition(result)}>試聴</button>
                )}
                {onApply && (
                  <button
                    type="button"
                    onClick={() => onApply(result)}
                    // The destination in the label rather than in a tooltip: it
                    // rewrites bars that are already there, and which bars is
                    // the one thing worth knowing before pressing it.
                    title={target ? `${target}のコードをこの進行に置き換えます` : undefined}
                  >
                    {target ? `${target}に使う` : "使う"}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {results.length > shown && (
        <button
          type="button"
          className="progression-search-more"
          onClick={() => setShown((current) => current + PAGE)}
        >
          さらに {Math.min(PAGE, results.length - shown)} 件を表示
        </button>
      )}
    </section>
  );
}
