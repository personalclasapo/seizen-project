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
  ['master.js','resolver.js','series.js','judge.js','reconcile.js','register.js','source/statement-csv.js','pipeline.js']
    .forEach(f => require(PDIR + f));
  return {
    Pipeline: global.SeiZenPaymentPipeline,
    Master: global.SeiZenPaymentMaster,
    Adapter: global.SeiZenSourceStatementCsv,
    Contract: global.SeiZenContract
  };
}

function analyze(csv, opts) {
  return global.SeiZenPaymentPipeline.analyze(csv, opts || {});
}

/* 三井住友カード（Vpass）実形式（ヘッダーなし11列・先頭カード情報行・
   末尾合計行）の CSV を、明細行の配列（[利用日, 店名, 金額, 支払区分,
   回数, 備考]）から組み立てる。汎用アダプタが列を推定できることの
   検証にも使う（＝会社別の決め打ちをしていない）。 */
function vpassCsv(rows) {
  const out = ['VPASSガイド 様,4980-XXXX-XXXX-1234,,SMBCCARDクラシック☆,,,,,,,'];
  let total = 0;
  for (const [date, shop, amt, kubun, kaisu, biko] of rows) {
    out.push([date, shop, amt, kubun || '1', kaisu || '1', amt, '', '', '', '', biko || ''].join(','));
    const n = parseInt(amt, 10); if (!isNaN(n)) total += n;
  }
  out.push(['', '', '', '', '', String(total), '', '', '', '', ''].join(','));
  return out.join('\r\n') + '\r\n';
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

  // 1b. 明細行が1つも無い（カード情報行と合計行だけ）→ ok:false
  const noData = 'VPASSガイド 様,4980-XXXX-XXXX-1234,,SMBCCARDクラシック☆,,,,,,,\r\n,,,,,0,,,,,\r\n';
  check('明細行なし → ok:false', analyze(noData).ok === false);

  // 1c. 明細でないCSV（列を推定できない）→ ok:false（黙って空を返さない）
  const rGarbage = analyze('a,b,c\r\n1,2,3\r\n4,5,6\r\n');
  check('列を推定できないCSV → ok:false', rGarbage.ok === false, rGarbage.error);

  // 1d. 楽天カード形式（別の列並び）も汎用アダプタが読める
  const rakutenLike = [
    '"利用日","利用店名・商品名","利用者","支払方法","利用金額","支払手数料","支払総額","8月支払金額","9月繰越残高","新規サイン"',
    '"2026/03/12","NETFLIX.COM","本人","1回払い","1590","0","1590","1590","0","*"',
    '"2026/04/12","NETFLIX.COM","本人","1回払い","1590","0","1590","1590","0","*"',
    '"2026/05/12","NETFLIX.COM","本人","1回払い","1590","0","1590","1590","0","*"',
    '"2026/06/12","NETFLIX.COM","本人","1回払い","1590","0","1590","1590","0","*"'
  ].join('\r\n');
  const rRk = analyze('﻿' + rakutenLike);
  check('楽天カード形式も汎用アダプタが読める（Netflix A）',
    rRk.ok && cand(rRk, 'Netflix') && cand(rRk, 'Netflix').status === 'A',
    rRk.ok ? JSON.stringify(rRk.report.adapter.stats.columns) : rRk.error);
  check('  金額列は「利用金額」を選ぶ（「支払総額」ではない）',
    rRk.ok && rRk.report.adapter.stats.columns.amount === 4,
    rRk.ok ? JSON.stringify(rRk.report.adapter.stats.columns) : '');

  // 1e. 利用日が飛んでいる短い系列 → coverage は利用日から / 判定は保守的
  const gap = vpassCsv([
    ['2026/3/12', 'NETFLIX.COM', '1590'],
    ['2026/5/12', 'NETFLIX.COM', '1590'],   // 4月が無い
    ['2026/6/12', 'NETFLIX.COM', '1590'],
    ['2026/7/12', 'NETFLIX.COM', '1590']
  ]);
  const rgap = analyze(gap);
  check('coverage は利用日の最小〜最大から導出', rgap.ok &&
    rgap.coverage.coverage_from === '2026-03-12' && rgap.coverage.coverage_to === '2026-07-12',
    JSON.stringify(rgap.coverage));
  /* 4点しかなく 1本 61日ギャップ → classifyCycle は保守的に single 判定
     （短い系列は全 gap 帯内を要求）。既知マスタでも cycle=single では
     shape 一致せず破棄。これは設計意図（本物の契約は全 gap 帯内）通り。 */
  check('利用日欠損＋短系列 → 保守的に破棄（Netflix 候補に出ない）',
    rgap.ok && !cand(rgap, 'Netflix') && dropped(rgap, 'NETFLIX.COM'),
    JSON.stringify(rgap.report.series.filter(s => /NETFLIX/i.test(s.merchant_raw))));

  // 1f. 全行が分割払い → transactions 0 → candidates 空だが ok
  const rai = analyze(vpassCsv([
    ['2026/4/5', 'BIC CAMERA', '66000', '3', '1'],
    ['2026/5/5', 'BIC CAMERA', '66000', '3', '2']
  ]));
  check('全行分割払い → ok:true / candidates 空', rai.ok && rai.candidates.length === 0);
  check('  除外統計に installment 計上', rai.report.adapter.stats.excluded_installment === 2,
    JSON.stringify(rai.report.adapter.stats));

  // 1g. マイナス額のみ（返金）
  const rneg = analyze(vpassCsv([['2026/3/19', 'AMAZON.CO.JP', '-3980', '1', '1', '返品']]));
  check('マイナス額のみ → 除外され candidates 空', rneg.ok && rneg.candidates.length === 0 &&
    rneg.report.adapter.stats.excluded_nonpositive === 1);

  // 1h. カード情報行・合計行・空行を黙って飛ばす
  const withNoise = [
    'VPASSガイド 様,4980-XXXX-XXXX-1234,,SMBCCARDクラシック☆,,,,,,,',
    '2026/3/12,NETFLIX.COM,1590,1,1,1590,,,,,',
    '2026/4/12,NETFLIX.COM,1590,1,1,1590,,,,,',
    '',
    'VPASSガイド 様,4980-XXXX-XXXX-9999,,三井住友カード iD［専用カード］,,,,,,,',
    '2026/5/12,NETFLIX.COM,1590,1,1,1590,,,,,',
    '2026/6/12,NETFLIX.COM,1590,1,1,1590,,,,,',
    ',,,,,6360,,,,,'
  ].join('\r\n');
  const rn = analyze(withNoise);
  check('カード情報行/合計行/空行を飛ばして明細だけ拾う', rn.ok &&
    rn.report.adapter.stats.skipped_nondata >= 1 && rn.report.adapter.stats.data_rows === 4,
    JSON.stringify(rn.report.adapter.stats));
  check('  複数カードブロックの明細が1つの系列にまとまる → Netflix A',
    rn.ok && cand(rn, 'Netflix') && cand(rn, 'Netflix').status === 'A');

  // 1i. 文字コード（§15-4）：三井住友カードの実 CSV は Shift-JIS(CP932)
  const utf8Str = fs.readFileSync(CSVDIR + 'SeiZen_sample_vpass_6months_2026-03_to_08.csv', 'utf8');
  const u8 = Buffer.from(utf8Str.replace(/^﻿/, ''), 'utf8');
  const rU8 = analyze(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
  check('UTF-8 バイト列 → ok / encoding=utf-8', rU8.ok && rU8.report.adapter.encoding === 'utf-8',
    JSON.stringify(rU8.report && rU8.report.adapter && rU8.report.adapter.encoding));

  const sjisPath = CSVDIR + 'SeiZen_sample_vpass_6months_2026-03_to_08_sjis.csv';
  if (fs.existsSync(sjisPath)) {
    const sj = fs.readFileSync(sjisPath);
    const rSj = analyze(sj.buffer.slice(sj.byteOffset, sj.byteOffset + sj.byteLength));
    check('Shift-JIS バイト列 → ok / encoding=shift_jis', rSj.ok && rSj.report.adapter.encoding === 'shift_jis',
      JSON.stringify(rSj.report && rSj.report.adapter && rSj.report.adapter.encoding));
    check('  Shift-JIS でも UTF-8 と同じ候補が出る（Netflix / Spotify / 日経）',
      rSj.ok && ['Netflix', 'Spotify', '日本経済新聞'].every(n => rSj.candidates.some(c => c.merchant_name === n)),
      rSj.ok ? rSj.candidates.map(c => c.merchant_name).join(',') : rSj.error);
    /* UTF-8 版と候補・drop が一致することの照合 */
    const rUtf = analyze(utf8Str);
    check('  Shift-JIS と UTF-8 で候補件数が一致', rSj.candidates.length === rUtf.candidates.length,
      rSj.candidates.length + ' vs ' + rUtf.candidates.length);
  } else {
    check('Shift-JIS サンプル CSV が存在する（sjis.csv）', false, sjisPath + ' が無い。生成手順は test/README 参照');
  }

  // 1j. 文字列（デコード済み）はそのまま通る＝?debug 復元・旧経路互換
  check('デコード済み文字列も引き続き通る', analyze(utf8Str).ok);
}

/* ════════════════════════════════════════════════════════════════
   2. 判定の派生経路（bimonthly / C「分からない」/ resolver 失敗）
   ════════════════════════════════════════════════════════════════ */
console.log('\n■ 2. 判定の派生経路');
{
  freshModules();

  // 2a. bimonthly の明確なケース（水道を隔月で 4 回）
  const rbim = analyze(vpassCsv([
    ['2026/3/10', 'YOKOHAMA WATERWORKS', '4800'],
    ['2026/5/10', 'YOKOHAMA WATERWORKS', '4800'],
    ['2026/7/10', 'YOKOHAMA WATERWORKS', '4800'],
    ['2026/9/10', 'YOKOHAMA WATERWORKS', '4800']
  ]));
  const wc = cand(rbim, '横浜市水道局');
  check('隔月 x4 → 横浜市水道局 候補あり', !!wc);
  check('  cycle == bimonthly', wc && wc.series.cycle === 'bimonthly', wc && wc.series.cycle);
  check('  status == A（従量・金額照合しない）', wc && wc.status === 'A', wc && wc.status);

  // 2b. resolver スタブで解決できない継続課金 → C
  const runk = analyze(vpassCsv([
    ['2026/3/8', 'MYSTERY SUBSCRIPTION', '3300'],
    ['2026/4/8', 'MYSTERY SUBSCRIPTION', '3300'],
    ['2026/5/8', 'MYSTERY SUBSCRIPTION', '3300'],
    ['2026/6/8', 'MYSTERY SUBSCRIPTION', '3300']
  ]));
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

  // 2e. 期間が1ヶ月だけの明細（§7-3：期間下限を設けない）
  freshModules();
  const rom = analyze(vpassCsv([
    ['2026/7/6',  'MICROSOFT*MICROSOFT 365', '21300'],   // 年額・単発 → A
    ['2026/7/9',  'GMO*ONAMAE.COM', '1408'],             // 年額・単発 → A
    ['2026/7/12', 'NETFLIX.COM', '1590'],                // 月額 1件 → 継続の観測なし
    ['2026/7/20', 'SEIYU', '3200']                       // 日常消費 → drop
  ]));
  check('1ヶ月明細でも ok:true', rom.ok);
  check('  年額の単発（MS365 / GMO）は A（§7-3）',
    ['Microsoft', 'GMO お名前.com'].every(n => {
      const c = cand(rom, n); return c && c.status === 'A';
    }), rom.candidates.map(c => c.merchant_name + ':' + c.status).join(','));
  check('  coverage は利用日から（2026-07-06 〜 2026-07-20）',
    rom.coverage.coverage_from === '2026-07-06' && rom.coverage.coverage_to === '2026-07-20',
    JSON.stringify(rom.coverage));
  check('  月額1件の Netflix は継続の観測が無く候補に出ない（cycle=single → drop）',
    !cand(rom, 'Netflix') && dropped(rom, 'NETFLIX.COM'),
    JSON.stringify(rom.report.series.filter(s => /NETFLIX/i.test(s.merchant_raw))));

  // 2f. 支払区分が全角「１」（vpass.js は半角・全角どちらも lump sum）
  freshModules();
  const rz = analyze(vpassCsv([
    ['2026/3/12', 'NETFLIX.COM', '1590', '１'],
    ['2026/4/12', 'NETFLIX.COM', '1590', '１'],
    ['2026/5/12', 'NETFLIX.COM', '1590', '１'],
    ['2026/6/12', 'NETFLIX.COM', '1590', '１'],
    ['2026/7/12', 'NETFLIX.COM', '1590', '１'],
    ['2026/8/12', 'NETFLIX.COM', '1590', '１']
  ]));
  check('支払区分が全角「１」でも一括払いとして扱う → Netflix A',
    rz.ok && cand(rz, 'Netflix') && cand(rz, 'Netflix').status === 'A',
    rz.ok ? JSON.stringify(rz.report.adapter.stats) : rz.error);

  // 2g. 同一請求主体に「定額系列＋どの帯にも当たらない単発」が混在
  freshModules();
  const rmix = analyze(vpassCsv([
    ['2026/3/18', 'APPLE.COM/BILL', '150'],
    ['2026/4/18', 'APPLE.COM/BILL', '150'],
    ['2026/5/18', 'APPLE.COM/BILL', '150'],
    ['2026/6/18', 'APPLE.COM/BILL', '150'],
    ['2026/7/18', 'APPLE.COM/BILL', '150'],
    ['2026/8/18', 'APPLE.COM/BILL', '150'],
    ['2026/4/11', 'APPLE.COM/BILL', '1200'],   // Apple One 帯・単発
    ['2026/8/22', 'APPLE.COM/BILL', '650']     // 帯外・単発
  ]));
  check('混在：¥150×6 は iCloud+（50GB プラン）に確定 → A',
    (() => { const c = cand(rmix, 'Apple'); return c && c.status === 'A' && c.service_id === 'svc-icloud' && c.plan_id === 'pln-icloud-50'; })(),
    JSON.stringify(rmix.candidates.map(c => ({ n: c.merchant_name, s: c.status, sid: c.service_id }))));
  check('  ¥1,200 単発は「形が一致しない」で drop（§7-2）',
    !!dropped(rmix, 'APPLE.COM/BILL') && rmix.report.series.some(s => s.merchant_raw === 'APPLE.COM/BILL' && s.amount_max === 1200 && s.status === 'drop'));
  check('  ¥650 単発も drop（どの帯にも当たらず規則性なし）',
    rmix.report.series.some(s => s.merchant_raw === 'APPLE.COM/BILL' && s.amount_max === 650 && s.status === 'drop'));
  check('  Apple の候補は1つだけ（¥150 系列のみ）',
    rmix.candidates.filter(c => c.merchant_name === 'Apple').length === 1);
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
  const unkCsv = vpassCsv([
    ['2026/3/8', 'MYSTERY SUBSCRIPTION', '3300'],
    ['2026/4/8', 'MYSTERY SUBSCRIPTION', '3300'],
    ['2026/5/8', 'MYSTERY SUBSCRIPTION', '3300'],
    ['2026/6/8', 'MYSTERY SUBSCRIPTION', '3300']
  ]);
  const r4 = analyze(unkCsv, { paymentMethodId: 'card-Z' });
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
  const r4b = analyze(unkCsv, { paymentMethodId: 'card-Z' });
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
  const csv = vpassCsv([
    ['2026/3/5', 'DAZN*7F3A21', '4200'],
    ['2026/4/5', 'DAZN*7F3A21', '4200'],
    ['2026/5/5', 'DAZN*7F3A21', '4200'],
    ['2026/6/5', 'DAZN*7F3A21', '4200'],
    ['2026/7/5', 'DAZN*7F3A21', '4200'],
    ['2026/8/5', 'DAZN*7F3A21', '4200']
  ]);

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
  const r6 = analyze(vpassCsv([
    ['2026/3/21', 'RAKUTEN CARD', '88000'],
    ['2026/4/21', 'RAKUTEN CARD', '88000'],
    ['2026/5/21', 'RAKUTEN CARD', '88000']
  ]));
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
  const r7 = analyze(vpassCsv([
    ['2026/3/23', 'SOMPO JAPAN', '4230'],
    ['2026/4/23', 'SOMPO JAPAN', '4230'],
    ['2026/5/23', 'SOMPO JAPAN', '4230']
  ]));
  check('SOMPO JAPAN → candidates に載らない', !cand(r7, '損保ジャパン'));
  check('  payment_method_hits にも出ない', !r7.payment_method_hits.some(h => /損保/.test(h.merchant_name)));
  check('  report で drop / out_of_scope', dropped(r7, 'SOMPO JAPAN') && dropped(r7, 'SOMPO JAPAN').drop_reason === 'out_of_scope');
}

/* ════════════════════════════════════════════════════════════════
   8. 汎用アダプタ（§15-4）：会社を問わず列を推定して読む
   ════════════════════════════════════════════════════════════════ */
console.log('\n■ 8. 汎用アダプタ（§15-4）');
{
  const setOf = r => r.candidates.map(c => c.merchant_name + ':' + c.status).sort().join(' | ');

  /* 8a. 三井住友カード（Vpass）実形式と楽天カード実形式で、
        同じ取引データなら候補集合が一致する（判定は形式非依存）。 */
  freshModules();
  const vpassPath   = CSVDIR + 'SeiZen_sample_vpass_6months_2026-03_to_08.csv';
  const rakutenPath = CSVDIR + 'SeiZen_sample_rakuten_6months_2026-03_to_08.csv';
  const readBytes = p => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

  const rVp = analyze(readBytes(vpassPath));
  check('三井住友カード実形式（ヘッダーなし11列）→ ok', rVp.ok,
    rVp.ok ? JSON.stringify(rVp.report.adapter.stats.columns) : rVp.error);

  if (fs.existsSync(rakutenPath)) {
    const rRk = analyze(readBytes(rakutenPath));
    check('楽天カード実形式（ヘッダーあり10列・BOM）→ ok', rRk.ok,
      rRk.ok ? JSON.stringify(rRk.report.adapter.stats.columns) : rRk.error);
    check('  三井住友版と楽天版で候補集合が一致（会社別の決め打ちをしていない）',
      rVp.ok && rRk.ok && setOf(rVp) === setOf(rRk),
      '\n     vpass:   ' + setOf(rVp) + '\n     rakuten: ' + setOf(rRk));
  } else {
    check('楽天カードのサンプル CSV が存在する', false, rakutenPath + ' が無い');
  }

  /* 8b. セゾン形式（列の並びが違う）も読める */
  freshModules();
  const saison = [
    '利用日,ご利用店名及び商品名,本人・家族区分,支払区分名称,締前入金区分,利用金額,備考',
    '2026/03/12,NETFLIX.COM,本人,1回払い,,1590,',
    '2026/04/12,NETFLIX.COM,本人,1回払い,,1590,',
    '2026/05/12,NETFLIX.COM,本人,1回払い,,1590,',
    '2026/06/12,NETFLIX.COM,本人,1回払い,,1590,'
  ].join('\r\n');
  const rSa = analyze(saison);
  check('セゾン形式（利用金額が6列目）→ Netflix A',
    rSa.ok && cand(rSa, 'Netflix') && cand(rSa, 'Netflix').status === 'A',
    rSa.ok ? JSON.stringify(rSa.report.adapter.stats.columns) : rSa.error);

  /* 8c. 三菱UFJニコス形式（カナ略記店名・支払回数列）も読める */
  freshModules();
  const mufg = [
    '"利用日","利用者","利用区分","利用内容","新規利用額","今回請求額","支払回数","備考"',
    '"2026/03/12","本人","国内","ﾈｯﾄﾌﾘｯｸｽ","1590","1590","1",""',
    '"2026/04/12","本人","国内","ﾈｯﾄﾌﾘｯｸｽ","1590","1590","1",""',
    '"2026/05/12","本人","国内","ﾈｯﾄﾌﾘｯｸｽ","1590","1590","1",""',
    '"2026/06/12","本人","国内","ﾈｯﾄﾌﾘｯｸｽ","1590","1590","1",""',
    '"2026/04/05","本人","国内","ﾋﾞｯｸｶﾒﾗ","66000","22000","3","分割"'
  ].join('\r\n');
  const rMu = analyze(mufg);
  check('三菱UFJ形式（新規利用額・支払回数）→ ok / 金額列は「今回請求額」でなく「新規利用額」',
    rMu.ok && rMu.report.adapter.stats.columns.amount === 4,
    rMu.ok ? JSON.stringify(rMu.report.adapter.stats.columns) : rMu.error);
  check('  支払回数=3（分割）の BIC CAMERA は除外される',
    rMu.ok && rMu.report.adapter.stats.excluded_installment === 1,
    rMu.ok ? JSON.stringify(rMu.report.adapter.stats) : '');

  /* 8d. 「現地利用額…変換レート…」の補足行（利用日が空）を飛ばす */
  freshModules();
  const forex = [
    '"利用日","利用店名・商品名","利用者","支払方法","利用金額","支払総額"',
    '"2026/03/12","NETFLIX.COM","本人","1回払い","1590","1590"',
    '"","現地利用額　９．９９ＵＳＤ　変換レート　１５９．００","","","",""',
    '"2026/04/12","NETFLIX.COM","本人","1回払い","1590","1590"',
    '"2026/05/12","NETFLIX.COM","本人","1回払い","1590","1590"'
  ].join('\r\n');
  const rFx = analyze('﻿' + forex);
  check('補足行（利用日が空）を飛ばす', rFx.ok && rFx.report.adapter.stats.skipped_nondata === 1,
    rFx.ok ? JSON.stringify(rFx.report.adapter.stats) : rFx.error);

  /* 8e. 金額の紛らわしい列（支払総額）を金額列にしない */
  freshModules();
  const trap = [
    '"利用日","利用店名","利用金額","支払総額","今回のお支払い金額"',
    '"2026/03/05","BIC CAMERA","66000","67200","22400"',       // 分割：総額と乖離
    '"2026/03/12","NETFLIX.COM","1590","1590","1590"'
  ].join('\r\n');
  const rTr = analyze('﻿' + trap);
  check('金額列は「利用金額」を選ぶ（支払総額・今回支払は選ばない）',
    rTr.ok && rTr.report.adapter.stats.columns.amount === 2,
    rTr.ok ? JSON.stringify(rTr.report.adapter.stats.columns) : rTr.error);
}

/* ════════════════════════════════════════════════════════════════
   結果
   ════════════════════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(50));
console.log(`  PASS ${pass}  /  FAIL ${fail}`);
console.log('═'.repeat(50));
process.exit(fail ? 1 : 0);
