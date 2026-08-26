/* SeiZen｜外殻の描画
   ------------------------------------------------------------------
   左のガイドブックを組み立て、領域をまたいで同じものを使う道具
   （トースト・エスケープ）を渡す。領域固有のことは何もしない。

   各ページは <body data-area="bank-account" data-root="../"> と
   空の <aside class="guide"></aside> を置くだけでよい。
   ナビの中身は shared/areas.js だけを見て決まる。

   data-root は、そのページから prototype/ の直下までの相対パス。
   ビルドを入れていないので、リンクはここで組み立てる。          */
(function (global) {
  'use strict';

  const AREAS = global.SeiZenAreas;

  /* 表示中の家族。家族データを持つまでの仮置き。正本§5により、
     切替UIはこの1か所（ガイドブックの足元）にしか置かない。     */
  const PERSON = { role: '整理する人', name: '父 太郎さん' };

  const esc = s => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const body = document.body;
  const root = body.dataset.root || '';
  const currentId = body.dataset.area || '';

  /* ── トースト ───────────────────────────────────── */

  let toastEl = null, toastTimer;
  function toast(text) {
    if (!toastEl) {
      toastEl = document.getElementById('toast');
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.className = 'toast';
        toastEl.id = 'toast';
        body.appendChild(toastEl);
      }
    }
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  /* ── ナビ ───────────────────────────────────────── */

  /* 行き先。画面のない領域は preparing.html へ送り、どの領域を
     開こうとしたのかを渡す。リンクを外して押せなくはしない。    */
  function href(area) {
    if (area.status === 'ready') return root + area.path;
    return root + 'preparing.html?area=' + encodeURIComponent(area.id);
  }

  function navItem(area) {
    const on   = area.id === currentId ? ' on' : '';
    const soon = area.status === 'ready' ? '' : ' soon';
    return '<a class="' + (on + soon).trim() + '" href="' + href(area) + '"' +
           (on ? ' aria-current="page"' : '') + '>' +
           '<span class="menu-icon"><svg viewBox="0 0 24 24" stroke-width="1.6" ' +
           'stroke-linecap="round" stroke-linejoin="round">' + area.icon + '</svg></span>' +
           '<span class="menu-label">' + esc(area.label) + '</span>' +
           '<span class="count" data-count="' + area.id + '" hidden></span></a>';
  }

  const BRAND_MARK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">' +
    '<circle cx="12" cy="12" r="9"/>' +
    '<path d="M12 19V11M12 14c-4 0-6-2.5-6-5.5 4 0 6 1.7 6 5.5Zm0 0c4 0 6-2.5 6-5.5-4 0-6 1.7-6 5.5Z"/></svg>';

  const GUIDE_MINI =
    '<svg class="guide-mini" viewBox="8 14 36 26" role="img" aria-labelledby="gmt gmd">' +
    '<title id="gmt">しおり付き案内冊子</title>' +
    '<desc id="gmd">生成りのページ、緑の表紙、控えめな暖色のしおりを持つ開いた案内冊子</desc>' +
    '<path d="M10.9 18.7c4.7-2.5 9.7-2.2 15.1.8 5.4-3 10.4-3.3 15.1-.8v19c-4.6-2-9.7-1.6-15.1 1.3-5.4-2.9-10.5-3.3-15.1-1.3v-19Z" fill="#4d7255" stroke="#42664b" stroke-width=".9" stroke-linejoin="round"/>' +
    '<path d="M12.5 16.5c4.3-2 8.7-1.5 13.5 1.5v18.5c-4.7-2.5-9.2-2.9-13.5-1V16.5Z" fill="#fff9eb" stroke="#607b62" stroke-width="1.1" stroke-linejoin="round"/>' +
    '<path d="M39.5 16.5c-4.3-2-8.7-1.5-13.5 1.5v18.5c4.7-2.5 9.2-2.9 13.5-1V16.5Z" fill="#fff9eb" stroke="#607b62" stroke-width="1.1" stroke-linejoin="round"/>' +
    '<path d="M26 18v18.5" stroke="#607b62" stroke-width="1.1"/>' +
    '<path d="M28.2 17.2v13.1l2.2-1.6 2.2 1.2V16.3c-1.5.2-2.9.5-4.4.9Z" fill="#c58c55"/>' +
    '<path d="M15.7 21.6c2.7-.5 5.1-.1 7.4 1M15.7 25.3c2.7-.5 5.1-.1 7.4 1M35.9 21.4c-1.1 0-2.1.2-3 .4M35.9 25.1c-1.1 0-2.1.2-3 .4" fill="none" stroke="#9ba795" stroke-width=".8" stroke-linecap="round"/></svg>';

  const CTA_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
    '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/>' +
    '<path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21V5.5Z"/></svg>';

  const CHEVRON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="m6 9 6 6 6-6"/></svg>';

  function drawGuide(el) {
    const areas = AREAS.all();
    const main  = areas.filter(a => !a.docs).map(navItem).join('');
    const docs  = areas.filter(a =>  a.docs).map(navItem).join('');

    el.setAttribute('aria-label', '整理対象のガイドブック');
    el.innerHTML =
      '<a class="brand" href="' + root + 'index.html">' +
        '<span class="brand-mark">' + BRAND_MARK + '</span>' +
        '<span class="brand-tx"><h1>SeiZen</h1><p>家族の生前整理ガイド</p></span></a>' +
      '<section class="menu-card">' +
        '<div class="menu-scroll"><nav class="menu">' + main +
          (docs ? '<hr class="sep">' + docs : '') +
        '</nav></div>' +
        '<div class="help"><div class="help-heading" tabindex="0">' + GUIDE_MINI +
          '<strong>はじめての方へ</strong>' +
          '<p>何から始めればよいか迷ったら、このガイドをご覧ください。</p></div>' +
          '<button class="guide-cta" type="button">' + CTA_ICON + '使い方ガイドを見る</button></div>' +
        '<button class="profile" type="button">' +
          '<span class="avatar" aria-label="' + esc(PERSON.name) + 'のプロフィール写真"></span>' +
          '<span><small>' + esc(PERSON.role) + '</small><strong>' + esc(PERSON.name) + '</strong></span>' +
          CHEVRON + '</button>' +
      '</section>' +
      '<span class="guide-edge" aria-hidden="true"></span>';

    el.querySelector('.guide-cta')
      .addEventListener('click', () => toast('使い方ガイドを開く準備中です'));
    el.querySelector('.profile')
      .addEventListener('click', () => toast('家族の切替は準備中です'));
  }

  /* 件数は各領域が入れる。事実を持っているのは領域の state だけ
     なので、外殻の側では持たない。値がなければバッジは出ない。   */
  function setNavCount(areaId, text) {
    const el = document.querySelector('[data-count="' + areaId + '"]');
    if (!el) return;
    if (text == null || text === '') { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = text;
  }

  /* ── 意味説明の開閉（正本§6：通常時はコンパクト） ─────── */

  function wireWhy() {
    const why = document.getElementById('why');
    const toggle = document.getElementById('whyToggle');
    if (!why || !toggle) return;
    const KEY = 'seizen-why-open';
    if (localStorage.getItem(KEY) === '0') {
      why.classList.add('collapsed');
      toggle.setAttribute('aria-expanded', 'false');
    }
    toggle.addEventListener('click', () => {
      const collapsed = why.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      localStorage.setItem(KEY, collapsed ? '0' : '1');
    });
  }

  const guide = document.querySelector('.guide');
  if (guide) drawGuide(guide);
  wireWhy();

  global.SeiZen = { esc, toast, setNavCount, root, areaId: currentId, person: PERSON };
})(window);
