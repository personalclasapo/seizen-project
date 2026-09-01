/* SeiZen プロトタイプ｜支払い明細から探す
   ------------------------------------------------------------------
   設計「支払い明細から探す」§3-4 / §3-5 / §12 / §13 に対応。

   1ページで3ステップを扱う。
     ① inputView … Step1（口座を選ぶ）と Step2（明細をアップロード）を
        上下に並べる。登録済み口座を1つ選び、Vpass CSV を1つ選ぶと
        「解析をはじめる」が押せる。
     ② loadingView … 解析表示。
     ③ resultView … Step3。パイプライン（payment/pipeline.js）の結果を
        単一リスト・金額降順で描く（§12-2）。
          A … サービス確定。チェックで登録対象
          B … どのサービスか選ばせる。選ぶと A 相当へ（§12-2）
          C … 名前（編集可）と対応時期を入力させる（§12-1）
          registered … 表示するがチェック不可（§11）
        「契約・デジタルに追加する」で選択分を登録し（§13）、その
        支払い手段を確認済みにする。

   解析パイプライン（ブラウザ内で完結・§15-2）：
        source/vpass.js → series.js → resolver.js → judge.js
        → reconcile.js → candidate → Step3 描画 → register.js
   マスタは payment/master.js（アプリ内静的＋実行時解決の書き戻し）。

   口座マスタ部分はプロトタイプ用の固定値。 */
(function (global) {
  'use strict';

  const C = global.SeiZenCatalog;
  const esc = global.SeiZen.esc;
  const Pipeline = global.SeiZenPaymentPipeline;
  const Master = global.SeiZenPaymentMaster;

  /* ── 登録済み口座のダミー ─────────────────────────────
     カードは contract-digital/state.js の cards と id をそろえる
     （既登録照合・支払い手段の上書きが id で効くように）。holder は
     §3-2「契約者名義は支払い手段の登録情報から」に対応。本番はサーバ共有。 */
  const BANK_ICON = '<path d="M3 21h18M4 10h16M5 10 12 4l7 6M6 10v10M18 10v10M10 10v10M14 10v10"/>';
  const CARD_ICON = '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>';
  const EMONEY_ICON = '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 15h4"/>';

  const ACCOUNTS = [
    { group: '銀行口座', icon: BANK_ICON, items: [
      { id: 'bank-jp-1', name: 'ゆうちょ銀行　通常貯金', sub: '記号番号 10000-12345678', holder: '父 太郎' }
    ]},
    { group: 'クレジットカード', icon: CARD_ICON, items: [
      { id: 'card-smbc',   name: '三井住友カード（NL）', sub: '下4桁 1234', holder: '父 太郎' },
      { id: 'card-rakuten', name: '楽天カード',          sub: '下4桁 5678', holder: '父 太郎' }
    ]},
    { group: '電子マネー・QR決済', icon: EMONEY_ICON, items: [
      { id: 'emoney-1', name: 'PayPay', sub: '携帯番号 090-****-**12', holder: '父 太郎' }
    ]}
  ];

  function findAccount(id) {
    for (const g of ACCOUNTS) {
      const it = g.items.find(x => x.id === id);
      if (it) return { acct: it, icon: g.icon, group: g.group };
    }
    return null;
  }

  /* ── 状態 ───────────────────────────────────────── */
  let sourceMode = null;         /* null（未選択）| 'existing' | 'new' */
  let acctId = null;             /* 選んだ登録済み口座の id */
  let fileName = null;           /* 選んだ明細のファイル名 */
  let fileText = null;           /* 選んだ明細ファイルの中身（CSV 文字列） */
  let lastResult = null;         /* 直近の解析結果 { candidates, ... } */

  /* Step3 の各行の作業状態。key は行 index。
       picked      … チェック済み（登録対象）
       choice      … B で選んだ service_id（'other' を含む）または null
       editedName  … C / Bその他 で編集した名前
       timing      … C / Bその他 で選んだ 'pre'|'post'|'unknown'      */
  let rowState = [];

  const TIMING_LABEL = { pre: 'いまのうち', post: 'そのとき', unknown: '分からない' };

  /* status → 行の小さなチップ。単一リスト・グループ分けはしない（§12-2）。
     A は「見つかった」ことが分かれば十分なのでチップは出さず、
     確認が要る B / C と、既登録だけにチップを出す。                 */
  const STATUS_CHIP = {
    B:          { text: '確認',     tone: 'warn' },
    C:          { text: '要入力',   tone: 'warn' },
    registered: { text: '登録済み', tone: 'muted' }
  };

  /* ── DOM ────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const inputView = $('inputView');
  const loadingView = $('loadingView');
  const resultView = $('resultView');
  const steps = $('exSteps');

  const pickExisting = $('pickExisting');   /* カード（＝押下領域） */
  const pickNew = $('pickNew');
  const panel = $('exPanel');
  const acctBox = $('exAccounts');
  const regForm = $('exRegForm');

  const selBox = $('exSelected');
  const selIc = $('exSelectedIc');
  const selName = $('exSelectedName');
  const selSub = $('exSelectedSub');

  const uploadBlock = $('uploadBlock');
  const drop = $('exDrop');
  const fileInput = $('exFile');
  const dropMain = $('exDropMain');
  const dropOr = $('exDropOr');
  const startBtn = $('exStart');

  const candBox = $('exCands');
  const backLink = $('exBack');
  const backTx = $('exBackTx');
  const lead = $('exLead');

  const LEAD_INPUT = '口座やカードの支払い明細をもとに、継続している可能性のあるサービスを見つけます。';
  const LEAD_RESULT = '明細から継続している可能性のあるサービス・支払いを見つけました。内容をご確認ください。';

  /* ── Step1：口座の入手方法 ─────────────────────────
     2択カード。デフォルトはどちらも未選択で下のパネルは出さない。
     ボタンを押すと、その中身をパネルに開く。
       existing … 登録済み口座のリスト
       new      … 口座の登録フォーム
     新規に切り替えたら、それまでの口座選択は解除する。            */
  function setSource(mode) {
    sourceMode = mode;
    const existing = mode === 'existing';
    pickExisting.classList.toggle('is-on', existing);
    pickNew.classList.toggle('is-on', mode === 'new');
    pickExisting.setAttribute('aria-pressed', String(existing));
    pickNew.setAttribute('aria-pressed', String(mode === 'new'));
    panel.hidden = mode === null;
    acctBox.hidden = mode !== 'existing';
    regForm.hidden = mode !== 'new';
    if (mode !== 'existing') { acctId = null; renderAccounts(); syncSelected(); }
    refreshStart();
  }
  pickExisting.addEventListener('click', () => setSource('existing'));
  pickNew.addEventListener('click', () => setSource('new'));

  function renderAccounts() {
    acctBox.innerHTML = ACCOUNTS.map(g =>
      '<div class="exacct-group">' +
        '<h4>' + esc(g.group) + '</h4>' +
        '<div class="exacct-list">' +
        g.items.map(it =>
          '<button type="button" class="exacct' + (it.id === acctId ? ' is-on' : '') +
            '" data-acct="' + esc(it.id) + '" role="radio" aria-checked="' + (it.id === acctId) + '">' +
            '<span class="exacct-radio"></span>' +
            '<span class="exacct-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
              'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + g.icon + '</svg></span>' +
            '<span class="exacct-tx"><b>' + esc(it.name) + '</b><small>' + esc(it.sub) + '</small></span>' +
          '</button>'
        ).join('') +
        '</div>' +
      '</div>'
    ).join('');
  }

  acctBox.addEventListener('click', e => {
    const btn = e.target.closest('[data-acct]');
    if (!btn) return;
    acctId = btn.dataset.acct;
    renderAccounts();
    syncSelected();
    refreshStart();
  });

  /* ── Step1：新しく口座を登録する ─────────────────────
     種別で、ラベルとプレースホルダ・支店欄の要否を切り替える。
     登録すると ACCOUNTS の該当グループへ足し、その口座を選択済みに
     して「登録済みから選ぶ」表示へ戻す（＝そのまま Step2 へ進める）。 */
  const regKind = $('regKind');
  const regName = $('regName');
  const regBranch = $('regBranch');
  const regNumber = $('regNumber');
  const regBranchRow = $('regBranchRow');
  let regKindValue = '銀行口座';

  const REG_LABELS = {
    '銀行口座':            { name: '金融機関名', namePh: '例：横浜銀行',      num: '口座番号',   numPh: '例：1234567',   branch: true },
    'クレジットカード':     { name: 'カード名',   namePh: '例：三井住友カード', num: 'カード番号下4桁', numPh: '例：4321', branch: false },
    '電子マネー・QR決済':  { name: 'サービス名', namePh: '例：PayPay',        num: '登録番号（任意）', numPh: '例：090-****-**12', branch: false }
  };
  const ICON_BY_KIND = { '銀行口座': BANK_ICON, 'クレジットカード': CARD_ICON, '電子マネー・QR決済': EMONEY_ICON };

  function applyRegKind() {
    const L = REG_LABELS[regKindValue];
    $('regNameLabel').textContent = L.name;
    regName.placeholder = L.namePh;
    $('regNumberLabel').textContent = L.num;
    regNumber.placeholder = L.numPh;
    regBranchRow.hidden = !L.branch;
    [...regKind.children].forEach(b => b.classList.toggle('on', b.dataset.kind === regKindValue));
  }

  regKind.addEventListener('click', e => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    regKindValue = b.dataset.kind;
    applyRegKind();
  });

  regForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = regName.value.trim();
    if (!name) { regName.focus(); global.SeiZen.toast('名称を入力してください'); return; }
    const L = REG_LABELS[regKindValue];
    const branch = L.branch ? regBranch.value.trim() : '';
    const num = regNumber.value.trim();
    const subParts = [];
    if (branch) subParts.push(branch);
    if (num) subParts.push((L.branch ? '口座番号 ' : '') + num);
    const id = 'acct-new-' + Date.now().toString(36);

    let grp = ACCOUNTS.find(g => g.group === regKindValue);
    if (!grp) { grp = { group: regKindValue, icon: ICON_BY_KIND[regKindValue], items: [] }; ACCOUNTS.push(grp); }
    grp.items.push({ id: id, name: name, sub: subParts.join('　') || '登録済み' });

    acctId = id;
    regForm.reset();
    regKindValue = '銀行口座';
    applyRegKind();
    setSource('existing');       /* 口座リスト表示へ戻す（新口座が選択済み） */
    renderAccounts();
    syncSelected();
    refreshStart();
    global.SeiZen.toast('「' + name + '」を登録しました');
    uploadBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  applyRegKind();

  /* ── Step2：選択中の口座とアップロード ───────────────── */
  function syncSelected() {
    const found = acctId ? findAccount(acctId) : null;
    if (!found) {
      selBox.hidden = true;
      drop.classList.add('is-disabled');
      return;
    }
    selBox.hidden = false;
    selIc.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + found.icon + '</svg>';
    selName.textContent = found.acct.name;
    selSub.textContent = '（' + found.group + '　' + found.acct.sub + '）';
    drop.classList.remove('is-disabled');
  }

  $('exChange').addEventListener('click', () => {
    inputView.querySelector('.exblock').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('exPick').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) readFile(fileInput.files[0]);
  });

  /* ドラッグ&ドロップ。実ファイルを読む。 */
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault();
    if (!drop.classList.contains('is-disabled')) drop.classList.add('is-drag');
  }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault();
    drop.classList.remove('is-drag');
  }));
  drop.addEventListener('drop', e => {
    if (drop.classList.contains('is-disabled')) return;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  /* CSV をブラウザ内で読む（サーバへは送らない・§27）。
     文字コードは UTF-8 前提。CP932 は今回のサンプルでは扱わない。 */
  function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => { setFile(file.name, String(reader.result || '')); };
    reader.onerror = () => { global.SeiZen.toast('ファイルを読み込めませんでした'); };
    reader.readAsText(file, 'UTF-8');
  }

  function setFile(name, text) {
    fileName = name;
    fileText = text;
    drop.classList.add('has-file');
    dropMain.textContent = name + ' を選択しました';
    dropOr.textContent = '別のファイルに変更するには、もう一度選択してください';
    refreshStart();
  }

  function refreshStart() {
    const ok = sourceMode === 'existing' && !!acctId && !!fileName && !!fileText;
    startBtn.disabled = !ok;
    setStep(acctId ? 2 : 1);
  }

  function setStep(n) {
    [...steps.children].forEach(li => {
      const s = Number(li.dataset.step);
      li.classList.toggle('done', s < n);
      li.classList.toggle('now', s === n);
    });
  }

  /* ── ビュー切替 ───────────────────────────────────
     Step1/2（inputView）と Step3（resultView）で、戻るリンクの文言と
     ヘッダーの説明文を切り替える。ヘッダーとステップ表示は共通。      */
  function showInput() {
    resultView.hidden = true;
    loadingView.hidden = true;
    inputView.hidden = false;
    backLink.href = 'index.html';
    backTx.textContent = '契約・デジタルに戻る';
    lead.textContent = LEAD_INPUT;
    refreshStart();
    window.scrollTo(0, 0);
  }
  function showResult() {
    inputView.hidden = true;
    loadingView.hidden = true;
    resultView.hidden = false;
    backLink.removeAttribute('href');     /* Step3 の戻るは inputView へ */
    backTx.textContent = '口座の選択に戻る';
    lead.textContent = LEAD_RESULT;
    setStep(3);
    renderResult();
    window.scrollTo(0, 0);
  }

  /* Step3 の戻るリンク（href なし）は inputView に戻す。 */
  backLink.addEventListener('click', e => {
    if (!backLink.getAttribute('href')) { e.preventDefault(); showInput(); }
  });

  /* ── 解析 → 結果 ───────────────────────────────────
     Vpass Adapter → Detection Engine を実行し、payment_candidate を得る。
     第1増分では固定ダミーを使わない。 */
  startBtn.addEventListener('click', () => {
    inputView.hidden = true;
    loadingView.hidden = false;
    window.scrollTo(0, 0);
    setStep(3);
    /* パイプラインは同期処理だが、解析中表示を一瞬見せてから走らせる。 */
    setTimeout(runAnalysis, 500);
  });

  $('exRestart').addEventListener('click', showInput);


  /* ── 解析 → 結果 ───────────────────────────────────
     payment/pipeline.js を1回呼ぶ。明細はブラウザ内で処理し、どこにも
     送らない（§15-2）。 */
  function runAnalysis() {
    const res = Pipeline.analyze(fileText, {
      adapter: 'vpass',
      paymentMethodId: acctId || null
    });
    if (!res.ok) {
      loadingView.hidden = true;
      inputView.hidden = false;
      global.SeiZen.toast('この明細を解析できませんでした：' + res.error);
      return;
    }
    lastResult = res;
    rowState = res.candidates.map(c => ({
      picked: false,                   /* 既定はチェックなし。ユーザーが選ぶ */
      choice: null,
      editedName: c.status === 'C' ? (c.merchant_name || c.series.merchant_raw) : '',
      timing: 'unknown'
    }));
    saveDebugResult(res);
    logDevReport(res);
    showResult();
  }

  /* ── Step3 のデバッグ復元（?debug=step3）─────────────
     解析結果を localStorage に保存し、次回以降 ?debug=step3 で開いたら
     アップロードを飛ばして直接 Step3 を描画する。プロトタイプの確認用。
     結果は payment/pipeline.js の出力そのものなので、パイプラインを
     変えたら一度アップロードし直して保存を更新すること。            */
  const DEBUG_KEY = 'seizen.payment.debug.step3.v1';

  function saveDebugResult(res) {
    try {
      localStorage.setItem(DEBUG_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        acctId: acctId || null,
        result: res
      }));
    } catch (e) { /* 容量超過等は無視 */ }
  }

  function tryDebugRestore() {
    const params = new URLSearchParams(location.search);
    if (params.get('debug') !== 'step3') return false;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(DEBUG_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || !saved.result || !Array.isArray(saved.result.candidates)) {
      global.SeiZen.toast('保存された解析結果がありません。一度アップロードして解析してください。');
      return false;
    }
    acctId = saved.acctId || acctId;
    lastResult = saved.result;
    rowState = lastResult.candidates.map(c => ({
      picked: false, choice: null,
      editedName: c.status === 'C' ? (c.merchant_name || c.series.merchant_raw) : '',
      timing: 'unknown'
    }));
    showResult();
    global.SeiZen.toast('保存済みの解析結果を表示しています（' +
      new Date(saved.savedAt).toLocaleString('ja-JP') + ' 時点）');
    return true;
  }

  /* ── 開発ログ（§6 報告事項の確認用）─────────────────
     画面には出さない。各系列がどの分岐で確定/破棄されたか、実行時
     解決に回った系列、§4 との差分をコンソールで追えるようにする。   */
  function logDevReport(res) {
    if (!global.console || !console.group) return;
    console.group('%c[支払い明細から探す] 解析結果', 'font-weight:bold');
    console.log('coverage:', res.coverage);
    console.log('adapter:', res.report.adapter);
    if (res.report.resolution.length) console.table(res.report.resolution);
    if (res.payment_method_hits.length) console.log('payment_method hits:', res.payment_method_hits);
    console.table(res.report.series);
    console.groupEnd();
  }

  $('exRestart').addEventListener('click', showInput);

  /* ── Step3 の描画 ───────────────────────────────────
     単一リスト・金額（amount_max）降順（§12-2）。行の中身は status で
     変わる。B/C は下に確認 UI を展開する。 */

  const LOGO_BY_MERCHANT = {
    'mch-netflix': 'netflix', 'mch-spotify': 'spotify', 'mch-apple': 'apple',
    'mch-microsoft': 'microsoft'
  };

  function brandSVG(key) {
    const path = key && C.LOGOS && C.LOGOS[key] ? C.LOGOS[key].path : null;
    return path ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="' + path + '"/></svg>' : null;
  }

  function candMark(name, merchantId) {
    const svg = brandSVG(LOGO_BY_MERCHANT[merchantId]);
    return '<span class="excand-mark">' +
      (svg || esc(String(name || '?').charAt(0))) + '</span>';
  }

  const CYCLE_LABEL = {
    monthly: '毎月', bimonthly: '隔月', single: '年1回'
  };
  function cycleLabel(c) {
    if (c.series.is_frequent && c.service_id) {
      const svc = Master.service(c.service_id);
      if (svc && svc.pricing_type === 'subscription_box') return '定期';
    }
    return CYCLE_LABEL[c.series.cycle] || c.series.cycle;
  }

  /* 金額の表示。変動系列は「¥6,000前後」の目安表記（§12-2）。 */
  function amountText(c) {
    const s = c.series;
    if (s.amount_is_fixed) return '¥' + s.amount_repr.toLocaleString('ja-JP');
    const mid = Math.round((s.amount_min + s.amount_max) / 2 / 100) * 100;
    return '¥' + mid.toLocaleString('ja-JP') + '前後';
  }

  /* 行の表示名。A はサービス名、B は請求主体名、C は編集中の名前。 */
  function rowTitle(c, st) {
    if (c.service_id) {
      const svc = Master.service(c.service_id);
      if (svc) return svc.name;
    }
    if (c.status === 'C') return st.editedName || c.merchant_name || c.series.merchant_raw;
    return c.merchant_name || c.series.merchant_raw;
  }

  /* 行が「登録対象として確定しているか」。
       A          … 常に可
       B（未選択）… 不可（まず選ぶ）
       C          … 名前があれば可                                    */
  function isActionable(c, st) {
    if (c.status === 'registered') return false;
    if (c.status === 'A') return true;
    if (c.status === 'B') return false;
    if (c.status === 'C') return !!(st.editedName || '').trim();
    return false;
  }

  /* この行の下に確認 UI（サービス選択／名前・時期）を出すか。 */
  function showsPick(c) { return c.status === 'B' || c._fromB; }
  function showsUnknown(c) { return c.status === 'C'; }

  function svgCheck() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-9"/></svg>';
  }

  function timingNote(c, st) {
    if (c.service_id) {
      const svc = Master.service(c.service_id);
      return TIMING_LABEL[svc && svc.post_mortem_procedure ? 'post' : 'pre'];
    }
    return st.timing && st.timing !== 'unknown' ? TIMING_LABEL[st.timing] : '未確認';
  }

  /* B：どのサービスか選ぶピル。options ＋「その他」。 */
  function pickBlock(c, i, st) {
    const opts = (c.options || []).map(o =>
      '<button type="button" class="excand-opt' + (st.choice === o.service_id ? ' on' : '') +
        '" data-row="' + i + '" data-choice="' + esc(o.service_id) + '">' + esc(o.name) + '</button>').join('');
    const other = '<button type="button" class="excand-opt' + (st.choice === 'other' ? ' on' : '') +
      '" data-row="' + i + '" data-choice="other">その他</button>';
    return '<div class="excand-pick">' +
      '<p class="excand-pick-lead">どのサービスの支払いですか</p>' +
      '<div class="excand-opts">' + opts + other + '</div></div>';
  }

  /* C（および B で「その他」）：名前 ＋ 対応時期。 */
  function unknownBlock(c, i, st) {
    const name = st.editedName || c.merchant_name || c.series.merchant_raw;
    const radios = ['pre', 'post', 'unknown'].map(k =>
      '<button type="button" class="exradio' + (st.timing === k ? ' on' : '') +
        '" data-row="' + i + '" data-timing="' + k + '">' +
        '<span class="exradio-dot"></span>' + esc(TIMING_LABEL[k]) + '</button>').join('');
    return '<div class="excand-period" style="display:flex;flex-direction:column;align-items:stretch;gap:10px">' +
      '<label style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<span class="excand-period-lb">名前</span>' +
        '<input type="text" class="exname-input" data-row="' + i + '" value="' + esc(name) + '" ' +
          'style="flex:1;min-width:180px;border:1px solid var(--line2);border-radius:9px;padding:8px 12px;font:inherit">' +
      '</label>' +
      '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<span class="excand-period-lb">対応時期</span>' +
        '<div class="exradio-group">' + radios + '</div>' +
      '</div></div>';
  }

  function candCardHTML(c, i) {
    const st = rowState[i];
    const isReg = c.status === 'registered';
    const needsInput = c.status === 'B' || c.status === 'C';
    const title = rowTitle(c, st);
    const actionable = isActionable(c, st);
    const showPick = showsPick(c);
    const showUnknown = showsUnknown(c);

    const cls = ['excand'];
    if (isReg) cls.push('is-reg');
    else if (needsInput) cls.push('is-check');
    else cls.push('is-ready');
    if (st.picked && !isReg) cls.push('is-picked');
    if (showPick || showUnknown) cls.push('is-open');

    const check = isReg
      ? '<span class="excand-check is-locked">' + svgCheck() + '</span>'
      : '<button type="button" class="excand-check" data-check="' + i + '"' +
          (actionable ? '' : ' disabled') +
          ' aria-label="' + esc(title) + ' を追加対象にする">' + svgCheck() + '</button>';

    const chip = STATUS_CHIP[isReg ? 'registered' : c.status];
    const chipHTML = chip
      ? '<span class="excand-chip ' + chip.tone + '">' + esc(chip.text) + '</span>' : '';

    /* §13-2：同名のサービスが別の支払い手段で既に登録されている。
       同一なら支払い手段の情報を更新、別物ならそのまま新規追加。
       どちらかは中身を見ないと分からないので、その旨だけ添える。 */
    const pmNote = c.payment_method_change
      ? '<p class="excand-note">同じ名前のサービスが、別の支払い手段で登録されています。' +
          '中身が同じならこの支払い手段に付け替え、別のものなら新しく追加します。</p>'
      : '';

    const figs =
      '<span class="excand-figs">' +
        '<span class="excand-fig"><small>金額</small><b>' + esc(amountText(c)) + '</b></span>' +
        '<span class="excand-fig"><small>周期</small><b>' + esc(cycleLabel(c)) + '</b></span>' +
        '<span class="excand-fig"><small>対応時期</small><b>' + esc(timingNote(c, st)) + '</b></span>' +
      '</span>';

    const row =
      '<div class="excand-row">' + check +
        candMark(title, c.merchant_id) +
        '<span class="excand-name"><b>' + esc(title) + '</b>' + chipHTML +
          '<span class="excand-src">' + esc(c.series.merchant_raw) + '</span></span>' +
        figs +
      '</div>';

    let body = '';
    if (showPick) body += pickBlock(c, i, st);
    if (showUnknown) body += unknownBlock(c, i, st);

    return '<div class="' + cls.join(' ') + '" data-card="' + i + '">' + row + pmNote + body + '</div>';
  }

  function renderResult() {
    const cands = lastResult.candidates;
    const empty = cands.length === 0;
    candBox.innerHTML = empty
      ? '<p class="cf-count-note">継続している可能性がある支払いは見つかりませんでした。</p>'
      : cands.map(candCardHTML).join('');

    const listNote = document.querySelector('.exlist-note');
    if (listNote) listNote.hidden = empty;
    const summary = $('exSummary');
    if (summary) summary.hidden = empty;

    updateSummary();
    renderPaymentMethodHits();

    const cov = lastResult.coverage;
    const covNote = $('exCoverageNote');
    if (covNote) {
      covNote.textContent = (cov.coverage_from && cov.coverage_to)
        ? '対象期間 ' + cov.coverage_from + ' 〜 ' + cov.coverage_to
        : '対象期間を明細から特定できませんでした';
    }
  }

  /* 一括チェックの対象になり得る行（registered を除く actionable 行）。 */
  function selectableIndexes() {
    return lastResult.candidates
      .map((c, i) => ({ c, i, st: rowState[i] }))
      .filter(x => x.c.status !== 'registered' && isActionable(x.c, x.st))
      .map(x => x.i);
  }

  function updateSummary() {
    const cands = lastResult.candidates;
    const shown = cands.filter(c => c.status !== 'registered').length;
    const picked = rowState.filter((s, i) => s.picked && cands[i].status !== 'registered').length;
    $('sumTotal').textContent = cands.length;
    $('sumReady').textContent = picked;
    $('sumCheck').textContent = Math.max(0, shown - picked);

    const toggle = $('exSelectAll');
    if (toggle) {
      const sel = selectableIndexes();
      const allOn = sel.length > 0 && sel.every(i => rowState[i].picked);
      $('exSelectAllLabel').textContent = allOn ? 'すべて外す' : 'すべて選ぶ';
      toggle.disabled = sel.length === 0;
      toggle.dataset.mode = allOn ? 'off' : 'on';
    }
    const btn = $('exCommit');
    if (btn) btn.disabled = picked === 0;
  }

  const selectAllBtn = $('exSelectAll');
  if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
    const on = selectAllBtn.dataset.mode !== 'off';
    selectableIndexes().forEach(i => { rowState[i].picked = on; });
    renderResult();
  });

  /* §3-4：payment_method を検出したときの案内（候補リストとは別）。 */
  function renderPaymentMethodHits() {
    const box = $('exPmHits');
    if (!box) return;
    const hits = lastResult.payment_method_hits || [];
    if (!hits.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = hits.map(h =>
      '<p class="cf-count-note">この明細から、' + esc(h.merchant_name) +
      'への支払いが見つかりました。そのカードの明細もアップロードすると、配下の契約を確認できます。</p>').join('');
  }

  /* ── Step3 の操作 ─────────────────────────────────── */
  candBox.addEventListener('click', e => {
    /* 行のどこを押してもチェックが切り替わる（チェック可能な行のみ）。
       サービス選択ピル・時期ラジオ・名前入力の上では切り替えない。 */
    const row = e.target.closest('.excand-row');
    if (row && !e.target.closest('[data-choice],[data-timing],.exname-input,[data-check]')) {
      const card = row.closest('[data-card]');
      const i = card ? +card.dataset.card : -1;
      if (i >= 0 && isActionable(lastResult.candidates[i], rowState[i]) &&
          lastResult.candidates[i].status !== 'registered') {
        rowState[i].picked = !rowState[i].picked;
        rerenderCard(i);
        updateSummary();
      }
      return;
    }
    const chk = e.target.closest('[data-check]');
    if (chk && !chk.disabled) {
      const i = +chk.dataset.check;
      rowState[i].picked = !rowState[i].picked;
      rerenderCard(i);
      updateSummary();
      return;
    }
    const opt = e.target.closest('[data-choice]');
    if (opt) {
      const i = +opt.dataset.row;
      rowState[i].choice = opt.dataset.choice;
      /* B を選んだ時点で既登録照合（§11）。'other' は C 扱いなので照合しない。
         選択後は A（または registered）相当の見た目にしつつ、選び直せる
         よう options とピルは残す（_fromB）。 */
      const orig = lastResult.candidates[i];
      if (opt.dataset.choice !== 'other') {
        let cand = Pipeline.resolveChoice(orig, opt.dataset.choice);
        cand = Pipeline.reconcileOne(cand, acctId || null);
        lastResult.candidates[i] = Object.assign({}, cand, {
          status: cand.status === 'registered' ? 'registered' : 'A',
          options: orig.options, _fromB: true, _resolved: cand
        });
        rowState[i].picked = cand.status !== 'registered';
      } else {
        lastResult.candidates[i] = Object.assign({}, orig, {
          status: 'C', options: orig.options, _fromB: true, _resolved: null,
          service_id: null
        });
        rowState[i].editedName = rowState[i].editedName || orig.merchant_name || orig.series.merchant_raw;
        rowState[i].picked = false;
      }
      rerenderCard(i);
      updateSummary();
      return;
    }
    const rad = e.target.closest('[data-timing]');
    if (rad) {
      const i = +rad.dataset.row;
      rowState[i].timing = rad.dataset.timing;
      rerenderCard(i);
      updateSummary();
      return;
    }
  });

  candBox.addEventListener('input', e => {
    const inp = e.target.closest('.exname-input');
    if (!inp) return;
    const i = +inp.dataset.row;
    const was = (rowState[i].editedName || '').trim();
    rowState[i].editedName = inp.value;
    const now = inp.value.trim();
    /* 空⇄非空でチェック可否が変わるときだけ再描画（カーソル位置を復元）。
       それ以外は要約のみ更新してカーソルを保つ。 */
    if (!!was !== !!now) {
      const pos = inp.selectionStart;
      rerenderCard(i);
      const next = candBox.querySelector('[data-card="' + i + '"] .exname-input');
      if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (_) {} }
    }
    updateSummary();
  });

  function rerenderCard(i) {
    const el = candBox.querySelector('[data-card="' + i + '"]');
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = candCardHTML(lastResult.candidates[i], i);
    el.replaceWith(tmp.firstElementChild);
  }

  /* ── 登録（§13）─────────────────────────────────────
     チェック済みの行を register.write へ。B は選択後の service で、
     C は編集名と選んだ対応時期で登録する。                          */
  const commitBtn = $('exCommit');
  if (commitBtn) commitBtn.addEventListener('click', () => {
    const acct = acctId ? findAccount(acctId) : null;
    const holderName = acct && acct.acct && acct.acct.holder ? acct.acct.holder
      : (acct ? '' : '');

    const selections = [];
    lastResult.candidates.forEach((c, i) => {
      const st = rowState[i];
      if (!st.picked || c.status === 'registered') return;
      if (!isActionable(c, st)) return;

      if (c.service_id) {
        /* A、または B で service を選んで A 相当になったもの */
        selections.push({ candidate: c._resolved || c });
      } else {
        /* C、または B で「その他」：名前・対応時期をユーザー入力から */
        selections.push({
          candidate: Object.assign({}, c, { status: 'C', service_id: null }),
          editedName: (st.editedName || '').trim(),
          chosenTiming: st.timing
        });
      }
    });

    if (!selections.length) { global.SeiZen.toast('登録するサービスを選んでください'); return; }

    const out = Pipeline.commit(selections, { paymentMethodId: acctId || null, holderName: holderName });
    const n = out.added.length + (out.updated ? out.updated.length : 0);
    global.SeiZen.toast(n + '件を契約・デジタルに登録しました');
    markSourceDone();
    showDone(out);
  });

  /* 登録後：その支払い手段を「確認済み」にする（§13 末尾）。
     プロトタイプではセッション内フラグ。本番は支払い手段マスタへ。 */
  const doneSources = new Set();
  function markSourceDone() { if (acctId) doneSources.add(acctId); }

  function showDone(out) {
    const lines = [];
    if (out.added.length)  lines.push('新しく登録：' + out.added.join('、'));
    if (out.updated && out.updated.length) lines.push('支払い手段を更新：' + out.updated.join('、'));
    if (out.skipped && out.skipped.length) lines.push('すでに登録済み：' + out.skipped.join('、'));
    candBox.innerHTML =
      '<div class="excand is-ready"><div class="excand-row">' +
        '<span class="excand-mark">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m5 12 5 5 9-9"/></svg></span>' +
        '<span class="excand-name"><b>登録しました</b>' +
          '<span class="excand-src">' + esc(lines.join(' / ') || '変更はありませんでした') + '</span></span>' +
      '</div></div>' +
      '<p class="cf-count-note">この支払い手段について、継続している支払いの確認は完了です。' +
        '<a href="index.html">契約・デジタルの一覧を見る</a></p>';
    const commit = $('exCommit');
    if (commit) commit.hidden = true;
    const s = $('exSummary'); if (s) s.hidden = true;
    const pm = $('exPmHits'); if (pm) pm.hidden = true;
    const ln = document.querySelector('.exlist-note'); if (ln) ln.hidden = true;
  }

  /* ── 初期化 ─────────────────────────────────────── */
  renderAccounts();
  syncSelected();
  setSource(null);   /* デフォルトはどちらも未選択。パネルは出さない。 */
  tryDebugRestore(); /* ?debug=step3 なら保存済み結果で Step3 を描く */
})(window);
