# YubinBox Browser Extension — InboxSDK PoC

Firefox上のGmail Webで、InboxSDKの読み込み・Compose検出・送信に必要な情報の取得範囲を検証するPoCです。利用者の実機報告ではSDK初期化・Compose検出・変更イベントまで成功しています。今回追加した自動スナップショットの内容は実機で未確認です。完成版UI、SMTP送信、Gateway接続、API Token、添付ファイル処理、Gmail標準送信の置き換えは実装していません。

## 事前準備

### 共通送信データPoC（2026-09-15）

最新のReply Identity方針：取得できたsourceRecipientEmailsが登録Identityに1件一致なら登録定義でauto、0件一致ならGmail nativeへauto fallbackします。Gmailアドレスの登録は不要で、sendingIdentity=null・transport=gmail・identityReason=no-yubinbox-identity-matchです。アドレス末尾を判定せず、未登録の独自ドメイン宛も同じ扱いです。確認表示は必須・read-only・選択不可で、アドレスはnullのまま保持します。宛先取得不能（空リストを含む）と複数一致だけmanual-requiredです。New／Forwardは従来の手動選択を維持します。以下の未登録をmanual-requiredとする旧説明はこの方針で更新されます。

Reply修正の最新方針：Identity照合は`getRecipientEmailAddresses()`（visible recipient emails）を優先します。登録Identityに1件一致すればgetRecipientsFull()を待たずauto、確認表示必須・read-onlyになります。0件の場合だけgetRecipientsFull()を補助取得し、それでも不明ならmanual-required。visibleで複数一致する場合は補助リストで曖昧さを消さずmanual-requiredです。既存related診断のgetRecipientsFull() timeoutは残る場合がありますが、Identity判定の必須条件ではありません。

Reply sourceはfresh pendingを優先します。なければComposeのGmail Thread IDと一致する単一ThreadViewのgetMessageViewsAll()の最後を採用し、source=thread-bottom-replyとします。ID取得不能・ThreadView不明／複数の場合はmanual-requiredです。New／Forwardではこのfallbackを呼びません。三点メニューの単一一致・5秒TTL・consume-onceは維持します。以下の「最後のMessageView方式は未対応」という初回説明はこの修正で置き換えられます。

[sending-data]にはsourceRecipientEmails・recipientSource（visible-recipient-emails／recipients-full／unavailable）・matchedIdentityを追加しました。transportは引き続き登録Identity定義から決めます。再ビルド後、三点メニューと下部返信をGmail宛／独自ドメイン宛の両方で確認してください。

modeはisForward=trueを最優先してforward、isForward=falseかつisReply=trueならreply、それ以外はnewです。ReplyとReply Allは区別しません。Gmail ComposeのTo／Cc／Bcc・Subject・本文text/HTMLをそのまま使い、件名や宛先を再構築しません。newは保存後にThread IDが付いても返信元探索をskipします。ForwardはReply相関を成立させません。

ローカル`config.local.json`の`identities`に登録Identityを指定します。例は架空値です。既定は空リストで、idの重複や不正な定義はビルド時に拒否します。

```json
"identities": [
  { "id": "gmail-default", "address": "account@example.invalid", "transport": "gmail" },
  { "id": "contact", "address": "contact@example.invalid", "transport": "yubinbox" }
]
```

transportは登録定義から決め、アドレス末尾から推測しません。SMTP情報・Tokenは設定しません。Replyでは相関した元MessageViewのgetRecipientsFull()と登録アドレスを大文字小文字を区別せず照合し、1件一致ならauto。送信元確認表示を必須とし、通常変更不可です。元メール不明・複数一致・Bcc等で宛先が見えない・取得失敗時はmanual-requiredとして手動fallbackを許可します。New／Forwardはmanualで選択前提です。

diagnosticOutput=trueでは`[sending-data]`に以下を出し、UI接続用状態として保持します。

```text
mode, sendingIdentity: {id,address,transport} | null, transport,
identityResolution: manual | auto | manual-required, identityReason,
identityConfirmation: {required,readOnly,selectionAllowed,address,transport},
to, cc, bcc, subject, bodyText, bodyHtml, gmailThreadId, gmailDraftId,
sourceMessage: {gmailMessageId,source: message-menu | thread-bottom-reply | null},
fieldStatus
```

content-script内APIは`YubinBoxComposeState.get(compose連番)`（コピー取得）と`selectIdentity(compose連番, 登録id)`（非同期再取得）です。不明idやauto Replyの変更は拒否します。MAIN worldには公開しません。現段階ではdiagnosticOutput=falseのとき取得・詳細ログ・状態生成を行いません。UI自体は未実装です。

三点メニューの単一一致・5秒TTL・使い捨ては維持します。元MessageViewから宛先だけをコピーし、SDKオブジェクトをpayloadへ含めません。下部Replyは既存の単一包含候補を利用できますが、「スレッド末尾」と安全に識別できないため最後のMessageViewを選ぶ方式は未対応です。取得できなければ手動fallbackします。

gmail transportは将来Gmail標準送信、yubinbox transportは将来Gateway送信へ接続する区分です。今回はどちらも実送信しません。Gmail内部Message IDはRFC Message-IDではなく、RFC reply headersはpayloadへ含めません。既存のsnapshot／related等は維持し、new／forwardのrelatedはskip状態を出します。

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
- 各イベントの追加グループ`related information`には、Gmail内部Draft ID、同じスレッドのメール候補と送信者・宛先を表示します。非同期取得の結果は`compose`・`revision`・`reason`で元のスナップショットと照合します。取得中の変更は`changedDuringLookup`で確認できます。
- 通常返信と全員に返信を別々に操作し、画面で選んだ操作を人間が結果文書へ記録します。元メールの折りたたみ／展開後は件名や本文を編集して再取得し、比較してください。
- 複数Composeで内容と連番の対応を確認し、閉じたComposeの`destroyed`表示とログ停止を確認します。ポップアウトでSDKが別ComposeViewを作った場合は連番も変わります。

上記の値の出力には`diagnosticOutput: true`が必要です。既存のAlt＋Shift＋Yは実機で反応しなかったと報告されています。今回は変更しておらず、検証手順では使用しません。

フィールドには`api`、`status`、取得時の`value`を記録します。`ok`は呼び出しが値を返した意味であり、完全性や意味の確認まで済んだという意味ではありません。`empty`（null／undefined）、`api-unavailable`、`error`、`timeout`、`not-collected`を区別します。PoC側は例外文を転記しません。非同期APIは4秒で待機を打ち切りますが、SDK内部の処理をキャンセルするものではありません。

詳細出力は`[YubinBox PoC][snapshot]`または`[YubinBox PoC][related]`とJSONを同じconsole.logの文字列に含めます。グループを展開する必要はなく、prefixで絞り込んでもJSONを確認・コピーできます。SDKオブジェクトを直接JSON化せず、宛先は`name`・`emailAddress`、他の値は想定したプリミティブ型だけをコピーします。未取得値はnullや空配列とstatusで示します。App ID・Token・認証設定はコピーしません。

`snapshot`は`compose`・`revision`・`reason`・`capturedAt`、`mode`、`to`・`cc`・`subject`・`bodyText`・`bodyHTML`、`gmailInternalIds.threadId`、未取得の`rfcHeaders`を含みます。各取得フィールドは`{api, status, value}`です。`related`は同じ識別情報と`gmailInternalDraftId`、`relatedMessages`（status・threadLookups・viewErrors・candidates）を含み、候補には内部Message ID、loaded、sender、visibleRecipientEmails、recipientsFullを記録します。候補は正確な返信対象と確定していません。

本文・宛先・内部IDが含まれるため検証用データを使い、ログやスクリーンショットをそのままコミットしないでください。PoC自身はログをファイル保存・外部送信しません。**Gmail自身の通常の下書き自動保存や標準送信はそのまま動作します。**

## 判定上の制約

### 限定DOM操作診断（本番依存ではない）

下部Reply候補にもpending診断を追加しました。既存の最大8要素の親探索でaria-label／titleがReply／返信に完全一致した要素がBUTTONまたはrole=buttonの場合だけ対象です。画面下部という位置自体は判定しないため、あくまで下部ボタン候補です。文字列解析や未確認の属性・classは追加していません。ラベルなしや別表記の場合は既存dom-clickで未分類を確認してください。

包含一致の件数を`[dom-pending-target]`の`source: "bottom-reply"`・matchCount・storedで記録します。単一一致ならreasonは`bottom-reply-action-inside-single-message-view`、0件・複数件なら保存しません。SDKのID取得成功・5秒TTL・次Composeで使い捨て・isReply===trueという既存条件を共用します。Reply All／Forward／menuitemはこの保存経路に追加していません。三点メニューの検出・処理は従来どおりです。

実機では再ビルドと拡張・Gmail再読み込み後、テストthread末尾の下部返信をクリックし、上記sourceのmatchCountとstored、その後の`[dom-compose-correlation]`を確認してください。0件ならthread末尾から最後のMessageViewへ推定せず、その結果を記録します。単一一致の場合もExact Reply Targetはunsupportedのままです。

三点メニュー起点の相関PoC：aria-labelまたはtitleが「その他のメッセージ オプション」と完全一致するBUTTON（またはrole=button）について、SDK MessageView.getElement()との包含一致が1件だけならpending候補を保持します。SDK Message ID取得成功が必要で、クリック時刻からTTLは5秒です。0件・複数件の新しいメニュー操作は以前の候補を破棄します。

次の新規Compose検出時に候補を使い捨てで消費し、isReply()===trueかつ期限内の場合だけ`[dom-compose-correlation]`にcorrelated=trueを記録します。ID取得中でも待機できますが、期限延長や候補復活はしません。非Reply Composeでも破棄します。isReplyはReply Allとの区別を保証しないため、このログは操作種別や返信元の確定ではありません。既存exactReplyTarget.status=unsupportedは変更しません。

実機確認：再ビルド・拡張とGmailの再読み込み後、テストthreadの古い／最新メールの三点メニューを開き、`[dom-pending-target]`のmessage IDを確認してください。5秒以内にReplyを選び、`[dom-compose-correlation]`のcompose・pendingTarget・ageMsを照合します。次のComposeでは再利用されないこと、メニューを開いて5秒以上待つと相関しないことも確認してください。メニューを開いたこととCompose生成の時間的な関連候補にすぎず、同期間の別操作による誤相関は排除できません。本番送信には使いません。

一時的な実値観測として、未分類（action=unknown）の実ユーザークリックだけ、`[dom-click]`の`observedAttributes`へtagName・role・aria-label・titleを記録します。対象はクリック要素を含む親方向最大8要素で、既存の最初の30件枠内のみです。従来のtarget／ancestryの伏字出力も残します。設定済みApp ID、資格情報を示す文字列、メールアドレス形式は伏せます。本文・入力値・任意data属性値は読みません。分類規則は変更せず、Gmailラベルを実機観測するためだけのPoCです。

切り分け用に、診断有効時は評価時の`[dom-helper] loaded`、click listener登録後の`[dom-helper] listener-installed`を各1回出します。最初の30クリックは未分類も含め`[dom-click]`へtarget・親方向最大8階層・action・classificationReasonをJSON出力します。30件目はlastSample=trueで、追加サンプルにはGmail再読み込みが必要です。既存のdom-action診断はその後も続きます。

aria-label／titleは既知の操作ラベルだけを表示し、それ以外は`<redacted-unrecognized-label>`、属性なしはnullです。本文や入力値がラベルに混ざる場合も原文は出しません。selector・操作分類規則は変更していません。loadedなし→生成物・読み込み、listener-installedなし→helper開始処理、dom-clickなし→イベント到達、action=unknown→ラベル分類、action判定後dom-actionなし→照合・非同期処理の順に切り分けてください。

`diagnosticOutput: true`の場合だけ、`src/dom-action.js`がdocumentのclickをcapture・passiveで観測します。操作の取消・送信処理・Composeとの自動紐付けは行いません。最大8階層の親までの`aria-label`／`title`を英語・日本語のReply／Reply All／Forward（返信／全員に返信／転送）と完全一致で分類します。本文・textContent・HTML・宛先・件名のDOM解析は行いません。ラベルがない、別言語、ショートカット表記付き、名前付きなどの操作は観測対象外です。

`[YubinBox PoC][dom-action]`とJSONを同じログに出します。クリック要素・コントロール・親要素候補について、許可したtagName・role、操作ラベルの分類、id／class・限定data識別属性の有無だけを記録します。任意の属性値は個人情報混入防止のため出しません。難読化classに依存しません。

SDKの`MessageView.getElement()`がコントロールを含む場合だけ、SDK getterで取得したMessage ID・Thread IDをcandidateMatchesへ記録します。既存の`[related]`と同じSDK由来IDで照合してください。DOMの非公開IDとの一致比較はしません。単一候補はmedium、複数候補はlowで、Exact Reply Targetは常にunverifiedです。`isLoaded()`は判定に使いません。

実機では再ビルド→拡張とGmailを再読み込みし、同じ複数メールthreadの古いメール・最新メールそれぞれで、下部の返信／全員に返信／転送と右上メニューの同操作を試してください。メニュー項目もラベルがあれば観測しますが、MessageView外のメニューでは候補なしになります。メニューを開いた履歴から元MessageViewを推定する処理は追加していません。Enter／Spaceがclickを発生させる場合も対象ですが、キーボード操作全般の監視はしていません。SDKの候補と照合し、操作場所・candidateStatus・confidenceを匿名化して記録してください。実機動作は未検証です。

返信元検証では`exactReplyTarget`・`mode.replyVsReplyAll`・`rfcHeaders`に`api`／`status`／`value`／`attempted`／`reason`を出します。core 2.2.24の公開APIで取得手段がない項目は`unsupported`、`value: null`、`attempted: false`です。取得getterを呼べなかったことを明示し、内部IDをRFCヘッダーに使いません。

`[related]`の各候補には`originalTo`／`originalCc`の取得不能理由と、`receivingIdentityCandidates`を追加しています。Identity候補は`getRecipientsFull()`の統合宛先で、`selectedIdentity`はnullです。受信者全員を自分のIdentityとはみなしません。元メールのTo／Cc別情報や正確な返信対象は確定できません。

複数メールthreadの古いメール・最新メールからReply／Reply Allをそれぞれ開き、To／Ccと候補のSender・宛先を比較してください。Forwardも`mode.isForward`と同じ本文・宛先・thread ID構造で検証できます。API version 2で廃止された`hasOpenReply()`や内部driverの返信対象・RFC ID取得処理は使いません。根拠と実機確認手順は[検証結果](../docs/inboxsdk-poc-results.md)を参照してください。

Firefox互換性PoCとして、`InboxSDK.load()`直前にcontent script側の`window.chrome`が未定義の場合だけ、実際の`chrome.runtime`参照を補います。Firefoxかつ分離されたcontent script環境、`moz-extension://`の実APIであることを確認します。SDKのコールバック形式に合わせて`chrome.runtime`を利用し、`browser.runtime`だけの場合は代理実装せずスキップします。MAIN worldへの注入・API公開は行いません。

`[YubinBox PoC][compat][before]`／`[after]`はAPIの有無と`shimApplied`だけをbooleanで出します。テストはXrayの分離をモデル化したもので、実機での修正成功を示しません。適用後に既存の`[sdk-state]`、`[background]`、`[inject]`、`[sdk-load]`で注入要求・ロード完了まで進むか確認してください。

- `isReply()`は試しますが、Reply All専用の公開APIは確認できていません。宛先数からReply Allとは判定しません。
- 関連メールは観測したThreadViewとComposeのGmail Thread IDが一致する候補一覧です。最後のメールなどを勝手に「返信元」にしません。別ウィンドウ等でThreadViewが観測できない場合、候補は得られない可能性があります。
- 元メールの宛先APIは統合リストです。元To／Ccの区分や転送前のエンベロープ宛先を保証しません。未ロードのメールは取得をスキップします。
- RFC `Message-ID`、`References`、`In-Reply-To`の公開取得APIは確認できていないため、`unsupported`と理由、`attempted: false`を出します。内部IDからRFCヘッダーを生成しません。手動でのソース比較は[結果文書](../docs/inboxsdk-poc-results.md)を参照してください。
- SDKの`eventTracking`と`globalErrorLogging`は無効にしていますが、明示的なエラー報告などすべての通信を止める設定ではありません。SDKはGmail内部データ取得でも通信し得ます。SDKから外部通信が一切ないとは扱いません。

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
