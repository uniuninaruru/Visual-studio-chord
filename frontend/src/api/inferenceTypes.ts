export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
}

export interface DeviceResponse {
  selectedDevice: "cpu" | "cuda";
  cudaAvailable: boolean;
  torchAvailable: boolean;
  mpsAvailable: boolean;
  deviceName: string;
  cudaDeviceCount: number;
  totalMemoryMb: number | null;
}

export type BackendConnection =
  | { state: "checking" }
  | { state: "browser"; message: string }
  | { state: "connected"; health: HealthResponse; device: DeviceResponse };
