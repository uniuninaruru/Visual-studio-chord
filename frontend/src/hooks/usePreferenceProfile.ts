import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPreferenceModel,
  updatePreferenceModel,
  type PreferenceFeedback,
  type PreferenceModel,
} from "../preference";
import {
  createPreferenceStorage,
  serializePreferenceModel,
  type PreferencePersistenceMode,
  type PreferenceStorage,
} from "../storage";

const preferenceStorage = createPreferenceStorage();

export interface PreferenceProfileController {
  model: PreferenceModel;
  persistenceMode: PreferencePersistenceMode;
  loaded: boolean;
  record(feedback: PreferenceFeedback): PreferenceModel;
  exportJson(): string;
  importJson(json: string): Promise<void>;
  reset(): Promise<void>;
}

type PreferenceStorageAdapter = Pick<
  PreferenceStorage,
  "mode" | "load" | "save" | "importJson" | "reset"
>;

export function usePreferenceProfile(
  storage: PreferenceStorageAdapter = preferenceStorage,
): PreferenceProfileController {
  const [model, setModel] = useState<PreferenceModel>(() => createPreferenceModel());
  const [loaded, setLoaded] = useState(false);
  const [persistenceMode, setPersistenceMode] = useState<PreferencePersistenceMode>(
    storage.mode,
  );
  const modelRef = useRef(model);
  const loadedRef = useRef(false);
  const queuedFeedbackRef = useRef<PreferenceFeedback[]>([]);
  const replacementRevisionRef = useRef(0);
  const replacementPendingRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const replaceModel = useCallback((next: PreferenceModel) => {
    modelRef.current = next;
    setModel(next);
  }, []);

  const enqueuePersistence = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const queued = saveQueueRef.current
      .catch(() => undefined)
      .then(operation);
    saveQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, []);

  const persist = useCallback((next: PreferenceModel) => {
    const revision = replacementRevisionRef.current;
    void enqueuePersistence(async () => {
      const mode = await storage.save(next);
      if (replacementRevisionRef.current === revision) {
        setPersistenceMode(mode);
      }
    });
  }, [enqueuePersistence, storage]);

  useEffect(() => {
    let cancelled = false;
    const replacementRevision = replacementRevisionRef.current;
    void storage.load().then((stored) => {
      if (cancelled) return;
      const wasReplacedWhileLoading = replacementRevisionRef.current !== replacementRevision;
      if (!wasReplacedWhileLoading) {
        let merged = stored ?? createPreferenceModel();
        for (const feedback of queuedFeedbackRef.current) {
          merged = updatePreferenceModel(merged, feedback);
        }
        replaceModel(merged);
        if (queuedFeedbackRef.current.length > 0) persist(merged);
      }
      if (!wasReplacedWhileLoading) queuedFeedbackRef.current = [];
      loadedRef.current = true;
      setPersistenceMode(storage.mode);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [persist, replaceModel, storage]);

  const record = useCallback((feedback: PreferenceFeedback): PreferenceModel => {
    const replacementPending = replacementPendingRef.current > 0;
    if (!loadedRef.current || replacementPending) queuedFeedbackRef.current.push(feedback);
    const next = updatePreferenceModel(modelRef.current, feedback);
    replaceModel(next);
    if (loadedRef.current && !replacementPending) persist(next);
    return next;
  }, [persist, replaceModel]);

  const exportJson = useCallback(
    () => serializePreferenceModel(modelRef.current),
    [],
  );

  const importJson = useCallback(async (json: string) => {
    const revision = replacementRevisionRef.current + 1;
    replacementRevisionRef.current = revision;
    replacementPendingRef.current += 1;
    queuedFeedbackRef.current = [];
    let imported: PreferenceModel;
    try {
      imported = await enqueuePersistence(() => storage.importJson(json));
    } catch (error) {
      if (replacementRevisionRef.current === revision) {
        const hadQueuedFeedback = queuedFeedbackRef.current.length > 0;
        queuedFeedbackRef.current = [];
        if (hadQueuedFeedback) persist(modelRef.current);
      }
      throw error;
    } finally {
      replacementPendingRef.current = Math.max(0, replacementPendingRef.current - 1);
    }
    if (replacementRevisionRef.current !== revision) return;
    let merged = imported;
    const queuedFeedback = queuedFeedbackRef.current;
    queuedFeedbackRef.current = [];
    for (const feedback of queuedFeedback) {
      merged = updatePreferenceModel(merged, feedback);
    }
    replaceModel(merged);
    setPersistenceMode(storage.mode);
    if (queuedFeedback.length > 0) persist(merged);
  }, [enqueuePersistence, persist, replaceModel, storage]);

  const reset = useCallback(async () => {
    const revision = replacementRevisionRef.current + 1;
    replacementRevisionRef.current = revision;
    replacementPendingRef.current += 1;
    queuedFeedbackRef.current = [];
    try {
      await enqueuePersistence(() => storage.reset());
    } catch (error) {
      if (replacementRevisionRef.current === revision) {
        const hadQueuedFeedback = queuedFeedbackRef.current.length > 0;
        queuedFeedbackRef.current = [];
        if (hadQueuedFeedback) persist(modelRef.current);
      }
      throw error;
    } finally {
      replacementPendingRef.current = Math.max(0, replacementPendingRef.current - 1);
    }
    if (replacementRevisionRef.current !== revision) return;
    let resetModel = createPreferenceModel();
    const queuedFeedback = queuedFeedbackRef.current;
    queuedFeedbackRef.current = [];
    for (const feedback of queuedFeedback) {
      resetModel = updatePreferenceModel(resetModel, feedback);
    }
    replaceModel(resetModel);
    setPersistenceMode(storage.mode);
    if (queuedFeedback.length > 0) persist(resetModel);
  }, [enqueuePersistence, persist, replaceModel, storage]);

  return { model, persistenceMode, loaded, record, exportJson, importJson, reset };
}
