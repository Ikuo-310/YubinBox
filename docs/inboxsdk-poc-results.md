# Firefox＋InboxSDK PoC 検証結果

## 現在の結論

### Reply未登録時のGmail native fallback

仕様簡素化により、sourceRecipientEmailsが取得できて登録一致0件ならGmail nativeへauto fallbackします。Identityオブジェクトを生成せずsendingIdentity=null、transport=gmail、reason=no-yubinbox-identity-match、確認表示必須・read-onlyとします。1件一致は登録定義に従い、取得不能／複数一致はmanual-requiredです。New／Forwardには変更なし。過去の「autoには必ずIdentity登録が必要」という結論はこの仕様変更で置き換えられます。

三点メニュー・下部Replyの実モジュール統合テストも新仕様へ更新しました。未登録Gmail／未登録独自ドメインでもIdentityを生成しない回帰テストを追加。実機は再ビルド後にsending-dataのtransport・identityReason・確認表示情報を確認してください。

### 最新ログによる原因確定と訂正

ローカル設定のidentities未設定、dist/config.jsの登録Identity数0、生成JSとソースの一致を確認しました。添付実機ログではrelatedのvisible宛先はok、fullはtimeoutでした。relatedはcandidates[].visibleRecipientEmailsを表示する独立経路です。sending-dataはcorrelation.sourceRecipientsから生成し、sendingDataのvisibleMatches.length>0という条件により、登録0件では保持済みvisible配列を採用せず、full timeoutから空配列へ進んでいました。前回の「受け渡し時の紛失」という説明だけでは、この実機条件を説明できていませんでした。

修正は、登録一致なしでも補助取得が失敗した場合にvisible配列を表示し、登録0件をno-registered-identitiesとして区別するものです。未登録アドレスからIdentityやtransportを自動生成しません。autoにはローカルidentitiesの登録と再ビルドが必要です。ユーザー設定そのものは変更していません。

既存テストは最終resolverに一致する登録Identityを渡しており、未登録での表示不具合を検出していませんでした。新たにprobe.js／dom-action.js／content.jsを実際に同一VMへ読み込み、source決定からrelated・sending-dataまでを通す4ケース（三点メニュー／下部×未登録／登録あり）を追加しました。SDK境界のみ架空MessageViewを使い、補助APIは実タイムアウト経路を通します。62テスト成功。New／Forwardのコードは変更していません。

### Reply宛先の受け渡し修正

sourceRecipientsの補助取得が失敗した場合に、取得済みvisibleRecipientEmailsが最終resolverで無視され、三点メニューのコピー処理でも落ちる経路を修正しました。同一source MessageViewから取得した配列を明示的に保持し、最終登録Identity照合でもvisibleを優先します。Message IDからの再探索は追加していません。収集時と最終判定時で登録情報が異なるケースを含む回帰テストで再現・修正を確認しましたが、実機症状との一致と修正後動作は再確認が必要です。

既存55件を含む58テスト成功。三点メニュー／下部Replyで同一インスタンスを使用すること、補助取得失敗・timeoutでもvisible単一一致を維持することを検証しました。source優先順位・TTL・consume-once・New／Forwardの処理は変更していません。

### Reply実機不具合修正（2026-09-15、最新）

実機では元MessageViewのvisible recipient emailsが取得できてもgetRecipientsFull()のtimeoutでIdentityが未決定となっていました。Identity判定はvisible優先へ変更し、単一登録Identity一致ならauto・read-only確認表示とします。0一致時だけfullを補助取得、不明または複数一致はmanual-requiredです。Gmail／YubinBoxは登録定義のtransportで決定します。

fresh pendingがないreplyでは、ComposeのThread IDと一致する単一ThreadViewの最後のMessageViewをsource=thread-bottom-replyとして採用します。fresh pendingは上書きしません。Thread不明・複数一致・Message ID取得失敗時はsource未確定です。New／Forwardでは探索しません。本文・件名・宛先DOM解析やRFCヘッダーは追加していません。

既存48件を含む55テスト成功。今回の変更後の実機結果は未確認です。三点メニュー／下部返信でGmail・独自ドメイン宛を比較し、sending-dataのsourceMessage、sourceRecipientEmails、recipientSource、matchedIdentity、transportを確認してください。過去のfull必須・下部fallback未対応の記録は履歴です。

### 共通送信データ・Identity整理（2026-09-15、最新方針）

Reply／Reply Allは同じreplyに統合します。isForward=trueを優先してforward、isForward=falseかつisReply=trueならreply、それ以外はnewです。Gmail ComposeのTo/Cc/Bcc・件名・本文text/HTMLをそのまま使います。newでは保存後のThread IDも返信元と解釈せず、reply-source探索をskipします。

Replyは三点メニュー等で相関した元MessageViewのgetRecipientsFull()と登録Identityを照合し、1件一致ならauto・送信元確認表示必須・通常変更不可。元メール不明、複数一致、Bcc等で受信先が見えない、タイムアウト等はmanual-requiredです。New／Forwardはmanual選択。Identityはid/address/transportを保持し、登録定義からgmail/yubinboxを決めます。アドレス末尾で推測しません。

三点メニューの単一一致・5秒TTL・consume-onceは維持し、sourceMessageはSDK内部Message IDとmessage-menuを保持します。ForwardではisReply=trueでも相関を成立させず候補を消費します。下部Replyは既存の単一包含候補をthread-bottom-replyとして利用できますが、最後のMessageViewを選ぶ方式は未対応です。現在の属性一致だけでは末尾ボタンと個別Replyを安全に区別できないためです。

共通データと確認表示用状態を追加しました。RFC reply headersは含めず、内部Message IDをRFC Message-IDとして使いません。UI・Gateway・SMTP送信は未実装です。既存exactReplyTargetのunsupported診断は維持しています。

ローカル48テスト成功。mode、登録Identityの単一／複数／不明判定、transport、手動選択、Forward誤相関防止、新規探索skip、Bcc保持を検証しました。今回の共通データとIdentity自動判定はFirefox実機未検証です。

実機ではローカルIdentityを設定して再ビルド・再読み込みし、new／Reply／Reply All／Forwardの[sending-data]を確認してください。三点メニュー起点のsourceMessageと送信元を照合し、複数Identity宛・未登録宛のmanual-required、Forwardのcorrelated=false、newのrelated探索skipを確認します。過去のReply All専用判定の調査記録は履歴として残します。

### 下部Reply pending診断

利用者の実機報告では、三点メニュー経由で1通目・2通目それぞれのSDK Message IDとReply Composeの相関に成功しました。下部返信はisReply=trueでもpendingTarget=nullでした。実メールの内部IDそのものは本書へ記録しません。

今回、既存のReply／返信の属性完全一致とBUTTON／role=buttonを満たすコントロールを下部Reply候補として追加しました。位置を推定するselector、本文・表示テキスト・任意data値の読み取りはありません。SDK MessageView.getElement()との包含一致のみを使います。単一一致・SDK ID取得成功ならsource=bottom-replyで既存pendingへ保存し、0件・複数件ならstored=falseとmatchCount・理由を出します。5秒TTL、使い捨て、Reply Compose限定、exactReplyTarget.status=unsupportedは維持しています。

下部ボタンが実際にMessageView配下にあるかは未検証です。再ビルド・再読み込み後に下部返信をクリックし、`[dom-pending-target]`のsource／matchCount／storedと`[dom-compose-correlation]`を確認してください。ログが出ない場合は属性完全一致・button条件を満たしているか既存dom-clickで確認します。0件の場合、最後のメールを自動選択しません。三点メニュー経由の回帰確認も行ってください。

ローカル自動テストは既存33件と追加2件の計35件が成功しました。単一／0件／複数一致、bottom sourceのTTL・使い捨て、Reply All／Forward／menuitemの非対象を検証しています。

### 三点メニュー起点とReply Composeの時間的相関PoC

「その他のメッセージ オプション」BUTTONとSDK MessageView要素の包含一致を使い、単一候補のSDK内部Message IDをクリック時刻から5秒だけ相関対象にします。0件・複数件は保持せず、次の新規Composeで一度だけ消費します。Reply判定true・期限内・ID取得成功時のみ別診断`[dom-compose-correlation]`を出力します。保持状況は`[dom-pending-target]`です。ID取得とCompose検出の非同期順序も考慮しています。

既存のexactReplyTarget.status=unsupportedは維持します。メニュー項目の文字列を読んだり、Reply All／Forward判定を追加したりはしていません。isReplyがtrueでもReply Allを除外できず、時間的相関は返信元の証明ではありません。実機検証は未実施です。古いメール／最新メールの三点メニューから5秒以内のReply、5秒超のReply、2回目Composeへの非再利用を確認してください。

### 限定DOM helper追加

Exact Reply Target調査専用のDOMクリック観測を追加しました。本番依存・送信判定としては未採用です。実機ではまだ未検証です。SDKのみの取得制約については下記の結論を維持します。

documentのcapture・passive clickから最大8階層を調べ、aria-label／titleが英語または日本語の返信操作名と完全一致した場合だけ診断します。SDK MessageView.getElement()との包含関係がある場合、SDK由来のmessage ID・thread IDを取得し、既存same-thread候補との照合材料として出します。isLoaded、DOM IDの文字列一致、class名、最新メール順序からは推定しません。単一候補もmediumに留め、複数候補はlow、Exact Reply Targetはunverifiedです。

メール本文・宛先・件名はDOMから読みません。任意のaria／title／data属性値は出さず、既知操作名の分類と限定した識別属性の存在だけを出します。ラベルなし操作・別言語・別階層のメニューへの対応は制限があります。右上メニューも認識できるラベルがあればログを出しますが、候補なしの場合に前のクリックから推定する処理はありません。

実機確認：diagnosticOutputをtrueにして再ビルド・再読み込み後、複数メールthreadの古い／最新メールで下部ボタンと右上メニューのReply／Reply All／Forwardをそれぞれ試します。`[dom-action]`のcandidateMatchesを`[related]`のSDK IDと照合し、候補なし／複数候補も記録してください。Composeとの紐付けや操作完了を証明するログではありません。SDK getterの失敗はstatusに残し、エラー文は出しません。

### 返信元情報PoCの追検証（2026-09-14）

利用者のFirefox実機報告で、新規Compose、Reply判定、To／Cc／Subject、本文text／HTML、Gmail Thread ID・Draft ID、同一threadのMessageView候補、Sender、元メール宛先に含まれる独自ドメインアドレスの取得が確認できました。以下はその報告と公開API調査を分けた整理です。今回追加した診断フィールドの実機確認はまだです。

| 分類 | 項目 | 根拠・制約 |
| --- | --- | --- |
| InboxSDKだけで取得可能（実機報告） | 上記Compose値・内部ID・同一thread候補・Sender・元メールの統合宛先 | 実行条件全般の保証ではない。受信Identityの自動確定はしていない。 |
| 現行公開APIでは取得不能 | Exact Reply Target | Composeと特定のMessageViewを対応付ける公開getterなし。複数候補の順序・最新・宛先・表示状態からは選ばない。候補1件でも確定しない。 |
| 現行公開APIでは取得不能 | RFC Message-ID／References／In-Reply-To | core 2.2.24の公開ComposeView／MessageView APIに取得メソッドなし。内部IDを転用しない。 |
| 現行公開APIでは取得不能 | ReplyとReply Allの直接区別 | `isReply()`はReply All専用フラグではない。宛先人数からは推定しない。 |
| 現行公開APIでは取得不能 | 元メールのTo／Cc別リスト | `getRecipientsFull()`はTo／Cc／Bccの統合リスト。Compose自身のTo／Ccとは区別する。 |
| まだ未検証 | Forward実機・今回の制約診断JSON | `isForward()`と既存の宛先・件名・本文・thread getterを利用。nullを補完しない。 |

#### 調査根拠と採用しなかった経路

[Compose公式API](https://inboxsdk.github.io/inboxsdk-docs/compose/)と[Conversations公式API](https://inboxsdk.github.io/inboxsdk-docs/conversations/)、固定パッケージの`src/platform-implementation-js/views/compose-view.d.ts`・`views/conversations/message-view.d.ts`を照合しました。`getInitialMessageID()`は既存ドラフトの初期IDであり返信元のIDではありません。

配布ソースマップのMessageView実装も確認しました。型定義に残る`hasOpenReply()`はAPI version 1終了後に廃止され、現在の`load(2, ...)`では例外になります。呼び出しません。`getTargetMessageID()`は内部Gmail Compose driver、`getRfcMessageIdForSyncMessageId`は内部driver helperです。公開APIではないため呼び出し・importとも行いません。DOMやGmail APIにも切り替えていません。

#### JSONの意味

`[snapshot]`の`exactReplyTarget`、`mode.replyVsReplyAll`、`rfcHeaders`、`[related]`の`exactReplyTarget`・`rfcHeaders`と候補ごとの`rfcHeaders`は、未提供の公開APIについて`{api: null, status: "unsupported", value: null, attempted: false, reason: "..."}`を記録します。利用できるgetterがないため実API呼び出しはしていません。呼び出して失敗したという結果や、値を取得できたという結果にはしません。

候補ごとの`originalTo`／`originalCc`にも取得不能理由を記録します。`receivingIdentityCandidates`は`getRecipientsFull()`で取得した統合宛先を根拠として持ち、`selectedIdentity: null`です。独自ドメインや登録済みIdentityとの照合設定は追加していません。他の受信者を利用者本人とみなさず、正確な返信元が未確定である点も維持します。

#### 次のFirefox実機操作

1. `diagnosticOutput: true`で再ビルドし、拡張とGmailを再読み込みする。
2. テスト用の複数メッセージthreadで、最新メールと古いメールそれぞれからReplyを開く。編集イベントで`[snapshot]`／`[related]`を取得し、候補が複数でもexact targetが推定されないことを確認する。
3. 同じ元メールからReply Allを開く。画面で選んだ操作を手元で記録し、ComposeのTo／Cc、候補Sender・統合宛先・Identity候補を比較する。Reply Allフラグと元To／Ccがunsupportedのままであることを確認する。
4. 元メールの折りたたみ／展開、返信のポップアウト、既存ドラフト再開を試す。取得不足時はstatusを記録する。
5. Forwardを開き、`mode.isForward`、To／Cc、Subject、bodyText／bodyHTML、thread IDを比較する。RFC項目はどのケースもunsupported・nullであることを確認する。送信は不要。

以下の初回PoC記録の「未確認」は初回時点の記録です。最新の判定は上表を参照してください。

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

Windows、Node.js `v24.19.0`で`extension/`の`npm test`を実行し、26テストが成功しました。DOM helperについて無効時の無出力・操作分類・属性sanitization・本文非参照・複数候補の未確定を追加検証しました。

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
