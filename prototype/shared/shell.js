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

  const CHEVRON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="m6 9 6 6 6-6"/></svg>';

  const HAMBURGER =
    '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round">' +
    '<path d="M4 7h16M4 12h16M4 17h16"/></svg>';

  /* ── ガイドの開閉（3段）──────────────────────────────
     ・>1200px（WIDE）：常設。.appbar もドロワーも使わない。
     ・1200〜900px（MID）：ガイドは既定で画面外。ハンバーガーで本文に
       被せて開く。開いた本文の上をタップ／Esc／メニュー内リンクで
       閉じる。開閉状態は localStorage に覚え、次回この帯に入ったとき
       復元する（本文はスクロールできるので body ロックはしない）。
     ・≤900px（NARROW）：同じオフキャンバスだが、常にスクリム＋body
       ロック。既定状態は覚えず、必ず閉じた状態から始める。
     WIDE へ戻ったら状態を必ず捨てる（CSS が transform を戻すだけでは
     body ロックやスクリムが class に残るため）。                   */
  const MID    = window.matchMedia('(max-width:1200px)');
  const NARROW = window.matchMedia('(max-width:900px)');
  const GUIDE_OPEN_KEY = 'seizen-guide-open';

  function wireDrawer(guide) {
    const bar = document.createElement('header');
    bar.className = 'appbar';
    bar.innerHTML =
      '<button class="appbar-menu" type="button" aria-label="メニューを開く" ' +
        'aria-expanded="false">' + HAMBURGER + '</button>' +
      '<a class="appbar-brand" href="' + root + 'index.html">' +
        '<span class="brand-mark">' + BRAND_MARK + '</span><b>SeiZen</b></a>';
    body.insertBefore(bar, body.firstChild);

    const scrim = document.createElement('div');
    scrim.className = 'guide-scrim';
    body.appendChild(scrim);

    const btn = bar.querySelector('.appbar-menu');

    const remember = v => {
      try { localStorage.setItem(GUIDE_OPEN_KEY, v ? '1' : '0'); } catch (e) {}
    };
    const recall = () => {
      try { return localStorage.getItem(GUIDE_OPEN_KEY) === '1'; } catch (e) { return false; }
    };

    const open = (persist) => {
      guide.classList.add('is-open');
      scrim.classList.add('is-on');
      /* 狭い幅では背面を固定。中間幅は本文をスクロールできるので固定しない。 */
      if (NARROW.matches) body.classList.add('guide-locked');
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-label', 'メニューを閉じる');
      if (persist && MID.matches && !NARROW.matches) remember(true);
    };
    const close = (persist) => {
      guide.classList.remove('is-open');
      scrim.classList.remove('is-on');
      body.classList.remove('guide-locked');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'メニューを開く');
      if (persist && MID.matches && !NARROW.matches) remember(false);
    };

    btn.addEventListener('click', () =>
      guide.classList.contains('is-open') ? close(true) : open(true));
    scrim.addEventListener('click', () => close(true));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && guide.classList.contains('is-open')) close(true);
    });
    /* メニュー内のリンクを押したら、遷移する前に閉じておく（同一ページ
       内アンカーや戻る操作でも開きっぱなしにしない）。中間幅で覚えた
       「開」は保持したいので、この close は永続化しない。 */
    guide.addEventListener('click', e => {
      if (e.target.closest('a')) close(false);
    });

    /* 帯をまたいだときの整合。
       ・MID へ入った → localStorage の記憶どおりに開閉を復元
       ・NARROW へ入った／出た → 必ず閉じる（記憶は変えない）
       ・WIDE へ戻った → 状態を捨てる                               */
    const syncToViewport = () => {
      if (!MID.matches) { close(false); return; }          // WIDE
      if (NARROW.matches) { close(false); return; }         // NARROW：常に閉から
      recall() ? open(false) : close(false);                // MID：記憶を復元
    };
    MID.addEventListener('change', syncToViewport);
    NARROW.addEventListener('change', syncToViewport);
    syncToViewport();
  }

  function drawGuide(el) {
    const areas = AREAS.all();
    const main  = areas.filter(a => !a.docs).map(navItem).join('');
    const docs  = areas.filter(a =>  a.docs).map(navItem).join('');

    el.setAttribute('aria-label', '整理対象のガイドブック');
    el.innerHTML =
      /* 生成りの紙。冊子の全高を覆う1枚。ロゴ・メニュー・足元はこの上に
         載る。緑の表紙（.guide の地）はこの紙の外周にだけ見える。      */
      '<div class="guide-paper"></div>' +
      /* ロゴ＋メニューで一つのまとまり。ページを下へスクロールしても
         この塊ごと画面上部に留まる（案A）。ロゴは自前で緑地を持つ。   */
      '<div class="guide-stick">' +
        '<a class="brand" href="' + root + 'index.html">' +
          '<span class="brand-mark">' + BRAND_MARK + '</span>' +
          '<span class="brand-tx"><h1>SeiZen</h1><p>家族の生前整理ガイド</p></span></a>' +
        '<section class="menu-card">' +
          '<nav class="menu">' + main +
            (docs ? '<hr class="sep">' + docs : '') +
          '</nav>' +
        '</section>' +
      '</div>' +
      /* 「はじめての方へ」と家族切替（＝アカウント・設定の入口）は、
         冊子の足元。ページを下へスクロールしても画面下に貼り付いて
         見え続ける。「はじめての方へ」はメニュー項目と同じ体裁の
         1行リンクにして、縦の占有を抑える。                          */
      '<div class="guide-foot">' +
        '<button class="guide-help" type="button">' +
          '<span class="guide-help-ic">' + GUIDE_MINI + '</span>' +
          '<span class="guide-help-tx">はじめての方へ</span>' +
          '<svg class="guide-help-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>' +
        '</button>' +
        '<button class="profile" type="button">' +
          '<span class="avatar" aria-label="' + esc(PERSON.name) + 'のプロフィール写真"></span>' +
          '<span><small>' + esc(PERSON.role) + '</small><strong>' + esc(PERSON.name) + '</strong></span>' +
          CHEVRON + '</button>' +
      '</div>' +
      /* メニュー項目が下に隠れているときだけ出る「スクロールできる」
         の合図。ビューポート下端に固定し、shell.js が .is-on を切替。 */
      '<div class="guide-more" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' +
        '<path d="m6 9 6 6 6-6"/></svg></div>' +
      '<span class="guide-edge" aria-hidden="true"></span>';

    el.querySelector('.guide-help')
      .addEventListener('click', () => toast('使い方ガイドを開く準備中です'));
    el.querySelector('.profile')
      .addEventListener('click', () => toast('家族の切替は準備中です'));

    wireGuide(el);
    wireDrawer(el);
  }

  /* 冊子の縦の振る舞い。
     ・ウィンドウが十分高い → メニュー（.guide-stick）を上に、足元
       （.guide-foot）を下に貼り付け、どちらも常に見せる。
     ・ウィンドウが低くて両方を貼り付けると入り切らない（cramped）
       → 貼り付けをやめて素直に流し、ページのスクロールで全部見せる。
     合図（∨）は位置ではなく状態で出す：メニュー項目が下に隠れて
     いる（＝いま全部は見えていない）ときだけ、画面下端に表示する。 */
  function wireGuide(el) {
    const menu  = el.querySelector('.menu');
    const stick = el.querySelector('.guide-stick');
    const foot  = el.querySelector('.guide-foot');
    const more  = el.querySelector('.guide-more');
    if (!menu || !stick || !foot) return;

    const measure = () => {
      /* ≤1200px ではガイドはオフキャンバス（内部スクロールを持つ）
         なので、cramped 判定も貼り付けも使わない。 */
      if (MID.matches) { el.classList.remove('is-cramped'); return; }
      /* ロゴ＋メニュー（.guide-stick）と足元を、上下に貼り付けたとき
         必要な高さ（+ 余白）。これを下回るウィンドウでは貼り付けない。 */
      const need = stick.offsetHeight + foot.offsetHeight + 40;
      el.classList.toggle('is-cramped', window.innerHeight < need);
    };
    const hint = () => {
      if (!more || MID.matches) { if (more) more.classList.remove('is-on'); return; }
      /* メニュー最終項目の下端が画面内に収まっていれば全部見えている。
         はみ出していれば、まだ下にメニューがある＝スクロールできる。 */
      const items = menu.querySelectorAll('a');
      const last = items[items.length - 1];
      if (!last) { more.classList.remove('is-on'); return; }
      const hidden = last.getBoundingClientRect().bottom > window.innerHeight - 4;
      more.classList.toggle('is-on', hidden);
    };
    const sync = () => { measure(); hint(); };

    window.addEventListener('scroll', hint, { passive: true });
    window.addEventListener('resize', sync);
    sync();
    /* 描画直後は高さが確定していないことがあるので一度だけ追い判定。 */
    requestAnimationFrame(sync);
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

  /* ── 先頭へ戻る ─────────────────────────────────
     どのページでも共通。320px ほどスクロールすると右下に現れ、
     押すと上端へなめらかに戻る。ボタンは body の末尾へ差す。   */
  function wireBackTop() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'backtop';
    btn.setAttribute('aria-label', 'ページの先頭へ戻る');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="m7 14 5-5 5 5"/></svg>';
    body.appendChild(btn);
    const sync = () => btn.classList.toggle('is-shown', window.scrollY > 320);
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    window.addEventListener('scroll', sync, { passive: true });
    sync();
  }

  const guide = document.querySelector('.guide');
  if (guide) drawGuide(guide);
  wireWhy();
  wireBackTop();

  global.SeiZen = { esc, toast, setNavCount, root, areaId: currentId, person: PERSON };
})(window);
