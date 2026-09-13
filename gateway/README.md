# YubinBox Gateway

Dockerコンテナとして常時稼働する、独立したメール送信サービスです。現在は設計段階で、実装・起動手順・Dockerfileはありません。

## 担当する責務

- HTTPS送信APIとBearer Token認証。
- Sending Identityの取得、Fromホワイトリスト検証、Identityに紐づくSMTP Profile選択。
- IdentityごとのArchive BCC追加と、一般的なSMTPによる配送。
- LAN内専用管理UIによるSMTP Profile・Identity・Archive BCC設定。
- SMTP接続テスト、端末別API Token発行・失効、送信ログ。
- 永続ボリューム上の設定・秘密情報・Token検証用ハッシュの管理。

APIは拡張に固有の処理と分離し、将来Gateway内の簡易メール作成画面からも利用できる形を目指します。簡易作成画面は初期実装の対象外です。

## 守る境界

SMTP認証情報や管理用情報を送信クライアントへ返しません。クライアントから任意のSMTP設定や未登録Fromを指定して送信できる設計にはしません。初期のSMTP2GO接続も、汎用SMTP Profileの一設定として扱います。

公開APIと管理UIは別の公開ポリシーを持ちます。`/admin`はTunnelの公開対象から除外し、Gateway側でもアクセス制御を行います。プロキシ経由の送信元判定は実装前に設計・検証が必要です。

詳細は[architecture.md](../docs/architecture.md)、着手順序は[development-plan.md](../docs/development-plan.md)を参照してください。先に拡張PoCで必要情報を確認し、その結果から最小の送信API契約を決めます。
