/* SeiZen プロトタイプ｜サービスを追加（サービスから探す／確認）
   ------------------------------------------------------------------
   2画面を1ページで持つ。
     ① catalogView … catalog.js の索引を7枚のカードで描き、チェックで
        選ぶ。検索はカテゴリ名・小見出し・項目名を横断してテキスト一致で
        絞る。ヒットしない語は、そのまま「〇〇を追加する」で候補に足せる。
     ② confirmView … 選んだサービスを一覧し、1件ずつ対応時期
        （いまのうち／そのとき／分からない）を選ばせる。既に一覧に
        あるサービスは「登録済み」を出し、現在の時期を固定表示する。
        すべての新規サービスで時期を選ぶと「サービスを追加する」が
        押せる。押すと state.js に反映し、一覧画面へ遷移する。       */
(function (global) {
  'use strict';

  const { CATALOG } = global.SeiZenCatalog;
  const S = global.SeiZenContract;

  const grid = document.getElementById('cataloggrid');
  const searchInput = document.getElementById('catalogSearch');
  const selDock = document.getElementById('selDock');
  const selCountText = document.getElementById('selCountText');
  const selConfirmBtn = document.getElementById('selConfirmBtn');
  const expandAllBtn = document.getElementById('expandAllBtn');
  const expandAllText = document.getElementById('expandAllText');
  const expandAllIcon = document.getElementById('expandAllIcon');

  const catalogView = document.getElementById('catalogView');
  const confirmView = document.getElementById('confirmView');
  const addRow = document.getElementById('catalogAddRow');
  const addTerm = document.getElementById('catalogAddTerm');

  const cfList = document.getElementById('cfList');
  const cfCount = document.getElementById('cfCount');
  const cfCountInline = document.getElementById('cfCountInline');
  const cfSubmit = document.getElementById('cfSubmit');
  const cfHint = document.getElementById('cfHint');
  const cfClear = document.getElementById('cfClear');

  /* トグルの2状態のアイコン。 */
  const ICON_EXPAND   = '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>';
  const ICON_COLLAPSE = '<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>';

  /* 選択の実体。キーはチェックボックスの id（カタログ項目）か
     'free:' + 名前（自由入力）。値は { label, period }。
       period … 'pre' | 'post' | 'undecided' | null（未選択）
     カタログのチェックと確認画面は、この1つの Map を共有する。   */
  const selected = new Map();

  const PERIODS = [
    { value: 'pre',       label: 'いまのうち' },
    { value: 'post',      label: 'そのとき' },
    { value: 'undecided', label: '分からない' }
  ];

  /* 既存レコード（seed も追加済みも）と名前一致するか。 */
  function existing(label) {
    return S.hasService(label);
  }
  /* 既存の場合、その対応時期（group）。詳細画面の group をそのまま。 */
  function existingPeriod(label) {
    const n = label.trim().toLowerCase();
    const it = S.items.find(x => x.name.trim().toLowerCase() === n);
    return it ? it.group : null;
  }
  function periodLabel(v) {
    const p = PERIODS.find(x => x.value === v);
    if (p) return p.label;
    return v === 'undecided' ? '時期未定' : v;
  }

  /* ── ①カタログ ─────────────────────────────────────── */

  function renderCount() {
    const n = selected.size;
    selCountText.textContent = n + '件';
    selDock.classList.toggle('is-empty', n === 0);
  }

  function itemRow(cardId, groupIdx, kind, itemIdx, label) {
    const cid = 'chk-' + cardId + '-' + groupIdx + '-' + kind + '-' + itemIdx;
    const hidden = kind === 'more' ? ' hidden' : '';
    const on = selected.has(cid) ? ' checked' : '';
    return '<label class="citem citem-' + kind + '" for="' + cid + '"' + hidden +
      ' data-text="' + label.toLowerCase() + '">' +
      '<input type="checkbox" id="' + cid + '" data-label="' + label + '"' + on + '>' +
      '<span class="cbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-9"/></svg></span>' +
      '<span class="clabel">' + label + '</span></label>';
  }

  function groupBlock(cardId, groupIdx, group) {
    const base = group.items.map((label, i) => itemRow(cardId, groupIdx, 'base', i, label)).join('');
    const more = (group.more || []).map((label, i) => itemRow(cardId, groupIdx, 'more', i, label)).join('');
    const moreText = (group.more || []).join(' ').toLowerCase();
    return '<div class="cgroup" data-text="' + group.label.toLowerCase() + ' ' + moreText + '">' +
      '<p class="cgroup-h">' + group.label + '</p>' + base + more + '</div>';
  }

  function cardHTML(entry) {
    const hasMore = entry.groups.some(g => g.more && g.more.length);
    const moreBtn = hasMore
      ? '<button type="button" class="cmorebtn" data-target="' + entry.id + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>ほかを見る' +
          '<svg class="cmorechev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button>'
      : '';

    return '<div class="ccard" data-catalog="' + entry.id + '" data-text="' + entry.label.toLowerCase() + '">' +
      '<div class="ccard-h">' +
      '<span class="cic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + entry.icon + '</svg></span>' +
      '<h3>' + entry.label + '</h3></div>' +
      entry.groups.map((g, i) => groupBlock(entry.id, i, g)).join('') +
      moreBtn +
      '</div>';
  }

  function render() {
    grid.innerHTML = CATALOG.map(cardHTML).join('');

    grid.querySelectorAll('.citem input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.set(cb.id, { label: cb.dataset.label, period: null });
        else selected.delete(cb.id);
        renderCount();
      });
    });

    grid.querySelectorAll('.cmorebtn').forEach(btn => {
      btn.addEventListener('click', () => openMore(btn));
    });

    renderCount();
  }

  expandAllBtn.addEventListener('click', toggleExpandAll);

  function openMore(btn) { setCardExpanded(btn.closest('.ccard'), true); }

  function setCardExpanded(card, open) {
    card.querySelectorAll('.citem-more').forEach(el => { el.hidden = !open; });
    if (open) card.dataset.moreOpen = '1'; else delete card.dataset.moreOpen;
    const btn = card.querySelector('.cmorebtn');
    if (btn) btn.hidden = open;
  }

  let expandedAll = false;
  function toggleExpandAll() {
    expandedAll = !expandedAll;
    grid.querySelectorAll('.ccard').forEach(card => setCardExpanded(card, expandedAll));
    expandAllBtn.setAttribute('aria-pressed', String(expandedAll));
    expandAllText.textContent = expandedAll ? '表示を戻す' : 'すべての候補を表示';
    expandAllIcon.innerHTML = expandedAll ? ICON_COLLAPSE : ICON_EXPAND;
  }

  /* ── 検索 ─────────────────────────────────────────── */
  /* 一覧に一致する枝を残しつつ、どの項目にも一致しなければ「〇〇を
     追加する」の行を出す（既に一覧・選択済みの名前なら出さない）。 */
  function applyFilter(qRaw) {
    const q = qRaw.trim().toLowerCase();
    expandAllBtn.disabled = !!q;
    let anyCardVisible = false;
    grid.querySelectorAll('.ccard').forEach(card => {
      if (!q) { card.hidden = false; resetCard(card); anyCardVisible = true; return; }
      const cardHit = card.dataset.text.includes(q);
      let anyGroupHit = false;
      card.querySelectorAll('.cgroup').forEach(g => {
        const groupTextHit = g.dataset.text.includes(q);
        let anyItemHit = false;
        g.querySelectorAll('.citem').forEach(item => {
          const hit = cardHit || groupTextHit || item.dataset.text.includes(q);
          item.hidden = !hit;
          if (hit) anyItemHit = true;
        });
        const groupHit = cardHit || groupTextHit || anyItemHit;
        g.hidden = !groupHit;
        if (groupHit) anyGroupHit = true;
      });
      const visible = cardHit || anyGroupHit;
      card.hidden = !visible;
      if (visible) anyCardVisible = true;
      const moreBtn = card.querySelector('.cmorebtn');
      if (moreBtn) moreBtn.hidden = true;
    });

    updateAddRow(qRaw.trim(), anyCardVisible);
  }

  /* 入力語をそのまま足す行。完全一致の候補が既にあるとき・既に
     一覧／選択に入っているときは出さない。 */
  function updateAddRow(term, anyCardVisible) {
    if (!term) { addRow.hidden = true; return; }
    const key = 'free:' + term;
    const already = selected.has(key) || existing(term) || catalogExact(term);
    addRow.hidden = already;
    addTerm.textContent = term;
    addRow.classList.toggle('is-lonely', !anyCardVisible);
  }

  function catalogExact(term) {
    const t = term.trim().toLowerCase();
    return CATALOG.some(c => c.groups.some(g =>
      g.items.concat(g.more || []).some(x => x.toLowerCase() === t)));
  }

  function resetCard(card) {
    const opened = card.dataset.moreOpen === '1';
    card.querySelectorAll('.cgroup').forEach(g => { g.hidden = false; });
    card.querySelectorAll('.citem-base').forEach(el => { el.hidden = false; });
    card.querySelectorAll('.citem-more').forEach(el => { el.hidden = !opened; });
    const moreBtn = card.querySelector('.cmorebtn');
    if (moreBtn) moreBtn.hidden = opened;
  }

  addRow.addEventListener('click', () => {
    const term = addTerm.textContent.trim();
    if (!term) return;
    selected.set('free:' + term, { label: term, period: null });
    searchInput.value = '';
    applyFilter('');
    renderCount();
    global.SeiZen.toast('「' + term + '」を選択に追加しました');
  });

  searchInput.addEventListener('input', () => applyFilter(searchInput.value));

  /* ── ②確認画面 ─────────────────────────────────────── */

  function showConfirm() {
    catalogView.hidden = true;
    confirmView.hidden = false;
    selDock.style.display = 'none';
    renderConfirm();
    window.scrollTo(0, 0);
  }

  function showCatalog() {
    confirmView.hidden = true;
    catalogView.hidden = false;
    selDock.style.display = '';
    render();
    applyFilter(searchInput.value);
    window.scrollTo(0, 0);
  }

  const C = global.SeiZenCatalog;

  /* 頭文字マーク／実ロゴ。一覧画面（render.js の markHTML）と同じ
     モノクロの地・インクにそろえ、実ロゴの有無で重さが変わらない。 */
  function markHTML(label) {
    const logo = C.logoFor ? C.logoFor(label) : null;
    if (logo)
      return '<span class="cf-mark cf-mark-logo">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="' + logo + '"/></svg></span>';
    return '<span class="cf-mark">' + escHtml(label.charAt(0)) + '</span>';
  }

  function confirmRowHTML(key, entry) {
    const label = entry.label;
    const isExisting = existing(label);
    const desc = C.descFor ? C.descFor(label) : '';

    let periodArea;
    if (isExisting) {
      const p = existingPeriod(label);
      periodArea = '<span class="cf-registered">登録済み</span>' +
        '<span class="cf-fixed">' + periodLabel(p) + '</span>';
    } else {
      periodArea = '<div class="cf-seg" role="group" aria-label="対応時期">' +
        PERIODS.map(p =>
          '<button type="button" class="cf-seg-btn' + (entry.period === p.value ? ' on' : '') +
          '" data-key="' + escAttr(key) + '" data-period="' + p.value + '">' +
          '<span class="cf-seg-dot"></span>' + p.label + '</button>'
        ).join('') + '</div>';
    }

    return '<div class="cf-row' + (isExisting ? ' is-existing' : '') + '" data-key="' + escAttr(key) + '">' +
      markHTML(label) +
      '<span class="cf-name">' + escHtml(label) +
        (desc ? '<small>' + escHtml(desc) + '</small>' : '') +
      '</span>' +
      '<span class="cf-seg-label">対応する時期</span>' +
      '<div class="cf-row-period">' + periodArea + '</div>' +
      '<button type="button" class="cf-x" data-remove="' + escAttr(key) + '" aria-label="' + escAttr(label) + 'を外す">✕</button>' +
    '</div>';
  }

  function renderConfirm() {
    const entries = [...selected.entries()];
    cfCount.textContent = entries.length;
    cfCountInline.textContent = entries.length;

    if (!entries.length) {
      cfList.innerHTML = '<p class="cf-empty">選択されたサービスがありません。サービス選択に戻ってください。</p>';
      cfSubmit.disabled = true;
      cfHint.hidden = true;
      return;
    }

    cfList.innerHTML = entries.map(([k, v]) => confirmRowHTML(k, v)).join('');

    /* 新規サービスで対応時期が未選択のものが1件でもあれば送信不可。
       全部が登録済みでも「追加する」は押せる（登録済みの知らせを
       出して一覧へ戻すだけ）。 */
    refreshSubmitState();
  }

  cfList.addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      selected.delete(rm.dataset.remove);
      syncCatalogCheckbox(rm.dataset.remove, false);
      renderConfirm();
      renderCount();
      return;
    }
    const seg = e.target.closest('.cf-seg-btn');
    if (seg) {
      const entry = selected.get(seg.dataset.key);
      if (!entry) return;
      entry.period = seg.dataset.period;
      /* その行のセグメントだけ塗り替える。ほかの行は触らないので、
         連続で選んでもちらつかない。送信可否とヒントだけ引き直す。 */
      seg.parentElement.querySelectorAll('.cf-seg-btn').forEach(btn => {
        btn.classList.toggle('on', btn.dataset.period === entry.period);
      });
      refreshSubmitState();
    }
  });

  /* 送信ボタンの可否とヒントの表示だけを更新する（一覧は再描画しない）。 */
  function refreshSubmitState() {
    const entries = [...selected.entries()];
    const pending = entries.filter(([, v]) => !existing(v.label) && !v.period);
    cfSubmit.disabled = !entries.length || pending.length > 0;
    cfHint.hidden = pending.length === 0;
  }

  cfClear.addEventListener('click', () => {
    [...selected.keys()].forEach(k => syncCatalogCheckbox(k, false));
    selected.clear();
    renderConfirm();
    renderCount();
  });

  /* カタログのチェックボックスは描き直しのたびに selected を見るので、
     確認画面で外したぶんはカタログに戻れば自然と外れる。ここでは
     いま DOM にある分だけ即時に合わせる。 */
  function syncCatalogCheckbox(key, on) {
    if (key.indexOf('free:') === 0) return;
    const cb = document.getElementById(key);
    if (cb) cb.checked = on;
  }

  document.getElementById('cfReselect').addEventListener('click', showCatalog);
  document.getElementById('confirmBack').addEventListener('click', showCatalog);

  cfSubmit.addEventListener('click', () => {
    const records = [...selected.values()].map(v => ({
      name: v.label,
      group: existing(v.label) ? existingPeriod(v.label) : v.period,
      category: '未分類'
    }));
    const result = S.commitAdded(records);
    try {
      sessionStorage.setItem('seizen.contract.addResult', JSON.stringify(result));
    } catch (e) { /* 無視 */ }
    location.href = 'index.html';
  });

  selConfirmBtn.addEventListener('click', () => {
    if (!selected.size) { global.SeiZen.toast('追加するサービスを選んでください'); return; }
    showConfirm();
  });

  /* ── 小物 ─────────────────────────────────────────── */
  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function escAttr(s) { return escHtml(s); }

  render();
})(window);
