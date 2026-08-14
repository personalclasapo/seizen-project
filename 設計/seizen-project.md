# 生前整理サービス 設計ドキュメント

このドキュメントは、生前整理サービス（仮称）の設計をまとめたものです。Claude Codeでの実装時、寺内さんの細かい指示なしで進められるレベルの詳細度で記載しています。

**最終更新：2026-06-10（コード実装の実態に合わせて全面更新）**

---

## 1. サービスの全体像

### 1-1. 根本思想

**サービスのゴール：家族が動ける状態を作ること**

情報を記録すること自体ではなく、いざという時に家族が動ける状態を整えることがゴール。

- 既存の生前整理サービス：情報の収集・記録が中心
- このサービス：情報を集めた上で、家族が実際に動ける構造を整える

### 1-2. ターゲット

**家族プロジェクト型**

- 主役：家族（子世代、40〜50代）
- 支払い：家族
- 本人（親世代）：情報を持っている人として、家族とともに参加
- 寺内さん（サービス提供者）：家族の伴走者として、仕組み・進め方を提供

### 1-3. 差別化軸

**vs サブスク管理アプリ**
- 個人視点 → 家族視点
- 節約目的 → いざという時に止まらない／止められる
- ツール単独 → ツール＋伴走
- サブスクで完結 → 全領域に拡張

**vs 既存の生前整理サービス**
- 心の整理／葬儀／法的書類／モノの整理が中心 → お金・契約・デジタルが中心
- 本人と契約 → 家族と契約
- 単発の手続き／作って終わり → 継続関係で運用を回す
- アナログ領域が中心 → デジタル領域に強い

### 1-4. 寺内さん本業との構造的一致

| 項目 | 本業（社外財務サポーター） | 生前整理 |
|---|---|---|
| 対象 | 経営者 | 家族 |
| データ | freee | Googleスプシ |
| 役割 | 数字の見える化+伴走 | 情報の見える化+伴走 |
| 提供価値 | 「やった方がいい」を「一緒にやる」 | 同じ |

---

## 2. 機能設計

### 2-1. 4グループ

`js/schema.js` の `GROUPS` 配列で定義。

1. **支出・収入** — `sheets: ['cash_flow']`
   - サブスク、公共料金、通信費、保険料の支払い、月額会員費
   - 年金、給与、家賃収入

2. **資産・負債** — `sheets: ['bank_account', 'insurance', 'securities', 'crypto', 'real_estate', 'precious_metal', 'loan']`
   - 銀行口座、証券口座、暗号資産、不動産、貴金属
   - 保険商品
   - 借入・保証

3. **もしもの時** — `sheets: ['contact_network', 'medical_info']`
   - 連絡網（危篤時・葬儀時に連絡する人リスト）
   - 医療・身体（かかりつけ医、常用薬、持病、延命意思など）

4. **のこすもの** — `sheets: []`（未実装）
   - 意思・希望、法的書類などを今後追加予定

グループに `sheets: []` のものは、ダッシュボードで「準備中」表示になる。

### 2-2. 観点フレームワーク（2系統）

**通常シート（支出・収入・資産・負債グループ）**

`PERSPECTIVES` 配列で定義。q2・q3・q4 の3観点が進捗計算の対象。q1（存在の把握）はデータとして保存されるが進捗の分母・分子には入らない。

```js
const PERSPECTIVES = [
  { key: 'q2', statusCol: 'q2_understanding_status', contentCol: 'q2_understanding_content', label: '中身' },
  { key: 'q3', statusCol: 'q3_access_status',       contentCol: 'q3_access_content',        label: 'アクセス' },
  { key: 'q4', statusCol: 'q4_emergency_status',    contentCol: 'q4_emergency_content',     label: '緊急' },
];
```

各観点：
- **中身の理解（q2）**：何のためにあるか、本人の意思は何か
- **アクセス・操作（q3）**：家族がアクセスできる仕組みがあるか。解約・変更・継続などの操作ができるか
- **緊急時の手順（q4）**：いざという時に家族が動くための手順が明確か

**noPerspectivesシート（もしもの時グループ）**

`SHEETS[key].noPerspectives: true` のシートは4観点を使わない。代わりに `q1_existence_status` の「完了」/「未確認」2値でステータスを管理する。`doneCount()` は `q1_existence_status === '完了'` なら1、そうでなければ0を返す（最大1）。

### 2-3. 入力経路（2系統、出口は統一）

**系統1：明細アップロード → 自動抽出**
- 対象：支出・収入（特にサブスク、公共料金、通信など）
- ユーザー作業：カード明細・銀行明細のファイルアップロード（`upload.html`）
- 解析：Claude Codeで自動実行（Webアプリでは解析しない）
- 結果：`transaction_candidates` に候補が書き込まれ、`extraction.html` で確認・登録

**系統2：ヒアリング → 手動入力**
- 対象：資産・負債、もしもの時
- ユーザー作業：`add-item.html` でカテゴリ選択 → フォーム入力
- 結果：各シートに直接書き込み

---

## 3. 画面構成（現状）

| ファイル | 役割 | 状態 |
|---------|------|------|
| `index.html` | ログイン | 実装済み。Google OAuth → スプシ未設定なら `setup.html`、設定済みなら `dashboard.html` |
| `setup.html` | 初回セットアップ | 実装済み。新規作成 or 既存選択 → シート初期化（サンプルデータ投入含む）→ `dashboard.html` |
| `dashboard.html` | ダッシュボード | 実装済み。全体進捗・グループ別進捗・明細候補バナー。スプシ未設定なら `settings.html` へ |
| `item-list.html` | 項目一覧 | 実装済み。グループ or シート単位で表示。観点アイコン・絞込・詳細展開 |
| `all-items.html` | 全項目一覧 | 実装済み。全シートを横断した一覧 |
| `item-detail.html` | 項目詳細 | 実装済み。観点カード・基本情報編集・削除（全項目一括編集モーダルあり） |
| `add-item.html` | 項目追加 | 実装済み。グループ選択（Step1）→ 入力フォーム（Step2）の2ステップ |
| `upload.html` | 明細アップロード | 実装済み。PDF/CSVをDriveに保存 |
| `extraction.html` | 明細抽出結果 | 実装済み。`transaction_candidates` の確認・登録 |
| `settings.html` | 設定 | 実装済み。家族メンバーの追加・名前編集・色設定・削除のみ |

**未実装**：TODO一覧（元設計の画面I）

### ボトムナビ（全画面共通）

4タブ構成：**ダッシュボード・グループ・全項目・設定**

| タブ | リンク先 | アイコン |
|-----|---------|---------|
| ダッシュボード | `dashboard.html` | ホームアイコン |
| グループ | `item-list.html`（グループ選択シート） | グリッドアイコン |
| 全項目 | `all-items.html` | リストアイコン |
| 設定 | `settings.html` | 歯車アイコン |

### スクロールトップボタン

`dashboard.html`, `all-items.html`, `item-list.html`, `item-detail.html`, `settings.html` に設置。300px以上スクロールすると右下に白背景＋グレーボーダーの丸ボタン（↑）が出現し、タップでトップへスムーズスクロール。

### 3-1. 画面遷移

```
index.html（ログイン）
  → setup.html（初回のみ）→ dashboard.html
  → dashboard.html（既存ユーザー）
       ↓
  item-list.html?group=支出・収入
  item-list.html?group=資産・負債
  item-list.html?group=もしもの時
       ↓ 項目クリック
  item-detail.html?sheet=cash_flow&row=N
  
  add-item.html?group=支出・収入
  add-item.html?group=資産・負債
  add-item.html?sheet=bank_account（シート直指定）
  
  all-items.html（ボトムナビ「全項目」）
  settings.html（ボトムナビ「設定」）
  upload.html → extraction.html
```

### 3-2. デザイントーン（確定）

- 背景：`bg-[#FAF7F0]`（ベージュ）
- アクセント：`#4A7C59`（グリーン）
- カード：`bg-white` + `rounded-xl` + `shadow-sm`
- ボタン（主）：`bg-[#4A7C59] text-white`
- ボタン（副）：`border border-blue-300 text-blue-600`
- スクロールトップボタン：`bg-white border-2 border-gray-300 text-gray-600`

### 3-3. add-item.htmlの動作詳細

- `?group=支出・収入` → Step1（グループ内シートが1つなら自動選択してStep2）
- `?group=資産・負債` → Step1（銀行口座・保険商品・証券・投資・暗号資産・不動産・貴金属・借入保証を選択肢として表示）
- `?group=もしもの時` → Step1（連絡網・医療身体を選択肢として表示）
- `?sheet=bank_account` → Step1をスキップしてStep2直接
- Step2タイトル：`selectedDef().group + 'を追加'`（例：「資産・負債を追加」）
- Step1のボタンラベル：グループ内シートが1つなら「グループ名」、複数ならシートのlabel

---

## 4. データ設計

### 4-1. シート構成

1家族 = 1スプシファイル。各シートが各テーブル。

**項目データシート（実装済み）**
- `cash_flow`：支出・収入
- `bank_account`：銀行口座
- `insurance`：保険商品
- `securities`：証券・投資
- `crypto`：暗号資産
- `real_estate`：不動産
- `precious_metal`：貴金属
- `loan`：借入・保証
- `contact_network`：連絡網（もしもの時グループ・noPerspectives）
- `medical_info`：医療・身体（もしもの時グループ・noPerspectives）

**マスター・補助データシート**
- `family_member`：家族メンバーマスター
- `upload_history`：明細アップロード履歴
- `raw_transactions`：明細の生データ
- `transaction_candidates`：AI抽出した定期支払い候補

**未実装シート**（のこすもの系、今後追加）
- 意思・希望、法的書類

### 4-2. 共通カラム（すべての項目データシート）

```
id                          項目ID（例：cash_001、bank_001、ins_001）
created_at                  作成日時（ja-JP ロケール）
updated_at                  最終更新日時

q1_existence_status         観点1の状態（完了/未確認/該当なし）
                            ※通常シート：進捗計算対象外
                            ※noPerspectivesシート：これのみで完了/未確認を管理
q1_existence_content        観点1の入力内容
q2_understanding_status     観点2の状態（完了/未確認/該当なし）
q2_understanding_content    観点2の入力内容
q3_access_status            観点3の状態
q3_access_content           観点3の入力内容
q4_emergency_status         観点4の状態
q4_emergency_content        観点4の入力内容

free_memo                   自由記述メモ
```

合計12カラムが共通。`doneCount(row, sheetKey)` の返す値：
- 通常シート：q2・q3・q4 が「完了」の数（最大3）
- noPerspectivesシート：q1_existence_status が「完了」なら1、そうでなければ0（最大1）

### 4-3. 各シートの固有カラム

#### 4-3-1. cash_flow（支出・収入）

```
service_name                業者名・サービス名
service_category            種別（下記選択肢）
cash_flow_type              支出/収入
contract_holder_id          契約者（family_member.display_name で参照）
billing_cycle               請求サイクル（月額/年額/隔月/その他）
billing_amount              請求額
monthly_amount              月額換算（年額なら÷12で自動計算）
payment_method              支払い方法・口座
status                      ステータス（継続中/解約予定/解約済）
input_source                入力経路（明細抽出/手動入力）
source_transaction_id       明細生データへの参照
plan                        プラン名（例：家族プラン、Premiumなど）
```

service_category の選択肢:
- 支出系：サブスク、公共料金、通信、メディア(NHK・新聞)、保険料の支払い、月額会員費、駐車場・トランクルーム・貸金庫、ローン返済、その他
- 収入系：年金、給与、家賃収入、その他

合計：12（共通）+ 12（固有）= 24カラム

#### 4-3-2. bank_account（銀行口座）

```
bank_name                   銀行名
branch_name                 支店名
account_type                口座種別（普通預金/定期預金/貯蓄預金）
account_number              口座番号（任意）
estimated_amount            概算残高（円）
account_holder_id           名義人（family_member.display_name で参照）
account_status              状態（メイン/サブ/休眠/解約予定）
net_banking_usage           ネットバンキング利用（利用中/登録のみ/未利用）
```

合計：12（共通）+ 8（固有）= 20カラム

#### 4-3-3. insurance（保険商品）

```
insurance_company           保険会社名
product_name                商品名
insurance_type              種別（生命/医療/がん/個人年金/火災・地震/自動車/その他）
policy_number               証券番号
contract_holder_id          契約者（family_member.display_name で参照）
insured_person_id           被保険者（family_member.display_name で参照）
beneficiary_id              受取人（family_member.display_name で参照）
insurance_amount            保険金額（テキスト）
estimated_amount            保険金額・概算（円、数値計算用）
payment_status              払込状況（払込中/払込済/失効）
maturity_date               満期日（テキスト、「終身」も可）
account_status              ステータス（継続中/解約予定/解約済/失効）
```

合計：12（共通）+ 12（固有）= 24カラム

#### 4-3-4. securities（証券・投資）

```
company_name                証券会社名
account_type                口座区分（特定/一般/NISA/つみたてNISA/iDeCo/その他）
account_number              口座番号（任意）
holder_id                   名義人（family_member.display_name で参照）
estimated_amount            評価額・概算（円）
net_usage                   ネット証券（利用中/登録のみ/未利用）
account_status              ステータス（運用中/解約予定/解約済）
```

合計：12（共通）+ 7（固有）= 19カラム

#### 4-3-5. crypto（暗号資産）

```
exchange_name               取引所・ウォレット名
storage_type                保管形態（取引所/ホットウォレット/ハードウェアウォレット/その他）
coin_type                   通貨（BTC/ETH/その他）
holder_id                   名義人（family_member.display_name で参照）
estimated_amount            評価額・概算（円）
seed_backup_status          バックアップ状況（有（保管済）/無/確認中）
account_status              ステータス（保有中/売却予定/売却済）
```

合計：12（共通）+ 7（固有）= 19カラム

#### 4-3-6. real_estate（不動産）

```
property_type               種別（土地/戸建/マンション/その他）
location                    所在地（任意・ざっくりで可）
holder_id                   名義人（family_member.display_name で参照）
estimated_amount            評価額・概算（円）
loan_exists                 ローン（あり/なし）
usage_status                利用状況（居住中/賃貸中/空き家/その他）
```

合計：12（共通）+ 6（固有）= 18カラム

#### 4-3-7. precious_metal（貴金属）

```
metal_type                  種別（金/プラチナ/銀/コイン/ジュエリー/その他）
holder_id                   名義人（family_member.display_name で参照）
estimated_amount            評価額・概算（円）
storage_location            保管場所（自宅金庫/貸金庫/業者保管/その他）
custodian_name              保管先名称（任意）
account_status              ステータス（保管中/売却予定/売却済）
```

合計：12（共通）+ 6（固有）= 18カラム

#### 4-3-8. loan（借入・保証）

```
lender_name                 借入先・保証先
loan_type                   種別（住宅ローン/自動車ローン/カードローン/事業性借入/連帯保証/その他）
debtor_id                   債務者・保証人（family_member.display_name で参照）
remaining_debt              残債・概算（円）
repayment_due               完済予定（テキスト、例：2035年3月）
account_status              ステータス（返済中/完済予定/完済/保証中）
```

合計：12（共通）+ 6（固有）= 18カラム

#### 4-3-9. contact_network（連絡網）※noPerspectives

```
contact_name                氏名・名称
relationship                関係（自由記述、例：父の高校の同級生）
notify_timing               連絡タイミング（危篤時に呼ぶ/逝去後すぐ/葬儀の案内/後日通知でよい/連絡不要）
phone_number                電話番号
email                       メールアドレス
subject_id                  対象者（family_member.display_name で参照）
```

合計：12（共通）+ 6（固有）= 18カラム

statusTagは `notify_timing` の値に応じてバッジ表示：
- `危篤時に呼ぶ` → ローズ（`bg-rose-100 text-rose-700`）
- `連絡不要` → グレー（muted）
- その他 → ブルー

#### 4-3-10. medical_info（医療・身体）※noPerspectives

```
subject_id                  対象者（family_member.display_name で参照）
medical_category            種別（かかりつけ医・病院/常用薬・お薬手帳/持病・既往歴/各種保険証/延命・治療の意思/臓器提供の意思/要介護・障害/その他）
title                       項目名（自由記述）
```

合計：12（共通）+ 3（固有）= 15カラム

statusTagは常に `null`（バッジ表示なし）。

### 4-4. マスター・補助データシート

#### 4-4-1. family_member（家族メンバーマスター）

```
id                          メンバーID（例：fm_1717000000000）
display_name                表示名（父、母など、自由）
role                        続柄（自由記述）
note                        メモ
color                       色キー（blue/rose/green/amber/purple/teal/orange/indigo）
```

`color` は `settings.html` でユーザーが選ぶ。`holderColor(name)` で Tailwind クラスを返す。

#### 4-4-2. upload_history（明細アップロード履歴）

```
id                          アップロードID
uploaded_at                 アップロード日時
file_name                   ファイル名
file_type                   ファイル種別（PDF/CSV）
source                      情報源（カード会社名、銀行名など）
period_from                 明細期間の開始
period_to                   明細期間の終了
status                      ステータス（処理中/処理済/エラー）
detected_count              検出された取引数
```

#### 4-4-3. raw_transactions（明細生データ）

```
id                          取引ID（例：trans_001）
upload_id                   どのアップロードに含まれるか（upload_history参照）
transaction_date            取引日
description                 明細の業者名・摘要
amount                      金額
transaction_type            取引種別
source_account              口座・カード名
linked_candidate_id         紐付いた候補ID（transaction_candidates参照）
```

#### 4-4-4. transaction_candidates（AI抽出候補）

Claude Codeによる明細解析後に書き込まれ、`extraction.html` で家族が確認する。

```
id                          候補ID（例：cand_001）
upload_id                   どのアップロードに含まれるか
service_name                推定サービス名
raw_description             明細の原文
monthly_amount              推定月額
billing_cycle               請求サイクル
category_guess              推定カテゴリ
status                      ステータス（未登録/登録済/スキップ）
registered_to               登録後の項目ID（cash_flowのid）
```

### 4-5. 名義人の参照方式

`contract_holder_id`・`account_holder_id`・`insured_person_id`・`beneficiary_id`・`holder_id`・`debtor_id`・`subject_id` は **`family_member.display_name` を文字列で格納**（IDではなく表示名で参照）。入力UIはプルダウンで登録済みメンバーから選ぶ（`family_select` フィールドタイプ）。

### 4-6. idの採番

- 項目シート：`${idPrefix}_${String(既存件数+1).padStart(3, '0')}`（例：`cash_001`）
- family_member：`fm_${Date.now()}`

### 4-7. シート間の関係

```
[family_member]
       ↑
       | 各種holder_id・subject_id（表示名で参照）
       |
[cash_flow, bank_account, insurance, securities, crypto,
 real_estate, precious_metal, loan, contact_network, medical_info]
       
[transaction_candidates] → 確認後に [cash_flow] に登録
       ↑
[raw_transactions]
       ↑
[upload_history]
```

---

## 5. 技術構成

### 5-1. 全体構成

```
【Webアプリ】（ブラウザだけで動く静的サイト）
  HTML + Alpine.js + Tailwind CSS（すべてCDN）
  - 入力（フォーム、ファイルアップロード）
  - 表示（スプシのデータをUIで見せる）
  - 編集（スプシのデータを書き換え）

          ↓↑（Google APIs）

【Googleスプシ】（データの実体）
  Sheets API v4 で直接読み書き

          ↑（Claude Codeで自動解析、Webアプリの外側で実行）

【Google Drive】（明細ファイルの保管庫）
  Drive API でPDF/CSVを保存
```

### 5-2. JSファイル構成

| ファイル | 役割 |
|---------|------|
| `js/config.js` | Google OAuth Client ID・API Key・localStorage操作 |
| `js/auth.js` | Google OAuth フロー・トークン管理 |
| `js/sheets.js` | Sheets API ラッパー（getSheet/appendRow/updateRow/deleteRow/ensureHeader） |
| `js/schema.js` | COMMON_COLS・PERSPECTIVES・SHEETS・GROUPS・holderColor等の定義 |
| `js/picker.js` | Google Drive Picker（setup.htmlで既存スプシを選ぶ） |

### 5-3. localStorageのキー

| キー | 用途 |
|-----|------|
| `sz_spreadsheet_id` | スプシID（必須）。未設定なら `setup.html` へ誘導 |
| `sz_drive_folder` | Drive フォルダID（明細保管先） |
| `sz_drive_folder_name` | Drive フォルダ名（表示用） |
| `sz_spreadsheet_name` | スプシ名（表示用） |

### 5-4. 認証

- Google OAuth（GSI：Google Sign-In for Web）
- スコープ：`https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file`
- `js/auth.js` の `initAuth(onSuccess, onFail)` を各ページから呼ぶ
- 認証済みのまま `setup.html` → `dashboard.html` へ遷移する（再ログイン不要）

### 5-5. シート初期化（setup.html）

`setup.html` が行うこと：
1. 新規スプシ作成 or 既存選択（Drive Picker or 手動ID入力）
2. 必要シートを一括作成（存在する場合はスキップ）
3. 全シートのヘッダーを書き込み（既存データは消えない）
4. `cash_flow` が空なら5件のサンプルデータを投入
5. `transaction_candidates` が空ならサンプル候補データを投入

---

## 6. js/schema.js の構造詳細

実装の中核。追加・修正時は必ずここを参照・更新すること。

### 6-1. SHEETSオブジェクト

各シートを `SHEETS[sheetKey]` で参照。以下のフィールドを持つ：

```js
{
  label: 'サブスク・支払い',      // 表示名（一覧のタブ、絞込チップなど）
  group: '支出・収入',            // 所属グループ名（add-item, item-listで使用）
  idPrefix: 'cash',               // ID採番のprefix
  noPerspectives: true,           // （オプション）もしもの時シートのみ。4観点なし2値ステータス
  cols: [...],                    // 固有カラム名リスト（共通12列は含まない）
  formFields: [...],              // add-item.htmlのフォーム定義
  name: r => ...,                 // 項目の表示名を返す関数
  statusTag: r => ...,            // 状態バッジ（継続中はnull、解約予定など）を返す関数
  sub: r => ...,                  // 簡易表示のサブテキスト
  infoCards: r => [...],          // item-detail.htmlの基本情報カード
  holders: r => [...],            // 名義人リスト（{ role, name } の配列）
  headerTag: r => ...,            // （オプション）一覧ヘッダーの種別タグ
  estimatedAmount: r => ...,      // （オプション）評価額・概算の整形済み文字列
  subType: r => ...,              // （オプション）サブタイプ文字列
  expandedExtras: r => [...],     // （オプション）一覧展開時に表示する追加フィールド
}
```

### 6-2. formFields の type

| type | 用途 |
|------|------|
| `text` | テキスト入力 |
| `number` | 数値入力 |
| `select` | セレクトボックス（`options: [...]` 必須） |
| `family_select` | family_memberのdisplay_nameリストから選ぶプルダウン |

### 6-3. statusTagのnorm値

`filterStatus` フィルターと対応：

| norm | 意味 | フィルター |
|------|------|---------|
| `null`（statusTag自体がnull） | 継続中・メイン・保有中など | `active` |
| `'active'` | 継続中だがサブ口座・保証中など | `active` |
| `'closing'` | 解約予定・完済予定など | `closing` |
| `'closed'` | 解約済・休眠・完済・売却済など | `closed` |

### 6-4. noPerspectivesシートの doneCount

```js
function doneCount(row, sheetKey) {
  const key = sheetKey || row._sheetKey;
  if (SHEETS[key]?.noPerspectives) {
    return row.q1_existence_status === '完了' ? 1 : 0;
  }
  return PERSPECTIVES.filter(p => row[p.statusCol] === '完了').length;
}

function perspectiveMax(sheetKey) {
  return SHEETS[sheetKey]?.noPerspectives ? 1 : PERSPECTIVES.length;
}
```

---

## 7. 残っている論点

### 7-1. q1（存在の把握）の扱い（通常シート）

通常シートでは q1 はスキーマ上は存在するが進捗計算から外れている。item-detail.htmlでは「全編集」モーダル経由で編集可能。今後、q1も進捗に含めるかどうかは要検討。含める場合は `PERSPECTIVES` 配列に追加するだけでよい。

### 7-2. ダッシュボードの進捗集計

現状は `cash_flow` のみを集計している。`bank_account`・`insurance`・その他シートを加えたダッシュボードへの拡張が必要。グループ別進捗カードも各グループのシートを全取得して合算する形に変更予定。

### 7-3. TODO一覧（元設計の画面I）

未実装。「整えるべきタスクの一覧」。観点がq2/q3/q4で「未確認」のものを横断的に一覧表示し、優先度付け・担当割り当てができる画面。

### 7-4. のこすもの グループの実装

未実装。意思・希望、法的書類などのシート設計・実装。実際に運用しながら詳細設計を固める。

### 7-5. 事業化（将来の論点）

- ターゲット家族像の具体化
- 価格設定（雑談ベースでは月1〜3万円、入口商品は月数千円という仮説あり）
- 稼働構造
- 集客（守成クラブ、Facebook、tlife.infoでの情報発信）
- 法的・契約上の論点（守秘義務、データの取り扱い）

---

## 8. 設計原則のまとめ

1. **「家族が動ける状態を作る」がゴール**：情報の記録自体ではない
2. **明細から取れる情報はヒアリングしない**：機械でできることは機械に任せる
3. **他のカテゴリで取れる情報は重複して聞かない**：データの正規化
4. **自由記述は最後の手段、まずは選択肢化を試みる**：ユーザーの負担を減らす
5. **「ないと困る」を逆算して質問を作る**：網羅性のための網羅ではなく、用途のための質問
6. **「情報がない」ことを記録する選択肢を作らない**：「特になし」「分からない」のチェックは無価値
7. **質問の置き場所は、意思決定の単位に合わせる**：個別項目で聞くべきことと、全体で聞くべきことを区別
8. **「思い出すのに時間が必要な情報」は、質問ではなくメモ欄で拾う**：強制的に答えさせない
9. **情報を記録するのではなく、実物を集約する**：場所を1つに絞る
10. **サービスが「やる必要のあること」と、本人・家族が「自分でやればいいこと」を混同しない**
11. **サービスの主体（寺内さん）と、ヒアリングの主体（家族）を混同しない**
12. **項目立てするものと、メモで自由に残すものを区別する**

---

## 付録：用語集

- **項目**：1つのサブスク、1つの銀行口座、1つの保険商品など、データの最小単位
- **項目タイプ**：項目の種類（サブスク、銀行口座、保険商品など）
- **グループ**：項目タイプを束ねるカテゴリ（4グループ）
- **観点**：「家族が動ける状態」を確認する視点（通常シートは中身・アクセス・緊急の3つ、noPerspectivesシートは完了/未確認の2値）
- **noPerspectives**：4観点を持たないシート（もしもの時グループ）。q1の完了/未確認のみでステータス管理
- **家族プロジェクト型**：本サービスのポジショニング、家族を主役にした伴走モデル
- **sheetKey**：コード上のシート識別子（例：`cash_flow`, `bank_account`, `insurance`）
- **idPrefix**：ID採番の先頭文字列（cash, bank, ins, sec, crypto, re, metal, loan, contact, med）
