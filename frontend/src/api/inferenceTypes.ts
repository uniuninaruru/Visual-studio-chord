import type { components } from "./generated";

type Schemas = components["schemas"];

export type HealthResponse = Schemas["HealthResponse"];
export type DeviceResponse = Schemas["DeviceResponse"];
export type ModelInfo = Schemas["ModelInfo"];
export type ModelCapability = ModelInfo["capabilities"][number];
export type ModelsResponse = Schemas["ModelsResponse"];
export type RankResponse = Schemas["RankResponse"];
export type PreferenceUpdateResponse = Schemas["PreferenceUpdateResponse"];
export type RuntimeDevice = HealthResponse["runtime"];
export type ServerModelId = HealthResponse["activeModel"];
export type ServerPreferenceCategory = Schemas["PreferenceUpdateRequest"]["category"];
export type ServerPreferenceFeedback = Schemas["PreferenceUpdateRequest"]["feedback"];

/** The UI always sends an explicit feature map even though the API defaults it. */
export type RankCandidate = Omit<Schemas["RankCandidate"], "features"> & {
  features: NonNullable<Schemas["RankCandidate"]["features"]>;
};

/**
 * Pydantic serializes defaults, while OpenAPI marks some of those properties
 * optional. The UI consumes actual wire responses and always sends explicit
 * generation controls, so these aliases only tighten generated schemas.
 */
export type HarmonyGenerateRequest = Required<Schemas["HarmonyGenerateRequest"]>;
export type HarmonyCondition = Required<Schemas["HarmonyCondition"]>;
export type HarmonyEditSpan = Schemas["HarmonyEditSpan"];
export type HarmonyTonalitySpan = Schemas["HarmonyTonalitySpan"];
export type HarmonyFactorEvent = Required<Schemas["HarmonyFactorEvent"]>;
export type HarmonyCandidate = Required<Schemas["HarmonyCandidate"]>;
type GeneratedHarmonyJobResponse = Required<Schemas["HarmonyJobResponse"]>;
export type HarmonyJobResponse = Omit<GeneratedHarmonyJobResponse, "candidates"> & {
  candidates: HarmonyCandidate[];
};
export type HarmonyModelManifestResponse =
  Required<Schemas["HarmonyModelManifestResponse"]>;
export type HarmonyModelId = HarmonyGenerateRequest["modelId"];
export type HarmonyPreferredDevice = HarmonyGenerateRequest["preferredDevice"];
export type HarmonyMaskMode = HarmonyEditSpan["mode"];
export type HarmonyResultMaskMode = HarmonyFactorEvent["maskMode"];
export type HarmonyJobState = HarmonyJobResponse["state"];
export type HarmonyJobStage = HarmonyJobResponse["stage"];
export type HarmonyDevice = HarmonyJobResponse["device"];
export type HarmonyBackend = HarmonyJobResponse["backend"];
export type HarmonyDtype = HarmonyJobResponse["dtype"];

export interface NeuralHarmonyPreviewMetadata {
  candidateId: string;
  modelId: HarmonyModelId;
  device: HarmonyDevice | null;
  backend: HarmonyBackend;
  dtype: HarmonyDtype | null;
  mock: boolean;
  trained: boolean;
  checkpointSha256: string | null;
  tokenizerSha256: string;
  sourceCommit: string | null;
  candidateCount: number;
  batchSize: number;
  cpuFallbackUsed: boolean;
  fallbackReason: string | null;
  neuralMeanLogProbability: number | null;
  meanConfidence: number;
  hardRuleVector: Record<string, number>;
  clientTheoryValidated: true;
  rebasedAgainstNewerEdits: boolean;
  theoryWarnings: string[];
  arrangementWarnings: string[];
}

export type BackendConnection =
  | { state: "checking" }
  | {
      state: "browser";
      message: string;
      /**
       * `browser-only` is a build that never had a backend to reach, so it is
       * distinct from one that looked and failed. Retries key off
       * `unreachable`, and a message about a stopped server is wrong for a
       * visitor who never started one.
       */
      reason: "unreachable" | "api-mismatch" | "browser-only";
    }
  | {
      state: "connected";
      health: HealthResponse;
      device: DeviceResponse;
      models: ModelsResponse;
      inferenceAuthorized: boolean;
    };
