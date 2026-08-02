import {
  EDITOR_HISTORY_RECORD,
  EDITOR_MIGRATION_FLAG_KEY,
  type EditorDatabase,
  type EditorPersistenceMode,
} from "./editorDatabase";
import { EDITOR_HISTORY_STORAGE_KEY } from "./editorPersistence";
import { getSafeStorage, type StorageLike } from "./safeStorage";

export interface HistoryMigrationResult {
  /** True when this call moved localStorage history into the database. */
  migrated: boolean;
  /** Where the history now lives. */
  mode: EditorPersistenceMode | null;
  /** Set when a migration was attempted and did not succeed. */
  failureReason: "read-failed" | "write-failed" | null;
}

/**
 * Moves the Web Storage history sidecar into IndexedDB, once.
 *
 * Only the history moves. The current project stays in Web Storage because the
 * store hydrates from it synchronously at module scope, and the first paint
 * depends on that; the history is what grows without bound and what overflows a
 * quota, and nobody can press Undo before the app has rendered.
 *
 * The Web Storage copy is left in place. If IndexedDB is later evicted — which
 * private browsing and storage pressure both do — an untouched copy is the
 * difference between losing the last edit and losing the project's whole
 * history. Reclaiming those bytes is not worth that.
 */
export async function migrateEditorHistoryToDatabase(
  database: EditorDatabase,
  storage: StorageLike = getSafeStorage(),
): Promise<HistoryMigrationResult> {
  let alreadyMigrated: string | null;
  let legacy: string | null;
  try {
    alreadyMigrated = storage.getItem(EDITOR_MIGRATION_FLAG_KEY);
    legacy = storage.getItem(EDITOR_HISTORY_STORAGE_KEY);
  } catch {
    return { migrated: false, mode: null, failureReason: "read-failed" };
  }

  if (alreadyMigrated === "1") {
    return { migrated: false, mode: database.mode, failureReason: null };
  }
  if (legacy === null) {
    // Nothing to carry across. Recording the flag anyway stops every later
    // start from re-reading Web Storage looking for a sidecar that never
    // existed.
    markMigrated(storage);
    return { migrated: false, mode: database.mode, failureReason: null };
  }

  const mode = await database.write(EDITOR_HISTORY_RECORD, legacy);
  if (mode === "memory") {
    // The destination is no more durable than the source, so the flag is not
    // set: a later start, perhaps with IndexedDB working, retries the move.
    return { migrated: false, mode, failureReason: "write-failed" };
  }
  markMigrated(storage);
  return { migrated: true, mode, failureReason: null };
}

function markMigrated(storage: StorageLike): void {
  try {
    storage.setItem(EDITOR_MIGRATION_FLAG_KEY, "1");
  } catch {
    // A failed flag write only costs a repeated migration attempt, which is
    // idempotent, so there is nothing to report.
  }
}
