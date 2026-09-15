# Changelog

プロジェクトの主要な変更を記録します。現時点でリリースはありません。

## [Unreleased]

### Added

- Replyの取得済み宛先が登録Identityに一致しない場合、Identityを生成せずGmail nativeへauto fallback。確認表示はread-only、New／Forwardは従来どおり。

- ReplyのIdentity判定をvisible recipient emails優先へ修正。full宛先取得は補助に限定。fresh pendingがないReplyは同一ThreadViewの最後のMessageViewをsourceに採用し、New／Forwardは従来どおり探索しない。

- new/reply/forward共通送信データ、Bcc、登録Identityとtransport、送信元確認表示用状態を追加。Replyは元メール統合宛先の単一一致で自動決定し、不明時のみ手動fallback。New／Forwardは手動選択。Forwardの誤Reply相関を修正し、新規Composeの返信元探索をskip。

- 下部Replyボタン候補のSDK MessageView包含判定を既存pending診断へ追加。source=bottom-replyと一致件数・保存結果を出力し、5秒TTL・使い捨て・未確定扱いを維持。

- 三点メニュー起点の単一MessageView候補と新規Reply Composeの時間的相関診断。TTLはクリックから5秒、使い捨て。exactReplyTargetには反映しない。

- DOM helper評価・listener登録の段階ログと、最初の30クリックに限定した未分類クリック診断を追加。未知ラベルの原文は出さず、既存selector・操作分類は維持。

- Exact Reply Target調査用の限定DOM helper。明示診断設定時だけ返信操作ラベルのclickとSDK MessageView要素の包含関係を記録。本番判定には使わず、DOM属性の任意値やメール本文は取得・出力しない。

- 返信元情報PoC：Exact Reply Target、RFCヘッダー、Reply All直接識別、元To／Cc区分の公開API上の制約を理由付きJSONへ記録。統合宛先に基づく受信Identity候補を追加し、選択は行わない。複数候補・Forward診断のテストと実機手順を追加。

- Compose診断を`[snapshot]`／`[related]`とJSONの単一ログに変更。SDK取得値から許可したフィールドだけを明示的にコピーし、Consoleフィルターによる本文の非表示を回避。

- Composeの検出・変更イベントから基本情報と同一スレッド候補を自動取得。メール内容を含む診断はローカル設定`diagnosticOutput: true`でのみ有効化し、既定では無効。イベント種類ごとに500ms集約し、関連情報をCompose連番・revision・reasonで照合。

- Firefox MV3向けInboxSDK PoC。Compose別console出力、編集後の再取得、手動での同一スレッド候補・宛先取得。
- `@inboxsdk/core@2.2.24`の固定依存とロックファイル、Node標準機能によるビルド・7件の自動テスト。
- App ID設定とFirefox一時読み込みの手順、実機未確認の結果表。
- InboxSDKの著作権表示とMIT／Apacheライセンス原文を追加し、配布バンドル内の表示とともに保持。

- Gateway・Browser Extension・docsの初期モノレポ構成。
- プロジェクト概要、責務分離、SMTP ProfileとSending Identityの設計方針。
- 外部APIとLAN内管理UIの公開境界、Token・秘密情報の管理方針。
- Firefox＋InboxSDKの技術検証を最初のIssue候補として文書化。
- ローカル設定、秘密情報、永続データ、生成物を対象とする`.gitignore`。
- GNU AGPL v3の標準`LICENSE`全文と、`AGPL-3.0-only`の適用指定、第三者の著作権・ライセンス表示を保持する方針。

初期整備では機能実装・依存導入を行わず、その後、読み取り専用の拡張PoCを追加しました。Gateway・送信機能は未実装で、Firefox／Gmailでの実測と本実装の技術スタック選定は未完了です。
