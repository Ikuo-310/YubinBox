# YubinBox

YubinBoxは、Gmail Webから独自ドメインのメールアドレスを使って外部SMTP経由で送信するための、個人用SMTP送信ゲートウェイとブラウザ拡張です。

Gmail Webの外部SMTPを利用した「Send mail as」機能終了への対応を背景とするプロジェクト構想です。この背景は企画上の前提であり、本リポジトリではGoogleの提供状況や終了時期を検証していません。

受信メールは既存のメール転送サービスからGmailへ転送します。閲覧・検索・受信管理は引き続きGmail Webを使い、YubinBoxは主に**送信部分だけ**を補完します。個人用途を主目的とし、汎用メールホスティングや大規模配信サービスは目指しません。

## 現在の状態

開発初期段階です。現時点ではディレクトリ構成と設計ドキュメントのみで、動作するGateway、拡張、Dockerイメージ、管理UIはありません。言語・フレームワーク・データベースも未選定です。

最初の対象ブラウザは**Firefox**です。Gmail連携には**InboxSDKを第一候補として検討**していますが、Firefoxでの動作や取得できる情報は未検証です。採用は小さなPoCの結果を見て判断します。

## コンポーネント

| 構成 | 役割 |
| --- | --- |
| [Gateway](gateway/README.md) | Dockerで常時稼働し、HTTPS APIで送信を受け付け、認証・Identity検証・Archive BCC追加・SMTP配送を担当する。LAN内専用の管理WebUIを持つ予定。 |
| [Browser Extension](extension/README.md) | Gmailの作成・返信画面と連携し、送信内容とIdentityをGatewayへ渡す。Gateway URLとAPI Tokenは拡張の設定で指定する。 |

SMTP接続先・認証情報を表す**SMTP Profile**と、Fromアドレス・利用Profile・Archive BCCを表す**Sending Identity**を分離します。初期接続先はSMTP2GOを想定しますが、SMTPサービスに依存せず、会社指定SMTPなどへ変更・追加できる設計を目指します。

SMTP認証情報はGatewayだけが保持し、拡張へ渡しません。Gmail APIへの全面依存を前提にしません。

## 公開と設定の方針

- Cloudflare Tunnelなどで必要な送信サービスAPIのみを公開し、外部APIはBearer Token認証を必須とします。
- `/admin`は外部公開せず、管理UIは原則RFC1918のプライベートIPv4からのみ許可します。
- 端末ごとにAPI Tokenを発行・失効できるようにし、Gatewayにはトークン原文ではなく検証用ハッシュを保存します。
- SMTP設定・認証情報・Identity・Archive BCC・Tokenの管理は、原則として管理UIで行います。Gatewayの設定・秘密情報は永続ボリュームに保存します。
- 秘密情報・実メール・実送信ログはGitへ保存しません。`.gitignore`は補助であり、追加前に差分を確認します。

拡張では設定されたベースURL（例：`https://yubin.example.com`）と固定APIパス（想定：`/api/send`）を組み合わせます。ホスト名をハードコードしません。

## リポジトリ構成

```text
YubinBox/
├─ gateway/README.md
├─ extension/README.md
├─ docs/
│  ├─ architecture.md
│  └─ development-plan.md
├─ .gitignore
├─ LICENSE
├─ README.md
└─ CHANGELOG.md
```

実装用ディレクトリや依存関係は、技術選定と必要性が確定した時点で追加します。

## 次の開発ステップ

最初に[Firefox＋InboxSDKのPoC](docs/development-plan.md#最初のissue候補firefoxinboxsdkでgmail連携を検証する)を実施し、Compose／Replyの検出、本文・宛先取得、返信に必要な元メール情報の取得範囲を確認します。このPoCではSMTP送信を実装しません。

設計の詳細は[アーキテクチャ](docs/architecture.md)、未決定事項と以降の順序は[開発方針](docs/development-plan.md)、変更履歴は[CHANGELOG](CHANGELOG.md)を参照してください。

## ライセンス

YubinBoxの独自コードおよびドキュメントは、**GNU Affero General Public License v3.0 only（SPDX: `AGPL-3.0-only`）**で提供します。「v3.0以降」ではなく、バージョン3.0のみを指定します。標準のライセンス全文は[LICENSE](LICENSE)を参照してください。

InboxSDKなどの第三者依存には、それぞれのライセンスが適用されます。導入・再配布時は対象バージョンのライセンスを確認し、必要な著作権表示、ライセンス全文、NOTICEなどをソースと配布物に保持します。第三者の表示をYubinBoxのライセンスで上書きしません。現在、第三者依存はまだ導入していません。
