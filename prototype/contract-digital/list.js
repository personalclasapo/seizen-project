/* SeiZen プロトタイプ｜契約・デジタル：その束だけの全件画面
   ------------------------------------------------------------------
   ハブ（index.html）の束は、いまのうち／そのとき＝10件、振り分け前
   ＝5件までを見せ、それを超えると「すべてを見る」でここへ来る。

   この画面は 1 つの束（?g=pre / post / undecided）だけを、ハブと
   同じ台紙・耳・タブ・行の見た目で描く。違いは行を2列で並べること
   だけ。行を押すと index.html?id=… へ遷移して詳細を開く（詳細の
   実体は render.js 側に一本化してあるので、ここでは持たない）。   */
(function (S) {
  'use strict';

  const esc = SeiZen.esc;
  const wrap = document.getElementById('listwrap');

  const g = new URLSearchParams(location.search).get('g');
  if (!S || !S.GROUP_UI[g] || (g !== 'pre' && g !== 'post' && g !== 'undecided')) {
    location.replace('index.html');
    return;
  }

  /* ハブの render.js から、行の描画に要る分だけを写し取る。ここを
     変えるときは render.js の idxRowHTML / idxOrder / markHTML と
     そろえること。                                                */
  const IC = {
    chevL: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
    chevR: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
    sprout:'<svg viewBox="0 0 24 24"><path d="M12 21v-8"/><path d="M12 13c-.4-3-2.6-4.8-5.6-4.8 .1 3 2.3 4.9 5.6 4.8Z"/><path d="M12 11c.4-3.3 2.8-5.2 6-5.2 -.1 3.3-2.6 5.3-6 5.2Z"/></svg>',
    tree:  '<svg viewBox="0 0 24 24"><path d="M12 21v-6"/><circle cx="12" cy="9" r="6"/><path d="M12 15l-2.6-2.4M12 13l2.8-2.6"/></svg>',
    quest: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2-2.4 3.6M12 17h.01"/></svg>'
  };

  function markHTML(name) {
    const m = S.markOf(name);
    const border = m.border ? ';border:1px solid ' + m.border : '';
    const style = 'background:' + m.bg + ';color:' + m.fg + border;
    if (m.logo)
      return '<span class="mark mark-logo" style="' + style + '">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="' + m.logo + '"/></svg></span>';
    return '<span class="mark" style="' + style + '">' + esc(m.ch) + '</span>';
  }

  const KIND_RANK = { open: 0, ready: 1, done: 2 };
  function idxOrder(list) {
    return list.slice().sort((a, b) =>
      KIND_RANK[S.itemBadge(a).kind] - KIND_RANK[S.itemBadge(b).kind]);
  }

  function rowHTML(it, i, arr) {
    const b = S.itemBadge(it);
    const done = b.kind === 'done';
    const first = done && (i === 0 || S.itemBadge(arr[i - 1]).kind !== 'done');
    const txt = b.kind === 'open' ? b.text + '　' + b.n + '件' : b.text;
    return '<a class="irow' + (done ? ' done' : '') + (first ? ' cut' : '') +
      '" href="index.html?id=' + encodeURIComponent(it.id) + '">' +
      markHTML(it.name) +
      '<span class="nm"><b>' + esc(it.name) + '</b><small>' + esc(it.category) + '</small></span>' +
      '<span class="st-badge sb-' + b.tone + '">' + esc(txt) + '</span>' +
      '<span class="arw">›</span></a>';
  }

  function tallyHTML(ui) {
    const t = S.groupSummary(g);
    return '<div class="tally">' +
      '<div><span class="tl">' + esc(ui.badges.open) + '</span><span class="tv tv-or">' + t.open + '件</span></div>' +
      '<div><span class="tl">' + esc(ui.badges.ready) + '</span><span class="tv tv-gr">' + t.ready + '件</span></div>' +
      '<div><span class="tl">' + esc(ui.badges.done) + '</span><span class="tv tv-gy">' + t.done + '件</span></div>' +
    '</div>';
  }

  function render() {
    const ui = S.GROUP_UI[g];
    const rows = idxOrder(S.byGroup(g));
    const icon = g === 'pre' ? IC.sprout : g === 'post' ? IC.tree : IC.quest;

    document.title = 'SeiZen | ' + ui.title + '（すべて）';
    SeiZen.setNavCount('contract-digital', S.items.length + '件');

    wrap.innerHTML =
      '<a class="list-back" href="index.html">' +
        '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>契約・デジタルの一覧に戻る</a>' +
      '<div class="sec-h sec-h-lg">' +
        '<span class="sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h16M4 18h10"/></svg></span>' +
        '<h3>' + esc(ui.title) + '</h3><span class="cnt">' + rows.length + '件</span></div>' +
      '<p class="sec-lead">' + esc(ui.lead) + '</p>' +
      '<div class="sec">' +
        '<div class="idxgrid list-block">' +
          '<div class="iblock ib-' + g + '" style="grid-column:1 / -1">' +
            '<span class="ib-tab">' + esc(ui.tab) + '</span>' +
            '<div class="ib-h"><span class="ib-ic ic-' + g + '">' + icon + '</span>' +
              '<h4>' + esc(ui.title) + '</h4>' +
              '<span class="ib-n n-' + g + '">' + rows.length + '件</span></div>' +
            '<p class="ib-lead">' + ui.lead + '</p>' +
            (g === 'undecided' ? '' : tallyHTML(ui)) +
            '<div class="list-rows">' + rows.map(rowHTML).join('') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  render();
})(window.SeiZenContract);
