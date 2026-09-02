/* 契約・デジタル：支払い手段の一元化（state.js の paymentMethods）と
   「支払い明細から探す」の確認済み記録の全経路テスト。
   ------------------------------------------------------------------
   実行：  node payment-methods.test.js       （このディレクトリで）
   終了コード 0 = 全通過 / 1 = 失敗あり。

   jsdom が要る（DOM を組んで render.js / extraction.js を実際に走らせ、
   出力を検証するため）。プロジェクトに package.json がないので、
   グローバル or 近傍の node_modules から拾う。無ければ：
     npm i -g jsdom
   するか、NODE_PATH に jsdom のある node_modules を通す。

   file:// では jsdom が sessionStorage を持たないので、テスト側で
   制御できる storage を差し込む（永続・移行のテストで storage を
   ページ間で共有するため）。

   本番のビルド構成（Vitest 等）が決まったら、check() を expect() に、
   各ブロックを it() に置き換えて移植できる。
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  for (const g of [
    '/tmp/jsdom-check/node_modules/jsdom',
    '/tmp/jsdom/node_modules/jsdom',
    path.join(process.env.HOME || '', '.npm-global/lib/node_modules/jsdom')
  ]) { try { ({ JSDOM } = require(g)); break; } catch (_) {} }
}
if (!JSDOM) { console.error('jsdom が見つかりません。`npm i -g jsdom` などで。'); process.exit(2); }

const DIR = path.join(__dirname, '..') + path.sep;
const CSV = fs.readFileSync(
  path.join(DIR, '..', '..', '設計', '支払い明細から探す', 'SeiZen_sample_vpass_6months_2026-03_to_08.csv'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

/* ページ間で共有できる storage。1つ渡すと、そのページの
   sessionStorage への読み書きがこのオブジェクトに溜まる。 */
function mkStore(seed) {
  const d = Object.assign({}, seed || {});
  return {
    getItem(k) { return k in d ? d[k] : null; },
    setItem(k, v) { d[k] = String(v); },
    removeItem(k) { delete d[k]; },
    clear() { for (const k of Object.keys(d)) delete d[k]; },
    key(i) { return Object.keys(d)[i] || null; },
    get length() { return Object.keys(d).length; },
    _dump() { return Object.assign({}, d); }
  };
}

/* 1 ページを、<script src> を順に読み込んだ状態で起こす。 */
function loadPage(htmlFile, opts) {
  opts = opts || {};
  const session = opts.session || mkStore();
  const local = opts.local || mkStore();
  const errors = [];
  const dom = new JSDOM(fs.readFileSync(DIR + htmlFile, 'utf8'), {
    url: 'file://' + DIR + htmlFile,
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.defineProperty(window, 'sessionStorage', { value: session, configurable: true });
      Object.defineProperty(window, 'localStorage', { value: local, configurable: true });
      /* jsdom は TextDecoder/Encoder を window に出さない。実ブラウザには
         標準であるので、Node の実装を注入して本番同等にする。 */
      const { TextDecoder, TextEncoder } = require('util');
      window.TextDecoder = window.TextDecoder || TextDecoder;
      window.TextEncoder = window.TextEncoder || TextEncoder;
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = id => clearTimeout(id);
      window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
      window.IntersectionObserver = window.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} };
    }
  });
  const { window } = dom;
  window.addEventListener('error', e => errors.push('ERR: ' + (e.error && e.error.stack || e.message)));
  window.onerror = (m, s, l, c, err) => errors.push('ONERR: ' + (err && err.stack || m));
  for (const src of [...window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'))) {
    try { window.eval(fs.readFileSync(path.resolve(DIR, src), 'utf8')); }
    catch (e) { errors.push('SCRIPT ' + src + ': ' + (e.stack || e.message)); }
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  return { window, errors, dom, session, local };
}

const txt = els => els.map(e => e.textContent);
const clean = s => s.replace(/\s+/g, '');

(async function run() {

/* ══ 1. state.js：支払い手段の一元化 ════════════════════════ */
console.log('\n■ 1. state.js：支払い手段の一元化');
{
  const { window, errors } = loadPage('index.html');
  check('index.html：JS エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
  const S = window.SeiZenContract;
  check('SeiZenContract が読める', !!S);
  check('paymentMethods は card2 / bank / emoney',
    S.paymentMethods.length === 4 &&
    S.paymentMethods.filter(p => p.kind === 'card').length === 2 &&
    S.paymentMethods.some(p => p.kind === 'bank') &&
    S.paymentMethods.some(p => p.kind === 'emoney'),
    S.paymentMethods.map(p => p.id + '/' + p.kind).join(','));
  check('cards 後方互換エイリアスも生きている', Array.isArray(S.cards) && S.cards.length === S.paymentMethods.length);
  check('findCard / findPaymentMethod どちらも bank を引ける', !!S.findCard('bank-jp-1') && !!S.findPaymentMethod('bank-jp-1'));
  check('ゆうちょ引き落とし4契約が bank-jp-1 に紐づく', S.linkedItems('bank-jp-1').length === 4,
    S.linkedItems('bank-jp-1').map(i => i.name).join(','));
  check('  内訳は電気・ガス・水道・NHK',
    ['電力', 'ガス', '水道', 'NHK'].every(k => S.linkedItems('bank-jp-1').some(i => i.name.includes(k))));
  check('各手段の初期 statement_checked は null', S.paymentMethods.every(p => p.statement_checked === null));
}

/* ══ 2. markStatementChecked と永続 ════════════════════════ */
console.log('\n■ 2. markStatementChecked と永続');
{
  const { window, session } = loadPage('index.html');
  const S = window.SeiZenContract;
  check('未知の id は false', S.markStatementChecked('nope', {}) === false);
  check('既存 id は true', S.markStatementChecked('card-smbc', { from: '2026-03-01', to: '2026-08-31' }) === true);
  const sc = S.findPaymentMethod('card-smbc').statement_checked;
  check('  at が入る（今日）', !!sc.at);
  check('  ranges に確認区間が1本入る',
    Array.isArray(sc.ranges) && sc.ranges.length === 1 &&
    sc.ranges[0].from === '2026-03-01' && sc.ranges[0].to === '2026-08-31', JSON.stringify(sc));
  check('coverage 省略でも記録できる（ranges は空）',
    S.markStatementChecked('bank-jp-1') === true &&
    S.findPaymentMethod('bank-jp-1').statement_checked.ranges.length === 0);

  /* 別期間を取り込むと ranges が足し込まれる（上書きしない） */
  S.markStatementChecked('card-smbc', { from: '2026-11-01', to: '2026-11-30' });
  const scAdd = S.findPaymentMethod('card-smbc').statement_checked;
  check('  飛んだ期間は別レンジとして残る（2本）',
    scAdd.ranges.length === 2 &&
    scAdd.ranges[0].to === '2026-08-31' && scAdd.ranges[1].from === '2026-11-01', JSON.stringify(scAdd.ranges));
  /* 隣接（隙間31日以内）は統合される */
  S.markStatementChecked('card-smbc', { from: '2026-09-01', to: '2026-10-15' });
  const scMerge = S.findPaymentMethod('card-smbc').statement_checked;
  check('  隣接する期間は1本に統合（3〜11月）',
    scMerge.ranges.length === 1 &&
    scMerge.ranges[0].from === '2026-03-01' && scMerge.ranges[0].to === '2026-11-30', JSON.stringify(scMerge.ranges));

  check('和文の期間表記（statementCoverageText）',
    S.statementCoverageText(scMerge) === '2026年 3月〜11月', S.statementCoverageText(scMerge));

  const patch = JSON.parse(session.getItem('seizen.contract.v2') || '{}');
  check('保存は patch 形式（v:2・methodEdits に確認記録）',
    patch.v === 2 && patch.methodEdits && patch.methodEdits['card-smbc'] &&
    patch.methodEdits['card-smbc'].statement_checked.ranges[0].from === '2026-03-01',
    JSON.stringify(patch.methodEdits));
  check('  保存に seed（paymentMethods 全体・items 全体）は含まれない',
    !patch.paymentMethods && !patch.items,
    Object.keys(patch).join(','));

  /* 同じ session を渡してリロード */
  const { window: w2 } = loadPage('index.html', { session });
  const sc2 = w2.SeiZenContract.findPaymentMethod('card-smbc').statement_checked;
  check('リロード後も確認記録が残る', !!sc2 && sc2.ranges[0].from === '2026-03-01');
  check('  statement_format は seed から（最新・保存されない）',
    w2.SeiZenContract.findPaymentMethod('card-smbc').statement_format === 'card_csv');
}

/* ══ 3. seed（コード）＋ patch（保存）の再構築 ════════════════
   items / paymentMethods はロード時に seed から作り直され、保存済みの
   ユーザーデータ（追加分・編集差分）を重ねる。seed のスキーマ変更は
   次のロードで即反映される（本番＝サーバから GET と同じ）。 */
console.log('\n■ 3. seed + patch の再構築');
{
  /* seed item を編集 → patch に差分だけ乗る */
  const { window: w1, session } = loadPage('index.html');
  const S1 = w1.SeiZenContract;
  const nf = S1.findItem('svc-netflix');
  nf.policy.intent = 'cancel'; nf.policy.reason = '見なくなった'; S1.touch(nf);
  S1.commitFromStatement([{ name: 'なぞの定期購入', group: 'undecided', category: '未分類', contract: { amount: 500, cycle: 'monthly' } }]);

  const patch = JSON.parse(session.getItem('seizen.contract.v2'));
  check('itemEdits は変更フィールドだけ（policy / updated）',
    patch.itemEdits['svc-netflix'] && patch.itemEdits['svc-netflix'].policy.intent === 'cancel' &&
    !patch.itemEdits['svc-netflix'].name,
    JSON.stringify(patch.itemEdits['svc-netflix']));
  check('addedItems にユーザー追加分（なぞの定期購入）', patch.addedItems.some(i => i.name === 'なぞの定期購入'));
  check('保存サイズは小さい（seed 丸ごとではない・2KB 未満）',
    session.getItem('seizen.contract.v2').length < 2000, session.getItem('seizen.contract.v2').length + ' bytes');

  /* リロード：seed 再構築 + patch */
  const { window: w2, errors } = loadPage('index.html', { session });
  check('  JS エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
  const S2 = w2.SeiZenContract;
  check('編集した seed item（Netflix intent=cancel）が残る', S2.findItem('svc-netflix').policy.intent === 'cancel');
  check('触っていない seed item（iCloud+）は工場出荷の intent のまま',
    S2.findItem('svc-icloud').policy.intent === 'continue',
    S2.findItem('svc-icloud').policy.intent);
  check('追加した契約が残る（No. 付き）', !!(S2.items.find(i => i.name === 'なぞの定期購入') || {}).no);
  check('paymentMethods は seed（4件・全部 kind と statement_format を持つ）',
    S2.paymentMethods.length === 4 &&
    S2.paymentMethods.filter(m => m.kind === 'card').every(m => m.statement_format === 'card_csv'));
}

/* ══ 3b. 旧 v1 保存（seed 丸ごと）は捨てて seed に戻る ══════════ */
console.log('\n■ 3b. 旧 v1 保存は破棄');
{
  const legacy = mkStore({
    'seizen.contract.v1': JSON.stringify({
      items: [{ id: 'svc-old', name: '旧データ', added: true, no: '099' }],
      cards: [{ id: 'card-old', name: '旧カード' }],
      nextNo: 200
    })
  });
  const { window, errors } = loadPage('index.html', { session: legacy });
  const S = window.SeiZenContract;
  check('  JS エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
  check('旧 v1 保存は読まず seed に戻る（items は seed の 15件）',
    S.items.length === 15 && !S.findItem('svc-old'));
  check('  paymentMethods も seed（4件・kind あり）',
    S.paymentMethods.length === 4 && S.paymentMethods.every(m => m.kind));
  check('  v1 キーは掃除される', window.sessionStorage.getItem('seizen.contract.v1') === null);
}

/* ══ 4. render.js：支払いのつながり（全手段）════════════════ */
console.log('\n■ 4. render.js：支払いのつながり（全手段）');
{
  const { window, errors } = loadPage('index.html');
  check('JS エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
  const doc = window.document;

  /* カード・電子マネーは券面（.paycard）、銀行口座は通帳の表紙
     （.pb-book・shared/passbook.js）で描かれる。 */
  const cardFaces = txt([...doc.querySelectorAll('.paycard .pc-h b')]);
  check('カード・電子マネーは券面で出る（楽天・三井住友・PayPay）',
    ['楽天', '三井住友', 'PayPay'].every(n => cardFaces.some(f => f.includes(n))), JSON.stringify(cardFaces));
  const bookNames = txt([...doc.querySelectorAll('.pb-book')]);
  check('銀行口座は通帳の表紙で出る（ゆうちょ）',
    bookNames.some(t => /ゆうちょ/.test(t)), JSON.stringify(bookNames.map(t => t.slice(0, 20))));

  const warns = txt([...doc.querySelectorAll('.pc-warn')]).map(clean);
  check('カードは「このカードを止めると」', warns.some(t => /このカードを止めると/.test(t)));
  check('電子マネーは「この決済を止めると」', warns.some(t => /この決済を止めると/.test(t)));
  const bookWarn = txt([...doc.querySelectorAll('.pbc-warn')]).map(clean);
  check('口座は「この口座が凍結されると」', bookWarn.some(t => /この口座が凍結されると/.test(t)),
    JSON.stringify(bookWarn));

  const faceClasses = [...doc.querySelectorAll('.pc-face')].map(e => e.className);
  check('券面クラスが kind 別（pf-paypay を含む・pf-bank は通帳側へ移行）',
    faceClasses.some(c => /pf-paypay/.test(c)), JSON.stringify(faceClasses));
  check('経路件数が 4', clean(doc.querySelector('.ib-pay .n-pay').textContent).includes('4'));
}

/* ══ 5. render.js：確認済みバッジ ════════════════════════════ */
console.log('\n■ 5. render.js：確認済みバッジ');
{
  const { window, session } = loadPage('index.html');
  window.SeiZenContract.markStatementChecked('card-rakuten', { from: '2026-01-01', to: '2026-06-30' });
  const { window: w2 } = loadPage('index.html', { session });
  const badges = txt([...w2.document.querySelectorAll('.pc-checked')]).map(clean);
  check('楽天カードに「明細を確認済み（和文の期間）」バッジ',
    badges.some(t => /明細を確認済み/.test(t) && /2026年1月〜6月/.test(t)), JSON.stringify(badges));
  check('bank-jp-1 のボタンが存在（通帳の表紙 or 券面）',
    !!w2.document.querySelector('[data-open="bank-jp-1"]'));
}

/* ══ 6. extraction.js：口座選択リスト ══════════════════════ */
console.log('\n■ 6. extraction.js：口座選択リスト');
{
  const { window, errors, session } = loadPage('extraction.html');
  check('extraction.html：JS エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
  const doc = window.document;
  const groups = txt([...doc.querySelectorAll('.exacct-group > h4')]);
  check('銀行口座 / クレジットカード / 電子マネー の 3 グループ',
    groups.length === 3 && ['銀行口座', 'クレジットカード', '電子マネー・QR決済'].every(g => groups.includes(g)),
    JSON.stringify(groups));
  const accts = txt([...doc.querySelectorAll('.exacct b')]);
  check('ゆうちょ・楽天・三井住友・PayPay がすべて並ぶ',
    ['ゆうちょ', '楽天', '三井住友', 'PayPay'].every(n => accts.some(a => a.includes(n))), JSON.stringify(accts));

  window.SeiZenContract.markStatementChecked('card-smbc', { from: '2026-03-01', to: '2026-08-31' });
  const { window: w2 } = loadPage('extraction.html', { session });
  const doneBtns = [...w2.document.querySelectorAll('.exacct.is-done b')].map(e => e.textContent);
  check('確認済みの手段（三井住友）に is-done', doneBtns.some(t => /三井住友/.test(t)), JSON.stringify(doneBtns));
  const doneBadge = [...w2.document.querySelectorAll('.exacct-done')].map(e => clean(e.textContent));
  check('  バッジに「確認済み（和文の期間）」', doneBadge.some(t => /確認済み/.test(t) && /2026年3月〜8月/.test(t)), JSON.stringify(doneBadge));
}

/* ══ 7. アップロード → 登録 → 確認済み記録 ══════════════════ */
console.log('\n■ 7. アップロード → 登録 → 確認済み記録');
{
  const { window, errors } = loadPage('extraction.html');
  check('JS エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
  const S = window.SeiZenContract;
  const doc = window.document;

  doc.querySelector('#pickExisting').dispatchEvent(new window.Event('click', { bubbles: true }));
  const smbcBtn = doc.querySelector('.exacct[data-acct="card-smbc"]');
  check('card-smbc の選択ボタンがある', !!smbcBtn);
  smbcBtn.dispatchEvent(new window.Event('click', { bubbles: true }));

  const fileInput = doc.querySelector('input[type="file"]');
  check('ファイル入力がある', !!fileInput);
  const file = new window.File([CSV], 'v.csv', { type: 'text/csv' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));   /* FileReader */

  /* 「解析をはじめる」を押す（setTimeout(runAnalysis, 500) が入る） */
  const startBtn = doc.querySelector('#exStart');
  check('「解析をはじめる」ボタンがある', !!startBtn);
  startBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 800));

  const cands = [...doc.querySelectorAll('.excand-name > b')].map(e => e.textContent);
  check('候補が描画される（Netflix を含む）', cands.some(c => /Netflix/.test(c)), JSON.stringify(cands.slice(0, 6)));
  check('ドコモの行が B（is-check）', [...doc.querySelectorAll('.excand')].some(el => /is-check/.test(el.className)));

  [...doc.querySelectorAll('.excand-check:not(.is-locked)')].forEach(b => {
    if (!b.hasAttribute('disabled')) b.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 50));

  const commit = doc.querySelector('#exCommit');
  check('登録ボタンがある', !!commit);
  commit.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));

  const sc = S.findPaymentMethod('card-smbc').statement_checked;
  check('登録後、card-smbc に確認記録が付く', !!sc);
  check('  確認記録の期間が明細の coverage（取引の利用日の最小〜最大）',
    sc && sc.ranges.length === 1 &&
    sc.ranges[0].from === '2026-03-03' && sc.ranges[0].to === '2026-08-28', JSON.stringify(sc));
  const added = S.items.filter(it => it.contract && it.contract.source === 'statement');
  /* Netflix / Spotify / iCloud+ / TEPCO / 東京ガス は seed 既存なので
     同名スキップされる。seed に無いもの（Microsoft 365 等）が入る。 */
  check('明細由来の新規契約が state に追加された（Microsoft 365 等）',
    added.some(it => /Microsoft 365/.test(it.name)), added.map(it => it.name).join(','));
  check('  seed 既存（Netflix）は二重登録されない',
    S.items.filter(it => it.name === 'Netflix').length === 1);
}

/* ══ 8. 画面：B を選ぶ → それが既登録だった（§11 の B 経路）══════ */
console.log('\n■ 8. 画面：B → registered');
{
  /* caseB は Apple ¥980 が B（iCloud+ / Apple Music / …）。
     先に「iCloud+（svc-icloud）を card-smbc で登録済み」にしておく。
     seed の svc-icloud は既に存在するので、その支払い手段を card-smbc に
     合わせる（seed は card-smbc 紐付け）。 */
  const caseB = fs.readFileSync(
    path.join(DIR, '..', '..', '設計', '支払い明細から探す', 'SeiZen_sample_vpass_6months_2026-03_to_08_caseB.csv'), 'utf8');
  const { window, errors } = loadPage('extraction.html');
  check('JS エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
  const S = window.SeiZenContract;
  const doc = window.document;

  /* seed の iCloud+ が card-smbc 紐付けであることを確認（前提） */
  const icloudSeed = S.findItem('svc-icloud');
  check('前提：seed に iCloud+（svc-icloud）がある', !!icloudSeed);
  const icloudCard = icloudSeed && icloudSeed.contract && icloudSeed.contract.paymentCard;

  /* その card で caseB を上げる */
  const useCard = icloudCard || 'card-smbc';
  doc.querySelector('#pickExisting').dispatchEvent(new window.Event('click', { bubbles: true }));
  const btn = doc.querySelector('.exacct[data-acct="' + useCard + '"]');
  check('その支払い手段の選択ボタンがある（' + useCard + '）', !!btn);
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));

  const fileInput = doc.querySelector('input[type="file"]');
  const file = new window.File([caseB], 'caseB.csv', { type: 'text/csv' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  doc.querySelector('#exStart').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 800));

  /* Apple の B 行を見つけて「iCloud+」を選ぶ */
  const cards = [...doc.querySelectorAll('.excand[data-card]')];
  const appleCard = cards.find(el => /Apple/.test(el.querySelector('.excand-name > b')?.textContent || ''));
  check('Apple の B 行がある', !!appleCard);
  const isCheck = appleCard && /is-check/.test(appleCard.className);
  check('  Apple 行は B（is-check）', isCheck);

  const pills = appleCard ? [...appleCard.querySelectorAll('[data-choice]')] : [];
  const icloudPill = pills.find(p => /iCloud/.test(p.textContent));
  check('  選択肢に iCloud+ がある', !!icloudPill, pills.map(p => p.textContent).join(','));
  if (icloudPill) {
    icloudPill.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    const after = doc.querySelector('.excand[data-card="' + appleCard.dataset.card + '"]');
    const chip = after && after.querySelector('.excand-chip');
    check('  iCloud+ を選ぶと「登録済み」チップが出る（§11 の B 経路）',
      !!chip && /登録済み/.test(chip.textContent), chip ? chip.textContent : '(チップなし)');
    const checkBtn = after && after.querySelector('.excand-check');
    check('  その行のチェックは不可（is-locked / disabled）',
      !!checkBtn && (/is-locked/.test(checkBtn.className) || checkBtn.hasAttribute('disabled')),
      checkBtn ? checkBtn.className : '(ボタンなし)');
  }
}

/* ══ 9. 明細取り込みの可否（§15-4）════════════════════════
   カード明細は会社を問わず汎用アダプタが読む（statement_format:
   'card_csv'）。銀行・電子マネーは構造が違うため未対応（null）。 */
console.log('\n■ 9. 明細取り込みの可否（§15-4）');
{
  const { window, errors } = loadPage('extraction.html');
  check('JS エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
  const S = window.SeiZenContract;
  const doc = window.document;

  check('カード（三井住友・楽天）の statement_format = card_csv',
    S.findPaymentMethod('card-smbc').statement_format === 'card_csv' &&
    S.findPaymentMethod('card-rakuten').statement_format === 'card_csv');
  check('ゆうちょ・PayPay は statement_format = null（未対応）',
    S.findPaymentMethod('bank-jp-1').statement_format === null && S.findPaymentMethod('emoney-1').statement_format === null);

  /* ゆうちょを選ぶ → ファイルを選んでも解析ボタンが押せず、注記が出る */
  doc.querySelector('#pickExisting').dispatchEvent(new window.Event('click', { bubbles: true }));
  doc.querySelector('.exacct[data-acct="bank-jp-1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const fi = doc.querySelector('input[type="file"]');
  const f = new window.File([CSV], 'v.csv', { type: 'text/csv' });
  Object.defineProperty(fi, 'files', { value: [f], configurable: true });
  fi.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const note = doc.querySelector('#exFormatNote');
  check('ゆうちょ選択時、明細形式が未対応の注記が出る', note && !note.hidden && /未対応|対応していません/.test(note.textContent),
    note ? (note.hidden ? '(hidden)' : note.textContent) : '(要素なし)');
  check('  解析ボタンは押せない（disabled）', doc.querySelector('#exStart').disabled === true);
  /* 押しても解析に進まない */
  doc.querySelector('#exStart').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  check('  解析ビューに遷移しない', doc.querySelector('#loadingView').hidden === true &&
    doc.querySelector('#resultView').hidden === true);

  /* 楽天カードを選ぶ → 楽天サンプルで解析が通る */
  const rkPath = path.join(DIR, '..', '..', '設計', '支払い明細から探す', 'SeiZen_sample_rakuten_6months_2026-03_to_08.csv');
  if (fs.existsSync(rkPath)) {
    const { window: w2 } = loadPage('extraction.html');
    const d2 = w2.document;
    /* 「登録済みから選ぶ」を開いてから手段を選ぶ（実際の導線） */
    d2.querySelector('#pickExisting').dispatchEvent(new w2.Event('click', { bubbles: true }));
    d2.querySelector('.exacct[data-acct="card-rakuten"]').dispatchEvent(new w2.Event('click', { bubbles: true }));
    const fi2 = d2.querySelector('input[type="file"]');
    const rkCsv = fs.readFileSync(rkPath, 'utf8');
    const f2 = new w2.File([rkCsv], 'rakuten.csv', { type: 'text/csv' });
    Object.defineProperty(fi2, 'files', { value: [f2], configurable: true });
    fi2.dispatchEvent(new w2.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    check('楽天カード選択時は注記なし・解析ボタン有効',
      d2.querySelector('#exFormatNote').hidden === true && d2.querySelector('#exStart').disabled === false);
    d2.querySelector('#exStart').dispatchEvent(new w2.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 800));
    const cands = [...d2.querySelectorAll('.excand-name > b')].map(e => e.textContent);
    check('  楽天カードの明細から候補が出る（Netflix 等）', cands.some(c => /Netflix/.test(c)), JSON.stringify(cands.slice(0, 5)));
  } else {
    check('楽天カードのサンプル CSV が存在する', false, rkPath + ' が無い');
  }
}

console.log('\n' + '═'.repeat(50));
console.log(`  PASS ${pass}  /  FAIL ${fail}`);
console.log('═'.repeat(50));
process.exit(fail ? 1 : 0);

})();
