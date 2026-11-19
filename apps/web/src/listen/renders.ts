import type { CaseSet, Render } from "@vsc/core";
import caseFile from "../../../../eval/cases.json";

export const caseSet = caseFile as unknown as CaseSet;

const modules = import.meta.glob<Render>("../../../../eval/renders/*/*.json", { import: "default" });

const loaders = new Map<string, Map<string, () => Promise<Render>>>();
for (const [path, load] of Object.entries(modules)) {
  const match = /renders\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!match) continue;
  const [, engine, caseId] = match as unknown as [string, string, string];
  if (!loaders.has(engine)) loaders.set(engine, new Map());
  loaders.get(engine)!.set(caseId, load);
}

/** Versions that have rendered every case in the set. */
export function availableEngines(): string[] {
  return [...loaders.entries()]
    .filter(([, cases]) => caseSet.cases.every((listeningCase) => cases.has(listeningCase.id)))
    .map(([engine]) => engine)
    .sort();
}

export function loadRender(engine: string, caseId: string): Promise<Render> {
  const load = loaders.get(engine)?.get(caseId);
  if (!load) return Promise.reject(new Error(`${engine} has no render for ${caseId}`));
  return load();
}
