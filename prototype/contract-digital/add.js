/* SeiZen プロトタイプ｜サービスを追加（サービスから探す）
   ------------------------------------------------------------------
   catalog.js の索引を7枚のカードとして描く。各カードは小見出しの
   束で、小見出しは items（常時表示）と more（「ほかを見る」で items の
   直下に続けて現れる）を持つ。チェックは選択件数の表示だけに反映し
   （実際の登録は今回のスコープ外）、検索はカテゴリ名・小見出し・
   項目名を横断してテキスト一致で絞る。ヒットしないカードは隠し、
   ヒットした小見出し・項目だけを残す。                              */
(function (global) {
  'use strict';

  const { CATALOG } = global.SeiZenCatalog;

  const grid = document.getElementById('cataloggrid');
  const searchInput = document.getElementById('catalogSearch');
  const selCountText = document.getElementById('selCountText');
  const selCountBtn = document.getElementById('selCountBtn');
  const expandAllBtn = document.getElementById('expandAllBtn');
  const expandAllText = document.getElementById('expandAllText');
  const expandAllIcon = document.getElementById('expandAllIcon');

  /* トグルの2状態のアイコン。開く前＝上下に開くシェブロン、開いた後＝
     内側に閉じるシェブロン。 */
  const ICON_EXPAND   = '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>';
  const ICON_COLLAPSE = '<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>';

  const selected = new Set();

  function renderCount() {
    selCountText.textContent = '選択したサービス ' + selected.size + '件';
  }

  /* チェック項目1行。kind は 'base'（常時）か 'more'（ほかを見る分）。
     more の行は最初は隠しておき、展開時に表示へ切り替える。         */
  function itemRow(cardId, groupIdx, kind, itemIdx, label) {
    const cid = 'chk-' + cardId + '-' + groupIdx + '-' + kind + '-' + itemIdx;
    const hidden = kind === 'more' ? ' hidden' : '';
    return '<label class="citem citem-' + kind + '" for="' + cid + '"' + hidden +
      ' data-text="' + label.toLowerCase() + '">' +
      '<input type="checkbox" id="' + cid + '" data-label="' + label + '">' +
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
        if (cb.checked) selected.add(cb.id); else selected.delete(cb.id);
        renderCount();
      });
    });

    grid.querySelectorAll('.cmorebtn').forEach(btn => {
      btn.addEventListener('click', () => openMore(btn));
    });

    selCountBtn.addEventListener('click', () => global.SeiZen.toast('選択したサービスの確認は準備中です'));
    expandAllBtn.addEventListener('click', toggleExpandAll);

    renderCount();
  }

  /* ── ほかを見る（カード単位）─────────────────────
     押した時点で、そのカードの各小見出しの more 行（itemRow で最初は
     hidden にしてある）を、その小見出しの常時項目の直下に表示する。
     一度展開したら、そのカードは閉じない。                        */
  function openMore(btn) {
    setCardExpanded(btn.closest('.ccard'), true);
  }

  function setCardExpanded(card, open) {
    card.querySelectorAll('.citem-more').forEach(el => { el.hidden = !open; });
    if (open) card.dataset.moreOpen = '1'; else delete card.dataset.moreOpen;
    const btn = card.querySelector('.cmorebtn');
    if (btn) btn.hidden = open;
  }

  /* ── すべての候補を表示（全カード一括）──────────
     上部のトグル。押すと全カードの more をまとめて開き、もう一度
     押すと全カードを常時表示だけに戻す（カード単位で個別に開いて
     いたぶんもここで戻る）。検索中は無効。                        */
  let expandedAll = false;
  function toggleExpandAll() {
    expandedAll = !expandedAll;
    grid.querySelectorAll('.ccard').forEach(card => setCardExpanded(card, expandedAll));
    expandAllBtn.setAttribute('aria-pressed', String(expandedAll));
    expandAllText.textContent = expandedAll ? '表示を戻す' : 'すべての候補を表示';
    expandAllIcon.innerHTML = expandedAll ? ICON_COLLAPSE : ICON_EXPAND;
  }

  /* ── 検索 ─────────────────────────────────────────
     カード単位・小見出し単位・項目単位でテキストを持たせておき、
     一致する枝だけを表示に残す。カード名がヒットすればカードごと
     出す。それ以外は小見出しの中身（more 項目名も含む）がヒット
     するかで判定する。検索中は more 項目も対象に含めて表示する。 */
  function applyFilter(qRaw) {
    const q = qRaw.trim().toLowerCase();
    /* 検索中は全項目が対象に出るので、一括トグルは意味をなさない。無効化。 */
    expandAllBtn.disabled = !!q;
    grid.querySelectorAll('.ccard').forEach(card => {
      if (!q) { card.hidden = false; resetCard(card); return; }
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

      card.hidden = !(cardHit || anyGroupHit);
      const moreBtn = card.querySelector('.cmorebtn');
      if (moreBtn) moreBtn.hidden = true;
    });
  }

  /* 検索クリア時。展開状態は保つ（一度「ほかを見る」を押したカードは
     more 項目を出したまま）。押していないカードは more を隠しに戻す。 */
  function resetCard(card) {
    const opened = card.dataset.moreOpen === '1';
    card.querySelectorAll('.cgroup').forEach(g => { g.hidden = false; });
    card.querySelectorAll('.citem-base').forEach(el => { el.hidden = false; });
    card.querySelectorAll('.citem-more').forEach(el => { el.hidden = !opened; });
    const moreBtn = card.querySelector('.cmorebtn');
    if (moreBtn) moreBtn.hidden = opened;
  }

  searchInput.addEventListener('input', () => applyFilter(searchInput.value));

  render();
})(window);
