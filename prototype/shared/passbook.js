/* SeiZen｜通帳の表紙（共有パーツ）の組み立て
   ------------------------------------------------------------------
   「閉じた通帳を上から見た表紙」の外枠 HTML と地紋 SVG だけを返す。
   何を載せるか（口座数・紐づく契約・進捗）は呼び出し側が文字列で
   渡す。ここはデータを解釈しない。

   使う側：
     SeiZen.passbook({
       key,                       … data-goto / data-open に入れる識別子
       gotoAttr: 'goto' | 'open',  … 既定 'goto'。契約・デジタルは 'open'
       name,                       … 見出し（銀行名）
       meta: [{ text, lead, label }], … 表紙の素性行（口座数・種別・名義）
       badge: { text, on },        … 右上の鑑札。on=false で控えめ表示
       weaveIndex,                 … 地紋の番号（画面ごとに割り当て）
       dormant,                    … 休眠口座は表紙を灰に
       faceExtra,                  … 表紙下部に足す HTML（任意）
       body                        … 記録票（.pb-body）の中身 HTML
     }) → button.pb-book の文字列
                                                                    */
(function (global) {
  'use strict';

  const S = global.SeiZen || (global.SeiZen = {});
  const esc = S.esc || (s => String(s == null ? '' : s));

  /* 地紋タイル。白の線だけで描き、寝かせるのは CSS の opacity 側。
     並び順で回すので銀行が増えても破綻しない。 */
  const WEAVE_TILE = {
    stripe: '<pattern id="pbw-stripe" width="9" height="9" patternUnits="userSpaceOnUse">' +
            '<path d="M0 0V9M4.5 0V9" stroke="#fff" stroke-width="1"/></pattern>',
    clover: '<pattern id="pbw-clover" width="26" height="26" patternUnits="userSpaceOnUse">' +
            '<g fill="none" stroke="#fff" stroke-width="1">' +
            '<circle cx="13" cy="9" r="3"/><circle cx="9" cy="13" r="3"/>' +
            '<circle cx="17" cy="13" r="3"/><circle cx="13" cy="17" r="3"/>' +
            '<path d="M13 13v6"/></g></pattern>',
    vein:   '<pattern id="pbw-vein" width="30" height="30" patternUnits="userSpaceOnUse" patternTransform="rotate(20)">' +
            '<g fill="none" stroke="#fff" stroke-width="1">' +
            '<path d="M0 15h30"/><path d="M7 15l-4-5M7 15l-4 5M15 15l-4-5M15 15l-4 5M23 15l-4-5M23 15l-4 5"/>' +
            '</g></pattern>'
  };
  const WEAVES = ['stripe', 'clover', 'vein'];

  function weaveSVG(index) {
    const key = WEAVES[((index | 0) % WEAVES.length + WEAVES.length) % WEAVES.length];
    return '<svg class="pb-weave" aria-hidden="true" width="100%" height="100%" preserveAspectRatio="none">' +
      '<defs>' + WEAVE_TILE[key] + '</defs>' +
      '<rect width="100%" height="100%" fill="url(#pbw-' + key + ')"/></svg>';
  }

  function metaHTML(meta) {
    if (!meta || !meta.length) return '';
    return '<div class="pb-meta">' + meta.map(m => {
      if (!m || m.text == null || m.text === '') return '';
      const cls = m.lead ? ' class="lead"' : '';
      const lab = m.label ? '<i>' + esc(m.label) + '</i>' : '';
      return '<span' + cls + '>' + lab + esc(m.text) + '</span>';
    }).join('') + '</div>';
  }

  function badgeHTML(badge) {
    if (!badge || !badge.text) return '';
    return '<span class="pb-badge' + (badge.on ? '' : ' off') + '">' +
      esc(badge.text) + '</span>';
  }

  S.passbook = function passbook(opt) {
    opt = opt || {};
    const attr = 'data-' + (opt.gotoAttr || 'goto');
    const face =
      '<div class="pb-face">' +
        '<div class="pb-nm">' + esc(opt.name) + '</div>' +
        metaHTML(opt.meta) +
        badgeHTML(opt.badge) +
        (opt.faceExtra || '') +
      '</div>';
    const body = '<div class="pb-body">' + (opt.body || '') + '</div>';

    return '<button class="pb-book' + (opt.dormant ? ' gy' : '') + '" type="button" ' +
      attr + '="' + esc(opt.key) + '">' +
      weaveSVG(opt.weaveIndex) +
      '<span class="pb-spine" aria-hidden="true"></span>' +
      '<span class="pb-edge r" aria-hidden="true"></span>' +
      '<span class="pb-edge b" aria-hidden="true"></span>' +
      face + body + '</button>';
  };
})(window);
