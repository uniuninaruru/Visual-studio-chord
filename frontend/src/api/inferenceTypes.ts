import type { components } from "./generated";

type Schemas = components["schemas"];

export type HealthResponse = Schemas["HealthResponse"];
export type DeviceResponse = Schemas["DeviceResponse"];
export type ModelInfo = Schemas["ModelInfo"];
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

export type BackendConnection =
  | { state: "checking" }
  | { state: "browser"; message: string; reason: "unreachable" | "api-mismatch" }
  | {
      state: "connected";
      health: HealthResponse;
      device: DeviceResponse;
      models: ModelsResponse;
      inferenceAuthorized: boolean;
    };
