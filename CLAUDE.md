# 生前整理サービス — CLAUDE.md

このファイルはClaude Codeが実装判断に使う設計書。詳細な背景は `seizen-project_design.md` を参照。

---

## サービス概要

**ゴール：家族が動ける状態を作ること**（情報を記録することが目的ではない）

- ターゲット：家族（子世代40〜50代）が主役。親世代の情報を家族と整理する
- 提供形式：寺内さん（サービス提供者）が家族に伴走するBtoBtoCモデル
- 将来的に事業化予定。現在は寺内さん家での実証フェーズ

**差別化**：既存の生前整理（葬儀・法的書類中心）ではなく、お金・契約・デジタルが中心。家族と継続関係で運用を回す。

---

## 技術スタック

- **フロントエンド**：HTML + Alpine.js + Tailwind CSS（CDN）
- **データ**：Google Sheets API（1家族 = 1スプレッドシート）
- **ストレージ**：Google Drive API（明細PDFの保管）
- **認証**：Google OAuth（GSI）
- **ホスティング**：GitHub Pages等の静的ホスティング（サーバーなし）
- **デザイントーン**：ベージュ系（`bg-[#FAF7F0]`）＋グリーン（`#4A7C59`）

スプレッドシートIDは `localStorage('sz_spreadsheet_id')` に保存。初回ログイン時に未設定なら `setup.html` へ誘導する。`config.js` のハードコードIDは空文字（フォールバックなし）。

---

## 画面構成（現状）

| ファイル | 画面 | 状態 |
|---------|------|------|
| `index.html` | ログイン | 実装済み。認証後、スプシ未設定→setup、設定済み→dashboard |
| `setup.html` | 初回セットアップ | 実装済み。新規作成 or 既存選択→シート初期化→dashboard |
| `dashboard.html` | ダッシュボード | 実装済み。全体進捗・グループ別進捗・明細候補のバナー |
| `item-list.html` | 項目一覧 | 実装済み。シート別一覧・4観点アイコン表示 |
| `all-items.html` | 全項目一覧 | 実装済み。全シートを横断した一覧 |
| `item-detail.html` | 項目詳細 | 実装済み。4観点編集・基本情報編集・削除 |
| `upload.html` | 明細アップロード | 実装済み。PDF/CSVをDriveに保存 |
| `extraction.html` | 明細抽出結果 | 実装済み。transaction_candidatesの確認・登録 |
| `settings.html` | 設定 | 実装済み。家族メンバーの追加・名前編集・色設定・削除のみ |

**未実装**：TODO一覧（画面I）、項目追加フロー（画面G）

ボトムナビ（ホーム・全項目・設定）は全画面に共通。

---

## データ設計

### シート一覧

| シート名 | 用途 |
|---------|------|
| `cash_flow` | 支出・収入（サブスク、公共料金、年金など） |
| `bank_account` | 銀行口座 |
| `insurance` | 保険商品 |
| `family_member` | 家族メンバーマスター |
| `upload_history` | 明細アップロード履歴 |
| `raw_transactions` | 明細の生データ |
| `transaction_candidates` | AI抽出した定期支払い候補 |

### 共通カラム（全項目シート）

```
id, created_at, updated_at
q1_existence_status, q1_existence_content    （観点1: 存在の把握）
q2_understanding_status, q2_understanding_content  （観点2: 中身の理解）
q3_access_status, q3_access_content         （観点3: アクセス・操作）
q4_emergency_status, q4_emergency_content   （観点4: 緊急時の手順）
free_memo
```

status値：`完了` / `未確認` / `該当なし`

### cash_flow 固有カラム

```
service_name, service_category, cash_flow_type
contract_holder_id, billing_cycle, billing_amount
monthly_amount, payment_method, status
input_source, source_transaction_id, plan
```

### bank_account 固有カラム

```
bank_name, branch_name, account_type
account_number, account_holder_id
account_status, net_banking_usage
```

### insurance 固有カラム

```
insurance_company, product_name, insurance_type
policy_number, contract_holder_id, insured_person_id
beneficiary_id, insurance_amount, payment_status
maturity_date, account_status
```

### family_member カラム

```
id, display_name, role, note, color
```

`color` は設定画面でユーザーが選ぶ色キー（`blue` / `rose` / `green` / `amber` / `purple` / `teal` / `orange` / `indigo`）。

### 契約者・名義人の参照方式

`contract_holder_id`・`account_holder_id`・`insured_person_id`・`beneficiary_id` は `family_member.display_name` を文字列で格納する（IDではなく表示名で参照）。入力UIはプルダウンで登録済みメンバーから選ぶ。

### holderColorの仕組み

`js/schema.js` の `loadFamilyMembers()` でfamily_memberシートを読み込み、`display_name → color` のマップを構築。`holderColor(name)` でTailwindクラスを返す。各画面はロード時に `getSheet('family_member')` を呼んで `loadFamilyMembers()` を実行する。

---

## 4観点フレームワーク

すべての項目に共通で当てるフレームワーク：

1. **存在の把握**：この項目があることを家族が知っているか
2. **中身の理解**：何のためにあるか、本人の意思は何か
3. **アクセス・操作**：家族がアクセス・解約・変更できるか
4. **緊急時の手順**：いざという時に家族が動くための手順が明確か

---

## 設計原則（実装判断の基準）

1. 情報を記録することがゴールではない。「家族が動ける状態を作る」がゴール
2. 明細から取れる情報はヒアリングしない
3. 他のカテゴリで取れる情報は重複して聞かない
4. 自由記述は最後の手段。まず選択肢化を試みる
5. 「ないと困る」を逆算して質問を作る（網羅のための網羅をしない）
6. すべてを構造化された項目にしなくていい。メモ欄で拾えるものはメモで

---

## 今後追加予定のシート（未実装）

証券・投資、暗号資産、不動産、貴金属、借入・保証、医療情報、人間関係（訃報リスト等）、意思・希望、法的書類。いずれも「共通カラム12 + 固有カラム」の構造を踏襲する。

---

## コミット・プッシュ

コード変更後は確認なしで `git commit` & `git push origin main` を実行する。
