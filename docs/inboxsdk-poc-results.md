# Firefox＋InboxSDK PoC 検証結果

## 現在の結論

2026-09-15時点で、Firefox実機のInboxSDK／Reply routing PoCは成立しています。以下の実機結果は利用者の報告に基づきます。InboxSDKを使って次工程へ進める状態ですが、実送信の完成や全Firefox環境での動作保証を意味しません。

- `@inboxsdk/core@2.2.24`は最小Firefox shimでロード成功。Compose検出とNew／Reply／Forwardのmodeを実機確認済み。
- 三点メニューReplyのsourceはfresh pending、下部Replyは同一ThreadViewの最後のMessageViewで取得できる。
- 登録独自ドメイン宛ReplyはYubinBoxへauto routing。未登録Gmail宛ReplyはGmail nativeへauto fallbackする。
- GmailアドレスはYubinBox Identityとして登録不要。未登録アドレスからIdentityオブジェクトは生成しない。
- ReplyとReply Allは区別せず、Gmail Composeが作った宛先・件名・本文を利用する。
- Gmail内部Message IDはRFC Message-IDではない。公開APIからRFC Message-ID／References／In-Reply-Toは取得できず、取得・生成は未解決。

## 実機確認済み事項

| 項目 | 現在の結果 | 使用API・手段／制約 |
| --- | --- | --- |
| FirefoxでのSDKロード | 確認済み | `InboxSDK.load(2, appId, options)`、isolated world内の最小runtime shim。 |
| Compose検出 | 確認済み | `Compose.registerComposeViewHandler`。 |
| New／Reply／Forward mode | 確認済み | `isForward()`優先。trueならforward、falseかつ`isReply()`がtrueならreply、それ以外new。 |
| Reply識別 | 確認済み | Reply Allもreply。人数から専用modeを推定しない。 |
| To／Cc／Bcc | 取得確認済み | `getToRecipients()`／`getCcRecipients()`／`getBccRecipients()`。 |
| Subject | 取得確認済み | `getSubject()`。Re:やFwd:を追加しない。 |
| Body text／HTML | 取得確認済み | `getTextContent()`／`getHTMLContent()`。Gmailの内容をそのまま保持。 |
| 変更イベント・スナップショット | 確認済み | 宛先・件名・本文・下書き保存イベントからJSON出力。全書式・全操作の網羅確認ではない。 |
| Gmail内部Thread ID／Draft ID | 取得確認済み | `getThreadID()`／`getCurrentDraftID()`。new開始時は空で、保存後に付く場合がある。 |
| 元メール・スレッド関連 | 確認済み | `getThreadIDAsync()`／`getMessageViewsAll()`／`getMessageIDAsync()`。 |
| 元メールSender | 取得確認済み | `getSender()`。 |
| 元メール宛先 | visible取得確認済み | `getRecipientEmailAddresses()`。fullはtimeout実績あり、必須にしない。 |
| 三点メニューReply source | 確認済み | 単一MessageView包含、fresh pending、5秒TTL、consume-once。 |
| 下部Reply source | 確認済み | fresh pendingなしのreplyで同一ThreadViewの最後を採用。 |
| Reply Identity routing | 確認済み | 登録独自ドメイン→yubinbox、未登録Gmail→gmail native、いずれもauto。 |
| RFC Message-ID／References／In-Reply-To | 公開APIでは取得不可 | core 2.2.24の公開getterなし。取得・生成・実送信検証は未対応。 |

実機routingの確認結果（個人アドレスは再掲せず、ケースで記録）：

| ケース | sendingIdentity／matchedIdentity | transport | identityResolution／identityReason | 確認表示用状態 |
| --- | --- | --- | --- | --- |
| 登録独自ドメイン宛Reply | 登録Identity | yubinbox | auto／single-registered-recipient-match | required=true、readOnly=true、selectionAllowed=false |
| Gmail宛Reply・Gmail Identity未登録 | null | gmail | auto／no-yubinbox-identity-match | required=true、readOnly=true、selectionAllowed=false、address=null |

現在63テスト成功。Reply source決定→recipient取得→sending-data生成を、実PoCモジュールを組み合わせて通すテストがあります。三点メニュー／下部Replyそれぞれの登録あり・未登録fallback、取得失敗・複数一致、New／Forward回帰を検証済みです。今回のドキュメント同期ではテストを再実行していません。

## 現在のReply routing仕様

1. Forwardを先に除外する。New／Forwardは返信元探索をせず、Identityはユーザー選択予定（manual）。newに保存後のThread IDが付いても返信元と解釈しない。
2. Replyはfresh pending targetを優先する。三点メニューで単一MessageViewに包含されるクリックを採取し、source=`message-menu`、5秒TTL、次Composeで一度だけ消費する。
3. fresh pendingがなければ、ComposeのThread IDと一致する単一ThreadViewの最後のMessageViewを使い、source=`thread-bottom-reply`とする。Thread不明・複数・ID取得失敗時はsourceを推測しない。
4. 決定した同じMessageViewからvisible recipient emailsを取得し、登録Identityと照合する。getRecipientsFull()は補助であり、visibleの単一一致をtimeoutで失敗扱いにしない。
5. 登録YubinBox Identityに1件一致なら、そのIdentityと定義済みtransportでauto（通常yubinbox）。取得済み宛先に0件一致ならsendingIdentity=null・transport=gmail・auto・reason=no-yubinbox-identity-match。宛先取得不能（空リスト含む）または複数一致ならmanual-required。

自動決定時は送信元確認表示を必須・read-onlyとし、通常の選択を増やしません。Gmail nativeではIdentityを生成せずaddress=nullです。ドメイン末尾からtransportを推測しません。ComposeのTo/Cc/Bcc/Subject/bodyText/bodyHtmlを再構築しません。

現在はPoC専用のconfig.local.jsonのidentitiesへYubinBox Identityを登録します。Gmailアドレスの登録は不要です。将来の管理元はGatewayで、拡張はAPIから一覧を取得する想定です。Gateway URL／API Tokenは将来の拡張設定画面で変更可能にし、本番で設定変更のたびに再ビルドする設計にはしません。

## 現在の制約

- Gateway、SMTP送信、管理UI、完成版拡張UI、Gateway URL／Token設定UIは未実装。New／Forwardの選択UI、Reply確認表示UIも未実装で、表示用状態まで保持する。
- RFCヘッダー取得・生成、Gmail／Thunderbird等での実SMTP threading、Archive BCC実送信は未検証。
- 公開APIのCompose→特定MessageView直接対応は提供されない。現在のsourceはDOM起点とGmail UIの意味によるPoC上の解決であり、公開APIのexactReplyTarget診断のunsupportedとは区別する。
- 元メールのvisible宛先は省略される場合がある。getRecipientsFull()は統合宛先で元To／Cc別情報を保証せず、timeout実績がある。
- DOM helperは限定診断PoC。本文・件名・宛先DOM、任意data属性値を解析しない。GmailのUI変更やポップアウトなどの詳細条件は継続確認が必要。
- 詳細ログと送信状態生成はdiagnosticOutput=true時のみ。App ID・Token・SMTP認証情報やSDKオブジェクトは出力しない。実メールログはコミットしない。
- Firefoxの実行バージョン等の詳細環境は未記録。別環境の網羅検証や添付ファイル対応は完了していない。

## 過去の検証履歴

以下は当時の結果です。現在仕様は上記に集約し、旧結論は置き換え済みです。

| 段階 | 当時の結果・対応 | 現在の扱い |
| --- | --- | --- |
| 初期SDK PoC | Firefox未確認、InboxSDKを第一候補として検討。 | 最小shimでロード・Compose取得を実機確認し、次工程へ進める。 |
| SDKロード調査 | pending／window.chrome.runtimeのTypeErrorを調査。 | isolated worldの実runtime参照を補うshimで成功。注入方式・バージョンは維持。 |
| ショートカット・Console | Alt+Shift+Yが反応せず、groupの見出しだけ見える問題を調査。 | 自動イベント取得とprefix＋JSONの単一ログへ変更。ショートカットは修正対象外のまま。 |
| 公開API調査 | Exact Reply Target・RFC headers・Reply All専用判定を調査。 | RFC未対応は残る。Reply Allを区別せず、sourceは限定DOM／ThreadViewで解決。 |
| DOM起点調査 | 下部ボタンの単一包含ではsourceを得られず、最後のMessageView方式は未対応だった。 | 三点メニューpending優先、下部は最後のMessageView fallbackを実装・実機確認済み。 |
| Identity初期判定 | full取得を必須とし、timeoutで判定不能になった。 | visible優先へ変更。fullは補助。 |
| 受け渡し調査 | relatedは宛先ありだがsending-dataが空。登録0件時にvisibleを不採用とする経路を確認。 | 宛先と登録一致を区別し、統合テストを追加。 |
| Gmail routing簡素化前 | 未登録はmanual-required、autoには登録必須としていた。 | 未登録の取得済み宛先はGmail nativeへauto。Gmail Identity登録不要。両transportの実機成功を確認。 |

当時のパッケージ調査ではAPI version 2、gitHead `ec7ea453503a081061a573e97ad0cd32d415f864`を照合しました。getInitialMessageID()はドラフトの初期IDで返信元ではありません。hasOpenReply()はAPI version 2で廃止、内部driverのgetTargetMessageID()やRFC ID helperは公開APIでないため採用していません。第三者著作権・ライセンス原文とSDK配布バンドルを保持しています。

## 今後の確認事項

PoCの初回ロード確認には戻らず、送信API契約、Gateway最小実装、拡張設定UIを次工程候補とします。現在のrouting仕様を基に、認証・Identity一覧・本文形式・エラー／重複送信の扱いを設計します。

RFCヘッダー取得・生成の方法を別途決め、実SMTP送信でGmail／Thunderbird等のthreadingとArchive BCCを検証します。送信元確認UI、New／Forward選択UI、URL／Token設定UI、管理経路も未実装として計画します。手順は[開発計画](development-plan.md)、PoCの再現方法は[拡張README](../extension/README.md)を参照してください。

## 確認した一次資料

- [InboxSDK公式リポジトリ](https://github.com/InboxSDK/InboxSDK)と[npmパッケージ](https://www.npmjs.com/package/@inboxsdk/core)：導入・配布・ライセンス。
- [Getting Started](https://inboxsdk.github.io/inboxsdk-docs/)と[App ID登録](https://register.inboxsdk.com/)：npm版への案内と登録。
- [公式サンプルmanifest](https://github.com/InboxSDK/hello-world/blob/main/static/manifest.json)と[ビルド設定](https://github.com/InboxSDK/hello-world/blob/main/webpack.common.js)：注入と必要ファイル。サンプルはChrome向け。
- [Compose API](https://inboxsdk.github.io/inboxsdk-docs/compose/)と[Conversations API](https://inboxsdk.github.io/inboxsdk-docs/conversations/)：公開APIの意味。配布版の型定義・ソースマップ内実装と照合。
- [配布版のinject-script.ts](https://github.com/InboxSDK/InboxSDK/blob/ec7ea453503a081061a573e97ad0cd32d415f864/src/platform-implementation-js/lib/inject-script.ts)：backgroundへの注入要求。
- [Mozilla：Firefox 128のMV3更新](https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/)と[ExecutionWorld](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/ExecutionWorld)：MAIN world対応。
- [Mozilla：content_scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts)：Gmail限定content script。
