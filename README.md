# 忘年会 抽選会（PHP + MySQL版）

QRコードから上位賞品の希望を事前に集め、当日はプロジェクターにあみだくじを映して抽選するWebアプリです。

- リポジトリ：https://github.com/atworks-asugano/loto
- 運用URL：https://loto.quizzical-wilbur.182-16-229-247.plesk.page/
  - 応募画面：`/`（QRコードで参加者に配布）
  - 幹事画面：`/#admin`
  - 抽選会画面：`/#stage`（プロジェクターに表示）

## 動作環境
- PHP 8.1 以上（PDO MySQL 拡張）
- MySQL 5.7 以上 / MariaDB 10.3 以上
- Apache（.htaccess 使用）。運用サーバーは Plesk（nginx + Apache）です。nginx 単体で動かす場合は下記「nginxの場合」を参照

## ファイル構成
| ファイル | 役割 |
|---|---|
| index.html | 画面（応募 / `#admin` 幹事 / `#stage` 抽選会） |
| api.php | API（応募・設定・抽選・CSV出力） |
| assets/app.js | 画面の動作とあみだくじの演出 |
| assets/bgm.js | オリジナルBGM（Web Audio APIでその場で演奏） |
| assets/style.css | 見た目 |
| schema.sql | テーブル定義 |
| config.sample.php | 設定ファイルのひな形 |
| .htaccess | 設定ファイル等の公開禁止・ヘッダー設定 |

`config.php`（DB接続情報・幹事パスワードのハッシュ）は `.gitignore` で除外しています。**リポジトリにはコミットせず、サーバー上で直接作成してください。**

## Plesk への設置手順
運用URLのドキュメントルート（`httpdocs`）直下に設置する前提です。

1. **PHP の設定**
   Plesk の「Webサイトとドメイン」→ 対象ドメイン →「PHP」で、PHP 8.1 以上を選択します。ハンドラーは Apache が処理するもの（FPM application served by Apache 等）にし、.htaccess が有効になるようにします。
2. **データベースの作成**
   「データベース」→「データベースを追加」で、データベース（例：`lottery`）とユーザーを作成します。パスワードは十分に強いものにしてください。
3. **テーブルの作成**
   作成したデータベースの「phpMyAdmin」を開き、「インポート」から `schema.sql` を実行します。
4. **ファイルの配置**（どちらか）
   - **Git 連携（推奨）**：「Git」から本リポジトリ `https://github.com/atworks-asugano/loto.git`（`main` ブランチ）を登録し、デプロイ先を `httpdocs` にします。以降は GitHub へプッシュ後、Plesk で「プル」→「デプロイ」すると反映されます（自動デプロイも設定可）。
   - **手動アップロード**：ファイルマネージャーまたは FTP で一式を `httpdocs` にアップロードします。
5. **config.php の作成**
   ファイルマネージャーで `httpdocs/config.sample.php` をコピーして `config.php` を作り、手順2のDB名・ユーザー・パスワードを設定します（ホストは通常 `localhost`）。Git デプロイでも `config.php` は上書き・削除されません。
6. **幹事パスワードの設定**
   ローカルPC等で次のコマンドを実行してハッシュを作り、`config.php` の `admin_password_hash` に貼り付けます。
   ```
   php -r "echo password_hash('幹事パスワード', PASSWORD_DEFAULT), PHP_EOL;"
   ```
7. **動作確認**
   - https://loto.quizzical-wilbur.182-16-229-247.plesk.page/#admin を開き、幹事パスワードでログインして景品を登録します。
   - https://loto.quizzical-wilbur.182-16-229-247.plesk.page/config.php と `/schema.sql` が **403 になること**を確認します（.htaccess が効いているかの確認）。

## 更新手順
1. ローカルで修正し、`main` ブランチにコミットして GitHub へプッシュします。
2. Plesk の「Git」で「プル」→「デプロイ」します（自動デプロイ設定時は不要）。
3. テーブル定義を変えた場合は、phpMyAdmin で変更分のSQLを実行します。

## 使い方
- 応募：幹事画面のQRコード（＝運用URLのトップ）を参加者に読み取ってもらいます。名前と希望の上位賞品を選んで応募します。1端末1応募で、締め切りまで変更できます。
- 当日：`#stage` をプロジェクターに映し、「あみだを引く」→「結果をめくる」で進めます。Enterキーでも操作できます。
- BGM：抽選会画面の「BGMあり」で切り替え、音量はスライダーで調整します（最初のクリック後に鳴り始めます）。
- 会の後：「応募一覧／当選結果をCSVで保存」で記録を残し、「応募データと結果をすべて削除」で個人情報を消してください。

## 抽選の仕組み
- あみだくじはサーバー側（PHP の `random_int`）で生成し、当選者を決めてからDBに保存します。画面はその結果を再現して演出するだけなので、画面を再読み込みしても結果は変わりません。
- 「1人1品まで」がオンのとき、すでに当選した人は以降の抽選から外れます。
- 当日いない人は、抽選会画面の「候補者を確認」で外せます。

## セキュリティ上の設計
- 幹事操作はセッション認証＋CSRFトークンで保護（ログイン5回失敗で5分ロック）
- POSTは `X-Requested-With` ヘッダーと JSON 形式を必須にし、他サイトからの送信を防止
- SQLはすべてプリペアドステートメント、画面表示は textContent で出力（XSS対策）
- 応募者識別用トークンはDBにはSHA-256ハッシュで保存
- CSV出力は数式インジェクション対策済み
- `config.php` 等は .htaccess で外部から読めないように設定

## 注意事項
- 応募はCookieで端末を識別します。ブラウザを変えたりCookieを消したりすると二重応募できてしまうため、幹事画面の一覧で重複を確認・削除してください。
- QRコードの生成ライブラリとWebフォントは外部CDN（cdnjs / Google Fonts）から読み込みます。
- 運用URLは Plesk の仮ドメイン（`*.plesk.page`）です。応募期間外は Plesk でサイトを停止するか、「パスワード保護されたディレクトリ」や IP 制限の併用を検討してください（応募画面にも制限がかかる点に注意）。
- 会の終了後は応募データを削除し、不要になったらサイト・データベースも削除してください。

## nginxの場合
.htaccess は効かないため、次の設定を追加してください（Plesk では「Apache & nginx 設定」→「追加 nginx ディレクティブ」）。
```
location ~ ^/(config\.php|config\.sample\.php|schema\.sql|README\.md)$ { deny all; }
```

## 本番適用前に
本コードはAIが生成した参考実装です。公開前に、コードレビュー・セキュリティ確認・動作テスト（実機スマホ・会場のPCとプロジェクター）を社内の開発プロセスに沿って実施してください。
