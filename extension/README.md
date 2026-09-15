# YubinBox Browser Extension — InboxSDK PoC

Firefox＋InboxSDK 2.2.24の読み取り専用PoCです。最小Firefox shimでロード成功し、Compose内容・mode・Reply source・Identity routingを実機確認済みです。Gateway、SMTP送信、管理UI、完成版拡張UI、URL／Token設定UI、添付ファイル処理は未実装です。

## 共通送信データとIdentity

New／Reply／Forwardを実機確認済みです。isForward=trueを優先、falseかつisReply=trueならreply、それ以外new。Reply Allはreplyと区別しません。Gmail ComposeのTo/Cc/Bcc・Subject・本文text/HTMLをそのまま利用します。New／Forwardは返信元探索なし・Identityはmanual選択予定です。UIは未実装です。

Reply sourceは三点メニューのfresh pending（単一一致・5秒TTL・consume-once）を優先し、source=message-menu。なければ同一ThreadViewの最後のMessageViewを使い、source=thread-bottom-replyとします。Thread不明・複数・ID取得不能ならsource取得失敗として扱います。newの保存後のThread IDは返信元ではありません。

source MessageViewのvisible recipient emailsを優先し、getRecipientsFull()は補助です。登録Identityに1件一致ならその定義のtransportでauto。取得済みで0件一致ならsendingIdentity=null・transport=gmail・auto・reason=no-yubinbox-identity-matchです。宛先取得不能／複数一致だけmanual-required。未登録アドレスからIdentityを生成せず、ドメイン末尾からtransportを推測しません。

Replyのauto時は確認表示必須・read-only・selectionAllowed=falseです。Gmail nativeではaddress=nullのままtransport=gmailを表示用に保持します。New／Forwardは選択結果を表示する予定です。独自ドメイン宛→yubinbox、Gmail未登録宛→gmailのauto routingはFirefox実機確認済みです。

現PoCのconfig.local.jsonのidentitiesにはYubinBox Identityを登録します。Gmailアドレスは登録不要です。例は架空値です。

```json
"identities": [
  { "id": "contact", "address": "contact@example.invalid", "transport": "yubinbox" }
]
```

将来はGatewayをIdentity管理元にしてAPIから一覧を取得します。Gateway URL／API Tokenは拡張設定画面で変更可能にし、本番では設定変更のたびに再ビルドしません。現在はGatewayも設定UIも未実装です。

[sending-data]とUI接続用状態には以下を保持します。

```text
mode, sendingIdentity: {id,address,transport} | null, transport,
identityResolution, identityReason, registeredIdentityCount,
sourceRecipientEmails, matchedIdentity, recipientSource,
identityConfirmation: {required,readOnly,selectionAllowed,address,transport},
to, cc, bcc, subject, bodyText, bodyHtml, gmailThreadId, gmailDraftId,
sourceMessage: {gmailMessageId,source}, fieldStatus
```

content-script内APIはYubinBoxComposeState.get(compose連番)とselectIdentity(compose連番, 登録id)です。前者はコピー取得、後者は非同期再取得。不明idやauto Replyの変更は拒否します。MAIN worldには公開しません。現在はdiagnosticOutput=false時に取得・詳細ログ・状態生成を行いません。

gmailは将来のGmail標準送信、yubinboxはGateway送信へ接続する区分で、PoCは送信しません。内部Message IDはRFC Message-IDではなく、RFC reply headersの取得・生成は未対応です。

## 事前準備

1. Node.js 22以上とnpm、Firefox 128以上を用意します。128は注入に使うMAIN execution worldの対応下限で、InboxSDKの動作保証ではありません。実際に使ったFirefoxのバージョンを記録してください。
2. [InboxSDK App ID管理ページ](https://register.inboxsdk.com/)でGoogleアカウントにサインインし、アプリを登録してApp IDを発行します。PoCでも自分の登録済みIDを使います。OAuthクライアントやGmail API Tokenの取得は不要です。
3. 他のInboxSDK利用拡張の影響を避けられるFirefoxの検証用プロファイルと、検証用Gmailアカウントを用意します。返信確認には既存のテストメールを使います。

[公式Getting Started](https://inboxsdk.github.io/inboxsdk-docs/)は旧リモート読み込み方式を含み、npm版は[公式サンプル](https://github.com/InboxSDK/hello-world)へ案内しています。本PoCはnpm版を同梱し、リモートJavaScriptをダウンロードして実行しません。App ID登録・SDK利用条件は公式サイトで確認してください。

## ビルドとFirefoxへの読み込み

リポジトリルートからPowerShellで実行します。

```powershell
cd extension
npm ci --ignore-scripts
Copy-Item config.example.json config.local.json
```

`config.local.json`の`appId`を、発行された登録済みApp IDに変更して保存します。App IDはSMTP認証情報やBearer Tokenではありませんが、個人の登録情報としてこのファイルと`dist/`をGit除外しています。

Composeの値を確認するときだけ、同じ設定ファイルに **`"diagnosticOutput": true`** を設定します。既定値・未設定はfalseで、文字列`"true"`では有効になりません。無効時はCompose連番とイベント名だけを記録し、PoCによる本文・宛先・関連メールの取得と出力を行いません。有効時は実際の値がconsoleに出るため、検証用メールだけを開いてください。設定変更後は再ビルドと再読み込みが必要です。

```powershell
npm test
npm run build
```

1. Firefoxで`about:debugging#/runtime/this-firefox`を開きます。
2. 「一時的なアドオンを読み込む」で、生成された**`extension/dist/manifest.json`**を選びます。ソース側の`extension/manifest.json`ではありません。
3. 拡張のGmailサイトアクセスを許可します。権限を変更したらGmailを再読み込みします。
4. GmailタブでF12 → Consoleを開き、「情報」「ログ」を表示して`YubinBox PoC`で絞り込みます。
5. Gmailを再読み込みし、`content script started`、`SDK loaded`、`Ready`が表示されるか確認します。

一時アドオンはFirefox終了時に削除されます。変更時は再ビルド → `about:debugging`の拡張「再読み込み」→ Gmail再読み込みが必要です。出力はGmailタブのconsoleで確認し、注入失敗は拡張「調査」のconsoleでも確認します。

## 検証操作と出力

- 新規作成すると、`compose-1`などの識別子と初回値をconsoleへまとめて表示します。この識別子はタブ内PoC連番で、Gmail IDでもRFC Message-IDでもありません。
- `detected`で初回取得し、`recipientsChanged`、`subjectChanged`、`bodyChanged`、`draftSaved`（既存の`responseTypeChanged`も対象）で再取得します。同種類の連続イベントだけを500msまとめ、異なる種類は別々に記録します。宛先はEnterなどで確定させます。`reason`はイベント名、`revision`は取得回数です。
- 各イベントの`[related]`には、Gmail内部Draft IDと、Reply時には同じスレッドのメール候補・送信者・宛先を表示します。New／Forwardの候補探索はskipします。非同期取得の結果は`compose`・`revision`・`reason`で元のスナップショットと照合します。取得中の変更は`changedDuringLookup`で確認できます。
- 通常返信と全員に返信を別々に操作し、画面で選んだ操作を人間が結果文書へ記録します。元メールの折りたたみ／展開後は件名や本文を編集して再取得し、比較してください。
- 複数Composeで内容と連番の対応を確認し、閉じたComposeの`destroyed`表示とログ停止を確認します。ポップアウトでSDKが別ComposeViewを作った場合は連番も変わります。

上記の値の出力には`diagnosticOutput: true`が必要です。既存のAlt＋Shift＋Yは実機で反応しなかったと報告されています。今回は変更しておらず、検証手順では使用しません。

フィールドには`api`、`status`、取得時の`value`を記録します。`ok`は呼び出しが値を返した意味であり、完全性や意味の確認まで済んだという意味ではありません。`empty`（null／undefined）、`api-unavailable`、`error`、`timeout`、`not-collected`を区別します。PoC側は例外文を転記しません。非同期APIは4秒で待機を打ち切りますが、SDK内部の処理をキャンセルするものではありません。

詳細出力は`[YubinBox PoC][snapshot]`または`[YubinBox PoC][related]`とJSONを同じconsole.logの文字列に含めます。グループを展開する必要はなく、prefixで絞り込んでもJSONを確認・コピーできます。SDKオブジェクトを直接JSON化せず、宛先は`name`・`emailAddress`、他の値は想定したプリミティブ型だけをコピーします。未取得値はnullや空配列とstatusで示します。App ID・Token・認証設定はコピーしません。

`snapshot`は`compose`・`revision`・`reason`・`capturedAt`、`mode`、`to`・`cc`・`subject`・`bodyText`・`bodyHTML`、`gmailInternalIds.threadId`、未取得の`rfcHeaders`を含みます。各取得フィールドは`{api, status, value}`です。`related`は同じ識別情報と`gmailInternalDraftId`、`relatedMessages`（status・threadLookups・viewErrors・candidates）を含み、候補には内部Message ID、loaded、sender、visibleRecipientEmails、recipientsFullを記録します。候補は正確な返信対象と確定していません。

本文・宛先・内部IDが含まれるため検証用データを使い、ログやスクリーンショットをそのままコミットしないでください。PoC自身はログをファイル保存・外部送信しません。**Gmail自身の通常の下書き自動保存や標準送信はそのまま動作します。**

## 判定上の制約と診断

三点メニューの「その他のメッセージ オプション」BUTTONをSDK MessageView.getElement()の包含で照合し、単一候補をpendingとして保持します。下部ボタンの属性分類診断も残っていますが、最終sourceはfresh pendingなしのreplyで同一ThreadViewの最後を採用します。ForwardではisReply=trueでも相関を成立させません。

DOM helperは診断PoCであり、本文・件名・宛先DOMや任意data属性値を解析しません。未分類クリックは最初の30件だけtagName／role／aria-label／titleと最大8要素の親方向を観測し、資格情報を示す値等は伏せます。診断はdiagnosticOutput=true限定です。

- [dom-helper] loaded／listener-installed：評価とlistener登録。
- [dom-click]：クリックの分類結果と限定属性。30件目のlastSample=true後はGmail再読み込みで再開。
- [dom-action]：クリックとSDK要素の包含候補。
- [dom-pending-target]／[dom-compose-correlation]：pendingとComposeの相関。下部fallbackの最終sourceは[sending-data]で確認。
- [snapshot]／[related]／[sending-data]：Compose値・候補・routing結果。prefixとJSONは同じログ。

公開APIのCompose→MessageView直接対応やRFCヘッダーgetterはないため、exactReplyTarget／rfcHeadersのunsupported診断は残ります。これは実用PoC上のsource解決とは別です。MessageView.isLoaded()で返信対象を判定せず、DOM IDとSDK IDも同一視しません。元メールのTo／Cc別情報は保証せず、relatedのfull宛先timeoutはIdentity単一一致の成功を否定しません。

Firefox shimはcontent script側のwindow.chrome未定義時に実chrome.runtime参照だけを補い、MAIN worldへExtension APIを公開しません。[compat]／[sdk-state]／[sdk-load]／[background]／[inject]の診断を維持しています。eventTrackingとglobalErrorLoggingはfalseですが、SDKの全通信停止を保証する設定ではありません。

実SMTPのthreading、Archive BCC、詳細なポップアウト・別環境の網羅検証は未完了です。現在63テスト成功で、実機で成立した基本フローと未解決事項は[検証結果](../docs/inboxsdk-poc-results.md)に分けて記録しています。

## 構成と権限

| ファイル | 役割 |
| --- | --- |
| `manifest.json` | Firefox MV3、Gmail限定ホスト権限、`scripting`権限。 |
| `src/background.js` | SDKの要求元GmailフレームのMAIN worldへ同梱`pageWorld.js`を注入。 |
| `src/content.js` | SDK読み込み、明示設定によるComposeイベント別スナップショット・関連候補取得。 |
| `src/probe.js` | 読み取り、失敗・タイムアウト処理、関連候補の取得。 |
| `scripts/build.mjs` | Node標準機能だけで必要ファイルを`dist/`へコピー。 |
| `test/` | Node標準テスト。架空データで制御処理とビルドを検証。 |
| `third-party/`、`THIRD_PARTY_NOTICES.md` | 原文の著作権・ライセンス表示。 |

直接依存は`@inboxsdk/core@2.2.24`のみで、間接依存も`package-lock.json`で固定します。配布済みUMDバンドルとpage-worldスクリプトを使うためバンドラーは不要です。

`storage`、`tabs`、`webRequest`、`<all_urls>`は要求しません。FirefoxではService Workerではなく`background.scripts`を使います。`scripting`はSDKのMAIN world注入に使います。外部ページから拡張リソースを読む方式を使わないため`web_accessible_resources`も追加していません。ソースマップのDevTools上での読み込み可否は実測事項です。

結果表と出典は[検証結果](../docs/inboxsdk-poc-results.md)、全体方針は[開発計画](../docs/development-plan.md)を参照してください。
