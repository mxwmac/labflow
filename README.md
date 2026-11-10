# LabFlow v2 — 研究室の進捗ナビゲーター

手書きの MTG メモを Gemini が読み取り、指摘・ToDo・指導教員の空き時間・進捗の停滞から「次の一手」まで導く Web アプリです。
v2 では単一 HTML の試作を **Cloud Run + Firestore + Vertex AI（Gemini）** の構成に移し、API キーをブラウザに置かない形にしました。

![構成図](docs/architecture.png)

---

## 目次

1. [v2 で増えた機能](#1-v2-で増えた機能)
2. [構成](#2-構成)
3. [ローカルで試す（3分）](#3-ローカルで試す3分)
4. [Google Cloud へのデプロイ手順](#4-google-cloud-へのデプロイ手順)
5. [環境変数](#5-環境変数)
6. [運用（更新・ログ・コスト）](#6-運用更新ログコスト)
7. [セキュリティとプライバシー](#7-セキュリティとプライバシー)
8. [トラブルシューティング](#8-トラブルシューティング)

---

## 1. v2 で増えた機能

| 区分 | 機能 | 内容 |
|---|---|---|
| 基盤 | **Cloud Run で公開** | 画面と API を 1 つのコンテナで配信。Gemini はサーバーから Vertex AI 経由で呼ぶため **API キー不要・端末にキーを置かない** |
| 基盤 | **Google ログイン / ゲスト** | Firebase Authentication。ゲスト（匿名）で試したあと、Google アカウントへデータごと引き継げる |
| 基盤 | **Firestore に保存** | タスク・MTG ノート・進捗推移・報告書をクラウド保存。スマホと PC で同じデータを使える |
| メモ解析 | **要確認フラグと編集** | 判読に自信がない語句を Gemini が「要確認」として列挙。「候補で確定 / 原文のまま / 手で直す」で解消でき、ノート全体も編集可能 |
| メモ解析 | **PDF 対応・画像の自動縮小** | スキャン PDF を直接解析。写真は長辺 2048px に縮小して送信（転送量削減）。クリップボード貼り付けも可 |
| 追跡 | **MTG 履歴と指摘の追跡** | 過去の MTG を一覧・検索。全 MTG の指摘を「未対応の指摘」に集約し、対応済みのチェックやタスク化ができる |
| 進捗 | **進捗の推移グラフ・停滞検知** | スライダーを動かすと日ごとに記録。平均進捗の推移を表示し、14 日間動いていないフェーズに「停滞」を表示 |
| 予定 | **カレンダーへ予定登録** | 空き枠を押すと相談アポ／作業時間を Google カレンダーに登録（確認画面あり、先生の招待は任意）。自分の予定と重なる時間は空きから除外 |
| 予定 | **「予定の有無のみ」共有にも対応** | 先生が詳細を共有していない場合は freeBusy API で空き時間だけを算出 |
| 提案 | **次の一手の強化** | 期限切れタスク・未対応の high 指摘・停滞フェーズ・空き時間を考慮。提案からアポ登録やタスク化を 1 クリックで |
| 報告 | **報告書の下書き** | 週報 / ゼミ進捗報告 / 先生への相談依頼メールを Markdown で生成。コピー・.md 保存・メールアプリ起動 |
| その他 | 期限・優先度つきタスク、フェーズ名の変更、相談可能時間の設定、1日あたりの AI 利用上限、ダーク/ライト、スマホ対応 |

---

## 2. 構成

```
labflow/
├── server.js              # Cloud Run のエントリポイント（Express）
├── src/
│   ├── config.js          # 環境変数の読み込み
│   ├── auth.js            # Firebase ID トークンの検証（ドメイン制限・ゲスト可否）
│   ├── routes.js          # /api/*（タスク・MTG・解析・提案・報告書・リセット）
│   ├── ai.js              # Gemini 呼び出し（Vertex AI / API キー / モック）
│   ├── prompts.js         # プロンプトと構造化出力スキーマ
│   ├── fallback.js        # AI を使わないときのルールベース処理
│   ├── sample.js          # 初回ログイン時のサンプルデータ
│   └── store/             # Firestore 版とメモリ版（ローカル用）
├── public/                # 画面（HTML / CSS / ES Modules。ビルド不要）
├── test/api.test.js       # API の結合テスト（npm test）
├── Dockerfile
├── deploy/
│   ├── setup.sh           # 初期設定（API 有効化・Firestore・サービスアカウント）
│   ├── deploy.sh          # Cloud Run へデプロイ
│   └── env.example.yaml   # Cloud Run に渡す環境変数のひな形
├── cloudbuild.yaml        # （任意）GitHub 連携の自動デプロイ
├── firestore.rules        # ブラウザからの直接アクセスを全面禁止
└── docs/architecture.png  # 構成図
```

**処理の流れ**

1. ブラウザは Firebase Authentication でログインし、ID トークンを付けて Cloud Run の `/api` を呼ぶ
2. Cloud Run は ID トークンを検証し、Firestore（`users/{uid}/...`）を読み書きする
3. メモ解析・次の一手・報告書は Cloud Run から Vertex AI の Gemini を呼ぶ（サービスアカウント認証）
4. Google カレンダーはブラウザから直接 Calendar API を呼ぶ（OAuth トークンは端末のメモリ内だけ）

---

## 3. ローカルで試す（3分）

Google Cloud の設定なしで、全画面を動かせます（ログイン省略・メモリ保存・AI は固定のサンプル応答）。

```bash
cd labflow
npm install
npm run dev
# → http://localhost:8080
```

テスト: `npm test`

### 本物の Firestore / Gemini につないでローカル実行する場合

手順 4 のプロジェクト設定が終わっていれば、手元から同じ構成で動かせます。

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
cp .env.example .env       # 値を埋める
npm run start:local        # → http://localhost:8080
```

`localhost` は Firebase の承認済みドメインに最初から入っています。カレンダー連携も試す場合は OAuth クライアントの「承認済みの JavaScript 生成元」に `http://localhost:8080` を追加してください。

---

## 4. Google Cloud へのデプロイ手順

所要時間の目安: 初回 30〜40 分（うち待ち時間 10 分程度）。

### 手順 0. 準備するもの

- 課金が有効な Google Cloud プロジェクト（Firestore・Vertex AI・Cloud Build に必要）
- [gcloud CLI](https://cloud.google.com/sdk/docs/install)（Cloud Shell なら最初から入っています）
- このフォルダ一式

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

> 💡 **Cloud Shell を使うと楽です。** コンソール右上の「>_」を開き、このフォルダを zip でアップロードして `unzip` すれば、以下のコマンドをそのまま実行できます。

### 手順 1. 初期設定スクリプトを実行

API の有効化、Firestore（東京リージョン）の作成、Cloud Run 用サービスアカウントの作成と権限付与をまとめて行います。

```bash
chmod +x deploy/*.sh
PROJECT_ID=YOUR_PROJECT_ID ./deploy/setup.sh
```

最後に **デプロイ後の URL（予定）** が表示されます（例: `https://labflow-123456789012.asia-northeast1.run.app`）。以降の手順で使うので控えてください。

| 付与される権限 | 用途 |
|---|---|
| `roles/aiplatform.user` | Vertex AI の Gemini を呼ぶ |
| `roles/datastore.user` | Firestore を読み書きする |
| `roles/logging.logWriter` | ログを書く |
| `roles/run.builder`（Compute Engine のデフォルト SA） | `--source` デプロイ時のビルド |

### 手順 2. Firebase を追加してウェブアプリを登録

1. [Firebase コンソール](https://console.firebase.google.com/) →「プロジェクトを作成」→ **既存の Google Cloud プロジェクトを選択** して Firebase を追加
2. プロジェクトの概要 → **ウェブアプリを追加（`</>`）** → ニックネーム `labflow`（Hosting は不要）
3. 表示された設定のうち `apiKey` と `appId` を控える
   （後から見る場合: ⚙ プロジェクトの設定 → 全般 → マイアプリ）

### 手順 3. ログイン方法を有効化

Firebase コンソール → **Authentication** →「始める」

1. **ログイン方法** タブ → **Google** を有効化（プロジェクトのサポートメールを選択）
2. 同じく **匿名** を有効化（ゲストで試す機能。不要なら `ALLOW_GUEST: "false"`）
3. **設定** タブ → **承認済みドメイン** →「ドメインを追加」で、手順 1 の URL のホスト名（`labflow-123456789012.asia-northeast1.run.app`）を追加

### 手順 4. Google カレンダー連携の OAuth 設定

Google Cloud コンソール → **Google Auth Platform**（旧「OAuth 同意画面」）

1. **ブランディング**: アプリ名 `LabFlow`、サポートメールを設定（Firebase の Google ログイン有効化で設定済みのことがあります）
2. **対象**:
   - 大学の Google Workspace 組織内のプロジェクトなら **内部** を選べます（学内アカウントだけで利用）
   - **外部** でテスト中の場合は、使う人のアカウントを **テストユーザー** に追加（最大 100 人）
3. **データアクセス** →「スコープを追加または削除」で次の 2 つを追加
   - `https://www.googleapis.com/auth/calendar.readonly`（先生の予定の閲覧）
   - `https://www.googleapis.com/auth/calendar.events`（予定の登録。登録ボタンを押したときだけ追加で許可を求めます）
4. **クライアント** →「Web client (auto created by Google Service)」を開き、**承認済みの JavaScript 生成元** に次を追加して保存
   - 手順 1 の URL（`https://labflow-123456789012.asia-northeast1.run.app`）
   - （ローカルでも試すなら）`http://localhost:8080`
5. その画面の **クライアント ID** を控える

> 先生側の準備: Google カレンダーの「設定と共有」→「特定のユーザーまたはグループと共有する」で学生を追加し、権限を **予定の表示（すべての予定の詳細）** にしてもらいます。**予定の表示（時間枠のみ）** でも空き時間の抽出は動きます（予定名は表示されません）。カレンダー ID は通常、先生のメールアドレスです。

### 手順 5. 環境変数ファイルを作る

```bash
cp deploy/env.example.yaml deploy/env.yaml
```

`deploy/env.yaml` の次の 4 つを埋めます（どれもブラウザに配られる公開値で、秘密情報ではありません）。

```yaml
GOOGLE_CLOUD_PROJECT: "your-project-id"
FIREBASE_API_KEY: "AIza..."                      # 手順 2
FIREBASE_APP_ID: "1:123456789012:web:abcdef"     # 手順 2
OAUTH_CLIENT_ID: "123456789012-xxxx.apps.googleusercontent.com"  # 手順 4
```

学内アカウントに限定したい場合は `ALLOWED_EMAIL_DOMAINS: "saitama-u.ac.jp"` のように指定します。

### 手順 6. デプロイ

```bash
./deploy/deploy.sh
```

Cloud Build がコンテナをビルドして Cloud Run にデプロイします（初回 3〜5 分）。最後に URL とヘルスチェック結果が表示されます。

> 表示された URL が手順 1 の予定 URL と違う場合（古い形式の URL が出た場合など）は、その URL も手順 3・4 に追加してください。どちらの URL でも同じサービスにつながります。

### 手順 7. 動作確認

1. URL を開き、**Google でログイン**（または **ゲストで試す**）→ サンプルデータ入りの画面が出る
2. 右上の Gemini の表示が `gemini-3.8-flash ・ 0/60` になっている
3. 手書きメモの写真（または PDF）を追加 →「✨ Gemini で解析する」→ MTG ノートと「要確認」が表示される
4. 「再提案」→ 次の一手が 3 件出る
5. ⚙ 設定で先生のカレンダー ID を入れて保存 →「Google 連携」→ 予定と空き枠が表示される
6. 緑の空き枠を押して予定を登録 → 自分の Google カレンダーに入っている
7. 📄 報告書 → 週報を生成できる

### 手順 8（任意）. Firestore ルールの明示

サーバーだけが Firestore を使うため、ブラウザからの直接アクセスは不要です。念のため全面拒否のルールを適用しておきます。

```bash
npx firebase-tools@latest login
npx firebase-tools@latest deploy --only firestore:rules --project YOUR_PROJECT_ID
```

（コンソールの Firestore → ルール に `firestore.rules` の内容を貼り付けても同じです）

### （任意）GitHub から自動デプロイ

`cloudbuild.yaml` を Cloud Build のトリガーに指定すると、push のたびに テスト → ビルド → デプロイ します。初回は `deploy.sh` で環境変数を設定したサービスを作っておき、以降はイメージだけを更新する運用です（ファイル冒頭のコメント参照）。

---

## 5. 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | — | プロジェクト ID（必須） |
| `FIREBASE_API_KEY` / `FIREBASE_APP_ID` | — | Firebase ウェブアプリの設定（必須） |
| `FIREBASE_AUTH_DOMAIN` | `<project>.firebaseapp.com` | 通常は変更不要 |
| `OAUTH_CLIENT_ID` | — | カレンダー連携用。空ならカレンダーはデモ表示のみ |
| `AI_MODE` | `vertex` | `vertex`（推奨）/ `apikey`（`GEMINI_API_KEY` を使用）/ `mock` |
| `GEMINI_LOCATION` | `global` | Vertex AI のロケーション |
| `GEMINI_MODEL` | `gemini-3.8-flash` | 既定モデル |
| `GEMINI_MODELS` | 3 モデル | 設定画面で選べるモデル（カンマ区切り） |
| `AI_DAILY_LIMIT` / `GUEST_DAILY_LIMIT` | `60` / `20` | 1 ユーザー 1 日あたりの AI 呼び出し上限 |
| `ALLOW_GUEST` | `true` | ゲスト（匿名）ログインを許可するか |
| `ALLOWED_EMAIL_DOMAINS` | 空 | Google ログインできるメールドメインを制限 |
| `MAX_UPLOAD_MB` | `18` | 1 回の解析で送れる合計サイズ |
| `APP_TZ` | `Asia/Tokyo` | 日付の基準 |
| `STORE` | `firestore` | `memory` はローカル試用・テスト用 |
| `AUTH_MODE` | `firebase` | `dev` はローカル専用（Cloud Run 上では起動を拒否） |

**API キー方式に切り替える場合**（Vertex AI が使えない事情があるとき）: Secret Manager に `gemini-api-key` を作成し、`env.yaml` を `AI_MODE: "apikey"` にして、`deploy.sh` の `gcloud run deploy` に `--set-secrets=GEMINI_API_KEY=gemini-api-key:latest` を追加します（サービスアカウントに `roles/secretmanager.secretAccessor` が必要）。

---

## 6. 運用（更新・ログ・コスト）

```bash
# コードを直したら再デプロイ（同じコマンド）
./deploy/deploy.sh

# ログを見る
gcloud run services logs read labflow --region asia-northeast1 --limit 50

# 1つ前のリビジョンに戻す
gcloud run revisions list --service labflow --region asia-northeast1
gcloud run services update-traffic labflow --region asia-northeast1 --to-revisions=REVISION_NAME=100
```

**コストの考え方**

- Cloud Run は `min-instances=0`（アクセスがないときは停止）、`max-instances=3` に制限しています
- Firestore は 1 ユーザーあたりの読み書きが少なく、無料枠内に収まる想定です
- Gemini は従量課金です。`AI_DAILY_LIMIT` で 1 人あたりの回数を制限しています
- 念のため、請求先アカウントの **予算とアラート** で月額の上限通知を設定してください

---

## 7. セキュリティとプライバシー

- **API キーを配らない**: Gemini はサーバーからサービスアカウントで呼び出し。ブラウザに秘密情報はありません
- **データの分離**: すべての API で Firebase ID トークンを検証し、`users/{uid}` 配下だけを読み書きします。Firestore はブラウザから直接触れないルールです
- **画像は保存しない**: メモの画像・PDF は解析後に破棄し、ファイル名だけを記録します
- **カレンダー権限は最小限**: 閲覧は `calendar.readonly`、登録時だけ `calendar.events` を追加で求めます。トークンはブラウザのメモリ内だけで扱い、サーバーには送りません。予定登録は必ず確認画面を経由します
- **AI の出力は人が確認**: 判読に迷った語句は「要確認」として明示し、ToDo や提案は利用者が押したときだけタスクに追加します
- **コストの暴走防止**: 1 日あたりの AI 呼び出し上限、アップロードサイズ上限、Cloud Run の最大インスタンス数

---

## 8. トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| ログイン時「承認済みドメインに登録されていません」 | 手順 3-3。Cloud Run のホスト名を Firebase Authentication の承認済みドメインに追加 |
| ログイン画面に「Firebase の設定がありません」 | `FIREBASE_API_KEY` / `FIREBASE_APP_ID` を `env.yaml` に入れて再デプロイ |
| 「ゲストで試す」で `operation-not-allowed` | 手順 3-2。匿名ログインを有効化 |
| Google 連携で `origin_mismatch` / `redirect_uri_mismatch` | 手順 4-4。JavaScript 生成元に URL を追加（反映まで数分かかることがあります） |
| Google 連携で「このアプリは確認されていません」「アクセスをブロック」 | 手順 4-2。テストユーザーに自分のアカウントを追加、または内部アプリにする |
| カレンダー取得で 404 | カレンダー ID の誤り、または先生が共有していない。先生の共有設定を確認 |
| 解析で「モデルが見つかりません」 | `GEMINI_LOCATION` を `global` にするか、`GEMINI_MODEL` を Vertex AI で使えるモデルに変更 |
| 解析で「権限がありません」 | サービスアカウントに `roles/aiplatform.user` があるか、Vertex AI API が有効か確認（`setup.sh` を再実行） |
| `PERMISSION_DENIED`（Firestore） | `roles/datastore.user` の付与、Firestore データベースの作成を確認 |
| デプロイ時に `allUsers` を追加できないエラー | 組織ポリシー（ドメイン制限共有）による制限。`deploy.sh` の `--allow-unauthenticated` を `--no-invoker-iam-check` に置き換えて再実行 |
| ビルドで権限エラー | `setup.sh` を再実行（`roles/run.builder` の付与）。数分待ってから再試行 |
| 「ファイルが大きすぎます」 | 1 回あたり合計 18MB まで。PDF を分割するか枚数を減らす |
| 「本日の AI 利用上限に達しました」 | `AI_DAILY_LIMIT` を上げて再デプロイ、または翌日に再試行 |
