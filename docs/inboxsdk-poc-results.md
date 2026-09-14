# Firefox＋InboxSDK PoC 検証結果

## 現在の結論

**利用者のFirefox実機報告では、SDK初期化・Compose検出・変更イベントまで成功しています。** 今回追加したイベント別自動スナップショットの値・関連候補は実機で未確認で、InboxSDK採用判断は保留です。APIの存在、イベント発生、実際の値の取得成功を区別します。Alt＋Shift＋Yは反応しなかったとの報告があり、今回は修正・調査せず自動取得で検証します。

調査日：2026-09-14。対象：`@inboxsdk/core@2.2.24`、API version：`2`。npmの`gitHead`：`ec7ea453503a081061a573e97ad0cd32d415f864`。Firefox 128以上を想定していますが、実行バージョンは未記録です。

## 実機の結果表

結果は「取得可能／条件付き／取得不可／未確認」で記入します。使用API欄は実装した呼び出しであり、成功実績ではありません。

| 項目 | 結果 | 使用API・手段 | 備考 |
| --- | --- | --- | --- |
| FirefoxでのSDK読み込み | 取得可能（利用者報告） | `InboxSDK.load(2, appId, options)` | Firefox shim適用後に初期化成功。環境全般の互換性保証ではない。 |
| Compose検出 | 取得可能（利用者報告） | `Compose.registerComposeViewHandler` | 再作成・複数Composeの詳細条件は未確認。 |
| Reply識別 | 未確認 | `isReply()`、`isInlineReplyForm()`、`isForward()` | 新規・返信・転送を区別。 |
| Reply Allとの差 | 未確認 | `getToRecipients()`、`getCcRecipients()`の比較 | 専用判定APIは未発見。操作は人間が記録。 |
| To | 未確認 | `getToRecipients()` | 表示名・複数宛先・確定前後。 |
| Cc | 未確認 | `getCcRecipients()` | Ccなし・追加・削除。 |
| Subject | 未確認 | `getSubject()` | イベントごとの取得値を比較。 |
| Body | 未確認 | `getTextContent()`、`getHTMLContent()` | 引用・署名・書式も比較。 |
| 編集後の値 | 未確認 | `recipientsChanged`、`bodyChanged`、`subjectChanged`、`responseTypeChanged`、`draftSaved` | 変更イベント発生は利用者報告あり。値は未確認。同種類ごとに500msデバウンス。 |
| 元メール・スレッド関連 | 未確認 | Composeの`getThreadID()`、ThreadViewの`getThreadIDAsync()`／`getMessageViewsAll()`、MessageViewの`getMessageIDAsync()` | 同じスレッドの候補のみ。正確な返信対象は未確定。 |
| 元メールの宛先 | 未確認 | MessageViewの`isLoaded()`、`getRecipientEmailAddresses()`、`getRecipientsFull()` | 宛先統合リスト。元To／Cc区分・転送前宛先は保証しない。 |
| 現在のDraft関連ID | 未確認 | `getCurrentDraftID()` | Gmail内部ID。空の下書きではnull等の可能性。 |
| RFC Message-ID | 未確認 | 公開getterは未発見。`not-collected`を出力 | Gmail内部Message IDを転用しない。 |
| References | 未確認 | 公開getterは未発見。`not-collected`を出力 | 参照列を推測で組み立てない。 |
| In-Reply-To | 未確認 | 公開getterは未発見。`not-collected`を出力 | 正確な返信対象のRFC Message-ID取得も未解決。 |

## コード・パッケージから確認したこと

- npm版は`inboxsdk.js`、`pageWorld.js`、`background.js`、型定義、ソースマップを配布する。SDKのUMDバンドルを同梱するため、本PoCにバンドラーは不要。
- SDK loaderは`inboxsdk__injectPageWorld`メッセージをbackgroundへ送る。配布版はMV2注入フォールバックが除去されている。PoCはFirefoxのbackground scriptで受け、MAIN worldへの注入完了／失敗を返す。
- 表のCompose／ThreadView／MessageView APIは配布版の型定義・実装と照合した。Reply All専用判定、正確な返信元を返すCompose getter、RFCヘッダーgetterは今回の公開API調査では見つからなかった。
- `getRecipientsFull()`は非同期。未ロードのメールはスキップし、失敗・タイムアウトを他の項目と分ける。
- SDKの既定ではイベント追跡・グローバルエラーログが有効。PoCは両オプションをfalseにするが、SDK内部の明示的なエラー報告を含む全通信を止めるものではない。
- npmアーカイブには独立したLICENSE／COPYRIGHTファイルがなかったため、同じ`gitHead`の公式リポジトリから原文を追加した。SDKバンドルとマップも改変せずコピーする。

## ローカルで実施した検証

Windows、Node.js `v24.19.0`で`extension/`の`npm test`を実行し、20テストが成功しました。

利用者報告では詳細出力を有効にしたイベント見出しは表示されましたが、展開しても本文が見えませんでした。従来はprefix付きグループとprefixなしJSONを別ログにしていたため、Consoleの文字列フィルターでJSONが除外され得ます。今回はprefixとJSONを同一ログに変更しました。実機での原因確定・修正後の表示確認は未実施です。明示フィールドへの変換、null／undefined、循環参照やtoJSONを持つ取得値、余分な資格情報フィールドの除外をローカルテストで確認しました。

- 一部getterの例外でも他項目を取得し、編集後に再読み取りする。
- 宛先数からReply Allと判定せず、内部IDをRFCヘッダーへ入れない。
- 未提供API・空値・拒否・タイムアウトを区別する。
- 無関係なスレッドや未ロードのメールを返信元として読まない。
- backgroundがGmailの要求元フレームに限定して注入し、失敗を返す。
- 複数Composeを別々に記録し、手動取得と破棄後の後片付けを行い、送信フックを登録しない。
- `detected`と対象の4変更イベントで基本情報・関連候補を取得し、Compose連番・revision・reasonで対応付ける。異なるイベントが互いの待機出力を取り消さない。
- `diagnosticOutput`がbooleanのtrueの場合だけ取得・出力する。falseや文字列ではメールgetterを呼ばず、ビルドも明示設定だけを有効にする。
- 一時ディレクトリの架空設定でビルドし、設定なしでは失敗する。生成JSの構文、SDKとライセンス原文のバイト一致を確認する。

ビルドテストのApp IDは構文検証用の架空値で、SDKを起動していません。登録済みApp IDでのビルド・実機検証の代わりにはなりません。

## 人間による再現手順

準備と読み込みは[extension/README.md](../extension/README.md)に従います。

1. Firefoxバージョン、OS、Gmail言語、個人／Workspace、会話表示設定、他のGmail拡張の有無、日時を記録する。メールアドレス・App IDは記載不要。
2. consoleでSDK読み込み完了を確認する。失敗／30秒待機の場合はロード段階の結果として記録し、Compose項目を成功扱いしない。
3. ローカル設定の`diagnosticOutput`をtrueにして再ビルド・拡張とGmailを再読み込みする。新規Composeに架空To／Cc・件名・本文を入力し、`detected`と各変更イベントの出力を比較する。`draftSaved`も待って確認する。Cc追加・削除、HTML／プレーンテキスト、署名・引用文も確認する。関連情報は同じCompose連番・revision・reasonの追加グループを見る。
4. Composeを2つ開いて異なる内容を入力し、連番と値の対応を確認する。1つを閉じ、残ったComposeだけが記録されるか確認する。
5. ToとCcを含む既存の検証用メールを展開し、返信と全員に返信を別々に操作する。画面で選んだ操作を記録し、`isReply`と宛先、スレッド候補を比較する。宛先人数から返信モードを判断しない。
6. 同じスレッドの古いメールへの返信も試し、候補一覧が返信対象を一意に示すかを照合する。折りたたみ／展開、ポップアウト、返信件名編集も比較する。
7. 独自ドメイン宛から転送されたテストメールで元アドレスが宛先に残るか確認する。表示されない場合、Identity判定可能とはしない。
8. 元メールの「メッセージのソースを表示」でRFCヘッダーを人間が確認し、Gmail内部IDとは別物であることを照合する。References／In-Reply-Toが元メールにないケースと、返信チェーンに含まれるケースを区別する。元メールのIn-Reply-Toは新しい返信に設定する値と同一とは限らない。生メールのダウンロード・コミットは不要。
9. 結果表に状況・API・条件を記入する。手動でRFCヘッダーが見えても、PoCが自動取得できたとは記録しない。SDK自身の通信・エラーや権限についても観察する。

実メール送信は不要です。Gmailの下書きは通常どおり保存されるため、不要な下書きは検証後に利用者が削除してください。

### 記録用テンプレート

```text
日時 / OS / Firefox:
SDKパッケージ / consoleのloader・implementationバージョン:
Gmail言語 / 個人・Workspace / 会話表示 / 他の拡張:
ケース: 新規 / Reply / Reply All / 古いメールへの返信 / 複数Compose
PoC compose連番・revision:
画面で行った操作:
一致した項目 / 一致しなかった項目:
未取得項目のstatus / 追加条件:
匿名化した所見（本文・宛先・内部ID・App IDは貼らない）:
```

## 次の判断

登録済みApp IDでSDK読み込みと新規Composeの宛先・件名・本文を1件確認し、その後に返信・全員に返信・元メール情報を確認します。ロード自体が失敗した場合はFirefox互換性の切り分けが最優先です。

返信用RFCヘッダーと正確な返信元は未解決です。採用判断・送信API契約を確定せず、実測後に必要最小限の追加検証を別Issue候補として整理します。

## 確認した一次資料

- [InboxSDK公式リポジトリ](https://github.com/InboxSDK/InboxSDK)と[npmパッケージ](https://www.npmjs.com/package/@inboxsdk/core)：導入・配布・ライセンス。
- [Getting Started](https://inboxsdk.github.io/inboxsdk-docs/)と[App ID登録](https://register.inboxsdk.com/)：npm版への案内と登録。
- [公式サンプルmanifest](https://github.com/InboxSDK/hello-world/blob/main/static/manifest.json)と[ビルド設定](https://github.com/InboxSDK/hello-world/blob/main/webpack.common.js)：注入と必要ファイル。サンプルはChrome向け。
- [Compose API](https://inboxsdk.github.io/inboxsdk-docs/compose/)と[Conversations API](https://inboxsdk.github.io/inboxsdk-docs/conversations/)：公開APIの意味。配布版の型定義・ソースマップ内実装と照合。
- [配布版のinject-script.ts](https://github.com/InboxSDK/InboxSDK/blob/ec7ea453503a081061a573e97ad0cd32d415f864/src/platform-implementation-js/lib/inject-script.ts)：backgroundへの注入要求。
- [Mozilla：Firefox 128のMV3更新](https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/)と[ExecutionWorld](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/ExecutionWorld)：MAIN world対応。
- [Mozilla：content_scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts)：Gmail限定content script。
