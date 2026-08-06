import { useCallback, useRef } from "react";
import { importCompositionFile, midiBlob } from "../features/export";
import { importMelodyFile, MelodyImportError } from "../music/melodyImport";
import type { GeneratorSettings } from "../types/music";
import type { GeneratedComposition } from "../types/music";
import { downloadBlob } from "../utils/musicFormat";

/** Largest preference file accepted, to keep a stray upload from stalling the tab. */
const MAX_PREFERENCE_FILE_BYTES = 2_000_000;

function compositionFilename(seed: string, extension: "json" | "mid"): string {
  const safeSeed = seed.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 32) || "composition";
  return `visual-studio-chord-${safeSeed}.${extension}`;
}

export interface ProjectImportExportOptions {
  composition: GeneratedComposition;
  exportProjectJson: () => string;
  importProjectJson: (json: string) => void;
  /** Settings an imported melody inherits for everything it does not decide. */
  generatorSettings: GeneratorSettings;
  importMelodyComposition: (composition: GeneratedComposition) => void;
  exportPreferenceJson: () => string;
  importPreferenceJson: (json: string) => Promise<void>;
  /** Called after a successful import so stale selections are dropped. */
  onImported: () => void;
  /** Called after a preference change so cached server scores are discarded. */
  onPreferenceChanged: () => void;
  onToast: (message: string) => void;
}

export interface ProjectImportExport {
  /** Attach to the hidden project-file input. */
  importInputRef: React.RefObject<HTMLInputElement | null>;
  /** Attach to the hidden preference-file input. */
  preferenceImportInputRef: React.RefObject<HTMLInputElement | null>;
  /** Attach to the hidden melody-MIDI input. */
  melodyImportInputRef: React.RefObject<HTMLInputElement | null>;
  importMelody: (file: File | undefined) => Promise<void>;
  exportJson: () => void;
  exportMidi: () => void;
  importProject: (file: File | undefined) => Promise<void>;
  exportPreferences: () => void;
  importPreferences: (file: File | undefined) => Promise<void>;
}

/**
 * Owns getting work in and out of the app: project JSON, MIDI, and the
 * preference profile.
 *
 * Import is the one path that accepts outside data, so every failure is
 * reported to the user and leaves the current composition untouched. The file
 * inputs are cleared afterwards so choosing the same file twice still fires.
 */
export function useProjectImportExport(
  options: ProjectImportExportOptions,
): ProjectImportExport {
  const {
    composition,
    exportProjectJson,
    importProjectJson,
    generatorSettings,
    importMelodyComposition,
    exportPreferenceJson,
    importPreferenceJson,
    onImported,
    onPreferenceChanged,
    onToast,
  } = options;

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const preferenceImportInputRef = useRef<HTMLInputElement | null>(null);
  const melodyImportInputRef = useRef<HTMLInputElement | null>(null);

  const exportJson = useCallback(() => {
    const blob = new Blob([exportProjectJson()], {
      type: "application/json;charset=utf-8",
    });
    downloadBlob(blob, compositionFilename(String(composition.seed), "json"));
    onToast("編集可能なJSONを書き出しました。");
  }, [composition.seed, exportProjectJson, onToast]);

  const exportMidi = useCallback(() => {
    downloadBlob(
      midiBlob(composition),
      compositionFilename(String(composition.seed), "mid"),
    );
    const additional = composition.voices?.length ?? 0;
    onToast(
      additional > 0
        ? `コード・主旋律・追加声部${additional}本をMIDIへ書き出しました。`
        : "コードとメロディのMIDIを書き出しました。",
    );
  }, [composition, onToast]);

  const importProject = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = await importCompositionFile(file);
      importProjectJson(imported.json);
      onImported();
      onToast("JSONから楽曲を復元しました。");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "JSONを読み込めませんでした。");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }, [importProjectJson, onImported, onToast]);

  const importMelody = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await importMelodyFile(file, generatorSettings);
      importMelodyComposition(result.composition);
      onImported();
      // What it decided is worth saying: the key came from the melody's own
      // pitch distribution and the bar count was rounded up to fit, and a user
      // who disagrees can only correct it if they are told.
      onToast(
        `メロディ${result.noteCount}音を読み込み、${result.key} ${
          result.mode === "major" ? "メジャー" : "マイナー"
        }として${result.bars}小節にコードを付けました。`,
      );
    } catch (error) {
      onToast(
        error instanceof MelodyImportError || error instanceof Error
          ? error.message
          : "MIDIを読み込めませんでした。",
      );
    } finally {
      if (melodyImportInputRef.current) melodyImportInputRef.current.value = "";
    }
  }, [generatorSettings, importMelodyComposition, onImported, onToast]);

  const exportPreferences = useCallback(() => {
    downloadBlob(
      new Blob([exportPreferenceJson()], { type: "application/json;charset=utf-8" }),
      "visual-studio-chord-preferences-v1.json",
    );
    onToast("好み学習データを書き出しました。");
  }, [exportPreferenceJson, onToast]);

  const importPreferences = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > MAX_PREFERENCE_FILE_BYTES) {
        throw new Error("学習データが大きすぎます（上限2 MB）。");
      }
      await importPreferenceJson(await file.text());
      onPreferenceChanged();
      onToast("好み学習データを安全に読み込みました。");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "学習データを読み込めませんでした。");
    } finally {
      if (preferenceImportInputRef.current) {
        preferenceImportInputRef.current.value = "";
      }
    }
  }, [importPreferenceJson, onPreferenceChanged, onToast]);

  return {
    importInputRef,
    preferenceImportInputRef,
    exportJson,
    exportMidi,
    importProject,
    melodyImportInputRef,
    importMelody,
    exportPreferences,
    importPreferences,
  };
}
