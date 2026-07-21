import { useEffect, useId, useRef } from "react";
import { BUILD_NODE_VERSION } from "../../buildInfo";
import type {
  BrowserCapabilities,
  BrowserCapabilityResult,
  CapabilityStatus,
  NetworkStatus,
} from "../../platform";

export type BackendConnectionStatus = "connected" | "disconnected" | "checking" | "error";
export type ApiCompatibilityStatus = "compatible" | "incompatible" | "checking" | "unknown";
export type ModelAvailabilityStatus = "ready" | "missing" | "loading" | "error";
export type StorageMode =
  | "indexeddb"
  | "localStorage"
  | "pending"
  | "memory"
  | "recovery"
  | "unsupported"
  | "unavailable";

export interface UserFacingDiagnosticError {
  title: string;
  message: string;
  remedy: string;
  canRetry: boolean;
  diagnosticCode?: string;
}

export interface BackendModelDiagnostic {
  id: string;
  name: string;
  status: ModelAvailabilityStatus;
  detail?: string;
}

export interface BackendDiagnostics {
  connection: BackendConnectionStatus;
  device: string | null;
  inferenceBackend: string;
  models: readonly BackendModelDiagnostic[];
  apiCompatibility: ApiCompatibilityStatus;
  serverApiVersion?: string;
  expectedApiVersion?: string;
  serverVersion?: string;
  pythonVersion?: string;
  platformSystem?: string;
  platformMachine?: string;
  error?: UserFacingDiagnosticError;
}

export interface DiagnosticsPanelProps {
  browserCapabilities: BrowserCapabilities | null;
  backend: BackendDiagnostics;
  projectStorageMode: StorageMode;
  historyStorageMode: StorageMode;
  preferenceStorageMode: StorageMode;
  audioError?: UserFacingDiagnosticError | null;
  onRetry: () => void;
  onClose: () => void;
}

const STATUS_LABELS: Readonly<Record<CapabilityStatus, string>> = {
  available: "利用可能",
  unavailable: "利用不可",
  blocked: "ブロック中",
  unknown: "未確認",
};

const BACKEND_STATUS_LABELS: Readonly<Record<BackendConnectionStatus, string>> = {
  connected: "接続済み",
  disconnected: "未接続",
  checking: "確認中",
  error: "エラー",
};

const API_STATUS_LABELS: Readonly<Record<ApiCompatibilityStatus, string>> = {
  compatible: "互換",
  incompatible: "非互換",
  checking: "確認中",
  unknown: "未確認",
};

const MODEL_STATUS_LABELS: Readonly<Record<ModelAvailabilityStatus, string>> = {
  ready: "利用可能",
  missing: "未配置",
  loading: "読み込み中",
  error: "エラー",
};

const STORAGE_LABELS: Readonly<Record<StorageMode, string>> = {
  indexeddb: "IndexedDB",
  localStorage: "localStorage（フォールバック）",
  pending: "現在曲を保存済み（Undo履歴を保存中）",
  memory: "セッション内メモリ（終了時に消去）",
  recovery: "読み込み保護（上書き停止中）",
  unsupported: "新しい保存形式（上書き停止中）",
  unavailable: "保存不可",
};

function focusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    "button:not([disabled])",
    "a[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  return Array.from(container.querySelectorAll<HTMLElement>(selector))
    .filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className="diagnostic-status" data-status={status} aria-label={`状態: ${label}`}>
      <span aria-hidden="true">{status === "available" || status === "connected" || status === "compatible" || status === "ready" ? "✓" : "!"}</span>
      {label}
    </span>
  );
}

function CapabilityRow({ capability }: { capability: BrowserCapabilityResult }) {
  return (
    <li className="diagnostic-row" data-status={capability.status}>
      <div className="diagnostic-row-heading">
        <strong>{capability.label}</strong>
        <StatusBadge status={capability.status} label={STATUS_LABELS[capability.status]} />
      </div>
      <p>{capability.detail}</p>
      {capability.remedy && <p className="diagnostic-remedy"><strong>対処:</strong> {capability.remedy}</p>}
    </li>
  );
}

function networkLabel(status: NetworkStatus): string {
  if (status === "online") return "オンライン";
  if (status === "offline") return "オフライン";
  return "未確認";
}

function storageRemedy(mode: StorageMode): string | null {
  if (mode === "localStorage") return "履歴容量が限られます。重要なデータはJSONで書き出してください。";
  if (mode === "pending") return "現在の曲は保存済みです。Undo履歴の保存は画面操作を妨げないタイミングで続行します。";
  if (mode === "memory") return "ページを閉じる前にJSONで書き出してください。";
  if (mode === "recovery") return "正しいプロジェクトJSONをImportするか、保存済みデータを置き換えてよい場合だけResetしてください。";
  if (mode === "unsupported") return "アプリを新しいバージョンへ更新するか、互換形式のプロジェクトJSONをImportしてください。";
  if (mode === "unavailable") return "ブラウザのストレージ許可と空き容量を確認してください。";
  return null;
}

export function DiagnosticsPanel({
  browserCapabilities,
  backend,
  projectStorageMode,
  historyStorageMode,
  preferenceStorageMode,
  audioError,
  onRetry,
  onClose,
}: DiagnosticsPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        first?.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  const capabilityList = browserCapabilities
    ? Object.values(browserCapabilities.capabilities)
    : [];
  const storageModes = [
    ["現在のプロジェクト", projectStorageMode],
    ["Undo履歴", historyStorageMode],
    ["好み学習", preferenceStorageMode],
  ] as const;
  const backendNeedsAction = backend.connection !== "connected";
  const apiNeedsAction = backend.apiCompatibility === "incompatible";

  return (
    <div className="diagnostics-backdrop">
      <div
        ref={dialogRef}
        className="diagnostics-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="diagnostics-heading">
          <div>
            <p className="eyebrow">DEVELOPER DIAGNOSTICS</p>
            <h2 id={titleId}>環境診断</h2>
            <p id={descriptionId}>利用可能な機能と、安全なフォールバックを確認できます。</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="環境診断を閉じる">
            閉じる
          </button>
        </header>

        <div
          className="diagnostics-content"
          aria-label="診断詳細"
          aria-live="polite"
          tabIndex={0}
        >
          <section aria-labelledby={`${titleId}-network`}>
            <h3 id={`${titleId}-network`}>接続</h3>
            <dl className="diagnostic-summary-list">
              <div>
                <dt>ネットワーク</dt>
                <dd>{browserCapabilities ? networkLabel(browserCapabilities.networkStatus) : "確認中"}</dd>
              </div>
              <div>
                <dt>ローカル推論サーバー</dt>
                <dd><StatusBadge status={backend.connection} label={BACKEND_STATUS_LABELS[backend.connection]} /></dd>
              </div>
              <div>
                <dt>推論モード</dt>
                <dd>{backend.inferenceBackend || "ブラウザ / 理論ベース"}</dd>
              </div>
              <div>
                <dt>デバイス</dt>
                <dd>{backend.device ?? "未検出"}</dd>
              </div>
              <div>
                <dt>API互換性</dt>
                <dd><StatusBadge status={backend.apiCompatibility} label={API_STATUS_LABELS[backend.apiCompatibility]} /></dd>
              </div>
              <div>
                <dt>Frontend Node.js</dt>
                <dd>{BUILD_NODE_VERSION}（build時、24.14.x契約）</dd>
              </div>
              <div>
                <dt>Server Python</dt>
                <dd>{backend.pythonVersion ?? (backend.connection === "connected" ? "未報告" : "サーバー未接続")}</dd>
              </div>
              <div>
                <dt>Server app</dt>
                <dd>{backend.serverVersion ?? (backend.connection === "connected" ? "未報告" : "サーバー未接続")}</dd>
              </div>
              <div>
                <dt>Server OS / CPU</dt>
                <dd>
                  {backend.platformSystem && backend.platformMachine
                    ? `${backend.platformSystem} / ${backend.platformMachine}`
                    : backend.connection === "connected" ? "未報告" : "サーバー未接続"}
                </dd>
              </div>
            </dl>
            {browserCapabilities?.networkStatus === "offline" && (
              <p className="diagnostic-remedy"><strong>対処:</strong> オフラインでも生成・再生・編集・保存を続けられます。外部接続機能のみ無効になります。</p>
            )}
            {backendNeedsAction && (
              <p className="diagnostic-remedy"><strong>対処:</strong> ブラウザ / 理論ベースで作業を継続できます。高速推論を使う場合はローカルサーバーを起動して再試行してください。</p>
            )}
            {apiNeedsAction && (
              <p className="diagnostic-remedy"><strong>対処:</strong> アプリと推論サーバーを同じリリースへ更新してください（期待 {backend.expectedApiVersion ?? "不明"} / サーバー {backend.serverApiVersion ?? "不明"}）。</p>
            )}
            {backend.error && (
              <div className="diagnostic-error" role="status">
                <strong>{backend.error.title}</strong>
                <p>{backend.error.message}</p>
                <p><strong>対処:</strong> {backend.error.remedy}</p>
                {backend.error.diagnosticCode && <small>診断コード: {backend.error.diagnosticCode}</small>}
              </div>
            )}
          </section>

          <section aria-labelledby={`${titleId}-models`}>
            <h3 id={`${titleId}-models`}>モデル</h3>
            {backend.models.length === 0 ? (
              <div className="diagnostic-empty-state">
                <p>AIモデルは配置されていません。</p>
                <p>モデルなしでもブラウザ / 理論ベース生成を利用できます。</p>
              </div>
            ) : (
              <ul className="diagnostic-list">
                {backend.models.map((model) => (
                  <li key={model.id} className="diagnostic-row" data-status={model.status}>
                    <div className="diagnostic-row-heading">
                      <strong>{model.name}</strong>
                      <StatusBadge status={model.status} label={MODEL_STATUS_LABELS[model.status]} />
                    </div>
                    {model.detail && <p>{model.detail}</p>}
                    {model.status !== "ready" && <p className="diagnostic-remedy"><strong>対処:</strong> モデル設定を確認するか、モデル不要の推論モードを使用してください。</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby={`${titleId}-storage`}>
            <h3 id={`${titleId}-storage`}>保存</h3>
            <dl className="diagnostic-summary-list">
              {storageModes.map(([label, mode]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{STORAGE_LABELS[mode]}</dd>
                </div>
              ))}
            </dl>
            {[...new Set(storageModes
              .map(([, mode]) => storageRemedy(mode))
              .filter((remedy): remedy is string => remedy !== null))]
              .map((remedy) => (
                <p className="diagnostic-remedy" key={remedy}>
                  <strong>対処:</strong> {remedy}
                </p>
              ))}
          </section>

          {audioError && (
            <section aria-labelledby={`${titleId}-audio-error`} className="diagnostic-error">
              <h3 id={`${titleId}-audio-error`}>{audioError.title}</h3>
              <p>{audioError.message}</p>
              <p>プロジェクトデータとAI処理には影響しません。</p>
              <p><strong>対処:</strong> {audioError.remedy}</p>
              {audioError.diagnosticCode && <small>診断コード: {audioError.diagnosticCode}</small>}
            </section>
          )}

          <section aria-labelledby={`${titleId}-browser`}>
            <h3 id={`${titleId}-browser`}>ブラウザ機能</h3>
            {!browserCapabilities ? (
              <p>ブラウザ機能を確認しています。</p>
            ) : (
              <>
                <p>確認時刻: {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(browserCapabilities.checkedAt))}</p>
                <ul className="diagnostic-list">
                  {capabilityList.map((capability) => <CapabilityRow key={capability.id} capability={capability} />)}
                </ul>
              </>
            )}
          </section>
        </div>

        <footer className="diagnostics-actions">
          <button type="button" onClick={onRetry}>診断を再実行</button>
          <button type="button" onClick={onClose}>完了</button>
        </footer>
      </div>
    </div>
  );
}
