/* SeiZen プロトタイプ｜契約・デジタルの描画（2軸版）
   ------------------------------------------------------------------
   索引は3ブロック（今のうちに準備が必要／必要になってから対応できる／
   支払いのつながり）。行を押すと、索引の画面から詳細の画面へ遷移する
   （オーバーレイではなく ?id= を持つ別画面。history で戻れる）。

   詳細は左に綴じ代（リング金具・契約ファイルNo.・契約情報）、右に
   5セクション。契約情報は「変わらない事実」として綴じ代へ置き、右は
   「どう対応するか」の流れだけにする。先頭の「いまの状況」が対応方針・
   アカウント情報・手続き方法の○△✕を3枚のタイルで示し、押すとその節へ
   飛ぶ。以降の節は読む場所なので、状態はここへ集め、各節では重ねて
   言わない。カード上部のバッジは家族側（情報と手順）だけを映す。

   詳細の画面は毎回選んで押している最中なので、セクションは既定で
   すべて開く。開閉はこの画面だけの見え方。                       */
(function (S) {
  'use strict';

  /* エスケープとトーストは領域固有ではないので shared/shell.js が持つ。 */
  const esc  = SeiZen.esc;
  const show = SeiZen.toast;

  const idxgrid    = document.getElementById('idxgrid');
  const indexView  = document.getElementById('indexView');
  const detailView = document.getElementById('detailView');
  const detailNav  = document.getElementById('detailNav');
  const sheet      = document.getElementById('sheet');
  const dtlFile    = document.querySelector('.dtl-file');

  let openId = null;
  /* 索引の各束は、この一覧（ハブ）では上から一定件数だけを見せる。
     いまのうち／そのときは10件、振り分け前は5件。これを超えたら
     束の下端に「すべてを見る」を出し、その束だけの全件画面
     （list.html?g=…）へ遷移させる。ハブの中では展開しない。       */
  const LIST_LIMIT = { pre: 10, post: 10, undecided: 5 };
  let closedSections = new Set();
  /* 節ごとの開閉は対象（契約・アカウント）ごとに覚える。前へ／次へ・
     索引からの選び直しをまたいでも、同じ対象に戻ればさっき閉じた
     形のまま。まだ開いたことのない対象は「すべて閉じる」の好みを
     初期値として引き継ぐ。                                        */
  const itemClosedSections = new Map();
  /* 「すべて閉じる」は対象ごとに覚えるのではなく、閉じ方そのものの
     好みとして扱う。前へ／次へ・索引からの選び直しをまたいでも次に
     開いた項目へ引き継ぎ、ブラウザの再読み込みをまたいでも消えない
     よう localStorage に置く（読めなければ既定の「開く」に倒す）。 */
  const COLLAPSE_PREF_KEY = 'seizen-contract-collapseAll';
  let collapseAllPref = false;
  try { collapseAllPref = localStorage.getItem(COLLAPSE_PREF_KEY) === '1'; } catch (e) { /* 無視 */ }
  function setCollapseAllPref(v) {
    collapseAllPref = v;
    try { localStorage.setItem(COLLAPSE_PREF_KEY, v ? '1' : '0'); } catch (e) { /* 無視 */ }
  }
  const COLLAPSIBLE_KEYS = ['policy', 'account', 'proc', 'memo'];
  /* 書いてある場所がそのまま入力欄になる。銀行口座プロトタイプと
     同じ手つきで、値の置き場所を動かさずに書き換える。            */
  let editing = null;      // { path, kind } … 欄ひとつだけを開く
  let editSection = null;  // 節ごとにまとめて開く
  let editingGroup = false; // 綴じ代の「時期」ラベルを編集中か（pre⇄post）

  /* ── 小物 ─────────────────────────────────────────── */

  const IC = {
    chevL: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
    chevR: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>',
    alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
    warn:  '<svg viewBox="0 0 24 24"><path d="M12 4 3 20h18z"/><path d="M12 10v4M12 17h.01"/></svg>',
    cal:   '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    user:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>',
    mail:  '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    folder:'<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
    flag:  '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    person:'<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>',
    doc:   '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M9 12h6M9 16h4"/></svg>',
    wrench:'<svg viewBox="0 0 24 24"><path d="M15 6a4 4 0 0 1 5 5l-9 9-4-4 9-9a4 4 0 0 1-1-1Z"/></svg>',
    pen:   '<svg viewBox="0 0 24 24"><path d="m4 20 4-1 11-11-3-3L5 16z"/></svg>',
    link:  '<svg viewBox="0 0 24 24"><path d="M10 13a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-6-6l-1 1"/><path d="M14 11a4 4 0 0 0-6-.5l-2 2a4 4 0 0 0 6 6l1-1"/></svg>',
    pin:   '<svg viewBox="0 0 24 24"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>',
    open:  '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    card:  '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/></svg>',
    bag:   '<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="14" rx="2"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/></svg>',
    book:  '<svg viewBox="0 0 24 24"><path d="M6 4h11a1 1 0 0 1 1 1v15l-6-3-6 3V5a1 1 0 0 1 1-1Z"/></svg>',
    box:   '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
    loop:  '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-13.7 5.6M4 12a8 8 0 0 1 13.7-5.6"/><path d="M17 3v4h-4M7 21v-4h4"/></svg>',
    power: '<svg viewBox="0 0 24 24"><path d="M12 3.5v8"/><path d="M7.3 6.6a7.2 7.2 0 1 0 9.4 0"/></svg>',
    swap:  '<svg viewBox="0 0 24 24"><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/></svg>',
    scale: '<svg viewBox="0 0 24 24"><path d="M12 4v16M7 20h10M12 7 5 9l-2.2 5a3.6 3.6 0 0 0 7 0L7.6 8.4M12 7l7 2 2.2 5a3.6 3.6 0 0 1-7 0L16.4 8.4"/></svg>',
    quest: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2-2.4 3.6M12 17h.01"/></svg>',
    clip:  '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 11h6M9 15h4"/></svg>',
    tick:  '<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>',
    info:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></svg>',
    gate:  '<svg viewBox="0 0 24 24"><path d="M4 21V4M4 4h12l-2.5 4L16 12H4"/></svg>',
    dash:  '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
    /* いまのうち＝双葉の芽（今まく種）／そのとき＝葉を茂らせた木（その時に実る）。
       時計・しおりを廃し、成長の前後で「時期」を言うモチーフにそろえた。 */
    sprout:'<svg viewBox="0 0 24 24"><path d="M12 21v-8"/><path d="M12 13c-.4-3-2.6-4.8-5.6-4.8 .1 3 2.3 4.9 5.6 4.8Z"/><path d="M12 11c.4-3.3 2.8-5.2 6-5.2 -.1 3.3-2.6 5.3-6 5.2Z"/></svg>',
    tree:  '<svg viewBox="0 0 24 24"><path d="M12 21v-6"/><circle cx="12" cy="9" r="6"/><path d="M12 15l-2.6-2.4M12 13l2.8-2.6"/></svg>',
  };

  /* どの節が、どの path を受け持つか。節ごとの編集で使う。 */
  const SEC_OF = { policy: 'policy.', account: 'account.', info: 'contract.', memo: 'memo', proc: 'procedure.', cardinfo: 'info.' };

  /* path は 'policy.reason' / 'account.2.value' のような場所の指定。 */
  function getByPath(it, path) {
    return path.split('.').reduce((o, k) => o[k], it);
  }
  function setByPath(it, path, val) {
    const parts = path.split('.');
    const last = parts.pop();
    parts.reduce((o, k) => o[k], it)[last] = val;
  }

  /* 値を、その場で書き換えられる形で出す。開いていれば入力欄になる。 */
  function ev(path, value, kind, placeholder) {
    const secOn = editSection && path.indexOf(SEC_OF[editSection] || '\u0000') === 0;
    if ((editing && editing.path === path) || secOn) {
      /* ヒントは HTML の placeholder 属性として添えるだけなので、
         書きかけの値には混ざらない。確定するのは打ち込んだ文字だけ。   */
      const ph = placeholder ? ' placeholder="' + esc(placeholder) + '"' : '';
      if (kind === 'area')
        return '<textarea class="ef ef-area" data-ef="1" data-path="' + path + '"' + ph + '>' + esc(value) + '</textarea>';
      return '<input class="ef" data-ef="1" data-path="' + path + '"' + ph + ' value="' + esc(value) + '">';
    }
    const empty = value === '' || value == null;
    return '<span class="ev' + (empty ? ' ev-empty' : '') + '" data-edit="' + path +
      '" data-kind="' + (kind || 'line') + '">' +
      (empty ? esc(placeholder || '未入力') : esc(value)) + '</span>';
  }

  /* 選択肢から選ぶ値。開いた瞬間からセレクトを出す。
     opts.emptyValue を渡すと、その値のときは読み取り表示を点線＋例
     （ev の未入力と同じ見た目）にする。編集時は素のセレクトのまま。 */
  function evSelect(path, value, options, opts) {
    opts = opts || {};
    const secOn = editSection && path.indexOf(SEC_OF[editSection] || '\u0000') === 0;
    if ((editing && editing.path === path) || secOn) {
      return '<select class="ef ef-sel" data-ef="1" data-path="' + path + '">' +
        options.map(o => '<option value="' + esc(o.value) + '"' +
          (o.value === value ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') +
        '</select>';
    }
    if ('emptyValue' in opts && value === opts.emptyValue)
      return '<span class="ev ev-empty" data-edit="' + path + '" data-kind="select">' +
        esc(opts.placeholder || '未入力') + '</span>';
    const cur = options.find(o => o.value === value);
    return '<span class="ev" data-edit="' + path + '" data-kind="select">' +
      esc(cur ? cur.label : value) + '</span>';
  }

  function markHTML(name, cls) {
    const m = S.markOf(name);
    const border = m.border ? ';border:1px solid ' + m.border : '';
    const style = 'background:' + m.bg + ';color:' + m.fg + border;
    if (m.logo)
      return '<span class="mark mark-logo ' + (cls || '') + '" style="' + style + '">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="' + m.logo + '"/></svg></span>';
    return '<span class="mark ' + (cls || '') + '" style="' + style + '">' +
      esc(m.ch) + '</span>';
  }

  /* ── 索引 ─────────────────────────────────────────── */

  /* done は対応が完了した行。沈めて、まだ完了していない行（確認が
     必要／準備済みのどちらも）を前に出す。準備済みは情報がそろった
     だけで対応済みではないので、ここでは薄めない。first は済みの
     塊の先頭で、そこにだけ区切りを置く。全行に等間隔で線を引くと
     表に見えるが、状態が変わる位置にだけ引けば線が意味を持つ。    */
  function idxRowHTML(it, i, arr) {
    const b = S.itemBadge(it);
    const done = b.kind === 'done';
    const first = done && (i === 0 || S.itemBadge(arr[i - 1]).kind !== 'done');
    const txt = b.kind === 'open' ? b.text + '　' + b.n + '件' : b.text;
    return '<button class="irow' + (done ? ' done' : '') + (first ? ' cut' : '') +
      '" type="button" data-open="' + it.id + '">' +
      markHTML(it.name) +
      '<span class="nm"><b>' + esc(it.name) + '</b><small>' + esc(it.category) + '</small></span>' +
      '<span class="st-badge sb-' + b.tone + '">' + esc(txt) + '</span>' +
      '<span class="arw">›</span></button>';
  }

  /* 事前・事後は同じ骨格で描く。変わるのは言い回しと色だけ。 */
  /* 確認が必要→準備済み→対応完了の3段階で並べる。家族が見るとき目を
     留めるべき順そのものなので、件数を絞って見せるときもこの並びの
     頭から切ればよい。同じ状態の中では登録順のまま（sort は安定な
     ので並べ替えない）。                                          */
  const KIND_RANK = { open: 0, ready: 1, done: 2 };
  function idxOrder(list) {
    return list.slice().sort((a, b) =>
      KIND_RANK[S.itemBadge(a).kind] - KIND_RANK[S.itemBadge(b).kind]);
  }

  function groupBlock(g) {
    const ui = S.GROUP_UI[g], t = S.groupSummary(g);
    const full = idxOrder(S.byGroup(g));
    const limit = LIST_LIMIT[g] || full.length;
    const over = full.length > limit;
    const list = over ? full.slice(0, limit) : full;
    /* 件数が上限を超えた束は、ここでは上限までを見せ、下端の
       「すべてを見る」でその束だけの全件画面へ送る。ハブの中で
       広げる操作（＋N件を見る／閉じる）は持たない。               */
    const moreBtn = over
      ? '<a class="ib-more" href="list.html?g=' + g + '">すべてを見る（' + full.length + '件）' +
        '<span class="chev">' + IC.chevR + '</span></a>'
      : '';
    /* 振り分け前の束は、pre/post のような「時期の中の進捗」を持たない
       （振り分け待ちの一時置き場なので）。件数バーは出さず、行だけ並べる。 */
    const tally = g === 'undecided' ? '' :
      '<div class="tally">' +
        '<div><span class="tl">' + esc(ui.badges.open) + '</span><span class="tv tv-or">' + t.open + '件</span></div>' +
        '<div><span class="tl">' + esc(ui.badges.ready) + '</span><span class="tv tv-gr">' + t.ready + '件</span></div>' +
        '<div><span class="tl">' + esc(ui.badges.done) + '</span><span class="tv tv-gy">' + t.done + '件</span></div>' +
      '</div>';
    /* 見出しは2段。上段＝「アイコン＋時間の軸（タブ語）」を大きく、
       下段＝その束が何かの説明（title）を小さく。振り分け前は phone に
       入らないので、従来どおり台紙から立ち上がる耳を持たせる。       */
    const icon = g === 'pre' ? IC.sprout : g === 'post' ? IC.tree : IC.quest;
    const head = g === 'undecided'
      ? '<span class="ib-tab">' + esc(ui.tab) + '</span>' +
        '<div class="ib-h"><span class="ib-ic ic-' + g + '">' + icon + '</span>' +
          '<h4>' + esc(ui.title) + '</h4><span class="ib-n n-' + g + '">' + full.length + '件</span></div>'
      : '<div class="ib-h ib-h2">' +
          '<span class="ib-ic ic-' + g + '">' + icon + '</span>' +
          '<span class="ib-ttl"><b>' + esc(ui.tab) + '</b>' +
            '<small>' + esc(ui.title) + '</small></span>' +
          '<span class="ib-n n-' + g + '">' + full.length + '件</span>' +
        '</div>';
    return '<div class="iblock ib-' + g + '">' +
      head +
      '<p class="ib-lead">' + ui.lead + '</p>' +
      tally +
      list.map(idxRowHTML).join('') +
      moreBtn +
    '</div>';
  }

  /* pre／post の束を iPhone の外観で包む。端末そのものを再現するのが
     目的ではなく、「これは持ち歩く画面＝いつでも開いて確かめられる」
     という位置づけを一目で言うための額装。中身（束＝タブ・台紙・行・
     すべてを見る）は groupBlock のまま素通しする。undecided と支払い
     カードはこの軸に乗らないので包まない。
     ステータスバーの右側（電波・Wi-Fi・電池）だけ添える。時刻の数字は
     実機で二重に見えるので描かない。                                */
  const PHONE_STATUS =
    '<span class="ph-status">' +
      '<svg class="ph-sig" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>' +
      '<svg class="ph-wifi" viewBox="0 0 20 15"><path d="M1.2 5a13 13 0 0 1 17.6 0M4.4 8.3a8.4 8.4 0 0 1 11.2 0M7.6 11.5a3.8 3.8 0 0 1 4.8 0"/></svg>' +
      '<svg class="ph-batt" viewBox="0 0 27 13"><rect x=".6" y=".6" width="22" height="11.8" rx="3.2"/><rect class="ph-batt-fill" x="2.6" y="2.6" width="16" height="7.8" rx="1.8"/><path class="ph-batt-cap" d="M24.4 4.2v4.6a2 2 0 0 0 0-4.6Z"/></svg>' +
    '</span>';

  function phoneWrap(g, inner) {
    return '<div class="phone phone-' + g + '">' +
      '<div class="ph-body"><div class="ph-screen">' +
        '<span class="ph-island"></span>' + PHONE_STATUS +
        '<div class="ph-scroll">' + inner + '</div>' +
      '</div></div>' +
    '</div>';
  }

  /* チップは横幅を3等分に固定。4件目以降は行を増やして続ける。 */
  function payChips(linked) {
    return linked.map(it =>
      '<span class="chip2">' + markHTML(it.name) + '<span class="cl">' + esc(it.name) + '</span></span>').join('');
  }

  function payBlock() {
    const cardsHTML = S.cards.map(c => {
      const f = S.cardFacts(c.id);
      const chips = payChips(f.linked);
      /* 上半分はカードの券面そのもの。ICチップ・番号・名義・有効期限を
         実物と同じ位置に置く。下半分は SeiZen 側の記録（止めたときに
         何が止まるか、どの契約がぶら下がるか）。券面を再現すること自体
         が目的ではないので、券面には状態を持ち込まない。            */
      return '<button class="paycard" type="button" data-open="' + c.id + '">' +
        '<div class="pc-face pf-' + esc(c.brand) + '">' +
          '<div class="pc-h"><b>' + esc(c.name) + '</b>' +
            '<span class="lnk">' + f.linked.length + '契約</span></div>' +
          /* チップ・番号・名義・期限を横一列に置く。券面に載る情報は
             これだけなので、段を作らずに1行で収める。            */
          '<div class="pc-mid"><span class="pc-chip"></span>' +
            '<span class="pc-tail">•••• ' + esc(c.info.tail) + '</span>' +
            '<span class="pc-nm"><i>名義</i>' + esc(c.info.holder) + '</span>' +
            '<span class="pc-exp"><i>有効期限</i>' + esc(c.info.expiry) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="pc-body">' +
          '<div class="pc-warn">' + IC.warn + 'このカードを止めると、' + f.linked.length + '件の支払いが止まります</div>' +
          '<div class="chips">' + chips + '</div>' +
        '</div>' +
      '</button>';
    }).join('');
    return '<div class="iblock ib-pay">' +
      '<div class="ib-h"><span class="ib-ic ic-pay">' + IC.card + '</span>' +
        '<h4>支払いのつながり</h4><span class="ib-n n-pay">' + S.cards.length + '件の経路</span></div>' +
      '<p class="ib-lead">支払い方法ごとに、紐づく契約をまとめています。支払い手段を変更・停止する前にご確認ください。</p>' +
      '<div class="paycards">' + cardsHTML + '</div>' +
    '</div>';
  }

  /* ── 詳細：セクション ─────────────────────────────── */

  /* バッジの隣に置く、対応完了の切り替えボタン。準備済みのときだけ
     「対応完了にする」を出し、対応完了の後は「準備済みに戻す」に
     変わる。確認が必要（open）のときはそもそも出さない＝完了は
     準備済みからしか踏めない。                                    */
  function completeToggleHTML(b) {
    if (b.kind === 'ready')
      return '<button type="button" class="complete-btn" data-complete="1">' + IC.check + '対応完了にする</button>';
    if (b.kind === 'done')
      return '<button type="button" class="complete-btn on" data-complete="1">' + IC.loop + '準備済みに戻す</button>';
    return '';
  }

  /* 綴じ代のいちばん下に置く、この記録を削除するための一角。追加した
     サービス（it.added）だけに出す。seed のサービスには出さない。
     押すとその場で「削除しますか？」の確認を展開し、もう一段踏んで
     から実際に消す（画面内の確認。ブラウザ標準ダイアログは使わない）。 */
  let confirmingDelete = false;
  function deleteZoneHTML(it) {
    if (!it || !it.added) return '';
    if (confirmingDelete) {
      return '<div class="rdelete confirming">' +
        '<p>このサービスを削除しますか？<br>元に戻せません。</p>' +
        '<div class="rdelete-btns">' +
          '<button type="button" class="rdel-yes" data-delyes="1">削除する</button>' +
          '<button type="button" class="rdel-no" data-delno="1">やめる</button>' +
        '</div></div>';
    }
    return '<div class="rdelete">' +
      '<button type="button" class="rdel-open" data-delopen="1">' + IC.trash + 'このサービスを削除</button>' +
    '</div>';
  }

  /* 見出し行の右端に置く、開閉をまとめて切り替えるボタン。個別の
     節の開閉状態から「今すべて閉じているか」をその都度読み、逆を
     押せる形にする（別に真偽値を持たない）。押した結果はそのまま
     collapseAllPref として、次に開く項目にも引き継がれる。         */
  function pgCollapseHTML() {
    const allClosed = COLLAPSIBLE_KEYS.every(k => closedSections.has(k));
    return '<button type="button" class="pg-collapse" data-collapseall="1">' +
      (allClosed ? 'すべて開く' : 'すべて閉じる') +
      '<span class="chev' + (allClosed ? ' closed' : '') + '">▲</span></button>';
  }

  /* editable を渡した節は、見出しの右に編集ボタンを持つ。開閉の的の
     中に置くので、その部分だけクリックを止めて開閉に伝えない。     */
  function sectionHTML(key, tone, icon, title, sub, body, alwaysOpen, editable, state) {
    const closed = !alwaysOpen && closedSections.has(key);
    const on = editSection === key;
    const stateBtn = state
      ? '<span class="ast ' + (state.ok ? 'cv-ok' : 'cv-ng') + '" data-proc="1">' +
        (state.ok ? IC.check : IC.alert) + (state.ok ? '確認済み' : '確認が必要') + '</span>'
      : '';
    const editBtn = editable
      ? '<span class="sc-edit' + (on ? ' on' : '') + '" data-editsec="' + key + '">' +
        (on ? IC.check + '入力を終える' : IC.pen + '編集する') + '</span>'
      : '';
    return '<div class="sect' + (on ? ' editing' : '') + '">' +
      '<button class="sc-h ' + tone + (closed ? ' closed' : '') + '" type="button" data-sect="' + key + '">' +
        '<span class="sc-bar"></span>' + icon.replace('<svg', '<svg class="sic"') +
        '<h5>' + esc(title) + '</h5>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') +
        '<span class="sc-tail">' + stateBtn + editBtn +
        (alwaysOpen ? '' : '<span class="chev">▲</span>') + '</span></button>' +
      (closed ? '' : '<div class="sc-body">' + body + '</div>') +
    '</div>';
  }

  /* いまの状況｜左にリングで到達度、右に3項目を並べる。押すとその節へ
     飛ぶ。各項目は「アイコン＋見出し」「大きな○△✕」「補足」の3段。
     アイコンの色は対応方針＝紫／アカウント状況＝緑／手続き方法＝赤で
     固定し、各節の見出し色とそろえる。○△✕の色はその項目の色ではなく、
     済んでいるか（緑）／途中か（橙）／手つかずか（赤）という状態の色。 */
  const STATUS_CAT = {
    policy:  { icon: 'flag',   tone: 'pu' },
    account: { icon: 'person', tone: 'gr' },
    proc:    { icon: 'clip',   tone: 'rd' }
  };
  const STATUS_MARK = { ok: '◎', partial: '△', none: '✕' };

  function statusHTML(it, who) {
    const rows = S.statusRows(it, who);
    const total = rows.length;
    const okCount = rows.filter(r => r.mark === 'ok').length;
    const done = okCount === total;
    const rad = 42, c = 2 * Math.PI * rad;
    const offset = c * (1 - okCount / total);

    const items = rows.map(r => {
      const cat = STATUS_CAT[r.key];
      return '<button class="stat-item stat-' + cat.tone + '" type="button" data-goto="' + r.key + '">' +
        '<span class="stat-top"><span class="stat-ic">' + IC[cat.icon] + '</span>' +
        '<span class="stat-label">' + esc(r.title) + '</span></span>' +
        '<span class="stat-mark mk-' + r.mark + '">' + STATUS_MARK[r.mark] + '</span>' +
        '<span class="stat-note">' + esc(r.note) + '</span></button>';
    }).join('');

    return '<div class="status-panel">' +
      '<div class="status-ring">' +
        '<svg class="ring-svg" viewBox="0 0 100 100">' +
          '<circle class="ring-bg" cx="50" cy="50" r="' + rad + '"/>' +
          '<circle class="ring-fg' + (done ? ' done' : '') + '" cx="50" cy="50" r="' + rad +
            '" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"/>' +
        '</svg>' +
        '<div class="ring-tx' + (done ? ' done' : '') + '"><b>' + (done ? '準備完了' : '確認中') + '</b>' +
        '<span>' + okCount + '/' + total + '</span></div>' +
      '</div>' +
      '<div class="status-items">' + items + '</div>' +
    '</div>';
  }

  /* 意思と、その理由。判断状態のバッジは廃止し、意思の値そのものが
     「検討中」「未確認」まで含めて答えになるようにした。囲みは持たず、
     セクションの白地の上に、細い縦罫だけで左右を分ける。          */
  function policyHTML(it, label) {
    const p = it.policy, intent = S.intentOf(it);
    const opts = Object.keys(S.INTENTS).map(k => ({ value: k, label: S.INTENTS[k].label }));
    const intentOpen = editSection === 'policy' || (editing && editing.path === 'policy.intent');
    const intentBody = intentOpen
      ? evSelect('policy.intent', p.intent, opts)
      : '<span class="ev ev-big" data-edit="policy.intent" data-kind="select">' +
        esc(S.intentLabel(it)) + '</span>';
    return '<div class="policy">' +
      '<div class="pol-l">' +
        '<span class="pol-lb">' + esc(label || '本人の意思') + '</span>' +
        '<div class="intent">' + IC[intent.icon].replace('<svg', '<svg class="i-' + intent.tone + '"') +
          intentBody + '</div>' +
      '</div>' +
      '<div class="pol-r">' +
        '<span class="pol-lb">理由・背景</span>' +
        '<div class="pol-reason">' + ev('policy.reason', p.reason, 'area', '例：利用予定がないため、解約します。') + '</div>' +
        '<div class="pol-next">' + IC.cal +
          '<span>次回判断のタイミング：' +
          ev('policy.nextTiming', p.nextTiming, 'line', '例：次回の帰省時（2024年8月）') + '</span></div>' +
      '</div>' +
    '</div>';
  }

  /* 未入力欄のヒント。ラベルごとに何を書けばいいかが伝わる例を出す。
     暗証番号など秘匿情報は、値そのものではなく置き場所の例にする
     （銀行口座の WHERE_HINT と同じ考え方）。                        */
  const ACCOUNT_HINT = {
    'ログインID / パスワード': '例：書類ケース「デジタル情報」に保管',
    '登録メールアドレス':      '例：taro***@gmail.com',
    '認証端末（2段階認証）':    '例：本人のスマートフォン',
    'お客様番号':              '例：1234-5678-90',
    'お客様ID':                '例：SN-2201987',
    '契約番号':                '例：D-88213456',
    '手続き窓口':              '例：カスタマーセンター 0120-000-000',
    '検針票・請求書のありか':   '例：自宅・リビングの書類ケース',
    '契約書類のありか':        '例：自宅・リビングの書類ケース',
    '本人の端末のありか':      '例：自宅・本人の部屋',
    'カード本体':              '例：自宅・本人の財布',
    '暗証番号':                '例：自宅の金庫にメモを保管',
    'ネット明細のログイン':    '例：書類ケース「デジタル情報」に保管'
  };

  /* account 行の状態。ok＝確認済み、none＝確認が必要の2値が基本。
     「設定なし」は、その項目自体が存在しないことがあり得るラベル
     （2段階認証など）だけが持つ第3の選択肢で、地の文の言い換えでは
     ないので、対象ラベルに限りボタンではなく選択肢（セレクト）で
     選ぶ。それ以外の行は押すたびに確認済み⇄確認が必要の2値だけを
     行き来する。                                                    */
  const ACCOUNT_STATE_UI = {
    ok:   { cls: 'cv-ok', icon: 'check', text: '確認済み' },
    na:   { cls: 'cv-na', icon: 'dash',  text: '設定なし' },
    none: { cls: 'cv-ng', icon: 'alert', text: '確認が必要' }
  };
  const NA_CAPABLE = ['認証端末（2段階認証）'];

  function accountHTML(it) {
    const rows = it.account.map((a, i) => {
      const st = S.accountState(a);
      const ui = ACCOUNT_STATE_UI[st];
      const naDim = st === 'na' ? ' arow-na' : '';
      const naCapable = NA_CAPABLE.indexOf(a.label) !== -1;
      /* 見た目は全行共通のボタン。na対応行だけ、同じボタンの上に透明な
         select を重ねて実体にする（class="ast" は共有し、ast-pick で
         セレクトだけを狙って矢印とクリック域を足す）。押した瞬間に
         ネイティブの選択肢が開くので、ボタンの絵のまま3択になる。   */
      const ctrl = naCapable
        ? '<span class="ast-wrap"><button class="ast ast-pick ' + ui.cls + '" type="button" tabindex="-1">' +
          IC[ui.icon] + ui.text + '</button>' +
          '<select class="ast-sel" data-ok="' + i + '" aria-label="' + esc(a.label) + 'の状態">' +
          ['ok', 'none', 'na'].map(k => '<option value="' + k + '"' + (k === st ? ' selected' : '') +
            '>' + ACCOUNT_STATE_UI[k].text + '</option>').join('') + '</select></span>'
        : '<button class="ast ' + ui.cls + '" type="button" data-ok="' + i + '">' +
          IC[ui.icon] + ui.text + '</button>';
      return '<div class="arow' + naDim + '"><span class="aic">' + IC[a.icon] + '</span>' +
        '<span class="alb">' + esc(a.label) + '</span>' +
        '<span class="avl">' + (st === 'na'
          ? '<span class="ev ev-na">設定なし</span>'
          : ev('account.' + i + '.value', a.value, 'line', ACCOUNT_HINT[a.label] || '例：未確認')) + '</span>' +
        ctrl + '</div>';
    }).join('');
    return '<div class="acc-list">' + rows + '</div>';
  }

  /* 契約情報は綴じ代（左）へ置く「変わらない事実」。右の本体は
     「どう対応するか」だけにするので、ここでは cinfo の横並びグリッド
     ではなく、綴じ代の rmeta と同じ縦積みの1カラムで描く。          */
  function spineContractHTML(it) {
    const c = it.contract;
    const payOpts = [{ value: 'unknown', label: '未確認' }]
      .concat(S.cards.map(k => ({ value: k.id, label: k.name })))
      .concat([{ value: 'acct', label: 'ゆうちょ銀行 自動振替' }, { value: 'none', label: '費用なし' }]);
    /* paymentCard も paymentLabel も無い契約は「未確認」。ラベルの
       文字列でだけ 費用なし／自動振替 を区別し、それ以外は未確認。 */
    const payVal = c.paymentCard
      ? c.paymentCard
      : c.paymentLabel === '費用なし' ? 'none'
      : c.paymentLabel === 'ゆうちょ銀行 自動振替' ? 'acct'
      : 'unknown';
    const card = c.paymentCard ? S.findCard(c.paymentCard) : null;
    const amtLabel = c.cycle === 'yearly' ? '年額料金' : '月額料金';
    const amtUnset = c.amount == null;
    const amt = amtUnset ? '' : (!c.paymentCard && c.amount === 0) ? '費用なし' : S.yen(c.amount);
    const on = editSection === 'info';
    return '<div class="rspine">' +
      '<div class="rsp-h"><span>契約情報</span>' +
        '<button type="button" class="rsp-edit' + (on ? ' on' : '') + '" data-editsec="info" aria-label="契約情報を編集">' +
          (on ? IC.check : IC.pen) + '</button></div>' +
      '<div class="rsp-row"><small>契約者</small><b>' + ev('contract.holder', c.holder, 'line', '例：父 太郎') + '</b></div>' +
      '<div class="rsp-row"><small>支払い方法</small><b>' +
        evSelect('contract.paymentCard', payVal, payOpts, { emptyValue: 'unknown', placeholder: '例：楽天カード' }) +
        (card ? '<em>•••• ' + esc(card.info.tail) + '</em>' : '') + '</b></div>' +
      '<div class="rsp-row"><small>' + amtLabel + '</small><b>' +
        ((editing && editing.path === 'contract.amount') || on
          ? ev('contract.amount', amtUnset ? '' : String(c.amount), 'line', '例：1980')
          : '<span class="ev' + (amtUnset ? ' ev-empty' : '') + '" data-edit="contract.amount" data-kind="line">' +
              esc(amtUnset ? '例：1,980' : amt) + '</span>') +
        '</b></div>' +
      '<div class="rsp-row"><small>契約開始時期</small><b>' + ev('contract.started', c.started, 'line', '例：2020年頃') + '</b></div>' +
      '<div class="rsp-row"><small>次回請求日</small><b>' + ev('contract.nextBill', c.nextBill, 'line', '例：毎月〇日頃') + '</b></div>' +
    '</div>';
  }

  /* 参考リンクは値の入力欄であると同時に、押せばそこへ向かう場所でも
     ある。読む場所ではリンクとして見せ、鉛筆の的だけを編集に割り当てる
     （テキストを直接押すと編集に化けるほかの ev() とは分ける）。       */
  function linkField(path, value, placeholder) {
    const secOn = editSection === 'proc';
    if ((editing && editing.path === path) || secOn) {
      const ph = placeholder ? ' placeholder="' + esc(placeholder) + '"' : '';
      return '<input class="ef" data-ef="1" data-path="' + path + '"' + ph + ' value="' + esc(value) + '">';
    }
    if (!value)
      return '<span class="ev ev-empty" data-edit="' + path + '" data-kind="line">' + esc(placeholder || '未入力') + '</span>';
    return '<a class="ev-link" href="#" data-linkclick="1">' + esc(value) + ' ↗</a>' +
      '<button class="ev-editbtn" type="button" data-edit="' + path + '" data-kind="line" aria-label="参考リンクを編集">' + IC.pen + '</button>';
  }

  function procedureHTML(it) {
    const p = it.procedure;
    /* 手順は1本のテキストにまとめず、1行＝1項目のまま個別に編集する。
       節を編集中は、SEC_OF の prefix 一致で全行が同時に入力欄になる。
       ＋は既存の番号の続きとして末尾に足す。✕は行ごとの削除で、
       どちらも編集中だけ出す。                                      */
    const secOn = editSection === 'proc';
    const stepsBody = '<ul class="steps">' +
      p.steps.map((s, i) => '<li><span class="sn">' + (i + 1) + '</span>' +
        ev('procedure.steps.' + i, s, 'line', '例：ログインする') +
        (secOn ? '<button class="step-del" type="button" data-delstep="' + i + '" aria-label="この手順を削除">✕</button>' : '') +
        '</li>').join('') +
      '</ul>' +
      (secOn ? '<button class="step-add" type="button" data-addstep="1">＋ 手順を追加</button>' : '');
    return '<div class="proc2">' +
      '<div><span class="pr-lb">《 手続き先</span>' +
        '<p class="pr-where">' + ev('procedure.where', p.where, 'area', '例：Netflix ＞ アカウント ＞ メンバーシップ') + '</p>' +
        '<span class="pr-lb">手続きの流れ</span>' +
        stepsBody + '</div>' +
      '<div>' +
        '<div class="proc-status-row"><button class="proc-status ' + (S.procChecked(it) ? 'cv-ok' : 'cv-ng') +
          '" type="button" data-proc="1">' + (S.procChecked(it) ? IC.check + '確認済み' : IC.alert + '確認が必要') +
        '</button></div>' +
        '<div class="prbox"><div class="ph">' + IC.link + '参考リンク</div>' +
          linkField('procedure.link', p.link, '例：〇〇 解約方法ヘルプ') + '</div>' +
        '<div class="prbox pt"><div class="ph">' + IC.pin + 'ポイント</div>' +
          ev('procedure.point', p.point, 'area', '例：解約はいつでも可能です。次回請求日の前日までに手続きします。') + '</div>' +
      '</div>' +
    '</div>';
  }

  function memoHTML(it) {
    return '<div class="memo">' +
      ev('memo', it.memo, 'area', '例：家族が対応する際に伝えておきたいこと') + '</div>';
  }

  /* 事前・事後のどちらも同じ5セクション。中身の言葉だけが変わる。 */
  function procSub(it) {
    if (it.group === 'post') return '（必要になったときの手順）';
    if (it.group === 'undecided') return '';
    return it.policy.intent === 'continue' ? '（継続時の注意）' : '（解約の手順）';
  }

  /* 振り分け前｜詳細本体の先頭に置く、いまのうち／そのときへ振り分ける
     ためのカード。「？」を押すと判断のよりどころを1行で開く（画面内の
     展開。ほかの ev や削除の確認と同じ手つき）。カードを押した瞬間に
     it.group が pre/post へ移り、以降は普通の詳細画面に戻る。         */
  let sortHintOpen = false;
  const SORT_CARDS = [
    { g: 'pre',  icon: 'sprout', title: 'いまのうち', sub: '本人しかできない手続きがある' },
    { g: 'post', icon: 'tree',   title: 'そのとき',   sub: '家族があとから手続きできる' }
  ];
  function sortBlockHTML() {
    const hint = sortHintOpen
      ? '<p class="sort-hint">本人による事前の対応が必要かどうかで判断します。' +
        '事前対応が必要なら「いまのうち」、必要になってから家族が対応できるなら「そのとき」です。</p>'
      : '';
    const cards = SORT_CARDS.map(c =>
      '<button type="button" class="sort-card" data-sort="' + c.g + '">' +
        '<span class="sort-ic">' + IC[c.icon] + '</span>' +
        '<span class="sort-tx"><b>' + esc(c.title) + '</b><small>' + esc(c.sub) + '</small></span>' +
        '<span class="sort-arw">' + IC.chevR + '</span>' +
      '</button>').join('');
    return '<div class="sortblock">' +
      '<div class="sort-h"><h5>対応時期を振り分ける</h5>' +
        '<button type="button" class="sort-help" data-sorthelp="1" aria-label="振り分けの判断について">' + IC.quest + '</button></div>' +
      hint +
      '<div class="sort-cards">' + cards + '</div>' +
    '</div>';
  }

  /* 綴じ代の時期ラベル。undecided は本体の振り分けブロックが受け持つ
     ので触らせない。pre/post は、ラベルそのものを押すとその場でセレクト
     （いまのうち／そのとき）に化け、選び直したらすぐ反映する（鉛筆は
     出さず、他の項目と同じインラインの手つきにそろえる）。          */
  function fileCardHTML(it) {
    const undecided = it.group === 'undecided';
    const rule = undecided ? ';background:#8a8578' : it.group === 'post' ? ';background:#5da37b' : '';
    let label;
    if (editingGroup && !undecided) {
      label = '<select class="fc-groupsel" data-groupsel="1">' +
        [['pre', 'いまのうち'], ['post', 'そのとき']].map(([v, t]) =>
          '<option value="' + v + '"' + (it.group === v ? ' selected' : '') + '>' + t + '</option>').join('') +
        '</select>';
    } else if (undecided) {
      label = '<small>' + esc(S.GROUP_UI[it.group].tab) + '</small>';
    } else {
      label = '<small class="fc-grouplabel" data-groupedit="1" role="button" tabindex="0" ' +
        'aria-label="対応時期を変更">' + esc(S.GROUP_UI[it.group].tab) + '</small>';
    }
    return '<div class="filecard' + (editingGroup && !undecided ? ' fc-editing' : '') + '">' +
      label + '<b>No.<i>' + esc(it.no) + '</i></b>' +
      '<div class="rule" style="' + rule + '"></div></div>';
  }

  function sheetHTML(it) {
    const undecided = it.group === 'undecided';
    const b = S.itemBadge(it);
    const bTxt = b.kind === 'open' ? b.text + '　' + b.n + '件' : b.text;
    return '<div class="rings">' +
        '<span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>' +
        '<span class="ring r4"></span><span class="ring r5"></span>' +
        fileCardHTML(it) +
        spineContractHTML(it) +
        '<div class="rmeta"><small>登録日</small><b>' + esc(it.registered) + '</b>' +
          '<small>最終更新日</small><b>' + esc(it.updated) + '</b></div>' +
        '<div class="rfoot">' + IC.box + '<span>家族のための<br>契約・アカウント記録</span></div>' +
        deleteZoneHTML(it) +
      '</div>' +
      '<div class="page">' +
        /* 追加したサービスは、名前・カテゴリを他の項目と同じインライン
           編集にする（押すと入力欄）。seed は markOf のロゴ判定が名前
           に依存するので、読み取り専用のまま。                        */
        '<div class="pg-h">' +
          (it.added
            ? '<span class="nm">' + ev('name', it.name, 'line', '例：DHC 定期便') + '</span>' +
              '<span class="cat">' + ev('category', it.category, 'line', '例：化粧品') + '</span>'
            : '<span class="nm">' + esc(it.name) + '</span>' +
              '<span class="cat">' + esc(it.category) + '</span>') +
          '<span class="pol hb-' + b.tone + '">' + esc(bTxt) + '</span>' +
          completeToggleHTML(b) +
          pgCollapseHTML() + '</div>' +
        '<div class="pg-body">' +
          (undecided ? sortBlockHTML() : '') +
          statusHTML(it) +
          sectionHTML('policy', 't-pu', IC.flag, '対応方針', '', policyHTML(it), false, true) +
          sectionHTML('account', 't-gr', IC.person, S.GROUP_UI[it.group].accountTitle,
            S.GROUP_UI[it.group].accountSub, accountHTML(it), false, true) +
          sectionHTML('proc', 't-rd', IC.clip, '手続き方法', procSub(it), procedureHTML(it), false, true) +
          sectionHTML('memo', 't-cr', IC.pen, 'メモ', '', memoHTML(it), false, true) +
        '</div>' +
      '</div>';
  }

  /* ── 詳細：支払いカード ───────────────────────────
     契約・アカウントの詳細と丸ごと同じ骨格（いまの状況／対応方針／
     アカウント情報／手続き方法／メモ）を、そのまま同じ関数で描く。
     policyHTML の「本人の意思」だけ、家族が決める話であることが
     伝わるよう「家族の方針」に言い換える。カード情報は契約情報の
     代わりで、連絡先は手続き方法の「手続き先」と二重に持たないので
     省く。末尾に、このカードで支払っている契約の一覧を足す。         */

  function spineCardInfoHTML(card) {
    const c = card.info;
    const on = editSection === 'cardinfo';
    return '<div class="rspine">' +
      '<div class="rsp-h"><span>カード情報</span>' +
        '<button type="button" class="rsp-edit' + (on ? ' on' : '') + '" data-editsec="cardinfo" aria-label="カード情報を編集">' +
          (on ? IC.check : IC.pen) + '</button></div>' +
      '<div class="rsp-row"><small>カード会社</small><b>' + ev('info.issuer', c.issuer, 'line', '例：楽天カード株式会社') + '</b></div>' +
      '<div class="rsp-row"><small>名義人</small><b>' + ev('info.holder', c.holder, 'line', '例：父 太郎') + '</b></div>' +
      '<div class="rsp-row"><small>下4桁</small><b>•••• ' + ev('info.tail', c.tail, 'line', '例：1234') + '</b></div>' +
      '<div class="rsp-row"><small>有効期限</small><b>' + ev('info.expiry', c.expiry, 'line', '例：2027/03') + '</b></div>' +
    '</div>';
  }

  function linkedRowHTML(it) {
    return '<button class="irow" type="button" data-open="' + it.id + '">' +
      markHTML(it.name) +
      '<span class="nm"><b>' + esc(it.name) + '</b><small>' + esc(it.category) + '</small></span>' +
      '<span class="st-badge" style="background:#f4f2eb;color:#6d7169">' + esc(S.amountText(it)) + '</span>' +
      '<span class="arw">›</span></button>';
  }

  function clinkedHTML(card) {
    const f = S.cardFacts(card.id);
    if (!f.linked.length) return '<p class="memo">この支払い方法に紐づく契約はありません。</p>';
    return '<div class="linked-list">' + f.linked.map(linkedRowHTML).join('') + '</div>';
  }

  function cardSheetHTML(card) {
    const f = S.cardFacts(card.id);
    const b = S.itemBadge(card);
    const bTxt = b.kind === 'open' ? b.text + '　' + b.n + '件' : b.text;
    return '<div class="rings">' +
        '<span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>' +
        '<span class="ring r4"></span><span class="ring r5"></span>' +
        '<div class="filecard"><small>支払いカード</small><b>' + esc(card.name) + '</b>' +
          '<div class="rule" style="background:#4681a0"></div></div>' +
        spineCardInfoHTML(card) +
        '<div class="rfoot">' + IC.card + '<span>支払いの経路を<br>まとめて記録</span></div>' +
      '</div>' +
      '<div class="page">' +
        '<div class="pg-h"><span class="nm">' + esc(card.name) + '</span>' +
          '<span class="cat">' + esc(card.info.issuer) + '</span>' +
          '<span class="pol hb-' + b.tone + '">' + esc(bTxt) + '</span>' +
          completeToggleHTML(b) +
          pgCollapseHTML() + '</div>' +
        '<div class="pg-body">' +
          (f.linked.length ? '<div class="pc-warn" style="margin:0 4px 18px">' + IC.warn +
            'このカードを止めると、' + f.linked.length + '件の支払いが止まります</div>' : '') +
          statusHTML(card, '家族') +
          sectionHTML('policy', 't-pu', IC.flag, '対応方針', '', policyHTML(card, '家族の方針'), false, true) +
          sectionHTML('account', 't-gr', IC.person, S.GROUP_UI.card.accountTitle, '', accountHTML(card), false, true) +
          sectionHTML('proc', 't-rd', IC.clip, '手続き方法', procSub(card), procedureHTML(card), false, true) +
          sectionHTML('clinked', 't-cr', IC.link, '紐づく契約一覧', '（' + f.linked.length + '件）', clinkedHTML(card), true, false) +
          sectionHTML('memo', 't-cr', IC.pen, 'メモ', '', memoHTML(card), false, true) +
        '</div>' +
      '</div>';
  }

  /* いま開いているのが契約か、支払いカードかは openId から引く。
     どちらもこの1つの sheet を共有するので、編集の書き込み先を
     ここで一本化する。                                            */
  function currentEntity() {
    return S.findItem(openId) || S.findCard(openId);
  }

  function render() {
    document.getElementById('cnt').textContent = S.items.length + '件';
    /* ナビの件数は外殻の持ち物。描き直すたびに知らせておく。 */
    SeiZen.setNavCount('contract-digital', S.items.length + '件');
    /* 振り分け前の束は、1件以上あるときだけ pre/post の「上」に全幅で
       出す。まず振り分けを済ませてから各時期の準備、という順序。
       0件になったら束ごと消える。 */
    const undecided = S.undecidedItems().length ? groupBlock('undecided') : '';
    idxgrid.innerHTML = undecided +
      phoneWrap('pre', groupBlock('pre')) +
      phoneWrap('post', groupBlock('post')) +
      payBlock();
    if (openId) renderSheet();
  }

  /* 背後に覗く台紙の色は、索引の束（.ib-pre/.ib-post）と同じ軸で
     出し分ける。カードはどちらの軸にも乗らないので、今はどちらの
     クラスも付けない（クリームのまま）。                          */
  function renderSheet() {
    detailNav.innerHTML = detailNavHTML();
    const it = S.findItem(openId);
    if (it) {
      dtlFile.classList.toggle('dtl-post', it.group === 'post');
      sheet.innerHTML = sheetHTML(it); focusEditor(); return;
    }
    const c = S.findCard(openId);
    if (c) {
      dtlFile.classList.remove('dtl-post');
      sheet.innerHTML = cardSheetHTML(c); focusEditor(); return;
    }
  }

  /* 前へ／次へは、いま開いているのが契約かカードかで別の並びをたどる。
     契約は「いま開いている時期グループ」の中だけを、索引と同じ並び
     （確認が必要なものが先）でたどる。時期をまたいでは動かさない。
     カードは支払いのつながりの並びのまま。                          */
  function navList() {
    const it = S.findItem(openId);
    if (it) return { list: idxOrder(S.byGroup(it.group)), idx: -1, id: openId };
    return { list: S.cards, idx: -1, id: openId };
  }

  function detailNavHTML() {
    const nav = navList();
    const idx = nav.list.findIndex(x => x.id === nav.id);
    const prev = idx > 0 ? nav.list[idx - 1] : null;
    const next = (idx >= 0 && idx < nav.list.length - 1) ? nav.list[idx + 1] : null;
    /* 中央は「戻り先」を3つ並べる。左右の「いまのうち／そのとき」は
       その束だけの全件画面（list.html?g=…）へ。真ん中はハブ（索引）へ
       戻るのでこれまで通り SPA 内で閉じる（data-back）。               */
    /* 3つの戻り先を、1つの枠（ピル）の中に | で仕切って並べる。
       個別に丸で囲むとクドいので、囲みは共通で1つ。真ん中（ハブ）
       だけ塗って主にし、両脇の一覧は文字だけで従。               */
    const backNav =
      '<nav class="dtl-back">' +
        '<a class="dtl-back-side" href="list.html?g=pre">「いまのうち」一覧</a>' +
        '<span class="dtl-back-sep"></span>' +
        '<button type="button" class="dtl-back-hub" data-back="1">契約・デジタルの一覧</button>' +
        '<span class="dtl-back-sep"></span>' +
        '<a class="dtl-back-side" href="list.html?g=post">「そのとき」一覧</a>' +
      '</nav>';
    return '<button type="button" class="dtl-pbtn" data-prev="1"' + (prev ? '' : ' disabled') + '>' +
        '<span class="dtl-arw">' + IC.chevL + '</span><span class="dtl-lb"><small>前へ</small>' + (prev ? esc(prev.name) : '') + '</span></button>' +
      backNav +
      '<button type="button" class="dtl-pbtn" data-next="1"' + (next ? '' : ' disabled') + '>' +
        '<span class="dtl-lb dtl-lb-r"><small>次へ</small>' + (next ? esc(next.name) : '') + '</span><span class="dtl-arw">' + IC.chevR + '</span></button>';
  }

  /* 開いた欄に手を置いたままにする。セレクトは開いた瞬間に選ばせる。 */
  function focusEditor() {
    if (editingGroup) {
      const sel = sheet.querySelector('[data-groupsel]');
      if (sel) { sel.focus(); openIfSelect(sel); }
      return;
    }
    if (editSection) {
      const first = sheet.querySelector('.sect.editing [data-ef]');
      if (first) { first.focus(); openIfSelect(first); }
      return;
    }
    if (!editing) return;
    const el = sheet.querySelector('[data-ef]');
    if (!el) { editing = null; return; }
    el.focus();
    if (el.tagName === 'SELECT') { openIfSelect(el); return; }
    el.setSelectionRange(el.value.length, el.value.length);
  }

  /* 選択肢のある項目は、押した瞬間に選択肢まで開く。フォーカスだけ
     ではブラウザが自動で開かないため、明示的に開く（銀行口座と同じ）。 */
  function openIfSelect(el) {
    if (el.tagName === 'SELECT' && el.showPicker) {
      try { el.showPicker(); } catch (e) { /* 対応していない環境は無視 */ }
    }
  }

  /* 節ごとの編集を閉じるとき、開いていた欄をすべて書き戻す。 */
  function commitSection() {
    if (!editSection) return;
    const it = currentEntity();
    if (it) {
      let changed = false;
      sheet.querySelectorAll('[data-ef]').forEach(el => {
        if (applyValue(it, el.dataset.path, el.value)) changed = true;
      });
      if (changed) S.touch(it);
    }
    editSection = null;
    render();
  }

  /* 実際に値が変わったときだけ true を返す。呼び出し側はこれを見て、
     変更がなければ「最終更新日」を動かさない（欄を開いて何も打たずに
     閉じただけで日付が飛ぶのを防ぐ）。                                */
  function applyValue(it, path, val) {
    if (!path) return false;
    if (path === 'contract.amount') {
      const digits = String(val).replace(/[^0-9]/g, '');
      /* 空欄のまま閉じたら未確認（null）に戻す。0 は「費用なし」として
         意味があるので、打ち込まれた 0 とは区別する。                */
      const next = digits === '' ? null : parseInt(digits, 10);
      if (getByPath(it, path) === next) return false;
      setByPath(it, path, next);
      return true;
    } else if (path === 'policy.intent') {
      if (it.policy.intent === val && !it.policy.intentLabel) return false;
      it.policy.intent = val;
      delete it.policy.intentLabel;
      return true;
    } else if (path === 'contract.paymentCard') {
      const before = it.contract.paymentCard + '|' + (it.contract.paymentLabel || '');
      if (val === 'acct')         { it.contract.paymentCard = null; it.contract.paymentLabel = 'ゆうちょ銀行 自動振替'; }
      else if (val === 'none')    { it.contract.paymentCard = null; it.contract.paymentLabel = '費用なし'; }
      else if (val === 'unknown') { it.contract.paymentCard = null; delete it.contract.paymentLabel; }
      else                        { it.contract.paymentCard = val;  delete it.contract.paymentLabel; }
      return before !== it.contract.paymentCard + '|' + (it.contract.paymentLabel || '');
    } else if (path === 'name' || path === 'category') {
      /* サービス名・カテゴリは空にできない。空欄で閉じたら元のまま。
         カテゴリは空欄なら「未分類」に戻す。                        */
      let next = String(val).trim();
      if (path === 'category' && !next) next = '未分類';
      if (!next || getByPath(it, path) === next) return false;
      setByPath(it, path, next);
      return true;
    } else {
      const next = String(val).trim();
      if (getByPath(it, path) === next) return false;
      setByPath(it, path, next);
      return true;
    }
  }

  function commitEdit() {
    if (!editing) return;
    const el = sheet.querySelector('[data-ef]');
    const it = currentEntity();
    if (el && it && applyValue(it, editing.path, el.value)) S.touch(it);
    editing = null;
    render();
  }

  /* 索引→詳細は画面遷移として history に積む（?id= を持つ別画面）。
     索引から出るときの読んでいた位置だけ覚えておき、戻ったら戻す。
     前へ／次へは同じ詳細画面の中の移動なので、履歴は積み替える
     （replace）。索引は消えずスクロール位置を覚えているのではなく、
     ブラウザの戻る操作と同じ形で位置を戻す。                        */
  let savedScroll = 0;

  /* 新しく開く項目の初期の開閉状態。「すべて閉じる」を押した好みが
     あれば、それを引き継いで最初から閉じた状態で開く。              */
  function applyCollapsePref() {
    if (itemClosedSections.has(openId)) {
      closedSections = itemClosedSections.get(openId);
      return;
    }
    closedSections = collapseAllPref ? new Set(COLLAPSIBLE_KEYS) : new Set();
    itemClosedSections.set(openId, closedSections);
  }

  function openSheet(id, opts) {
    opts = opts || {};
    if (!openId) savedScroll = window.scrollY;
    openId = id;
    editing = null;
    editSection = null;
    editingGroup = false;
    confirmingDelete = false;
    sortHintOpen = false;
    applyCollapsePref();
    const url = '?id=' + encodeURIComponent(id);
    if (opts.replace) history.replaceState({ id: id }, '', url);
    else history.pushState({ id: id }, '', url);
    showDetail();
  }

  function closeSheet() {
    openId = null;
    history.pushState(null, '', location.pathname);
    showIndex();
  }

  function showDetail() {
    indexView.hidden = true;
    detailView.hidden = false;
    renderSheet();
    window.scrollTo(0, 0);
  }

  function showIndex() {
    detailView.hidden = true;
    indexView.hidden = false;
    window.scrollTo(0, savedScroll);
  }

  /* ブラウザの戻る／進むボタンにも同じ画面遷移として応答する。 */
  window.addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('id');
    if (id && (S.findItem(id) || S.findCard(id))) {
      openId = id;
      editing = null;
      editSection = null;
      editingGroup = false;
      applyCollapsePref();
      showDetail();
    } else {
      openId = null;
      showIndex();
    }
  });

  /* ── 操作 ─────────────────────────────────────────── */

  idxgrid.addEventListener('click', e => {
    /* 「すべてを見る」は素のリンク（list.html?g=…）なので、ここでは
       行のクリックだけを詳細遷移として拾う。                       */
    const row = e.target.closest('[data-open]');
    if (row) openSheet(row.dataset.open);
  });

  detailView.addEventListener('click', e => {
    if (e.target.closest('[data-back]')) { closeSheet(); return; }

    /* 前へ／次へ。同じ詳細画面の中の移動なので history は積み替える。 */
    const prevBtn = e.target.closest('[data-prev]:not([disabled])');
    if (prevBtn) {
      const nav = navList();
      const idx = nav.list.findIndex(x => x.id === nav.id);
      if (idx > 0) openSheet(nav.list[idx - 1].id, { replace: true });
      return;
    }
    const nextBtn = e.target.closest('[data-next]:not([disabled])');
    if (nextBtn) {
      const nav = navList();
      const idx = nav.list.findIndex(x => x.id === nav.id);
      if (idx >= 0 && idx < nav.list.length - 1) openSheet(nav.list[idx + 1].id, { replace: true });
      return;
    }

    /* 紐づく契約一覧の行。押した契約の詳細へ、新しい画面として進む
       （戻ればカードの詳細に戻る）。                                */
    const openRow = e.target.closest('.linked-list [data-open]');
    if (openRow) { openSheet(openRow.dataset.open); return; }

    /* 参考リンク。実際のURLを持たないプロトタイプなので、遷移の代わりに
       準備中を知らせる。編集は隣の鉛筆ボタンが受け持つ。            */
    if (e.target.closest('[data-linkclick]')) {
      e.preventDefault(); e.stopPropagation();
      show('外部サイトを開く準備中です');
      return;
    }

    /* すべて閉じる／開く。押した結果を好み（collapseAllPref）として
       残すので、次に開く項目にもそのまま引き継がれる。編集中の節を
       畳んで消してしまわないよう、閉じる前にいったん確定する。      */
    if (e.target.closest('[data-collapseall]')) {
      if (editSection) commitSection();
      if (editing) commitEdit();
      const allClosed = COLLAPSIBLE_KEYS.every(k => closedSections.has(k));
      setCollapseAllPref(!allClosed);
      closedSections = collapseAllPref ? new Set(COLLAPSIBLE_KEYS) : new Set();
      itemClosedSections.set(openId, closedSections);
      renderSheet();
      return;
    }
    /* 節ごとの編集ボタン。見出しの的の中にあるので、開閉には渡さない。 */
    const secBtn = e.target.closest('[data-editsec]');
    if (secBtn) {
      e.stopPropagation();
      const key = secBtn.dataset.editsec;
      if (editSection === key) { commitSection(); return; }
      if (editSection) commitSection();
      if (editing) commitEdit();
      editSection = key;
      closedSections.delete(key);
      renderSheet();
      return;
    }

    /* 手続き方法の確認。これも見出しの中なので開閉には渡さない。 */
    if (e.target.closest('[data-proc]')) {
      e.stopPropagation();
      const it = currentEntity();
      it.procedure.checked = !it.procedure.checked;
      S.touch(it);
      render();
      return;
    }

    /* 対応完了の切り替え。準備済み⇄対応完了を行き来するだけで、
       家族側の確認状態そのもの（account／procedure）はいじらない。 */
    if (e.target.closest('[data-complete]')) {
      e.stopPropagation();
      const it = currentEntity();
      it.completed = !it.completed;
      S.touch(it);
      render();
      return;
    }

    /* 綴じ代の時期ラベル｜鉛筆でセレクトに化ける。 */
    if (e.target.closest('[data-groupedit]')) {
      e.stopPropagation();
      if (editing) commitEdit();
      if (editSection) commitSection();
      editingGroup = true;
      renderSheet();
      return;
    }
    /* セレクトの外を押したら閉じる（選び直しは change 側で反映）。 */
    if (editingGroup && !e.target.closest('[data-groupsel]')) {
      editingGroup = false;
      renderSheet();
    }

    /* 振り分け前｜「？」で判断のよりどころを開閉する。 */
    if (e.target.closest('[data-sorthelp]')) {
      e.stopPropagation();
      sortHintOpen = !sortHintOpen;
      renderSheet();
      return;
    }
    /* 振り分け前｜カードを押した時期へ移す。以降は普通の詳細画面。 */
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      e.stopPropagation();
      const it = currentEntity();
      if (it && S.setGroup(it.id, sortBtn.dataset.sort)) {
        sortHintOpen = false;
        render();
        show('「' + it.name + '」を「' + S.GROUP_UI[it.group].tab + '」に振り分けました');
      }
      return;
    }

    /* 追加サービスの削除。まず確認を展開し、もう一段で実際に消す。 */
    if (e.target.closest('[data-delopen]')) {
      e.stopPropagation();
      confirmingDelete = true;
      renderSheet();
      return;
    }
    if (e.target.closest('[data-delno]')) {
      e.stopPropagation();
      confirmingDelete = false;
      renderSheet();
      return;
    }
    if (e.target.closest('[data-delyes]')) {
      e.stopPropagation();
      const it = currentEntity();
      const name = it ? it.name : '';
      if (it && S.removeAdded(it.id)) {
        confirmingDelete = false;
        closeSheet();
        render();
        show('「' + name + '」を削除しました');
      }
      return;
    }

    /* 手順を1つ足す。既存の番号の下に置いた「＋」から、空の手順を
       末尾に追加してすぐ書き込めるようにする。編集中のみ出る。      */
    if (e.target.closest('[data-addstep]')) {
      e.stopPropagation();
      const it = currentEntity();
      it.procedure.steps.push('');
      S.touch(it);
      renderSheet();
      const inputs = sheet.querySelectorAll('.steps li .ef');
      const last = inputs[inputs.length - 1];
      if (last) last.focus();
      return;
    }

    /* 手順を1つ消す。行ごとの✕で、その場から即削除する。 */
    const delStep = e.target.closest('[data-delstep]');
    if (delStep) {
      e.stopPropagation();
      const it = currentEntity();
      it.procedure.steps.splice(+delStep.dataset.delstep, 1);
      S.touch(it);
      renderSheet();
      return;
    }

    /* 別の欄を押したら、開いていた欄はそこで確定する。 */
    const inEditor = e.target.closest('[data-ef]');
    if (editing && !inEditor) commitEdit();
    /* 節の編集中に、その節の外を押したら閉じる。 */
    if (editSection && !inEditor && !e.target.closest('.sect.editing')) commitSection();

    /* ボタンは確認済み⇄確認が必要の2値だけを行き来する。「設定なし」を
       持つ行はボタンではなく選択肢（change ハンドラ側）で切り替える。 */
    const okBtn = e.target.closest('button[data-ok]');
    if (okBtn) {
      const it = currentEntity();
      const a = it.account[+okBtn.dataset.ok];
      a.state = S.accountState(a) === 'ok' ? 'none' : 'ok';
      delete a.ok;
      S.touch(it);
      render();
      return;
    }

    const edit = e.target.closest('[data-edit]');
    if (edit && !editSection) {
      editing = { path: edit.dataset.edit, kind: edit.dataset.kind };
      renderSheet();
      return;
    }

    const goto = e.target.closest('[data-goto]');
    if (goto) {
      closedSections.delete(goto.dataset.goto);
      renderSheet();
      const el = sheet.querySelector('[data-sect="' + goto.dataset.goto + '"]');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.closest('.sect').classList.add('flash');
        setTimeout(() => { const c = sheet.querySelector('.sect.flash'); if (c) c.classList.remove('flash'); }, 1100);
      }
      return;
    }
    const sc = e.target.closest('[data-sect]');
    if (sc) {
      const key = sc.dataset.sect;
      if (closedSections.has(key)) closedSections.delete(key); else closedSections.add(key);
      renderSheet();
    }
  });

  sheet.addEventListener('change', e => {
    /* 綴じ代の時期セレクト。選んだ時期へ移して索引も描き直す。 */
    if (e.target.closest('[data-groupsel]')) {
      const it = currentEntity();
      const to = e.target.value;
      editingGroup = false;
      if (it && S.setGroup(it.id, to)) {
        render();
        show('「' + it.name + '」を「' + S.GROUP_UI[it.group].tab + '」に移しました');
      } else {
        renderSheet();
      }
      return;
    }
    /* 「設定なし」を持つ行の状態選択肢。account.state を直接差し替える。 */
    const stSel = e.target.closest('select[data-ok]');
    if (stSel) {
      const it = currentEntity();
      const a = it.account[+stSel.dataset.ok];
      a.state = stSel.value;
      delete a.ok;
      S.touch(it);
      render();
      return;
    }
    const el = e.target.closest('[data-ef]');
    if (!el || el.tagName !== 'SELECT') return;
    /* 節ごとの編集中は、選んだ場でその値を反映する（例：支払い方法を
       変えたら、隣の下4桁もその場で連動して変わる）。節は閉じない。 */
    if (editSection) {
      const it = currentEntity();
      if (it && el.dataset.path && applyValue(it, el.dataset.path, el.value)) S.touch(it);
      renderSheet();
      return;
    }
    commitEdit();
  });

  sheet.addEventListener('focusout', e => {
    if (editSection) return;
    if (!editing || !e.target.closest('[data-ef]')) return;
    /* 同じ欄の中での移動では閉じない。 */
    setTimeout(() => { if (editing && !sheet.contains(document.activeElement)) commitEdit(); }, 0);
  });

  sheet.addEventListener('keydown', e => {
    /* 綴じ代の時期ラベル（role=button）をキーボードでも開ける。 */
    const gl = e.target.closest('.fc-grouplabel');
    if (gl && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      if (editing) commitEdit();
      if (editSection) commitSection();
      editingGroup = true;
      renderSheet();
      return;
    }
    if (editSection && e.key === 'Escape') { e.stopPropagation(); editSection = null; render(); return; }
    if (editSection) return;
    if (!editing) return;
    if (e.key === 'Escape') { e.stopPropagation(); editing = null; renderSheet(); return; }
    if (e.key === 'Enter' && (editing.kind !== 'area' || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitEdit();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && openId && !editing && !editSection) closeSheet();
  });

  document.getElementById('add-ocr').addEventListener('click', () =>
    { location.href = 'extraction.html'; });

  /* ?id= を持つURLで直接開いたときは、最初から詳細画面を表示する
     （共有リンクや再読み込みでも同じ場所に戻れる）。               */
  const initialId = new URLSearchParams(location.search).get('id');
  if (initialId && (S.findItem(initialId) || S.findCard(initialId))) {
    openId = initialId;
    applyCollapsePref();
  }

  /* ── 追加完了の知らせ ─────────────────────────────
     「サービスを追加」画面が sessionStorage に結果を置いて遷移して
     くる。一覧の上にバナーを出し、追加された行を数秒だけ光らせる。
     一度読んだら消すので、再読み込みでは出ない。                    */
  function consumeAddResult() {
    let res = null;
    try {
      const raw = sessionStorage.getItem('seizen.contract.addResult');
      if (raw) { res = JSON.parse(raw); sessionStorage.removeItem('seizen.contract.addResult'); }
    } catch (e) { return; }
    if (!res) return;
    showAddBanner(res);
    if (res.added && res.added.length) {
      requestAnimationFrame(() => flashAddedRows(res.added));
    }
  }

  function showAddBanner(res) {
    const added = res.added || [], skipped = res.skipped || [];
    if (!added.length && !skipped.length) return;
    const el = document.createElement('div');
    el.className = 'addbanner';
    const lines = [];
    if (added.length)
      lines.push('<p class="ab-main">' + IC.check + '<span>' + added.length +
        '件のサービスを追加しました</span></p>' +
        '<p class="ab-names">' + added.map(esc).join('・') + '</p>');
    if (skipped.length)
      lines.push('<p class="ab-skip">' + IC.info + esc(skipped.join('・')) +
        ' はすでに登録済みです</p>');
    el.innerHTML = lines.join('') +
      '<button type="button" class="ab-close" aria-label="閉じる">✕</button>';
    indexView.insertBefore(el, indexView.firstChild);
    el.querySelector('.ab-close').addEventListener('click', () => el.remove());
    setTimeout(() => { el.classList.add('leaving'); }, 8000);
    setTimeout(() => { el.remove(); }, 8500);
  }

  /* ── 支払い明細から探す：一括追加の結果（モーダル）───────
     解析からの一括追加は件数が読めず、「別の支払い手段で登録済みの
     ため見送り」など予想外の結果も混ざる。軽いバナーでは流されるので、
     一度受け止めてもらうモーダルで出す。閉じたら追加行を光らせる。   */
  function consumeAddResultModal() {
    let res = null;
    try {
      const raw = sessionStorage.getItem('seizen.contract.addResult.modal');
      if (raw) { res = JSON.parse(raw); sessionStorage.removeItem('seizen.contract.addResult.modal'); }
    } catch (e) { return; }
    if (!res) return;
    const added = res.added || [], updated = res.updated || [], skipped = res.skipped || [];
    if (!added.length && !updated.length && !skipped.length) return;

    const ov = document.createElement('div');
    ov.className = 'addmodal-ov';
    const blocks = [];
    if (added.length)
      blocks.push('<div class="am-block am-added"><p class="am-h">' + IC.check +
        '<span>新しく追加　<b>' + added.length + '</b>件</span></p>' +
        '<p class="am-names">' + added.map(esc).join('・') + '</p></div>');
    if (updated.length)
      blocks.push('<div class="am-block am-updated"><p class="am-h">' + IC.check +
        '<span>支払い手段を更新　<b>' + updated.length + '</b>件</span></p>' +
        '<p class="am-names">' + updated.map(esc).join('・') + '</p></div>');
    if (skipped.length)
      blocks.push('<div class="am-block am-skipped"><p class="am-h">' + IC.info +
        '<span>別の支払い手段で登録済みのため見送り　<b>' + skipped.length + '</b>件</span></p>' +
        '<p class="am-names">' + skipped.map(esc).join('・') + '</p></div>');

    ov.innerHTML =
      '<div class="addmodal" role="dialog" aria-modal="true" aria-labelledby="am-title">' +
        '<h2 id="am-title">明細から継続中の支払いを追加しました</h2>' +
        blocks.join('') +
        '<button type="button" class="am-ok">閉じる</button>' +
      '</div>';
    document.body.appendChild(ov);

    function close() {
      ov.remove();
      if (added.length) requestAnimationFrame(() => flashAddedRows(added));
    }
    ov.querySelector('.am-ok').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    document.addEventListener('keydown', function esc2(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
    });
    ov.querySelector('.am-ok').focus();
  }

  function flashAddedRows(names) {
    const set = new Set(names.map(n => n.trim()));
    idxgrid.querySelectorAll('.irow .nm b').forEach(b => {
      if (!set.has(b.textContent.trim())) return;
      const row = b.closest('.irow');
      if (row) {
        row.classList.add('row-added');
        setTimeout(() => row.classList.remove('row-added'), 2600);
      }
    });
  }

  render();
  if (openId) showDetail();
  consumeAddResult();
  consumeAddResultModal();
})(window.SeiZenContract);
