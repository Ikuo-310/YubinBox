# YubinBox Browser Extension

Gmail Webの作成・返信画面とGatewayをつなぐブラウザ拡張です。初期対象はFirefoxで、InboxSDKを第一候補として検討します。現在は設計段階で、インストール可能な拡張やビルド手順はありません。

## 想定する責務

- Gmail Compose／Reply画面の検出と、独自ドメイン宛メールへの返信判定。
- To・Cc・Subject・Bodyおよび取得可能な元メール情報の読み取り。
- Gatewayに登録されたSending Identityの取得と選択。
- Gmail標準送信とYubinBox送信の使い分け。
- Gateway APIへの送信要求と結果表示。
- GatewayベースURLと端末用API Tokenの設定。

ベースURLは設定から変更可能とし、`{gateway_base_url}/api/send`のように固定パスと組み合わせます。SMTP認証情報は保持しません。拡張に保存するBearer Tokenも秘密情報として扱い、ログやGitへ含めません。保存方法、権限、クロスオリジン通信の方法はPoCで検討します。

## 最初に行うこと

[Firefox＋InboxSDKのPoC Issue候補](../docs/development-plan.md#最初のissue候補firefoxinboxsdkでgmail連携を検証する)に従い、画面検出とデータ取得だけを検証します。InboxSDKのFirefox対応やRFCメールヘッダーの取得は、利用できると仮定せず実測します。

通常のGmail送信を変更する操作や実際のGateway送信はPoCに含めません。取得できない情報、追加権限が必要な情報、Gmail内部IDとRFC Message-IDの違いを記録し、採用判断に使います。
