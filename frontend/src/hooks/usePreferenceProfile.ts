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

export function usePreferenceProfile(): PreferenceProfileController {
  const [model, setModel] = useState<PreferenceModel>(() => createPreferenceModel());
  const [loaded, setLoaded] = useState(false);
  const [persistenceMode, setPersistenceMode] = useState<PreferencePersistenceMode>(
    preferenceStorage.mode,
  );
  const modelRef = useRef(model);

  const replaceModel = useCallback((next: PreferenceModel) => {
    modelRef.current = next;
    setModel(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void preferenceStorage.load().then((stored) => {
      if (cancelled) return;
      if (stored) replaceModel(stored);
      setPersistenceMode(preferenceStorage.mode);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [replaceModel]);

  const record = useCallback((feedback: PreferenceFeedback): PreferenceModel => {
    const next = updatePreferenceModel(modelRef.current, feedback);
    replaceModel(next);
    void preferenceStorage.save(next).then(setPersistenceMode);
    return next;
  }, [replaceModel]);

  const exportJson = useCallback(
    () => serializePreferenceModel(modelRef.current),
    [],
  );

  const importJson = useCallback(async (json: string) => {
    const imported = await preferenceStorage.importJson(json);
    replaceModel(imported);
    setPersistenceMode(preferenceStorage.mode);
  }, [replaceModel]);

  const reset = useCallback(async () => {
    await preferenceStorage.reset();
    replaceModel(createPreferenceModel());
    setPersistenceMode(preferenceStorage.mode);
  }, [replaceModel]);

  return { model, persistenceMode, loaded, record, exportJson, importJson, reset };
}
