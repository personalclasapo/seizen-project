# 契約・デジタル：テスト

プロトタイプに package.json / テストランナーはまだ無い。各テストは
素の `node` で走る。本番のビルド構成が決まったら Vitest 等へ移植する。

## payment/test/pipeline.test.js

「支払い明細から探す」の判定パイプライン（正規化 → 系列化 → 判定 →
照合 → 登録）と、**汎用 明細CSVアダプタ**（会社を問わず列の意味を
推定して読む・`payment/source/statement-csv.js`）の全経路。**依存ゼロ。**

```
cd payment/test && node pipeline.test.js
```

fixture は `設計/支払い明細から探す/`：
- `SeiZen_sample_vpass_6months_2026-03_to_08.csv` … 三井住友カード実形式
  （ヘッダーなし・11列・先頭にカード情報行・末尾に合計行・UTF-8）
- `..._caseA.csv` / `..._caseB.csv` … 同形式の別ケース
- `..._sjis.csv` … 通常CSVの Shift-JIS(CP932) 版（実CSVの文字コード）
- `SeiZen_sample_rakuten_6months_2026-03_to_08.csv` … 楽天カード実形式
  （ヘッダーあり・10列・全項目クオート・UTF-8 BOM）

テスト内では、セゾン・三菱UFJニコス・海外利用の補足行・金額列の
トラップ（支払総額 vs 利用金額）等を文字列で組み立てて、汎用アダプタが
すべて読めることを検証する。`vpassCsv([...])` ヘルパーは三井住友カード
実形式（ヘッダーなし11列）の合成CSVを作る。

## test/payment-methods.test.js

支払い手段の一元化（`state.js` の `paymentMethods`）と、明細確認の
記録（`markStatementChecked`）の全経路。`render.js` / `extraction.js`
を実際に DOM 上で走らせて出力を検証するので **jsdom が要る。**

```
# jsdom を入れる（いずれか）
npm i -g jsdom
#   または任意の場所へ： npm i jsdom --prefix /tmp/jsdom

cd test && NODE_PATH=<jsdom のある node_modules> node payment-methods.test.js
#   グローバル導入なら NODE_PATH 不要
```

file:// では jsdom が sessionStorage を持たないため、テスト側で
制御できる storage を差し込んでいる（永続・再構築の検証でページ間
共有するため）。

## 永続化の形（本番に寄せた構造）

`state.js` は seed（マスタ＋工場出荷データ）を**保存しない**。保存する
のは「本番でサーバに POST するもの」だけ（sessionStorage の
`seizen.contract.v2` に patch 形式で）：
- `addedItems` … ユーザーが追加した契約
- `itemEdits` … seed 契約への編集を id ごとに変更フィールドだけ
- `methodEdits` … 支払い手段への編集（`statement_checked` など）
- `addedMethods` … ユーザーが追加した支払い手段（稀）

ロード時に seed（コード）＋ patch で `items` / `paymentMethods` を
組み立てる。→ seed のスキーマを変えてもリロードで即反映され、保存と
衝突しない（旧 v1 の「seed 丸ごと保存」は破棄）。

CP932 の fixture（`..._sjis.csv`）は UTF-8 版を Shift-JIS に
エンコードしたもの。無ければ pipeline.test.js の該当ケースが
失敗する。生成：
```
npm i iconv-lite --prefix /tmp/iconv
NODE_PATH=/tmp/iconv/node_modules node -e "
  const fs=require('fs'),iconv=require('iconv-lite');
  let s=fs.readFileSync('設計/支払い明細から探す/SeiZen_sample_vpass_6months_2026-03_to_08.csv','utf8').replace(/^﻿/,'');
  fs.writeFileSync('設計/支払い明細から探す/SeiZen_sample_vpass_6months_2026-03_to_08_sjis.csv', iconv.encode(s,'shift_jis'));
"
```

## 明細形式について（実物調査の記録）

実CSVは会社ごとに列名・列順・列数・文字コードがバラバラ（felica2money の
CSV ルールと、三井住友カード公式ヘルプのスクリーンショットで確認）：

| 会社 | ヘッダー | 列 | 文字コード | 備考 |
|---|---|---|---|---|
| 三井住友カード（Vpass） | なし | 11（位置で判別）| Shift-JIS / CRLF | 先頭にカード情報行、末尾に合計行、複数カードはブロックが繰り返す |
| 楽天カード | あり | 10 | UTF-8 BOM | 全項目クオート、「現地利用額…」の補足行あり |
| セゾン / 出光 | あり | 7 | — | `利用日,ご利用店名及び商品名,…` |
| UC / 三菱UFJニコス / イオン 等 | あり | 会社ごと | — | いずれも「請求月」列は持たない |

共通するのは「利用日・店名・金額・（多くが）支払区分/回数」の**意味**だけ。
どの会社も「請求月」を列に持たない → 対象期間は利用日の最小〜最大から導く。

**会社別アダプタは持たない。** 汎用アダプタ（`payment/source/statement-csv.js`）
1本が、CSVの中身（ヘッダー名のキーワード＋値の形＝日付らしさ・数値らしさ・
ユニーク値の割合）から利用日・金額・店名の列を推定する。文字コード判定
（UTF-8 厳格 → Shift-JIS）も汎用アダプタが吸収。支払い手段の
`statement_format` は `'card_csv'`（カード明細＝取り込み可）か `null`
（銀行・電子マネー＝構造が違うため未対応）の2値のみ（§15-4）。
