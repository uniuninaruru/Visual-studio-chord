import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * The tools, as one region with tabs rather than five panels in a column.
 *
 * Measured before this: below the two views of the piece the centre column ran
 * on for another two thousand pixels of repair offer, search box, reharmoniser,
 * variation list, preference profile and history — every one of them permanently
 * expanded, and never more than one of them in use. A reader looking for the
 * history scrolled past four panels about something else to reach it.
 *
 * They are modes, so they are tabs. Nothing is removed and nothing is harder to
 * reach than one press.
 *
 * ## Hidden, not unmounted
 *
 * Every panel stays in the tree with `hidden`, which takes it out of the
 * accessibility tree and out of tab order while leaving its state alone. A
 * search query typed, a candidate part-way through auditioning, a history
 * comparison half-selected: all of it survives a trip to another tab, which it
 * would not if the panel were unmounted. It also means anything that queries
 * the DOM for these panels still finds them.
 *
 * ## Content that arrives from outside
 *
 * The variation list is filled by the regeneration dock at the bottom of the
 * screen, which is outside this region. Generating candidates and having
 * nothing visibly happen would be worse than the scroll this replaces, so a tab
 * whose content arrives while the user is elsewhere takes focus. That is the
 * only automatic switch: a tab that merely HAS content shows a marker and waits,
 * because moving someone off what they were doing is a cost that only an
 * arrival they asked for can justify.
 */

export interface WorkspaceTool {
  id: string;
  label: string;
  /** Shown as a marker on the tab: this tool has something in it right now. */
  hasContent?: boolean;
  /**
   * Bring this tab forward when it becomes true.
   *
   * For content the user asked for from somewhere else on the screen. Rising
   * edge only, so returning to another tab afterwards is not fought.
   */
  claimsFocus?: boolean;
  render: () => ReactNode;
}

export interface WorkspaceToolsProps {
  tools: readonly WorkspaceTool[];
}

export function WorkspaceTools({ tools }: WorkspaceToolsProps) {
  const groupId = useId();
  const [active, setActive] = useState(() => tools[0]?.id ?? "");
  // What each tool's claim looked like last render, so a claim that is simply
  // still true does not keep pulling the user back.
  const claimedRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    for (const tool of tools) {
      const was = claimedRef.current[tool.id] ?? false;
      const now = tool.claimsFocus ?? false;
      claimedRef.current[tool.id] = now;
      if (now && !was) setActive(tool.id);
    }
  }, [tools]);

  // Left and right move between tabs, which is what a tablist is expected to
  // do and what the arrow keys do nowhere else in this column.
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = tools[(index + step + tools.length) % tools.length];
    if (!next) return;
    setActive(next.id);
    document.getElementById(`${groupId}-tab-${next.id}`)?.focus();
  };

  return (
    <section className="workspace-tools" aria-label="編集ツール">
      <div className="workspace-tools-tablist" role="tablist" aria-label="編集ツール">
        {tools.map((tool, index) => (
          <button
            key={tool.id}
            type="button"
            role="tab"
            id={`${groupId}-tab-${tool.id}`}
            aria-selected={active === tool.id}
            aria-controls={`${groupId}-panel-${tool.id}`}
            tabIndex={active === tool.id ? 0 : -1}
            className={active === tool.id ? "workspace-tool-tab selected" : "workspace-tool-tab"}
            onClick={() => setActive(tool.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tool.label}
            {tool.hasContent && (
              <span className="workspace-tool-marker" aria-label="内容があります" />
            )}
          </button>
        ))}
      </div>
      {tools.map((tool) => (
        <div
          key={tool.id}
          role="tabpanel"
          id={`${groupId}-panel-${tool.id}`}
          aria-labelledby={`${groupId}-tab-${tool.id}`}
          hidden={active !== tool.id}
        >
          {tool.render()}
        </div>
      ))}
    </section>
  );
}
