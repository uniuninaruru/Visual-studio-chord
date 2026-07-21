export type CapabilityStatus = "available" | "unavailable" | "blocked" | "unknown";

export type BrowserCapabilityId =
  | "webAudio"
  | "audioWorklet"
  | "indexedDb"
  | "fileSystemAccess"
  | "webMidi"
  | "webSocket"
  | "webAssembly"
  | "webGpu";

export type NetworkStatus = "online" | "offline" | "unknown";

export interface BrowserCapabilityResult {
  id: BrowserCapabilityId;
  label: string;
  status: CapabilityStatus;
  available: boolean;
  detail: string;
  remedy?: string;
}

export interface BrowserCapabilities {
  checkedAt: string;
  networkStatus: NetworkStatus;
  capabilities: Readonly<Record<BrowserCapabilityId, BrowserCapabilityResult>>;
}

interface CallableRecord {
  [key: PropertyKey]: unknown;
}

interface CapabilityNavigator extends CallableRecord {
  onLine?: boolean;
  requestMIDIAccess?: unknown;
  gpu?: unknown;
}

interface CapabilityEnvironment extends CallableRecord {
  navigator?: CapabilityNavigator;
  indexedDB?: unknown;
  AudioContext?: unknown;
  webkitAudioContext?: unknown;
  WebSocket?: unknown;
  WebAssembly?: unknown;
  showOpenFilePicker?: unknown;
}

interface AudioContextLike {
  audioWorklet?: { addModule?: unknown };
  close?: () => Promise<unknown> | unknown;
}

interface IndexedDbRequestLike {
  result?: { close?: () => void };
  error?: unknown;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onblocked: ((event: Event) => void) | null;
}

interface IndexedDbFactoryLike {
  open: (name: string, version?: number) => IndexedDbRequestLike;
  deleteDatabase?: (name: string) => unknown;
}

const CAPABILITY_REMEDIES: Readonly<Record<BrowserCapabilityId, string>> = {
  webAudio: "この端末では再生を利用できません。別の対応ブラウザを試すか、OSの音声設定を確認してください。",
  audioWorklet: "基本のWeb Audio再生へ切り替えます。高精度な音声処理には対応ブラウザが必要です。",
  indexedDb: "localStorage、利用できない場合はセッション内メモリへ保存を切り替えてください。",
  fileSystemAccess: "通常のファイル選択とダウンロードを使用してください。",
  webMidi: "MIDI機器との直接接続を無効にし、MIDIファイルの入出力を使用してください。",
  webSocket: "リアルタイム更新を停止し、通常のHTTP再試行を使用してください。",
  webAssembly: "ブラウザ内推論を無効にし、ローカルサーバーまたは理論ベース生成を使用してください。",
  webGpu: "WASM、ローカルCPUサーバー、または理論ベース生成へ切り替えてください。",
};

let indexedDbProbeSequence = 0;

function result(
  id: BrowserCapabilityId,
  label: string,
  status: CapabilityStatus,
  detail: string,
): BrowserCapabilityResult {
  return {
    id,
    label,
    status,
    available: status === "available",
    detail,
    ...(status === "available" ? {} : { remedy: CAPABILITY_REMEDIES[id] }),
  };
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

function asRecord(value: unknown): CallableRecord | undefined {
  return (typeof value === "object" && value !== null) || typeof value === "function"
    ? value as CallableRecord
    : undefined;
}

async function detectAudio(
  environment: CapabilityEnvironment,
): Promise<Pick<BrowserCapabilities["capabilities"], "webAudio" | "audioWorklet">> {
  const AudioContextConstructor = environment.AudioContext ?? environment.webkitAudioContext;
  if (!isCallable(AudioContextConstructor)) {
    return {
      webAudio: result("webAudio", "Web Audio", "unavailable", "AudioContextを作成できません。"),
      audioWorklet: result("audioWorklet", "AudioWorklet", "unavailable", "Web Audioが利用できません。"),
    };
  }

  let context: AudioContextLike | undefined;
  try {
    context = Reflect.construct(AudioContextConstructor, []) as AudioContextLike;
    const worklet = asRecord(context.audioWorklet);
    const audioWorklet = worklet && isCallable(worklet.addModule)
      ? result("audioWorklet", "AudioWorklet", "available", "AudioWorklet.addModuleを利用できます。")
      : result("audioWorklet", "AudioWorklet", "unavailable", "AudioWorklet.addModuleを利用できません。");

    return {
      webAudio: result("webAudio", "Web Audio", "available", "AudioContextを作成できました。"),
      audioWorklet,
    };
  } catch {
    return {
      webAudio: result("webAudio", "Web Audio", "blocked", "AudioContextの初期化が拒否されました。"),
      audioWorklet: result("audioWorklet", "AudioWorklet", "blocked", "AudioContextを初期化できないため確認できません。"),
    };
  } finally {
    if (context && isCallable(context.close)) {
      try {
        await context.close();
      } catch {
        // Closing a short-lived diagnostic context is best effort only.
      }
    }
  }
}

function isIndexedDbFactory(value: unknown): value is IndexedDbFactoryLike {
  const record = asRecord(value);
  return Boolean(record && isCallable(record.open));
}

function probeIndexedDb(factory: IndexedDbFactoryLike, timeoutMs: number): Promise<BrowserCapabilityResult> {
  const databaseName = `__harmony_lab_capability_${Date.now()}_${indexedDbProbeSequence += 1}`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: BrowserCapabilityResult) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      resolve(value);
    };
    const timeoutId = globalThis.setTimeout(() => {
      finish(result("indexedDb", "IndexedDB", "blocked", "保存領域の確認がタイムアウトしました。"));
    }, timeoutMs);

    try {
      const request = factory.open(databaseName, 1);
      request.onsuccess = () => {
        try {
          request.result?.close?.();
          factory.deleteDatabase?.(databaseName);
        } catch {
          // The disposable probe database may be cleaned up by the browser later.
        }
        finish(result("indexedDb", "IndexedDB", "available", "テスト用データベースを開けました。"));
      };
      request.onerror = () => {
        finish(result("indexedDb", "IndexedDB", "blocked", "ブラウザが保存領域へのアクセスを拒否しました。"));
      };
      request.onblocked = () => {
        finish(result("indexedDb", "IndexedDB", "blocked", "保存領域が別の処理によってブロックされています。"));
      };
    } catch {
      finish(result("indexedDb", "IndexedDB", "blocked", "テスト用データベースを開けませんでした。"));
    }
  });
}

function detectWebSocket(environment: CapabilityEnvironment): BrowserCapabilityResult {
  const constructor = environment.WebSocket;
  const prototype = asRecord(asRecord(constructor)?.prototype);
  return isCallable(constructor) && prototype && isCallable(prototype.send) && isCallable(prototype.close)
    ? result("webSocket", "WebSocket", "available", "WebSocketの生成・送信・終了APIを利用できます。")
    : result("webSocket", "WebSocket", "unavailable", "必要なWebSocket APIを利用できません。");
}

function detectWebAssembly(environment: CapabilityEnvironment): BrowserCapabilityResult {
  const webAssembly = asRecord(environment.WebAssembly);
  if (!webAssembly || !isCallable(webAssembly.validate) || !isCallable(webAssembly.Module)) {
    return result("webAssembly", "WebAssembly", "unavailable", "必要なWebAssembly APIを利用できません。");
  }

  try {
    const minimalModule = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const valid = Reflect.apply(webAssembly.validate, environment.WebAssembly, [minimalModule]);
    if (valid !== true) {
      return result("webAssembly", "WebAssembly", "blocked", "最小モジュールの検証に失敗しました。");
    }
    Reflect.construct(webAssembly.Module, [minimalModule]);
    return result("webAssembly", "WebAssembly", "available", "最小モジュールを検証・コンパイルできました。");
  } catch {
    return result("webAssembly", "WebAssembly", "blocked", "WebAssemblyモジュールをコンパイルできませんでした。");
  }
}

async function detectWebGpu(navigatorValue: CapabilityNavigator | undefined): Promise<BrowserCapabilityResult> {
  const gpu = asRecord(navigatorValue?.gpu);
  if (!gpu || !isCallable(gpu.requestAdapter)) {
    return result("webGpu", "WebGPU", "unavailable", "WebGPU adapterを要求できません。");
  }

  try {
    const adapter = await Reflect.apply(gpu.requestAdapter, navigatorValue?.gpu, []);
    return adapter
      ? result("webGpu", "WebGPU", "available", "利用可能なGPU adapterを取得できました。")
      : result("webGpu", "WebGPU", "unavailable", "利用可能なGPU adapterが見つかりませんでした。");
  } catch {
    return result("webGpu", "WebGPU", "blocked", "GPU adapterの初期化が拒否されました。");
  }
}

function detectNetworkStatus(navigatorValue: CapabilityNavigator | undefined): NetworkStatus {
  if (typeof navigatorValue?.onLine !== "boolean") return "unknown";
  return navigatorValue.onLine ? "online" : "offline";
}

/**
 * Detects capabilities by callable/constructible behavior instead of browser name.
 * The function is intentionally side-effect free until explicitly called.
 */
export async function detectBrowserCapabilities(
  environment: unknown = globalThis,
): Promise<BrowserCapabilities> {
  const source = asRecord(environment) as CapabilityEnvironment | undefined;
  const safeEnvironment = source ?? {};
  const navigatorValue = asRecord(safeEnvironment.navigator) as CapabilityNavigator | undefined;
  const audio = await detectAudio(safeEnvironment);
  const indexedDb = isIndexedDbFactory(safeEnvironment.indexedDB)
    ? await probeIndexedDb(safeEnvironment.indexedDB, 1_500)
    : result("indexedDb", "IndexedDB", "unavailable", "IndexedDB.openを利用できません。");
  const fileSystemAccess = isCallable(safeEnvironment.showOpenFilePicker)
    ? result("fileSystemAccess", "File System Access", "available", "ファイル選択APIを呼び出せます（許可は操作時に確認されます）。")
    : result("fileSystemAccess", "File System Access", "unavailable", "ファイル選択APIを利用できません。");
  const webMidi = isCallable(navigatorValue?.requestMIDIAccess)
    ? result("webMidi", "Web MIDI", "available", "MIDIアクセスAPIを呼び出せます（許可は接続時に確認されます）。")
    : result("webMidi", "Web MIDI", "unavailable", "MIDIアクセスAPIを利用できません。");

  return {
    checkedAt: new Date().toISOString(),
    networkStatus: detectNetworkStatus(navigatorValue),
    capabilities: {
      ...audio,
      indexedDb,
      fileSystemAccess,
      webMidi,
      webSocket: detectWebSocket(safeEnvironment),
      webAssembly: detectWebAssembly(safeEnvironment),
      webGpu: await detectWebGpu(navigatorValue),
    },
  };
}
