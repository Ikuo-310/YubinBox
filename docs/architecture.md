# アーキテクチャ

この文書は初期設計方針です。APIスキーマやデータベース定義を確定するものではありません。

## 拡張側の送信判断（2026-09-15）

Firefox＋InboxSDK 2.2.24でNew／Reply／ForwardとReply routingを実機確認済みです。isForward=trueを優先し、falseかつisReply=trueならreply、それ以外はnewです。Reply Allはreplyと同じ扱いです。Gmail ComposeのTo/Cc/Bcc・Subject・本文text/HTMLをそのまま使い、件名・宛先を再構築しません。

Reply sourceは三点メニューのfresh pending（単一MessageView一致、5秒TTL、consume-once、source=message-menu）を優先します。なければ同一ThreadViewの最後のMessageViewを採用しsource=thread-bottom-replyとします。New／Forwardでは探索せず、newの保存後のThread IDも返信元とは扱いません。

sourceのvisible recipient emailsを優先し、getRecipientsFull()は補助です。取得済み宛先と登録YubinBox Identityが1件一致ならそのIdentity・transport=yubinboxでauto。0件一致ならsendingIdentity=null・transport=gmail・auto・reason=no-yubinbox-identity-matchでGmail nativeへfallbackします。宛先取得不能・複数一致だけmanual-requiredです。アドレス末尾によるtransport推測や未登録Identityの生成はしません。登録定義のtransportを使い、GmailアドレスをYubinBox Identityとして管理する必要はありません。

自動決定Replyは送信元確認表示を必須・通常変更不可とします。Gmail nativeの確認表示用addressはnullでtransport=gmailを保持します。New／Forwardはユーザーが送信Identityを選択する予定です。確認・選択UIは未実装で、共通送信データと表示用状態まで保持します。

PoCではconfig.local.jsonのidentitiesにid/address/transportを登録します。将来はGatewayをIdentity管理元とし、拡張はGateway APIから一覧を取得します。Gateway URL／Tokenは拡張設定画面で変更可能にし、本番の設定変更に再ビルドを要求しません。

共通送信データはmode・sendingIdentity・transport・identityResolution・確認表示情報、Compose内容、Gmail内部ID・sourceMessageです。gmailはGmail標準送信、yubinboxはGateway送信へ接続する区分ですが、現PoCは送信しません。RFC reply headersの取得・生成は未対応で、内部Message IDをRFC Message-IDやSMTP In-Reply-Toへ転用しません。

## 全体像と責務

```text
受信: 外部の送信者 → 既存メール転送サービス → Gmail Web

送信: Gmail Web + Firefox拡張 → transport=gmailならGmail標準送信（将来）
                  │ transport=yubinbox: HTTPS / Bearer Token（将来）
                  ▼
        外部公開経路（Cloudflare Tunnelなど）
                  │ 必要なAPIのみ
                  ▼
             YubinBox Gateway → SMTP ProfileのSMTP → 宛先
                  │                              └→ IdentityのArchive BCC
                  └→ 永続ボリューム（設定・秘密情報など）

管理: LAN内ブラウザ → 管理専用経路 → Gateway /admin
```

GatewayはGmailに依存しない送信サービス、拡張はGmailとの接続部分を担います。受信・検索・メールボックス同期は担当しません。Gmail APIへの全面依存は前提にせず、必要性が生じた場合に用途と権限を別途判断します。

## 設定モデル

| 概念 | 想定する情報 | 責務 |
| --- | --- | --- |
| SMTP Profile | 識別子、表示名、SMTPホスト・ポート、TLS方式、認証情報 | SMTP接続と認証。特定プロバイダーのAPIを前提にしない。 |
| Sending Identity | 識別子、Fromアドレス、表示名、SMTP Profile参照、Archive BCC設定 | 許可された差出人と配送設定の対応。 |
| API Token | 識別子、端末を区別する名称、検証用ハッシュ、失効状態 | クライアント認証と個別失効。原文は保存しない。 |

複数のIdentityが同じSMTP Profileを参照できます。ProfileとIdentityは別々に管理し、SMTP接続先を変更しても差出人の概念を維持します。

| From | SMTP Profile | Archive BCCの例 |
| --- | --- | --- |
| `contact@example.com` | SMTP2GO用Profile | 仕事用Gmail |
| `me@example.com` | 同じSMTP2GO用Profile | 個人用Gmail |
| `work@company.example` | Company SMTP用Profile | 未設定 |

これらは架空の例です。Archive BCCはIdentityごとの設定であり、Gateway全体で単一の固定宛先にはしません。未設定時は追加しない想定です。1 Identityあたり複数宛先を許可するかは未決定です。

## 送信フローとAPI境界

以下は将来のYubinBox送信フローです。Gmail native routingはGatewayへ送信しません。

1. 拡張が設定済みベースURLへBearer Token付きで問い合わせ、送信用Identity情報を取得する。
2. 利用者がIdentityと送信内容を確認し、YubinBox送信を選択する。
3. 拡張が想定パス`/api/send`へIdentityと宛先・件名・本文・取得できた返信情報を送る。
4. GatewayがTokenの有効性を確認し、登録Identityと許可Fromを検証する。
5. GatewayがIdentityに紐づくProfileとArchive BCCをサーバー側で解決し、SMTPへ配送する。
6. Gatewayが処理結果を返し、必要最小限の送信ログを残す。

Identity取得APIのパス、HTTPメソッド、具体的なリクエスト・レスポンス、エラー形式はPoC後に定義します。Identity取得を含む外部APIすべてに認証を要求します。取得APIは送信に必要な情報だけを返し、SMTP認証情報やToken管理情報を含めません。

クライアント指定のFromを無条件に信用せず、Gateway側の登録Identityを許可元とします。Fromをリクエストに含めるか、Identityから生成するかはAPI契約で決めます。ヘッダー注入対策など入力検証はGatewayの責務です。

SMTPによる受付と最終配送は区別します。タイムアウト後の再送は重複送信を生む可能性があるため、結果の意味・再送方針・冪等性は実送信実装前に決めます。キュー導入は現段階では決定しません。

## 返信とArchive BCC

返信ではRFCの`Message-ID`・`References`・`In-Reply-To`に利用できる情報が必要です。Gmail／InboxSDKのメッセージIDやスレッドIDをRFC Message-IDと同一視しません。公開APIからこれらのRFCヘッダーを取得できないことは確認済みで、別途取得・生成方法を決めます。Gmail／Thunderbird等のthreadingは実SMTP送信時の未検証事項です。

Archive BCCはGatewayがIdentity設定から追加するSMTP配送先です。BCC宛先がTo／Ccや配信メッセージのBCCヘッダーとして漏れないように構成します。送信者が入力する通常BCCへの対応は別途検討します。

Archive BCCによるGmailへの配送は、Gmailの「送信済み」への保存やスレッド統合を保証しません。表示先・スレッドの挙動は後続の実メール検証で確認します。

## 公開面と管理面

外部には必要な送信サービスAPIのみを公開し、`/admin`、関連管理API、管理用リソースは公開経路から除外します。管理UIを隠すだけでなく、管理操作へのサーバー側アクセス制御も必要です。

初期の管理アクセス許可元は次のRFC1918 IPv4範囲です。

- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`

上記以外は既定で拒否する方針です。IPv6やループバックを暗黙に許可せず、開発環境で必要な扱いは別途決めます。Tailscale対応は将来候補で、現時点の許可範囲に含めません。

DockerやTunnel経由では、外部利用者もプライベートIPのプロキシから来たように見える場合があります。接続元のプライベートIPだけで管理アクセスを許可してはいけません。公開経路での管理ルート遮断と、Gateway側での管理専用経路・アクセス制御を組み合わせます。任意の`X-Forwarded-For`などを信用せず、信頼するプロキシと実クライアントIPの判定方法を実装前に決めます。

管理UIの認証、CSRF対策、リスナー／ポート分離、TLS終端位置は未決定です。LAN制限のみで管理画面の安全性が完成したとは扱いません。

## 秘密情報と永続化

- 設定・SMTP認証情報・Identity・Archive BCC・Token検証用ハッシュは、原則管理UIで登録し、Gatewayの永続ボリュームで保持する。
- SMTP認証情報は接続時に利用できる形で保持する必要がある。Tokenのハッシュ保存とは区別し、暗号化方式・鍵管理・アクセス権・バックアップは技術選定時に決める。
- Tokenは端末ごとに発行し個別に失効可能とする。原文は発行時のみ提示する想定とし、Gatewayの永続ストレージやログへ残さない。生成・ハッシュ方式は未選定。
- 拡張にはGateway URLと利用端末のTokenを保持する。SMTP認証情報は保持しない。
- 本文、認証ヘッダー、SMTPパスワード、Token原文を送信ログに記録しない。ログ項目・宛先情報の扱い・保持期間は未決定。
- Gitには実データや秘密情報を含めず、将来追加する設定例にも架空値のみを使う。

## 将来の拡張点

Gateway内の簡易メール作成画面は、拡張と同じ送信サービスを利用できるようにします。その画面の公開範囲や認証は未決定です。現時点では画面実装、他ブラウザ対応、Tailscale対応、多機能なメール管理は追加しません。
