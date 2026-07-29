# 互換性マトリクス

この表は「機能を実装した」ことと「実機で確認した」ことを分けて記録します。未確認の組み合わせを完成扱いにしません。Firefoxは今回のrelease-gating対象外です。

| 環境 | 基本生成・編集・保存 | 推論経路 | 検証方法 | 状態 |
|---|---|---|---|---|
| macOS + Chromium | Browser / local CPU | HarmonyForge MPS / CPU、Core ML ranker | unit、API integration、ローカルE2E | UIはローカル検証済み。HarmonyForge MPS実機確認が必要 |
| macOS + Safari | Browser | Browser、対応機ではlocal server | WebKit E2E + Safari実機チェック | 実機確認が必要 |
| Windows 11 + Chrome + CPU | Browser / local CPU | HarmonyForge CPU、DirectML ranker | Windows CI + Chromium E2E | 基本機能はCI対象。HarmonyForgeはCPUのみ |
| Windows 11 + Chrome + CUDA | Browser / local CUDA | HarmonyForge PyTorch CUDA、ONNX CUDA ranker | self-hosted CUDA integration | CUDA実機確認が必要 |
| Linux + Chromium + CPU | Browser / local CPU | HarmonyForge CPU、ONNX CPU ranker | Linux CI + neural CPU lane | checkpointなしの契約を自動検証 |
| GPUなし | 全基本機能 | HarmonyForge CPU → Corpus → Browser → Theory | unit / integration | fallback契約は自動検証対象 |
| サーバー停止 | 全ブラウザ機能 | Browser → Theory | API遮断E2E | 自動検証対象 |
| オフライン | 生成・再生・編集・保存 | local / Browser / Theory | offline E2E | 自動検証対象 |

Chromium / WebKit E2Eでは、初回導線、生成、再生・一時停止、部分再生成、候補採用、Undo、サーバー停止、オフライン、API不一致、390px幅、Escでのモーダル終了に加え、axe-coreでWCAG 2.2 AA相当の重大違反を検査します。別のLAN E2Eでは実FastAPIとVite proxyを起動し、390px Chromiumで `#access` の除去、セッション認証、Generate、Play、保護されたrank APIを検査します。ピアノロールの精密ノート矩形はtarget-size自動判定から除外し、キーボード選択とInspectorによる等価編集経路を別途検査します。

HarmonyForgeは同じcheckpointをCUDA、MPS、CPUで使います。DirectMLはv0.4の
HarmonyForge deviceではなく、既存ONNX ranker用です。自動CIのneural CPU laneは
PyTorch / SafeTensorsのimport、モデル構築、checkpoint拒否、API、cancel、
preview安全契約を検査しますが、学習品質やGPU/MPSでの数値同等性を証明しません。
標準backend laneは意図的にPyTorchを導入せず、従来機能がtorch-freeのまま
動くことを保証します。

## フォールバックの期待値

| 失敗 | 正式な曲データ | 継続できる操作 | 表示 |
|---|---|---|---|
| CUDA / MPS初期化、実tensor probe、OOM | 変更しない | 再生、編集、許可時はCPU推論 | acceleratorとCPUへの切替理由 |
| HarmonyForge checkpointなし / 拒否 | 変更しない | Corpus / Browser / Theory生成 | manifest/checksum/training状態の理由 |
| neural jobのCancel / timeout | 変更しない | 再生、編集、別backendでの再試行 | Cancelled、partial candidateなし |
| ローカルAPI停止 / timeout | 変更しない | 生成、再生、編集、保存 | Browser fallbackと再試行 |
| API version不一致 | 変更しない | Browser機能 | 期待版と更新案内 |
| 経験則モデルもなし | 変更しない | Linear / Browser / Theory | モデルなしの空状態 |
| IndexedDB不可 | 変更しない | localStorage保存 | 保存方式とJSON退避案内 |
| localStorage不可 / 容量不足 | 画面内に保持 | セッション内作業、JSON出力 | Save failed / Session only |
| AudioContext開始失敗 | 変更しない | 編集、生成、保存 | 音声だけのエラーと再試行 |
| 不正 / 巨大JSON | 変更しない | 現在のプロジェクトを継続 | 安全な拒否理由 |

## リリース前の実機チェック

- Windows 11 + NVIDIA GPUで `setup-acceleration.ps1 cuda` の実推論を通す。
- Windows 11 + GPUなしでHarmonyForge CPUおよびBrowser fallbackを通す。
- Apple Silicon実機でMPS tensor probe、候補生成、CPU fallback理由を確認する。
- Docker CPUでvalid checkpointをread-only mountした場合だけHarmonyForgeが
  availableになることを確認する。
- CUDA Compose overlayはNVIDIA Container Toolkit導入済みホストで確認する。
- macOS Safariで初回生成、Play、部分再生成、JSON保存を確認する。
- macOS / Windowsの同一LANスマートフォンから、起動ログの認証URLで接続する。
- 低性能CPU設定で候補生成中も再生・Cancel・手動編集が応答することを確認する。

確認結果にはOS、ブラウザ、GPU名、ドライバー、Python、選択backend、コミットSHAを記録してください。

必須証跡と未検証時の扱いは [リリース検証チェックリスト](release-checklist.md) に従います。
