# 互換性マトリクス

この表は「機能を実装した」ことと「実機で確認した」ことを分けて記録します。未確認の組み合わせを完成扱いにしません。Firefoxは今回のrelease-gating対象外です。

| 環境 | 基本生成・編集・保存 | 推論経路 | 検証方法 | 状態 |
|---|---|---|---|---|
| macOS + Chromium | Browser / local CPU | CPU、対応機ではMPS / Core ML | unit、API integration、ローカルE2E | ローカル検証済み |
| macOS + Safari | Browser | Browser、対応機ではlocal server | WebKit E2E + Safari実機チェック | 実機確認が必要 |
| Windows 11 + Chrome + CPU | Browser / local CPU | CPU / DirectML optional | Windows CI + Chromium E2E | CI検証対象 |
| Windows 11 + Chrome + CUDA | Browser / local CUDA | ONNX CUDA / PyTorch CUDA | self-hosted CUDA integration | CUDA実機確認が必要 |
| Linux + Chromium + CPU | Browser / local CPU | CPU | Linux CI + Chromium E2E | CI検証対象 |
| GPUなし | 全基本機能 | CPU → Browser → Theory | unit / integration | 自動検証対象 |
| サーバー停止 | 全ブラウザ機能 | Browser → Theory | API遮断E2E | 自動検証対象 |
| オフライン | 生成・再生・編集・保存 | local / Browser / Theory | offline E2E | 自動検証対象 |

Chromium / WebKit E2Eでは、初回導線、生成、再生・一時停止、部分再生成、候補採用、Undo、サーバー停止、オフライン、API不一致、390px幅、Escでのモーダル終了に加え、axe-coreでWCAG 2.2 AA相当の重大違反を検査します。別のLAN E2Eでは実FastAPIとVite proxyを起動し、390px Chromiumで `#access` の除去、セッション認証、Generate、Play、保護されたrank APIを検査します。ピアノロールの精密ノート矩形はtarget-size自動判定から除外し、キーボード選択とInspectorによる等価編集経路を別途検査します。

## フォールバックの期待値

| 失敗 | 正式な曲データ | 継続できる操作 | 表示 |
|---|---|---|---|
| CUDA初期化 / OOM | 変更しない | 再生、編集、CPU推論 | batch縮小またはCPUへの切替理由 |
| ローカルAPI停止 / timeout | 変更しない | 生成、再生、編集、保存 | Browser fallbackと再試行 |
| API version不一致 | 変更しない | Browser機能 | 期待版と更新案内 |
| モデルなし | 変更しない | Linear / Browser / Theory | モデルなしの空状態 |
| IndexedDB不可 | 変更しない | localStorage保存 | 保存方式とJSON退避案内 |
| localStorage不可 / 容量不足 | 画面内に保持 | セッション内作業、JSON出力 | Save failed / Session only |
| AudioContext開始失敗 | 変更しない | 編集、生成、保存 | 音声だけのエラーと再試行 |
| 不正 / 巨大JSON | 変更しない | 現在のプロジェクトを継続 | 安全な拒否理由 |

## リリース前の実機チェック

- Windows 11 + NVIDIA GPUで `setup-acceleration.ps1 cuda` の実推論を通す。
- Windows 11 + GPUなしでCPUおよびBrowser fallbackを通す。
- macOS Safariで初回生成、Play、部分再生成、JSON保存を確認する。
- macOS / Windowsの同一LANスマートフォンから、起動ログの認証URLで接続する。
- 低性能CPU設定で候補生成中も再生・Cancel・手動編集が応答することを確認する。

確認結果にはOS、ブラウザ、GPU名、ドライバー、Python、選択backend、コミットSHAを記録してください。

必須証跡と未検証時の扱いは [リリース検証チェックリスト](release-checklist.md) に従います。
