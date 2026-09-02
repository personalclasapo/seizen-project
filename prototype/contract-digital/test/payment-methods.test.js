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
  check('  coverage_from / coverage_to が入る', sc.coverage_from === '2026-03-01' && sc.coverage_to === '2026-08-31');
  check('coverage 省略でも記録できる',
    S.markStatementChecked('bank-jp-1') === true &&
    S.findPaymentMethod('bank-jp-1').statement_checked.coverage_from === null);
  check('保存に paymentMethods と確認記録が含まれる',
    (session.getItem('seizen.contract.v1') || '').includes('statement_checked') &&
    session.getItem('seizen.contract.v1').includes('2026-03-01'));

  /* 同じ session を渡してリロード */
  const { window: w2 } = loadPage('index.html', { session });
  const sc2 = w2.SeiZenContract.findPaymentMethod('card-smbc').statement_checked;
  check('リロード後も確認記録が残る', !!sc2 && sc2.coverage_from === '2026-03-01');
}

/* ══ 3. 旧スキーマの保存からの読み込み ════════════════════════
   旧保存は cards キーで、kind も口座・電子マネーも持たない。写しとして
   使えないので state.js は破棄し、seed の paymentMethods を使う。
   契約（items）は復元する。プロトタイプのセッション限りデータなので
   支払い手段の写しが飛んでも実害はない、という設計。 */
console.log('\n■ 3. 旧スキーマの保存からの読み込み');
{
  const legacy = mkStore({
    'seizen.contract.v1': JSON.stringify({
      items: [{
        id: 'svc-legacy', no: '099', name: '昔追加したサービス', category: '未分類', group: 'pre',
        added: true, registered: '2025.01.01', updated: '2025.01.01',
        policy: { intent: 'unknown', reason: '', nextTiming: '' }, account: [],
        contract: { holder: '父 太郎', paymentCard: 'card-old', amount: 500, cycle: 'monthly', source: 'statement' },
        procedure: { checked: false, where: '', steps: [], link: '', point: '' }, memo: '', domain: 'contract_digital'
      }],
      cards: [{ id: 'card-old', name: '旧カード', group: 'card' }],  /* kind なし＝旧スキーマ */
      nextNo: 200
    })
  });
  const { window, errors } = loadPage('index.html', { session: legacy });
  const S = window.SeiZenContract;
  check('  JS エラーなし（壊れた参照でも落ちない）', errors.length === 0, errors.slice(0, 2).join(' | '));
  check('旧スキーマの paymentMethods は使わず seed に戻す（card2/bank/emoney）',
    S.paymentMethods.length === 4 && S.paymentMethods.every(m => m.kind),
    S.paymentMethods.map(m => m.id).join(','));
  check('契約（items）は復元される', !!S.findItem('svc-legacy'));
  check('壊れた paymentCard 参照（card-old）でも paymentDisplay は落ちない',
    typeof S.paymentDisplay(S.findItem('svc-legacy')) === 'string');
}

/* ══ 3b. 新スキーマの保存はそのまま復元される ══════════════ */
console.log('\n■ 3b. 新スキーマの保存の復元');
{
  const { window: w1, session } = loadPage('index.html');
  w1.SeiZenContract.markStatementChecked('emoney-1', { from: '2026-02-01', to: '2026-07-31' });
  const { window: w2 } = loadPage('index.html', { session });
  const S = w2.SeiZenContract;
  check('新スキーマ（kind あり）はそのまま復元', S.paymentMethods.length === 4 && S.paymentMethods.every(m => m.kind));
  check('  PayPay の確認記録が残る',
    (S.findPaymentMethod('emoney-1').statement_checked || {}).coverage_from === '2026-02-01');
}

/* ══ 4. render.js：支払いのつながり（全手段）════════════════ */
console.log('\n■ 4. render.js：支払いのつながり（全手段）');
{
  const { window, errors } = loadPage('index.html');
  check('JS エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
  const doc = window.document;
  const faces = txt([...doc.querySelectorAll('.paycard .pc-h b')]);
  check('カード・口座・電子マネー全部の券面が出る',
    faces.some(f => /楽天/.test(f)) && faces.some(f => /三井住友/.test(f)) &&
    faces.some(f => /ゆうちょ/.test(f)) && faces.some(f => /PayPay/.test(f)),
    JSON.stringify(faces));
  const warns = txt([...doc.querySelectorAll('.pc-warn')]).map(clean);
  check('カードは「このカードを止めると」', warns.some(t => /このカードを止めると/.test(t)));
  check('口座は「この口座が凍結されると」', warns.some(t => /この口座が凍結されると/.test(t)));
  check('電子マネーは「この決済を止めると」', warns.some(t => /この決済を止めると/.test(t)));
  const faceClasses = [...doc.querySelectorAll('.pc-face')].map(e => e.className);
  check('券面クラスが kind 別（pf-bank / pf-paypay を含む）',
    faceClasses.some(c => /pf-bank/.test(c)) && faceClasses.some(c => /pf-paypay/.test(c)), JSON.stringify(faceClasses));
  check('経路件数が 4', clean(doc.querySelector('.ib-pay .n-pay').textContent).includes('4'));
}

/* ══ 5. render.js：確認済みバッジ ════════════════════════════ */
console.log('\n■ 5. render.js：確認済みバッジ');
{
  const { window, session } = loadPage('index.html');
  window.SeiZenContract.markStatementChecked('card-rakuten', { from: '2026-01-01', to: '2026-06-30' });
  const { window: w2 } = loadPage('index.html', { session });
  const badges = txt([...w2.document.querySelectorAll('.pc-checked')]).map(clean);
  check('楽天カードに「明細確認済み（期間）」バッジ',
    badges.some(t => /明細確認済み/.test(t) && /2026-01-01/.test(t)), JSON.stringify(badges));
  check('bank-jp-1 の券面ボタンが存在', !!w2.document.querySelector('.paycard[data-open="bank-jp-1"]'));
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
  check('  バッジに「確認済み（期間）」', doneBadge.some(t => /確認済み/.test(t) && /2026-03-01/.test(t)), JSON.stringify(doneBadge));
}

/* ══ 7. アップロード → 登録 → 確認済み記録 ══════════════════ */
console.log('\n■ 7. アップロード → 登録 → 確認済み記録');
{
  const { window, errors } = loadPage('extraction.html');
  check('JS エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
  const S = window.SeiZenContract;
  const doc = window.document;

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
  check('  確認記録の期間が明細の coverage（2026-03-01〜2026-08-31）',
    sc && sc.coverage_from === '2026-03-01' && sc.coverage_to === '2026-08-31', JSON.stringify(sc));
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

console.log('\n' + '═'.repeat(50));
console.log(`  PASS ${pass}  /  FAIL ${fail}`);
console.log('═'.repeat(50));
process.exit(fail ? 1 : 0);

})();
