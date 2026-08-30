/* SeiZen プロトタイプ｜支払い明細から探す（第1実装増分）
   ------------------------------------------------------------------
   1ページで3ステップを扱う。
     ① inputView … Step1（口座を選ぶ）と Step2（明細をアップロード）を
        上下に並べる。登録済み口座を1つ選び、実際の Vpass CSV を
        1つ選ぶと「解析をはじめる」が押せる。
     ② loadingView … 解析表示。
     ③ resultView … Step3。実解析結果（payment_candidate）から
        サービス・支払い系列単位で描画する。第1増分では契約・デジタルへの
        実登録・対応時期の選択 UI は持たない（対応時期は導出結果を表示のみ）。

   「解析をはじめる」以降は、固定ダミーではなく解析パイプライン：
        Vpass Adapter（payment-adapter-vpass.js）
        → Detection Engine（payment-engine.js）
        → payment_candidate → Step3 描画
   をブラウザ内で実行する。知識 DB は payment-knowledge.js（アプリ内静的）。

   口座マスタ部分は従来どおりプロトタイプ用の固定値。 */
(function (global) {
  'use strict';

  const C = global.SeiZenCatalog;
  const esc = global.SeiZen.esc;
  const VpassAdapter = global.SeiZenVpassAdapter;
  const Engine = global.SeiZenPaymentEngine;
  const KB = global.SeiZenPaymentKnowledge;

  /* ── 登録済み口座のダミー ─────────────────────────────
     銀行は bank-account/state.js と同じ内容（あちらは保存しない設計で
     契約側から読めないため、ここへ再掲）。本番はサーバ共有。      */
  const BANK_ICON = '<path d="M3 21h18M4 10h16M5 10 12 4l7 6M6 10v10M18 10v10M10 10v10M14 10v10"/>';
  const CARD_ICON = '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>';
  const EMONEY_ICON = '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 15h4"/>';

  const ACCOUNTS = [
    { group: '銀行口座', icon: BANK_ICON, items: [
      { id: 'bank-smbc-1', name: '三井住友銀行　普通預金', sub: '渋谷支店　口座番号 1234567' },
      { id: 'bank-smbc-2', name: '三井住友銀行　普通預金', sub: '渋谷支店　口座番号 7654321' },
      { id: 'bank-jp-1',   name: 'ゆうちょ銀行　通常貯金', sub: '記号番号 10000-12345678' }
    ]},
    { group: 'クレジットカード', icon: CARD_ICON, items: [
      { id: 'card-1', name: '三井住友カード（NL）', sub: '下4桁 4321' },
      { id: 'card-2', name: '楽天カード', sub: '下4桁 8765' }
    ]},
    { group: '電子マネー・QR決済', icon: EMONEY_ICON, items: [
      { id: 'emoney-1', name: 'PayPay', sub: '携帯番号 090-****-**12' }
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
  let lastResult = null;         /* 直近の解析結果 { scan, candidates } */

  const TIMING_LABEL = { pre: 'いまのうち', post: 'そのとき' };

  /* Step3 の状態 → 見出しの言い回し。engine の step3View.state と対応。 */
  const STATE_UI = {
    found:           { badge: '継続利用として見つかりました', tone: 'ok',
                       note: '明細から継続利用のサービスを特定しました。' },
    confirm_contract:{ badge: '継続して利用しているか確認',   tone: 'warn',
                       note: '継続契約かどうか、ご本人・ご家族に確認が必要です。' },
    confirm_service: { badge: 'どのサービスか確認が必要',     tone: 'warn',
                       note: '請求主体までは特定できましたが、サービスが複数考えられます。' },
    confirm_unknown: { badge: '内容の確認が必要',             tone: 'warn',
                       note: '内容をご本人・ご家族に確認が必要です。' },
    domain_unknown:  { badge: '内容の確認が必要な発見',       tone: 'warn',
                       note: '継続利用の可能性はありますが、SeiZen で扱う領域か確認が必要です。' }
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

  function runAnalysis() {
    const parsed = VpassAdapter.parse(fileText, { payment_source_id: acctId || 'card-unknown' });
    if (!parsed.ok) {
      loadingView.hidden = true;
      inputView.hidden = false;
      global.SeiZen.toast('この明細を解析できませんでした：' + parsed.error);
      return;
    }
    const result = Engine.run(parsed.transactions, {
      coverage: parsed.coverage,
      scan_id: 'scan-' + Date.now().toString(36),
      target_person_id: 'target-current'
    });
    lastResult = { scan: result.scan, candidates: result.candidates, adapter: parsed.meta };
    logDevReport(lastResult);
    showResult();
  }

  /* ── 開発ログ（§23） ─────────────────────────────────
     受入結果が「どの証拠でその状態になったか」を確認できることが目的。
     description_raw・元CSV行・不要な生明細は出さない。 */
  function logDevReport(res) {
    if (!global.console || !console.group) return;
    console.group('%c[支払い明細から探す] 解析結果', 'font-weight:bold');
    console.log('scan:', res.scan);
    console.log('adapter:', res.adapter);
    const table = res.candidates.map(c => ({
      candidate_id: c.candidate_id,
      billing_entity_id: c.billing_entity_id || ('ms:' + (c.merchant_signature || '')),
      identified_service_id: c.identified_service_id || '',
      candidate_service_ids: (c.candidate_service_ids || []).join(','),
      service_identification: c.service_identification,
      contract_assessment: c.contract_assessment,
      domain_status: c.domain_status,
      observed_cycle: c.observed_cycle,
      amount_behavior: c.amount_behavior,
      representative_amount: c.representative_amount,
      occurrences: c.occurrence_count,
      derived_response_class: c.derived_response_class || '',
      derived_response_timing: c.derived_response_timing || '',
      step3: Engine.step3View(c).show ? Engine.step3View(c).state : '(非表示)'
    }));
    console.table(table);
    res.candidates.forEach(c => {
      console.log(
        '%c' + (c.billing_entity_name || c.merchant_signature || c.candidate_id),
        'font-weight:bold',
        '\n  service_identification:', c.service_identification,
        '\n  contract_assessment  :', c.contract_assessment,
        '\n  domain_status        :', c.domain_status,
        '\n  series_signature     :', c.group_key,
        '\n  reason_codes         :', c.reason_codes
      );
    });
    console.groupEnd();
  }

  /* ── Step3 の描画 ─────────────────────────────────── */
  function brandSVG(iconKey) {
    const path = iconKey && C.LOGOS && C.LOGOS[iconKey] ? C.LOGOS[iconKey].path : null;
    return path
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="' + path + '"/></svg>'
      : null;
  }

  /* billing_entity_id / service_id → ロゴキー（catalog.js の LOGOS）。 */
  const LOGO_BY_ENTITY = {
    'be-netflix': 'netflix', 'be-spotify': 'spotify', 'be-apple': 'apple',
    'be-microsoft': 'microsoft', 'be-amazon': 'amazon'
  };

  function candMark(name, entityId) {
    const svg = brandSVG(LOGO_BY_ENTITY[entityId]);
    return svg
      ? '<span class="excand-mark">' + svg + '</span>'
      : '<span class="excand-mark">' + esc(String(name || '?').charAt(0)) + '</span>';
  }

  function cycleLabel(cyc) {
    return ({
      WEEKLY: '毎週', MONTHLY: '毎月', BIMONTHLY: '隔月', QUARTERLY: '3か月ごと',
      SEMIANNUAL: '半年ごと', ANNUAL: '毎年', IRREGULAR: '不定期',
      INSUFFICIENT_DATA: '1回のみ'
    })[cyc] || cyc;
  }

  /* 系列の表示名。identified はサービス名、candidates は請求主体名、
     未特定は billing_entity 名 or 安全な正規化表記（生摘要は使わない）。 */
  function candTitle(c) {
    if (c.service_identification === 'identified' && c.identified_service_id) {
      const s = KB.SERVICE_MASTER[c.identified_service_id];
      if (s) return s.service_name;
    }
    if (c.billing_entity_name) return c.billing_entity_name + 'の支払い';
    return c.merchant_signature || '不明な支払い';
  }

  /* candidates のときに出す「考えられるサービス」（表示のみ・選択させない）。 */
  function candServiceNames(c) {
    return (c.candidate_service_ids || [])
      .map(sid => (KB.SERVICE_MASTER[sid] || {}).service_name)
      .filter(Boolean);
  }

  function timingText(c) {
    if (c.derived_response_timing && TIMING_LABEL[c.derived_response_timing]) {
      return TIMING_LABEL[c.derived_response_timing];
    }
    return '確認できていません';
  }

  function candCardHTML(c) {
    const view = Engine.step3View(c);
    const ui = STATE_UI[view.state] || STATE_UI.confirm_unknown;
    const title = candTitle(c);
    const svcNames = candServiceNames(c);

    const stateBadge =
      '<span class="excand-state ' + ui.tone + '"><span class="lbl">' +
      (ui.tone === 'ok'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m5 12 5 5 9-9"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.01"/></svg>') +
      esc(ui.badge) + '</span>' +
      '<small>' + esc(ui.note) + '</small></span>';

    const figs =
      '<span class="excand-figs">' +
        '<span class="excand-fig"><small>代表金額</small><b>¥' + Number(c.representative_amount || 0).toLocaleString('ja-JP') + '</b></span>' +
        '<span class="excand-fig"><small>周期</small><b>' + esc(cycleLabel(c.observed_cycle)) + '</b></span>' +
        '<span class="excand-fig"><small>対応時期</small><b>' + esc(timingText(c)) + '</b></span>' +
      '</span>';

    const row =
      '<div class="excand-row">' +
        candMark(title, c.billing_entity_id) +
        '<span class="excand-name"><b>' + esc(title) + '</b>' +
          '<span class="excand-src">' + esc(c.display_descriptor) + '</span></span>' +
        figs +
        stateBadge +
      '</div>';

    /* candidates：考えられるサービスを表示のみ（選択 UI は持たない）。 */
    let detail = '';
    if (view.state === 'confirm_service' && svcNames.length) {
      detail = '<div class="excand-pick" style="display:block">' +
        '<p class="excand-pick-lead">考えられるサービス（どれかはご本人・ご家族への確認が必要です）</p>' +
        '<div class="excand-opts">' +
        svcNames.map(n => '<span class="excand-opt">' + esc(n) + '</span>').join('') +
        '</div></div>';
    }

    const cls = ['excand', ui.tone === 'ok' ? 'is-ready' : 'is-check'];
    return '<div class="' + cls.join(' ') + '">' + row + detail + '</div>';
  }

  function renderResult() {
    const shown = lastResult.candidates.filter(c => Engine.step3View(c).show);
    const ok = shown.filter(c => Engine.step3View(c).state === 'found').length;
    const check = shown.length - ok;

    $('sumTotal').textContent = shown.length;
    $('sumReady').textContent = ok;
    $('sumCheck').textContent = check;

    candBox.innerHTML = shown.length
      ? shown.map(candCardHTML).join('')
      : '<p class="cf-count-note">継続利用の可能性がある支払いは見つかりませんでした。</p>';

    /* 対象期間の観測事実（§34：断定しない）。 */
    const cov = lastResult.scan;
    const covNote = $('exCoverageNote');
    if (covNote) {
      covNote.textContent = (cov.coverage_from && cov.coverage_to)
        ? '対象期間：' + cov.coverage_from + ' 〜 ' + cov.coverage_to +
          '（この期間の明細から判定しています）'
        : '対象期間を明細から特定できませんでした。';
    }
  }

  /* ── 初期化 ─────────────────────────────────────── */
  renderAccounts();
  syncSelected();
  setSource(null);   /* デフォルトはどちらも未選択。パネルは出さない。 */
})(window);
