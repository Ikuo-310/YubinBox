# 開発方針と次の工程

## 完了したPoC

2026-09-15時点でFirefox＋InboxSDK 2.2.24の実機PoCは成立しています。最初のIssue候補だった「Firefox＋InboxSDKでGmail連携を検証する」は、取得範囲と制約を明らかにする技術検証として次工程へ進める状態です。RFCヘッダーが公開APIでは取得不能であることも検証成果です。

- 最小Firefox shimでSDKロード・Compose検出成功。
- New／Reply／Forwardのmode、To/Cc/Bcc・Subject・本文text/HTML・Gmail内部ID取得を実機確認。
- 三点メニューのfresh pendingと下部Replyの最後のMessageViewによるsource解決を確認。
- visible宛先から登録独自ドメイン→yubinbox、未登録Gmail→gmail nativeのauto routingを確認。
- Reply／Reply Allは区別しない。Forward優先、New／Forwardは返信元探索なし。
- 現在63テスト成功。実モジュールを通すReply source→recipient→sending-dataの統合テスト、New／Forward回帰あり。

InboxSDKを次工程の基盤として進めます。全環境での互換性や実送信まで完了したとは扱いません。[検証結果](inboxsdk-poc-results.md)に現在の結果と当時の履歴を分けて記録しています。

## 決定済みの送信判断

Replyはvisible recipient emails優先、fullは補助です。登録Identity単一一致はauto、取得済みで0件一致はGmail nativeへauto fallback、取得不能・複数一致だけmanual-requiredです。Gmailアドレス登録や未登録Identityの生成、ドメイン末尾推測は不要です。自動決定時は送信元確認表示を必須・通常変更不可とし、New／Forwardはユーザー選択予定です。Gmail Composeが作った内容をそのまま使います。

PoCのIdentityはconfig.local.jsonに登録します。将来はGatewayを管理元としAPIから取得、Gateway URL／Tokenは拡張設定画面で変更可能にします。設定変更のたびに再ビルドする本番設計にはしません。

## PoC後の小さな開発順序

以下は次工程候補で、まだ実装していません。

1. **送信APIの最小契約**：Identity一覧と送信要求、本文形式・サイズ、認証・エラー、SMTP受付と配送の違い、重複送信を整理する。RFC返信ヘッダー未対応を明示する。
2. **Gateway最小実装**：言語・永続化を選び、Bearer認証・From検証・単一Identity／Profileの汎用SMTP配送から始める。SMTP2GO専用にしない。
3. **拡張設定・確認UI**：Gateway URL／Token、APIからのIdentity取得、Replyのread-only確認、New／Forwardの選択、manual-required時のfallbackを設計する。
4. **隔離環境で送信検証**：RFC返信ヘッダーの取得・生成方針を決め、Gmail／Thunderbird等のthreading、Archive BCC、Token失効、エラー・再送を確認する。
5. **常用の管理・運用**：管理UI、永続ボリューム、Docker、ログ、公開／LAN管理境界を実装・検証する。

今回の作業はドキュメント同期のみです。Gateway・SMTP・UIを先行実装しません。必要な依存だけを追加し、Provider frameworkや複雑なDIは先に導入しません。

## 未決定・未実装事項

- Gatewayの言語・フレームワーク・データベース、永続化・秘密情報暗号化・鍵管理・バックアップ。
- APIスキーマ、Identity取得パス、バージョニング、サイズ制限、添付ファイル・通常BCCの配送契約。
- RFC Message-ID／References／In-Reply-Toの取得・生成方法、SMTP threadingとArchive BCC実送信検証。
- Token生成・ハッシュ方式、拡張内保存、失効・権限範囲、通信権限とCORS。
- SMTP TLS・タイムアウト・再送・冪等性、同期／非同期送信。
- 管理UI認証・初期セットアップ・CSRF、プロキシ信頼・ポート分離・TLS終端、ログ項目・保持期間。
- 完成版UI、他ブラウザ、Tailscale、Gateway内簡易作成画面の具体仕様。

返信Identity routingそのもの、Gmail fallback、New／Forward modeは未決定事項から除外します。Gmail内部Message IDをRFC Message-IDとして使うことはしません。

## 開発・記録方針

PoCはInboxSDKを固定依存とし、Node標準機能でビルド・テストします。実メール・個人情報・秘密情報をコミットせず、検証結果は匿名化します。依存追加時は名称・版・入手元・ライセンスを確認し、第三者の著作権表示・ライセンス全文・必要なNOTICEをソースと配布物に保持します。
