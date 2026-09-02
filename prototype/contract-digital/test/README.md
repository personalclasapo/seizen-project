# 契約・デジタル：テスト

プロトタイプに package.json / テストランナーはまだ無い。各テストは
素の `node` で走る。本番のビルド構成が決まったら Vitest 等へ移植する。

## payment/test/pipeline.test.js

「支払い明細から探す」の判定パイプライン（正規化 → 系列化 → 判定 →
照合 → 登録）の全経路。**依存ゼロ。**

```
cd payment/test && node pipeline.test.js
```

fixture は `設計/支払い明細から探す/` の 3 本（通常・caseA・caseB）。

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
制御できる storage を差し込んでいる（永続・旧スキーマ読み込みの
検証でページ間共有するため）。

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
