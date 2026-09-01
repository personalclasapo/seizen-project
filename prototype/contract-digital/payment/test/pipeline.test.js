/* 支払い明細から探す：判定パイプラインの全経路テスト
   ------------------------------------------------------------------
   実行：  node pipeline.test.js       （このディレクトリで）
   終了コード 0 = 全通過 / 1 = 失敗あり。

   依存ゼロの素の node スクリプト。payment/*.js は window グローバルに
   自身を生やす IIFE なので、global.window を張ってから require する。
   契約・デジタルの state.js は重いので、reconcile / register が使う
   最小 API だけのスタブ（makeContractStub）に差し替える。

   本番のビルド構成（Vitest 等）が決まったら、この check() を
   expect() に、各ブロックを it() に置き換えるだけで移植できる。

   fixture の CSV は 設計/支払い明細から探す/ の 3 本（通常・caseA・
   caseB）。それぞれ別の想定結果を持つ（README 相当は設計文書）。
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const PDIR = path.join(__dirname, '..') + path.sep;
const CSVDIR = path.join(__dirname, '..', '..', '..', '..', '設計', '支払い明細から探す') + path.sep;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

/* 契約・デジタルの state.js の代わりに、テストごとに差し替えられる
   最小スタブ。items だけ持てば reconcile / register は動く。 */
function makeContractStub(initialItems) {
  const items = (initialItems || []).map(x => Object.assign({}, x));
  return {
    items,
    get _items() { return items; },
    commitFromStatement(records) {
      const seen = new Set(items.map(it => it.name.trim().toLowerCase()));
      const seenId = new Set(items.map(it => it.id));
      const added = [], skipped = [];
      (records || []).forEach(rec => {
        const name = String(rec.name || '').trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) { skipped.push(rec.name); return; }
        const id = (rec.service_id && !seenId.has(rec.service_id)) ? rec.service_id : ('svc-new-' + (items.length + 1));
        seen.add(key); seenId.add(id);
        const it = { id, name, group: rec.group, category: rec.category, domain: rec.domain,
          contract: Object.assign({ source: 'statement' }, rec.contract) };
        if (rec.plan_id) it.plan_id = rec.plan_id;
        items.push(it);
        added.push(name);
      });
      return { added, skipped };
    },
    applyPaymentMethodChange(rec) {
      const it = (rec.service_id && items.find(i => i.id === rec.service_id)) ||
                 items.find(i => i.name.trim().toLowerCase() === String(rec.name || '').trim().toLowerCase());
      if (!it) return false;
      it.contract = it.contract || {};
      it.contract.paymentCard = (rec.contract || {}).paymentCard || null;
      return true;
    }
  };
}

function freshModules(contractStub) {
  Object.keys(require.cache).forEach(k => { if (k.includes('/payment/')) delete require.cache[k]; });
  global.window = global;
  global.SeiZenCatalog = { categoryFor: () => '未分類' };
  global.SeiZenContract = contractStub || makeContractStub([]);
  ['master.js','resolver.js','series.js','judge.js','reconcile.js','register.js','source/vpass.js','pipeline.js']
    .forEach(f => require(PDIR + f));
  return {
    Pipeline: global.SeiZenPaymentPipeline,
    Master: global.SeiZenPaymentMaster,
    Vpass: global.SeiZenSourceVpass,
    Contract: global.SeiZenContract
  };
}

function analyze(csv, opts) {
  return global.SeiZenPaymentPipeline.analyze(csv, Object.assign({ adapter: 'vpass' }, opts || {}));
}
const cand = (r, name) => r.candidates.find(c => c.merchant_name === name || (c.series && c.series.merchant_raw === name));
const dropped = (r, raw) => r.report.series.find(s => s.merchant_raw === raw && s.status === 'drop');

/* ════════════════════════════════════════════════════════════════
   1. 異常系 CSV（§6-1・形式エラー）
   ════════════════════════════════════════════════════════════════ */
console.log('\n■ 1. 異常系 CSV');
{
  freshModules();

  // 1a. 空CSV
  check('空CSV → ok:false', analyze('').ok === false);

  // 1b. ヘッダーのみ
  check('ヘッダー行のみ → ok:false', analyze('請求月,ご利用日,ご利用店名,ご利用金額,支払区分\n').ok === false);

  // 1c. 必須列欠落
  const r1c = analyze('請求月,ご利用日,ご利用店名,ご利用金額\n2026-03,2026/03/12,NETFLIX.COM,1590\n');
  check('必須列（支払区分）欠落 → ok:false かつメッセージに列名', r1c.ok === false && /支払区分/.test(r1c.error), r1c.error);

  // 1d. 対応外アダプタ
  check('未対応アダプタ → ok:false', analyze('a\nb', { adapter: 'nanko' }).ok === false);

  // 1e. 請求月が飛んでいる → coverage underivable、判定は通る
  const gap = [
    '請求月,ご利用日,ご利用店名,ご利用金額,支払区分,今回回数,お支払い金額,備考',
    '2026-03,2026/03/12,NETFLIX.COM,1590,1,,1590,◎',
    '2026-05,2026/05/12,NETFLIX.COM,1590,1,,1590,◎',   // 4月が無い
    '2026-06,2026/06/12,NETFLIX.COM,1590,1,,1590,◎',
    '2026-07,2026/07/12,NETFLIX.COM,1590,1,,1590,◎'
  ].join('\n');
  const rgap = analyze(gap);
  check('請求月に欠損 → coverage_status underivable', rgap.ok && rgap.coverage.coverage_status === 'underivable',
    JSON.stringify(rgap.coverage));
  /* 4点しかなく 1本 61日ギャップ → classifyCycle は保守的に single 判定
     （短い系列は全 gap 帯内を要求）。既知マスタでも cycle=single では
     shape 一致せず破棄。これは設計意図（本物の契約は全 gap 帯内）通り。 */
  check('請求月欠損＋短系列 → 保守的に破棄（Netflix 候補に出ない）',
    rgap.ok && !cand(rgap, 'Netflix') && dropped(rgap, 'NETFLIX.COM'),
    JSON.stringify(rgap.report.series.filter(s => /NETFLIX/i.test(s.merchant_raw))));

  // 1f. 全行が分割払い → transactions 0 → candidates 空だが ok
  const allInst = [
    '請求月,ご利用日,ご利用店名,ご利用金額,支払区分,今回回数,お支払い金額,備考',
    '2026-03,2026/03/05,BIC CAMERA,66000,3,1,22000,◎',
    '2026-04,2026/03/05,BIC CAMERA,66000,3,2,22000,◎'
  ].join('\n');
  const rai = analyze(allInst);
  check('全行分割払い → ok:true / candidates 空', rai.ok && rai.candidates.length === 0);
  check('  除外統計に installment 計上', rai.report.adapter.stats.excluded_installment === 2,
    JSON.stringify(rai.report.adapter.stats));

  // 1g. マイナス額のみ（返金）
  const neg = [
    '請求月,ご利用日,ご利用店名,ご利用金額,支払区分,今回回数,お支払い金額,備考',
    '2026-03,2026/03/19,AMAZON.CO.JP,-3980,1,,-3980,返品'
  ].join('\n');
  const rneg = analyze(neg);
  check('マイナス額のみ → 除外され candidates 空', rneg.ok && rneg.candidates.length === 0 &&
    rneg.report.adapter.stats.excluded_nonpositive === 1);

  // 1h. BOM 有無どちらも通る
  const body = 'ご利用日,請求月,ご利用店名,ご利用金額,支払区分,今回回数,お支払い金額,備考\n' +
    ['2026/03/12,2026-03,NETFLIX.COM,1590,1,,1590,◎',
     '2026/04/12,2026-04,NETFLIX.COM,1590,1,,1590,◎',
     '2026/05/12,2026-05,NETFLIX.COM,1590,1,,1590,◎'].join('\n');
  check('BOM なし → ok:true', analyze(body).ok);
  check('BOM あり → ok:true', analyze('﻿' + body).ok);
}

/* ════════════════════════════════════════════════════════════════
   2. 判定の派生経路（bimonthly / C「分からない」/ resolver 失敗）
   ════════════════════════════════════════════════════════════════ */
console.log('\n■ 2. 判定の派生経路');
{
  freshModules();

  // 2a. bimonthly の明確なケース（水道を隔月で 4 回）
  const bim = ['請求月,ご利用日,ご利用店名,ご利用金額,支払区分,今回回数,お支払い金額,備考'];
  ['2026-03,2026/03/10', '2026-05,2026/05/10', '2026-07,2026/07/10', '2026-09,2026/09/10']
    .forEach(p => bim.push(p + ',YOKOHAMA WATERWORKS,4800,1,,4800,◎'));
  const rbim = analyze(bim.join('\n'));
  const wc = cand(rbim, '横浜市水道局');
  check('隔月 x4 → 横浜市水道局 候補あり', !!wc);
  check('  cycle == bimonthly', wc && wc.series.cycle === 'bimonthly', wc && wc.series.cycle);
  check('  status == A（従量・金額照合しない）', wc && wc.status === 'A', wc && wc.status);

  // 2b. resolver スタブで解決できない継続課金 → C
  const unk = ['請求月,ご利用日,ご利用店名,ご利用金額,支払区分,今回回数,お支払い金額,備考'];
  ['2026-03,2026/03/08', '2026-04,2026/04/08', '2026-05,2026/05/08', '2026-06,2026/06/08']
    .forEach(p => unk.push(p + ',MYSTERY SUBSCRIPTION,3300,1,,3300,◎'));
  const runk = analyze(unk.join('\n'));
  const mc = cand(runk, 'MYSTERY SUBSCRIPTION');
  check('未知の継続課金（月次 x4）→ C', mc && mc.status === 'C', mc && mc.status);
  check('  service_id は null（マスタにない）', mc && mc.service_id === null);
  check('  response_timing は null（ユーザー入力待ち）', mc && mc.response_timing === null);
  check('  report の resolution に「解決失敗」が載る',
    runk.report.resolution.some(x => x.merchant_raw === 'MYSTERY SUBSCRIPTION' && x.resolved === false),
    JSON.stringify(runk.report.resolution));

  // 2c. B 選択 → resolveChoice で A 昇格
  freshModules();
  const csvB = fs.readFileSync(CSVDIR + 'SeiZen_sample_vpass_6months_2026-03_to_08_caseB.csv', 'utf8');
  const rB = analyze(csvB, { paymentMethodId: 'card-test' });
  const appleB = cand(rB, 'Apple');
  check('caseB: Apple ¥980 → B', appleB && appleB.status === 'B', appleB && appleB.status);
  if (appleB) {
    const chosen = global.SeiZenPaymentPipeline.resolveChoice(appleB, 'svc-apple-music');
    check('  B で Apple Music を選ぶ → status A', chosen.status === 'A', chosen.status);
    check('  service_id = svc-apple-music', chosen.service_id === 'svc-apple-music');
    check('  response_timing が付く（pre）', chosen.response_timing === 'pre', chosen.response_timing);

    // 2d. B で「その他」→ C 化
    const other = global.SeiZenPaymentPipeline.resolveChoice(appleB, 'other');
    check('  B で「その他」→ status C', other.status === 'C', other.status);
    check('  service_id null / timing null', other.service_id === null && other.response_timing === null);
  }
}

/* ════════════════════════════════════════════════════════════════
   3. 既登録との照合（§11・§13-2）
   ════════════════════════════════════════════════════════════════ */
console.log('\n■ 3. 既登録との照合');
{
  const baseCsv = fs.readFileSync(CSVDIR + 'SeiZen_sample_vpass_6months_2026-03_to_08.csv', 'utf8');

  // 3a. 同一サービス・同一支払い手段で既登録 → registered（チェック不可）
  const stub3a = makeContractStub([
    { id: 'svc-netflix', name: 'Netflix', contract: { paymentCard: 'card-A' } }
  ]);
  freshModules(stub3a);
  const r3a = analyze(baseCsv, { paymentMethodId: 'card-A' });
  const nf = cand(r3a, 'Netflix');
  check('同一service・同一支払い手段 → status registered', nf && nf.status === 'registered', nf && nf.status);

  // 3b. 同一サービス・別の支払い手段 → payment_method_change
  const stub3b = makeContractStub([
    { id: 'svc-netflix', name: 'Netflix', contract: { paymentCard: 'card-OLD' } }
  ]);
  freshModules(stub3b);
  const r3b = analyze(baseCsv, { paymentMethodId: 'card-NEW' });
  const nf2 = cand(r3b, 'Netflix');
  check('同一service・別支払い手段 → payment_method_change フラグ', nf2 && nf2.payment_method_change === true,
    nf2 && JSON.stringify({ status: nf2.status, pmc: nf2.payment_method_change }));
  check('  status は A のまま（候補から消えない・§11末尾）', nf2 && nf2.status === 'A');
  check('  previous_payment_method_id = card-OLD', nf2 && nf2.previous_payment_method_id === 'card-OLD');

  // 3c. commit：registered はスキップ、change は updated、新規は added
  const stub3c = makeContractStub([
    { id: 'svc-netflix', name: 'Netflix', contract: { paymentCard: 'card-NOW' } },  // 同一→registered
    { id: 'svc-spotify', name: 'Spotify', contract: { paymentCard: 'card-OLD' } }   // 別→change
  ]);
  freshModules(stub3c);
  const r3c = analyze(baseCsv, { paymentMethodId: 'card-NOW' });
  const selNetflix = cand(r3c, 'Netflix');
  const selSpotify = cand(r3c, 'Spotify');
  const selIcloud  = cand(r3c, 'Apple');   // 新規（¥150 → iCloud+ 50GB）
  check('  Netflix=registered / Spotify=change / Apple(¥150)=A',
    selNetflix.status === 'registered' && selSpotify.payment_method_change === true && selIcloud.status === 'A',
    JSON.stringify({ n: selNetflix.status, s: selSpotify.payment_method_change, a: selIcloud.status }));

  const out = global.SeiZenPaymentPipeline.commit([
    { candidate: selSpotify },
    { candidate: selIcloud }
  ], { paymentMethodId: 'card-NOW', holderName: '父 太郎' });
  check('  commit: Spotify は updated に', out.updated.indexOf('Spotify') !== -1, JSON.stringify(out));
  check('  commit: iCloud+ 50GB は added に', out.added.some(n => /iCloud/.test(n)), JSON.stringify(out.added));
  check('  Spotify の支払い手段が card-NOW に更新された',
    stub3c.items.find(i => i.id === 'svc-spotify').contract.paymentCard === 'card-NOW');

  // 3d. 同名の新規（別 service_id）は skipped
  const stub3d = makeContractStub([
    { id: 'legacy-icloud', name: 'iCloud+', contract: { paymentCard: 'card-X' } }
  ]);
  freshModules(stub3d);
  const r3d = analyze(baseCsv, { paymentMethodId: 'card-Y' });
  const ic = cand(r3d, 'Apple');
  check('  ¥150 の候補は service_id=svc-icloud / 表示名 iCloud+',
    ic && ic.service_id === 'svc-icloud' && ic.merchant_name === 'Apple');
  const out3d = global.SeiZenPaymentPipeline.commit([{ candidate: ic }], { paymentMethodId: 'card-Y', holderName: '' });
  check('同名サービス（iCloud+）が既存 → skipped', out3d.skipped.some(n => /iCloud/.test(n)), JSON.stringify(out3d));

  // 3e. plan_id がエントリに記録される（表示には使わない）
  const stub3e = makeContractStub([]);
  freshModules(stub3e);
  const r3e = analyze(baseCsv, { paymentMethodId: 'card-P' });
  const ic3e = cand(r3e, 'Apple');
  check('  ¥150 系列は plan_id = pln-icloud-50 と判定', ic3e && ic3e.plan_id === 'pln-icloud-50', ic3e && ic3e.plan_id);
  global.SeiZenPaymentPipeline.commit([{ candidate: ic3e }], { paymentMethodId: 'card-P', holderName: '' });
  const item3e = stub3e.items.find(i => i.id === 'svc-icloud');
  check('  登録エントリに plan_id が残る', item3e && item3e.plan_id === 'pln-icloud-50', item3e && item3e.plan_id);
  check('  エントリの金額は明細実額 ¥150（プラン金額で上書きしない）',
    item3e && item3e.contract.amount === 150, item3e && item3e.contract.amount);
  check('  表示名はサービス名のみ（プラン名を含めない）', item3e && item3e.name === 'iCloud+', item3e && item3e.name);

  // 3f. 旧価格（Netflix ¥1,490）→ plan_id null で登録
  const stub3f = makeContractStub([]);
  freshModules(stub3f);
  const caseA = fs.readFileSync(CSVDIR + 'SeiZen_sample_vpass_6months_2026-03_to_08_caseA.csv', 'utf8');
  const r3f = analyze(caseA, { paymentMethodId: 'card-Q' });
  const nf3f = cand(r3f, 'Netflix');
  check('  Netflix ¥1,490（旧価格）→ status A / plan_id null', nf3f && nf3f.status === 'A' && nf3f.plan_id == null,
    nf3f && JSON.stringify({ s: nf3f.status, p: nf3f.plan_id }));
  global.SeiZenPaymentPipeline.commit([{ candidate: nf3f }], { paymentMethodId: 'card-Q', holderName: '' });
  const item3f = stub3f.items.find(i => i.id === 'svc-netflix');
  check('  登録エントリ: plan_id なし / 金額 ¥1,490', item3f && item3f.plan_id == null && item3f.contract.amount === 1490);
}

/* ════════════════════════════════════════════════════════════════
   4. C の対応時期「分からない」→ undecided グループ
   ════════════════════════════════════════════════════════════════ */
console.log('\n■ 4. C の対応時期「分からない」');
{
  const stub4 = makeContractStub([]);
  freshModules(stub4);
  const unk = ['請求月,ご利用日,ご利用店名,ご利用金額,支払区分,今回回数,お支払い金額,備考'];
  ['2026-03,2026/03/08', '2026-04,2026/04/08', '2026-05,2026/05/08', '2026-06,2026/06/08']
    .forEach(p => unk.push(p + ',MYSTERY SUBSCRIPTION,3300,1,,3300,◎'));
  const r4 = analyze(unk.join('\n'), { paymentMethodId: 'card-Z' });
  const c4 = cand(r4, 'MYSTERY SUBSCRIPTION');
  const out4 = global.SeiZenPaymentPipeline.commit([
    { candidate: c4, editedName: 'なぞの定期購入', chosenTiming: 'unknown' }
  ], { paymentMethodId: 'card-Z', holderName: '' });
  check('C を「分からない」で登録 → added', out4.added.indexOf('なぞの定期購入') !== -1, JSON.stringify(out4));
  const item4 = stub4.items.find(i => i.name === 'なぞの定期購入');
  check('  group == undecided（振り分け前）', item4 && item4.group === 'undecided', item4 && item4.group);
  check('  domain == contract_digital', item4 && item4.domain === 'contract_digital');
  check('  amount は明細由来の実額 3300', item4 && item4.contract.amount === 3300, item4 && item4.contract.amount);

  // 4b. C を pre で登録
  const stub4b = makeContractStub([]);
  freshModules(stub4b);
  const r4b = analyze(unk.join('\n'), { paymentMethodId: 'card-Z' });
  global.SeiZenPaymentPipeline.commit([
    { candidate: cand(r4b, 'MYSTERY SUBSCRIPTION'), editedName: 'X', chosenTiming: 'pre' }
  ], { paymentMethodId: 'card-Z', holderName: '' });
  check('  C を「いまのうち」で登録 → group pre', stub4b.items.find(i => i.name === 'X').group === 'pre');
}

/* ════════════════════════════════════════════════════════════════
   5. resolver 書き戻し（§15-2）：2 回目のアップロードで identify が引く
   ════════════════════════════════════════════════════════════════ */
console.log('\n■ 5. resolver 書き戻し（§15-2）');
{
  freshModules();
  const daznCsv = ['請求月,ご利用日,ご利用店名,ご利用金額,支払区分,今回回数,お支払い金額,備考'];
  ['2026-03,2026/03/05', '2026-04,2026/04/05', '2026-05,2026/05/05', '2026-06,2026/06/05', '2026-07,2026/07/05', '2026-08,2026/08/05']
    .forEach(p => daznCsv.push(p + ',DAZN*7F3A21,4200,1,,4200,◎'));
  const csv = daznCsv.join('\n');

  const first = analyze(csv);
  const d1 = cand(first, 'DAZN');
  check('1回目: DAZN → resolver 経由で A', d1 && d1.status === 'A', d1 && d1.status);
  check('  マスタに mch-dazn パターンが書き戻された',
    global.SeiZenPaymentMaster.MERCHANT_PATTERN.some(p => p.merchant_id === 'mch-dazn'));

  // 同一セッションで 2 回目：もう resolveUnknown を通らず identify で解決
  const second = analyze(csv);
  const d2 = cand(second, 'DAZN');
  check('2回目: DAZN → やはり A', d2 && d2.status === 'A');
  check('  2回目は resolution が空（identify で解決＝問い合わせ不要）',
    second.report.resolution.length === 0, JSON.stringify(second.report.resolution));
}

/* ════════════════════════════════════════════════════════════════
   6. payment_method（§8-1）候補から除外・非表示
   ════════════════════════════════════════════════════════════════ */
console.log('\n■ 6. payment_method（§8-1）');
{
  freshModules();
  const cardCsv = ['請求月,ご利用日,ご利用店名,ご利用金額,支払区分,今回回数,お支払い金額,備考'];
  ['2026-03,2026/03/21', '2026-04,2026/04/21', '2026-05,2026/05/21']
    .forEach(p => cardCsv.push(p + ',RAKUTEN CARD,88000,1,,88000,◎'));
  const r6 = analyze(cardCsv.join('\n'));
  check('RAKUTEN CARD → candidates に載らない', !cand(r6, 'クレジットカード（他社）') && !cand(r6, 'RAKUTEN CARD'));
  check('  payment_method_hits には出る（report/開発ログ用）',
    r6.payment_method_hits.some(h => /クレジットカード/.test(h.merchant_name)), JSON.stringify(r6.payment_method_hits));
  check('  report.series で status=payment_method',
    r6.report.series.some(s => s.status === 'payment_method'));
}

/* ════════════════════════════════════════════════════════════════
   7. out_of_scope（§8-2）保険は破棄・通知しない
   ════════════════════════════════════════════════════════════════ */
console.log('\n■ 7. out_of_scope（§8-2）');
{
  freshModules();
  const insCsv = ['請求月,ご利用日,ご利用店名,ご利用金額,支払区分,今回回数,お支払い金額,備考'];
  ['2026-03,2026/03/23', '2026-04,2026/04/23', '2026-05,2026/05/23']
    .forEach(p => insCsv.push(p + ',SOMPO JAPAN,4230,1,,4230,◎'));
  const r7 = analyze(insCsv.join('\n'));
  check('SOMPO JAPAN → candidates に載らない', !cand(r7, '損保ジャパン'));
  check('  payment_method_hits にも出ない', !r7.payment_method_hits.some(h => /損保/.test(h.merchant_name)));
  check('  report で drop / out_of_scope', dropped(r7, 'SOMPO JAPAN') && dropped(r7, 'SOMPO JAPAN').drop_reason === 'out_of_scope');
}

/* ════════════════════════════════════════════════════════════════
   結果
   ════════════════════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(50));
console.log(`  PASS ${pass}  /  FAIL ${fail}`);
console.log('═'.repeat(50));
process.exit(fail ? 1 : 0);
