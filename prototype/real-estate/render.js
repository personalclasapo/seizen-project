/* SeiZen プロトタイプ｜不動産・住まいを描く
   ------------------------------------------------------------------
   state.js の事実を間取り図の上に描き、編集を書き戻す。

   ■ 造形の骨格

   上段  所有する物件の一覧（物件の数だけ並ぶ小さな平面図）
   下段  物件ごとの間取り図。6部屋＋玄関が入る
           今のうち｜そのとき（上段・主役）
           書類｜権利関係｜ローン・契約｜事情（下段）

   間取り図は SVG で描く（CLAUDE.md）。div＋border では家に見えない。
   寸法は実寸比から引き、1 SVG 単位 ＝ 10mm とする。

     外壁 150mm＝15　内壁 100mm＝10

   壁は「二重線＋45°ハッチ」。これが製図の約束で、単色の帯にすると
   間取り図に見えない。開口は壁を切って表す。

   部屋は固定寸法を持たない。**部屋定義（x1,y1,x2,y2）を先に決め、
   共有辺（sharedEdge）から壁と開口を生成する**
   （`_検討/間取り検討.html` 由来。詳細は memory「間取りSVGの作り方」）。
   輪郭は矩形の枠ではなく線分単位で描く（接合部に継ぎ目を作らない）。

   部屋の深さは中身の実測（measure）から決まる。1回目は見積りで
   描き、2回目に実測した高さで描き直す（v16〜v21 の教訓：見積りの
   数字をスクショ見ながら1つずつ詰める作業に入らないため）。

   ■ 2026-09-20｜`_検討/不動産v28.html` から移植

   「今のうち」「そのとき」（項目設計 §0 の主役）と、部屋生成の
   仕組み（部屋定義→共有辺）を本番へ入れた。中身・文言・造形の
   ロジック（nowRows/goneRows/GLYPH/sheet/nodeSVG）は v28 の
   そのままの移植で、変えたのは実際の物件データ（複数件・localStorage
   保存）に載せるための結線だけ。

   v28 にあった「家族が入る方法」部屋は、まだ本番へ移していない
   （`_次セッション指示-今のうちそのとき.md` に記載なし、意図的な
   削除か検討時の省略か不明。そのまま6部屋＋玄関で移す方針とした）。 */
(function () {
  'use strict';
  /* 画面の文で対象の家族を呼ぶ続柄（既定「父」）。「本人」とは書かない
     ―― 操作するのは基本的に家族で、読み手が迷う（2026-09-24）。 */
  const WHO = (window.SeiZen && window.SeiZen.person && window.SeiZen.person.rel) || '父';
  const SPOUSE = (window.SeiZen && window.SeiZen.person && window.SeiZen.person.spouse) || '母';

  const S = window.SeiZenRealEstate;
  // 表示中だけ保持する開閉状態。物件の記録には書き込まない。
  const openProcedures = new Set();
  const openPrior = new Set();   // 前の代の相続登記の「くわしく」（物件 id）
  const { ST, NOW_STATUS, MATCH, KINDS, USES, DEALS } = S;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const tone = st => st === 'done' ? 'gr' : (st === 'none' ? 'gy' : 'or');

  const NS = 'http://www.w3.org/2000/svg';

  /* ── グリフ ──────────────────────────────────────
     各領域と同じ手つき。専用の viewBox を持つ線グリフを1本ずつ。 */
  const ic = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';

  const ICONS = {
    house: ic('<path d="M3.5 11.5 12 4.2l8.5 7.3"/><path d="M5.8 10.8V19a1 1 0 0 0 1 1h10.4a1 1 0 0 0 1-1v-8.2"/><path d="M9.8 20v-5.4a1 1 0 0 1 1-1h2.4a1 1 0 0 1 1 1V20"/>'),
    condo: ic('<rect x="5" y="3.5" width="14" height="17" rx="1"/><path d="M8.5 7h2M13.5 7h2M8.5 11h2M13.5 11h2M8.5 15h2M13.5 15h2"/><path d="M10.5 20.5v-2.2h3v2.2"/>'),
    land:  ic('<path d="M3 17.5 12 13l9 4.5-9 4.5Z"/><path d="M12 13V6.5"/><path d="M12 6.5 17 4v3.4L12 9.9Z"/>'),
    other: ic('<path d="M4 20V9.5l8-5.5 8 5.5V20"/><path d="M4 20h16"/><path d="M9.5 20v-4.5h5V20"/>'),
    pin:   ic('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>'),
    matter: ic('<path d="M12 3.6 21 19.4H3Z"/><path d="M12 9.6v4.2M12 16.6h.01"/>'),
    /* 下段の部屋見出し。書類＝角を折った1枚、権利＝印のある証書、
       ローン・契約＝円貨。以前は roomHead が参照する名前がここに
       無く、見出しのアイコンが空の枠になっていた。 */
    doc:   ic('<path d="M6.5 3.5H14l4 4v12.4a.6.6 0 0 1-.6.6H6.5a.6.6 0 0 1-.6-.6V4.1a.6.6 0 0 1 .6-.6Z"/><path d="M14 3.5V8h4"/><path d="M9 12h6M9 15.5h6"/>'),
    right: ic('<path d="M5.5 3.5h13v17h-13Z"/><path d="M8.5 7.5h7M8.5 10.5h7M8.5 13.5h3.5"/><circle cx="15" cy="16.2" r="2"/>'),
    loan:  ic('<circle cx="12" cy="12" r="8.5"/><path d="M8.8 7.4 12 12l3.2-4.6M12 12v5.2M9.2 12.6h5.6M9.2 15h5.6"/>')
  };
  const PEN = '<svg class="re-pen" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 13l.6-2.9L10.8 2.9a1.2 1.2 0 0 1 1.7 0l.6.6a1.2 1.2 0 0 1 0 1.7L5.9 12.4Z"/>' +
    '<path d="M9.6 4.1l2.3 2.3M3 13h10"/></svg>';

  /* ══════════════════════════════════════════════════════════
     ■ 今のうち／そのとき｜v28 からの移植（項目・文言・ロジック）
     ══════════════════════════════════════════════════════════ */

  const MATTER_QUESTIONS = {
    boundary: '隣家と境界や塀について、話したこと・決めたことはありますか？',
    road: '通り道や配管について、誰と、どのような取り決めをしていますか？',
    changed: '増築や取り壊しなどをしたのは、いつ、どこに頼んだ工事ですか？'
  };
  /* ── 記録の単位に共通する2つの部品 ─────────────────
     部屋ごとに中身の形は変えるが、**入口と状態の位置だけは揃える**：
       ・状態バッジ … 単位の名前の直下（§11 の状態。値はバッジにしない）
       ・編集ボタン … 単位の頭の右端。枠線の小さなボタンで、色は常に同じ。
         急ぎかどうかはボタンではなくバッジが言う（以前は全カードに
         橙の大きなボタンが付き、面・状態・操作の3つを橙が兼ねていた）。
     カード全体を押せる形にはしない ―― 押せると見て分からず、
     本文を読んでいるだけで誤って開く。                              */
  const BADGE = Object.assign({ doing: { label: '確認中', tone: 'bl' } }, NOW_STATUS);
  function badge(st, own) {
    const b = own || BADGE[st] || BADGE.unknown;
    return '<span class="bdg ' + b.tone + '">' + esc(b.label) + '</span>';
  }
  /* ラベルはこのページの動詞「記録」の1語（見出し「確認と記録」・
     保存「記録を保存」と揃える）。未確認かどうかはバッジが言うので、
     ラベルを状態で出し分けない。枠線は付けず控えめに ―― 項目の数だけ
     並ぶので、主張させると入口が画面の主役になる。何の記録かは
     aria-label で読み上げに渡す。                                   */
  function editButton(p, type, key, what) {
    return '<button type="button" class="record-edit" data-edit-p="' + esc(p.id) +
      '" data-edit-type="' + esc(type) + '" data-edit-key="' + esc(key) +
      '" aria-label="' + esc(what + 'を記録') + '">' + PEN + '<span>記録</span></button>';
  }
  /* 今のうちの状態は選べる。バッジそのものが入口で、押すとポップアップが
     開き、頭の状態欄で選び直して詳細と一緒に保存する。そのため、
     この行には「記録」ボタンを置かない（同じポップアップへの入口が
     2つになる）。<select> にしないのは、今と同じ状態を選んでも change
     が起きず、状態を変えずに詳細だけ直す入口がなくなるから。     */
  const CARET = '<svg class="caret" viewBox="0 0 12 8" aria-hidden="true"><path d="m2 2 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function statusPick(p, type, key, st, what, label) {
    const cur = Object.assign({}, NOW_STATUS[st] || NOW_STATUS.unknown, label ? { label } : {});
    return '<button type="button" class="bdg status-pick ' + cur.tone + '" data-edit-p="' + esc(p.id) +
      '" data-edit-type="' + esc(type) + '" data-edit-key="' + esc(key) +
      '" aria-haspopup="dialog" aria-label="' + esc(what + '：' + cur.label + '。状態を変える・記録する') + '">' +
      esc(cur.label) + CARET + '</button>';
  }
  /* 追加は、既存を直すボタンと形を分ける。一覧の最後の「空いている枠」。 */
  function addButton(p, type, label) {
    return '<button type="button" class="record-add" data-edit-p="' + esc(p.id) +
      '" data-edit-type="' + esc(type) + '" data-edit-key="new"><span aria-hidden="true">＋</span>' +
      esc(label) + '</button>';
  }
  /* 単位の頭。左に名前（種別の小見出しがあれば名前の上）、右端に
     状態バッジと入口を寄せる。 */
  function unitHead(name, st, button, kicker) {
    return '<div class="uh"><div class="uh-t">' +
      (kicker ? '<span class="uh-k">' + esc(kicker) + '</span>' : '') +
      '<span class="uh-nm">' + esc(name) + '</span></div>' +
      '<div class="uh-r">' + st + button + '</div></div>';
  }

  /* 今のうち＝事情（境界・私道・建物の変更）だけ。
     権利・ローン・契約の確認は、以前ここにも行として出していたが、
     下段の部屋（権利関係・ローン・契約）に同じ事実と入口があり、
     二重表示になっていた。下段が持つ（2026-09-23）。

     状態は保存された値（uiStatus）。フォームの答えから推し量らない。
     「次にすること」は状態ごと・項目ごとに変える ―― 未確認なら本人に
     聞く問い、対応が必要なら項目ごとの対応（以前の版の actions を
     移した）。本人が書いた m.next があればそれを優先する。          */
  const ACTION_NEXT = {
    boundary: '当時の取り決めを双方で確認し、必要なら書面や図面に残しておく。代替わりすると、当時の合意内容を確認できなくなる。',
    road: '現在の当事者同士で内容を確認し、必要なら書面に残しておく。',
    changed: '工事時期・施工者・図面・確認申請書類などを確認し、増築部分を登記に反映するための資料をそろえる。'
  };
  /* ■ 前の代の相続登記（2026-09-24 作り直し）
     答え（名義が残っているか・どれが・名義人・名義人は父から見て誰か・
     名義を移す道・進み具合・取得する人・亡くなった時期）だけを持ち、
     ここで文にする。道・当事者・段階の意味は state.js の priorParty /
     priorRoute の注記を参照。

     行の組み方（`_検討/前の代の相続登記_表示v7.html`）：
       控え … 一文（なぜ必要か＋なぜ今のうちか）
       従   … 名義の図（前の代 → 移す先）と段階
       主   … 次にすること＋期限の札
       くわしく … カードの最下行。期限と過料／話し合いがまとまらない
                   うちの手。当事者に義務がない段では出さない
     文は短く保つ。段ごとに言うことを1つに絞り、同じことを2か所で
     言わない（一文・次にすること・くわしく）。                     */
  const priorTaker = pr => pr.taker === 'other' ? (pr.takerName || 'ほかの相続人') : (S.priorParty(pr) || '相続人');
  const priorParcels = (p, pr) => (pr.parcels || []).map(k => k === 'land' ? '土地' : p.kind === 'condo' ? '専有部分' : '建物').join('・');

  const PRIOR_DUE = new Date(2027, 2, 31, 23, 59, 59);
  const priorOver = now => now > PRIOR_DUE;
  function priorLeft(now) {
    const d = Math.ceil((PRIOR_DUE - now) / 86400000);
    return d > 45 ? 'あと約' + Math.round(d / 30.44) + 'か月' : 'あと' + d + '日';
  }

  /* 段の読み取り。行の部品はすべてここから決める。 */
  function priorCase(p) {
    const pr = p.priorInheritance || {};
    const route = S.priorRoute(pr);
    const P = S.priorParty(pr);             // 協議の当事者（父・母、特定できなければ空）
    const mine = pr.taker !== 'other';      // 取得するのは当事者か
    const st = route === 'unknown' ? 'none' : (pr.stage === 'ready' ? 'signed' : pr.stage || 'none');
    /* 当事者に相続登記の義務があるか。遺産分割で取得しなかった相続人は
       義務を負わない（分割は相続の時にさかのぼって効く）。 */
    const duty = st !== 'registered' && (route === 'unknown' || route === 'sole' ||
      (route === 'split' && (['none', 'agreed'].includes(st) || mine)) || (route === 'will' && mine));
    /* 話し合いがまとまらないうちの手（相続人申告登記・法定相続分の登記）
       が使えるのは、遺産分割の前だけ。分割後は分割の結果で登記する。 */
    const before = route === 'unknown' || (route === 'split' && ['none', 'agreed'].includes(st));
    return { pr, route, P, mine, st, duty, before, t: priorTaker(pr), where: priorParcels(p, pr) || '土地・建物' };
  }

  const PR_NEED = '相続登記は法律上の<b>義務</b>です。名義が亡くなった人のままでは、<b>売ることも、担保に入れることもできません</b>。';
  /* 今のうちの理由。1段に1つ。当事者を特定できない（その他）ときは言わない。 */
  function priorNow(c) {
    const P = c.P;
    if (c.route === 'unknown') return '遺言があるか、相続人が何人かで、名義の移し方が変わります。';
    if (!P) return '';
    const apply = '申請は' + P + 'の名前で行います。' + P + 'が判断できなくなると、後見人を立てるまで申請できません。';
    if (c.route === 'sole' || c.route === 'will') return apply;
    if (c.st === 'none') return '遺産分割の話し合いには' + P + 'が加わります。' + P + 'が先に亡くなると、' + P + 'の相続人全員が代わりに加わります。';
    if (c.st === 'agreed') return '登記には、相続人全員が署名・実印を押した協議書が要ります。' + P + 'が署名する前に亡くなると、' + P + 'の相続人全員が代わりに署名することになります。';
    if (c.st === 'signed' && !c.mine) return '登記には、協議書と一緒に' + P + 'の印鑑証明書が要ります。渡す前に' + P + 'が亡くなると、' + P + 'の相続人全員が代わりに証明書へ実印を押すことになります。';
    return apply;
  }
  /* 済んだ段。当事者の手続きは残っていないが、「そのとき」に家族が
     何をしなくてよいかは、ここで分かるようにする。 */
  function priorDoneWhy(c) {
    const P = c.P, t = esc(c.t);
    if (c.st === 'registered') return c.mine
      ? c.where + 'は' + t + 'の名義になっています。' + (P ? P + 'が亡くなったときは、' + P + 'から家族への相続登記だけで足ります。' : '')
      : c.where + 'は' + t + 'の名義になっています。' + (P ? P + 'の相続財産には入りません。' : '');
    if (c.route === 'will') return '遺言で' + t + 'が取得するので、' + (P ? P + 'の手続きはありません。' + c.where + 'は' + P + 'の相続財産には入りません。' : '相続人が話し合う必要はありません。');
    return (P ? P + 'の手続き（協議書への署名・実印と、印鑑証明書を渡すこと）は済んでいます。' : '') +
      '登記は' + t + 'が申請します。' + (P ? c.where + 'は' + P + 'の相続財産には入りません。' : '');
  }

  const PG = {
    cal: '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x=".7" y="2.4" width="12.6" height="11" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.1"/><line x1=".7" y1="5.8" x2="13.3" y2="5.8" stroke="currentColor" stroke-width="1.1"/><line x1="4.2" y1=".7" x2="4.2" y2="3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9.8" y1=".7" x2="9.8" y2="3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    oral: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 3.2C2 2.5 2.5 2 3.2 2h7.6c.7 0 1.2.5 1.2 1.2v5c0 .7-.5 1.2-1.2 1.2H6.4L3.8 11.8V9.4h-.6C2.5 9.4 2 8.9 2 8.2z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>',
    paper: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.2h6.2L11 3v9.8H3z" fill="#fff" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M4.8 4.4h4.4M4.8 6.4h4.4" stroke="currentColor" stroke-width=".9" stroke-linecap="round" opacity=".6"/><circle cx="8.6" cy="10" r="1.7" fill="none" stroke="#C0574E" stroke-width="1"/></svg>',
    none: '<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2 1.6"/></svg>',
    down: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="m2 3.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    /* 名義の矢印：まだ移っていなければ破線、移ったら実線 */
    arrow: done => '<svg viewBox="0 0 30 12" aria-hidden="true"><path d="M1 6h24" stroke="' + (done ? '#6C9A7A' : '#B5AB95') + '" stroke-width="1.5"' + (done ? '' : ' stroke-dasharray="3 2.5"') + '/><path d="m22 2 5 4-5 4" fill="none" stroke="' + (done ? '#6C9A7A' : '#B5AB95') + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  /* 名義の図の下に出す段階。道ごとに言うことが違う。 */
  function priorStageLine(c) {
    if (c.st === 'registered') return ['', '相続登記まで済んでいる'];
    if (c.route === 'unknown') return [PG.none, '遺言の有無・相続人をまだ確かめていない'];
    if (c.route === 'will') return [PG.paper, '遺言がある。登記はまだ'];
    if (c.route === 'sole') return [PG.none, '相続人は' + esc(c.t) + 'だけ。登記はまだ'];
    return {
      none: [PG.none, '誰が取得するか、まだ話がついていない'],
      agreed: [PG.oral, '取得する人は口頭で決まっている。協議書はまだない'],
      signed: [PG.paper, c.mine ? '遺産分割協議書ができている。登記はまだ'
        : c.pr.seal === 'given' ? '協議書ができ、' + (c.P || '') + 'の印鑑証明書も渡してある。登記はまだ'
        : '協議書ができている。' + (c.P || '') + 'の印鑑証明書はまだ渡していない']
    }[c.st] || [PG.none, ''];
  }

  /* 従：名義の図。前の代 → 移す先。 */
  function priorNames(p, c) {
    const done = c.st === 'registered';
    /* 左は前の代の名義人。権利関係の名義と連動していて、登記まで済むと
       権利関係のほうは取得した人の名義に替わる。 */
    const owner = S.priorOwner(p);
    const decided = c.route === 'sole' || c.route === 'will' || (c.route === 'split' && c.st !== 'none');
    const to = decided || done ? c.t : '未定';
    const line = priorStageLine(c);
    return '<div class="pr-nm"><div class="pr-nb pr-now"><small>' + esc(c.where + (done ? 'の前の名義' : 'の名義（今）')) +
      '</small><span>' + esc(owner || '前の代') + '</span></div>' +
      '<div class="pr-ar">' + PG.arrow(done) + '</div>' +
      '<div class="pr-nb pr-to' + (done ? ' done' : '') + '"><small>' + (done ? '今の名義' : '移す先') + '</small><span>' + esc(to) + '</span></div>' +
      '<p class="pr-st">' + line[0] + line[1] + '</p></div>';
  }
  /* 主：次にすること＋期限の札。札は当事者に義務があるときだけ。 */
  function priorLimit(c, now) {
    if (!c.duty) return '';
    const pr = c.pr;
    if (pr.died === 'before') return priorOver(now)
      ? '<span class="pr-lim">' + PG.cal + '2027年3月31日を過ぎています</span>'
      : '<span class="pr-lim">' + PG.cal + '2027年3月31日まで<em>' + priorLeft(now) + '</em></span>';
    if (pr.died === 'after') return '<span class="pr-lim">' + PG.cal + '知った日から3年以内</span>';
    return '<span class="pr-lim unk">' + PG.cal + '期限は亡くなった時期で決まる</span>';
  }
  function priorNext(c) {
    const P = c.P || '取得する相続人', t = c.t;
    if (c.route === 'unknown') return ['遺言があるか、前の代の相続人が誰かを確かめる',
      '遺言は公証役場と法務局で探せます。相続人は前の代の戸籍で分かります。'];
    if (c.route === 'sole') return [t + 'が相続登記を申請する', '司法書士に依頼できます。'];
    if (c.route === 'will') return [t + 'が遺言書を添えて相続登記を申請する',
      '自筆の遺言書は、先に家庭裁判所の検認が要ります（法務局に預けてあったものを除く）。'];
    if (c.st === 'none') return ['相続人全員で、誰が取得するかを決める', ''];
    if (c.st === 'agreed') return ['遺産分割協議書にして、相続人全員が署名・実印を押す', ''];
    if (c.st === 'signed' && !c.mine) return [P + 'の印鑑証明書を取り、' + t + 'に渡す', t + 'が相続登記の申請に使います。'];
    return ['相続人全員の印鑑証明書をそろえ、' + t + 'が相続登記を申請する',
      '司法書士に依頼できます。遺産分割協議書と印鑑証明書に、登記での有効期限はありません。'];
  }
  function priorAct(c, now) {
    const [text, sub] = priorNext(c);
    return '<div class="pr-act"><div class="pr-act-h"><span>次にすること</span>' + priorLimit(c, now) + '</div>' +
      '<p>' + esc(text) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</p></div>';
  }

  /* くわしく */
  const PR_FINE = '<p>期限を過ぎても、すぐに過料が科されるわけではありません。まず法務局から申請を促す通知（<b>催告</b>）が届き、それにも応じない場合に<b>10万円以下の過料</b>の対象になります。催告に応じて申請すれば、過料の手続きには進みません。</p>';
  const PR_FINE_OVER = '<p>過料は、法務局から申請を促す通知（<b>催告</b>）が届き、それにも応じない場合に<b>10万円以下</b>で科されるものです。催告に応じて申請すれば、過料の手続きには進みません。</p>';
  function priorDeadline(c, now) {
    const pr = c.pr, P = c.P || '相続人';
    const h = t => '<section><h6><i>1</i>' + t + '</h6>';
    if (pr.died === 'before' && priorOver(now)) return h('期限を過ぎたいま') +
      '<p>前の代の分の期限（<b>2027年3月31日</b>）は過ぎましたが、申請の義務はなくなりません。できるだけ早く申請します。</p>' + PR_FINE_OVER + '</section>';
    if (pr.died === 'before') return h('期限と過料') +
      '<p>義務になる前（2024年4月より前）に起きた相続も対象で、その場合の期限は<b>2027年3月31日</b>です。</p>' + PR_FINE + '</section>';
    if (pr.died === 'after') return h('期限と過料') +
      '<p>前の代が2024年4月以後に亡くなっているため、期限は' + P + 'が相続を<b>知った日から3年以内</b>です。</p>' + PR_FINE + '</section>';
    return h('期限と過料') + '<p>期限は、前の代が亡くなった時期で決まります。</p>' +
      '<div class="pr-two"><div><small>2024年4月より前</small><p><b>2027年3月31日</b>' +
        (priorOver(now) ? '（過ぎています）' : 'まで（' + priorLeft(now) + '）') + '</p></div>' +
      '<div><small>2024年4月以後</small><p>相続を<b>知った日から3年以内</b></p></div></div>' +
      '<p>亡くなった日は、前の代の除籍謄本（戸籍）で分かります。</p>' + PR_FINE + '</section>';
  }
  /* 遺産分割の前に義務を果たす手は2つ。どちらも最終の形ではない。 */
  function priorFallback(c, now) {
    return '<section><h6><i>2</i>' + (priorOver(now) ? '話がまとまるまでの間は' : '間に合わないとき') + '</h6>' +
      '<p>遺産分割がまとまらないうちは、次のどちらかで義務を果たせます。</p>' +
      '<div class="pr-two"><div><small>相続人申告登記</small><p>申し出た人の義務が果たされる。登録免許税はかからない<br><span class="ng">名義は移らず、売れない</span></p></div>' +
      '<div><small>法定相続分での相続登記</small><p>相続人の一人が全員分を申請できる。登録免許税がかかる<br><span class="ng">全員の共有になり、売るには全員の同意が要る</span></p></div></div>' +
      '<p>どちらの場合も、遺産分割がまとまったら、その日から3年以内に、分割の結果で相続登記を申請する義務があります。</p></section>';
  }
  function priorDetail(p, c, now) {
    const toc = [priorOver(now) && c.pr.died === 'before' ? '期限を過ぎたいま' : '期限と過料']
      .concat(c.before ? [priorOver(now) ? '話がまとまるまでの間' : '間に合わないとき'] : []).join('・');
    const open = openPrior.has(p.id);
    return '<div class="pr-dt' + (open ? ' open' : '') + '"><button type="button" class="pr-dt-t" data-prior-open="' + esc(p.id) +
      '" aria-expanded="' + open + '"><span class="pr-dt-k">くわしく</span><span class="pr-dt-s">' + toc + '</span>' + PG.down + '</button>' +
      (open ? '<div class="pr-dt-b">' + priorDeadline(c, now) + (c.before ? priorFallback(c, now) : '') + '</div>' : '') + '</div>';
  }
  /* 行の本体（頭の下）。 */
  function priorBody(p) {
    const pr = p.priorInheritance || {};
    const now = new Date();
    if (pr.remains === 'no') return '<p class="pr-quiet">前の代の名義は残っていません。</p>';
    if (pr.remains !== 'yes') return '<p class="pr-why">前の代の名義が残っていると、<b>売ることも、担保に入れることもできず</b>、相続登記の<b>義務</b>もかかります。' +
      '遺産分割には' + WHO + 'が加わることが多いため、' + WHO + 'が元気なうちに確かめておきます。</p>' +
      '<div class="pr-nm one"><div class="pr-nb pr-to"><small>土地・建物の名義</small><span>まだ確かめていない</span></div></div>' +
      '<div class="pr-act"><div class="pr-act-h"><span>次にすること</span></div><p>登記事項証明書で、名義が前の代のままか見る<small>家族でも法務局で取得できます。</small></p></div>';
    const c = priorCase(p);
    if (S.priorStatus(p) === 'done') return '<p class="pr-why">' + priorDoneWhy(c) + '</p>' + priorNames(p, c);
    /* 義務の説明は、当事者に義務がある段だけ（署名済みで取得しない側は、
       残る手続きが印鑑証明書を渡すことだけで、登記の義務は取得する人にある）。 */
    return '<p class="pr-why">' + (c.duty ? PR_NEED : '') + priorNow(c) + '</p>' + priorNames(p, c) + priorAct(c, now) +
      (c.duty ? priorDetail(p, c, now) : '');
  }
  function nowRows(p) {
    const names = { boundary: '境界・越境の取り決め', road: '私道・通行・配管の取り決め', changed: '建物の変更・登記' };
    const out = ['boundary', 'road', 'changed'].filter(key => !(key === 'changed' && p.kind === 'land')).map(key => {
      const m = p.matters[key] || {};
      const status = NOW_STATUS[m.uiStatus] ? m.uiStatus : S.matterProgress(p, key).status;
      return { key, type: 'matter', nm: names[key], status, pick: true,
        summary: m.memo || 'まだ記録がありません。',
        next: m.next || (status === 'unknown' ? MATTER_QUESTIONS[key] : status === 'action' ? ACTION_NEXT[key] : ''),
        assignee: m.assignee, timing: m.timing };
    });

    const pr = p.priorInheritance || {};
    const ps = S.priorStatus(p);
    out.push({ key: 'prior', type: 'prior', icon: 'prior', nm: '前の代の相続登記', status: ps, pick: true,
      label: ps === 'done' ? (pr.stage === 'registered' ? '登記済み'
        : S.priorRoute(pr) === 'will' ? '手続きなし' : (S.priorParty(pr) || '相続人') + 'の分は済み') : '' });

    /* 団信の加入状況は、借入ありで団信が不明のときだけ立つ。事実は下段の
       借入（loan.gteeStatus）にあり、ここは同じ事実から出る今のうちの行動。 */
    const l = p.loan || {};
    if (l.has === true && l.gteeStatus === 'unknown') {
      out.push({ key: 'loan', type: 'loan', icon: 'loan', nm: '住宅ローンの団信加入状況', status: 'unknown',
        summary: (l.bank || '金融機関') + '｜住宅ローンあり。団信加入の有無が確認できていない。',
        next: '契約書類または金融機関で、団信加入の有無と保障内容を確認する。' });
    }
    return out;
  }

  /* 父の相続に、この物件の前の代の名義が入らない理由（そのときの頭に出す）。
     父の分がないときだけ使う。 */
  function priorGone(p, pr) {
    if (pr.remains !== 'yes' || pr.stage === 'registered') return '';
    const c = priorCase(p), where = c.where;
    if (c.P !== WHO) return where + 'は前の代の名義のままです。' + WHO + 'の相続とは別に、前の代の相続人で名義を移します。';
    if (!c.mine && (c.route === 'will' || c.st === 'signed'))
      return where + 'は' + c.t + 'が取得すると決まっているので、' + WHO + 'の相続登記には入りません。' +
        (c.st === 'signed' && c.pr.seal !== 'given' ? WHO + 'の印鑑証明書はまだ渡していないので、家族全員で、協議書が真正に作られた旨の証明書に実印を押すことになります。' : '');
    return '';
  }

  /* ■ そのときの相続登記「この物件では」（2026-09-24 作り直し）
     そのときは、父が亡くなった後に家族が開く面。ここに書くのは、この
     物件で実際にすることと、そのとき気をつけること。「確かめます」の
     ような今のうちの確認は書かない（以前は、前の代の名義が未確認だと
     「残っていないか登記で確かめます」と出していた）。
     記録から言えることだけを項目にする：前の代の名義が残っているか・
     どう移すか、使う書類がどこにあるか、父の持分。                    */
  function inheritHere(p) {
    const out = [];
    const pr = p.priorInheritance || {};
    const docAt = key => { const d = (p.docs.at || {})[key] || {}; return d.st === 'have' && d.place ? d.place : ''; };
    if (pr.remains === 'yes' && pr.stage !== 'registered') {
      const c = priorCase(p);
      if (c.P === WHO && (c.mine || c.route === 'unknown' || (c.route === 'split' && ['none', 'agreed'].includes(c.st)))) {
        /* 名義人は最初の一度だけ「（故人）」まで書き、あとは名前だけにする。 */
        const full = S.priorOwner(p) || '前の代';
        const owner = full.replace(/（故人）$/, '');
        out.push(c.where + 'は' + full + 'の名義のままです。');
        if (c.route === 'split' && c.st === 'signed') {
          out.push(WHO + 'が取得する遺産分割協議書があります。これと相続人全員の印鑑証明書で、' + owner + 'から' + WHO + '、' + WHO + 'から家族へと名義を移します。' +
            WHO + 'が1人で取得すると決まっているので、1回の申請で家族へ移せることがあります（司法書士に確認）。');
          out.push('協議書の場所：' + (docAt('prior') || 'まだ記録されていません（書類のありか）'));
        } else if (c.route === 'will') {
          out.push(owner + 'の遺言で' + WHO + 'が取得すると決まっています。遺言書を使って、' + owner + 'から' + WHO + '、' + WHO + 'から家族へと名義を移します。' +
            '自筆の遺言書は、先に家庭裁判所の検認が要ります（法務局に預けてあったものを除く）。');
          out.push('遺言書の場所：' + (docAt('priorWill') || 'まだ記録されていません（書類のありか）'));
        } else if (c.route === 'sole') {
          out.push(owner + 'の相続人は' + WHO + 'だけなので、話し合いは要りません。' + owner + 'から' + WHO + '、' + WHO + 'から家族へと名義を移します。1回の申請で家族へ移せることがあります（司法書士に確認）。');
        } else {
          out.push('先に' + owner + 'の相続を片付けます。' + (c.route === 'unknown' ? '遺言がなければ、' : '') +
            owner + 'の遺産分割には、' + owner + 'のほかの相続人と、' + WHO + 'の相続人（家族）全員が加わります。2人分の相続を1通の協議書にまとめられます。');
          if (c.st === 'agreed') out.push(WHO + 'が取得すると口頭で決まっていましたが、書面はありません。協議書にするには、相続人全員の署名・実印と印鑑証明書が要ります。');
        }
        out.push('戸籍は、' + WHO + 'の分に加えて、' + owner + 'の出生から死亡までの分も要ります。');
      }
    }
    ['land', 'bldg'].forEach(k => {
      const r = (p.rights || {})[k];
      if (r && r.owner === WHO && r.hold === 'share' && r.shares && r.shares !== '単独')
        out.push((k === 'land' ? '土地' : p.kind === 'condo' ? '専有部分' : '建物') + 'は共有です。相続するのは' + WHO + 'の持分（' + r.shares + '）だけです。');
    });
    return out;
  }

  /* 父が亡くなったとき、この物件に父の分があるか。
     今の登記名義が父のものだけでなく、前の代の名義のままでも父が相続人
     として持つ分がある。以前は登記名義だけで判定していたので、土地も建物も
     前の代の名義だと「父の分はない」になり、そのときの相続登記・現所有者
     の申告が丸ごと消えていた（2026-09-24）。
     前の代の分から外れるのは、当事者が父でない（母の親など）とき、
     遺産分割・遺言で取得する人が父以外に決まったとき（分割は相続の時に
     さかのぼって効くので、父の相続財産に入らない）。                */
  function fatherStake(p) {
    const pr = p.priorInheritance || {};
    return ['land', 'bldg'].some(k => {
      const r = p.rights && p.rights[k];
      if (!r) return false;
      if (r.owner === WHO || (/本人/.test(r.owner || '') && !/故人/.test(r.owner || ''))) return true;
      if (pr.remains !== 'yes' || !(pr.parcels || []).includes(k) || pr.stage === 'registered') return false;
      if (S.priorParty(pr) !== WHO) return false;
      const decidedOther = pr.taker === 'other' && (S.priorRoute(pr) === 'will' || (S.priorRoute(pr) === 'split' && ['signed', 'ready'].includes(pr.stage)));
      return !decidedOther;
    });
  }
  function goneRows(p) {
    const out = [];
    const owns = fatherStake(p);
    const pr = p.priorInheritance || {};
    if (owns) {
      out.push({ icon: 'toki', nm: '相続登記',
        de: '不動産の名義を、相続した人へ変更する。',
        whereLabel: '申請先', where: '物件所在地を管轄する法務局',
        first: inheritHere(p).length && (pr.remains === 'yes' && pr.stage !== 'registered' && S.priorParty(pr) === WHO && pr.taker !== 'other')
          ? '司法書士に、' + (S.priorOwner(p) || '前の代') + 'の名義が残っていることを伝えて相談する。'
          : '司法書士に依頼するか、自分で申請するかを選ぶ。',
        lim: '取得を知った日から3年以内',
        limNote: '相続によって、この不動産を取得したことを知った日が起点。',
        only: inheritHere(p),
        steps: ['遺言があるかを確かめる。公正証書の遺言は公証役場で、法務局に預けた自筆の遺言は法務局で調べられる。',
          WHO + 'の出生から死亡までの戸籍と、相続人全員の戸籍を集める。' + WHO + 'や祖父母の戸籍は、最寄りの市区町村の窓口でまとめて請求できる（広域交付。請求する人が窓口へ行く。きょうだいの戸籍は対象外）。',
          '遺言がなければ、相続人全員で遺産分割協議をする。協議書に全員が署名・実印を押し、印鑑証明書を添える。',
          '登記事項証明書と固定資産評価証明書を取り、申請書と添付書類をそろえて法務局へ申請する。司法書士にまとめて頼める。'],
        cautions: ['権利証（登記識別情報）が見つからなくても、相続登記はできます。',
          '登録免許税は固定資産税評価額の0.4%です。評価額は固定資産評価証明書か、毎年届く課税明細書で分かります。',
          '3年以内に遺産分割がまとまらなければ、相続人申告登記で義務だけ先に果たせます。名義は移らず、売ることはできません。'],
        note: '申請書の書き方は、法務局の登記手続案内（予約制）で相談できます。',
        link: 'https://www.moj.go.jp/MINJI/minji05_00599.html', linkLabel: '法務省｜相続登記の案内' });
    }
    if (owns && p.ownerReport && p.ownerReport.state !== 'hidden') {
      const yokohama = /横浜市/.test(p.addr || '');
      const nagaoka = /長岡市/.test(p.addr || '');
      out.push({ icon: 'todoke', nm: '現所有者の申告', eyebrow: '固定資産税',
        de: '相続登記が申告期限に間に合わない場合、相続人などの現所有者を届け出る。',
        whereLabel: '連絡先', where: yokohama && /青葉区/.test(p.addr || '')
          ? '青葉区役所 税務課' : nagaoka ? '長岡市 資産税課' : '物件所在地の自治体・固定資産税担当',
        first: '所有者の死亡と登記の状況を伝え、申告が必要か確認する。',
        lim: yokohama ? '現所有者と知った日から3か月以内' : '自治体に申告期限を確認',
        steps: ['固定資産税担当へ連絡し、申告の要否・期限・必要な添付書類を確認する。',
          '必要な場合は、自治体の現所有者申告書を記入し、添付書類とともに指定の方法で提出する。'],
        note: 'この申告だけでは登記上の名義は変わりません。未登記の家屋がある場合は、所有者変更の届出も窓口へ確認します。',
        link: yokohama ? 'https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/zeikin/y-shizei/koteishisan-toshikeikakuzei/kotei-gensyoyu.html'
          : nagaoka ? 'https://www.city.nagaoka.niigata.jp/kurashi/cate02/kotei/kotei.html' : '',
        linkLabel: yokohama ? '横浜市｜現所有者申告の案内' : '長岡市｜固定資産税の案内' });
    }
    if (p.loan && p.loan.has) {
      const insured = p.loan.gteeStatus === 'yes';
      const uninsured = p.loan.gteeStatus === 'no';
      out.push({ icon: 'tsushin', nm: insured ? '住宅ローン・団信' : '住宅ローンの確認',
        de: insured ? '団信の支払対象となれば、保険金がローンの返済に充てられる。'
          : uninsured ? '団信なし。残っている借入と、相続に伴う対応を確認する。'
          : '団信の加入状況が不明。金融機関で加入の有無と保障内容を確認する。',
        whereLabel: '連絡先', where: (p.loan.bank || '借入先の金融機関') + '・住宅ローン窓口',
        first: '契約者が亡くなったことを伝え、手続きの案内を受ける。',
        steps: [insured ? '団信の手続きに必要な書類と、提出方法・期限を金融機関に確認する。'
            : '団信の加入・保障の状況と残債を確認し、相続に伴う手続きを相談する。',
          '案内された書類をそろえ、取扱金融機関へ提出する。',
          insured ? '手続きの結果と、ローンの弁済・完済を確認する。' : '残る債務の扱いと、必要な対応を確認する。'],
        note: '手続き中の返済・引き落としの扱いも確認します。必要書類や保障の範囲は、加入している団信・契約によって異なります。' });
    }
    return out;
  }

  /* ══ 造形｜書面。CLAUDE.md の振り分け1（幾何プリミティブ数個で
     寸法を決めれば済む）に該当。A4 の実寸比 1:1.414 から引く。 */

  function sheet(extra, opt) {
    const o = opt || {};
    const w = o.w || 30, h = (w * 42.4 / 30).toFixed(1);
    return '<svg class="gi" viewBox="0 0 30 42.4" width="' + w + '" height="' + h + '" ' +
      'xmlns="' + NS + '" aria-hidden="true">' +
      (o.stack
        ? '<rect x="5" y="5" width="24" height="36" rx="1" fill="#F2EEE3" ' +
            'stroke="#D8D2C2" stroke-width=".7"/>' +
          '<rect x="3.2" y="3" width="24" height="36" rx="1" fill="#F8F5EC" ' +
            'stroke="#D2CCBA" stroke-width=".7"/>'
        : '') +
      '<rect x="1.4" y="1" width="24" height="36" rx="1" fill="#FFFFFF" ' +
        'stroke="#BDB5A0" stroke-width=".9"/>' +
      extra + '</svg>';
  }
  const rule = (y, x1, x2) => '<line x1="' + x1 + '" y1="' + y + '" x2="' + x2 +
    '" y2="' + y + '" stroke="#DDD7C7" stroke-width=".9" stroke-linecap="round"/>';

  const GLYPH = {
    /* 届出書。役所の窓口に出す1枚。右上に受理印の枠（空＝まだ出していない）。 */
    todoke: o => sheet(
      '<rect x="8.4" y="5.4" width="10" height="2.2" rx=".5" fill="#CFC7B2"/>' +
      '<rect x="19.6" y="4.6" width="4.4" height="4.4" rx=".5" fill="none" ' +
        'stroke="#D8D2C2" stroke-width=".8"/>' +
      rule(13.4, 4.2, 22.6) + rule(17.4, 4.2, 22.6) +
      rule(21.4, 4.2, 22.6) + rule(25.4, 4.2, 15) +
      '<rect x="4.2" y="28.4" width="18.4" height="6" rx=".6" fill="none" ' +
        'stroke="#D8D2C2" stroke-width=".8"/>' +
      rule(31.4, 6, 14), o),

    /* 登記識別情報通知。申請の結果として返ってくる1枚。目隠しシール。 */
    toki: o => sheet(
      '<rect x="4.2" y="5.4" width="13" height="2.4" rx=".5" fill="#BFB49A"/>' +
      rule(11.4, 4.2, 22.6) + rule(15.4, 4.2, 22.6) + rule(19.4, 4.2, 17) +
      '<rect x="4.2" y="23" width="18.4" height="8.4" rx=".6" fill="#E4E0D4" ' +
        'stroke="#C4BCA6" stroke-width=".8"/>' +
      '<path d="M6 31l4-8M11 31l4-8M16 31l4-8" stroke="#C9C1AC" ' +
        'stroke-width=".8" stroke-linecap="round"/>' +
      '<rect x="18" y="30.4" width="5.6" height="5.6" rx=".6" fill="none" ' +
        'stroke="#C0574E" stroke-width="1" opacity=".85"/>' +
      '<path d="M19.4 32.2h2.8M19.4 33.8h2.8M19.4 35.4h2.8" stroke="#C0574E" ' +
        'stroke-width=".7" opacity=".6" stroke-linecap="round"/>', o),

    /* 団信の弁済手続き。金融機関へ出す一式なので綴り。 */
    tsushin: o => sheet(
      '<rect x="4" y="5.4" width="11" height="2.2" rx=".5" fill="#CFC7B2"/>' +
      rule(11.4, 4, 21) + rule(15.4, 4, 21) + rule(19.4, 4, 21) +
      rule(23.4, 4, 14) +
      '<line x1="4" y1="31.4" x2="21" y2="31.4" stroke="#C4BCA6" ' +
        'stroke-width=".9" stroke-linecap="round"/>' +
      '<path d="M6 30.4c1.4-2 2.4 1 3.8-.8 1-1.2 1.8 1.4 3 .2" fill="none" ' +
        'stroke="#A79E86" stroke-width=".9" stroke-linecap="round"/>',
      Object.assign({ stack: true }, o)),

    /* 契約の引き継ぎ。賃貸借契約書。甲・乙の朱印が2つ並ぶ。 */
    keiyaku: o => sheet(
      '<rect x="4.2" y="5.4" width="12" height="2.2" rx=".5" fill="#CFC7B2"/>' +
      rule(11.4, 4.2, 22.6) + rule(15.4, 4.2, 22.6) + rule(19.4, 4.2, 22.6) +
      rule(23.4, 4.2, 18) +
      rule(29.4, 4.2, 15) + rule(34, 4.2, 15) +
      '<circle cx="20.4" cy="28.6" r="2.6" fill="none" stroke="#C0574E" ' +
        'stroke-width=".9" opacity=".75"/>' +
      '<circle cx="20.4" cy="33.2" r="2.6" fill="none" stroke="#C0574E" ' +
        'stroke-width=".9" opacity=".55"/>', o)
  };

  /* ノード。状態で描き分ける。矩形の代用ではなく、印そのもの。 */
  function nodeSVG(t) {
    const c = t === 'or' ? 'var(--or)' : t === 'gr' ? 'var(--gr)'
      : t === 'bl' ? 'var(--bl)' : 'var(--ink3)';
    if (t === 'gy')
      return '<svg class="nd" viewBox="0 0 11 11" xmlns="' + NS + '">' +
        '<circle cx="5.5" cy="5.5" r="4.6" fill="var(--card)" ' +
          'stroke="' + c + '" stroke-width="1.1"/>' +
        '<line x1="3.2" y1="5.5" x2="7.8" y2="5.5" stroke="' + c +
          '" stroke-width="1.3" stroke-linecap="round"/></svg>';
    if (t === 'gr')
      return '<svg class="nd" viewBox="0 0 11 11" xmlns="' + NS + '">' +
        '<circle cx="5.5" cy="5.5" r="4.6" fill="' + c + '"/>' +
        '<path d="M3.4 5.6l1.6 1.6 3-3.2" fill="none" stroke="#fff" ' +
          'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return '<svg class="nd" viewBox="0 0 11 11" xmlns="' + NS + '">' +
      '<circle cx="5.5" cy="5.5" r="4.6" fill="' + c + '"/>' +
      '<circle cx="5.5" cy="5.5" r="1.7" fill="#fff" opacity=".55"/></svg>';
  }

  const T_CAL = '<svg viewBox="0 0 14 14" width="14" height="14" xmlns="' + NS + '">' +
    '<rect x=".7" y="2.4" width="12.6" height="11" rx="1.4" fill="none" ' +
      'stroke="#B9B2A0" stroke-width="1.1"/>' +
    '<line x1=".7" y1="5.8" x2="13.3" y2="5.8" stroke="#B9B2A0" stroke-width="1.1"/>' +
    '<line x1="4.2" y1=".7" x2="4.2" y2="3.5" stroke="#B9B2A0" stroke-width="1.3" ' +
      'stroke-linecap="round"/>' +
    '<line x1="9.8" y1=".7" x2="9.8" y2="3.5" stroke="#B9B2A0" stroke-width="1.3" ' +
      'stroke-linecap="round"/></svg>';
  const T_DOC = '<svg viewBox="0 0 14 14" width="14" height="14" xmlns="' + NS + '">' +
    '<path d="M3.2 1.2h5L11.4 4.4v8.4H3.2z" fill="none" stroke="#B9B2A0" ' +
      'stroke-width="1.1" stroke-linejoin="round"/>' +
    '<path d="M8.2 1.2v3.2h3.2" fill="none" stroke="#B9B2A0" stroke-width="1.1" ' +
      'stroke-linejoin="round"/>' +
    '<path d="M5.2 7.6h4M5.2 10h2.6" stroke="#B9B2A0" stroke-width="1.1" ' +
      'stroke-linecap="round"/></svg>';
  const T_CAL_S = '<svg viewBox="0 0 14 14" width="12" height="12" xmlns="' + NS + '">' +
    '<rect x=".7" y="2.4" width="12.6" height="11" rx="1.4" fill="none" ' +
      'stroke="#D9A96B" stroke-width="1.2"/>' +
    '<line x1=".7" y1="5.8" x2="13.3" y2="5.8" stroke="#D9A96B" stroke-width="1.2"/>' +
    '<line x1="4.2" y1=".7" x2="4.2" y2="3.5" stroke="#D9A96B" stroke-width="1.4" ' +
      'stroke-linecap="round"/>' +
    '<line x1="9.8" y1=".7" x2="9.8" y2="3.5" stroke="#D9A96B" stroke-width="1.4" ' +
      'stroke-linecap="round"/></svg>';
  const T_INFO = '<svg viewBox="0 0 14 14" width="14" height="14" xmlns="' + NS + '">' +
    '<circle cx="7" cy="7" r="6.1" fill="none" stroke="#8FA8BF" stroke-width="1.1"/>' +
    '<line x1="7" y1="6.2" x2="7" y2="10.2" stroke="#8FA8BF" stroke-width="1.3" ' +
      'stroke-linecap="round"/>' +
    '<circle cx="7" cy="3.9" r=".85" fill="#8FA8BF"/></svg>';

  /* ── 描く：今のうち ──────────────────────────────── */
  // 境界線・通路と配管・増築の平面・名義の移動・ローン。幾何図形で読める小図。
  function matterIcon(key) {
    const drawings = {
      boundary: '<path d="M5 11h15v27H5z" fill="#EAF0DF"/><path d="M24 11h15v27H24z" fill="#F5E5CD"/><path d="M22 7v34" stroke="#A87937" stroke-dasharray="3 3"/><path d="M6 25h13m6 0h13" stroke="#B9B7A1"/><path d="M19 9h6v5h-6zm0 25h6v5h-6z" fill="#C2AD86" stroke="#8E7854"/>',
      road: '<path d="M10 5h22v38H10z" fill="#EEE9DF"/><path d="M11 5v38m20-38v38" stroke="#9F988A"/><path d="M21 7v6m0 6v6m0 6v6" stroke="#B2A791"/><path d="M5 33h11V18h23" stroke="#7C9A9B" stroke-width="4" fill="none"/><path d="M5 33h11V18h23" stroke="#D7E6E1" stroke-width="1" fill="none"/>',
      changed: '<path d="M6 10h22v29H6z" fill="#F0EADD" stroke="#9C8C70"/><path d="M28 20h12v19H28" fill="#E4ECDC" stroke="#718B64" stroke-dasharray="3 2"/><path d="M6 25h13m0-15v15m15 1v7m-3-3.5h6" stroke="#9C8C70"/><path d="M10 14h5m-5 4h5" stroke="#C4B9A3"/>',
      /* 前の代の相続登記＝前の代の書面から本人の書面へ、名義が移る。 */
      prior: '<path d="M5 8h22v29H5z" fill="#EEE8DC" stroke="#B1A48B"/><path d="M17 13h22v29H17z" fill="#FFFEFA" stroke="#9C8C70"/><path d="M22 20h12m-12 5h12m-12 5h7" stroke="#C8BDA6"/><path d="M5 23h9m-3-3 3 3-3 3" fill="none" stroke="#A87937"/><path d="M30 34h5v5h-5z" fill="#EAC8B9" stroke="#B97762"/>',
      /* 団信＝ローンの契約書面に、円の印。 */
      loan: '<path d="M7 6h24v33H7z" fill="#FFFEFA" stroke="#9C8C70"/><path d="M12 13h14m-14 5h14m-14 5h8" stroke="#C8BDA6"/><circle cx="31" cy="34" r="7.5" fill="#F5E5CD" stroke="#A87937"/><path d="M28.4 30.6 31 34l2.6-3.4M31 34v4.4m-2.4-2.6h4.8" stroke="#A87937"/>'
    };
    return '<svg class="matter-icon" viewBox="0 0 44 48" fill="none" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (drawings[key] || drawings.boundary) + '</svg>';
  }

  function nowHTML(p) {
    const rows = nowRows(p);
    return '<div class="rail">' + rows.map(x => {
      const active = !['none', 'done'].includes(x.status);
      const context = x.context || [x.assignee, x.timing].filter(Boolean).join(' ／ ');
      return '<section class="rw is-' + esc(x.status) + '"><div class="rh">' +
        matterIcon(x.icon || x.key) +
        (x.pick ? unitHead(x.nm, statusPick(p, x.type, x.key, x.status, x.nm, x.label), '')
          : unitHead(x.nm, badge(x.status), editButton(p, x.type, x.key, x.nm))) + '</div>' +
        (x.type === 'prior' ? priorBody(p) :
        '<div class="rw-record"><p>' + esc(x.summary) + '</p></div>' +
        (active && x.next ? '<div class="record-next"><span>次にすること</span><p>' + esc(x.next) + '</p>' +
          (context ? '<small>' + esc(context) + '</small>' : '') + '</div>' : '')) + '</section>';
    }).join('') + '</div>';
  }

  /* 手続きは入口を常時表示し、順序と補足だけを展開する。
     展開状態を測定用HTMLにも反映して、間取りの壁を内容の高さに合わせる。 */
  function whenHTML(p) {
    const rows = goneRows(p);
    /* 父の分がないと分かっているときは、その理由を言う（「判断できません」
       と出すと、記録が足りないように読める）。 */
    const pr = p.priorInheritance || {};
    const noStake = !fatherStake(p) && pr.remains === 'yes' && priorGone(p, pr)
      ? '<div class="card"><div class="de">' + esc(priorGone(p, pr)) + '</div></div>' : '';
    if (!rows.length) return noStake || '<div class="card"><div class="de">' +
      '登録内容だけでは手続きを判断できません。権利・契約の状況を確認してください。</div></div>';
    return noStake + '<div class="procedure-sheets">' + rows.map((x, i) => {
      const key = p.id + ':' + x.icon;
      const expanded = openProcedures.has(key);
      return '<article class="procedure-sheet' + (i === 0 ? ' primary' : '') + '">' +
        '<header class="procedure-head">' + (GLYPH[x.icon] ? GLYPH[x.icon]({ w: i === 0 ? 32 : 25 }) : '') +
        '<div>' + (x.eyebrow ? '<div class="procedure-eyebrow">' + esc(x.eyebrow) + '</div>' : '') +
        '<h5>' + esc(x.nm) + '</h5></div></header>' +
        '<p class="procedure-purpose">' + esc(x.de) + '</p>' +
        '<dl class="procedure-entry"><dt>' + esc(x.whereLabel) + '</dt><dd>' + esc(x.where) + '</dd>' +
        '<dt>まず</dt><dd>' + esc(x.first) + '</dd></dl>' +
        (x.lim ? '<div class="procedure-deadline">' + T_CAL + '<span><b>期限</b> ' + esc(x.lim) + '</span></div>' : '') +
        '<button type="button" class="procedure-toggle" data-procedure="' + esc(key) +
        '" aria-expanded="' + expanded + '"><span>' + (expanded ? '手順・補足を閉じる' : '手順・補足を見る') +
        '</span><span aria-hidden="true">' + (expanded ? '−' : '＋') + '</span></button>' +
        (expanded ? '<div class="procedure-detail">' +
          (x.only && x.only.length ? '<div class="procedure-context"><b>この物件では</b><ul>' + x.only.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div>' : '') +
          '<ol>' + x.steps.map(step => '<li>' + esc(step) + '</li>').join('') + '</ol>' +
          (x.limNote ? '<p class="procedure-note">' + esc(x.limNote) + '</p>' : '') +
          (x.cautions ? '<div class="procedure-cautions"><b>気をつけること</b><ul>' + x.cautions.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div>' : '') +
          '<p class="procedure-note">' + esc(x.note) + '</p>' +
          (x.link ? '<a class="procedure-source" href="' + esc(x.link) + '" target="_blank" rel="noopener noreferrer">' +
            esc(x.linkLabel) + ' ↗</a>' : '') + '</div>' : '') + '</article>';
    }).join('') + '</div>';
  }

  /* ── 部屋へ渡す入口 ──────────────────────────────
     v27 の .pane は「地」を背景に持つ div だったが、間取りでは
     部屋の床そのものが地なので、.pane は作らない。室名札が
     大見出しの役をし、その下に説明、白いカードが載る。            */
  function roomLiv(p) {
    return roomTag('liv', '今のうち', tagCounts(nowRows(p))) +
      '<div class="pn">' + WHO + 'に聞く。記録に残す。家族が続きから動けるように。</div>' +
      nowHTML(p);
  }
  function roomWhen(p) {
    return roomTag('when', 'そのとき', { act: 0 }) +
      '<div class="pn">' + WHO + 'が亡くなった後の連絡先と手順を、今から確認する。</div>' + whenHTML(p);
  }

  /* ══ 造形｜表札（ルームタグ）════════════════════════════
     部屋の名前を出すものを、玄関の表札として描く。前の版は
     引き出し線＋下罫（図面の室名記入）だったが、線が2本ある
     だけで札に見えなかった。表札は線ではなく**板**で、板には
     厚みがあり、壁から浮いて影を落とす ―― そこが物の形。

     CLAUDE.md の振り分け：PD/CC0 素材を探したが、表札の立面と
     して使えるものは無かった（`不動産-表札.RESEARCH.md`）。
     幾何プリミティブ（矩形・線・影）数個で寸法を数個決めれば
     済む形なので、振り分け1に該当し自作する。

     寸法は実物の実寸比から引く（勘で置かない）：
       ・板＝関東型 198×83mm ≒ 2.39:1 の横長。角は糸面取り
       ・板厚 20mm ―― 小口が見えるので、下辺に板厚ぶんの面
       ・壁との浮き＝スペーサー。板の落とす影で表す
       ・文字は切り文字（浮き彫り）。板より手前にあるので、
         文字自身も薄い影を持つ
     板と影は SVG、文字は HTML（選択・読み上げ・折り返しのため。
     切り文字の影は CSS の text-shadow が受け持つ）。           */

  /* 未確認と要対応の件数だけを数える。合計は中身を見れば分かるので出さない。 */
  function tagCounts(rows) {
    return { act: rows.filter(r => ['unknown', 'action'].includes(r.status)).length };
  }

  function roomTag(kind, title, c) {
    /* 板。文字の長さで横幅が変わるので、板を1枚の SVG に描いて
       引き伸ばすと、角の面取りも板厚も一緒に歪む（実寸比が
       崩れる）。そこで**縦だけ実寸**にして、横は伸ばす：
       viewBox の高さ 83 を板の高さに固定し、幅は伸縮させる。
       角丸・小口・面取りはすべて高さ側の数値なので歪まない。

       正面から見た表札の層（奥→手前）：
         壁に落ちる影 → 板の正面 → 板厚の小口 → 面取り       */
    const plate = '<svg class="rt-plate" viewBox="0 0 198 89" ' +
      'preserveAspectRatio="none" xmlns="' + NS + '" aria-hidden="true">' +
      /* 壁に落ちる影＝スペーサーで浮かせている証拠。板の下と
         右へ、板厚ぶん（20mm）ずれる。                      */
      '<rect class="rt-shadow" x="5" y="6" width="193" height="83" rx="3"/>' +
      /* 板の正面。198×83mm。角は糸面取り r=3mm。 */
      '<rect class="rt-face" x="0" y="0" width="193" height="83" rx="3"/>' +
      /* 板厚 20mm の小口。下端に見える面。正面との境は、実物では
         面取りで光が回り込むので、境に明るい線を1本入れて段差を
         作る ―― 塗り分けただけだと別の帯に見え、板に見えない。 */
      '<path class="rt-edge" d="M0 66h193v14a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3Z"/>' +
      '<line class="rt-edge-lit" x1="0.5" y1="66" x2="192.5" y2="66"/>' +
      /* 面取りのハイライト。光は左上から ―― 上辺と左辺に1本。 */
      '<path class="rt-bevel" d="M3.5 1.4h186M1.4 3.5v60"/>' +
      '</svg>';
    /* 未確認・要対応の件数。板の右に打つ小さな金物の札（副表札）。
       0件のときは付けない ―― 何も無いことを札で言わない。    */
    const cnt = c && c.act
      ? '<span class="rt-n">要確認・対応 <b>' + c.act + '</b></span>'
      : '';
    return '<div class="rtag rt-' + kind + '">' +
      '<div class="rt-plate-w">' + plate +
        '<h4 class="rt-nm">' + esc(title) + '</h4>' +
      '</div>' + cnt +
      '</div>';
  }

  /* 権利：土地と建物の対。

     ■ 2026-09-22｜権利の種類を構造として立てた（調査 §7-1）

     以前は owner に「父（故人）名義のまま」のような文字列を入れるだけで、
     **借地が構造として立っていなかった**。借地権は登記されないことが
     ほとんど（建物だけを登記する）なので、**登記事項証明書を見ても
     借地だと分からない**。家族は気づけないし、気づいても地主が誰かを
     知らないと何も組み立てられない（§3-5 を強く通る）。

     項目設計 §2 は「所有／共有／**借地**など」と既に書いていた。
     連動も §2 が定めている ―― **借地 → 3「借りる」を確認**。
     だから地主（相手）は契約・やり取りが持ち、ここは
     「借地である」という事実だけを持つ。

     マンションは土地／建物に分けない（§2 明記。敷地権は入力させない）。 */
  const HOLD = {
    own:    { label: '所有',   tone: 'gr' },
    share:  { label: '共有',   tone: 'bl' },
    lease:  { label: '借地',   tone: 'or' },
    other:  { label: 'その他', tone: 'gy' }
  };

  /* ■ 2026-09-23｜見比べる表にした

     土地と建物は同じ項目（名義・種類・持分・登記との一致）を持つ対。
     横に並べる理由はそこにある ――「土地は父の名義のまま、建物は本人」
     という食い違いが、行を揃えれば横に読める。以前の横並びは2列を
     別々に流し込んでいたので高さがずれ、「名義」「登記と」を列ごとに
     繰り返していた。項目名は左に1回だけ出し、行を揃える。

     所有・一致はバッジにしない。状態ではなく値なので、本文に文字で
     入れる（バッジは §11 の状態1つだけ）。                        */
  /* 前の代の相続の行は、今のうちの「前の代の相続登記」の答えを映すだけ
     （入力は向こう。権利関係のフォームには置かない）。 */
  const INHERIT_STAGE = { none: '未了（話がついていない）', agreed: '未了（取得する人は決まった・書面なし）',
    signed: '未了（協議書あり）', ready: '未了（協議書あり）', registered: '相続登記済み' };
  function inheritText(p, k) {
    const pr = p.priorInheritance || {};
    if (pr.remains === 'no') return 'なし';
    if (pr.remains !== 'yes') return '未確認';
    if (!(pr.parcels || []).includes(k)) return 'なし';
    if (pr.stage === 'registered') return INHERIT_STAGE.registered;
    const route = S.priorRoute(pr);
    if (route === 'unknown') return '未了（移し方を確認中）';
    if (route === 'will') return '未了（遺言あり）';
    if (route === 'sole') return '未了（相続人は1人）';
    return INHERIT_STAGE[pr.stage] || INHERIT_STAGE.none;
  }
  function rightStatus(p, k, r) {
    if (r.match === 'differ' || S.priorPending(p, k)) return 'action';
    if (!r.match || r.match === 'unknown') return 'unknown';
    return 'done';
  }
  function roomRights(p) {
    const keys = (p.kind === 'condo' ? ['bldg'] : p.kind === 'land' ? ['land'] : ['land', 'bldg'])
      .filter(k => p.rights[k]);
    const name = k => k === 'land' ? '土地' : p.kind === 'condo' ? '専有部分' : '建物';
    const rs = keys.map(k => p.rights[k]);
    const any = f => rs.some(r => f(r));
    const rows = [
      ['名義', r => r.owner],
      ['種類・持分', r => [(HOLD[r.hold] || HOLD.own).label, r.shares].filter(Boolean).join('・')],
      ['登記との一致', r => r.match === 'differ' ? '認識と違いがある' : (MATCH[r.match] || MATCH.unknown).label,
        r => r.match === 'differ'],
      ['前の代の相続', (r, i) => inheritText(p, keys[i]), (r, i) => S.priorPending(p, keys[i])],
      any(r => r.memo) && ['経緯', r => r.memo]
    ].filter(Boolean);
    let h = '<div class="deeds" style="--n:' + keys.length + '"><div class="dg-lb dg-corner"></div>' +
      keys.map((k, i) => '<div class="dg-head">' + unitHead(name(k), badge(rightStatus(p, k, rs[i])),
        editButton(p, 'right', k, name(k) + 'の権利関係')) + '</div>').join('');
    rows.forEach(([lb, val, warn]) => {
      h += '<div class="dg-lb">' + esc(lb) + '</div>' + rs.map((r, i) => {
        const v = val(r, i);
        return '<div class="dg-v' + (lb === '名義' ? ' dg-main' : '') + (warn && warn(r, i) ? ' dg-warn' : '') +
          (v ? '' : ' dg-empty') + '">' + esc(v || '—') + '</div>';
      }).join('');
    });
    return roomHead('right', '権利関係') + h + '</div>';
  }

  /* ローン・契約：相手ごとの塊。相手の名前が頭に立つ。

     ■ 2026-09-22｜担保を借入から独立させた（調査 §7-2b）

     以前は担保を loan.cross（文字列）で持ち、**loan.has が false だと
     表示されなかった**。だが借入が無くても担保にはなり得る ――
     他人の借入のために自分の不動産を担保に出す「物上保証」。

     物上保証は**登記の債務者欄が本人以外**なので調べれば分かるが、
     **見なければ気づかない**。債務自体は相続されないが、返済されなければ
     不動産を失う。遺産分割のとき、債務者の資力を確認して評価を
     下げる等の検討が要る。項目設計 §4 は「担保」を独立の項目として
     既に立てていた（あり／なし／不明、**誰の借入か**、何の借入か、借入先）。 */
  /* ■ 2026-09-23｜2つの塊に分け、重さで差をつけた

     借入・担保・管理を同じ調子で縦に並べると、ただの羅列になる。
     性格の違う2種類なので塊を分ける：
       借入・担保     … この物件に付いているお金の縛り
       契約している相手 … 家族が連絡を引き継ぐ先
     各単位の中は、家族が使う1行（相手の名前と連絡先）を太く、
     残りを従にする。担保は借入に従属する1行の単位（以前は担保だけ
     薄茶の箱に入っていて、選択中の項目のように見えた）。          */
  function loanStatus(l) {
    if (l.has === false) return 'none';
    if (l.has == null || !l.bank || !l.debtor || !l.gteeStatus || l.gteeStatus === 'unknown') return 'unknown';
    return 'done';
  }
  function securityStatus(s) {
    if (s.has === 'no') return 'none';
    if (s.has !== 'yes' || !s.whose || s.whose === 'unknown') return 'unknown';
    return 'done';
  }
  function dealStatus(d) {
    return d.st === 'done' ? 'done' : d.st === 'action' ? 'action' : d.who ? 'doing' : 'unknown';
  }
  const line = (cls, v) => v ? '<div class="' + cls + '">' + esc(v) + '</div>' : '';
  function roomParty(p) {
    const l = p.loan, s = p.security || {};
    const ls = loanStatus(l), ss = securityStatus(s);
    const loanName = l.has === true ? l.bank || '借入先が未記録' : l.has === false ? '借入なし' : '借入の有無が未確認';
    let h = '<section class="grp"><h5 class="grp-h">借入・担保</h5>' +
      '<div class="unit">' + unitHead(loanName, badge(ls), editButton(p, 'loan', 'loan', '借入')) +
      (l.has ? line('u-main u-tel', l.tel) +
        line('u-sub', [l.type, l.debtor, l.gteeStatus ? '団信' + ({ yes: 'あり', no: 'なし' }[l.gteeStatus] || '不明') : '']
          .filter(Boolean).join('・')) : '') +
      line('u-sub', l.memo) + '</div>';
    const secText = s.has === 'yes'
      ? [s.whose === 'self' ? WHO + 'の借入の担保' : s.whose === 'other' ? WHO + '以外の借入の担保' : '誰の借入か未確認',
         s.bank, s.order].filter(Boolean).join('・')
      : s.has === 'no' ? 'この物件は担保になっていない' : '担保になっているか未確認';
    h += '<div class="unit unit-line"><span class="uh-nm">担保</span>' +
      '<span class="ul-v">' + esc(secText) + '</span>' + badge(ss) +
      editButton(p, 'security', 'security', '担保') + '</div></section>';

    h += '<section class="grp"><h5 class="grp-h">契約している相手</h5>' +
      (p.deals || []).map((d, i) => {
        const ds = dealStatus(d);
        return '<div class="unit">' + unitHead(d.who || '相手が未記録', badge(ds),
          editButton(p, 'deal', String(i), d.who || '契約の相手'),
          (DEALS[d.kind] || DEALS.manage).label) +
          line('u-main u-tel', d.tel) + line('u-sub', d.what) + '</div>';
      }).join('') +
      addButton(p, 'deal', '契約している相手を追加') + '</section>';
    return roomHead('loan', 'ローン・契約') + h;
  }

  /* 書類：**所在**だけを持つ（調査 §10-3）。

     以前は neededDocs() の11種を「確認済み／対応が必要／該当なし」で
     並べていたが、項目設計 §6 が明示的に否定している ――
     「不動産カテゴリ内にもう一つ書類管理機能を作らない」。
     揃い具合の管理は書類管理であって、辿り着けるようにすることではない。

     載せるのは **家の中を探さないと出てこないもの** だけ。

       常に        権利証・取得時の資料
                   （再発行されない／取り直せない。本人しか在り処を知らない）
       従属        境界の書面・借地契約書
                   （事情・契約で「書面あり」になったときだけ現れる）

     役所で取れるもの（戸籍・除票・印鑑証明・課税明細）は載せない。
     手続きごとに要るものが違うので、**上段の各手続きに付いている**。 */

  /* どこにあるか。ある／無い／分からない を §11 の状態として持つ。 */
  const WHERE_ST = {
    have:    { label: 'ある',       tone: 'gr' },
    lost:    { label: '見つからない', tone: 'or' },
    unknown: { label: '分からない',   tone: 'bl' }
  };

  function placedDocs(p) {
    const at = p.docs.at || {};
    const keys = new Set(['deed', 'acquire']);
    Object.entries(p.matters || {}).forEach(([key, m]) => {
      if (m.find !== 'no' && m.detail && m.detail.paper === 'あり') keys.add(key);
    });
    Object.keys(at).forEach(key => { if (S.DOC_KINDS[key] && key !== 'prior' && key !== 'priorWill') keys.add(key); });
    /* 前の代の協議書・遺言書は、父が取得する側で登記がまだのときだけ。
       父が先に亡くなると、家族がこれを司法書士に渡して登記に使う。 */
    const pr = p.priorInheritance || {};
    if (pr.remains === 'yes' && pr.taker !== 'other' && pr.stage !== 'registered' && S.priorParty(pr) === WHO) {
      if (S.priorRoute(pr) === 'split' && pr.stage === 'signed') keys.add('prior');
      if (S.priorRoute(pr) === 'will') keys.add('priorWill');
    }
    (p.deals || []).forEach(d => { if (d.kind === 'borrow') keys.add('borrow'); });
    return Array.from(keys).map(key => ({ key, label: S.DOC_KINDS[key].label, ...(at[key] || {}) }));
  }
  function roomDocs(p) {
    /* 主役は保管場所の字。書類名は単位の名前として頭に置き、
       場所はその下に太く出す（家族が読みに来るのは場所）。 */
    const h = placedDocs(p).map(d => {
      const located = d.st === 'have' && d.place;
      const st = located ? 'have' : d.st === 'lost' ? 'lost' : 'unknown';
      return '<div class="unit">' + unitHead(d.label, badge(null, WHERE_ST[st]),
          editButton(p, 'doc', d.key, d.label + 'の所在')) +
        (located ? line('u-main', d.place) : '') + line('u-sub', d.note) + '</div>';
    }).join('');
    return roomHead('doc', '書類のありか') + '<p class="record-lead">家族が取り出せる場所を残す</p>' + h +
      (Object.keys(S.DOC_KINDS).some(k => !p.docs.at[k]) ? addButton(p, 'doc', '別の書類を追加') : '');
  }

  function roomHead(icon, title) {
    return '<div class="rm-h"><span class="rm-ic">' + (ICONS[icon] || '') +
      '</span><h4>' + esc(title) + '</h4></div>';
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

  /* ══════════════════════════════════════════════════════════
     ■ 部屋の生成｜部屋定義から共有辺→壁・開口を作る
     （`_検討/間取り検討.html` 由来。v28 の buildPlan/sharedEdge/draw
     をそのまま移植。物件ごとに実測してから壁を置く二度描きは
     旧 render.js の測り方を踏襲する）。                          */

  /* 下段の割り。検討のあいだ URL で振れるようにする。
       ?ratio=0.4   廊下を除いた残りのうち、左（書類）が取る割合
       ?order=right,party  右列を上から積む順
     既定は 書類4：権利・ローン6。 */
  const Q = (function () {
    try { return new URLSearchParams(location.search); }
    catch (e) { return new URLSearchParams(''); }
  })();
  const RATIO = (function () {
    const v = parseFloat(Q.get('ratio'));
    return (v > 0.2 && v < 0.8) ? v : 0.4;
  })();
  const ORDER = (function () {
    const v = (Q.get('order') || '').split(',').map(s => s.trim()).filter(Boolean);
    const ok = ['right', 'party'];
    const picked = v.filter(k => ok.indexOf(k) >= 0);
    return picked.length === 2 ? picked : ok;
  })();

  const W_ = 1170, TO = 15, TI = 10, GK = 140;
  const MINR = 137, MAXR = 2400;
  /* 敷地の余白（SVG 単位）。間取り図の草地の縁。見出しの屋根を
     建物に接させるため、propHead 側もこの値を使う。 */
  const SITE_U = 34;

  function sharedEdge(a, b) {
    if (!a || !b) return null;
    if (a.x2 === b.x1 || b.x2 === a.x1) {
      const x = (a.x2 === b.x1) ? a.x2 : b.x2;
      const s = Math.max(a.y1, b.y1), e = Math.min(a.y2, b.y2);
      if (e > s) return { dir: 'v', pos: x, a: s, b: e };
    }
    if (a.y2 === b.y1 || b.y2 === a.y1) {
      const y = (a.y2 === b.y1) ? a.y2 : b.y2;
      const s = Math.max(a.x1, b.x1), e = Math.min(a.x2, b.x2);
      if (e > s) return { dir: 'h', pos: y, a: s, b: e };
    }
    return null;
  }
  const el = (n, a) => {
    const e = document.createElementNS(NS, n);
    for (const k in a) e.setAttribute(k, a[k]);
    return e;
  };

  function buildPlan(p, stageW) {
    const html = { liv: roomLiv(p), when: roomWhen(p),
      right: roomRights(p), party: roomParty(p), docs: roomDocs(p) };

    /* 横方向の割り。上段＝今のうち／そのとき 5：5。下段＝廊下を挟んで
       書類4：権利＋ローン契約＋事情6（v27/v28 の実測から決めた比）。 */
    const VN = Math.round(W_ * 0.5);
    const CW = 110;
    /* 下段は廊下を挟んで左右2列。RATIO＝廊下を除いた残りのうち
       左（書類）が取る割合。?ratio= で検討のあいだ振れるようにする。 */
    const V2 = Math.round((W_ - CW) * RATIO);
    const V3 = V2 + CW;

    /* 左＝書類、廊下、右＝権利／ローン契約を縦に積む。
       左右の比率は RATIO（廊下を除いた残りのうち、左が取る割合）。 */
    const wLeft = V2 - TO / 2 - TI / 2;
    const wRight = W_ - V3 - TI / 2 - TO / 2;
    const wUnit = {
      liv: VN - TO / 2 - TI / 2,
      when: W_ - VN - TI / 2 - TO / 2,
      docs: wLeft,
      right: wRight, party: wRight
    };
    const PADIN = 13;
    const HEADPX = { liv: 28, when: 28 }, HEADPX_D = 23;
    const headOf = k => HEADPX[k] != null ? HEADPX[k] : HEADPX_D;
    const viewW = W_ + SITE_U * 2;
    const u2px = u => u / viewW * stageW;
    const px2u = x => x * viewW / stageW;
    const toPx = u => u2px(u - PADIN * 2);

    /* 上下の壁厚。左の部屋は外壁に接して下端まで伸びるので [TI, TO]、
       下の部屋も足元が外壁なので [TI, TO]。割りに依らず同じ。 */
    const wallY = { liv: [TO, TI], when: [TO, TI], docs: [TI, TO],
      right: [TI, TI], party: [TI, TO] };
    const raw = {}, need = {};
    Object.keys(html).forEach(k => {
      raw[k] = measureHTML(html[k], Math.max(50, toPx(wUnit[k])));
      const walls = (wallY[k][0] + wallY[k][1]) / 2;
      const inUnit = px2u(raw[k] + headOf(k)) + PADIN * 2 + walls;
      need[k] = Math.min(MAXR, Math.max(MINR, Math.ceil(inUnit)));
    });

    const H1 = Math.max(need.liv, need.when);

    /* ══ 下段の割り｜廊下（V2〜V3）を芯として残す ══════════
       廊下と玄関は建物の動線で、上段から下段へ降りる道。
       消すと間取り図ではなく「仕切られた箱」になるので必ず残す。

       左＝関係書類
       右＝権利関係／ローン・契約を**縦に積む**

       積み順は ORDER（?order= で振る）。左右比は RATIO（?ratio=）。 */
    const LABEL = { right: '権利関係', party: 'ローン・契約' };
    const stack = ORDER.filter(k => LABEL[k]);

    /* 右列の各部屋の上下端を積み上げる。 */
    const rightRooms = [];
    let y = H1;
    stack.forEach((k, i) => {
      const last = i === stack.length - 1;
      rightRooms.push({ id: k, label: LABEL[k], kind: 'room',
        x1: V3, y1: y, x2: W_, y2: y + need[k], _last: last });
      y += need[k];
    });
    const rSum = y - H1;

    const CORR = Math.max(need.docs, rSum);
    const H = H1 + CORR;
    const KAMA = H - GK;

    /* 右列の最後の部屋は足元（外壁）まで伸ばす。左が高いときに
       右下だけ床が余るのを防ぐ ―― 壁ではなく部屋が伸びる。 */
    const lastRoom = rightRooms[rightRooms.length - 1];
    if (lastRoom) lastRoom.y2 = H;

    const rooms = [
      { id: 'liv', label: '今のうち', kind: 'liv', x1: 0, y1: 0, x2: VN, y2: H1 },
      { id: 'when', label: 'そのとき', kind: 'main2', x1: VN, y1: 0, x2: W_, y2: H1 },
      { id: 'corr', label: '', kind: 'corr', x1: V2, y1: H1, x2: V3, y2: KAMA },
      { id: 'gk', label: '玄関', kind: 'gk', x1: V2, y1: KAMA, x2: V3, y2: H },
      { id: 'docs', label: '書類', kind: 'room', x1: 0, y1: H1, x2: V2, y2: H }
    ].concat(rightRooms);
    return { p, rooms, R: Object.fromEntries(rooms.map(r => [r.id, r])),
      H, KAMA, H1, html, V2, V3 };
  }

  function measureHTML(html, wpx) {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;' +
      'font-family:' + getComputedStyle(document.body).fontFamily;
    d.style.width = wpx + 'px';
    d.innerHTML = html;
    document.body.appendChild(d);
    const h = d.getBoundingClientRect().height;
    d.remove();
    return h;
  }

  function draw(plan, uid) {
    const { rooms, R, H, KAMA, V2, V3 } = plan;
    /* 廊下から各部屋へ開口。右列は縦積みなので、廊下と接する辺が
       部屋ごとにある（sharedEdge が位置を拾う）。 */
    const links = [['liv', 'when'], ['corr', 'docs'],
      ['corr', 'right'], ['corr', 'party']];
    /* 壁を置かない境。廊下は上段から下段へ降りる道なので、
       上端は「今のうち」「そのとき」の両方へ開いている。
       廊下を中央へ寄せた結果、上端が liv と when に跨るようになった
       （以前は左寄りで liv だけに接していた）。when 側を閉じると、
       そのとき側から下段へ降りる動線が途切れる。 */
    const NOWALL = [['corr', 'gk'], ['corr', 'liv'], ['corr', 'when']];
    const OPW = 78;
    const openings = links.map(([i, j]) => {
      const e = sharedEdge(R[i], R[j]); if (!e) return null;
      return [e.dir, e.pos, (e.a + e.b) / 2, Math.min(OPW, (e.b - e.a) * 0.7)];
    }).filter(Boolean);
    openings.push(['h', H, (V2 + V3) / 2, V3 - V2 - TI]);
    const nowall = NOWALL.map(([i, j]) => sharedEdge(R[i], R[j])).filter(Boolean);

    const segs = new Map();
    const addSeg = (dir, pos, a, b, outer) => {
      const k = dir + ':' + pos + ':' + Math.min(a, b) + ':' + Math.max(a, b);
      if (!segs.has(k)) segs.set(k, { dir, pos, a: Math.min(a, b), b: Math.max(a, b), outer });
    };
    const covers = (x, y) => rooms.some(o =>
      o.x1 < x - 0.01 && o.x2 > x + 0.01 && o.y1 < y - 0.01 && o.y2 > y + 0.01);
    const isOuter = (dir, pos, a, b) => {
      const m = (a + b) / 2, d = 1;
      return dir === 'h' ? !(covers(m, pos - d) && covers(m, pos + d))
        : !(covers(pos - d, m) && covers(pos + d, m));
    };
    const th = (dir, pos, a, b) => isOuter(dir, pos, a, b) ? TO : TI;
    rooms.forEach(r => {
      addSeg('h', r.y1, r.x1, r.x2, isOuter('h', r.y1, r.x1, r.x2));
      addSeg('h', r.y2, r.x1, r.x2, isOuter('h', r.y2, r.x1, r.x2));
      addSeg('v', r.x1, r.y1, r.y2, isOuter('v', r.x1, r.y1, r.y2));
      addSeg('v', r.x2, r.y1, r.y2, isOuter('v', r.x2, r.y1, r.y2));
    });
    {
      const byLine = new Map();
      segs.forEach(s => {
        const k = s.dir + ':' + s.pos;
        if (!byLine.has(k)) byLine.set(k, []);
        byLine.get(k).push(s);
      });
      segs.clear();
      byLine.forEach((list, k) => {
        list.sort((a, b) => a.a - b.a);
        let cur = null; const out = [];
        list.forEach(s => {
          if (cur && s.a <= cur.b + 0.01) {
            cur.b = Math.max(cur.b, s.b); cur.outer = cur.outer || s.outer;
          } else { cur = Object.assign({}, s); out.push(cur); }
        });
        out.forEach((s, i) => segs.set(k + ':' + i, s));
      });
    }

    /* 敷地の余白。方位マークを建物の右下の外に置くため、壁の外余白
       （旧 render.js は 34）を確保する。
       ★この値は見出しの屋根の位置にも効く（屋根が建物に接するよう、
       見出しをこのぶん下げる）ので、SITE_U として外に出してある。 */
    const SITE = SITE_U;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'plan');
    svg.setAttribute('viewBox', -SITE + ' ' + -SITE + ' ' +
      (W_ + SITE * 2) + ' ' + (H + SITE * 2));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', plan.p.name + 'の間取り図');
    const defs = el('defs');
    const pat = el('pattern', { id: 're-hw' + uid, width: 6, height: 6,
      patternTransform: 'rotate(45)', patternUnits: 'userSpaceOnUse' });
    pat.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 6,
      class: 'pl-hatch' }));
    const grass = el('pattern', { id: 're-grass' + uid, width: 15, height: 15,
      patternUnits: 'userSpaceOnUse' });
    grass.appendChild(el('circle', { cx: 4, cy: 4, r: 1.5, class: 'pl-g1' }));
    grass.appendChild(el('circle', { cx: 11, cy: 11, r: 1.2, class: 'pl-g2' }));
    defs.appendChild(pat); defs.appendChild(grass); svg.appendChild(defs);

    /* 敷地の草 → 建物の影 → 床の順に重ねる（旧 render.js の地）。 */
    svg.appendChild(el('rect', { x: -SITE, y: -SITE,
      width: W_ + SITE * 2, height: H + SITE * 2,
      class: 'pl-site', fill: 'url(#re-grass' + uid + ')' }));
    svg.appendChild(el('rect', { x: 5, y: 7, width: W_, height: H,
      class: 'pl-shadow' }));

    /* 床＝v27 の「地」。今のうち＝橙、そのとき＝グレーグリーン
       （契約・デジタルの束の色に合わせた。値は
       contract-digital/area.css の .ib-pre / .ib-post と対）。 */
    const FLOOR = { corr: '#F4F1E7', gk: '#EDE9DC',
      liv: '#F7EAD6', main2: '#E9EFE9', room: '#FDFCF8' };
    rooms.forEach(r => {
      const x = r.x1 + th('v', r.x1, r.y1, r.y2) / 2;
      const y = r.y1 + th('h', r.y1, r.x1, r.x2) / 2;
      const x2 = r.x2 - th('v', r.x2, r.y1, r.y2) / 2;
      const y2 = r.y2 - th('h', r.y2, r.x1, r.x2) / 2;
      svg.appendChild(el('rect', { x, y, width: x2 - x, height: y2 - y,
        fill: FLOOR[r.kind] || '#FDFCF8' }));
    });

    const wallG = el('g', { class: 'pl-w', fill: 'url(#re-hw' + uid + ')' });
    function trimEnd(seg, v, dirSign) {
      const cross = seg.dir === 'h' ? 'v' : 'h';
      let hit = null;
      segs.forEach(o => {
        if (o.dir !== cross || o.pos !== v) return;
        if (seg.pos < o.a - 0.01 || seg.pos > o.b + 0.01) return;
        if (!hit || (o.outer && !hit.outer)) hit = o;
      });
      if (!hit) return v;
      return v - dirSign * (hit.outer ? TO : TI) / 2;
    }
    const slabs = [];
    segs.forEach(s => {
      const cuts = openings.filter(o => o[0] === s.dir && o[1] === s.pos)
        .map(o => [o[2] - o[3] / 2, o[2] + o[3] / 2])
        .concat(nowall.filter(e => e.dir === s.dir && e.pos === s.pos)
          .map(e => [e.a, e.b]))
        .filter(o => o[1] > s.a && o[0] < s.b).sort((a, b) => a[0] - b[0]);
      let cur = s.a; const pieces = [];
      cuts.forEach(o => { if (o[0] > cur) pieces.push([cur, o[0]]); cur = Math.max(cur, o[1]); });
      if (cur < s.b) pieces.push([cur, s.b]);
      pieces.forEach(pc => {
        const q0 = trimEnd(s, pc[0], +1), q1 = trimEnd(s, pc[1], -1);
        const tw = s.outer ? TO : TI;
        if (s.dir === 'h') slabs.push([q0, s.pos - tw / 2, q1 - q0, tw, s.outer]);
        else slabs.push([s.pos - tw / 2, q0, tw, q1 - q0, s.outer]);
      });
    });
    const EPS = 0.01;
    slabs.forEach(([x, y, w, h]) => wallG.appendChild(el('rect',
      { x, y, width: w, height: h, fill: '#FDFCF8', stroke: 'none' })));
    slabs.forEach(([x, y, w, h]) => wallG.appendChild(el('rect',
      { x, y, width: w, height: h, fill: 'url(#re-hw' + uid + ')', stroke: 'none' })));
    function subtract(a, b, ranges) {
      let out = [[a, b]];
      ranges.forEach(([c, d]) => {
        const next = [];
        out.forEach(([s0, s1]) => {
          if (d <= s0 + EPS || c >= s1 - EPS) { next.push([s0, s1]); return; }
          if (c > s0 + EPS) next.push([s0, c]);
          if (d < s1 - EPS) next.push([d, s1]);
        });
        out = next;
      });
      return out;
    }
    slabs.forEach((sl, idx) => {
      const [x, y, w, h, outer] = sl;
      const sw = outer ? 2 : 1.6;
      const others = slabs.filter((_, k) => k !== idx);
      [y, y + h].forEach(yy => {
        const cov = others.filter(o => o[1] < yy - EPS && o[1] + o[3] > yy + EPS)
          .map(o => [o[0], o[0] + o[2]]);
        subtract(x, x + w, cov).forEach(([s0, s1]) => {
          if (s1 - s0 > EPS) wallG.appendChild(el('line',
            { x1: s0, y1: yy, x2: s1, y2: yy, 'stroke-width': sw, class: 'pl-w-line' }));
        });
      });
      [x, x + w].forEach(xx => {
        const cov = others.filter(o => o[0] < xx - EPS && o[0] + o[2] > xx + EPS)
          .map(o => [o[1], o[1] + o[3]]);
        subtract(y, y + h, cov).forEach(([s0, s1]) => {
          if (s1 - s0 > EPS) wallG.appendChild(el('line',
            { x1: xx, y1: s0, x2: xx, y2: s1, 'stroke-width': sw, class: 'pl-w-line' }));
        });
      });
    });
    svg.appendChild(wallG);
    svg.appendChild(el('line', { x1: V2 + TI / 2, y1: KAMA, x2: V3 - TI / 2, y2: KAMA,
      class: 'pl-kama' }));
    const gkT = el('text', { x: (V2 + V3) / 2, y: (KAMA + H) / 2, 'text-anchor': 'middle',
      'dominant-baseline': 'middle', class: 'pl-gk-label' });
    gkT.textContent = '玄関'; svg.appendChild(gkT);

    /* 方位（北）。間取り図の約束。建物の右下の外に置く。 */
    const north = el('g', { class: 'pl-north',
      transform: 'translate(' + (W_ - 62) + ',' + (H - 58) + ')' });
    north.appendChild(el('circle', { r: 25 }));
    north.appendChild(el('path', { class: 'pl-n-arrow', d: 'M0 -18 L7 8 L0 2 L-7 8 Z' }));
    const northT = el('text', { y: -25, 'text-anchor': 'middle' });
    northT.textContent = 'N'; north.appendChild(northT);
    svg.appendChild(north);

    const layer = document.createElement('div');
    layer.className = 'layer';
    const VBW = W_ + SITE * 2, VBH = H + SITE * 2, PADIN = 13;
    rooms.forEach(r => {
      if (!plan.html[r.id]) return;
      const d = document.createElement('div');
      d.className = 'cell c-' + r.id;
      const x1 = r.x1 + th('v', r.x1, r.y1, r.y2) / 2 + PADIN;
      const y1 = r.y1 + th('h', r.y1, r.x1, r.x2) / 2 + PADIN;
      const x2 = r.x2 - th('v', r.x2, r.y1, r.y2) / 2 - PADIN;
      const y2 = r.y2 - th('h', r.y2, r.x1, r.x2) / 2 - PADIN;
      d.style.left = ((x1 + SITE) / VBW * 100) + '%';
      d.style.top = ((y1 + SITE) / VBH * 100) + '%';
      d.style.width = ((x2 - x1) / VBW * 100) + '%';
      d.style.height = ((y2 - y1) / VBH * 100) + '%';
      /* 玄関はラベルを持たない（SVG 側に「玄関」の文字を描くため）。 */
      d.innerHTML = (r.id === 'gk' ? '' : '') +
        '<div class="body">' + plan.html[r.id] + '</div>';
      layer.appendChild(d);
    });
    return { svg, layer };
  }

  /* ── 物件1件の間取り（stage の実幅で組み、SVG＋layer を host へ）── */
  let uidSeq = 0;
  function planOf(p, stageW) {
    const plan = buildPlan(p, stageW);
    const uid = uidSeq++;
    const built = draw(plan, uid);
    const wrap = document.createElement('div');
    wrap.className = 'plan-wrap';
    wrap.style.position = 'relative';
    wrap.appendChild(built.svg);
    wrap.appendChild(built.layer);
    return wrap;
  }

  /* 狭い画面用。間取りを畳んで、部屋を縦に積む。
     中身は同じ関数から作るので、広い画面と文言がずれない。 */
  function stackOf(p) {
    const box = (key, inner) =>
      '<div class="rm rm-' + key + '">' + inner + '</div>';
    return '<div class="stack">' +
      box('genkan', roomGenkan(p)) +
      box('liv', roomLiv(p)) +
      box('when', roomWhen(p)) +
      box('docs', roomDocs(p)) +
      box('rights', roomRights(p)) +
      box('party', roomParty(p)) +
      '</div>';
  }

  /* ══════════════════════════════════════════════════════════
     ■ 物件の見出し｜切妻屋根（2026-09-20、`_検討/不動産v29.html`）

     物件そのものを屋根のモチーフにする。参考画像からは**構造だけ**
     を取り（切妻の下に物件名・住所が載る）、線と面は間取り図と同じ
     製図的な手つきで描く。

     ★載せるもの＝物件名・用途・住所・種別／築年まで。
     以前ここにあった「本人に聞けるうちに確認したいこと」の橙の帯と
     進捗バー（受け渡せている事実 N%）は**落とした**：
       ・橙の帯＝すぐ下の「今のうち」の部屋に本文がある二重表示。
         一覧の札（shelf-card）の「要確認 N」が索引の役を果たす
       ・進捗バー＝家族に渡す事実ではなく本人の作業の消化率。
         §12「進捗は入力率で数えない」とも合わない
     （gauge() 自体は shelf() が使うので残す。）

     ★幅は間取り図（.plan-stage ＝作業面いっぱい）に揃える。
     屋根・その下の面・間取り図で幅が違うと、縦に繋がって見えない
     （v29 の途中版がそうなっていた。狭い壁の下から広い床が出た）。

     ★屋根の下に壁のスラブは立てない。矩形に色を敷いて「壁」と呼ぶ
     のは CLAUDE.md が禁じている代用そのもので、かつ上から見た
     間取り図と立面の壁で視点が衝突する。屋根の下端から落ちる陰の
     中に文字を置き、陰が消えたところで間取り図が始まる。

     ★勾配は実寸から引かない（この造形だけの例外）。帯の幅に実寸の
     4/10 を渡すと棟が帯の高さの3倍になり、物理的に入らない。器の
     高さから逆算する。代わりに部材（破風板180・棟包み120・瓦の
     働き幅235・軒樋φ105）は実寸比のまま持ち、そちらで密度を出す。

     線の階層は Leicester の実測立面図（CC BY-SA 3.0）から読み取った
     「輪郭 > 部材 > 下地 > 量産線」。詳細と素材探しの記録は
     `prototype/assets/不動産-物件見出し.RESEARCH.md`。
     ══════════════════════════════════════════════════════════ */

  /* 屋根1枚。幅 w・高さ h（px）で組む。1単位＝1px。 */
  function roofSVG(w, h, opt) {
    const o = opt || {};
    const HAFU = 18, MUNE = 12, KAWARA = 23.5, TOI = 10.5;
    const DEPTH = o.depth != null ? o.depth : 34;
    const W = w, H = h;

    /* 勾配は器（帯の高さ）から逆算する。 */
    const fixed = DEPTH + MUNE * .6 + HAFU * 1.08 + TOI * .55 + 3;
    const rise = Math.max(8, H - fixed);
    const PITCH = rise / (W / 2);
    const vt = d => d * Math.sqrt(1 + PITCH * PITCH);

    const cx = W / 2;
    const yRidge = DEPTH + MUNE * .6;
    const END = o.end != null ? o.end : 14;
    const xL = END, xR = W - END;
    const yL = yRidge + (cx - xL) * PITCH;
    const yH = yL + vt(HAFU);              /* 破風の下端 */

    const g = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rf',
      preserveAspectRatio: 'none', role: 'img', 'aria-label': '切妻屋根' });
    const add = (n, a) => g.appendChild(el(n, a));

    /* 影 */
    add('path', { class: 'r-sh',
      d: 'M ' + cx + ' ' + (yRidge + 5) + ' L ' + xR + ' ' + (yL + 5) +
         ' L ' + xR + ' ' + (yH + 6) + ' L ' + xL + ' ' + (yH + 6) +
         ' L ' + xL + ' ' + (yL + 5) + ' Z' });

    /* 軒天 */
    add('path', { class: 'r-noki',
      d: 'M ' + xL + ' ' + yH + ' L ' + cx + ' ' + (yRidge + vt(HAFU)) +
         ' L ' + xR + ' ' + yH + ' L ' + xR + ' ' + (yH + 5) +
         ' L ' + xL + ' ' + (yH + 5) + ' Z' });

    /* 屋根の面 */
    add('path', { class: 'r-tile',
      d: 'M ' + xL + ' ' + yL + ' L ' + cx + ' ' + yRidge + ' L ' + xR + ' ' + yL +
         ' L ' + xR + ' ' + (yL - DEPTH) + ' L ' + cx + ' ' + (yRidge - DEPTH) +
         ' L ' + xL + ' ' + (yL - DEPTH) + ' Z' });

    /* 瓦の段（量産線） */
    const tg = el('g', { class: 'r-tex' });
    const n = Math.max(2, Math.round(DEPTH / (KAWARA / Math.sqrt(1 + PITCH * PITCH))));
    for (let i = 1; i <= n; i++) {
      const dy = i * (DEPTH / (n + 1));
      tg.appendChild(el('path', { d: 'M ' + xL + ' ' + (yL - dy) +
        ' L ' + cx + ' ' + (yRidge - dy) + ' L ' + xR + ' ' + (yL - dy) }));
    }
    g.appendChild(tg);

    /* 棟（奥の稜線） */
    add('path', { class: 'r-sub',
      d: 'M ' + xL + ' ' + (yL - DEPTH) + ' L ' + cx + ' ' + (yRidge - DEPTH) +
         ' L ' + xR + ' ' + (yL - DEPTH) });

    /* 破風板 */
    add('path', { class: 'r-hafu',
      d: 'M ' + xL + ' ' + yL + ' L ' + cx + ' ' + yRidge + ' L ' + xR + ' ' + yL +
         ' L ' + xR + ' ' + yH + ' L ' + cx + ' ' + (yRidge + vt(HAFU)) +
         ' L ' + xL + ' ' + yH + ' Z' });
    add('path', { class: 'r-mem',
      d: 'M ' + xL + ' ' + yH + ' L ' + cx + ' ' + (yRidge + vt(HAFU)) +
         ' L ' + xR + ' ' + yH });

    /* 妻側の端部。層ごとに小口を見せて終わる（1枚で塗り潰さない）。 */
    const EW = END * .5;
    [[xL, -1], [xR, 1]].forEach(function (e) {
      const x = e[0], dx = e[1] * EW, dy = EW * .30;
      add('path', { class: 'r-end-d',      /* 瓦層の小口（奥） */
        d: 'M ' + x + ' ' + (yL - DEPTH) + ' L ' + (x + dx) + ' ' + (yL - DEPTH + dy) +
           ' L ' + (x + dx) + ' ' + (yL + dy) + ' L ' + x + ' ' + yL + ' Z' });
      add('path', { class: 'r-end-f',      /* 破風板の小口（手前） */
        d: 'M ' + x + ' ' + yL + ' L ' + (x + dx) + ' ' + (yL + dy) +
           ' L ' + (x + dx) + ' ' + (yH + dy) + ' L ' + x + ' ' + yH + ' Z' });
      add('path', { class: 'r-end-t',      /* 軒樋の小口 */
        d: 'M ' + x + ' ' + yH + ' L ' + (x + dx) + ' ' + (yH + dy) +
           ' L ' + (x + dx) + ' ' + (yH + TOI * .55 + dy) +
           ' L ' + x + ' ' + (yH + TOI * .55) + ' Z' });
      add('path', { class: 'r-sub',
        d: 'M ' + x + ' ' + yL + ' L ' + (x + dx) + ' ' + (yL + dy) });
      add('path', { class: 'r-sub',
        d: 'M ' + x + ' ' + yH + ' L ' + (x + dx) + ' ' + (yH + dy) });
      add('path', { class: 'r-mem',
        d: 'M ' + (x + dx) + ' ' + (yL - DEPTH + dy) +
           ' L ' + (x + dx) + ' ' + (yH + TOI * .55 + dy) });
    });

    /* 棟包み */
    const mw = MUNE * 1.8;
    add('path', { class: 'r-mune',
      d: 'M ' + (cx - mw) + ' ' + (yRidge - DEPTH + mw * PITCH) +
         ' L ' + (cx - mw) + ' ' + (yRidge + mw * PITCH) +
         ' L ' + cx + ' ' + (yRidge - MUNE * .45) +
         ' L ' + (cx + mw) + ' ' + (yRidge + mw * PITCH) +
         ' L ' + (cx + mw) + ' ' + (yRidge - DEPTH + mw * PITCH) +
         ' L ' + cx + ' ' + (yRidge - DEPTH - MUNE * .45) + ' Z' });
    add('path', { class: 'r-sub',
      d: 'M ' + (cx - mw) + ' ' + (yRidge + mw * PITCH) +
         ' L ' + cx + ' ' + (yRidge - MUNE * .45) +
         ' L ' + (cx + mw) + ' ' + (yRidge + mw * PITCH) });

    /* 軒樋。破風の内側に隠れて付くので、下端の線は引かない
       （引くと破風の下端と二重線になる）。 */
    add('path', { class: 'r-toi',
      d: 'M ' + xL + ' ' + yH + ' L ' + cx + ' ' + (yRidge + vt(HAFU)) +
         ' L ' + xR + ' ' + yH + ' L ' + xR + ' ' + (yH + TOI * .55) +
         ' L ' + cx + ' ' + (yRidge + vt(HAFU) + TOI * .55) +
         ' L ' + xL + ' ' + (yH + TOI * .55) + ' Z' });

    /* 輪郭（いちばん太い線）。妻側の端で折り返して閉じる。 */
    add('path', { class: 'r-out',
      d: 'M ' + xL + ' ' + yH + ' L ' + xL + ' ' + yL + ' L ' + cx + ' ' + yRidge +
         ' L ' + xR + ' ' + yL + ' L ' + xR + ' ' + yH });

    /* 文字を入れる窪みを測る。

       ★深さだけで決めてはいけない。三角形は上ほど狭いので、
       置きたい文字の**幅**が、その高さでの内法に収まるかを見る。
       深さだけで引き上げて、文字が破風に被った前例がある。

       fitY(wNeed) = 幅 wNeed が収まる、いちばん上の y。
       屋根の内法は、その y における左右の破風の内側の距離。
       内側の縁は、棟から降りる破風の下端の線（勾配 PITCH）。 */
    const y0 = yRidge + vt(HAFU) + TOI * .55;     /* 棟の直下＝内法 0 */
    const GAP = 18;                                /* 破風との逃げ（左右） */
    /* y における屋根の内法（左右の破風の内側の距離）。 */
    g._spanAt = function (y) {
      return Math.max(0, (y - y0) / PITCH * 2 - GAP * 2);
    };
    /* 幅 wNeed が収まる、いちばん上の y。 */
    g._fitY = function (wNeed) {
      return y0 + (Math.max(0, wNeed) / 2 + GAP) * PITCH;
    };
    g._bottom = H;
    return g;
  }

  /* 屋根の帯の高さ（px）。
     文字は「へ」の字の内側（棟の下の窪み）に入るので、窪みが
     物件名の高さぶん確保できるところまで棟を上げる。112px では
     窪みがほぼ無く、物件名が破風に重なっていた。 */
  const ROOF_H = 186;

  /* 物件の見出し。屋根＋その下の軒下（文字）。 */
  function propHead(p) {
    const u = USES[p.use] || USES.self;
    const k = KINDS[p.kind] || KINDS.other;
    return '<div class="ph" id="p-' + p.id + '">' +
      '<div class="rf-slot" style="height:' + ROOF_H + 'px"></div>' +
      '<div class="rf-under">' +
        '<div class="rf-ln"><span class="rf-t"><h3>' + esc(p.name) + '</h3>' +
          '<span class="rf-use t-' + u.tone + '">' + esc(u.label) +
          '</span></span></div>' +
        '<div class="rf-ln"><span class="rf-addr">' + ICONS.pin +
          esc(p.addr) + '</span></div>' +
        '<div class="rf-ln"><span class="rf-kind">' + esc(k.label) +
          (p.built ? '　｜　' + esc(p.built) + '築' : '') + '</span></div>' +
      '</div></div>';
  }

  /* 見出しの屋根を、実幅が決まってから組む（1単位＝1px）。

     引き上げ量は、物件名の行（.rf-t）の**実測幅**が屋根の内法に
     収まる高さから決める。数値を CSS 側に持つとずれるので、
     屋根の形から出して CSS 変数へ書き戻す。 */
  function drawRoofs() {
    document.querySelectorAll('.ph').forEach(function (ph) {
      const slot = ph.querySelector('.rf-slot');
      if (!slot) return;
      const w = Math.round(slot.getBoundingClientRect().width);
      if (!w) return;
      slot.innerHTML = '';
      const svg = roofSVG(w, ROOF_H);
      slot.appendChild(svg);

      /* 各行の実幅を測り、**その行がその高さで屋根の内法に収まるか**
         を全行について見る。いちばん厳しい行が引き上げ量を決める。

         ★幅は中身の幅を測ること。.rf-t などをブロックのままにすると
         親いっぱい（例：600px）が返り、引き上げ量がほぼ0になって
         文字が屋根の外に出る（前例）。CSS 側を inline-flex に
         してある。 */
      const rows = [];
      const t = ph.querySelector('.rf-t');
      const a = ph.querySelector('.rf-addr');
      const k = ph.querySelector('.rf-kind');
      [t, a, k].forEach(function (e) {
        if (!e) return;
        const r = e.getBoundingClientRect();
        rows.push({ w: r.width, h: r.height });
      });

      /* ★引き上げ量は「全行が収まる**最大**の値」を探す。
         上へ行くほど三角は狭いので、上げすぎると行が破風に被る。
         文字の塊の上端 y を上から順に下げていき、全行が内法に
         収まった最初の位置を採る（＝いちばん深く入る位置）。

         前版は初期値から減らす向きにしか探索せず、正しい値
         （より大きい引き上げ）に到達できなかった。 */
      const fits = function (top) {
        let y = top;
        for (let i = 0; i < rows.length; i++) {
          y += rows[i].h;                       /* 行の下端で判定 */
          if (svg._spanAt(y) < rows[i].w) return false;
        }
        return true;
      };
      let top = 0, lift = 0;
      for (; top <= svg._bottom; top += 2) {
        if (fits(top)) { lift = svg._bottom - top; break; }
      }

      /* ★文字の塊の**下端を屋根の下端にそろえる**。

         --rf-lift は .rf-under の負の margin-top なので
           文字の上端 = 屋根の下端 − lift
           文字の下端 = 文字の上端 + 塊の高さ uh
         下端を屋根の下端に一致させるには lift = uh。

         ここで min(lift, uh) を採ると、破風の逃げ（lift）のほうが
         小さいときに塊が屋根より下へはみ出し、屋根の下に文字が
         載らない帯が残る（＝間取り図との間に隙間が空く）。
         **合わせるべきは常に uh** で、破風に被るなら屋根を高くして
         解決する（下の ROOF_H の自動調整）。                     */
      const under = ph.querySelector('.rf-under');
      const uh = under ? under.getBoundingClientRect().height : 0;
      ph.style.setProperty('--rf-lift', Math.max(0, uh) + 'px');

      /* SVG の枠ではなく、軒天の下端と外壁の上端を接続する。
         敷地は間取り図の内部余白なので、文字との距離で制限しない。
         前回のマージンに依存しない寸法から求め、再描画でも安定させる。 */
      const eave = svg.querySelector('.r-noki').getBBox();
      const shadow = svg.querySelector('.r-sh').getBBox();
      const eaveBottom = Math.max(eave.y + eave.height, shadow.y + shadow.height);
      const roofInset = ROOF_H - eaveBottom;
      ph.style.setProperty('--rf-text-up', (roofInset + 8) + 'px');
      ph.style.setProperty('--rf-site', '0px');
      const prop = ph.closest('.prop');
      const plan = prop && prop.querySelector('.plan-stage svg.plan');
      if (plan) {
        const vb = plan.viewBox.baseVal;
        const pw = plan.getBoundingClientRect().width;
        if (vb.width && pw) {
          // 壁の中心線 y=0 ではなく、壁厚と輪郭線を含む最上端。
          const wallTop = Math.min(...Array.from(plan.querySelectorAll('.pl-w-line'), line =>
            Math.min(Number(line.getAttribute('y1')), Number(line.getAttribute('y2'))) -
            Number(line.getAttribute('stroke-width')) / 2));
          const site = (wallTop - vb.y) / vb.width * pw;
          ph.style.setProperty('--rf-site', (site + roofInset) + 'px');
        }
      }
    });
  }
  addEventListener('resize', drawRoofs);

  /* ── 一覧（上段）───────────────────────────────── */
  function shelf() {
    const list = S.all();
    return list.map(p => {
      const g = { risk: nowRows(p).filter(x => ['unknown', 'action'].includes(x.status)) };
      const k = KINDS[p.kind] || KINDS.other;
      const u = USES[p.use] || USES.self;
      return '<button class="shelf-card" data-go="p-' + p.id + '">' +
        '<span class="card-ic">' + (ICONS[k.icon] || ICONS.house) + '</span>' +
        '<b>' + esc(p.name) + '</b>' +
        '<span class="card-a">' + esc(p.addr) + '</span>' +
        '<span class="card-f"><span class="t-' + u.tone + '">' + esc(u.label) + '</span>' +
        (g.risk.length ? '<span class="card-r">要確認 ' + g.risk.length + '</span>' : '') +
        '</span></button>';
    }).join('');
  }

  /* ── 描画 ───────────────────────────────────────── */
  function draw_() {
    const list = S.all();
    document.getElementById('shelf').innerHTML = shelf();
    document.getElementById('cntShelf').textContent = list.length + '件';
    const host = document.getElementById('plans');

    host.innerHTML = '';
    list.forEach(p => {
      const sec = document.createElement('section');
      sec.className = 'prop';
      sec.dataset.p = p.id;
      sec.innerHTML = propHead(p);
      const stageDiv = document.createElement('div');
      stageDiv.className = 'plan-stage';
      sec.appendChild(stageDiv);
      const stack = document.createElement('div');
      stack.innerHTML = stackOf(p);
      sec.appendChild(stack.firstChild);
      host.appendChild(sec);
    });

    requestAnimationFrame(() => {
      list.forEach(p => {
        const sec = host.querySelector('[data-p="' + p.id + '"]');
        if (!sec) return;
        const stage = sec.querySelector('.plan-stage');
        const w = stage.getBoundingClientRect().width;
        if (!w) return;
        stage.innerHTML = '';
        stage.appendChild(planOf(p, w));
      });
      drawRoofs();
      wire();
    });
    wire();
  }

  function wire() {
    /* 開閉は表示中だけの状態。押したら間取りごと描き直す（部屋の深さは
       中身の実測で決まる）。押したボタンを同じ画面位置に留める。 */
    [['data-procedure', 'procedure', openProcedures], ['data-prior-open', 'priorOpen', openPrior]].forEach(([sel, attr, set]) =>
      document.querySelectorAll('[' + sel + ']').forEach(button => {
      button.onclick = () => {
        const key = button.dataset[attr];
        const before = button.getBoundingClientRect().top;
        if (set.has(key)) set.delete(key);
        else set.add(key);
        const section = button.closest('.prop');
        const p = S.find(section.dataset.p);
        const stage = section.querySelector('.plan-stage');
        const width = stage.getBoundingClientRect().width;
        if (width) stage.replaceChildren(planOf(p, width));
        section.querySelector('.stack').outerHTML = stackOf(p);
        drawRoofs();
        wire();
        /* 同じ行のボタンは間取りの部屋と狭い幅の一覧の2か所にある。見えているほうへ戻す。 */
        const current = Array.from(section.querySelectorAll('[' + sel + ']'))
          .find(el => el.dataset[attr] === key && el.getBoundingClientRect().width);
        if (current) {
          current.focus({ preventScroll: true });
          window.scrollBy(0, current.getBoundingClientRect().top - before);
        }
      };
    }));
    document.querySelectorAll('[data-go]').forEach(b => {
      b.onclick = () => {
        const el = document.getElementById(b.dataset.go);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
    /* 保存後は描き直すので、押した入口（同じ物件・同じ項目の、見えて
       いるほう）へフォーカスとスクロール位置を戻す。 */
    const edit = (trigger, id, type, key, same) => {
      const top = trigger.getBoundingClientRect().top;
      window.SeiZenRealEstateEditor.open(S.find(id), type, key, trigger, () => {
        draw_();
        requestAnimationFrame(() => {
          const match = Array.from(document.querySelectorAll(same)).find(el => el.getBoundingClientRect().width);
          if (match) { match.focus({ preventScroll: true }); window.scrollBy(0, match.getBoundingClientRect().top - top); }
          const toast = document.getElementById('toast');
          toast.textContent = '記録を保存しました'; toast.setAttribute('role', 'status'); toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 2600);
        });
      });
    };
    const attr = (k, v) => '[' + k + '="' + CSS.escape(v) + '"]';
    document.querySelectorAll('[data-edit-p]').forEach(button => {
      button.onclick = () => {
        const { editP: id, editType: type, editKey: key } = button.dataset;
        edit(button, id, type, key, attr('data-edit-p', id) + attr('data-edit-type', type) + attr('data-edit-key', key));
      };
    });
  }

  let resizeFrame;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(draw_);
  });
  draw_();
})();
