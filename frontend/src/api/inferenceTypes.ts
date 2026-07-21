export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
  apiVersion?: string;
  requestId?: string;
}

export type RuntimeDevice = "cpu" | "cuda" | "mps" | "coreml" | "directml";
export type ServerModelId =
  | "local-deterministic-v1"
  | "local-mlp-v1"
  | "local-onnx-v1";

export interface DeviceResponse {
  selectedDevice: RuntimeDevice;
  torchAvailable: boolean;
  onnxRuntimeAvailable: boolean;
  cudaAvailable: boolean;
  torchCudaAvailable: boolean;
  mpsAvailable: boolean;
  coremlAvailable: boolean;
  directmlAvailable: boolean;
  deviceName: string;
  cudaDeviceCount: number;
  totalMemoryMb: number | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  runtime: RuntimeDevice | "browser";
  available: boolean;
  loaded: boolean;
  capabilities: Array<"rank">;
}

export interface ModelsResponse {
  models: ModelInfo[];
  activeModel: ServerModelId;
  activeRuntime: RuntimeDevice;
  fallbackReason?: string | null;
}

export interface RankCandidate {
  id: string;
  features: Record<string, number>;
}

export interface RankResponse {
  ranked: Array<{ id: string; score: number }>;
  device: RuntimeDevice;
  modelId: ServerModelId;
  runtime: RuntimeDevice;
  batchSize: number;
  fallbackReason?: string | null;
}

export type ServerPreferenceCategory = "chords" | "melody" | "rhythm" | "voicing" | "combined";
export type ServerPreferenceFeedback =
  | "like"
  | "dislike"
  | "favorite"
  | "abSelected"
  | "notMyStyle"
  | "adopted"
  | "immediateUndo"
  | "saved"
  | "midiExported"
  | "replayed"
  | "manuallyEdited";

export interface PreferenceUpdateResponse {
  weights: Record<string, number>;
  evaluationCount: number;
  confidence: number;
}

export type BackendConnection =
  | { state: "checking" }
  | { state: "browser"; message: string }
  | {
      state: "connected";
      health: HealthResponse;
      device: DeviceResponse;
      models: ModelsResponse;
    };
