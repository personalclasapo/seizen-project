/* SeiZen プロトタイプ｜不動産・住まいを描く
   ------------------------------------------------------------------
   state.js の事実を間取り図の上に描き、編集を書き戻す。

   ■ 造形の骨格

   上段  所有する物件の一覧（物件の数だけ並ぶ小さな平面図）
   下段  物件ごとの間取り図。7項目が部屋として入る

   間取り図は SVG で描く（CLAUDE.md）。div＋border では家に見えない。
   寸法は実寸比から引き、1 SVG 単位 ＝ 10mm とする。

     外壁   150mm = 15      内壁   100mm = 10
     室内ドア 780mm = 78     玄関ドア 910mm = 91
     掃き出し窓 1690mm = 169

   壁は「二重線＋45°ハッチ」。これが製図の約束で、単色の帯にすると
   間取り図に見えない。開口は壁を切って表し、建具はドア＝開口幅を
   半径とする90°の弧、窓＝壁厚の中の三本線。

   部屋の広さは項目の内容量に対応させてある（事情＝8小項目で最大、
   関係書類＝最小）。造形の都合で内容を切らない。                */
(function () {
  'use strict';

  const S = window.SeiZenRealEstate;
  const { ST, REACH, KINDS, USES, MATTERS, FLOWS } = S;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /* ── グリフ ──────────────────────────────────────
     各領域と同じ手つき。専用の viewBox を持つ線グリフを1本ずつ。 */
  const ic = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';

  const ICONS = {
    house: ic('<path d="M3.5 11.5 12 4.2l8.5 7.3"/><path d="M5.8 10.8V19a1 1 0 0 0 1 1h10.4a1 1 0 0 0 1-1v-8.2"/><path d="M9.8 20v-5.4a1 1 0 0 1 1-1h2.4a1 1 0 0 1 1 1V20"/>'),
    condo: ic('<rect x="5" y="3.5" width="14" height="17" rx="1"/><path d="M8.5 7h2M13.5 7h2M8.5 11h2M13.5 11h2M8.5 15h2M13.5 15h2"/><path d="M10.5 20.5v-2.2h3v2.2"/>'),
    land:  ic('<path d="M3 17.5 12 13l9 4.5-9 4.5Z"/><path d="M12 13V6.5"/><path d="M12 6.5 17 4v3.4L12 9.9Z"/>'),
    other: ic('<path d="M4 20V9.5l8-5.5 8 5.5V20"/><path d="M4 20h16"/><path d="M9.5 20v-4.5h5V20"/>'),

    /* 権利＝印鑑（登記の象徴）。角丸の矩形ではなく、朱肉に押す面と柄 */
    right: ic('<rect x="8.5" y="3.2" width="7" height="6.2" rx=".8"/><path d="M6.4 9.4h11.2a1.4 1.4 0 0 1 1.4 1.4v1.6H5v-1.6a1.4 1.4 0 0 1 1.4-1.4Z"/><path d="M4.2 15.4h15.6v3.2a1.4 1.4 0 0 1-1.4 1.4H5.6a1.4 1.4 0 0 1-1.4-1.4Z"/>'),
    loan:  ic('<rect x="2.8" y="6.6" width="18.4" height="11.4" rx="1.6"/><circle cx="12" cy="12.3" r="2.6"/><path d="M6 10.2v4.2M18 10.2v4.2"/>'),
    party: ic('<circle cx="8.4" cy="8" r="2.6"/><path d="M3.6 19v-2a3.4 3.4 0 0 1 3.4-3.4h2.8A3.4 3.4 0 0 1 13.2 17v2"/><path d="M16 10.4a2.3 2.3 0 1 0 0-4.6M17.6 19v-1.8a3.1 3.1 0 0 0-2-2.9"/>'),
    matter: ic('<path d="M12 3.6 21 19.4H3Z"/><path d="M12 9.6v4.2M12 16.6h.01"/>'),
    key:   ic('<circle cx="7.6" cy="12" r="3.6"/><path d="M11.2 12H21"/><path d="M17.8 12v3.2M20.2 12v2.2"/>'),
    doc:   ic('<path d="M13.6 3.4H7a1.6 1.6 0 0 0-1.6 1.6v14a1.6 1.6 0 0 0 1.6 1.6h10a1.6 1.6 0 0 0 1.6-1.6V8.6Z"/><path d="M13.6 3.4v5.2h5.2"/><path d="M8.6 13h6.8M8.6 16.4h4.4"/>'),
    pin:   ic('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>'),
    tel:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.3 2.2Z"/></svg>',
    pen:   ic('<path d="M4 20h4L19.2 8.8a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16Z"/><path d="M14.6 6.4 17.6 9.4"/>'),
    arrow: ic('<path d="M9 5.5 15.5 12 9 18.5"/>')
  };

  /* ══ 間取り図 ══════════════════════════════════════
     1単位＝10mm。外形 10920×9100mm。
     部屋の矩形（内法）を ROOMS に持ち、カードはこの座標へ
     foreignObject で載せる。壁と部屋の座標が1か所にあるので、
     部屋を動かしたときにカードだけ取り残されることがない。    */
  /* 間取りの寸法は、物件の内容量から毎回組み立てる（layout()）。
     部屋を固定寸法にすると、事情が8件ある家では中身が壁を越え、
     事情が2件の家では床が余る。造形の都合で内容を切らないために、
     **壁の位置のほうを内容に合わせて動かす**。

     PLAN は寸法の決まっている部分（壁厚・建具・横方向の割り）だけ。 */
  const PLAN = {
    w: 1092,
    /* 壁厚（実寸 mm ÷ 10） */
    tOut: 15, tIn: 10,
    /* 建具の開口幅 */
    dDoor: 78, dEntry: 91, dWin: 169,
    /* 横方向の割り。ここは内容量でなく、部屋の性格で決める。
       x=790 で右列（事情）を縦に通し、x=430 で上段を左右に割り、
       x=300 で下段を「入る方法・玄関｜関係書類」に割る。      */
    xMat: 790, xTop: 430, xBot: 300
  };

  /* 内容量から、その物件の間取りの寸法を組み立てる。
     返すのは壁・建具・部屋の実座標。planBase / roomBox はこれを使う。

     高さの見積り（単位は SVG 単位＝10mm）は、行の高さ×件数＋見出し。
     実測ではなく見積りなので、余裕（pad）を足しておく。中身が
     はみ出すより、床が少し余るほうがましだから。                */
  function layout(p, measured) {
    const P = PLAN, t = P.tIn, T = P.tOut;
    const pad = 14;   /* roomBox の内側余白（上下） */

    /* 高さは実測を使う。measured があればそれ、無ければ見積り。
       見積りは初回描画（測る前）にしか使わないので、少々ずれても
       最終結果には出ない。                                        */
    const M = measured || {};
    const h = (key, est) =>
      (M[key] != null ? M[key] : est) + pad * 2;

    const nMat = Object.keys(MATTERS).length;
    const hMat = h('matters', 40 + nMat * 62);

    const hTop = Math.max(h('rights', 2 * 58), h('loan', 6 * 26 + 60), 150);

    const nPt = (p.parties || []).length;
    const hParties = h('parties', nPt ? nPt * 48 : 62);

    const hDocs = h('docs', (p.docs.place ? 42 : 0) +
      ((p.docs.items || []).length ? p.docs.items.length * 38 : 44) + 30);
    const hAccess = h('access', 5 * 26);
    const hGenkan = h('genkan', 40);
    /* 下段は「入る方法＋玄関」と「関係書類」の高いほう */
    const hBot = Math.max(hAccess + t + hGenkan, hDocs, 170);

    /* 縦の壁線。pad は部屋の内法に足す余白（roomBox の pad と対） */
    const y1 = T + hTop;                    /* 上段／中段の境 */
    const y2 = y1 + t + hParties;           /* 中段／下段の境 */
    const hOut = y2 + t + hBot + T;         /* 建物の外形高さ（仮） */
    const yK = y2 + t + hAccess;            /* 上がり框 */

    /* 右列（事情）は、この3段の合計と事情自身の必要高さの高いほう */
    const hInner = hOut - T * 2;
    const hAll = Math.max(hInner, hMat);
    const H = hAll + T * 2;                 /* 最終的な外形高さ */
    /* 3段の高さが足りないぶんは中段（関わる相手）で吸収する
       ――行が伸びる性質の部屋なので、余らせても不自然でない。 */
    const slack = hAll - hInner;
    const Y1 = y1, Y2 = y2 + slack, YK = yK + slack, HB = H - T;

    const x = P.xMat, xT = P.xTop, xB = P.xBot, W = P.w;
    const d = P.dDoor;

    /* 開口の位置 */
    const oTop = [xT - 115, xT - 115 + d];        /* 上段左→中段 */
    const oMid = [xT + 45, xT + 45 + d];          /* 中段→下段 */
    /* 中段（関わる相手）から事情へ入る開口。中段の縦方向の中ほどに
       置く。中段は内容で伸び縮みするので、上端からの固定値ではなく
       中段自身の高さから決める。 */
    const midMid = Y1 + t + (Y2 - Y1 - t) / 2;
    const oMat = [Math.round(midMid - d / 2), Math.round(midMid - d / 2) + d];
    const oKam = [85, 85 + d];                    /* 上がり框の開口 */
    const eX = 180;                               /* 玄関ドア */

    const walls = [
      /* 外周・上（窓2か所で切る） */
      [0, 0, 300, T, 1], [300 + P.dWin, 0, 290, T, 1],
      [300 + P.dWin + 290 + P.dWin, 0, W - (300 + P.dWin * 2 + 290), T, 1],
      /* 外周・下（玄関ドア＋窓で切る） */
      [0, HB, eX, T, 1],
      [eX + P.dEntry, HB, 380, T, 1],
      [eX + P.dEntry + 380 + P.dWin, HB, W - (eX + P.dEntry + 380 + P.dWin), T, 1],
      /* 外周・左右 */
      [0, T, T, HB - T, 1], [W - T, T, T, HB - T, 1],
      /* 内壁・縦：右列（事情）を通す。oMat が開口 */
      [x, T, t, oMat[0] - T, 0], [x, oMat[1], t, HB - oMat[1], 0],
      /* 内壁・縦：上段を左右に割る */
      [xT, T, t, Y1 - T, 0],
      /* 内壁・縦：下段。外壁まで通す */
      [xB, Y2, t, HB - Y2, 0],
      /* 内壁・横：上段／中段の境。oTop が開口 */
      [T, Y1, oTop[0] - T, t, 0], [oTop[1], Y1, x - oTop[1], t, 0],
      /* 内壁・横：中段／下段の境。oMid が開口 */
      [T, Y2, oMid[0] - T, t, 0], [oMid[1], Y2, x - oMid[1], t, 0],
      /* 上がり框。oKam が開口 */
      [T, YK, oKam[0] - T, t, 0], [oKam[1], YK, xB - oKam[1], t, 0]
    ];

    return {
      w: W, h: H,
      walls,
      /* ドア [ヒンジx, ヒンジy, 半径, 向き]（2=上へ開く / 0=右へ） */
      doors: [
        [oTop[0], Y1 + 5, d, 2],
        [oMid[0], Y2 + 5, d, 2],
        [x + 5, oMat[0], d, 0]
      ],
      entry: [eX, HB + 7, P.dEntry],
      wins: [
        [300, 0, P.dWin], [300 + P.dWin + 290, 0, P.dWin],
        [eX + P.dEntry + 380, HB, P.dWin]
      ],
      rooms: {
        rights:  { x: T,      y: T,      w: xT - T,     h: Y1 - T },
        loan:    { x: xT + t, y: T,      w: x - xT - t, h: Y1 - T },
        parties: { x: T,      y: Y1 + t, w: x - T - t,  h: Y2 - Y1 - t },
        access:  { x: T,      y: Y2 + t, w: xB - T,     h: YK - Y2 - t },
        genkan:  { x: T,      y: YK + t, w: xB - T,     h: HB - YK - t },
        docs:    { x: xB + t, y: Y2 + t, w: x - xB - t, h: HB - Y2 - t },
        matters: { x: x + t,  y: T,      w: W - x - t - T, h: HB - T }
      }
    };
  }

  /* 間取りの地（壁・建具・方位）を描く。中身は別に載せる。
     P は layout() が返したその物件の寸法。 */
  function planBase(P) {
    let s = '';

    /* 敷地の草 → 建物の影 → 床 */
    s += '<rect class="pl-site" x="-34" y="-34" width="' + (P.w + 68) +
         '" height="' + (P.h + 68) + '" fill="url(#re-grass)"/>';
    s += '<rect class="pl-shadow" x="5" y="7" width="' + P.w +
         '" height="' + P.h + '"/>';
    s += '<rect class="pl-floor" x="0" y="0" width="' + P.w +
         '" height="' + P.h + '"/>';

    /* 玄関の土間 */
    const g = P.rooms.genkan;
    s += '<rect class="pl-doma" x="' + g.x + '" y="' + g.y +
         '" width="' + g.w + '" height="' + g.h + '"/>';

    /* 壁 */
    s += '<g class="pl-walls">';
    P.walls.forEach(w => {
      s += '<rect class="pl-w' + (w[4] ? ' pl-w-out' : '') + '" x="' + w[0] +
           '" y="' + w[1] + '" width="' + w[2] + '" height="' + w[3] + '"/>';
    });
    s += '</g>';

    /* 建具：ドアの弧 */
    s += '<g class="pl-doors">';
    P.doors.forEach(d => {
      const [x, y, r, dir] = d;
      /* dir 0=右へ開く(水平の壁面から下), 2=上へ */
      if (dir === 2) {
        s += '<path d="M' + x + ' ' + y + ' V' + (y - r) + '"/>' +
             '<path class="pl-swing" d="M' + x + ' ' + (y - r) +
             ' A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y + '"/>';
      } else {
        s += '<path d="M' + x + ' ' + y + ' H' + (x + r) + '"/>' +
             '<path class="pl-swing" d="M' + (x + r) + ' ' + y +
             ' A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (y + r) + '"/>';
      }
    });
    /* 玄関ドア */
    const [ex, ey, er] = P.entry;
    s += '<path class="pl-entry" d="M' + ex + ' ' + ey + ' V' + (ey + er) + '"/>' +
         '<path class="pl-entry pl-swing" d="M' + ex + ' ' + (ey + er) +
         ' A' + er + ' ' + er + ' 0 0 0 ' + (ex + er) + ' ' + ey + '"/>';
    s += '</g>';

    /* 窓：壁厚の中の三本線 */
    s += '<g class="pl-wins">';
    P.wins.forEach(w => {
      const [x, y, len] = w;
      const t = PLAN.tOut;
      s += '<rect class="pl-win" x="' + x + '" y="' + y +
           '" width="' + len + '" height="' + t + '"/>' +
           '<line class="pl-win-l" x1="' + x + '" y1="' + (y + t / 2) +
           '" x2="' + (x + len) + '" y2="' + (y + t / 2) + '"/>';
    });
    s += '</g>';

    /* 方位（北）。間取り図の約束。建物の右下の外に置く。 */
    s += '<g class="pl-north" transform="translate(' + (P.w - 62) + ',' +
         (P.h - 58) + ')">' +
         '<circle r="25"/><path class="pl-n-arrow" d="M0 -18 L7 8 L0 2 L-7 8 Z"/>' +
         '<text y="-25" text-anchor="middle">N</text></g>';

    return s;
  }

  /* 部屋の中へ HTML を載せる。foreignObject を使うので、部屋の中は
     ふつうの HTML/CSS（＝造形は SVG、配置は CSS の線を保てる）。 */
  function roomBox(P, key, inner) {
    const r = P.rooms[key];
    const pad = 14;
    return '<foreignObject x="' + (r.x + pad) + '" y="' + (r.y + pad) +
      '" width="' + (r.w - pad * 2) + '" height="' + (r.h - pad * 2) + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" class="rm rm-' + key + '">' +
      inner + '</div></foreignObject>';
  }

  /* 部屋の見出し（製図の部屋名の位置に、アイコン＋名前） */
  function roomHead(icon, title, extra) {
    return '<div class="rm-h"><span class="rm-ic">' + (ICONS[icon] || '') +
      '</span><h4>' + esc(title) + '</h4>' + (extra || '') + '</div>';
  }

  /* 状態バッジ。§11 の語彙をそのまま出す。 */
  function badge(st) {
    const v = ST[st]; if (!v) return '';
    return '<span class="bdg t-' + v.tone + '" title="' + esc(v.about) + '">' +
      '<i>' + v.sym + '</i>' + esc(v.label) + '</span>';
  }

  /* 「本人しか知らない」の印。§13-1 の基準を画面に出す。 */
  function reachMark(reach) {
    if (reach !== 'onlyself') return '';
    return '<span class="only" title="' + esc(REACH.onlyself.about) +
      '">本人しか知らない</span>';
  }

  /* 値の行。未入力は空欄にせず「未確認」と書く（§11）。 */
  function kv(label, val, st) {
    const empty = !val;
    return '<div class="kv' + (empty ? ' kv-empty' : '') + '">' +
      '<span class="kv-k">' + esc(label) + '</span>' +
      '<span class="kv-v">' + (empty ? '未確認' : esc(val)) + '</span>' +
      (st ? badge(st) : '') + '</div>';
  }

  /* ── 各部屋の中身 ───────────────────────────────── */

  function roomRights(p) {
    const row = (t, r) =>
      '<div class="rt-row">' +
        '<div class="rt-t">' + esc(t) + '</div>' +
        '<div class="rt-b">' +
          '<div class="rt-owner">' + esc(r.owner || '未確認') + '</div>' +
          (r.shares ? '<div class="rt-sh">' + esc(r.shares) + '</div>' : '') +
          (r.memo ? '<p class="rt-memo">' + esc(r.memo) + '</p>' : '') +
        '</div>' +
        '<div class="rt-s">' + badge(r.st) + reachMark(r.reach) + '</div>' +
      '</div>';
    return roomHead('right', '権利関係') +
      '<div class="rt">' + row('土地', p.rights.land) + row('建物', p.rights.bldg) + '</div>';
  }

  function roomLoan(p) {
    const l = p.loan;
    if (!l.has) {
      return roomHead('loan', 'ローン・担保') +
        '<div class="ln-none">' + badge(l.st) +
        '<p>' + esc(l.memo || 'この物件にローン・担保はありません。') + '</p></div>';
    }
    return roomHead('loan', 'ローン・担保') +
      '<div class="ln">' +
        kv('金融機関', l.bank) + kv('借入の種類', l.type) +
        kv('債務者・借入形態', l.debtor) + kv('団信', l.gtee) +
        kv('抵当権・担保設定', l.mortgage) + kv('他の借入への担保利用', l.cross) +
      '</div>' +
      '<div class="ln-f">' + badge(l.st) + reachMark(l.reach) +
      (l.memo ? '<p class="ln-memo">' + esc(l.memo) + '</p>' : '') + '</div>';
  }

  function roomParties(p) {
    const list = p.parties || [];
    const rows = list.length ? list.map(x => {
      const f = FLOWS[x.flow] || FLOWS.none;
      return '<li class="pt">' +
        '<span class="pt-ic">' + ICONS.party + '</span>' +
        '<div class="pt-n"><b>' + esc(x.name) + '</b>' +
          '<span class="pt-r">' + esc(x.role) + '</span></div>' +
        '<span class="flow t-' + f.tone + '">' + esc(f.label) + '</span>' +
        '<div class="pt-w">' + esc(x.what || '—') + '</div>' +
        (x.tel ? '<a class="pt-tel" href="tel:' + esc(x.tel) + '">' +
          ICONS.tel + esc(x.tel) + '</a>' : '<span class="pt-tel pt-none">連絡先は未確認</span>') +
        badge(x.st) + '</li>';
    }).join('') : '<li class="pt-empty">まだ登録がありません。' +
      '管理会社・借主・共有者など、この物件で続いている関係を入れます。</li>';
    return roomHead('party', 'この物件に関わる相手',
        '<button class="rm-add" data-add="party" data-p="' + p.id + '">＋ 追加</button>') +
      '<ul class="pts">' + rows + '</ul>';
  }

  function roomMatters(p) {
    const has = {};
    (p.matters || []).forEach(m => { has[m.type] = m; });
    /* MATTERS の全型を出す。記録が無い型も「未確認」として並べる
       ――載っていない＝該当なし、にしないため（§11）。 */
    const rows = Object.keys(MATTERS).map(k => {
      const def = MATTERS[k];
      const m = has[k] || { type: k, st: 'todo', reach: 'onlyself', memo: '' };
      return '<li class="mt mt-' + m.st + '" data-m="' + k + '" data-p="' + p.id + '">' +
        '<div class="mt-h"><b>' + esc(def.label) + '</b>' + badge(m.st) + '</div>' +
        (m.memo
          ? '<p class="mt-memo">' + esc(m.memo) + '</p>'
          : '<p class="mt-ask">' + esc(def.ask) + '</p>') +
        (m.st !== 'none' && m.reach === 'onlyself' && !m.memo
          ? '<span class="only only-s">本人しか知らない</span>' : '') +
        '</li>';
    }).join('');
    return roomHead('matter', '後から分かりにくい事情') +
      '<p class="mt-lead">登記にも書類にも出てこない、本人しか知らないこと。' +
      'ここが、この領域でいちばん失われやすい情報です。</p>' +
      '<ul class="mts">' + rows + '</ul>';
  }

  function roomAccess(p) {
    const a = p.access;
    return roomHead('key', '家族が入る方法') +
      '<div class="ac">' +
        kv('入れる人', a.who) + kv('鍵・予備鍵', a.key) +
        kv('鍵の種類', a.keyKind) + kv('暗証番号等', a.code) +
        kv('必要な連絡・手順', a.how) +
      '</div>' +
      '<div class="ac-f">' + badge(a.st) + reachMark(a.reach) + '</div>';
  }

  function roomDocs(p) {
    const d = p.docs;
    const items = (d.items || []).length ? d.items.map(x =>
      '<li class="dc' + (x.where ? '' : ' dc-miss') + '">' +
        '<span class="dc-n">' + esc(x.name) + '</span>' +
        '<span class="dc-w">' + (x.where ? ICONS.pin + esc(x.where) : '所在が未確認') + '</span>' +
        badge(x.st) + '</li>').join('')
      : '<li class="dc-empty">まだ登録がありません。</li>';
    return roomHead('doc', '関係書類') +
      (d.place ? '<div class="dc-place">' + ICONS.pin +
        '<span>おもな保管場所<b>' + esc(d.place) + '</b></span></div>' : '') +
      '<ul class="dcs">' + items + '</ul>' +
      '<a class="dc-link" href="../preparing.html?area=documents">' +
        '書類・資料でこの原本を扱う' + ICONS.arrow + '</a>';
  }

  /* 玄関に基本情報（表札）。家の入口に、その家が何かを置く。 */
  function roomGenkan(p) {
    const k = KINDS[p.kind] || KINDS.other;
    const u = USES[p.use] || USES.self;
    return '<div class="gk">' +
      '<div class="gk-plate"><b>' + esc(p.name) + '</b>' +
      '<span class="gk-use t-' + u.tone + '">' + esc(u.label) + '</span></div>' +
      '<div class="gk-sub">' + esc(k.label) +
      (p.built ? '｜' + esc(p.built) + '築' : '') + '</div>' +
      '</div>';
  }

  /* ── 物件1件の間取り ─────────────────────────────── */

  function planOf(p, measured) {
    const P = layout(p, measured);
    const body = planBase(P) +
      roomBox(P, 'rights',  roomRights(p)) +
      roomBox(P, 'loan',    roomLoan(p)) +
      roomBox(P, 'parties', roomParties(p)) +
      roomBox(P, 'matters', roomMatters(p)) +
      roomBox(P, 'access',  roomAccess(p)) +
      roomBox(P, 'docs',    roomDocs(p)) +
      roomBox(P, 'genkan',  roomGenkan(p));

    return '<svg class="plan" viewBox="-34 -34 ' + (P.w + 68) + ' ' + (P.h + 68) +
      '" role="img" aria-label="' + esc(p.name) + 'の間取り図">' +
      '<defs>' +
        '<pattern id="re-hatch" width="6" height="6" patternTransform="rotate(45)" ' +
          'patternUnits="userSpaceOnUse">' +
          '<line x1="0" y1="0" x2="0" y2="6" class="pl-hatch"/></pattern>' +
        '<pattern id="re-grass" width="15" height="15" patternUnits="userSpaceOnUse">' +
          '<circle cx="4" cy="4" r="1.5" class="pl-g1"/>' +
          '<circle cx="11" cy="11" r="1.2" class="pl-g2"/></pattern>' +
      '</defs>' + body + '</svg>';
  }

  /* 狭い画面用。間取りを畳んで、部屋を縦に積む。
     中身は同じ関数から作るので、広い画面と文言がずれない。 */
  function stackOf(p) {
    const box = (key, inner) =>
      '<div class="rm rm-' + key + '">' + inner + '</div>';
    return '<div class="stack">' +
      box('genkan',  roomGenkan(p)) +
      box('matters', roomMatters(p)) +
      box('rights',  roomRights(p)) +
      box('loan',    roomLoan(p)) +
      box('parties', roomParties(p)) +
      box('access',  roomAccess(p)) +
      box('docs',    roomDocs(p)) +
      '</div>';
  }

  /* 物件の見出し（間取りの上）。所在地と進捗。 */
  function propHead(p) {
    const g = S.gauge(p);
    const k = KINDS[p.kind] || KINDS.other;
    const u = USES[p.use] || USES.self;
    const risk = g.risk.length
      ? '<div class="pg-risk">' + ICONS.matter +
        '<span><b>本人に聞けるうちに確認したいこと</b>' +
        esc(g.risk.slice(0, 4).join('・')) +
        (g.risk.length > 4 ? ' ほか' + (g.risk.length - 4) + '件' : '') +
        '</span></div>'
      : '';
    return '<div class="ph" id="p-' + p.id + '">' +
      '<div class="ph-t"><span class="ph-ic">' + (ICONS[k.icon] || ICONS.house) +
        '</span><h3>' + esc(p.name) + '</h3>' +
        '<span class="ph-use t-' + u.tone + '">' + esc(u.label) + '</span></div>' +
      '<div class="ph-addr">' + ICONS.pin + esc(p.addr) + '</div>' +
      /* 進捗は％を主役にしない（§12）。成立していない事実を先に出す */
      risk +
      '<div class="pg"><div class="pg-bar"><i style="width:' + g.pct + '%"></i></div>' +
        '<span class="pg-n">受け渡せている事実 ' + g.pct + '%</span></div>' +
      '</div>';
  }

  /* ── 一覧（上段）───────────────────────────────── */

  function shelf() {
    const list = S.all();
    return list.map(p => {
      const g = S.gauge(p);
      const k = KINDS[p.kind] || KINDS.other;
      const u = USES[p.use] || USES.self;
      return '<button class="card" data-go="p-' + p.id + '">' +
        '<span class="card-ic">' + (ICONS[k.icon] || ICONS.house) + '</span>' +
        '<b>' + esc(p.name) + '</b>' +
        '<span class="card-a">' + esc(p.addr) + '</span>' +
        '<span class="card-f"><span class="t-' + u.tone + '">' + esc(u.label) + '</span>' +
        (g.risk.length ? '<span class="card-r">要確認 ' + g.risk.length + '</span>' : '') +
        '</span></button>';
    }).join('');
  }

  /* ── 描画 ───────────────────────────────────────── */

  /* 部屋の中身は HTML なので、必要な高さは描いてみないと分からない。
     見積りで壁を置くと、行が1つ増えただけで中身が壁を越える。
     そこで **一度描いて実測し、その寸法でもう一度描く**。
     （見積りの数字をスクショ見ながら1つずつ詰める作業に入らない
       ためでもある ―― CLAUDE.md の人体ループ対策と同じ考え方。） */
  function measure(sec) {
    const svg = sec.querySelector('svg.plan');
    if (!svg) return null;
    const box = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !box.width) return null;
    /* px → SVG単位 */
    const unit = box.width / rect.width;
    const out = {};
    sec.querySelectorAll('foreignObject > .rm').forEach(el => {
      const key = (el.className.baseVal || el.getAttribute('class') || '')
        .split(/\s+/).filter(c => c.indexOf('rm-') === 0)[0];
      if (!key) return;
      out[key.slice(3)] = el.scrollHeight * unit;
    });
    return out;
  }

  function draw() {
    const list = S.all();
    document.getElementById('shelf').innerHTML = shelf();
    document.getElementById('cntShelf').textContent = list.length + '件';
    const host = document.getElementById('plans');

    /* 1回目：見積りで描く */
    host.innerHTML = list.map(p =>
      '<section class="prop" data-p="' + p.id + '">' +
      propHead(p) + planOf(p) + stackOf(p) + '</section>').join('');

    /* 2回目：実測した高さで描き直す */
    requestAnimationFrame(() => {
      list.forEach(p => {
        const sec = host.querySelector('[data-p="' + p.id + '"]');
        if (!sec) return;
        const m = measure(sec);
        if (!m) return;
        const svg = sec.querySelector('svg.plan');
        svg.outerHTML = planOf(p, m);
      });
      wire();
    });
    wire();
  }

  function wire() {
    document.querySelectorAll('[data-go]').forEach(b => {
      b.onclick = () => {
        const el = document.getElementById(b.dataset.go);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
  }

  draw();
})();
