import type { CSSProperties } from "react";
import { SECTION_LABEL } from "../../music/explanation";
import { modeLabel } from "../../utils/musicFormat";
import type {
  BarRange,
  GeneratedComposition,
  Mode,
  SectionArrangementRole,
  SectionEvent,
} from "../../types/music";

const ROLE_LABELS: Readonly<Record<SectionArrangementRole, string>> = {
  intro: "Intro",
  aMelo: "Aメロ",
  bMelo: "Bメロ",
  cMelo: "Cメロ",
};

const MODE_LABELS: Readonly<Record<Mode, string>> = {
  major: "メジャー",
  naturalMinor: "ナチュラル・マイナー",
  harmonicMinor: "ハーモニック・マイナー",
  dorian: "ドリアン",
  mixolydian: "ミクソリディアン",
};

interface VisibleSection {
  section: SectionEvent;
  startBar: number;
  endBar: number;
  roleLabel: string;
  name: string;
}

export interface SectionRulerProps {
  composition: GeneratedComposition;
  currentTick: number;
  selectedRange: BarRange | null;
  onSelectRange: (range: BarRange) => void;
}

function clampBar(value: number, barCount: number): number {
  return Math.max(0, Math.min(barCount, Math.trunc(value)));
}

function sectionIdentity(
  composition: GeneratedComposition,
  section: SectionEvent,
): Pick<VisibleSection, "roleLabel" | "name"> {
  const plan = composition.arrangementPlan;
  const instance = plan?.sequence.find((candidate) => candidate.id === section.id);
  const source = instance
    ? plan?.sections.find((candidate) => candidate.design.id === instance.sourceSectionId)
    : undefined;
  if (source) {
    return {
      roleLabel: ROLE_LABELS[source.design.role],
      name: source.design.name,
    };
  }
  const fallback = SECTION_LABEL[section.kind] ?? section.kind;
  return { roleLabel: fallback, name: "" };
}

function validSections(
  composition: GeneratedComposition,
): VisibleSection[] {
  if (!composition.sections || composition.sections.length === 0) return [];
  const barCount = Math.max(0, composition.bars.length);
  if (barCount === 0) return [];
  return composition.sections
    .map((section) => {
      if (!Number.isFinite(section.startBar) || !Number.isFinite(section.endBar)) return null;
      const startBar = clampBar(section.startBar, barCount);
      const endBar = clampBar(section.endBar, barCount);
      if (endBar <= startBar) return null;
      return {
        section,
        startBar,
        endBar,
        ...sectionIdentity(composition, section),
      };
    })
    .filter((section): section is VisibleSection => section !== null)
    .sort((left, right) => left.startBar - right.startBar || left.endBar - right.endBar);
}

export function SectionRuler({
  composition,
  currentTick,
  selectedRange,
  onSelectRange,
}: SectionRulerProps) {
  const sections = validSections(composition);
  if (sections.length === 0) return null;

  const barCount = composition.bars.length;
  const ticksPerBar = Math.max(1, composition.ticksPerBar);
  const lastTick = Math.max(0, composition.totalTicks - 1);
  const safeTick = Number.isFinite(currentTick)
    ? Math.max(0, Math.min(lastTick, currentTick))
    : 0;
  const currentBar = Math.max(
    0,
    Math.min(barCount - 1, Math.floor(safeTick / ticksPerBar)),
  );
  const rulerStyle = {
    "--bar-count": barCount,
  } as CSSProperties;

  return (
    <div className="section-ruler" data-testid="section-ruler" style={rulerStyle}>
      <div className="section-ruler-heading">
        <div className="section-ruler-heading-content">
          <h3>完成曲の構成</h3>
          <p>クリックすると、そのパート全体を選択します。</p>
        </div>
      </div>
      <div className="section-ruler-track" style={rulerStyle}>
        {sections.map(({ section, startBar, endBar, roleLabel, name }) => {
          const range = { startBar, endBar };
          const exact = selectedRange?.startBar === startBar && selectedRange.endBar === endBar;
          const intersects = selectedRange
            ? startBar < selectedRange.endBar && endBar > selectedRange.startBar
            : false;
          const playing = currentBar >= startBar && currentBar < endBar;
          const label = name && name !== roleLabel ? `${roleLabel}・${name}` : roleLabel;
          const span = `${startBar + 1}–${endBar}小節`;
          return (
            <button
              type="button"
              key={section.id}
              className={[
                "section-ruler-segment",
                `section-ruler-${section.kind}`,
                intersects ? "is-selected" : "",
                exact ? "is-selected-exact" : "",
                playing ? "is-playing" : "",
              ].filter(Boolean).join(" ")}
              style={{ gridColumn: `${startBar + 1} / ${endBar + 1}` }}
              aria-label={`${label}、${startBar + 1}〜${endBar}小節を選択`}
              aria-pressed={exact}
              aria-current={playing ? "true" : undefined}
              onClick={() => onSelectRange(range)}
            >
              <span className="section-ruler-segment-content">
                <span className="section-ruler-segment-label">
                  <strong>{roleLabel}</strong>
                  {name && name !== roleLabel && <span>{name}</span>}
                </span>
                <span className="section-ruler-segment-bars">{span}</span>
                <span className="section-ruler-segment-tonality">
                  {section.key} {MODE_LABELS[section.mode] ?? modeLabel(section.mode)}
                </span>
                {playing && <span className="section-ruler-playing-label">再生位置</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default SectionRuler;
