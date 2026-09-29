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
    /* 土地＝四角の区画と、角に立てた旗（2026-09-28）。家の絵が正面から見た平らな絵なので、
       地面も斜めのひし形にしない。旗を真ん中に立てると郵便受けに見えるので角に。 */
    land:  ic('<rect x="4" y="11" width="16" height="10" rx="1"/><path d="M4 11V3.5"/><path d="M4 3.5l6 2.6-6 2.6"/>'),
    other: ic('<path d="M4 20V9.5l8-5.5 8 5.5V20"/><path d="M4 20h16"/><path d="M9.5 20v-4.5h5V20"/>'),
    pin:   ic('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>'),
    matter: ic('<path d="M12 3.6 21 19.4H3Z"/><path d="M12 9.6v4.2M12 16.6h.01"/>'),
    /* 下段の部屋見出し。書類＝角を折った1枚、権利＝印のある証書、
       ローン・契約＝円貨。以前は roomHead が参照する名前がここに
       無く、見出しのアイコンが空の枠になっていた。 */
    doc:   ic('<path d="M6.5 3.5H14l4 4v12.4a.6.6 0 0 1-.6.6H6.5a.6.6 0 0 1-.6-.6V4.1a.6.6 0 0 1 .6-.6Z"/><path d="M14 3.5V8h4"/><path d="M9 12h6M9 15.5h6"/>'),
    right: ic('<path d="M5.5 3.5h13v17h-13Z"/><path d="M8.5 7.5h7M8.5 10.5h7M8.5 13.5h3.5"/><circle cx="15" cy="16.2" r="2"/>'),
    loan:  ic('<circle cx="12" cy="12" r="8.5"/><path d="M8.8 7.4 12 12l3.2-4.6M12 12v5.2M9.2 12.6h5.6M9.2 15h5.6"/>'),
    /* ローン・契約の「契約」の見出し。書類かばん（続いている相手との取り決め）。 */
    deal:  ic('<path d="M4 7.5h16v11H4Z"/><path d="M9 7.5V5.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.7"/><path d="M4 12h16"/>'),
  };
  const PEN = '<svg class="re-pen" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 13l.6-2.9L10.8 2.9a1.2 1.2 0 0 1 1.7 0l.6.6a1.2 1.2 0 0 1 0 1.7L5.9 12.4Z"/>' +
    '<path d="M9.6 4.1l2.3 2.3M3 13h10"/></svg>';

  /* ══════════════════════════════════════════════════════════
     ■ 今のうち／そのとき｜v28 からの移植（項目・文言・ロジック）
     ══════════════════════════════════════════════════════════ */

  /* ── 記録の単位に共通する2つの部品 ─────────────────
     部屋ごとに中身の形は変えるが、**入口と状態の位置だけは揃える**：
       ・状態バッジ … 単位の名前の直下（§11 の状態。値はバッジにしない）
       ・編集ボタン … 単位の頭の右端。枠線の小さなボタンで、色は常に同じ。
         急ぎかどうかはボタンではなくバッジが言う（以前は全カードに
         橙の大きなボタンが付き、面・状態・操作の3つを橙が兼ねていた）。
     カード全体を押せる形にはしない ―― 押せると見て分からず、
     本文を読んでいるだけで誤って開く。                              */
  const BADGE = Object.assign({ doing: { label: '確認中', tone: 'bl' } }, NOW_STATUS);
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

  /* 今のうち＝事情（境界・私道・建物の変更）と前の代の相続登記。
     権利・ローン・契約の確認は、以前ここにも行として出していたが、
     下段の部屋（権利関係・ローン・契約）に同じ事実と入口があり、
     二重表示になっていた。下段が持つ（2026-09-23）。
     状態・次にすることは、どの行も答えから出す（state.js の matterStatus）。 */
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
  /* ■ 境界・越境の取り決め（2026-09-24 作り直し）
     答え（決めたことがあるか、隣ごとの取り決め＝どの隣と・何を・書面か・内容）
     から組み立てる。取り決めは隣ごとに別（西隣とは塀の中心、北隣の枝が越境…）
     なので、隣1つを1件として持ち、図・説明・次にすることも隣ごとに出す。
     以前は1件にまとめていて、隣を複数選ぶと別々の取り決めが1枚の図に混ざった。
     答えの意味は state.js の boundaryStatus の注記を参照。

     行の組み方は前の代の相続登記と同じ（一文 → 図 → 次にすること →
     くわしく）。ただし図は前の代の「名義の図」（枠→矢印→枠）を写さない
     ―― あれは誰から誰へ移るかの図で、境界は「敷地のどの辺で、何が越えて
     いるか」という場所の話。図は横から見た断面図にする（boundarySection）。

     文で言い過ぎない：書面にすること自体は代が変わってもできる。言える
     のは、口頭の取り決めは登記にも図面にも残らないこと、隣の家も代替わり
     や売却で人が変わること（今のうち §3-6）。境界が曖昧なだけなら
     今のうちではない（家族が後から測量できる）。
     「売るとき」だけを言う。境界の確定が求められると調べてあるのは売却で、
     建て替えではない。

     書類があるときは、種類と図面の日付で言うことが変わる（設計 §7-1）：
       境界確認書 … 隣が署名している。売るとき、境界を確かめてあることを示せる
       測量図だけ … 隣が確かめたかは分からない（2005年3月以降の地積測量図は
                    隣の立会いを経ている）
       2005年3月以降の図面は境界点の座標が入り、境界標が無くなっても戻せる。
       現地に境界標が残っていれば、売るとき測り直さずに済むことがある。 */
  const openMatter = new Set();   // 事情の「くわしく」（物件 id:項目）
  /* 隣は玄関を出て見た向きで持つ（state.js の境界の注記）。 */
  const SIDE = { right: '右隣', left: '左隣', back: '裏の家' };
  const OVER_WHAT = { wall: '塀', footing: '塀の基礎', roof: 'ひさし', tree: '木の枝', pipe: '配管', other: 'もの' };
  /* 隣1件ぶんの読み取り。図（boundarySection）と説明（boundaryFigure）はこれを受ける。 */
  function entryCase(p, e, idx) {
    const sd = SIDE[e.side] ? e.side : '';
    const side = sd ? SIDE[sd] : '隣';
    const kinds = e.kinds || [];
    const line = kinds.includes('line');
    /* 目印が塀のとき、塀の持ち主（both 両家／ours 自宅／theirs 隣）。位置は持ち主から決まる：
       両家＝塀の中心が境界、自宅の塀＝隣側の面が境界、隣の塀＝自宅側の面が境界。 */
    const markWall = line && e.mark === 'wall';
    const owner = markWall ? (['ours', 'theirs'].includes(e.wallOwner) ? e.wallOwner : 'both') : '';
    /* 越境しているもの（隣1つに複数ありうる）。フォームで選べない組み合わせの古い記録は
       ここで読み替える：目印の塀と同じ塀の越境（地上）→ 出さない／両家の塀の基礎 →
       出さない／塀と基礎の両方 → 塀だけ（越えている塀は基礎も一緒に越えている）／
       目印の塀の基礎 → 持ち主は塀と同じ。 */
    const raw = kinds.includes('over') ? (e.overs || []).filter(o => OVER_WHAT[o.what]) : [];
    const wallOut = !markWall && raw.some(o => o.what === 'wall');
    const overs = raw.filter(o => !(o.what === 'wall' && markWall) && !(o.what === 'footing' && (owner === 'both' || wallOut)))
      .map(o => ({ what: o.what, owner: o.what === 'footing' && markWall ? owner : o.owner === 'theirs' ? 'theirs' : 'ours' }));
    const things = overs.map(o => OVER_WHAT[o.what]).filter(t => t !== 'もの');
    const what = [line ? '境界の位置' : '', kinds.includes('over') ? '越境している' + (things.length ? things.join('・') : 'もの') + 'の扱い' : '']
      .filter(Boolean).join('と、');
    return { b: e, idx, sides: sd ? [sd] : [], side, party: side + (e.who ? 'の' + e.who : ''),
      line, markWall, owner, overs, what };
  }
  /* 文末の語は分けない（「変わりま／す。」と、最後の行に「す。」だけが残った）。 */
  const nw = t => '<span class="nw">' + t + '</span>';
  /* 隣と境界を確かめて署名し合うのは、売るときだけではない（2026-09-24 調べ直し）：
     売る（確定測量）／相続した土地を分ける（分筆登記：隣接地の全員の立会い・署名）／
     隣が売る・分ける・建てる（こちらが立会い・署名を求められる。父の没後は家族が答える）。
     国庫帰属制度（境界が明らかでないと却下）は利用がまれなので、くわしくに置く。 */
  const BD_NEED = '土地を<b>売る</b>・分けるとき、隣が測量するときには、隣と境界を確かめて' + nw('<b>署名</b>し合います。');

  /* ══ 造形｜境界の断面図（横から見る）
     素材探しの記録は `prototype/assets/不動産-境界の図.RESEARCH.md`。
     専門家の説明図（三井住友トラスト不動産）の描き方に倣う：横から見た断面、
     縦の破線に「境界」、越境するものの断面、越境の矢印。一般の家族には真上からの
     配置図より読みやすい（前の版は配置図を自作して「雑」「分かりづらい」と言われた）。

     木は素材（`assets/tree-side.svg`＝Commons「Blue Silhouette - Tree」CC0）。
     塀・家のひさし・配管は矩形と直線で足り、実寸から引く（1単位＝0.1m）：
       塀   … ブロック 390×190mm・厚さ150・6段（1.14m）、基礎 幅450×深さ350。
              越境しているときは、厚み全体が境界の向こう
       ひさし … 軒高2.5m・外壁と境界0.3m・ひさしの出0.7m（境界を0.4m越える）・
              勾配4/10・引違い窓1.3×1.0m
       木   … 高さ3.0m・幹は境界から0.6m
       配管 … 排水管 φ100（太さ0.11m）。桝（300角・深さ0.68m）から深さ0.55mで
              境界の向こうへ。塀の基礎（底 0.36m）より下を通す ―― 同じ深さに
              置くと基礎の底の線に溶けて、配管に見えなかった。線1本では何か
              分からないので、太さのある管と蓋のある桝で描き、「配管」と字を置く
     左がこちら、右が隣。x=0 が境界、y=0 が地面。
     境界の位置を決めたときは、その目印（塀の中心・塀の面・境界標）も描く。
     塀の中心なら、塀は両家の共有と推定される（民法229条）。               */
  const TREE_D = "m 92.52969,1046.7674 c 10.9884,-0.6928 71.6241,-2.4465 84.4808,-2.4433 l 10.7283,0 2.0989,-4.2011 c 4.1286,-8.2639 8.2316,-23.4653 10.4409,-38.6837 1.4406,-9.92309 1.1832,-13.23899 -1.4519,-18.69799 -2.0109,-4.1659 -8.7768,-10.3667 -16.3346,-14.9704 -22.5696,-13.74781 -40.7255,-27.59311 -60.488,-46.12681 -5.3075,-4.9775 -7.4576,-6.5154 -12.7924,-9.1507 -9.8388,-4.86 -16.1925,-10.2253 -23.217,-19.6051 -1.1533,-1.5401 -1.4275,-1.6178 -3.7343,-1.0587 -1.3692,0.3319 -5.7104,0.6481 -9.6469,0.7027 -15.5864,0.216 -30.3664,-6.1233 -41.7466,-17.9055 -12.7052,-13.1539 -18.6354,-28.1627 -18.6165,-47.1165 0.014,-13.3839 2.821,-23.7179 9.4871,-34.9199 7.6486,-12.8529 21.7839,-23.9109 34.9101,-27.3099 2.0015,-0.5183 3.7759,-1.0792 3.9432,-1.2465 0.1673,-0.1672 -0.041,-2.4425 -0.4625,-5.0561 -1.1213,-6.9514 -0.4422,-17.3372 1.5885,-24.2896 5.5858,-19.1243 19.8501,-33.2967 38.5927,-38.3442 9.0821,-2.4457 23.4262,-1.72 32.147,1.6265 0.7309,0.2804 1.3023,-0.5716 2.3813,-3.5512 4.9387,-13.638 14.9414,-26.7866 26.3348,-34.617 28.3574,-19.4893 64.4171,-15.7929 88.5578,9.0778 l 4.4055,4.5387 3.9967,-0.9757 c 2.1981,-0.5366 7.2175,-1.1337 11.154,-1.3267 12.8569,-0.6305 25.1661,3.0672 36.0394,10.8262 l 4.056,2.8943 9.9823,0.093 c 7.94064,0.074 10.94897,0.3564 14.70838,1.3804 23.14728,6.3052 40.06103,25.8545 44.53987,51.4803 1.07689,6.1616 0.8716,17.1464 -0.43758,23.4128 l -0.72856,3.4869 4.26857,5.6238 c 15.98837,21.0645 20.29721,48.4561 11.676,74.2249 -6.25253,18.6888 -19.87656,34.5498 -36.88718,42.9439 -8.07909,3.9867 -18.37197,6.8148 -24.87953,6.836 -3.01453,0.01 -3.62273,0.2643 -6.53507,2.7352 -5.5338,4.6949 -16.373,10.8769 -22.505,12.8353 -1.3693,0.4373 -3.1898,1.2689 -4.0455,1.848 -0.8558,0.5791 -6.4572,3.8114 -12.4477,7.1826 -14.7717,8.3132 -29.8496,18.0081 -38.7452,24.9124 -10.5516,8.1897 -13.3817,17.9625 -11.7084,40.43171 2.1064,28.28389 6.4093,47.14739 12.9903,56.94809 l 2.2986,3.4231 23.3812,0.3939 c 27.1526,0.4575 73.59162,1.8183 73.96999,2.1675 0.14258,0.1316 -59.09279,0.1986 -131.63409,0.149 -72.5414,-0.05 -128.3925,-0.3111 -124.1137,-0.5809 z m 104.0913,-80.76259 c -0.087,-0.79941 -2.5026,-4.71951 -5.3681,-8.71131 -6.2746,-8.7409 -15.6753,-23.0074 -17.7885,-26.9955 -1.2676,-2.3924 -1.9105,-2.9579 -3.7344,-3.285 -5.7734,-1.0353 -14.2423,-4.2253 -21.9358,-8.2626 -1.4384,-0.7547 4.5085,15.9952 7.1831,20.232 3.8648,6.1222 22.0216,19.7908 35.8496,26.98781 4.1177,2.1432 6.0245,2.1545 5.7941,0.035 z m 4.9053,-15.44571 c 0.655,-0.7918 0.8541,-3.6809 0.8541,-12.3958 0,-6.2498 -0.1404,-11.5037 -0.312,-11.6753 -0.1716,-0.1717 -1.8347,0.083 -3.6959,0.5657 -1.8611,0.4827 -5.567,1.0598 -8.2354,1.2823 -5.6207,0.4688 -5.4848,0 -2.3732,8.1561 2.1713,5.6901 5.0328,10.1672 8.2684,12.9367 2.7937,2.3914 4.2097,2.6826 5.494,1.1303 z m 39.6918,-12.0063 c 3.1122,-1.5877 9.0467,-7.4697 12.6956,-12.5831 3.1671,-4.4383 6.9096,-11.9046 6.5332,-13.0338 -0.1296,-0.3889 -2.6049,-1.3886 -5.5005,-2.2214 -2.8957,-0.8327 -7.6094,-2.7787 -10.475,-4.3243 l -5.2103,-2.8102 -1.7286,1.6562 c -1.708,1.6363 -1.7332,1.7731 -2.1036,11.4025 -0.2061,5.3605 -0.4996,12.0382 -0.652,14.8394 -0.2407,4.4221 -0.1117,5.3033 0.9795,6.6906 1.5076,1.9166 2.3427,1.9754 5.4617,0.3841 z m -93.9222,-4.5435 c -1.7418,-3.7529 -4.9755,-14.0119 -4.9755,-15.7848 0,-0.6891 -1.5123,-0.864 -7.4686,-0.864 -4.1077,0 -7.4686,0.1742 -7.4686,0.3873 0,1.239 20.1434,20.1514 21.4632,20.1514 0.1402,0 -0.5576,-1.7505 -1.5505,-3.8899 z m 119.1402,-7.5683 c 4.3638,-2.9262 15.4751,-11.6228 15.1696,-11.873 -0.1004,-0.082 -3.3378,-0.3086 -7.1943,-0.503 l -7.0116,-0.3533 -3.1551,4.6756 c -3.4076,5.0498 -5.6374,9.5127 -5.1482,10.3042 0.7211,1.1668 3.5262,0.3067 7.3396,-2.2505 z";
  /* 図の枠は1つに揃える（描くものごとに高さを変えると、行ごとに大きさが跳ねる）。
     上は地上2.6m まで：ひさし（軒高2.1m）・庭木（2.4m）が収まり、屋根はその先で切れる。
     「境界」の字は地面の下の真ん中（自宅｜境界｜隣）。上に字の場所を取らない。 */
  /* o＝越境しているもの1つ（{ what, owner }）。無ければ境界の目印だけを描く。
     境界（目印）と越境は別々の図にする ―― 越境の図に目印の塀を重ねると、
     塀と木・ひさしが同じ場所に来て、何の図か読めなかった。越境の図に塀を描く
     のは、塀の基礎のときだけ（基礎は塀と一体）。越境が複数あるときも1つずつ。 */
  function boundarySection(p, c, o, k) {
    const b = c.b, what = o ? o.what : '', mine = o ? o.owner === 'ours' : true, sgn = mine ? 1 : -1;
    const own = x => mine ? x : -x;                       // 持ち主の側へ（こちら＝左で書く）
    const X0 = -30, X1 = 30, Y0 = -26, Y1 = 11;
    const uid = 'bd-' + p.id + '-' + c.idx + '-' + (k || 0);
    /* 色：図に色相を持ち込まない。橙は「今のうち・対応が必要」、緑は
       「そのとき」の面の色なので（shared/tokens.css）、地面・境界線・越境の
       矢印に使うと、どちらかの面の意味に読めてしまう。書面の有無は右の説明
       （印と字）が言うので、境界線の色で重ねて言わない。                  */
    const INK = '#6B6963', EDGE = '#7E7462';
    /* ブロック塀の断面。side＝塀がどちらの土地に立っているか：
         'both' 境界線の上（中心が境界）／'ours' こちらの土地／'theirs' 隣の土地。
       こちら側・隣側の違いは厚みではなく、誰の土地に立つ・誰の塀か。
       面が境界に揃う塀は、壁も基礎も持ち主の側に丸ごと置き、基礎は持ち主の
       側へだけ張り出す（境界をまたがせない）。越境している塀は、持ち主の
       側から境界を越えて相手の土地に立つ（cross）。塀の上に誰の塀かを書く。
       塀は図式の太さで描く。実寸（厚み15cm）では幅6mの図の中で位置が読めず、
       専門家の説明図と同じく誇張する。                                      */
    const tags = [];                                      // 図の中の字（反転させずに後で置く）
    /* 越えている量（基礎の張り出し・塀のはみ出し）は、実寸に近い比では表示幅
       220px の中で数px になり、斜線が読めなかった。越える部分が読める幅まで誇張する。 */
    const WT = 3.0, FT = 9.0, WH = 11.4;
    /* opt.cross … 境界をまたいで立ち、一部が相手の土地に出ている（越境している塀）。
                    出る幅 XC は厚みの半分近く（実際は数cmでも、図では読める幅にする）
       opt.foot  … 基礎を壁の真下に据える（逆T字）。基礎は壁より幅が広いので、塀の面を
                    境界に揃えて建てても、基礎の先が境界を越える ―― 基礎の越境の仕組み
       opt.quiet … 字を出さない                                                        */
    const XC = 1.4;
    const wall = (side, opt) => {
      opt = opt || {};
      let x0, fx;                                          // 壁の左の面・基礎の左端（左がこちら）
      if (opt.cross) x0 = side === 'ours' ? -WT + XC : -XC;
      else x0 = side === 'both' ? -WT / 2 : side === 'ours' ? -WT : 0;
      if (opt.cross || opt.foot || side === 'both') fx = x0 + WT / 2 - FT / 2;
      else fx = side === 'ours' ? -FT : 0;
      let joints = '';
      for (let i = 1; i < 6; i++) joints += '<path d="M' + x0 + ' ' + (-1 - i * 1.9) + 'h' + WT + '" stroke="#8C7B5C" stroke-width=".2"/>';
      const who = side === 'both' ? '両家の塀' : side === 'ours' ? p.name + 'の塀' : c.side + 'の塀';
      /* 字は塀の真上。共有の塀は線の上に来るので縁取りで線を抜く。
         塀の上に越境しているもの（木・ひさし）が来るときは字を出さない（quiet）。
         字が枝や矢印と重なる。塀が誰のものかは横の説明が言う。 */
      if (!opt.quiet) tags.push([x0 + WT / 2, -14, 'middle', who]);
      return '<rect x="' + fx + '" y="-1" width="' + FT + '" height="4.6" fill="#BDB4A2" stroke="' + EDGE + '" stroke-width=".25"/>' +
        '<rect x="' + x0 + '" y="' + (-1 - WH) + '" width="' + WT + '" height="' + WH + '" fill="#D6CBB3" stroke="' + EDGE + '" stroke-width=".3"/>' + joints;
    };
    /* 境界の目印（境界の位置を決めたとき）と、越境しているもの（ov）を分けて持つ。
       越境しているものは、境界の向こうに出た部分だけを斜線で重ねて示す。
       重ね順：木・ひさし（上空で越えるもの）は目印の塀より奥、地中・地面の
       ものは手前。目印の塀と上空のものが同じ図に来ると、塀の字は出さない。 */
    const over = !!o;
    const aloft = over && (what === 'roof' || what === 'tree');
    const quiet = [];                                     // 地面の刻みを置かない範囲（地中の字の下）
    let mk = '', back = '', ov = '', ay = 0, pin = '';
    /* 塀の字は出す（字が無いと、断面の細い柱が塀だと分からなかった）。 */
    if (c.markWall && !o) mk = wall(c.owner);
    /* 境界標は目印なので、越えている塀・基礎より手前に描く（奥だと基礎の下から覗くだけになる）。 */
    else if (c.line && b.mark === 'stake' && !o) pin = '<rect x="-.6" y="-.8" width="1.2" height="5" fill="#DAD4C7" stroke="' + EDGE + '" stroke-width=".25"/>';
    if (over) {
      if (what === 'wall') { ov = wall(mine ? 'ours' : 'theirs', { cross: true }); ay = -19.5; }
      else if (what === 'footing') {
        /* 塀の基礎が地中で越える：持ち主の塀は面を境界に揃えて立ち、壁の真下に据えた
           基礎の先が相手の土地へ入る（専門家の説明図と同じ場面）。基礎は1つの形の
           まま描き、境界の向こうの部分だけを斜線にする（別の箱を足すと、基礎が
           張り出しているようには見えなかった）。目印が塀でなければ塀も描く。 */
        mk += wall(mine ? 'ours' : 'theirs', { foot: true });
        const fx = (mine ? -WT : 0) + WT / 2 - FT / 2;
        ov = '<rect x="' + fx + '" y="-1" width="' + FT + '" height="4.6" fill="#BDB4A2" stroke="' + EDGE + '" stroke-width=".25"/>';
        /* 「基礎」と字を置く（地中の部分は形だけでは何か分からない）。越えた先の横。 */
        const lx = sgn * ((FT - WT) / 2 + .8);
        tags.push([lx, 3.3, mine ? 'start' : 'end', '基礎']);
        quiet.push(mine ? [lx - .5, lx + 8] : [lx - 8, lx + .5]);
        ay = -2.4;
      } else if (what === 'roof') {
        /* 同じ持ち主の塀が境界に立つときは、外壁を塀から離す（0.3m のままだと
           誇張した塀の厚みと接して、家と塀が一体に見える）。軒先の位置は変えない。 */
        const P = (x, y) => own(x) + ' ' + y, gh = -21, hx = -3, wx = -21;
        back = '<path d="M' + P(-35, 0) + 'L' + P(hx, 0) + 'L' + P(hx, gh) + 'L' + P(-35, gh) + 'Z" fill="#E7E0D1" stroke="#A3977E" stroke-width=".3"/>' +
          '<rect x="' + Math.min(own(wx), own(wx + 13)) + '" y="-16" width="13" height="9" fill="#FBFAF6" stroke="#A3977E" stroke-width=".25"/>' +
          '<path d="M' + P(wx + 6.5, -16) + 'V-7" stroke="#A3977E" stroke-width=".25"/>';
        ov = '<path d="M' + P(4, gh + .4) + 'L' + P(-35, gh + .4 - .4 * 39) + 'L' + P(-35, gh - 1.4 - .4 * 39) + 'L' + P(4, gh - 1.4) + 'Z" fill="#CFC7B2" stroke="#8C8779" stroke-width=".3"/>';
        ay = -19.5;                                        // 軒先の下（境界で -22）
      } else if (what === 'tree') {
        ov = '<path d="' + TREE_D + '" transform="translate(' + own(-5) + ' 0) scale(.06) translate(-205 -1047.36)" fill="#BFC6B4"/>';
        ay = -20;                                          // 枝張りの中ほど
      } else if (what === 'pipe') {
        ov = '<rect x="' + Math.min(own(-10.5), own(35)) + '" y="4.95" width="45.5" height="1.1" fill="#D5DBDA" stroke="#6F7C7D" stroke-width=".25"/>';
        mk += '<rect x="' + (own(-12) - 1.5) + '" y="0" width="3" height="6.8" fill="#FBFAF6" stroke="#6F7C7D" stroke-width=".3"/>' +
          '<rect x="' + (own(-12) - 1.9) + '" y="-.5" width="3.8" height=".7" fill="#C9CFCE" stroke="#6F7C7D" stroke-width=".25"/>';
        /* 字は桝の真上（地上）。地中は地面の刻みと管に挟まれて字が置けない。 */
        tags.push([own(-12), -1.6, 'middle', '配管']);
        ay = -2.4;
      } else {
        /* その他：地面に置いた箱。 */
        const top = -5;
        ov = '<rect x="' + (mine ? -1 : -5) + '" y="' + top + '" width="6" height="5" fill="#E6DFD2" stroke="' + EDGE + '" stroke-width=".3"/>';
        ay = top - 3;
      }
    }
    /* 越えた部分：同じ形を相手の土地の側だけに切り抜き、斜線で塗り直す。
       越えられた側に家を描き足さない ―― 図が重くなるだけで、言いたいのは
       「どこまで相手の土地に入っているか」。
       木は素材を .06 倍して置くので、斜線もその倍率を戻した柄（-ht）で塗る。 */
    const hit = ov ? '<g clip-path="url(#' + uid + '-in)">' +
      ov.replace(/fill="[^"]*"/g, 'fill="url(#' + uid + (what === 'tree' ? '-ht' : '-h') + ')"').replace(/stroke="[^"]*"/g, 'stroke="' + INK + '"') + '</g>' : '';
    const upper = aloft ? ov + hit : '', lower = aloft ? '' : ov + hit;
    const hatch = Array.from({ length: 12 }, (_, i) => X0 + 2 + i * 5)
      .filter(x => !quiet.some(([a, z]) => x > a && x - 1.6 < z))
      .map(x => '<path d="M' + x + ' .2l-1.6 1.6" stroke="#B3A994" stroke-width=".22"/>').join('');
    /* 矢印は、境界に立つ塀（厚み2.6・越境している塀は 0.8〜3.4）の外から始める。 */
    const x0 = sgn * 3.8, x1 = sgn * 8.5;
    const arrow = over ? '<path d="M' + x0 + ' ' + ay + 'H' + x1 + '" stroke="' + INK + '" stroke-width=".45"/>' +
      '<path d="M' + x1 + ' ' + (ay - 1.1) + 'L' + (x1 + sgn * 1.6) + ' ' + ay + 'L' + x1 + ' ' + (ay + 1.1) + 'Z" fill="' + INK + '"/>' : '';
    /* 左右は玄関を出て見たとおり：左隣は左、右隣・裏の家は右。図は「左が
       こちら・右が隣」で組み、左隣のときは左右を反転する。字は反転させず、
       位置だけ写す。                                                        */
    const flip = c.sides[0] === 'left';
    const fx = x => flip ? -x : x;
    const fa = a => !flip || a === 'middle' ? a : a === 'end' ? 'start' : 'end';
    const txt = (x, y, a, t, cls) => '<text x="' + fx(x) + '" y="' + y + '" text-anchor="' + fa(a) + '" class="' + (cls || 'bs-t') + '">' + esc(t) + '</text>';
    const label = '横から見た図。' + (o ? overText(p, c, o) : markText(p, c));
    const inX = mine ? 0 : X0;                             // 越えられた側（反転前の座標）
    return '<svg class="bd-sec" viewBox="' + X0 + ' ' + Y0 + ' ' + (X1 - X0) + ' ' + (Y1 - Y0) + '" role="img" aria-label="' + esc(label) + '">' +
      '<defs><clipPath id="' + uid + '"><rect x="' + X0 + '" y="' + Y0 + '" width="' + (X1 - X0) + '" height="' + (Y1 - Y0) + '"/></clipPath>' +
        '<clipPath id="' + uid + '-in"><rect x="' + inX + '" y="' + Y0 + '" width="' + X1 + '" height="' + (Y1 - Y0) + '"/></clipPath>' +
        '<pattern id="' + uid + '-h" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
          '<rect width="1" height="1" fill="#F4F2EC"/><path d="M0 .5H1" stroke="' + INK + '" stroke-width=".32"/></pattern>' +
        '<pattern id="' + uid + '-ht" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="scale(' + (1 / .06) + ') rotate(45)">' +
          '<rect width="1" height="1" fill="#F4F2EC"/><path d="M0 .5H1" stroke="' + INK + '" stroke-width=".32"/></pattern></defs>' +
      '<g clip-path="url(#' + uid + ')"><g' + (flip ? ' transform="scale(-1 1)"' : '') + '>' +
        /* 越えられた側の土地は、上の空間ごと淡く敷く（土地は上空・地下にも及ぶ）。
           家を描き足す代わりに、「ここから先は相手の土地」を面で見せる。 */
        (over ? '<rect x="' + inX + '" y="' + Y0 + '" width="' + X1 + '" height="' + (-Y0) + '" fill="#F3F0E8"/>' : '') +
        '<rect x="' + X0 + '" y="0" width="' + (X1 - X0) + '" height="' + Y1 + '" fill="#ECE8DF"/>' + back + upper +
        '<path d="M' + X0 + ' 0H' + X1 + '" stroke="#8C8472" stroke-width=".45"/>' + hatch +
        '<path d="M0 ' + Y0 + 'V6.6" stroke="' + INK + '" stroke-width=".5" stroke-dasharray="2 1.3"/>' + mk + lower + pin + arrow + '</g>' +
      tags.map(t => txt(t[0], t[1], t[2], t[3], 'bs-t bs-halo')).join('') +
      txt(X0 + 1.5, 9.4, 'start', p.name) +
      txt(0, 9.4, 'middle', '境界') +
      txt(X1 - 1.5, 9.4, 'end', c.side + (b.who ? ' ' + b.who : '')) + '</g></svg>';
  }
  /* 説明の字。「こちら／隣」とは書かず、物件の名前と隣の名前で言う
     （位置の「こちら側の面」と持ち主の「こちらのもの」が混ざって読みにくかった）。 */
  /* 境界の位置の言い方。「塀の自宅側の面」は分かりづらいと言われた。家族には、
     誰の塀が、どちらの土地に建っているかで言う（面が境界＝塀は丸ごと持ち主の土地）。 */
  function markText(p, c) {
    if (!c.line) return '';
    if (c.markWall) return c.owner === 'both' ? '塀は両家のもの。境界の上に建っている'
      : c.owner === 'ours' ? '塀は' + p.name + 'のもの。' + p.name + 'の土地に建っている' : '塀は' + c.side + 'のもの。' + c.side + 'の土地に建っている';
    return c.b.mark === 'stake' ? '境界標（杭・金属の鋲）の位置' : '決めてある（目印はない）';
  }
  function overText(p, c, o) {
    if (!o) return '';
    const from = o.owner === 'ours' ? p.name : c.side, to = o.owner === 'ours' ? c.side : p.name;
    return o.what === 'footing' ? from + 'の塀の基礎が、地中で' + to + 'の土地へ出ている'
      : from + 'の' + OVER_WHAT[o.what] + 'が、' + to + 'の土地へ出ている';
  }
  const bdPick = new Map();                 // 図に出している項目（物件 id:隣 → 項目の番号）
  /* 家1軒ぶん：図と、決めたことの一覧（境界・越境）→ その他。
     決めたことは1行ずつ「境界」「越境」の札をつけて並べ、図のある行が2つ以上
     あれば、その行が図の切り替えになる（押した行の図が枠に出る）。図は縦に
     積まない（行が図で埋まる）。ポップアップにもしない（開くまで図が見えない）。
     「〜との取り決め」の見出しと書面の一文は置かない ―― 誰の話かは上の家の札が、
     書面の状態は次にすること（書面にする／あるか聞く）と書類のありかが言う。
     一文・各家・次にすることで「口頭」を3回言っていた。 */
  function boundaryFigure(p, c) {
    const b = c.b, key = p.id + ':' + c.idx;
    const markFig = c.markWall || (c.line && b.mark === 'stake');
    const items = (c.line ? [{ tag: '境界', text: markText(p, c), fig: markFig ? boundarySection(p, c, null, 'm') : '' }] : [])
      .concat(c.overs.map((o, k) => ({ tag: '越境', text: overText(p, c, o), fig: boundarySection(p, c, o, k) })));
    const withFig = items.map((x, i) => x.fig ? i : -1).filter(i => i >= 0);
    const many = withFig.length > 1;
    const pick = withFig.includes(bdPick.get(key)) ? bdPick.get(key) : withFig[0];
    const figs = withFig.map(i => '<div class="bd-one"' + (many && i !== pick ? ' hidden' : '') + ' data-bd-fig="' + i + '">' + items[i].fig + '</div>').join('');
    const line = (x, i) => {
      const body = '<i>' + x.tag + '</i><span>' + esc(x.text) + '</span>';
      return many && x.fig
        ? '<button type="button" class="bd-item" data-bd-pick="' + esc(key) + '" data-bd-k="' + i + '" aria-pressed="' + (i === pick) + '"><b aria-hidden="true"></b>' + body + '</button>'
        : '<div class="bd-item">' + (many ? '<b aria-hidden="true" class="off"></b>' : '') + body + '</div>';
    };
    return '<div class="bd-fig">' + (figs ? '<div class="bd-figs">' + figs + '</div>' : '') + '<div class="bd-cap">' +
      '<div class="bd-items' + (many ? ' pick' : '') + '"' + (many ? ' role="group" aria-label="図に出すもの"' : '') + '>' +
        items.map(line).join('') +
        (b.content ? line({ tag: 'その他', text: b.content, fig: '' }, -1) : '') + '</div></div></div>';
  }
  /* 家ごとの取り決めは縦に積まない（3軒並べると、この行だけで画面2つ分になった）。
     上に家の札を並べ、選んだ1軒を出す。1軒だけのときは札の位置に「〜との境界」。
     家ごとに一覧の長さが違うので、切り替えたら間取りごと描き直す（wire）。 */
  const bdNb = new Map();                   // 出している家（物件 id → 番号）
  function boundaryNeighbors(p, es) {
    /* 見出しは中央に置き、左右に細い線を引く（1軒のときに名前だけを左に置くと、
       その右が丸ごと空いた）。1軒は「〜との境界」の札、2軒以上は家の切り替え。
       「〜と決めたこと」とは言わない ―― 一覧には越境という事実も並ぶ。 */
    const name = c => nbName(c, es.length);
    const head = inner => '<div class="bd-head">' + inner + '</div>';
    if (es.length === 1) return head('<span class="bd-seg"><span class="bd-tab solo">' + esc(es[0].party) + 'との境界</span></span>') + boundaryFigure(p, es[0]);
    const sel = Math.min(bdNb.get(p.id) || 0, es.length - 1);
    return head('<span class="bd-seg" role="tablist" aria-label="境界を見る家">' + es.map((c, i) =>
        '<button type="button" role="tab" class="bd-tab" data-bd-nb="' + esc(p.id + ':' + i) + '" aria-selected="' + (i === sel) + '">' + esc(name(c)) + '</button>').join('') +
      '</span>') + '<div role="tabpanel">' + boundaryFigure(p, es[sel]) + '</div>';
  }
  /* 隣1件の次にすること（口頭のまま・書面が分からないとき）。どの家の話かは文の頭に
     家の札（上の切り替えと同じ名前）で示すので、文には家の名前を入れない。 */
  function entryNext(c) {
    const e = c.b;
    if (!c.what) return '何を決めたか、' + WHO + 'に聞いて記録する';
    if (e.paper === 'no') return (c.what.startsWith('境界の位置') ? '決めた' : '') + c.what + 'を、書面（覚書）にする';
    return '決めたことを書いた覚書や境界確認書があるか、' + WHO + 'に聞く';
  }
  /* 家の名前（上の切り替えと次にすることの札で同じにする）。n＝家の数。 */
  const nbName = (c, n) => (c.b.side ? c.side : '隣' + (n > 1 ? c.idx + 1 : '')) + (c.b.who ? ' ' + c.b.who : '');
  /* くわしく。sections＝[見出し, 本文HTML] の並び。 */
  function boundaryDetail(p, sections, item) {
    const key = p.id + ':' + (item || 'boundary'), open = openMatter.has(key);
    const body = sections.map(([t, html], i) => '<section><h6><i>' + (i + 1) + '</i>' + t + '</h6><p>' + html + '</p></section>').join('');
    return '<div class="pr-dt' + (open ? ' open' : '') + '"><button type="button" class="pr-dt-t" data-matter-open="' + esc(key) +
      '" aria-expanded="' + open + '"><span class="pr-dt-k">くわしく</span><span class="pr-dt-s">' + sections.map(s => s[0]).join('・') + '</span>' + PG.down + '</button>' +
      (open ? '<div class="pr-dt-b">' + body + '</div>' : '') + '</div>';
  }
  /* 塀の中心を境界にしたとき。境界線上の囲障は相隣者の共有と推定され（民法229条）、
     共有の持分は等しいと推定される（250条）。直す費用は持分に応じて負担（253条）。 */
  const BD_SHARED = ['塀の持ち主と費用', '境界線の上にある塀は、両家の<b>共有</b>と推定されます（民法229条）。直す・建て替えるときの費用は、原則として両家で半分ずつです。覚書にするときは、塀の持ち主と費用の分け方も書いておきます。'];
  const BD_HEIRS = ['書面が効く相手', '覚書は、' + WHO + 'や隣が亡くなっても、それぞれの相続人に引き継がれます。ただ、どちらかが土地を<b>売る</b>と、買主には当然には引き継がれません。売るときは、覚書を引き継ぐことを売買契約に書きます。'];
  /* 書類があるときに言うこと。種類で一文を、図面の日付でくわしくを変える。
     d＝書類の種類（confirm／memo／map）、age＝図面の日付、shared＝塀の中心の取り決めがあるか。 */
  function boundaryDocs(p, d, age, deal, shared) {
    const why = [];
    if (d.includes('confirm')) why.push('境界確認書は、隣と境界の位置を確かめて、双方が署名した書面です。売るとき、境界を確かめてあることを買主に示せます。');
    else if (d.includes('map')) why.push('測量図だけでは、隣が境界を確かめたかは分かりません。' +
      (age === 'after' ? '2005年3月以降の地積測量図なら、隣の立会いを経て作られています。' : ''));
    if (d.includes('memo')) why.push('覚書は、' + WHO + 'や隣が亡くなっても、それぞれの相続人に引き継がれます。土地を<b>売る</b>ときは、買主に引き継ぐことを売買契約に書きます。');
    if (!why.length) why.push(deal === 'unknown' ? '境界確認書や測量図が見つかっています。' : '決めたことは書面にしてあります。');
    const sections = [];
    if (shared) sections.push(BD_SHARED);
    if (d.includes('confirm') || d.includes('map')) {
      sections.push(['売るときに効くこと', '図面の境界点に、今も境界標（杭・金属の鋲など）が残っていれば、売るときに測り直さずに済むことがあります。' +
        '無くなっていると、測り直しになりやすくなります。' + (d.includes('confirm') ? '隣の家が代替わりしていると、新しい所有者と確かめ直すことがあります。' : '')]);
      sections.push(['図面の日付', age === 'after'
        ? '2005年3月以降の図面は、境界点の座標が入っているので、境界標が無くなっていても元の位置に戻せます（土地家屋調査士に頼む）。'
        : age === 'before'
        ? '2005年3月より前の図面は、作られた時期で精度が違います。1977年9月以前のものは測った基準がはっきりしないことがあり、参考として扱われます。売るときは測り直すことがあります。'
        : '図面の作成日を見ておきます。2005年3月以降の図面は境界点の座標が入っていて、境界標が無くなっても元の位置に戻せます。それより前のものは、作られた時期で精度が違います。']);
    }
    /* 書類があるときは、次にすることを出さない。書類の場所は「書類のありか」の欄が
       持っている（境界・測量、越境の合意）。ここで「書類のありかに残す」と言うと、
       状態が済み（書面あり）なのに次にすることが出て、しかも画面の操作の指示になる。 */
    return { why: why.join(''), act: '', detail: sections.length ? boundaryDetail(p, sections) : '' };
  }
  /* 書類があるときは、用意できている書類を家ごとに書く（済んだ状態でも、何が
     あるのかは家族が知ることなので消さない）。場所は「書類のありか」の欄が持つ。 */
  const docName = kinds => { const d = (kinds || []).map(k => BD_DOC[k]).filter(Boolean); return d.length ? d.join('・') : '書面（種類は記録なし）'; };
  const BD_DOC = { confirm: '境界確認書', memo: '覚書', map: '測量図' };
  function docRows(es) { return es.filter(c => c.b.paper === 'yes').map(c => ({ nb: nbName(c, es.length), text: docName(c.b.docKinds) })); }
  function docsBlock(rows) {
    if (!rows.length) return '';
    return '<div class="pr-act bd-docs"><div class="pr-act-h"><span>用意できている書類</span></div>' +
      rows.map(r => '<p>' + (r.nb ? '<span class="bd-act-nb">' + esc(r.nb) + '</span>' : '') + esc(r.text) + '</p>').join('') + '</div>';
  }
  function boundaryBody(p) {
    const b = p.matters.boundary || {};
    const act = (text, sub) => '<div class="pr-act"><div class="pr-act-h"><span>次にすること</span></div><p>' + esc(text) +
      (sub ? '<small>' + esc(sub) + '</small>' : '') + '</p></div>';
    if (b.deal === 'no') return '<p class="pr-quiet">隣と、境界や越境について決めたことはありません。</p>';
    /* 父が覚えていなくても終わりにしない。境界確認書や測量図は、土地を
       買ったとき・家を建てたときに受け取っていることがあり、仕舞った場所
       は父に聞ける。探し尽くして無ければ、売るときに起きることを言って閉じる。 */
    if (b.deal === 'unknown') {
      if (b.paper === 'yes') { const x = boundaryDocs(p, b.docKinds || [], b.docAge, 'unknown', false); return '<p class="pr-why">' + x.why + '</p>' + docsBlock([{ nb: '', text: docName(b.docKinds) }]) + x.detail; }
      if (b.paper === 'no') return '<p class="pr-quiet">' + WHO + 'は隣と決めたことを覚えておらず、境界確認書や測量図も見つかりませんでした。' +
        '売るときは、隣と立ち会う測量（確定測量）から始めます。費用の目安は30〜80万円です。</p>';
      return '<p class="pr-why">' + BD_NEED + WHO + 'が覚えていなくても、境界確認書や測量図が残っていれば、それで境界を示せます。</p>' +
        act('土地を買ったとき・家を建てたときの書類から、境界確認書や測量図を探す',
          '保管場所は' + WHO + 'に確かめます。家になくても、法務局の地積測量図は家族でも取れます（無い土地もあります）。当時の不動産会社や、測量をした土地家屋調査士が写しを持っていることもあります。');
    }
    if (b.deal !== 'yes') return '<p class="pr-why">' + BD_NEED + '塀の位置や越境を隣と口頭で決めていても、そのことは登記にも図面にも残りません。' +
      '決めたことがあるかは、' + WHO + 'に聞かないと分かりません。</p>' +
      act(WHO + 'に、隣と境界や塀・越境について決めたことがあるか聞く', '隣ごとに聞きます。境界確認書や測量図が家にあれば、それも一緒に。');
    /* 決めたことがある：隣ごとに図と説明を並べる。 */
    const es = (b.entries || []).map((e, i) => entryCase(p, e, i));
    if (!es.length) return '<p class="pr-why">' + BD_NEED + '口頭の取り決めは、登記にも図面にも残りません。</p>' +
      act('どの隣と何を決めたか、' + WHO + 'に聞いて記録する', '');
    const figs = boundaryNeighbors(p, es);
    const shared = es.some(c => c.owner === 'both');
    if (es.every(c => c.b.paper === 'yes')) {
      const kinds = [...new Set([].concat(...es.map(c => c.b.docKinds || [])))];
      const ages = es.filter(c => (c.b.docKinds || []).some(k => k !== 'memo')).map(c => c.b.docAge || 'unknown');
      const age = ages.includes('before') ? 'before' : ages.length && ages.every(a => a === 'after') ? 'after' : 'unknown';
      const x = boundaryDocs(p, kinds, age, 'yes', shared);
      return '<p class="pr-why">' + x.why + '</p>' + figs + docsBlock(docRows(es)) + x.detail;
    }
    /* 次にすることは、口頭のまま・書面が分からない隣の数だけ。 */
    const todo = es.filter(c => c.b.paper !== 'yes');
    const nextHtml = '<div class="pr-act"><div class="pr-act-h"><span>次にすること</span></div>' +
      todo.map(c => '<p><span class="bd-act-nb">' + esc(nbName(c, es.length)) + '</span>' + esc(entryNext(c)) + '</p>').join('') +
      (es.some(c => c.b.paper === 'no') ? '<p class="pr-act-sub">土地家屋調査士に頼むと、測量図をつけて作れます。</p>' : '') + '</div>';
    /* 一文は「いつ要るか」と「書面にしておくと何が済むか」まで。書面が無いと困る、で
       止めると「だから書面にする」が答えられていなかった。「隣の家も人が変わる」
       「新しい持ち主は知らない」は、何も言っていないと言われて外した。 */
    return '<p class="pr-why">' + BD_NEED + '口頭で決めたことも、覚書にしておけば、そのとき見せて確かめるだけで' + nw('済みます。') + '</p>' +
      figs + nextHtml + docsBlock(docRows(es)) +
      boundaryDetail(p, [BD_HEIRS].concat(shared ? [BD_SHARED] : []).concat([['境界を確かめる場面', '<b>売る</b>ときは、隣と境界を確かめる測量（<b>確定測量</b>）を求められることが多く、隣の立会いと署名が要ります。費用の目安は、接するのが民有地だけなら30〜50万円、道路など公の土地にも接すると60〜80万円です。' +
        (es.some(c => c.overs.length) ? '越境しているものがあると、買主から、直す時期などを書いた覚書を求められます。' : '') +
        '相続した土地を相続人で<b>分ける</b>ときも（分筆登記）、隣接する土地の全員と立ち会い、境界確認書に署名をもらいます。' +
        '<b>隣が</b>売る・分ける・建てるときは、こちらが立会いと署名を求められます。' +
        '相続した土地を国に引き取ってもらう制度（相続土地国庫帰属制度）は、境界が明らかでない土地では申請できません。']]));
  }

  /* ■ 私道・通行・配管の取り決め（2026-09-24 作り直し。設計 §8）
     答え（相手の土地ごとの使い方・向き・持分・取り決め）から組み立てる。
     答えの意味は state.js の roadStatus の注記を参照。

     図は真上から見た区画図（rdFigure）。最初は「関係の事実だから文で足りる、
     位置を持たないので描けば作り話」として図を置かなかったが、行が答えの
     言い直しの羅列になった（2026-09-25 指摘）。事実の形は関係ではなく
     道筋 ―― 通り道も管も、道路（とその下の本管）へつなぐために他人の土地を
     通っている。持っている答え（前の私道／右隣／左隣／裏の家、向き）だけで
     「この家から道路まで、誰の土地を通るか」は描ける。法務省の共有私道
     ガイドラインも、私道と管は真上からの区画図で説明している。
     図の横の行は、答えを言い直さず、それが家族に何を意味するか（いつ・何を
     する）を書く。相手は1枚の図にまとめて描くので、相手の札は置かない。

     承諾書をもらうこと自体は今のうちではない（要るのは直す・建て替える・
     売るときで、相手はその時点の持ち主）。文は「承諾書を求められることが
     ある」まで。「承諾が無いと工事できない」とは言わない（民法213条の2）。 */
  const RD_LAND = { road: '前の私道', right: '右隣', left: '左隣', back: '裏の家', other: 'ほかの土地' };
  const RD_PIPE = { water: '水道', sewer: '下水', gas: 'ガス' };
  const rdName = l => l.land === 'other' ? (l.who || 'ほかの土地') : RD_LAND[l.land] + (l.who ? ' ' + l.who : '');
  /* 相手の呼び方（文の中で）。 */
  const rdOwner = l => l.land === 'road' ? '私道の持ち主' : l.land === 'other' ? (l.who || 'ほかの土地の持ち主') : RD_LAND[l.land];
  const RD_NEED = '水道・下水・ガスの管を<b>直す</b>・建て替える・<b>売る</b>ときには、管や道が通る土地の持ち主の<b>承諾書</b>を求められることがあります。';

  /* ══ 造形｜区画図（真上から）
     描き方は法務省「共有私道ガイドライン（第2版）」の概略図（事例11・19）に倣う：
     公道は図の一辺の帯で、その下に本管。私道は公道から直角に入る通路で、両側に
     宅地が並ぶ（向かいの家も描く）。主役の私道は太い枠で囲む。宅地は四角と名前
     だけで、建物は描かない。管は宅地から私道の下を通って本管へ。
     前の版は、私道を図の上の細い帯・公道を右端の縦長の帯にし、関わる区画だけを
     描いたので、片側に寄って隙間だらけになった（2026-09-25「バランス悪い」）。
     枠は境界の断面図と同じ横長（幅220px）で、右に短い説明を置く（行の中での
     置かれ方を境界に揃える。描く中身は写さない）。区画の奥行きは実寸（15m）でなく
     枠に合わせて縮める ―― 見せるのは大きさではなく、どの土地を通るか。間口10m・
     道の幅4mは実寸から（1単位＝0.1m）。
     向きは玄関を出て前の道を向いた向き（前の道が上、右隣が右）。
     「ほかの土地」は位置を持たないので描かない（説明の文だけ）。

     図には全部の相手の線をいつも描き、上の札で選んだ相手の線と区画を濃く、ほかを
     薄くする（sel＝選んだ相手の番号）。区画図は1枚に全部が載るのが利点で、どこの
     話かが見えたまま1件に目が行く。説明は選んだ相手のぶんだけ（境界と同じ）。

     線の筋は決まりで割り当てる（相手ごとの決め打ちだと、相手が2つ以上で同じ所を
     取り合い、矢印が重なり線が字を横切った）：
       自宅の中を縦に通る相手の線 … 左の筋（x 104・111）と右の筋（189・196）。
                                       左隣は左、右隣は右、裏の家は空いている方
                                       （両方ふさがっていれば内側 118・125 にし、
                                       自宅と裏の家の名前を右へ寄せる）
       隣の区画の中の線 … 自宅寄りを通し、名前は区画の外寄りに置く
       裏の家へ下りる自宅の線 … 裏の家の名前の右（176・183） */
  function rdFigure(p, ls, sel) {
    const on = land => ls.find(l => l.land === land);
    const road = on('road'), back = on('back');
    if (!ls.some(l => l.land !== 'other')) return '';
    const cur = ls[sel] || {};
    const INK = '#6B6963', LINE = '#BDB5A6', LOT = '#FAF8F4', uid = 'rd' + p.id;
    const txt = (x, y, t, cls) => '<text x="' + x + '" y="' + y + '" text-anchor="middle" class="rd-t' + (cls ? ' ' + cls : '') + '">' + esc(t) + '</text>';
    const rect = (x, y, w, h, fill, stroke, sw) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"' +
      (stroke ? ' stroke="' + stroke + '" stroke-width="' + (sw || 1) + '"' : '') + '/>';
    /* 列：向かいの家（私道のときだけ）→ 前の道 → 自宅の列 → 裏の列（裏の家が関わるときだけ）。 */
    const F = road ? 56 : 0, RY = F, RH = 40, HY = RY + RH;
    const HH = back ? 90 : road ? 120 : 140, BY = HY + HH, BH = back ? 56 : 0, H = BY + BH;
    const W = 300, VW = road ? 356 : W;
    const mid = y => HY + HH * y;
    /* 自宅の中の縦の筋。 */
    const lanes = { left: [104, 111], right: [189, 196] };
    const backLane = !on('left') ? [104, 111] : !on('right') ? [189, 196] : [118, 125];
    /* 内側の筋を使うときは、自宅と裏の家の名前を右へ寄せる（筋が名前を横切らないように）。 */
    const inner = backLane[0] === 118 && back && (back.uses || []).some(u => u.by === 'theirs');
    const homeX = inner ? 160 : 150;
    let s = '';
    /* 前の道と本管。私道なら、公道（右の一辺）の下に本管。私道の太枠は、私道を選んでいるときだけ濃く。 */
    if (road) {
      s += rect(W, 0, 56, H, '#E4E0D7') + '<path d="M344 0V' + H + '" stroke="#A39B8A" stroke-width="7"/><path d="M344 0V' + H + '" stroke="#E4E0D7" stroke-width="3"/>' +
        txt(322, 18, '公道', 'road') + txt(322, H - 8, '本管', 'road');
      [0, 100, 200].forEach(x => { s += rect(x, 0, 100, F, LOT, LINE); });
      s += txt(150, F / 2 + 6, '向かいの家', 'off') + rect(0, RY, W, RH, '#ECE8DF', cur.land === 'road' ? INK : LINE, cur.land === 'road' ? 2 : 1.2) +
        txt(52, RY + 26, '前の私道', cur.land === 'road' ? '' : 'road');
    } else {
      s += rect(0, RY, W, RH, '#ECE8DF') + '<path d="M0 ' + (RY + 11) + 'H' + W + '" stroke="#A39B8A" stroke-width="7"/><path d="M0 ' + (RY + 11) + 'H' + W + '" stroke="#ECE8DF" stroke-width="3"/>' +
        txt(40, RY + 33, '前の道', 'road') + txt(262, RY + 33, '本管', 'road');
    }
    /* 区画。選んだ相手は枠を濃く・名前を濃く、ほかに関わる相手は中くらい、関わらない区画は薄く。 */
    const nbLot = (x, y, h, land, name, lx) => { const l = on(land), me = cur.land === land;
      return rect(x, y, 100, h, LOT, me ? INK : LINE, me ? 1.6 : 1) +
        txt(lx, y + h / 2 + (l && l.who ? -2 : 6), name, me ? 'me' : l ? 'dim' : 'off') + (l && l.who ? txt(lx, y + h / 2 + 17, l.who, 'sub') : ''); };
    s += nbLot(0, HY, HH, 'left', '左隣', 36) + nbLot(200, HY, HH, 'right', '右隣', 264) +
      rect(100, HY, 100, HH, '#EFEBE2', INK, 1.4) + txt(homeX, HY + HH / 2 + 6, p.name, 'home');
    if (back) s += rect(0, BY, 100, BH, LOT, LINE) + rect(200, BY, 100, BH, LOT, LINE) + nbLot(100, BY, BH, 'back', '裏の家', inner ? 162 : 146);
    /* 道筋。通り道＝破線と矢印、管＝太さのある管。この家の管は本管まで、相手の管は前の道まで。 */
    const pass = d => '<path d="' + d + '" fill="none" stroke="' + INK + '" stroke-width="1.8" stroke-dasharray="6 4" marker-end="url(#' + uid + 'a)"/>';
    const pipe = d => '<path d="' + d + '" fill="none" stroke="' + INK + '" stroke-width="6" stroke-linejoin="round"/>' +
      '<path d="' + d + '" fill="none" stroke="#fff" stroke-width="2.8" stroke-linejoin="round"/>';
    const PASS_END = RY + RH - 8;
    const toMain = road ? 'V' + (RY + 26) + 'H344' : 'V' + (RY + 11);
    const toRoad = road ? 'V' + (RY + 26) : 'V' + (RY + 11);
    const [lp, lq] = lanes.left, [rp, rq] = lanes.right, [bp, bq] = backLane;
    const R = {
      road:  { ours: ['M140 ' + (HY + 16) + 'V' + (RY + 13) + 'H' + (W + 12), 'M160 ' + (HY + 16) + toMain] },
      right: { ours: ['M184 ' + mid(.3) + 'H216V' + PASS_END, 'M184 ' + mid(.44) + 'H226' + toMain],
               theirs: ['M240 ' + mid(.8) + 'H' + rp + 'V' + PASS_END, 'M246 ' + mid(.92) + 'H' + rq + toRoad] },
      left:  { ours: ['M116 ' + mid(.3) + 'H84V' + PASS_END, 'M116 ' + mid(.44) + 'H74' + toMain],
               theirs: ['M60 ' + mid(.8) + 'H' + lq + 'V' + PASS_END, 'M54 ' + mid(.92) + 'H' + lp + toRoad] },
      back:  { ours: ['M176 ' + (BY - 12) + 'V' + (H - 4), 'M183 ' + (BY - 12) + 'V' + (H - 2)],
               theirs: ['M' + bp + ' ' + (H - 6) + 'V' + PASS_END, 'M' + bq + ' ' + (H - 4) + toRoad] }
    };
    const draw = l => { const us = l.uses || [], r = R[l.land]; let g = '';
      if (!r) return g;
      ['ours', 'theirs'].forEach(by => { const pair = r[by]; if (!pair) return;
        if (us.some(u => u.what !== 'pass' && u.by === by)) g += pipe(pair[1]);
        if (us.some(u => u.what === 'pass' && u.by === by)) g += pass(pair[0]); });
      return g; };
    /* 選んでいない相手の線を先に薄く描き、選んだ相手の線を上に重ねる。 */
    s += ls.map((l, i) => i === sel ? '' : '<g class="rd-r off">' + draw(l) + '</g>').join('') + '<g class="rd-r">' + draw(cur) + '</g>';
    return '<div class="rd-figs"><svg class="rd-plan" viewBox="0 0 ' + VW + ' ' + H + '" xmlns="' + NS + '" role="img" aria-label="' + esc(p.name + 'と、通り道・管が通る土地の図') + '">' +
      '<defs><marker id="' + uid + 'a" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1L7 4L1 7" fill="none" stroke="' + INK + '" stroke-width="1.4"/></marker></defs>' +
      s + '</svg></div>';
  }
  /* 図の右の説明。選んだ相手のぶんだけ、図に描いたことを短い言葉で言う（境界の説明と
     同じ役割）。札に線の見本を付けて凡例を兼ねる。いつ何をするかは、くわしくに場面ごと。 */
  const RD_G = { pass: '<em class="rd-g ps"></em>', pipe: '<em class="rd-g pp"></em>' };
  function rdFacts(p, l) {
    const P = p.name, out = [], us = l.uses || [], O = rdOwner(l);
    const place = l.land === 'road' ? '前の私道' : l.land === 'other' ? (l.who ? l.who + 'の土地' : 'ほかの人の土地') : RD_LAND[l.land] + 'の土地';
    const pipes = by => us.filter(u => u.by === by && RD_PIPE[u.what]).map(u => RD_PIPE[u.what]).join('・');
    if (us.some(u => u.what === 'pass' && u.by === 'ours')) out.push({ g: 'pass', tag: '通る', text: place + 'を通って' + (l.land === 'road' ? '公道' : '道') + 'へ出る' });
    if (pipes('ours')) out.push({ g: 'pipe', tag: '管', text: pipes('ours') + 'の管が、' + place + 'の下を通' + (l.land === 'road' ? 'って本管へ' : 'る') });
    if (us.some(u => u.what === 'pass' && u.by === 'theirs')) out.push({ g: 'pass', tag: '通る', text: O + 'の人が、' + P + 'の土地を通って道へ出る' });
    if (pipes('theirs')) out.push({ g: 'pipe', tag: '管', text: O + 'の' + pipes('theirs') + 'の管が、' + P + 'の土地の下を通る' });
    if (l.land === 'road') out.push({ tag: '持分', text: l.share === 'yes' ? P + 'も持分を持っている' : l.share === 'no' ? '持分はない（' + (l.who || 'ほかの家') + 'のもの）' : '持分があるかは、まだ確かめていない' });
    if (l.content) out.push({ tag: '決めた', text: l.content });
    return '<div class="bd-cap"><div class="bd-items">' + out.map(x =>
      '<div class="bd-item"><i>' + (x.g ? RD_G[x.g] : '') + esc(x.tag) + '</i><span>' + esc(x.text) + '</span></div>').join('') + '</div></div>';
  }
  /* 相手の札は境界の家の札と同じ形（図の上の中央、左右に細い線）。1件なら切り替えのない見出し。
     札を押したら間取りごと描き直す（説明の長さで部屋の高さが変わる。wire）。 */
  const rdNb = new Map();                   // 選んでいる相手（物件 id → 番号）
  function roadLinks(p, ls) {
    const head = inner => '<div class="bd-head">' + inner + '</div>';
    const sel = Math.min(rdNb.get(p.id) || 0, ls.length - 1);
    const body = '<div class="bd-fig rd-fig">' + rdFigure(p, ls, sel) + rdFacts(p, ls[sel]) + '</div>';
    if (ls.length === 1) return head('<span class="bd-seg"><span class="bd-tab solo">' + esc(rdName(ls[0])) + '</span></span>') + body;
    return head('<span class="bd-seg" role="tablist" aria-label="見る相手">' + ls.map((l, i) =>
        '<button type="button" role="tab" class="bd-tab" data-rd-nb="' + esc(p.id + ':' + i) + '" aria-selected="' + (i === sel) + '">' + esc(rdName(l)) + '</button>').join('') +
      '</span>') + '<div role="tabpanel">' + body + '</div>';
  }
  /* 口頭・分からない相手の次にすること（文と補足）。何を決めたかが空なら、書面に
     する前に、まず何を決めたかを聞く。書面の形は相手で変わる：私道で持分があれば
     持ち主どうしの取り決め、この家が使う側なら相手の承諾書、相手も使うなら覚書。 */
  function rdNext(l) {
    if (l.pact === 'unknown') return { text: '決めたことを書いた承諾書や覚書があるか、' + WHO + 'に聞く', sub: '' };
    if (!l.content) return { text: '口頭で何を決めたか、' + WHO + 'に聞いて記録する', sub: '記録したら、相手と書面にします。' };
    const clause = '「持ち主が変わっても引き継ぐ」と書いてもらいます。';
    if (l.land === 'road') return l.share === 'yes'
      ? { text: '決めたことを、私道の持ち主どうしで書面にする', sub: '持ち主全員で署名します。' }
      : { text: '決めたことを、私道の持ち主と書面にする', sub: '通る・管を通すことの承諾なら、' + clause };
    return (l.uses || []).some(u => u.by === 'theirs')
      ? { text: '決めたことを、' + rdOwner(l) + 'と覚書にする', sub: '' }
      : { text: '口頭の承諾を、' + rdOwner(l) + 'に承諾書にしてもらう', sub: clause };
  }
  /* くわしく。場面ごと（管を直すとき／売るとき／相手が変わったとき）に、答えの
     組み合わせで文を決める（設計 §8-3 の表）。欄ごとの決まり文句を並べない ――
     持分があるのに「私道の持ち主へ知らせる」と書いて食い違った。
       私道・持分あり … 自分の管は持分の範囲で私道の下に置ける（ガイドライン 事例11）。
                        効くのは工事の窓口の運用（下水道は約7割が持ち主全員の同意書）
       私道・持分なし … 管は知らせれば足りる（民法213条の2）。売るとき通行・掘削承諾書
       私道・持分不明 … どちらになるかは持分で決まる（登記で分かる） */
  const RD_WINDOW = { water: '水道局', sewer: '下水道の窓口', gas: 'ガス会社' };
  function roadDetail(p, ls) {
    const P = p.name, pipeFix = [], sell = [];
    ls.forEach(l => {
      const us = l.uses || [], O = rdOwner(l), paper = l.pact === 'paper', road = l.land === 'road';
      const mine = us.filter(u => u.by === 'ours' && RD_PIPE[u.what]).map(u => u.what);
      const passOurs = us.some(u => u.what === 'pass' && u.by === 'ours');
      const place = road ? '前の私道' : l.land === 'other' ? (l.who ? l.who + 'の土地' : 'ほかの人の土地') : RD_LAND[l.land] + 'の土地';
      /* 窓口が求める書面。下水（私道）は持ち主全員の同意書、それ以外は承諾書。混ぜて言わない。 */
      const ask = who => {
        const all = road && mine.includes('sewer'), rest = all ? mine.filter(k => k !== 'sewer') : mine;
        return (all ? '下水は、工事のとき下水道の窓口から、' + who + '全員の同意書を求められることが多いです（窓口の約7割）。' : '') +
          (rest.length ? rest.map(k => RD_PIPE[k]).join('・') + 'は、' + rest.map(k => RD_WINDOW[k]).join('・') + 'から' + who + 'の承諾書を求められることがあります。' : '');
      };
      if (mine.length) pipeFix.push(paper ? place + 'の下の管は、承諾書があるので、工事の窓口に見せます。'
        : road && l.share === 'yes' ? place + 'の下の管は、持分があるので置けます。ただ、' + ask('ほかの持ち主')
        : road && l.share === 'no' ? place + 'の下の管を直すときは、先に私道の持ち主へ知らせます。' + ask('私道の持ち主')
        : road ? place + 'の下の管のうち、' + ask('私道の持ち主')
        : place + 'の下の管を直すときは、先に' + O + 'へ知らせます。' + ask(O));
      if (passOurs && !paper && road && l.share === 'no') sell.push('私道の持分がないので、買主の金融機関から、私道の持ち主の通行・掘削承諾書を求められます。無いと、ローンが通らないことがあります。');
      else if (passOurs && !paper && road && l.share !== 'yes') sell.push('私道の持分がなければ、買主の金融機関から、私道の持ち主の通行・掘削承諾書を求められます。持分は登記事項証明書で分かります。');
      else if (passOurs && !paper && !road) sell.push('買主の金融機関から、' + O + 'の通行承諾書を求められることがあります。');
      else if (passOurs && paper) sell.push(O + 'の承諾書を、買主に見せます。');
      if (us.some(u => u.by === 'theirs')) sell.push(O + 'の' + (us.some(u => u.by === 'theirs' && u.what !== 'pass') ? '管' : '通り道') + 'が' + P + 'の土地にあることを、買主に伝えて契約に書きます。伝えずに売ると、後から責任を問われることがあります。' +
        (us.some(u => u.by === 'theirs' && u.what !== 'pass') ? '建て替えで掘る前にも、' + O + 'と話します。' : ''));
    });
    const sections = [];
    if (pipeFix.length) sections.push(['管を直すとき', pipeFix.join('') + '法律では、ほかの土地に管を通すしかないときは、前もって知らせれば足ります（民法213条の2、2023年4月から）。承諾料に応じる義務はありません。']);
    if (sell.length) sections.push(['売るとき', sell.join('')]);
    if (ls.some(l => ['oral', 'paper'].includes(l.pact))) sections.push(['相手が変わったとき', '決めたことは、相手の家の相続人に引き継がれます。相手が土地を<b>売る</b>と、買主には当然には及びません。' +
      '承諾書に「持ち主が変わっても引き継ぐ」と書いてあれば、買主にも効きます。道として見えている通り道は、書面がなくても、買主に通ることを主張できることが多いです（最高裁 平成10年）。']);
    return sections.length ? boundaryDetail(p, sections, 'road') : '';
  }
  function roadBody(p) {
    const r = p.matters.road || {};
    const act = (text, sub) => '<div class="pr-act"><div class="pr-act-h"><span>次にすること</span></div><p>' + esc(text) +
      (sub ? '<small>' + esc(sub) + '</small>' : '') + '</p></div>';
    if (r.has === 'no') return '<p class="pr-quiet">' + p.name + 'が他人の土地を通る・管を通すことも、他人が' + p.name + 'の土地を使うこともありません。</p>';
    /* 父が覚えていなくても終わりにしない。この家の管の経路は、家族も図面で見られる。
       見られないもの（他人の管）と、図面に無い古い管がどうなるかまで言って閉じる。 */
    if (r.has === 'unknown') return '<p class="pr-why">' + RD_NEED + WHO + 'が覚えていなくても、この家の管がどこを通っているかは、図面で確かめられます。</p>' +
      act('水道局で給水装置の図面を、市役所で排水設備の図面を見て、この家の管がどこを通っているか確かめる',
        '水道の使用者・土地の所有者なら見られます（家族は委任状で）。古い管は図面に無いことがあり、そのときは管を直す・建て替えるときに掘って分かります。他人の管がこの家の土地を通っているかは、図面では分かりません。');
    if (r.has !== 'yes') return '<p class="pr-why">' + RD_NEED + '他人の管が' + p.name + 'の土地の下を通っていても、地面の上からは見えず、' + nw('登記にも出ません。') + '</p>' +
      act(WHO + 'に、他人の土地とのあいだを通る道や管があるか、両方の向きで聞く',
        p.name + 'が他人の土地を通る・管を通している場合と、他人の通り道や管が' + p.name + 'の土地にある場合。前の道が私道かは、役所の道路の窓口で家族も調べられます。');
    const ls = r.links || [];
    if (!ls.length) return '<p class="pr-why">' + RD_NEED + '</p>' + act('どの土地を何に使っているか、' + WHO + 'に聞いて記録する', '');
    const todo = ls.filter(l => l.pact === 'oral' || l.pact === 'unknown');
    const paper = ls.filter(l => l.pact === 'paper');
    const why = todo.length ? RD_NEED + '口頭で決めたことも、書面にしておけば、そのとき見せるだけで' + nw('済みます。')
      : paper.length === ls.length ? '決めたことは書面にしてあります。'
      : RD_NEED + 'そのときは、その時点の持ち主に頼みます（持ち主は' + nw('登記で分かります）。');
    const nextHtml = todo.length ? '<div class="pr-act"><div class="pr-act-h"><span>次にすること</span></div>' +
      todo.map(l => { const n = rdNext(l); return '<p><span class="bd-act-nb">' + esc(rdName(l)) + '</span>' + esc(n.text) + (n.sub ? '<small>' + esc(n.sub) + '</small>' : '') + '</p>'; }).join('') + '</div>' : '';
    const docs = docsBlock(paper.map(l => ({ nb: rdName(l), text: '承諾書・覚書' })));
    return '<p class="pr-why">' + why + '</p>' + roadLinks(p, ls) + nextHtml + docs + roadDetail(p, ls);
  }

  /* ■ 建物の変更・登記（2026-09-26。設計 §9。見本 `_検討/建物の変更_表示v3.html`）
     答え（変更ごとの 何を・どこ・いつ・登記・課税明細書・工事の書類・請け負った会社）から
     組み立てる。答えの意味と今のうちの線は state.js の changedStatus の注記を参照。
     行の組み方は境界・私道と同じ（一文 → 図＋右に短い説明 → 次にすること → くわしく）。
     相手の札は置かない ―― 1枚の図に全部の変更が載り、説明は変更1件で2〜3行に収まる。
     文は答えの組み合わせごとに決める（欄ごとの決まり文句を並べない）：
       課税されている → 固定資産評価証明書も所有を示す書類に使える
       課税もされておらず書類も無い → 増築したことを示すものは父の記憶だけ
       書類が1種類だけ → もう1種類（請け負った会社の工事完了引渡証明書など）
     言い方はフォームの「この変更の記録」と揃える（載っている／載っていない、取り壊しは
     消えている／残っている）。 */
  const KIND = { confirm: '確認済証', inspect: '検査済証', contract: '工事請負契約書', receipt: '領収書', handover: '工事完了引渡証明書' };
  const circled = i => '①②③④⑤⑥'.charAt(i) || String(i + 1);
  /* 別棟・取り壊した建物の名前。 */
  const BLDG = { hanare: '離れ', garage: '車庫', shed: '物置' };
  const bname = c => BLDG[c.bldg] || c.where || (c.what === 'annex' ? '別棟' : '建物');
  /* 変更の見出し（名詞で）。例：2015年ごろの増築（北側に約6畳）／2019年ごろに建てた車庫 */
  function desc(c) {
    const t = c.when ? c.when + '年ごろ' : '';
    if (c.what === 'ext') return (t ? t + 'の' : '') + '増築' + (c.where ? '（' + c.where + '）' : '');
    return (t ? t + 'に' : '') + (c.what === 'annex' ? '建てた' + bname(c) : '取り壊した' + (c.what === 'cut' ? c.where || '建物の一部' : bname(c)));
  }
  /* ══ 図｜今の家と、登記の形を重ねる（v3）
     v2 は登記の形を実線の四角にして、その外に変更の箱を付けたので、どの変更も「四角に
     足した」に見えた（2026-09-25）。変更は、家の形が変わったのに登記の形が前のまま、と
     いうこと。形を2つ重ねる：
       今の家   … 地の色と実線。増えれば出っ張り、減れば欠ける一続きの外形（本体と箱に分けない）
       登記の形 … 今の家の線の後ろに敷く灰色の太い線。同じところは縁取りに見え、違うところ
                   だけ別の道を通る
     違いの面：登記に載っていない部分＝斜線（登記をまだ確かめていない部分は薄い斜線）、取り壊したが登記に残る部分＝灰色の線の中の白抜き。
     参考は法務局の各階平面図（壁芯を実線、階ごと、上の階は1階の位置を点線：不動産登記規則83条）。
     描き込みすぎない：部屋・大きさ・時期は描かない。位置は答え（何階・玄関から見た側・
     接するか離れるか）だけ。
       side  back 奥／right 右／left 左／front 玄関側   floor 1／2（増築のとき） */
  function chFigure(uid, cs) {
    const two = cs.some(c => c.what === 'ext' && c.floor === 2);
    const W = 220, INK = '#6B6963', BAND = '#CFC8BA', FILL = '#F4F1EA';
    const hatch = 'cg' + uid;
    const inReg = c => c.reg === 'yes';
    /* 枠（幅220px＝境界・私道と同じ）いっぱいに描く。以前は家を 96×62 で描き、枠の4割しか
       使わず、番号も斜線も小さかった（2026-09-26）。表示範囲は描いたものの外形から決める。 */
    /* 主役は変わった部分なので、家に対して小さくしすぎない（家 124×78 に出っ張り30：2026-09-26）。 */
    const D = two ? { ext: 22, cut: -18, dep: 24, gap: 10 } : { ext: 30, cut: -24, dep: 30, gap: 12 };
    /* 描いたものの外形。左右も測り、枠の中央に寄せる（以前は家の位置を固定し、右側だけに
       変更があっても左に寄った：2026-09-26）。 */
    const box = { x0: Infinity, x1: -Infinity, y0: 0, y1: 0 };
    const grow = r => { box.x0 = Math.min(box.x0, r[0]); box.x1 = Math.max(box.x1, r[0] + r[2]);
      box.y0 = Math.min(box.y0, r[1]); box.y1 = Math.max(box.y1, r[1] + r[3]); };
    /* 辺に沿って、出っ張り（+）と欠け（−）を持つ外形を1本の道にする。
       ps＝[{ side, off, len, d }]（d>0 出る、d<0 欠ける） */
    function outline(X, Y, w, h, ps) {
      const by = side => ps.filter(p => p.side === side).sort((a, b) => a.off - b.off);
      let d = 'M' + X + ' ' + Y;
      by('back').forEach(p => { d += 'L' + p.off + ' ' + Y + 'L' + p.off + ' ' + (Y - p.d) + 'L' + (p.off + p.len) + ' ' + (Y - p.d) + 'L' + (p.off + p.len) + ' ' + Y; });
      d += 'L' + (X + w) + ' ' + Y;
      by('right').forEach(p => { d += 'L' + (X + w) + ' ' + p.off + 'L' + (X + w + p.d) + ' ' + p.off + 'L' + (X + w + p.d) + ' ' + (p.off + p.len) + 'L' + (X + w) + ' ' + (p.off + p.len); });
      d += 'L' + (X + w) + ' ' + (Y + h);
      by('front').reverse().forEach(p => { d += 'L' + (p.off + p.len) + ' ' + (Y + h) + 'L' + (p.off + p.len) + ' ' + (Y + h + p.d) + 'L' + p.off + ' ' + (Y + h + p.d) + 'L' + p.off + ' ' + (Y + h); });
      d += 'L' + X + ' ' + (Y + h);
      by('left').reverse().forEach(p => { d += 'L' + X + ' ' + (p.off + p.len) + 'L' + (X - p.d) + ' ' + (p.off + p.len) + 'L' + (X - p.d) + ' ' + p.off + 'L' + X + ' ' + p.off; });
      return d + 'Z';
    }
    const rectPath = r => 'M' + r[0] + ' ' + r[1] + 'h' + r[2] + 'v' + r[3] + 'h' + (-r[2]) + 'Z';
    const lbl = (x, y, t, cls) => '<text x="' + x + '" y="' + (y + 4) + '" text-anchor="middle" class="cg-t ' + (cls || 'no') + '">' + t + '</text>';
    const pat = c => 'url(#' + hatch + (c.reg === 'unknown' ? 'u' : '') + ')';
    let door = null;                          // 玄関の位置（1階の平面の下の辺）

    function plan(X, Y, w, h, floor, name) {
      grow([X, Y, w, h]);
      const mine = cs.map((c, i) => ({ c, i })).filter(({ c }) => c.what === 'ext' ? (c.floor || 1) === floor : floor === 1);
      const sides = { back: [], right: [], left: [], front: [] };
      mine.forEach(o => (sides[o.c.side] || sides.back).push(o));
      const edge = [], apart = [], upper = [];
      Object.keys(sides).forEach(side => {
        const list = sides[side], hor = side === 'back' || side === 'front';
        /* 玄関側は、中央に玄関の口（幅36）を空け、左の半分・右の半分に振り分ける（2件で玄関が
           ふさがり、1件でも口をまたいだ）。 */
        const door = side === 'front' && floor === 1;
        const halfW = (w - 36) / 2, nL = Math.ceil(list.length / 2);
        list.forEach((o, k) => {
          const c = o.c;
          const inR = door && k >= nL, cnt = door ? (inR ? list.length - nL : nL) : list.length, kk = door && inR ? k - nL : k;
          const span = door ? halfW / cnt : (hor ? w : h) / list.length;
          const len = Math.min(span - 8, hor ? w * .45 : h * .6);
          const off = (hor ? X : Y) + (inR ? halfW + 36 : 0) + span * kk + (span - len) / 2;
          if (c.what === 'ext' && floor === 2) upper.push({ o, side });
          else if (c.what === 'ext' || c.what === 'cut') edge.push({ o, side, off, len, d: c.what === 'ext' ? D.ext : D.cut });
          else {
            const L = Math.min(len, D.dep + 8), o2 = off + (len - L) / 2;
            const r = side === 'back' ? [o2, Y - D.gap - D.dep, L, D.dep] : side === 'front' ? [o2, Y + h + D.gap, L, D.dep]
              : side === 'left' ? [X - D.gap - D.dep, o2, D.dep, L] : [X + w + D.gap, o2, D.dep, L];
            apart.push({ o, r }); grow(r);
          }
        });
      });
      edge.forEach(e => { if (e.d > 0) grow(e.side === 'back' ? [e.off, Y - e.d, e.len, e.d] : e.side === 'front' ? [e.off, Y + h, e.len, e.d]
        : e.side === 'left' ? [X - e.d, e.off, e.d, e.len] : [X + w, e.off, e.d, e.len]); });
      let g = '';
      if (floor === 2) {
        /* 2階：今の2階＝1階と同じ外形とし、増築した側ごとに斜線（登記に載っていなければ）。
           登記の形は、登記に載っていない側を除いた残り。2件以上も同じ（以前は1件しか描かなかった）。 */
        const PART = { back: [X, Y, w, h * .45], front: [X, Y + h * .55, w, h * .45], left: [X, Y, w * .45, h], right: [X + w * .55, Y, w * .45, h] };
        const off = upper.filter(u => !inReg(u.o.c)).map(u => u.side);
        const regR = [X + (off.includes('left') ? w * .45 : 0), Y + (off.includes('back') ? h * .45 : 0)];
        regR.push(X + w - (off.includes('right') ? w * .45 : 0) - regR[0], Y + h - (off.includes('front') ? h * .45 : 0) - regR[1]);
        g += '<path d="' + rectPath([X, Y, w, h]) + '" fill="' + FILL + '"/>';
        upper.forEach(u => {
          const r = PART[u.side] || PART.back;
          g += inReg(u.o.c) ? '<path d="' + rectPath(r) + '" fill="none" stroke="#BDB5A6" stroke-width="1" stroke-dasharray="2 2"/>'
            : '<path d="' + rectPath(r) + '" fill="' + pat(u.o.c) + '"/>';
        });
        g += '<path d="' + rectPath(regR) + '" fill="none" stroke="' + BAND + '" stroke-width="5" stroke-linejoin="round" opacity=".9"/>';
        g += '<path d="' + rectPath([X, Y, w, h]) + '" fill="none" stroke="' + INK + '" stroke-width="1.4"/>';
        upper.forEach(u => { const r = PART[u.side] || PART.back; g += lbl(r[0] + r[2] / 2, r[1] + r[3] / 2, circled(u.o.i)); });
        return g;
      }
      /* 今の家：増築は出っ張り、一部の取り壊しは欠け。登記の形：登記済みの変更だけ反映。 */
      const now = edge.map(e => ({ side: e.side, off: e.off, len: e.len, d: e.d }));
      const reg = edge.filter(e => inReg(e.o.c)).map(e => ({ side: e.side, off: e.off, len: e.len, d: e.d }));
      g += '<path d="' + outline(X, Y, w, h, now) + '" fill="' + FILL + '"/>';
      /* 登記に載っていない部分（今の家にあって登記に無い）は斜線。 */
      edge.filter(e => e.d > 0 && !inReg(e.o.c)).forEach(e => {
        const r = e.side === 'back' ? [e.off, Y - e.d, e.len, e.d] : e.side === 'front' ? [e.off, Y + h, e.len, e.d]
          : e.side === 'left' ? [X - e.d, e.off, e.d, e.len] : [X + w, e.off, e.d, e.len];
        g += '<path d="' + rectPath(r) + '" fill="' + pat(e.o.c) + '"/>';
      });
      /* 取り壊した部分で、登記をまだ確かめていないものは薄い斜線（説明の見本と揃える。以前は
         「登記に残っている」と同じ白抜きにして、説明と食い違った）。 */
      edge.filter(e => e.d < 0 && e.o.c.reg === 'unknown').forEach(e => {
        const q = -e.d, r = e.side === 'back' ? [e.off, Y, e.len, q] : e.side === 'front' ? [e.off, Y + h - q, e.len, q]
          : e.side === 'left' ? [X, e.off, q, e.len] : [X + w - q, e.off, q, e.len];
        g += '<path d="' + rectPath(r) + '" fill="' + pat(e.o.c) + '"/>';
      });
      apart.filter(a => a.o.c.what === 'demo' && a.o.c.reg === 'unknown').forEach(a => { g += '<path d="' + rectPath(a.r) + '" fill="' + pat(a.o.c) + '"/>'; });
      /* 取り壊して登記からも消えた建物は、かつての位置を薄い点線で（番号だけが浮かないように）。 */
      apart.filter(a => a.o.c.what === 'demo' && inReg(a.o.c)).forEach(a => { g += '<path d="' + rectPath(a.r) + '" fill="none" stroke="#BDB5A6" stroke-width="1.1" stroke-dasharray="3 3"/>'; });
      /* 登記の形は、地の色と斜線の上・今の家の線の下に敷く（付け根を横切る線が見えるように）。 */
      apart.filter(a => a.o.c.what === 'annex').forEach(a => { g += '<path d="' + rectPath(a.r) + '" fill="' + (inReg(a.o.c) ? FILL : pat(a.o.c)) + '"/>'; });
      g += '<path d="' + outline(X, Y, w, h, reg) + '" fill="none" stroke="' + BAND + '" stroke-width="5" stroke-linejoin="round" opacity=".9"/>';
      apart.forEach(a => { const c = a.o.c; if ((c.what === 'annex' && inReg(c)) || (c.what === 'demo' && !inReg(c))) g += '<path d="' + rectPath(a.r) + '" fill="none" stroke="' + BAND + '" stroke-width="5" stroke-linejoin="round"/>'; });
      /* 玄関：下の辺のうち、玄関側の変更が無いところ（中央から順に探す）。開口と矢印。 */
      door = { x: X + w / 2, y: Y + h };
      g += '<path d="' + outline(X, Y, w, h, now) + '" fill="none" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>';
      apart.filter(a => a.o.c.what === 'annex').forEach(a => { g += '<path d="' + rectPath(a.r) + '" fill="none" stroke="' + INK + '" stroke-width="1.4"/>'; });
      g += '<path d="M' + (door.x - 8) + ' ' + door.y + 'h16" stroke="' + FILL + '" stroke-width="3.2"/>';
      /* 番号 */
      edge.forEach(e => {
        const q = Math.abs(e.d), hor = e.side === 'back' || e.side === 'front';
        const cx = hor ? e.off + e.len / 2 : e.side === 'left' ? X + (e.d > 0 ? -q / 2 : q / 2) : X + w + (e.d > 0 ? q / 2 : -q / 2);
        const cy = !hor ? e.off + e.len / 2 : e.side === 'back' ? Y + (e.d > 0 ? -q / 2 : q / 2) : Y + h + (e.d > 0 ? q / 2 : -q / 2);
        g += lbl(cx, cy, circled(e.o.i));
      });
      apart.forEach(a => { g += lbl(a.r[0] + a.r[2] / 2, a.r[1] + a.r[3] / 2, circled(a.o.i)); });
      return g + (name ? '<text x="' + (X + w / 2) + '" y="' + (box.y0 - 8) + '" text-anchor="middle" class="cg-t">' + name + '</text>' : '');
    }
    let s = '<defs><pattern id="' + hatch + '" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><path d="M0 0V5" stroke="#8C877D" stroke-width="1.5"/></pattern>' +
      '<pattern id="' + hatch + 'u" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><path d="M0 0V6" stroke="#CFC8BA" stroke-width="1.3"/></pattern></defs>';
    if (two) {
      s += plan(38, 0, 68, 72, 1, '') + plan(150, 0, 68, 72, 2, '');
      /* 階の名前は、2枚とも同じ高さ（描いたもののいちばん上のさらに上）に。 */
      s += [[72, '1階'], [184, '2階']].map(([x, t]) => '<text x="' + x + '" y="' + (box.y0 - 7) + '" text-anchor="middle" class="cg-t">' + t + '</text>').join('');
      box.y0 -= 18;
    }
    else s += plan(48, 0, 124, 78, 1, '');
    /* 玄関の字は、玄関の真下に短い矢印を付けて。玄関の位置は玄関側の変更を避けて選んで
       いるので、字が別棟と重なることはない。 */
    const doorY = door.y + 13;
    s += '<path d="M' + door.x + ' ' + (door.y + 4) + 'V' + (doorY - 1) + 'm-3-3 3 3 3-3" fill="none" stroke="#A39B8A" stroke-width="1.1"/>' +
      '<text x="' + door.x + '" y="' + (doorY + 13) + '" text-anchor="middle" class="cg-t q">玄関</text>';
    /* 図の幅は描いたものの幅そのもの（1:1）。見えない固定の枠に入れて中央に寄せると、図の左端が
       行の文の左端と揃わず、説明との間も組み合わせで変わった（2026-09-26）。左端は文に揃え、
       説明は図の右端のすぐ後ろから（.cg-fig）。 */
    const top = box.y0 - 2, H = Math.max(box.y1, doorY + 16) + 2 - top;
    const left = box.x0 - 1, VW = Math.ceil(box.x1 - box.x0 + 2);
    return '<svg viewBox="' + left + ' ' + top + ' ' + VW + ' ' + H + '" width="' + VW + '" role="img" aria-label="真上から見た今の家と、登記の形を重ねた図（玄関が下）">' + s + '</svg>';
  }
  /* 図の右の説明。図を言葉で言う短い事実だけ。 */
  /* 図の右の説明。図を言葉で言うことだけ（変更と、登記に載っているか）。課税明細書と工事の
     書類は図に描いていないので、ここに並べない ―― 以前は3行の表にして右の欄が詰まり、図と
     釣り合わなかった（2026-09-26）。それが何を意味するかは、次にすることが言う。 */
  /* 説明の2行目（登記の状態）に図と同じ見本を付け、凡例を兼ねる（凡例を別に置くと、同じ
     「登記に載っていない」を2回言い、右の欄が上に固まった：2026-09-26）。 */
  function chCaption(cs) {
    const st = c => S.chGrow(c.what)
      ? { yes: ['on', '登記に載っている'], no: ['df', '登記に載っていない'] }[c.reg] || ['uk', '登記はまだ確かめていない']
      : { yes: [c.what === 'demo' ? 'dz' : '', '登記からも消えている'], no: ['gn', '登記に残っている'] }[c.reg] || ['uk', '登記はまだ確かめていない'];
    const glyph = g => g ? '<em class="cg-g ' + g + '"></em>' : '';
    const legend = '<p class="cg-legend"><em class="cg-g rg"></em>灰色の線は登記の形</p>';
    if (cs.length === 1) {
      const [g, t] = st(cs[0]);
      return '<div class="bd-cap"><div class="bd-items"><div class="bd-item"><i>' + circled(0) + '</i><span>' + esc(desc(cs[0])) + '<small>' + glyph(g) + t + '</small></span></div></div>' + legend + '</div>';
    }
    /* 2件以上：同じ登記の状態が件数だけ並ぶと、説明が図の倍の高さになった。見出しは1行ずつ、
       登記の状態は種類ごとにまとめて、見本の横に番号を並べる。 */
    const groups = new Map();
    cs.forEach((c, i) => { const [g, t] = st(c), k = g + '|' + t; groups.set(k, (groups.get(k) || { g, t, n: [] })); groups.get(k).n.push(circled(i)); });
    return '<div class="bd-cap"><div class="bd-items cg-many">' + cs.map((c, i) => '<div class="bd-item"><i>' + circled(i) + '</i><span>' + esc(desc(c)) + '</span></div>').join('') + '</div>' +
      '<div class="cg-st">' + [...groups.values()].map(x => '<p>' + glyph(x.g) + x.t + '<b>' + x.n.join('') + '</b></p>').join('') + '</div>' + legend + '</div>';
  }
  /* 所有を示すもの（増える変更で、登記に載っていないものごと）。フォームの「この変更の記録」の
     答え（課税明細書・工事の書類）をここに映す ―― 以前は次にすることの文に混ぜるだけで、
     何のために聞いたのかが画面から見えなかった（2026-09-26）。2種類以上で足りる。 */
  const PROOF = Object.assign({ valuation: '固定資産評価証明書' }, KIND);
  function proofBlock(cs) {
    const rows = cs.map((c, i) => ({ c, i })).filter(({ c }) => S.chGrow(c.what) && c.reg !== 'yes');
    if (!rows.length) return '';
    return '<div class="pr-act bd-docs cg-proof"><div class="pr-act-h"><span>所有を示すもの</span><small>2種類以上あれば足ります</small></div>' +
      rows.map(({ c, i }) => {
        const have = S.changeProof(c), n = have.length;
        /* まだ確かめていないものだけを一言で（課税明細書に載っていれば評価証明書が1種類になる）。 */
        const note = [c.tax === '' && '課税明細書', c.docs === 'unknown' && '工事の書類'].filter(Boolean);
        const noteText = note.length ? 'まだ確かめていない：' + note.join('・') : '';
        return '<p>' + (cs.length > 1 ? '<span class="bd-act-nb">' + circled(i) + '</span>' : '') +
          (n ? esc(have.map(k => PROOF[k]).join('・')) : '<span class="cg-none">まだない</span>') +
          '<b class="cg-v ' + (n >= 2 ? 'ok' : 'or') + '">' + (n >= 2 ? '足りる' : 'あと' + (2 - n) + '種類') + '</b>' +
          (noteText ? '<small>' + esc(noteText) + '</small>' : '') + '</p>';
      }).join('') + '</div>';
  }

  /* 一文の前半（なぜ必要か）。何の登記を、誰が申請するのかまで言う（「登記は義務」だけでは
     何をするのか分からない：2026-09-26）。 */
  const CH_NEED = '増築や取り壊しをしたら、所有者が登記を直す<b>義務</b>があります。登記が今の建物と違うと、<b>売る</b>ときに買主が住宅ローンを組めないことがあります。';
  const chAct = rows => '<div class="pr-act"><div class="pr-act-h"><span>次にすること</span></div>' + rows.map(r =>
    '<p>' + (r.nb ? '<span class="bd-act-nb">' + esc(r.nb) + '</span>' : '') + esc(r.text) + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</p>').join('') + '</div>';
  /* くわしく。場面ごと。どの節を出すかは答えで決める。 */
  const DT_SELL_GROW = ['売る・担保に入れるとき', '買主の金融機関は、担保にする建物の登記が今の建物と合っていることを求めます。登記に載っていない増築があると、住宅ローンの審査が通らない、または融資額が減ることがあります。'];
  const DT_SELL_GONE = ['売る・担保に入れるとき', '取り壊した建物が登記に残っていると、売る前に、取り壊しの登記（滅失登記）を求められます。'];
  const DT_PROOF = ['所有を示す書類', '増えた部分が' + WHO + 'のものだと示すには、確認済証・検査済証、工事請負契約書と領収書、工事を請け負った会社の工事完了引渡証明書、固定資産評価証明書などを使い、2種類以上を求められることが多いです。' +
    '確認済証をなくしても、建築確認を受けていれば、役所で台帳記載事項証明書を取れることがあります。' +
    '足りないときは上申書（実印を押し、印鑑証明書を添える）で補います。今なら' + WHO + 'の上申書で足りますが、' + WHO + 'が亡くなった後は相続人全員の上申書が必要です。'];
  const DT_TAX = ['課税されていなかったとき', '登記をすると、法務局から市町村へ通知が行きます。課税されていなかった増築は、最大5年さかのぼって課税されることがあります。'];
  const DT_DUTY = ['義務と費用', '増築・取り壊しから1か月以内に申請する義務があり、怠ると10万円以下の過料の定めがあります。1か月を過ぎても義務は続き、今からでも申請できます。過料は、登記官から裁判所へ通知され、催告にも応じないときに検討されるものです。' +
    '土地家屋調査士の報酬の目安は、増築の登記で約10万円、取り壊しの登記で約5万円です（登録免許税はかかりません）。'];

  function changedBody(p) {
    const m = p.matters.changed || {}, key = 'ch' + p.id;
    const quiet = t => '<p class="pr-quiet">' + t + '</p>';
    const W = WHO;
    if (m.has === 'no') return quiet('建ててから、増築や取り壊しはしていません。');
    /* 何が記録に残らないのか、を事実で言う（「父に聞かないと分からない」とは書かない）。 */
    if (m.has === 'unasked') return '<p class="pr-why">' + CH_NEED + '請け負った会社や工事の書類の保管場所は、登記にも課税明細書にも載りません。</p>' +
      chAct([{ text: W + 'に、建ててから増築や取り壊し、離れ・車庫の新築をしたことがあるか確かめる', sub: 'あれば、時期と場所、請け負った会社、登記をしたか、工事の書類の保管場所も確かめます。' }]);
    if (m.has === 'unknown') {
      if (m.check === 'same') return quiet('課税明細書では、登記床面積と現況床面積に違いはありませんでした。ただ、市町村も把握していない増築はこれでは分からず、売るときの調査で見つかることがあります。その場合は、相続人全員の上申書を添えて登記します。');
      if (m.check === 'diff') return '<p class="pr-why">' + CH_NEED + '課税明細書で、登記に載っていない部分が見つかっています。</p>' +
        chAct([{ text: '土地家屋調査士に課税明細書を見せ、' + W + 'の名前で表題変更登記を依頼する', sub: '工事の書類がなくても、今なら固定資産評価証明書と' + W + 'の上申書で、増えた部分が' + W + 'のものだと示せます。' }]) +
        boundaryDetail(p, [DT_SELL_GROW, DT_PROOF, DT_DUTY], 'changed');
      return '<p class="pr-why">' + CH_NEED + W + 'が覚えていなくても、市町村が把握している増築は課税明細書で分かります。</p>' +
        chAct([{ text: '課税明細書の家屋の欄で、登記床面積と現況床面積を比べる', sub: '現況床面積のほうが大きいか、家屋番号の欄に「未登記家屋」とある行があれば、登記に載っていない部分があります。課税明細書は、固定資産税の納税通知書に同封されています。' }]);
    }
    const cs = m.changes || [];
    const st = cs.map(S.changeState);
    /* 図と説明は1つのまとまり（説明は図の凡例なので、決まった間隔で寄せる）。まとまりを行の中央に
       置く ―― 内容が少なければ小さく中央に、多ければ行の幅いっぱいに広がる。以前は図と説明を
       別々に扱い、間の余白だけを調整していた（固定の枠／図のすぐ後ろ／余白を等分、のどれも変だった）。 */
    const fig = '<div class="bd-fig cg-fig"><div class="bd-figs">' + chFigure(key, cs) + '</div>' + chCaption(cs) + '</div>';
    /* 全部登記に載っている：済んだ段でも、家族にとっての意味（建物の登記を直さずに相続登記が
       できる）と、どこが変わった建物かは残す（以前は1行だけだった：2026-09-26）。 */
    if (st.every(x => x === 'ok')) return '<p class="pr-why">建ててからの変更は、すべて登記に載っています。' + W +
      'が亡くなったときは、建物の登記を直さずに、そのまま相続登記ができます。</p>' + fig;
    const grow = cs.filter(c => S.chGrow(c.what) && c.reg !== 'yes');
    const gone = cs.filter(c => !S.chGrow(c.what) && c.reg !== 'yes');
    const act = st.includes('act'), check = st.includes('check');
    const sections = [];
    if (grow.length) sections.push(DT_SELL_GROW); else if (gone.length) sections.push(DT_SELL_GONE);
    if (act) sections.push(DT_PROOF);
    if (grow.some(c => c.tax !== 'match')) sections.push(DT_TAX);
    sections.push(DT_DUTY);
    const idx = cs.map((c, i) => ({ c, i, nb: cs.length > 1 ? circled(i) : '' }));
    const nbs = list => list.map(x => x.nb).join('');
    /* ■ 次にすること。画面に「まだ確かめていない」と出すものには、必ず確かめる手を出す
       （以前は取り壊しの登記を「後からできる」として外し、①が行き止まりになった：2026-09-26）。
         1 確かめる … 登記に載っているか（登記事項証明書）、課税明細書に載っているか
         2 探す     … 工事の書類（示すものが足りない増える変更で、まだ探していない）
         3 依頼する … 登記に載っていないと分かり、書類を探し終えた増える変更。依頼は1回で済む
                      ので1行にまとめる
       登記に載っているか分からないうちは依頼を出さない（載っていれば要らない）。 */
    const rows = [];
    const regU = idx.filter(x => x.c.reg === 'unknown');
    const taxU = idx.filter(x => S.chGrow(x.c.what) && x.c.reg !== 'yes' && x.c.tax === '');
    if (regU.length || taxU.length) {
      const all = idx.filter(x => regU.includes(x) || taxU.includes(x));
      const tag = (list, t) => (all.length > 1 && list.length < all.length ? nbs(list) + ' ' : '') + t;
      rows.push({ nb: nbs(all),
        text: regU.length && taxU.length ? '登記事項証明書と課税明細書で、載っているか確かめる'
          : regU.length ? '登記事項証明書で、登記に載っているか確かめる' : '課税明細書で、載っているか確かめる',
        sub: (regU.length ? tag(regU, '登記事項証明書は法務局で取れます。表題部に' + (regU.every(x => S.chGrow(x.c.what)) ? '「◯年増築」' : regU.some(x => S.chGrow(x.c.what)) ? '「◯年増築」「◯年一部取毀」' : '「◯年一部取毀」「◯年取毀」') + 'などの記録があれば、登記に反映されています。') : '') +
          (taxU.length ? tag(taxU, '課税明細書に載っていれば、固定資産評価証明書も所有を示すものになります。') : '') });
    }
    const hunt = idx.filter(x => S.changeState(x.c) === 'act' && x.c.docs === 'unknown');
    if (hunt.length) rows.push({ nb: nbs(hunt), text: '工事の書類を探す', sub: '確認済証・検査済証・工事請負契約書・領収書などです。保管場所は' + W + 'に確かめます。' });
    const asks = idx.filter(x => S.changeState(x.c) === 'act' && x.c.reg === 'no' && x.c.docs !== 'unknown');
    if (asks.length) {
      /* 補足は文ごとに集め、同じ文は1回だけ。全部に当てはまらない文には番号を付ける。 */
      const seen = new Map();
      asks.forEach(x => [
        '足りない分は、工事を請け負った会社の工事完了引渡証明書か、' + W + 'の上申書で補います。',
        x.c.by && x.c.by + 'が請け負った工事です。',
        S.changeProof(x.c).length === 0 && x.c.tax === 'miss' && '上申書には、' + W + 'が覚えている工事の時期と内容を書きます。'
      ].filter(Boolean).forEach(t => seen.set(t, (seen.get(t) || []).concat(x.nb))));
      rows.push({ nb: nbs(asks),
        text: '土地家屋調査士に、' + W + 'の名前で' + (asks.length === 1 && asks[0].c.what === 'ext' ? '表題変更登記' : '登記') + 'を依頼する',
        sub: [...seen].map(([t, n]) => (n.length === asks.length ? '' : n.join('') + ' ') + t).join('') });
    }
    /* 一文。対応が要る・確かめることが残るときは、なぜ必要か＋なぜ今のうちか。
       残っていない（書類がそろう／未登記は取り壊しだけ）ときは、家族が後から申請できること。 */
    let why;
    if (act) {
      const acts = idx.filter(x => S.changeState(x.c) === 'act');
      const bare = acts.find(x => x.c.docs === 'no' && x.c.tax === 'miss');
      why = CH_NEED + (bare ? chName(bare.c) + 'は課税明細書にも載っておらず、示せるのは' + W + 'の記憶だけです。'
        : '今なら、工事の書類が' + (acts.every(x => x.c.docs === 'unknown') ? '見つからなくても' : '足りなくても') + W + 'の上申書で申請できます。');
    } else if (check) why = CH_NEED + '登記に載っているかは、登記事項証明書で家族も確かめられます。';
    else why = (grow.length ? '登記はまだですが、工事の書類がそろっているので、' : '取り壊しの登記は所有を示す書類が要らないので、') +
      W + 'が亡くなった後でも相続人が申請できます。売る前や担保に入れる前には必要です。';
    return '<p class="pr-why">' + why + '</p>' + fig + proofBlock(cs) + (rows.length ? chAct(rows) : '') + boundaryDetail(p, sections, 'changed');
  }

  /* 読み手（そのとき・現所有者の申告・権利関係）が使う、登記と今の建物のずれ。 */
  function chName(c) {
    return c.what === 'ext' ? (c.where ? c.where + 'の増築' : '増築部分') : c.what === 'annex' ? bname(c)
      : '取り壊した' + (c.what === 'cut' ? c.where || '部分' : bname(c));
  }
  function chGap(p) {
    const m = p.matters.changed || {};
    const cs = m.has === 'yes' ? m.changes || [] : [];
    const open = cs.filter(c => c.reg !== 'yes');
    return { m, ext: open.filter(c => c.what === 'ext'), annex: open.filter(c => c.what === 'annex'),
      gone: open.filter(c => !S.chGrow(c.what)), grow: open.filter(c => S.chGrow(c.what)),
      diff: m.has === 'unknown' && m.check === 'diff' };
  }

  function nowRows(p) {
    const names ={ boundary: '境界・越境の取り決め', road: '私道・通行・配管の取り決め', changed: '建物の変更・登記' };
    const out = ['boundary', 'road', 'changed'].filter(key => !(key === 'changed' && p.kind === 'land')).map(key => {
      const ms = S.matterStatus(p, key), status = ms.status;
      if (key === 'boundary') return { key, type: 'matter', nm: names[key], status, label: ms.label, body: boundaryBody };
      if (key === 'road') return { key, type: 'matter', nm: names[key], status, label: ms.label, body: roadBody };
      return { key, type: 'matter', nm: names[key], status, label: ms.label, body: changedBody };
    });

    const pr = p.priorInheritance || {};
    const ps = S.priorStatus(p);
    out.push({ key: 'prior', type: 'prior', icon: 'prior', nm: '前の代の相続登記', status: ps,
      label: ps === 'done' ? (pr.stage === 'registered' ? '登記済み'
        : S.priorRoute(pr) === 'will' ? '手続きなし' : (S.priorParty(pr) || '相続人') + 'の分は済み') : '' });

    /* 団信の加入状況は、借入ありで団信が不明のときだけ立つ。事実は下段の
       借入（loan.gteeStatus）にあり、ここは同じ事実から出る今のうちの行動。
       入口はほかの行と同じく状態のバッジ（「記録」ボタンだけ残っていた：2026-09-29）。 */
    const gl = loanItems(p).find(it => it.who !== 'other' && !it.paid && it.gtee === 'unknown');
    if (gl) {
      out.push({ key: 'loan', type: 'loan', icon: 'loan', nm: (gl.type || '住宅ローン') + 'の団信加入状況', status: 'unknown',
        summary: (gl.bank || '金融機関') + '｜' + (gl.type || '住宅ローン') + 'あり。団信加入の有無が確認できていない。',
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

  /* ■ そのときの相続登記（2026-09-27 作り直し。見本 `_検討/そのとき_表示v4.html`）
     箇条で並べていた「この物件では」は、性格の違う情報（この家の状態／
     加わる人／用意するもの／順番／頼む先）が同じ重さで混ざった羅列だった。
     家族の問いごとに置き場所を分ける：
       say    … この家の事情を一文で（前の代の名義・話し合いに加わる人・
                増築・私道・共有・借地）。名義の移りは当たり前なので図にしない
       docs   … そろえる書類。どこから来るか（家にある／家族で作る／役所で
                取る）で分ける。ここだけ書面の絵にする（文では読み分けにくい）
       steps  … 手続きが2つ以上あるときだけ順番。1つなら頼む先を1行（who）
       flags  … くわしくの中身を家ごとに変えるところ                  */
  function tokiParts(p) {
    const pr = p.priorInheritance || {};
    const docAt = key => docPlace(p, key);
    const gap = chGap(p), names = cs => cs.map(chName).join('・');
    const noWill = WHO + 'の遺言がなければ、';
    const say = [], home = [], make = [];
    let office = ['戸籍（' + WHO + '）', '住民票の除票（' + WHO + '）', '印鑑証明書（全員）', '固定資産評価証明書'];
    const kyo = s => ({ t: '遺産分割協議書', s: s || '相続人全員が署名し、実印を押す' });
    let kyoNote = '', prior = false, once = false;
    const lease = p.rights && p.rights.land && p.rights.land.hold === 'lease';
    const what = lease ? '建物' : p.kind === 'condo' ? '専有部分' : p.kind === 'land' ? '土地' : '土地と建物';

    /* 前の代の名義が残っていて、父が当事者のとき。 */
    const c = pr.remains === 'yes' && pr.stage !== 'registered' ? priorCase(p) : null;
    if (c && c.P === WHO && (c.mine || c.route === 'unknown' || (c.route === 'split' && ['none', 'agreed'].includes(c.st)))) {
      prior = true;
      const owner = (S.priorOwner(p) || '前の代').replace(/（故人）$/, '');
      office = ['戸籍（' + WHO + '・' + owner + '）', '住民票の除票（' + WHO + '・' + owner + '）', '印鑑証明書（全員）', '固定資産評価証明書'];
      if (c.route === 'will') {
        say.push(c.where + 'は' + owner + 'の名義のままですが、<b>' + owner + 'の遺言</b>で' + WHO + 'が取得すると決まっています。' +
          noWill + '話し合いは' + WHO + 'の分だけで、' + WHO + 'の相続人（家族）全員でします。');
        home.push({ t: owner + 'の遺言書', s: '自筆なら、先に家庭裁判所の検認を受ける（法務局に預けたものを除く）', at: docAt('priorWill') });
        once = true;
      } else if (c.route === 'split' && c.st === 'signed') {
        say.push(c.where + 'は' + owner + 'の名義のままですが、<b>協議書</b>で' + WHO + 'が取得すると決まっています。' +
          noWill + '話し合いは' + WHO + 'の分だけで、' + WHO + 'の相続人（家族）全員でします。');
        home.push({ t: owner + 'の遺産分割協議書', s: WHO + 'が取得すると書いたもの。添える印鑑証明書も', at: docAt('prior') });
        once = true;
      } else if (c.route === 'sole') {
        say.push(c.where + 'は<b>' + owner + 'の名義のまま</b>です。' + owner + 'の相続人は' + WHO + 'だけなので、' + owner + 'の分は話し合いが要りません。' +
          noWill + WHO + 'の分は' + WHO + 'の相続人（家族）全員で話し合います。');
        once = true;
      } else {
        say.push(c.where + 'は<b>' + owner + 'の名義のまま</b>です。' + (c.route === 'unknown' ? owner + 'と' : '') + noWill +
          owner + 'のほかの相続人も話し合いに加わり、<b>2人分の相続を1通の協議書</b>にまとめます。');
        kyoNote = c.st === 'agreed' ? WHO + 'が取得すると口頭で決まっていただけで、書面はない' : owner + 'の分は、まだ話がついていない';
      }
    } else {
      say.push(noWill + WHO + 'の相続人（家族）<b>全員で遺産分割協議</b>をして、' + what + 'の名義を移します。');
    }

    /* 何を登記するか（借地・共有・私道）。 */
    if (lease) say.push('土地は借地なので、登記するのは建物だけです。借地権は建物と一緒に引き継ぎます。');
    ['land', 'bldg'].forEach(k => {
      const r = (p.rights || {})[k];
      if (r && r.owner === WHO && r.hold === 'share' && r.shares && r.shares !== '単独')
        say.push((k === 'land' ? '土地' : p.kind === 'condo' ? '専有部分' : '建物') + 'は<b>' + WHO + 'の持分（' + r.shares + '）だけ</b>を移します。');
    });
    const road = (p.matters.road || {}).has === 'yes' ? ((p.matters.road.links || []).find(l => l.land === 'road') || null) : null;
    if (road && road.share === 'yes') {
      say.push('<b>前の私道の持分</b>も同じ申請に入れます。私道は課税明細書に載らないことがあるので、名寄帳か所有不動産記録証明で地番を確かめます。');
      office = office.concat(['名寄帳']);
    } else if (road && road.share === 'unknown')
      say.push('前の道は私道です。' + WHO + 'が持分を持っていれば、同じ申請に入れます。課税明細書に載らないことがあるので、名寄帳か所有不動産記録証明で確かめます。');

    /* 登記と今の建物のずれ（設計 §9）。相続登記をした人には1か月以内の表題変更
       登記の義務がかかる（不動産登記法51条）。登記のない別棟は相続登記では移らず、
       取得した人が1か月以内に表題登記。取り壊した建物が残っていれば先に滅失登記。 */
    const pre = [], post = [];
    if (gap.gone.length) { say.push('<b>' + names(gap.gone) + 'が登記に残っています</b>。'); pre.push({ t: '取り壊した建物の滅失登記', w: '土地家屋調査士' }); }
    if (gap.ext.length) { say.push('<b>' + names(gap.ext) + 'は登記に載っていません</b>。'); pre.push({ t: '増築の表題変更登記', w: '土地家屋調査士' }); }
    if (gap.diff) { say.push('課税明細書と登記で、建物の床面積が違っています。'); pre.push({ t: '床面積の違いを見てもらう', w: '土地家屋調査士' }); }
    if (gap.annex.length) { say.push('<b>' + names(gap.annex) + 'は登記がありません</b>。相続登記では名義が移りません。'); post.push({ t: names(gap.annex) + 'の表題登記', w: '取得した人・1か月以内' }); }
    if (gap.grow.length) {
      const has = gap.grow.some(x => x.docs === 'yes'), none = gap.grow.every(x => x.docs === 'no');
      if (!none) home.push({ t: '工事の書類', s: '確認済証・工事請負契約書・領収書', at: has ? changedPlace(p) : '', no: has ? '' : '場所は分からない' });
      if (!has) make.push({ t: '上申書', s: (none ? '工事の書類がないので、' : '工事の書類が見つからないとき。') + '相続人全員が実印を押す' });
      kyoNote = [kyoNote, '登記に載っていない部分を誰が取得するかも書く'].filter(Boolean).join('。');
    }
    make.unshift(kyo(kyoNote ? kyoNote + '。相続人全員が署名し、実印を押す' : ''));

    const steps = pre.concat([{ t: '相続登記', w: '司法書士' }], post);
    const who = once ? '司法書士に頼む。' + WHO + 'が1人で取得しているので、1回の申請で家族へ移せることがある'
      : prior ? '司法書士に頼む。' + WHO + 'が1人で取得する協議書にすれば、1回の申請で家族へ移せることがある'
      : '司法書士に頼む（自分で法務局へ申請することもできる）';
    return { say: say.join(''), docs: { home, make, office }, steps: steps.length > 1 ? steps : null, who,
      prior, survey: pre.length || post.length, road: !!(road && road.share !== 'no'),
      owner: prior ? (S.priorOwner(p) || '前の代').replace(/（故人）$/, '') : '' };
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
  /* ■ 2026-09-26｜そのときの見直し
     ・表に出すのは「この家では」（here）。今のうちの答えから出る、この家で
       起きること。一般の手順・根拠は「手順・補足」の中へ。以前は逆で、
       表は「不動産の名義を、相続した人へ変更する」のようなどの家でも同じ文、
       この家のことは畳んだ中にしか無かった。
     ・並びは期限の早い順（ord＝月数）。正本 §3-6「3か月の申告 → 3年の
       相続登記。先に来るのは税で、そちらが知られていない」。
     ・賃貸・借地の引継ぎ（正本 §3-6）を足した。団信には抵当権の抹消登記。 */
  function goneRows(p) {
    const out = [];
    const owns = fatherStake(p);
    const pr = p.priorInheritance || {};
    const docAt = key => docPlace(p, key);
    const gap = chGap(p);
    if (owns) {
      out.push({ id: 'toki', ord: 36, icon: 'toki', nm: '相続登記', lim: '取得を知った日から3年以内',
        toki: tokiParts(p) });
    }
    /* ■ 2026-09-27 相続登記以外の4枚（見本 `_検討/そのとき_表示v5.html`）
       相続登記の組み方（一文・そろえる書類・順番）は当てはめず、カードごとに
       家族がそこで知って振る舞いが変わることから形を決めた。どれも図は置かない
       （形を持つ中身がない）。card＝{ say, secs:[{lb, html}], toc, detail }。 */
    const sv = xs => '<ol class="sv">' + xs.map((s, i) => '<li><span class="sv-n">' + (i + 1) + '</span><b>' +
      (s.when ? '<span class="sv-when">' + esc(s.when) + '</span>' : '') + esc(s.t) + '</b><small>' + esc(s.w || '') + '</small>' +
      (s.s ? '<span class="sv-s">' + s.s + '</span>' : '') + '</li>').join('') + '</ol>';
    const unit = d => '<div class="sw-who"><b>' + esc(d.who || '相手が未記録') + '</b>' +
      (d.tel ? '<span class="tel">' + esc(d.tel) + '</span>' : '') + (d.what ? '<small>' + esc(d.what) + '</small>' : '') + '</div>';
    const homeDoc = (t, s, at) => '<div class="dk"><div class="dk-h">家にある<small>家族が取り出す</small></div><div class="dk-row big"><div class="dk-doc">' +
      tokiPaper(20) + '<div class="dk-t">' + esc(t) + '<span class="dk-s">' + esc(s) + '</span>' +
      (at ? '<span class="dk-at">' + esc(at) + '</span>' : '<span class="dk-at dk-no">場所は記録されていない</span>') + '</div></div></div></div>';
    const h6 = (i, t) => '<section><h6><i>' + i + '</i>' + t + '</h6>';
    const src = (href, label) => '<p><a class="procedure-source" href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + ' ↗</a></p>';

    /* 現所有者の申告 … 主役は要るかどうか。3か月で相続登記が済まない事情が
       今のうちの答えにあれば「出す」、無ければ「済めば要らない」（地方税法
       384条の3）。添える書類は相続登記とほぼ同じ（横浜市：戸籍・住民票・協議書と
       印鑑証明書）なので、書類の絵は出さず「相続登記でそろえるもので済む」。 */
    if (owns && p.ownerReport && p.ownerReport.state !== 'hidden') {
      const addr = p.addr || '';
      const yokohama = /横浜市/.test(addr), nagaoka = /長岡市/.test(addr);
      const ward = (addr.match(/横浜市(.+?区)/) || [])[1];
      const slow = [];
      if (pr.remains === 'yes' && pr.stage !== 'registered' && S.priorParty(pr) === WHO && pr.taker !== 'other') {
        const w = pr.remains === 'yes' ? priorCase(p).where : '土地・建物', o = (S.priorOwner(p) || '前の代').replace(/（故人）$/, '');
        slow.push([w + 'は' + o + 'の名義のままで', w + 'は' + o + 'の名義のままなので']);
      }
      const mo = slow.length ? 'も' : 'は';
      if (gap.grow.length) slow.push([gap.grow.map(chName).join('・') + mo + '登記に載っておらず', gap.grow.map(chName).join('・') + mo + '登記に載っていないので']);
      if (gap.gone.length) slow.push([gap.gone.map(chName).join('・') + 'が登記に残っていて', gap.gone.map(chName).join('・') + 'が登記に残っているので']);
      if (gap.diff) slow.push(['課税明細書と登記で床面積が違っていて', '課税明細書と登記で床面積が違っているので']);
      const say = slow.length
        ? esc(slow.map((x, i) => i < slow.length - 1 ? x[0] : x[1]).join('、')) + '、相続登記は3か月では済まない見込みです。<b>この申告を出します。</b>'
        : '3か月以内に相続登記が済めば、<b>この申告は要りません</b>。済まなければ出します。';
      const office = yokohama ? (ward || '物件のある区') + '役所 税務課' : nagaoka ? '長岡市 資産税課' : '物件のある市区町村の固定資産税の担当';
      const secs = [{ lb: '出す先', html: '<p class="sw-line"><b>' + esc(office) + '</b>　' + (yokohama
        ? '申告書に、相続登記でそろえる書類（戸籍・住民票。協議書がまとまっていれば協議書と印鑑証明書）を添える。原則は原本'
        : '添える書類は相続登記でそろえるものとほぼ同じ。細かい決まりは市区町村の案内で確かめる') + '</p>' +
        (gap.annex.length ? '<p class="sw-line">登記のない' + esc(gap.annex.map(chName).join('・')) + 'は、<b>未登記家屋の所有者変更届</b>も出す（遺産分割協議書の写しを添える）</p>' : '') }];
      const tax = h6(2, 'その年の固定資産税') + '<p>固定資産税は1月1日の所有者に1年分かかります。亡くなった年の分は' + WHO + 'に課されたもので、残りの納期の分は相続人が納めます。</p></section>';
      out.push({ id: 'todoke', ord: 3, icon: 'todoke', nm: '現所有者の申告', eyebrow: '固定資産税',
        lim: yokohama ? '現所有者と知った日の翌日から3か月以内' : '市区町村に申告期限を確かめる（多くは3か月）',
        card: { say, secs, toc: '出さないとき・その年の固定資産税',
          detail: h6(1, '出さないとき') + '<p>' + (yokohama ? '市は、申告の内容で次の年からの固定資産税を誰に課すかを決めます。' : '') +
            '申告がなければ、市区町村が相続人の中から納税する人を決めて、納税通知書を送ります。</p></section>' + tax +
            (yokohama ? src('https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/zeikin/y-shizei/koteishisan-toshikeikakuzei/kotei-gensyoyu.html', '横浜市｜現所有者申告') : '') } });
    }

    /* ローン … 主役は「家族が返すのか」。団信ありなら返さない（保険金は銀行へ）、
       なしなら相続人が法定相続分で引き継ぐ（放棄は3か月・債務を1人に寄せるには
       債権者の承諾）。相手が 借入先 → 借入先 → 法務局 と変わるので縦の順番。
       隠れているのは抵当権の抹消（自動では消えない。解除証書で相続登記に続けて）。 */
    /* 父（と母）が借りていて返している途中の借入ごとに1枚（1件ずつ持つ：2026-09-28）。 */
    loanItems(p).filter(it => it.who !== 'other' && !it.paid).forEach((l, li) => {
      const insured = l.gtee === 'yes', uninsured = l.gtee === 'no';
      const bank = l.bank || '借入先', kind = l.type || '住宅ローン';
      const lien = l.lien === 'yes', lienMaybe = l.lien !== 'no' && !lien, noLien = l.lien === 'no';
      const drop = (after) => ({ t: '抵当権の抹消登記', w: '司法書士', s: (lienMaybe ? 'この家に抵当権が付いていれば、' : '') +
        after + '抵当権の登記は<b>自動では消えない</b>。相続登記に続けて申請する' });
      let say, steps, toc, detail;
      const renounce = h6(1, '相続放棄') + '<p>放棄は借入だけを選べず、預貯金やこの家を含む全部を受け取らないことになります。3か月で決められないときは、家庭裁判所に期間を延ばすよう申し立てられます。</p></section>';
      const claim = i => h6(i, '請求の期限') + '<p>団信の保険金の請求は、亡くなった日の翌日から3年で時効になります（保険法95条）。</p></section>';
      if (insured) {
        say = '団信が付いているので、' + WHO + 'が亡くなると保険金で残りが返され、<b>家族が返す必要はありません</b>。保険金は家族ではなく借入先へ払われます。' +
          (l.who === 'pair' ? '借入は' + WHO + 'と' + SPOUSE + 'なので、団信で返されるのが' + WHO + 'の分だけのことがあります。借入先に確かめます。' : '');
        steps = [{ t: '借入先へ連絡し、団信の手続きをする', w: bank, s: '出す書類は借入先が案内する（死亡診断書の写しなど）' }]
          .concat(noLien ? [] : [{ t: '完済の書類を受け取る', w: bank, s: '解除証書・委任状など。抵当権の抹消に使う' }, drop('完済されても、')]);
        toc = '手続き中の引き落とし' + (noLien ? '' : '・抹消をしないと') + '・請求の期限';
        detail = h6(1, '手続き中の引き落とし') + '<p>銀行が死亡を知ると、' + WHO + 'の口座は入出金が止まります。手続きが終わるまでの返済の扱いは、最初の連絡のときに借入先に確かめます。</p></section>' +
          (noLien ? '' : h6(2, '抹消をしないと') + '<p>抹消の登記に期限はありませんが、残ったままだと売るときの決済に間に合わないことがあり、借入先が合併すると書類の取り直しに手間がかかります。</p></section>') +
          claim(noLien ? 2 : 3);
      } else if (uninsured) {
        say = '団信は付いていないので、残っている借入は<b>相続人が法定相続分で引き継ぎます</b>。';
        steps = [{ t: '借入先へ連絡し、残高を確かめる', w: bank },
          { when: '3か月以内', t: '引き継ぐか、相続放棄するかを決める', w: '家庭裁判所', s: '相続を知った日から数える。放棄すると、この家も受け取れない' },
          { t: '誰が返すかを決め、借入先と話す', w: bank, s: '相続人の間で1人が返すと決めても、借入先の承諾がないと他の相続人の返す義務は残る' }]
          .concat(noLien ? [] : [drop('返し終えても、')]);
        toc = '相続放棄'; detail = renounce;
      } else {
        say = '団信が付いているかの記録がありません。付いていれば家族は返さず、付いていなければ<b>相続人が引き継ぎます</b>。';
        steps = [{ t: '借入先へ連絡し、団信が付いているか確かめる', w: bank },
          { when: '付いていなければ3か月以内', t: '引き継ぐか、相続放棄するかを決める', w: '家庭裁判所', s: '放棄すると、この家も受け取れない' }]
          .concat(noLien ? [] : [drop('返し終えても、')]);
        toc = '相続放棄・請求の期限'; detail = renounce + claim(2);
      }
      out.push({ id: li ? 'loan' + (li + 1) : 'loan', ord: 36.5 + li / 100, icon: 'tsushin', nm: kind, eyebrow: insured ? '団信' : '',
        card: { say, secs: [{ lb: '順番', html: sv(steps) }], toc, detail } });
    });

    /* 貸している（正本 §3-6）… 主役は「貸主の立場は自動で移る」（借主の同意・
       結び直し不要）と、連絡する借主。すること3つは時期が違う。遺産分割までの
       家賃は各相続人が法定相続分で確定的に取得（最判平17.9.8）、敷金は家を継いだ
       人が返す、家賃収入があれば準確定申告4か月（所得税法125条）。 */
    const deals = p.deals || [];
    const lend = deals.filter(d => d.kind === 'lend');
    /* 無償で使わせている（使用貸借）だけなら、家賃・敷金・準確定申告の話は無い。
       貸主が亡くなっても使用貸借は終わらず、相続人へ移る（終わるのは借主の死亡：
       民法597条3項）。期間・目的を決めていなければ、貸主はいつでも終わらせられる（598条2項）。 */
    const lendFree = lend.length && lend.every(d => d.flow === 'none');
    if (owns && lendFree) {
      const who = lend.map(d => d.who || '借主').join('・');
      out.push({ id: 'lend', ord: 4, icon: 'keiyaku', nm: '無償で使わせている', eyebrow: '使用貸借',
        card: {
          say: '無償で使わせている関係（使用貸借）は、' + WHO + 'が亡くなっても終わらず、<b>貸す側の立場が相続人へ移ります</b>。',
          secs: [{ lb: '使っている人', html: lend.map(unit).join('') },
            { lb: 'すること', html: sv([
              { when: 'すぐ', t: WHO + 'が亡くなったことを知らせる', w: who },
              { when: '分割のあと', t: 'このまま使わせるかを、継いだ人が決めて伝える', w: who, s: '期間も使い道も決めていなければ、貸す側はいつでも終わらせられる' }]) },
            lend.some(d => d.paper !== 'none') ? { lb: 'そろえる書類', html: homeDoc('使用貸借の契約書', '期間・使い道の取り決めを確かめる', docAt('lend')) } : null].filter(Boolean),
          toc: '使用貸借が終わるとき',
          detail: h6(1, '使用貸借が終わるとき') + '<p>使っている人が亡くなると終わります（民法597条3項）。期間や使い道を決めていなければ、貸す側はいつでも終わらせられます（民法598条2項）。</p></section>' } });
    } else if (owns && lend.length) {
      const who = lend.map(d => d.who || '借主').join('・');
      out.push({ id: 'lend', ord: 4, icon: 'keiyaku', nm: '貸している契約', eyebrow: '賃貸',
        card: {
          say: '<b>貸主の立場は、そのまま相続人へ移ります</b>。借主の同意も、契約の結び直しも要りません。',
          secs: [{ lb: '借主', html: lend.map(unit).join('') },
            { lb: 'すること', html: sv([
              { when: 'すぐ', t: '借主へ知らせ、家賃の振込先を変える', w: who, s: WHO + 'の口座は、銀行が死亡を知ると入出金が止まる' },
              { when: '4か月以内', t: WHO + 'の分の確定申告（準確定申告）', w: '税務署', s: 'その年の家賃収入を含めて、相続人が出す' },
              { when: '分割のあと', t: '継いだ人を借主へ知らせる', w: who }]) },
            lend.some(d => d.paper !== 'none') ? { lb: 'そろえる書類', html: homeDoc('賃貸借契約書', '家賃・敷金・契約期間を確かめる', docAt('lend')) } : null].filter(Boolean),
          toc: '分割までの家賃・敷金・準確定申告',
          detail: h6(1, '分割までの家賃') + '<p>遺産分割がまとまるまでの家賃は、相続人それぞれが法定相続分で受け取ります。あとで分割がまとまっても、この分は分け直しません（最高裁 平成17年9月8日）。</p></section>' +
            h6(2, '敷金') + '<p>借主が出るときに返す敷金は、この家を継いだ人が返します。</p></section>' +
            h6(3, '準確定申告') + '<p>1月1日から亡くなった日までの' + WHO + 'の所得を、相続人が申告します。</p>' +
            src('https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2022.htm', '国税庁｜準確定申告') + '</section>' } });
    }

    /* 借地（正本 §3-6）… 主役は「承諾も名義書換料も要らない」（求められて払って
       しまうのを防ぐ。民法612条は譲渡・転貸で、相続は含まない）。相続人以外への
       遺贈は承諾が要る。建物が故人名義でも借地権は対抗できるが登記義務はかかる。 */
    const borrow = deals.filter(d => d.kind === 'borrow');
    /* 地代を払わず無償で借りている土地（使用貸借）は、借りている父が亡くなると終わる
       のが原則（民法597条3項）。借地権ではないので、承諾不要・引き継げるの話にならない。 */
    if (borrow.length && borrow.every(d => d.flow === 'none')) {
      const who = borrow.map(d => d.who || '地主').join('・');
      out.push({ id: 'borrow', ord: 99, icon: 'keiyaku', nm: '無償で借りている土地', eyebrow: '使用貸借',
        card: {
          say: '無償で借りている土地（使用貸借）は、<b>借りている' + WHO + 'が亡くなると終わるのが原則です</b>。地代を払う借地と違い、相続人はそのまま引き継げません。',
          secs: [{ lb: '地主', html: borrow.map(unit).join('') },
            { lb: 'すること', html: sv([
              { when: 'すぐ', t: '地主へ知らせ、建物と土地をどうするか話す', w: who, s: '使い続けるなら、地主と改めて取り決める' }]) },
            borrow.some(d => d.paper !== 'none') ? { lb: 'そろえる書類', html: homeDoc('使用貸借の契約書', '期間・使い道の取り決めを確かめる', docAt('borrow')) } : null].filter(Boolean),
          toc: '終わるのが原則',
          detail: h6(1, '終わるのが原則') + '<p>使用貸借は、借りている人が亡くなると終わります（民法597条3項）。ただ、建物を建てるための土地の貸し借りでは、事情から続くと判断された裁判例もあります。地主とよく話し合います。</p></section>' } });
    } else if (borrow.length) {
      const who = borrow.map(d => d.who || '地主').join('・');
      out.push({ id: 'borrow', ord: 99, icon: 'keiyaku', nm: '借地', eyebrow: '借地',
        card: {
          say: '相続人が引き継ぐなら、<b>地主の承諾も、名義書換料も要りません</b>。求められても、払う義務はありません。',
          secs: [{ lb: '地主', html: borrow.map(unit).join('') },
            { lb: 'すること', html: sv([
              { when: 'すぐ', t: '地主へ知らせ、地代の払い方を確かめる', w: who, s: WHO + 'の口座からの引き落としは、銀行が死亡を知ると止まる' },
              { when: '分割のあと', t: '継いだ人を地主へ知らせる', w: who, s: '承諾をもらう手続きではない。建物の相続登記で借地権も一緒に引き継ぐ' }]) },
            borrow.some(d => d.paper !== 'none') ? { lb: 'そろえる書類', html: homeDoc('借地契約書', '地代・契約期間・更新の時期を確かめる', docAt('borrow')) } : null].filter(Boolean),
          toc: '相続人以外に遺すとき・建物の登記',
          detail: h6(1, '相続人以外に遺すとき') + '<p>孫や相続人の配偶者など、相続人ではない人に遺言で渡すときは、地主の承諾が要ります。</p></section>' +
            h6(2, '建物の登記') + '<p>建物が' + WHO + 'の名義のままでも、土地が売られたとき新しい地主に借地権を主張できます。それでも相続登記の義務（3年）はかかります。</p></section>' } });
    }
    return out.sort((a, b) => a.ord - b.ord);
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
      return '<section class="rw is-' + esc(x.status) + '" data-now-row="' + esc(x.key) + '"><div class="rh">' +
        matterIcon(x.icon || x.key) +
        unitHead(x.nm, statusPick(p, x.type, x.key, x.status, x.nm, x.label), '') + '</div>' +
        (x.type === 'prior' ? priorBody(p) : x.body ? x.body(p) :
        '<div class="rw-record"><p>' + esc(x.summary) + '</p></div>' +
        (active && x.next ? '<div class="record-next"><span>次にすること</span><p>' + esc(x.next) + '</p>' +
          (context ? '<small>' + esc(context) + '</small>' : '') + '</div>' : '')) + '</section>';
    }).join('') + '</div>';
  }

  /* 今のうちの札（部屋の説明の下）。行は1つ目の途中までしか画面に入らず、
     何がいくつあるかはスクロールしないと分からなかった（2026-09-26）。
     行と同じ数の札を並べ、押すとその行の頭へ飛ぶ。行は全部並べたまま ――
     切り替えのタブにすると、部屋の中身の高さで決まる間取りの形が押すたびに変わる。
     部屋の上に張り付き、読んでいる行の札に印が付く（wire の spyNow）。
     札は小さな絵と短い名前だけ。状態は行のバッジが言う（絵の右上に状態の点を
     打ったが、小さな橙が赤い通知のしるしに見え、状態とは読めなかった）。 */
  /* 札の名前は短く。5枚（団信が不明のとき）でも部屋の幅（ウィンドウ幅1000で
     約435px）の1行に収める（2026-09-27）。建物・前の代は、すぐ下の行の見出しと
     図で何を指すか分かる。境界・越境と私道・配管は2つのことを含むので残す。 */
  const NOW_SHORT = { boundary: '境界・越境', road: '私道・配管', changed: '建物', prior: '前の代', loan: '団信' };
  function nowNav(rows) {
    return '<nav class="now-nav" aria-label="今のうちの項目"><div class="now-nav-in">' + rows.map(x => {
      const b = BADGE[x.status] || BADGE.unknown;
      return '<button type="button" class="now-go" data-now-go="' + esc(x.key) + '" aria-label="' +
        esc(x.nm + '（' + (x.label || b.label) + '）へ移動') + '">' + matterIcon(x.icon || x.key) +
        '<span class="now-go-nm">' + esc(NOW_SHORT[x.key] || x.nm) + '</span></button>';
    }).join('') + '</div></nav>';
  }

  /* ■ 相続登記のカード（2026-09-27）。tokiParts の置き場所ごとに描く。
     書類の絵は A4（1:1.414）の書面で実線だけ（点線は凡例なしでは読めず、
     「作る」と「場所が分からない」の2つの意味を兼ねていた）。
     くわしくは今のうちの .pr-dt と同じ形で、場面ごとに見出しを立てる。 */
  function tokiPaper(w) {
    return '<svg class="dk-p" width="' + w + '" height="' + (w * 1.414).toFixed(1) + '" viewBox="0 0 20 28.3" aria-hidden="true">' +
      '<rect x=".6" y=".6" width="18.8" height="27.1" rx=".8" fill="#FBFAF6" stroke="#9C9584" stroke-width="1"/>' +
      '<path d="M4 6h8M4 10h12M4 13.5h12M4 17h8" stroke="#D6D0C1" stroke-width="1" stroke-linecap="round"/></svg>';
  }
  function tokiDetail(t) {
    const h = (i, s) => '<section><h6><i>' + i + '</i>' + s + '</h6>';
    return h(1, '遺言が見つかったとき') +
      '<p>公正証書の遺言は公証役場で、法務局に預けた自筆の遺言は法務局で、あるかどうか調べられます。</p>' +
      '<p>家で<b>封のある自筆の遺言</b>を見つけたら、開けずに家庭裁判所の<b>検認</b>を受けます。勝手に開けると5万円以下の過料の対象になります（開けても遺言は無効になりません）。</p>' +
      '<p>遺言で取得する人が決まっていれば、その分は話し合いが要りません。</p></section>' +
      h(2, '間に合わないとき') +
      '<p>3年以内に話し合いがまとまらないときは、次のどちらかで義務を果たせます。</p>' +
      '<div class="pr-two"><div><small>相続人申告登記</small><p>申し出た人の義務が果たされる。登録免許税はかからない<br><span class="ng">名義は移らず、売れない</span></p></div>' +
      '<div><small>法定相続分での相続登記</small><p>相続人の一人が全員分を申請できる。登録免許税がかかる<br><span class="ng">全員の共有になり、売るには全員の同意が要る</span></p></div></div>' +
      '<p>どちらの場合も、話し合いがまとまったら、その日から3年以内に分割の結果で登記します。正当な理由なく怠ると、法務局からの催告に応じない場合に10万円以下の過料の対象になります。</p></section>' +
      h(3, '費用') +
      '<p><b>登録免許税</b>は、固定資産税評価額の0.4%です。評価額は毎年届く課税明細書に載っています。</p>' +
      (t.road ? '<p>固定資産税がかからない私道には評価額がないので、課税価格の出し方を法務局に確かめます。</p>' : '') +
      '<p>司法書士の報酬は平均で約7.5万円です（日本司法書士会連合会の令和6年の調べ。土地1筆・建物1棟・評価額1,000万円・相続人3人の場合）。' +
      (t.prior ? t.owner + 'の分も合わせた2人分の手続きになるので、これより増えます。' : '') + '</p>' +
      (t.survey ? '<p>建物の登記を直す費用（土地家屋調査士への報酬）が、これとは別にかかります。</p>' : '') + '</section>' +
      h(4, '自分で申請するとき') +
      '<p>申請書のひな形と記載例は、法務局のホームページにあります。法務局の<b>登記手続案内</b>（予約制・無料）で相談でき、郵送でも申請できます。</p>' +
      '<p>戸籍は、最寄りの市区町村の窓口でまとめて請求できます（広域交付。請求する人が窓口へ行きます。きょうだいの戸籍は対象外）。</p>' +
      '<p><a class="procedure-source" href="https://www.moj.go.jp/MINJI/minji05_00599.html" target="_blank" rel="noopener noreferrer">法務省｜相続登記の案内 ↗</a></p></section>';
  }
  function tokiHTML(x, key, open) {
    const t = x.toki;
    const doc = d => '<div class="dk-doc">' + tokiPaper(20) + '<div class="dk-t">' + esc(d.t) +
      (d.s ? '<span class="dk-s">' + esc(d.s) + '</span>' : '') +
      (d.at ? '<span class="dk-at">' + esc(d.at) + '</span>' : d.no ? '<span class="dk-at dk-no">' + esc(d.no) + '</span>' : '') + '</div></div>';
    const grp = (h, sub, xs, cls, fn) => xs.length ? '<div class="dk-h">' + h + (sub ? '<small>' + sub + '</small>' : '') + '</div>' +
      '<div class="dk-row ' + cls + '">' + xs.map(fn).join('') + '</div>' : '';
    const office = n => '<div class="dk-doc">' + tokiPaper(14) + '<div class="dk-t">' + esc(n) + '</div></div>';
    const docs = '<div class="dk">' + grp('家にある', '家族が取り出す', t.docs.home, 'big', doc) +
      grp('家族で作る', '', t.docs.make, 'big', doc) + grp('役所で取る', 'どの家でも同じ', t.docs.office, 'small', office) + '</div>' +
      '<p class="dk-not"><b>権利証（登記識別情報）は要りません。</b>売るときに使います。</p>';
    const steps = t.steps
      ? '<div class="sq">' + t.steps.map((s, i) => (i ? '<span class="sq-ar" aria-hidden="true">→</span>' : '') +
          '<div class="sq-step"><b>' + (i + 1) + '　' + esc(s.t) + '</b><small>' + esc(s.w) + '</small></div>').join('') + '</div>'
      : '<p class="sq-one">' + esc(t.who) + '</p>';
    return '<article class="procedure-sheet" data-now-row="' + esc(x.id) + '">' +
      '<header class="procedure-head">' + GLYPH.toki({ w: 25 }) + '<div><h5>' + esc(x.nm) + '</h5></div></header>' +
      '<div class="procedure-deadline">' + T_CAL + '<span><b>期限</b> ' + esc(x.lim) + '</span></div>' +
      '<p class="sw-say">' + t.say + '</p>' +
      '<div class="sw-sec"><p class="sw-lb">そろえる書類</p>' + docs + '</div>' +
      '<div class="sw-sec"><p class="sw-lb">' + (t.steps ? '順番' : '頼む先') + '</p>' + steps + '</div>' +
      '<div class="pr-dt' + (open ? ' open' : '') + '"><button type="button" class="pr-dt-t" data-procedure="' + esc(key) +
      '" aria-expanded="' + open + '"><span class="pr-dt-k">くわしく</span><span class="pr-dt-s">遺言が見つかったとき・間に合わないとき・費用・自分で申請するとき</span>' + PG.down + '</button>' +
      (open ? '<div class="pr-dt-b">' + tokiDetail(t) + '</div>' : '') + '</div></article>';
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
    /* 期限の順に並ぶので、先頭を大きくする差は付けない。相続登記は置き場所が
       多いので tokiHTML、ほかは card（一文・行・くわしく）を描く。 */
    return noStake + '<div class="procedure-sheets">' + rows.map(x => {
      const key = p.id + ':' + x.id;
      const expanded = openProcedures.has(key);
      return x.toki ? tokiHTML(x, key, expanded) : sheetHTML(x, key, expanded);
    }).join('') + '</div>';
  }
  function sheetHTML(x, key, open) {
    const c = x.card;
    return '<article class="procedure-sheet" data-now-row="' + esc(x.id) + '">' +
      '<header class="procedure-head">' + (GLYPH[x.icon] ? GLYPH[x.icon]({ w: 25 }) : '') +
      '<div>' + (x.eyebrow ? '<div class="procedure-eyebrow">' + esc(x.eyebrow) + '</div>' : '') +
      '<h5>' + esc(x.nm) + '</h5></div></header>' +
      (x.lim ? '<div class="procedure-deadline">' + T_CAL + '<span><b>期限</b> ' + esc(x.lim) + '</span></div>' : '') +
      '<p class="sw-say">' + c.say + '</p>' +
      c.secs.map(sc => '<div class="sw-sec"><p class="sw-lb">' + esc(sc.lb) + '</p>' + sc.html + '</div>').join('') +
      '<div class="pr-dt' + (open ? ' open' : '') + '"><button type="button" class="pr-dt-t" data-procedure="' + esc(key) +
      '" aria-expanded="' + open + '"><span class="pr-dt-k">くわしく</span><span class="pr-dt-s">' + esc(c.toc) + '</span>' + PG.down + '</button>' +
      (open ? '<div class="pr-dt-b">' + c.detail + '</div>' : '') + '</div></article>';
  }

  /* ── 部屋へ渡す入口 ──────────────────────────────
     v27 の .pane は「地」を背景に持つ div だったが、間取りでは
     部屋の床そのものが地なので、.pane は作らない。室名札が
     大見出しの役をし、その下に説明、白いカードが載る。            */
  function roomLiv(p) {
    /* 表札の下の説明文は置かない。「今のうち／そのとき」は SeiZen 全体の言葉で、
       部屋ごとに言い直さない。なぜ今のうちかは各行の一文が言う（2026-09-26）。 */
    return roomTag('liv', '今のうち', tagCounts(nowRows(p))) + nowNav(nowRows(p)) + nowHTML(p);
  }
  function roomWhen(p) {
    const rows = goneRows(p);
    return roomTag('when', 'そのとき', { act: 0 }) + (rows.length > 1 ? whenNav(rows) : '') + whenHTML(p);
  }
  /* そのときの札（2026-09-27）。今のうちの札（nowNav）と同じ仕組み：カードと
     同じ数の札を期限の順に並べ、押すとそのカードの頭へ飛ぶ。部屋の上に張り付き、
     読んでいるカードの札に印（spyNow）。絵はカードの頭と同じ書面。1枚だけの
     ときは出さない（飛ぶ先が目の前にある）。 */
  /* 札の名前は短く（今のうちの NOW_SHORT と同じ考え方）。5枚立っても部屋の
     幅（ウィンドウ幅1000〜1440で約435〜450px）の1行に収める。 */
  const WHEN_SHORT = { toki: '相続登記', todoke: '現所有者の申告', loan: 'ローン', lend: '貸している', borrow: '借地' };
  function whenNav(rows) {
    return '<nav class="now-nav when-nav" aria-label="そのときの手続き"><div class="now-nav-in">' + rows.map(x =>
      '<button type="button" class="now-go" data-now-go="' + esc(x.id) + '" aria-label="' + esc(x.nm + 'へ移動') + '">' +
        (GLYPH[x.icon] ? GLYPH[x.icon]({ w: 12 }) : '') + '<span class="now-go-nm">' + esc(WHEN_SHORT[x.id] || x.nm) + '</span></button>').join('') +
      '</div></nav>';
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
  /* ■ 2026-09-28｜見比べる1枚（見本 `_検討/権利関係とローン契約_表示v9.html`）

     「ただ羅列しているだけ」と言われ、v1〜v9 で組み直した。土地と建物は
     同じ問いを持つ対なので、2列を土台に問いの見出しを1回だけ出し、値を
     横に並べる（ローン・契約の帯のカードは「相手」の形なので写さない）。
       列の頭 … 絵（土地・建物）＋名前、その下に「登記と合っているか」
               （いちばん先に目に入るべきもの。点つきの字で、枠の札にしない）
       問い   … 名義／登記を見ても分からないこと／名義を得たときの紙
     登記を見ても分からないことは、今のうち・そのときの行の答えを映すだけで、
     説明は向こうのカードが持つ。紙の有無は物件に1つ
     （docs.at.deed・acquire、書類のありかのフォームで聞く）なので2列をまたぐ。 */
  /* 登記と違うところの文（2026-09-28）。何が違うかは state.js の rightCheck が
     答えから決める（権利関係のフォーム・前の代の相続登記・建物の変更・登記のどれで
     答えても同じ記録）。文はそれだけで読めるように書き、上段の行へ飛ぶ行き先は
     付けない ―― 名義の下に何が違うかが書いてあれば、飛ぶ先は要らなかった。 */
  function rightGap(p, k, r) {
    if (r.hold === 'lease') return ['借地権は登記されないことが多く、登記を見ても' + WHO + 'が借りていることは分からない。'];
    const { gaps } = S.rightCheck(p, k), out = [];
    if (gaps.some(g => g.key === 'prior')) out.push('前の代の名義のまま。' + priorStageLine(priorCase(p))[1] + '。');
    const grow = gaps.filter(g => g.c && S.chGrow(g.c.what)).map(g => chName(g.c));
    const gone = gaps.filter(g => g.c && !S.chGrow(g.c.what)).map(g => chName(g.c));
    if (grow.length) out.push(grow.join('・') + 'が登記に載っていない。');
    if (gone.length) out.push(gone.join('・') + 'が登記に残っている。');
    if (gaps.some(g => g.diff)) out.push('課税明細書と登記で床面積が違う。');
    return out;
  }
  function rightMark(p, k, r) {
    if (r.hold === 'lease') return ['登記に出ない', 1];
    const c = S.rightCheck(p, k);
    if (c.gaps.length) return ['登記と違う', 1];
    if (c.unsure) return ['未確認', 1];
    return ['登記どおり', 'ok'];
  }
  /* 点つきの字。tone＝'ok'（済み：緑）／1（気をつける：橙）／0（途中：灰）。
     以前は橙とそれ以外の2つで、登記どおり・ある（済み）が確認中と同じ灰に見えていた。
     ページのほかの「済み」（確認済み・登記済み）と同じく緑にする（2026-09-28）。 */
  /* この家のローン・借入（1件ずつ）。「ある」と答えたときだけ。 */
  const loanItems = p => p.loan && p.loan.has === 'yes' ? p.loan.items || [] : [];
  const mark = (t, tone) => '<span class="mk' + (tone === 'ok' ? ' ok' : tone ? ' warn' : '') + '">' + esc(t) + '</span>';
  /* 部屋の中の見出し（権利関係・ローン・契約）。白い小枠の絵＋題＋一言＋入口。 */
  function sceneHead(icon, title, lead, right) {
    return '<div class="sc-h"><span class="sc-ic">' + (ICONS[icon] || '') + '</span><h4>' + esc(title) + '</h4>' +
      (lead ? '<small>' + esc(lead) + '</small>' : '') + (right || '') + '</div>';
  }
  const PEN_SM = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13l.6-2.9L10.8 2.9a1.2 1.2 0 0 1 1.7 0l.6.6a1.2 1.2 0 0 1 0 1.7L5.9 12.4Z"/><path d="M9.6 4.1l2.3 2.3M3 13h10"/></svg>';
  function penButton(p, type, key, what) {
    return '<button type="button" class="pen-edit" data-edit-p="' + esc(p.id) + '" data-edit-type="' + esc(type) +
      '" data-edit-key="' + esc(key) + '" aria-label="' + esc(what + 'を記録') + '">' + PEN_SM + '</button>';
  }
  const PAPER_ST = { have: ['ある', 'ok'], lost: ['見つからない', 1], unknown: ['未確認', 1] };
  function roomRights(p) {
    const keys = (p.kind === 'condo' ? ['bldg'] : p.kind === 'land' ? ['land'] : ['land', 'bldg'])
      .filter(k => p.rights[k]);
    const name = k => k === 'land' ? '土地' : p.kind === 'condo' ? '専有部分' : '建物';
    const cols = keys.map(k => ({ k, r: p.rights[k] }));
    const two = f => cols.map((c, i) => '<div class="rk-c' + (i ? ' c2' : '') + '">' + f(c) + '</div>').join('');
    const head = c => {
      const [t, w] = rightMark(p, c.k, c.r);
      return '<div class="rk-h' + (cols.indexOf(c) ? ' c2' : '') + '">' + penButton(p, 'right', c.k, name(c.k) + 'の権利関係') +
        '<div class="rk-ht"><span class="rk-ic">' + ICONS[c.k === 'land' ? 'land' : 'house'] + '</span><b>' + esc(name(c.k)) + '</b></div>' +
        mark(t, w) + '</div>';
    };
    const owner = ({ k, r }) => {
      const lease = r.hold === 'lease';
      /* 地主は契約の相手（借りている）が持つ（権利関係のフォームで書いても、そこへ入る）。 */
      const lord = (p.deals || []).filter(d => d.kind === 'borrow' && d.who).map(d => d.who).join('・') || r.owner;
      const sub = lease ? '登記の名義は地主' + (lord ? '（' + lord + '）' : '')
        : [(HOLD[r.hold] || HOLD.own).label, r.shares].filter(Boolean).join('・') + (k === 'bldg' && p.built ? '・' + p.built + '築' : '');
      return '<div class="rk-nm">' + esc(lease ? '借地' : r.owner || '未記録') + '</div><div class="rk-sub">' + esc(sub) + '</div>' +
        (r.memo ? '<div class="rk-memo">' + esc(r.memo) + '</div>' : '');
    };
    const gap = ({ k, r }) => {
      const g = rightGap(p, k, r);
      if (g.length) return g.map(t => '<p class="rk-tx">' + esc(t) + '</p>').join('');
      return '<p class="rk-tx none">' + (S.rightCheck(p, k).unsure ? 'まだ確かめていない' : 'ない') + '</p>';
    };
    const at = p.docs.at || {};
    const papers = ['deed', 'acquire'].map(key => {
      const [t, w] = PAPER_ST[(at[key] || {}).st] || PAPER_ST.unknown;
      return '<div class="rk-pp"><span>' + esc(S.DOC_KINDS[key].label) + '</span>' + mark(t, w) + '</div>';
    }).join('');
    const q = t => '<div class="rk-q">' + esc(t) + '</div>';
    return sceneHead('right', '権利関係', '土地と建物の名義') +
      '<div class="rk" style="--n:' + cols.length + '">' + cols.map(head).join('') +
        q('名義') + two(owner) +
        q('登記内容と違うところ') + two(gap) +
        q('書類') + '<div class="rk-c rk-span">' + papers + '</div>' +
      '</div>';
  }

  /* ■ 2026-09-28｜ローン・契約（見本 v9）。1件＝相手なので、頭に帯を持つカード
     （医療の「いつもの通院」の組み方。帯は薄い緑の地に濃い緑の字 ―― 濃い地だと
     部屋でいちばん強い面になり、中身より先に目に入った）。
       ローン … 帯＝借入の種類＋団信（点つきの字）。体＝借入先・借りている人、
                項目名｜値（担保・電話・メモ）。他の人の借入の担保（物上保証）は別のカード
       契約   … 帯＝関係＋入口。体＝相手・内容、電話・お金の向き
     担保を借入から独立させた経緯（2026-09-22 調査 §7-2b）：借入が無くても、
     他人の借入のために自分の不動産を担保に出す「物上保証」がある。 */
  const BAND = '<svg class="lc-band" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true"><rect width="120" height="40"/></svg>';
  const TEL_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1Z"/></svg>';
  function lcCard(c) {
    return '<div class="lc"><div class="lc-h">' + BAND + '<span class="lc-k">' + esc(c.band) + '</span>' + (c.right || '') + '</div>' +
      '<div class="lc-b"><div class="lc-nm">' + esc(c.nm) + '</div>' + (c.sub ? '<div class="lc-sub">' + esc(c.sub) + '</div>' : '') +
      (c.kv && c.kv.length ? '<dl class="lc-kv">' + c.kv.map(([k, v, cls]) => '<dt>' + esc(k) + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</dd>').join('') + '</dl>' : '') +
      '</div></div>';
  }
  const telDD = t => TEL_IC + esc(t);
  const DEAL_BAND = { manage: '管理を頼んでいる', lend: '貸している', borrow: '借りている（地主）' };
  function roomParty(p) {
    /* ローンの部屋（2026-09-28）。借入1件に1枚。見出しは種類、名前は借入先、その下に
       借りている人。会社・親族の借入にこの家を担保として入れているものも同じ形の1枚
       （借りている人がその名前になるだけ。別の呼び名を付けない）。
       返し終えて抵当権が残っていれば、次にすることまで言う（自動では消えない）。 */
    const l = p.loan || {};
    let loan = '';
    const WHO_LN = { self: WHO + '（単独）が借りている', pair: WHO + 'と' + SPOUSE + 'が借りている' };
    loanItems(p).forEach(it => {
      const mine = it.who !== 'other';
      const right = it.paid ? mark('返し終えた', 0) : !mine ? '' :
        mark(...({ yes: ['団信あり', 'ok'], no: ['団信なし', 1] }[it.gtee] || ['団信 未確認', 1]));
      const lien = it.paid
        ? ({ no: ['抹消した', ''], yes: ['まだ登記に残っている。借入先から解除証書を受け取り、抹消の登記をする', 'q'] }[it.lien] || ['抹消したか、まだ確かめていない', 'q'])
        : ({ yes: ['この家に抵当権', ''], no: ['付いていない（この家は担保ではない）', ''] }[it.lien] || ['まだ確かめていない', 'q']);
      const kv = [['抵当権', esc(lien[0]), lien[1]]];
      if (it.tel && !it.paid) kv.push(['電話', telDD(it.tel), 'tel']);
      loan += lcCard({ band: it.type || '借入', right, nm: it.bank || '借入先が未記録',
        sub: it.who === 'other' ? (it.whoName || '誰の借入か未記録') + 'が借りている' : WHO_LN[it.who] || '借りている人をまだ確かめていない', kv });
    });
    if (l.has !== 'yes') loan += '<div class="lc-note"><p>' + (l.has === 'no' ? 'この家のローン・借入はない。' : 'ローン・借入があるか、まだ確かめていない。') + '</p></div>';
    if (l.memo) loan += '<div class="lc-note"><p><small>' + esc(l.memo) + '</small></p></div>';
    const deals = (p.deals || []).map((d, i) => {
      const flow = ({ lend: { recv: '家賃を受け取っている', none: '無償で使わせている（使用貸借）' },
        borrow: { pay: '地代を払っている', none: '無償で借りている（使用貸借）' } }[d.kind] || {})[d.flow];
      /* 状態は、家族が連絡できるか（相手と電話）。足りないものをそのまま言う。 */
      const st = !d.who ? mark('相手が未記録', 1) : !d.tel ? mark('電話が未記録', 1) : '';
      const kv = [];
      if (d.tel) kv.push(['電話', telDD(d.tel), 'tel']);
      if (flow) kv.push(['お金', esc(flow)]);
      return lcCard({ band: DEAL_BAND[d.kind] || (DEALS[d.kind] || DEALS.manage).label, nm: d.who || '相手が未記録', sub: d.what || '', kv,
        right: st + penButton(p, 'deal', String(i), d.who || '契約の相手') });
    }).join('');
    return '<div class="lc-room"><div class="lc-sc">' + sceneHead('loan', 'ローン・借入', 'この家に付いている借入', penButton(p, 'loan', 'loan', '借入')) + loan + '</div>' +
      '<div class="lc-sc">' + sceneHead('deal', '契約', '続いている相手',
        '<button type="button" class="lc-add" data-edit-p="' + esc(p.id) + '" data-edit-type="deal" data-edit-key="new">＋ 追加</button>') +
      (deals || '<p class="lc-none">記録されている契約はない。</p>') + '</div></div>';
  }

  /* ══ 書類のありか（2026-09-28 見本 `_検討/書類のありか_表示v4.html`）══════════
     このページの区分が「書面がある」と言った紙を集め、どこにあるかを示す一覧。
     なぜ要るか・いつ使うかは紙を使う側の行（今のうち・そのとき）が言っているので、
     ここでは言わない（v1 で説明・くわしくを載せて、部屋の役目を取り違えた）。
       段 … 紙が生まれた区分（有無を答えた区分）：今のうち／権利関係／ローン・契約。
            そのときは紙を使う側なので段にしない（段にすると協議書・工事の書類が2か所に出る）。
       行 … 束ごと（隣ごと・相手ごと・工事ごと）。紙の絵｜名前（どれのものか）／所在。
            1列で並べる（v3 の2列は幅が足りず、名前が折れて所在の札が別段になった）。
     権利証・買ったときの契約書は権利関係の紙として置く。有無を権利関係で答える形はまだ
     無いので、それまではここのフォームで有無も聞く。
     束の記録は docs.at に「区分:束の中身」の鍵で持つ（隣の向き・相手・工事の中身。
     並び順の番号にすると、件を消したときに別の束の場所になる）。 */
  const DC_RED = '#C0574E', DC_LINE = '#D9D3C4', DC_EDGE = '#A8A08C';
  const dcR = (ys, a, b) => ys.map(y => '<line x1="' + a + '" y1="' + y + '" x2="' + b + '" y2="' + y + '" stroke="' + DC_LINE + '" stroke-width=".8" stroke-linecap="round"/>').join('');
  const dcSvg = inner => '<svg class="dc-fig" viewBox="0 0 32 44" width="30" height="41.3" aria-hidden="true">' + inner + '</svg>';
  /* 用紙は A4（1:1.414）＝ 24×34 を (4,5) に。 */
  const dcSheet = (x, y, fill) => '<rect x="' + x + '" y="' + y + '" width="24" height="34" rx=".8" fill="' + (fill || '#FFFFFF') + '" stroke="' + DC_EDGE + '" stroke-width=".8"/>';
  const dcTitle = (x, w) => '<rect x="' + x + '" y="8" width="' + w + '" height="1.8" rx=".4" fill="#CFC7B2"/>';
  const dcSeal = (cx, cy, r, op) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r || 1.7) + '" fill="none" stroke="' + DC_RED + '" stroke-width=".8" opacity="' + (op || .85) + '"/>';
  /* 紙の種類ごとに、実物で見分けがつく印を入れる。 */
  const DC_PAPER = {
    /* 権利証：綴じた束＋「登記済」の二重枠の朱印 */
    deed: dcSvg(dcSheet(8, 8, '#F4F1E8') + dcSheet(6, 6.5, '#F8F6EF') + dcSheet(4, 5) +
      '<rect x="4" y="5" width="3" height="34" fill="#ECE6D6"/><line x1="5.5" y1="9" x2="5.5" y2="12" stroke="#8E8676" stroke-width=".9"/><line x1="5.5" y1="31" x2="5.5" y2="34" stroke="#8E8676" stroke-width=".9"/>' +
      '<rect x="9.5" y="8" width="8" height="1.8" rx=".4" fill="#CFC7B2"/>' + dcR([14, 17, 20, 23.5, 27, 30.5], 9.5, 25) +
      '<rect x="19.2" y="7.4" width="6" height="6" fill="#FFF" stroke="' + DC_RED + '" stroke-width=".9"/><rect x="20" y="8.2" width="4.4" height="4.4" fill="none" stroke="' + DC_RED + '" stroke-width=".5"/>' +
      '<line x1="21" y1="9.7" x2="23.4" y2="9.7" stroke="' + DC_RED + '" stroke-width=".7"/><line x1="21" y1="11.2" x2="23.4" y2="11.2" stroke="' + DC_RED + '" stroke-width=".7"/>'),
    /* 遺産分割協議書：本文の下に、相続人全員の実印が横一列 */
    split: dcSvg(dcSheet(4, 5) + dcTitle(10, 12) + dcR([13, 16, 19, 22, 28], 7, 25) +
      dcSeal(9, 32.5) + dcSeal(14, 32.5) + dcSeal(19, 32.5) + dcSeal(24, 32.5, 1.7, .6)),
    /* 遺言書：封筒の表書きと、閉じ目の封印 */
    will: dcSvg('<rect x="3" y="7" width="26" height="31" rx=".8" fill="#FBF9F3" stroke="' + DC_EDGE + '" stroke-width=".8"/>' +
      '<path d="M3 13.5 16 20.5 29 13.5" fill="none" stroke="' + DC_EDGE + '" stroke-width=".8"/>' +
      '<line x1="16" y1="24" x2="16" y2="34" stroke="#8E8676" stroke-width="1.2" stroke-linecap="round"/>' + dcSeal(16, 20.5, 1.6)),
    /* 契約書（工事請負・売買）：左上に収入印紙（ギザ縁）、下に甲乙の丸印 */
    contract: dcSvg(dcSheet(4, 5) + dcTitle(12, 10) +
      '<path d="M6.6 7.4h.6l.4-.5.4.5h.6l.4-.5.4.5h.6v5.4h-.6l-.4.5-.4-.5h-.6l-.4.5-.4-.5h-.6Z" fill="#E4DCC6" stroke="#B3A987" stroke-width=".5"/>' +
      dcR([15, 18, 21, 24, 27], 7, 25) + dcSeal(20, 32, 1.8) + dcSeal(24.4, 32, 1.8, .6)),
    /* 境界確認書・測量図：区画の線と境界点、隣と2つの印 */
    survey: dcSvg(dcSheet(4, 5) + dcTitle(10, 12) +
      '<path d="M8.5 13.5 21 12.5 23 24 9.5 25.5Z" fill="none" stroke="#8E8676" stroke-width=".8"/>' +
      '<line x1="15" y1="13" x2="16.3" y2="25" stroke="#8E8676" stroke-width=".8" stroke-dasharray="1.4 .9"/>' +
      '<circle cx="15" cy="13" r=".9" fill="#8E8676"/><circle cx="16.3" cy="25" r=".9" fill="#8E8676"/>' + dcSeal(10, 33) + dcSeal(22, 33)),
    /* 覚書・承諾書：短い本文と、当事者の署名と印 */
    memo: dcSvg(dcSheet(4, 5) + dcTitle(11, 10) + dcR([13, 16, 19], 7, 25) +
      dcR([25, 30], 7, 19) + dcSeal(22.4, 24.8, 1.5) + dcSeal(22.4, 29.8, 1.5)),
    /* 役所の証明書：本文の下に認証文と、市区町村長の角印 */
    cert: dcSvg(dcSheet(4, 5) + dcTitle(11, 10) + dcR([13, 16, 19, 22], 7, 25) + dcR([28.5], 7, 17) +
      '<rect x="19.5" y="26.5" width="5" height="5" fill="none" stroke="' + DC_RED + '" stroke-width=".8" opacity=".85"/>'),
    /* 賃貸借・借地の契約書：甲乙の丸印が縦に2つ */
    lease: dcSvg(dcSheet(4, 5) + dcTitle(10, 12) + dcR([13, 16, 19, 22, 25], 7, 25) + dcR([30, 34], 7, 17) + dcSeal(21.5, 30, 1.8) + dcSeal(21.5, 34, 1.8, .6))
  };
  /* 所在の札の絵：家の中＝家／貸金庫＝金庫の扉／預けている＝人／まだ＝？ */
  const dcIc = inner => '<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">' + inner + '</svg>';
  const DC_AT = {
    home: { label: '家の中', ic: dcIc('<path d="M3.5 9.2 10 3.6l6.5 5.6V16.4H3.5Z" fill="#F3F6F1" stroke="#4F7358" stroke-width="1.3" stroke-linejoin="round"/><rect x="8.3" y="11.2" width="3.4" height="5.2" fill="none" stroke="#4F7358" stroke-width="1.1"/>') },
    safe: { label: '貸金庫', ic: dcIc('<rect x="3" y="3.5" width="14" height="13" rx="1.2" fill="#F3F6F1" stroke="#4F7358" stroke-width="1.3"/><circle cx="11" cy="10" r="3" fill="none" stroke="#4F7358" stroke-width="1.1"/><line x1="11" y1="7" x2="11" y2="8.3" stroke="#4F7358" stroke-width="1"/><line x1="5.6" y1="8" x2="5.6" y2="12" stroke="#4F7358" stroke-width="1.4" stroke-linecap="round"/><line x1="5" y1="16.5" x2="5" y2="17.8" stroke="#4F7358" stroke-width="1.2"/><line x1="15" y1="16.5" x2="15" y2="17.8" stroke="#4F7358" stroke-width="1.2"/>') },
    kept: { label: '預けている', ic: dcIc('<circle cx="10" cy="6.6" r="3" fill="#F3F6F1" stroke="#4F7358" stroke-width="1.3"/><path d="M4 17c.4-3.6 3-5.6 6-5.6s5.6 2 6 5.6Z" fill="#F3F6F1" stroke="#4F7358" stroke-width="1.3" stroke-linejoin="round"/>') },
    blank: { ic: dcIc('<path d="M6.5 5h10v10h-10L3 10Z" fill="#FBF8F1" stroke="#B8AD95" stroke-width="1.2" stroke-linejoin="round"/><circle cx="7.4" cy="10" r="1.2" fill="none" stroke="#B8AD95" stroke-width="1"/>') },
    none: { ic: dcIc('<circle cx="10" cy="10" r="7" fill="#FBF6EC" stroke="#C9A36A" stroke-width="1.2"/><path d="M8 8.2a2 2 0 1 1 2.8 1.9c-.5.3-.8.6-.8 1.3" fill="none" stroke="#A7792F" stroke-width="1.2" stroke-linecap="round"/><circle cx="10" cy="13.6" r=".8" fill="#A7792F"/>') }
  };
  const DC_CH = { confirm: '確認済証', inspect: '検査済証', contract: '工事請負契約書', receipt: '領収書', handover: '工事完了引渡証明書' };
  /* 束の鍵（区分:中身）。 */
  const dcKey = {
    boundary: e => 'boundary:' + (e.side || '') + ':' + (e.who || ''),
    road: l => 'road:' + l.land + ':' + (l.who || ''),
    changed: c => 'changed:' + c.what + ':' + (c.when || '') + ':' + (c.side || '') + ':' + (c.where || '')
  };
  /* 記録（束の鍵に無ければ、以前の区分ごとの1件を読む）。 */
  function docRec(p, key) {
    const at = p.docs.at || {};
    return at[key] || (key.includes(':') ? at[key.split(':')[0]] : null) || {};
  }
  /* 場所の字（そのときの「家にある」が読む）。探したが無い・未確認は空。 */
  function docPlace(p, key) {
    const d = docRec(p, key);
    return d.place && (d.st === 'have' || key.includes(':')) ? d.place : '';
  }
  /* 工事の書類の場所（書類がある増える変更のうち、場所が分かっている最初の1件）。 */
  function changedPlace(p) {
    const m = p.matters.changed || {};
    const c = (m.has === 'yes' ? m.changes || [] : []).find(c => S.chGrow(c.what) && c.reg !== 'yes' && c.docs === 'yes' && docPlace(p, dcKey.changed(c)));
    return c ? docPlace(p, dcKey.changed(c)) : '';
  }

  /* 段ごとの紙。{ label, rows:[{ key, fig, n, q, own }] }（own＝有無もここで聞く紙）。 */
  function docShelves(p) {
    const now = [], rights = [], deals = [];
    const pr = p.priorInheritance || {};
    if (pr.remains === 'yes' && pr.taker !== 'other' && pr.stage !== 'registered' && S.priorParty(pr) === WHO) {
      const owner = (S.priorOwner(p) || '前の代').replace(/（故人）$/, '');
      if (S.priorRoute(pr) === 'split' && pr.stage === 'signed') now.push({ key: 'prior', fig: 'split', n: owner + 'の遺産分割協議書・印鑑証明書' });
      if (S.priorRoute(pr) === 'will') now.push({ key: 'priorWill', fig: 'will', n: owner + 'の遺言書' });
    }
    const b = p.matters.boundary || {};
    const bdFig = kinds => (kinds || []).some(k => k === 'confirm' || k === 'map') ? 'survey' : 'memo';
    if (b.deal === 'unknown' && b.paper === 'yes') now.push({ key: 'boundary', fig: bdFig(b.docKinds), n: docName(b.docKinds), q: '境界' });
    if (b.deal === 'yes') (b.entries || []).filter(e => e.paper === 'yes').forEach(e =>
      now.push({ key: dcKey.boundary(e), fig: bdFig(e.docKinds), n: docName(e.docKinds), q: (SIDE[e.side] || '隣') + (e.who ? ' ' + e.who : '') }));
    const r = p.matters.road || {};
    if (r.has === 'yes') (r.links || []).filter(l => l.pact === 'paper').forEach(l =>
      now.push({ key: dcKey.road(l), fig: 'memo', n: '承諾書・覚書', q: rdName(l) }));
    const m = p.matters.changed || {};
    if (m.has === 'yes') (m.changes || []).filter(c => S.chGrow(c.what) && c.reg !== 'yes' && c.docs === 'yes').forEach(c => {
      const k = (c.kinds || []).map(x => DC_CH[x]).filter(Boolean);
      now.push({ key: dcKey.changed(c), fig: 'contract', n: k.length ? k.join('・') : '工事の書類', q: chName(c) });
    });
    rights.push({ key: 'deed', fig: 'deed', n: '権利証', q: '登記済証・登記識別情報', own: true });
    rights.push({ key: 'acquire', fig: 'contract', n: '買ったとき・建てたときの契約書・領収書', own: true });
    const who = kind => (p.deals || []).filter(d => d.kind === kind).map(d => d.who).filter(Boolean).join('・');
    /* 契約書は、契約のフォームで「口約束のまま」と答えた相手だけのときは出さない。 */
    const paper = kind => (p.deals || []).some(d => d.kind === kind && d.paper !== 'none');
    const free = kind => (p.deals || []).filter(d => d.kind === kind).every(d => d.flow === 'none');
    if (paper('lend')) deals.push({ key: 'lend', fig: 'lease', n: free('lend') ? '使用貸借の契約書' : '賃貸借契約書', q: who('lend') });
    if (paper('borrow')) deals.push({ key: 'borrow', fig: 'lease', n: free('borrow') ? '使用貸借の契約書' : '借地契約書', q: who('borrow') });
    return [{ label: '今のうち', rows: now }, { label: '権利関係', rows: rights }, { label: 'ローン・契約', rows: deals }].filter(x => x.rows.length);
  }
  /* 役所で取る書類（そのときの相続登記がそろえるもの）。取ったあとは家のどこかに
     しまうので、ほかの紙と同じく場所を記録する（取る先を出していたのは、保管場所を
     「家の中を探す紙」に限ると取り違えたため）。記録が無いうちは「まだ取っていない」
     ―― 父の除票のように、父が亡くなるまで存在しない紙もある。
     どの家でも同じ紙なので、段は開閉にして最初は閉じる。 */
  const openDocOffice = new Set();          // 役所で取る書類を開いている物件 id
  /* 取り方（まだ取っていない行の「？」から吹き出しで出す）。
     戸籍は2024年3月から最寄りの市区町村でまとめて取れる（広域交付。直系の家族が請求でき、
     郵送は不可）。除票は最後の住所の市区町村（郵送可）。印鑑証明書は各自の住所の市区町村
     （マイナンバーカードでコンビニ交付）。評価証明書は登録免許税の計算に使うので、
     申請する年度のもの。評価証明書・名寄帳は物件のある市区町村（東京23区は都税事務所）。 */
  function officeHow(p, n) {
    const addr = p.addr || '';
    const ward = (addr.match(/横浜市(.+?区)/) || [])[1];
    const here = /^東京都.+?区/.test(addr) ? '物件のある区の都税事務所'
      : ward ? ward + '役所' : /長岡市/.test(addr) ? '長岡市役所' : '物件のある市区町村';
    if (/^戸籍/.test(n)) return '最寄りの市区町村の窓口で、まとめて取れます（広域交付。請求する人が窓口へ行きます）。郵送で頼むときは本籍地の市区町村へ。';
    if (/^住民票の除票/.test(n)) return '亡くなった人の最後の住所の市区町村で取ります。郵送でも頼めます。';
    if (/^印鑑証明書/.test(n)) return '相続人がそれぞれ、自分の住所の市区町村で取ります。マイナンバーカードがあればコンビニでも取れます。';
    if (/^固定資産評価証明書/.test(n)) return here + 'で取ります。登記を申請する年度のものを使います。';
    if (/^名寄帳/.test(n)) return here + 'の固定資産税の窓口で取ります。';
    return '';
  }
  function officeDocs(p) {
    if (!fatherStake(p)) return [];
    return tokiParts(p).docs.office.map(n => ({ key: 'office:' + n.replace(/（.*$/, ''), fig: 'cert', n, office: true, how: officeHow(p, n) }));
  }
  /* 権利証・買ったときの契約書の「？」から出すこと。紙の説明で止めず、どう手に入れるか
     （誰に聞く・どこに頼む・何で代わりにする）を先に書く。
     まだ確かめていない … 父に聞いて探す＋探す紙の見た目／写しを頼む先
     探したが無い       … 代わりの手に入れ方
     権利証は再発行されない。売る・担保に入れるときは司法書士の本人確認情報か法務局の
     事前通知で代わりにする（法務局「登記識別情報を紛失したとき」）。売買契約書は、買った
     不動産会社・売主に写しが残っていればもらえる。無ければ通帳の振込記録・ローンの書類・
     抵当権設定登記の債権額・購入時のパンフレットで代わりにし、何もなければ売った額の5%
     （国税庁 No.3258）。 */
  const DC_TIP = {
    deed: {
      look: '父に、しまった場所を聞いて探します。2005年3月より前の登記なら、司法書士の表紙で綴じた冊子で、中の紙に「登記済」の朱印があります。2008年7月より後はA4の登記識別情報通知で、その間はどちらもあります。目隠しシールや折り込みは開けません。',
      lost: '再発行はされません。売る・担保に入れるときに、司法書士に本人確認情報を作ってもらいます（報酬がかかります）。法務局から届く事前通知に答える方法もあります（手数料なし・2週間以内に答える）。相続登記には使いません。' },
    acquire: {
      look: '父に、しまった場所を聞いて探します。見つからなければ、買った不動産会社（建てた家なら建築会社）に写しが残っていないか頼みます。相続で受け継いだ家なら、前の持ち主が買ったときのものを探します。',
      lost: '買った不動産会社（建てた家なら建築会社）に、写しが残っていないか頼みます。無ければ、代金を払った通帳の記録、住宅ローンの契約書、登記に載っている抵当権の債権額、分譲のときのパンフレットを集めて代わりにします。何もなければ、売った額の5%で計算します。' }
  };
  let dcPopN = 0;                           // 吹き出しの id（間取りと狭い幅の一覧で同じ行を2回描く）
  function roomDocs(p) {
    const row = d => {
      const rec = docRec(p, d.key);
      const at = DC_AT[rec.kind] ? rec.kind : 'home';
      const placed = d.own ? rec.st === 'have' && rec.place : rec.place;
      /* 場所が無いときの状態と、「？」から出すこと（カーソルを合わせる・押す・
         キーボードで選ぶ、のどれでも開く）。
           まだ取っていない（役所）     … 取り方
           あるか、まだ確かめていない   … 誰に聞いて探すか・頼む先（DC_TIP）
           探したが無い                 … 代わりの手に入れ方
           場所がまだ（書面はある紙）   … 言えるのは「父に聞く」だけなので、「？」に
                                          せず空の札の印にする */
      const lost = d.own && rec.st === 'lost', unsure = d.own && rec.st !== 'have' && !lost;
      const text = d.office ? 'まだ取っていない' : lost ? '探したが無い' : unsure ? 'あるか、まだ確かめていない' : '場所がまだ';
      const tip = d.office ? d.how : lost ? DC_TIP[d.key].lost : unsure ? DC_TIP[d.key].look : '';
      const pid = 'dcp' + (++dcPopN);
      const mark = tip
        ? '<span class="dc-qw"><button type="button" class="dc-q" aria-expanded="false" aria-describedby="' + pid + '" aria-label="' + esc(d.n) +
          (d.office ? 'の取り方' : lost ? 'が無いときの手に入れ方' : 'の探し方') + '">' + DC_AT.none.ic + '</button>' +
          '<span class="dc-pop" role="tooltip" id="' + pid + '">' + esc(tip) + '</span></span>'
        : DC_AT.blank.ic;
      const tag = placed
        ? '<span class="dc-at" title="' + DC_AT[at].label + '">' + DC_AT[at].ic + '<span class="dc-at-t">' + esc(rec.place) + '</span></span>'
        : '<span class="dc-at no' + (tip ? '' : ' blank') + '">' + mark + '<span class="dc-at-t">' + text + '</span></span>';
      const name = d.n + (d.q ? '（' + d.q + '）' : '');
      /* フォームの見出しに紙の名前を出すので、ボタンに持たせる。ラベルはこのページの動詞「記録」の1語。 */
      const btn = '<button type="button" class="record-edit" data-edit-p="' + esc(p.id) + '" data-edit-type="doc" data-edit-key="' + esc(d.key) +
        '" data-doc-name="' + esc(name) + '"' + (d.own ? ' data-doc-own' : '') + ' aria-label="' + esc(name + 'のありかを記録') + '">' + PEN + '<span>記録</span></button>';
      return '<li class="dc">' + DC_PAPER[d.fig] + '<div class="dc-b"><p class="dc-n">' + esc(d.n) +
        (d.q ? '<small>（' + esc(d.q) + '）</small>' : '') + '</p><div class="dc-l">' + tag + btn + '</div></div></li>';
    };
    const offs = officeDocs(p), open = openDocOffice.has(p.id);
    const office = offs.length ? '<section class="dc-shelf dc-office' + (open ? ' open' : '') + '">' +
      '<h5 class="dc-h"><button type="button" class="dc-hl dc-tg" data-doc-office="' + esc(p.id) + '" aria-expanded="' + open + '">役所で取る書類' + PG.down + '</button></h5>' +
      (open ? '<ul class="dc-list">' + offs.map(row).join('') + '</ul>' : '') + '</section>' : '';
    return roomHead('doc', '書類のありか') + docShelves(p).map(s =>
      '<section class="dc-shelf"><h5 class="dc-h"><span class="dc-hl">' + s.label + '</span></h5><ul class="dc-list">' + s.rows.map(row).join('') + '</ul></section>').join('') + office;
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
       ?ratio=0.5   廊下を除いた残りのうち、左（権利関係）が取る割合
     既定は 権利5：ローン・契約5（廊下を建物の中央に通す）。 */
  const Q = (function () {
    try { return new URLSearchParams(location.search); }
    catch (e) { return new URLSearchParams(''); }
  })();
  const RATIO = (function () {
    const v = parseFloat(Q.get('ratio'));
    return (v > 0.2 && v < 0.8) ? v : 0.5;
  })();

  const W_ = 1170, TO = 15, TI = 10, GK = 140;
  /* 部屋の高さの下限。上限は置かない ―― 部屋は中身の高さまで伸び、建物ごと伸ばす。
     以前は上限 2400 があり、超えた分は部屋の中のスクロールで見せていたが、
     今のうちの札を張り付かせるために部屋のスクロールを外すと、超えた分が
     切れて見えなくなった（建物の変更が2件のとき：2026-09-26）。 */
  const MINR = 137;
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

    /* 横方向の割り。上段＝今のうち／そのとき 5：5（書類はそのときの下）。
       下段＝廊下を挟んで 権利関係：ローン・契約 ＝ RATIO。 */
    const VN = Math.round(W_ * 0.5);
    const CW = 110;
    const V2 = Math.round((W_ - CW) * RATIO);
    const V3 = V2 + CW;

    const wLeft = V2 - TO / 2 - TI / 2;
    const wRight = W_ - V3 - TI / 2 - TO / 2;
    const wWhen = W_ - VN - TI / 2 - TO / 2;
    const wUnit = {
      liv: VN - TO / 2 - TI / 2,
      when: wWhen, docs: wWhen,
      right: wLeft, party: wRight
    };
    const PADIN = 13;
    const HEADPX = { liv: 28, when: 28 }, HEADPX_D = 23;
    const headOf = k => HEADPX[k] != null ? HEADPX[k] : HEADPX_D;
    const viewW = W_ + SITE_U * 2;
    const u2px = u => u / viewW * stageW;
    const px2u = x => x * viewW / stageW;
    const toPx = u => u2px(u - PADIN * 2);

    /* 上下の壁厚。上段は屋根側が外壁、書類は上下とも内壁、
       下段は足元が外壁。 */
    const wallY = { liv: [TO, TI], when: [TO, TI], docs: [TI, TI],
      right: [TI, TO], party: [TI, TO] };
    const raw = {}, need = {};
    Object.keys(html).forEach(k => {
      raw[k] = measureHTML(html[k], Math.max(50, toPx(wUnit[k])));
      const walls = (wallY[k][0] + wallY[k][1]) / 2;
      const inUnit = px2u(raw[k] + headOf(k)) + PADIN * 2 + walls;
      need[k] = Math.max(MINR, Math.ceil(inUnit));
    });

    /* ══ 上段｜今のうち／そのとき＋書類（2026-09-26）══════════
       今のうちが長くなり、そのときの下に床が余った。書類はそのとき側の
       材料（下エリア調査）なので、そのときの真下に置く。
       上段の深さは今のうちと「そのとき＋書類」の深いほう。浅い側の
       下の部屋（今のうち／書類）が上段の下端まで伸びる。
       ★余りは部屋の置き場所では消えない（左右の釣り合いは配分では
       解けない）。書類の下に床が残るのは、そのとき側の中身が薄いから。 */
    const H1 = Math.max(need.liv, need.when + need.docs);
    const HW = need.when;

    /* ══ 下段の割り｜廊下（V2〜V3）を芯として残す ══════════
       廊下と玄関は建物の動線で、玄関から上段の2室へ上がり、
       下段の左右へ振り分ける道。消すと間取り図ではなく
       「仕切られた箱」になるので必ず残す。

       左＝権利関係（行が今のうちの答えを映す）、右＝ローン・契約。
       下段の深さは深いほう。ローン・契約は契約1件ごとに伸びるので、
       件数が多い物件では権利関係の床が広くなる ―― 部屋は動かさない。 */
    const CORR = Math.max(need.right, need.party);
    const H = H1 + CORR;
    const KAMA = H - GK;

    const rooms = [
      { id: 'liv', label: '今のうち', kind: 'liv', x1: 0, y1: 0, x2: VN, y2: H1 },
      { id: 'when', label: 'そのとき', kind: 'main2', x1: VN, y1: 0, x2: W_, y2: HW },
      { id: 'docs', label: '書類', kind: 'room', x1: VN, y1: HW, x2: W_, y2: H1 },
      { id: 'corr', label: '', kind: 'corr', x1: V2, y1: H1, x2: V3, y2: KAMA },
      { id: 'gk', label: '玄関', kind: 'gk', x1: V2, y1: KAMA, x2: V3, y2: H },
      { id: 'right', label: '権利関係', kind: 'room', x1: 0, y1: H1, x2: V2, y2: H },
      { id: 'party', label: 'ローン・契約', kind: 'room', x1: V3, y1: H1, x2: W_, y2: H }
    ];
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
    /* 廊下から下段の左右へ開口。上段は今のうち⇔そのとき、
       そのとき⇔書類（そのときの手続きが書類を使う）。 */
    const links = [['liv', 'when'], ['when', 'docs'],
      ['corr', 'right'], ['corr', 'party']];
    /* 壁を置かない境。廊下は玄関から上段へ上がる道なので、
       上端は「今のうち」と、そのとき側の下の部屋（書類）の両方へ
       開いている。書類側を閉じると、そのとき側へ上がる動線が途切れる。 */
    const NOWALL = [['corr', 'gk'], ['corr', 'liv'], ['corr', 'docs']];
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
    /* 辺の中点だけで見ると、中点が向こう側の部屋どうしの境に
       ちょうど乗ったとき（廊下の上端が今のうち／書類の境の真下）に
       どちらにも覆われず外壁扱いになる。1/4・3/4 の点でも見る。 */
    const isOuter = (dir, pos, a, b) => {
      const d = 1;
      const inner = m => dir === 'h' ? covers(m, pos - d) && covers(m, pos + d)
        : covers(pos - d, m) && covers(pos + d, m);
      return ![0.5, 0.25, 0.75].some(t => inner(a + (b - a) * t));
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

    /* 方位マークは置かない ―― 右下の部屋の下に、その高さぶんの空きができていた
       （2026-09-28）。この間取りは物件の実際の向きを描いていない。 */

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
     ■ 物件の見出し｜屋根の帯＋トレペの札（2026-09-29、`_検討/不動産v32.html` の H）

     物件そのものを屋根のモチーフにする。2026-09-20 の切妻（「へ」の字の
     内側に文字を入れる、`_検討/不動産v29.html`）から作り替えた。

     ★作り替えた理由：切妻の高さ（186px）は中身の量ではなく「物件名を
     『へ』の字の内側に入れる」決まりから出ていて、左右に空の三角が
     作業面いっぱいに広がっていた。幅が広いほど空白が増える。
     いまは屋根を**平側から見た水平の帯**にし、文字を帯に重ねる。
     見出しの高さは文字の塊の高さで決まる（1440幅で 179px → 約100px）。

     ★文字の置き方＝屋根に重ねたトレーシングペーパーの札。
       ・屋根を**抜かない**。抜くと紙の地と同じ色の穴になり、屋根が
         左右2本に分かれて見える（v32 の E で失敗）
       ・札は**ぼかさない**。ぼかすと線の形が消え、透けて見えなくなる
         （v32 の G で失敗。不透明度.8＋ぼかし5pxで屋根が1本も見えなかった）
       ・透け具合は不透明度 .65（ユーザーが .50〜.72 の段から選んだ）。
         判定は「外から続く瓦の筋・破風の2本線が、札の内側でも追えるか」
       ・読みやすさは札の濃さではなく**文字の縁取り**で取る。字に接する
         地が紙の色になるので、住所（--ink2）は屋根が無いときと同じ 5.35:1

     ★戸建てとマンションは、屋根の縁の形で描き分ける。
       戸建て＝平側の切妻（棟包み→瓦の面→鼻隠し→軒樋）＋中央の千鳥破風。
         破風は文字の札より狭いので、頂点を帯より上へ出し、裾も帯の下へ
         出す（札の後ろに破風の全形がある）。頭だけ出して胴を隠すと、
         何の部材か分からない三角が浮く（v32 の E で失敗）
       マンション＝陸屋根の笠木とパラペット。破風の三角は無い。
     土地（kind=land）もいまは戸建ての屋根になる（切妻の頃から同じ）。

     ★屋根の下に壁のスラブは立てない。軒天の下端を間取り図の外壁の
     上端に接する（下の drawRoofs）。

     寸法は 1px＝10mm で実寸比のまま持つ：破風板・鼻隠し 180、棟包み 120、
     瓦の働き幅 235、軒樋 φ105、笠木 70、二丁掛タイル 45＋目地。
     破風の勾配も実寸（4/10）。瓦の面とパラペットの**見えの高さ**だけは
     器（文字の札の高さ）から逆算する（切妻の頃と同じ、この造形だけの例外）。

     線の階層は Leicester の実測立面図（CC BY-SA 3.0）から読み取った
     「輪郭 > 部材 > 下地 > 量産線」。素材探しの記録は
     `prototype/assets/不動産-物件見出し.RESEARCH.md`。
     ══════════════════════════════════════════════════════════ */
  const RF = { HAFU: 18, MUNE: 12, KAWARA: 23.5, TOI: 10.5, PITCH: .4,
    END: 14, PEAK: 22 };
  const rfPath = pts => 'M ' + pts.map(q => q.join(' ')).join(' L ') + ' Z';

  /* 戸建て｜平側から見た切妻＋中央の千鳥破風。幅 w、帯の高さ band（px）。
     上から 棟包み → 瓦の面 → 鼻隠し → 軒樋 → 軒天 → 陰。 */
  function houseRoof(w, band) {
    const { HAFU, MUNE, KAWARA, TOI, PITCH, END, PEAK } = RF;
    /* 帯＝棟包みの頭から軒樋の下端まで。瓦の面の見えの高さをここから決める */
    const DEPTH = Math.max(30, band - (MUNE * .45 + HAFU + TOI * .55));
    const yB = PEAK + 2;                     /* 帯の上端＝棟包みの頭 */
    const yR = yB + MUNE * .45;              /* 棟＝瓦の面の上端 */
    const yE = yR + DEPTH;                   /* 軒先 */
    const yF = yE + HAFU;                    /* 鼻隠しの下端 */
    const yG = yF + TOI * .55;               /* 軒樋の下端＝帯の下端 */
    const H = yG + 5 + 8;
    const xL = END, xR = w - END, cx = w / 2;
    const g = el('svg', { viewBox: '0 0 ' + w + ' ' + H, class: 'rf', height: H,
      role: 'img', 'aria-label': '屋根（戸建て）' });
    const add = (n, a) => g.appendChild(el(n, a));
    const P = rfPath;

    /* 陰・軒天 */
    add('path', { class: 'r-sh', d: P([[xL, yG], [xR, yG], [xR, yG + 7], [xL, yG + 7]]) });
    add('path', { class: 'r-noki', d: P([[xL, yG], [xR, yG], [xR, yG + 5], [xL, yG + 5]]) });

    /* 瓦の面：桟瓦の縦筋（働き幅ごと）と段（見下ろしで上ほど詰まる） */
    add('path', { class: 'r-tile', d: P([[xL, yR], [xR, yR], [xR, yE], [xL, yE]]) });
    const rib = el('g', { class: 'r-rib' });
    for (let x = xL + KAWARA; x < xR - 4; x += KAWARA)
      rib.appendChild(el('path', { d: 'M ' + x + ' ' + yR + ' L ' + x + ' ' + yE }));
    g.appendChild(rib);
    const tex = el('g', { class: 'r-tex' });
    for (let i = 1; i <= 4; i++) {
      const y = yR + DEPTH * (1 - Math.pow(1 - i / 5, 1.25));
      tex.appendChild(el('path', { d: 'M ' + xL + ' ' + y + ' L ' + xR + ' ' + y }));
    }
    g.appendChild(tex);

    /* 鼻隠し・軒樋 */
    add('path', { class: 'r-hafu', d: P([[xL, yE], [xR, yE], [xR, yF], [xL, yF]]) });
    add('path', { class: 'r-mem', d: 'M ' + xL + ' ' + yE + ' L ' + xR + ' ' + yE });
    add('path', { class: 'r-toi', d: P([[xL, yF], [xR, yF], [xR, yG], [xL, yG]]) });
    add('path', { class: 'r-sub', d: 'M ' + xL + ' ' + yF + ' L ' + xR + ' ' + yF });

    /* 妻側の端（ケラバ）。層ごとに小口を見せて終わる（1枚で塗り潰さない）。 */
    const EW = END * .5;
    [[xL, -1], [xR, 1]].forEach(([x, s]) => {
      const dx = s * EW, dy = EW * .3;
      add('path', { class: 'r-end-d', d: P([[x, yR], [x + dx, yR + dy], [x + dx, yE + dy], [x, yE]]) });
      add('path', { class: 'r-end-f', d: P([[x, yE], [x + dx, yE + dy], [x + dx, yF + dy], [x, yF]]) });
      add('path', { class: 'r-end-t', d: P([[x, yF], [x + dx, yF + dy], [x + dx, yG + dy], [x, yG]]) });
      add('path', { class: 'r-mem', d: 'M ' + (x + dx) + ' ' + (yR + dy) + ' L ' + (x + dx) + ' ' + (yG + dy) });
    });

    /* 棟包み（水平） */
    add('path', { class: 'r-mune', d: P([[xL, yB], [xR, yB], [xR, yR + MUNE * .6], [xL, yR + MUNE * .6]]) });
    add('path', { class: 'r-sub', d: 'M ' + xL + ' ' + (yR + MUNE * .6) + ' L ' + xR + ' ' + (yR + MUNE * .6) });

    /* 輪郭 */
    add('path', { class: 'r-out', d: 'M ' + xL + ' ' + yG + ' L ' + xL + ' ' + yB +
      ' L ' + xR + ' ' + yB + ' L ' + xR + ' ' + yG });

    /* 千鳥破風。裾は軒樋の下端、勾配 4/10（実寸）。頂点は帯の上へ PEAK 出す。
       狭い幅では半幅を帯の内側に収め、勾配を保ったまま頂点を下げる。 */
    const hw = Math.min((yG - 2) / PITCH, w / 2 - END - 16);
    const yA = yG - hw * PITCH;
    const vt = d => d * Math.sqrt(1 + PITCH * PITCH);
    const yAi = yA + vt(HAFU);               /* 破風の内側の頂点 */
    const inG = Math.max(0, (yG - yAi) / PITCH);  /* 裾での内側の半幅 */
    add('path', { class: 'r-sh', d: P([[cx, yA + 3], [cx + hw + 5, yG + 2], [cx - hw - 5, yG + 2]]) });
    add('path', { class: 'r-tsuma', d: P([[cx, yAi], [cx + inG, yG], [cx - inG, yG]]) });
    add('path', { class: 'r-hafu', d: P([[cx - hw, yG], [cx, yA], [cx + hw, yG], [cx + inG, yG], [cx, yAi], [cx - inG, yG]]) });
    add('path', { class: 'r-mem', d: 'M ' + (cx - inG) + ' ' + yG + ' L ' + cx + ' ' + yAi + ' L ' + (cx + inG) + ' ' + yG });
    /* 破風の裾の小口 */
    add('path', { class: 'r-end-f', d: P([[cx - hw, yG], [cx - inG, yG], [cx - inG, yG + 3], [cx - hw, yG + 3]]) });
    add('path', { class: 'r-end-f', d: P([[cx + hw, yG], [cx + inG, yG], [cx + inG, yG + 3], [cx + hw, yG + 3]]) });
    /* 破風の棟包み */
    const mw = MUNE * 1.2;
    add('path', { class: 'r-mune', d: P([[cx - mw, yA + mw * PITCH], [cx, yA - 2], [cx + mw, yA + mw * PITCH],
      [cx + mw, yA + mw * PITCH + 4], [cx, yA + 2], [cx - mw, yA + mw * PITCH + 4]]) });
    add('path', { class: 'r-out', d: 'M ' + (cx - hw) + ' ' + (yG + 3) + ' L ' + (cx - hw) + ' ' + yG +
      ' L ' + cx + ' ' + yA + ' L ' + (cx + hw) + ' ' + yG + ' L ' + (cx + hw) + ' ' + (yG + 3) });
    add('path', { class: 'r-mem', d: 'M ' + (cx - hw) + ' ' + (yG + 3) + ' L ' + (cx + hw) + ' ' + (yG + 3) });

    g._mid = (yB + yG) / 2;                  /* 文字の札の中心 */
    g._eave = yG + 5;                        /* 軒天の下端＝外壁に接する */
    return g;
  }

  /* マンション｜陸屋根。上から 笠木 → パラペット（二丁掛タイルの目地・
     伸縮目地）→ 水切り → 陰。 */
  function condoRoof(w, band) {
    const { END } = RF;
    const KASA = 7, MIZU = 4, FACE = Math.max(30, band - KASA - MIZU);
    const y0 = 3, yK = y0 + KASA, yP = yK + FACE, yM = yP + MIZU;
    const H = yM + 8;
    const xL = END, xR = w - END;
    const g = el('svg', { viewBox: '0 0 ' + w + ' ' + H, class: 'rf', height: H,
      role: 'img', 'aria-label': '屋根（マンション）' });
    const add = (n, a) => g.appendChild(el(n, a));
    const P = rfPath;
    add('path', { class: 'r-sh', d: P([[xL, yM], [xR, yM], [xR, yM + 7], [xL, yM + 7]]) });
    add('path', { class: 'm-face', d: P([[xL, yK], [xR, yK], [xR, yP], [xL, yP]]) });
    const mj = el('g', { class: 'm-meji' });
    for (let y = yK + 5.5; y < yP - 1; y += 5.5)       /* 二丁掛 45＋目地 10 */
      mj.appendChild(el('path', { d: 'M ' + xL + ' ' + y + ' L ' + xR + ' ' + y }));
    for (let x = xL + 360; x < xR - 20; x += 360)      /* 伸縮目地 3600 ごと */
      mj.appendChild(el('path', { d: 'M ' + x + ' ' + yK + ' L ' + x + ' ' + yP, 'stroke-width': 1.1 }));
    g.appendChild(mj);
    add('path', { class: 'm-mizu', d: P([[xL - 2, yP], [xR + 2, yP], [xR + 2, yM], [xL - 2, yM]]) });
    add('path', { class: 'r-sub', d: 'M ' + (xL - 2) + ' ' + yP + ' L ' + (xR + 2) + ' ' + yP });
    add('path', { class: 'm-kasagi', d: P([[xL - 4, y0], [xR + 4, y0], [xR + 4, yK], [xL - 4, yK]]) });
    add('path', { class: 'r-mem', d: 'M ' + (xL - 4) + ' ' + yK + ' L ' + (xR + 4) + ' ' + yK });
    add('path', { class: 'r-out', d: 'M ' + (xL - 2) + ' ' + yM + ' L ' + (xL - 2) + ' ' + yP +
      ' L ' + xL + ' ' + yP + ' L ' + xL + ' ' + yK + ' L ' + (xL - 4) + ' ' + yK + ' L ' + (xL - 4) + ' ' + y0 +
      ' L ' + (xR + 4) + ' ' + y0 + ' L ' + (xR + 4) + ' ' + yK + ' L ' + xR + ' ' + yK + ' L ' + xR + ' ' + yP +
      ' L ' + (xR + 2) + ' ' + yP + ' L ' + (xR + 2) + ' ' + yM });
    g._mid = (y0 + yM) / 2;
    g._eave = yM;
    return g;
  }

  /* 物件の見出し。屋根（.rf-slot に後から描く）＋その上に重ねる札。
     2行目は 住所｜種別・築年。種別・築年はひと塊で折り返さない。 */
  function propHead(p) {
    const u = USES[p.use] || USES.self;
    const k = KINDS[p.kind] || KINDS.other;
    return '<div class="ph" id="p-' + p.id + '" data-kind="' + esc(p.kind || '') + '">' +
      '<div class="rf-slot"></div>' +
      '<div class="rf-card">' +
        '<div class="rf-ln"><span class="rf-t"><h3>' + esc(p.name) + '</h3>' +
          '<span class="rf-use t-' + u.tone + '">' + esc(u.label) +
          '</span></span></div>' +
        '<div class="rf-ln rf-sub"><span class="rf-addr">' + ICONS.pin +
          esc(p.addr) + '</span><span class="rf-kind"><span class="rf-sep">｜</span>' +
          esc(k.label) + (p.built ? '<span class="rf-sep">｜</span>' + esc(p.built) + '築' : '') +
          '</span></div>' +
      '</div></div>';
  }

  /* 見出しの屋根を、実幅と札の実寸が決まってから組む（1単位＝1px）。 */
  function drawRoofs() {
    document.querySelectorAll('.ph').forEach(function (ph) {
      const slot = ph.querySelector('.rf-slot');
      const card = ph.querySelector('.rf-card');
      if (!slot || !card) return;
      const w = Math.round(slot.getBoundingClientRect().width);
      if (!w) return;
      /* 住所と種別が別の行に折れたら、行頭に残る区切り「｜」を消す */
      const addr = card.querySelector('.rf-addr'), kind = card.querySelector('.rf-kind');
      ph.classList.remove('rf-wrap');
      if (addr && kind && kind.offsetTop > addr.offsetTop + 2) ph.classList.add('rf-wrap');
      /* 帯の高さ＝札の高さ＋上下 6px（札の上下に屋根の縁が見える） */
      const ch = card.getBoundingClientRect().height;
      const svg = ph.dataset.kind === 'condo' ? condoRoof(w, ch + 12) : houseRoof(w, ch + 12);
      slot.replaceChildren(svg);
      card.style.top = (svg._mid - ch / 2) + 'px';

      /* 軒天の下端を、間取り図の外壁の上端に接する。
         間取り図は上に敷地の余白（SITE_U＝草地の縁）を持つので、見出しを
         そのぶん（＋軒天より下の陰の高さ）間取り図に重ねる。 */
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
          const below = svg.getBoundingClientRect().height - svg._eave;
          ph.style.setProperty('--rf-site', (site + below) + 'px');
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

  /* 取り方の吹き出し：押して開け閉めする（スマホにはカーソルを合わせる操作がない）。
     ほかを押す・Esc で閉じる。 */
  const closePops = except => document.querySelectorAll('.dc-qw.open').forEach(w => {
    if (w === except) return;
    w.classList.remove('open'); w.querySelector('.dc-q').setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('click', e => { if (!e.target.closest('.dc-qw')) closePops(); });
  /* Esc はフォーカスが残っていても閉じる（キーボードで選んで開いた吹き出しは、
     フォーカスが外れるまで data-shut で止める）。 */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closePops();
    const q = document.activeElement && document.activeElement.closest && document.activeElement.closest('.dc-q');
    if (q) { q.setAttribute('data-shut', ''); q.addEventListener('blur', () => q.removeAttribute('data-shut'), { once: true }); }
  });
  function wire() {
    document.querySelectorAll('.dc-q').forEach(b => {
      b.onclick = () => {
        const w = b.parentElement, open = !w.classList.contains('open');
        closePops(w);
        w.classList.toggle('open', open); b.setAttribute('aria-expanded', String(open));
      };
    });
    /* 境界：越境が複数の隣で、図に出すものを切り替える。図の枠は同じ大きさなので
       描き直さず、表示だけ切り替える（選んだものは描き直し後も残す）。 */
    document.querySelectorAll('[data-bd-pick]').forEach(button => {
      button.onclick = () => {
        const k = Number(button.dataset.bdK), fig = button.closest('.bd-fig');
        bdPick.set(button.dataset.bdPick, k);
        fig.querySelectorAll('[data-bd-fig]').forEach(el => { el.hidden = Number(el.dataset.bdFig) !== k; });
        fig.querySelectorAll('[data-bd-pick]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      };
    });
    /* 開閉は表示中だけの状態。押したら間取りごと描き直す（部屋の深さは
       中身の実測で決まる）。押したボタンを同じ画面位置に留める。 */
    [['data-procedure', 'procedure', openProcedures], ['data-prior-open', 'priorOpen', openPrior], ['data-matter-open', 'matterOpen', openMatter], ['data-doc-office', 'docOffice', openDocOffice], ['data-bd-nb', 'bdNb', null, bdNb], ['data-rd-nb', 'rdNb', null, rdNb]].forEach(([sel, attr, set, pick]) =>
      document.querySelectorAll('[' + sel + ']').forEach(button => {
      button.onclick = () => {
        const key = button.dataset[attr];
        const before = button.getBoundingClientRect().top;
        /* 境界の家・私道の相手の札：選んだものを覚える（開閉ではない）。 */
        if (!set) { const i = key.lastIndexOf(':'); pick.set(key.slice(0, i), Number(key.slice(i + 1))); }
        else if (set.has(key)) set.delete(key);
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
    /* 今のうち・そのときの札：同じ部屋（間取りの部屋か、狭い幅の一覧）の行へ飛ぶ。
       張り付いた札の帯の下に、行の頭が来るようにする。 */
    document.querySelectorAll('[data-now-go]').forEach(b => {
      b.onclick = () => {
        const nav = b.closest('.now-nav'), room = nav.parentElement;
        const row = room.querySelector('[data-now-row="' + CSS.escape(b.dataset.nowGo) + '"]');
        if (!row) return;
        const stick = parseFloat(getComputedStyle(nav).top) || 0;
        window.scrollTo({ top: scrollY + row.getBoundingClientRect().top - stick - nav.offsetHeight - 10, behavior: 'smooth' });
        const nm = row.querySelector('.uh-nm, .procedure-head h5');
        if (nm) { nm.tabIndex = -1; nm.focus({ preventScroll: true }); }
      };
    });
    spyNow();
    /* 札の帯（縦積みで横に流すとき）：続きがある側の端を薄くぼかす（navEdges）。 */
    document.querySelectorAll('.now-nav').forEach(nav => {
      nav.firstElementChild.addEventListener('scroll', () => navEdges(nav), { passive: true });
      navPeek(nav);
      navEdges(nav);
    });
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

  /* 読んでいる行の札に印。札の帯のすぐ下を越えた最後の行を「読んでいる行」とする。
     帯が張り付いているあいだは、帯に下の影を付ける（is-stuck）。 */
  function spyNow() {
    document.querySelectorAll('.now-nav').forEach(nav => {
      const r = nav.getBoundingClientRect();
      if (!r.width) return;
      const stick = parseFloat(getComputedStyle(nav).top) || 0;
      nav.classList.toggle('is-stuck', r.top <= stick + 0.5 && nav.parentElement.getBoundingClientRect().top < stick);
      const line = r.bottom + 40;
      let cur = '';
      nav.parentElement.querySelectorAll('[data-now-row]').forEach(row => { if (row.getBoundingClientRect().top <= line) cur = row.dataset.nowRow; });
      nav.querySelectorAll('[data-now-go]').forEach(b => {
        if (b.dataset.nowGo === cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
      /* 狭い幅（札を横に流す）で、印の札が見えていなければ横に送る。印が変わったときだけ
         （毎回送ると、指で横に流した位置を奪う）。 */
      if (cur !== (nav.dataset.cur || '')) {
        nav.dataset.cur = cur;
        const inn = nav.firstElementChild, on = cur && inn.querySelector('[aria-current]');
        if (on && inn.scrollWidth > inn.clientWidth) {
          const br = on.getBoundingClientRect(), ir = inn.getBoundingClientRect();
          if (br.left < ir.left || br.right > ir.right) inn.scrollBy({ left: br.right > ir.right ? br.right - ir.right + 8 : br.left - ir.left - 8, behavior: 'smooth' });
        }
      }
    });
  }
  addEventListener('scroll', spyNow, { passive: true });
  /* 横に流せる手がかりは、右端で途中まで見えて切れている札。画面の幅によっては
     札がちょうど収まり、次の札が数pxしか覗かない（ウィンドウ幅400で今のうち5枚）。
     札の間（3〜12px）と札の左右の余白（+0〜6px）を振り、右端で切れる札が
     3割〜7割見える組み合わせのうち、元の形（間5px・余白+0）に一番近いものを選ぶ。
     間だけで合わせると、幅によって札の間が16pxまで開いて間延びした。どれも外れる
     ときは、見える割合が5割に一番近いものにする。描いた直後に一度だけ測る。 */
  function navPeek(nav) {
    const inn = nav.firstElementChild;
    inn.style.columnGap = ''; inn.style.removeProperty('--chip-pad');
    if (!nav.closest('.stack') || inn.scrollWidth - inn.clientWidth <= 1) return;
    const seen = (g, pad) => {
      inn.style.columnGap = g + 'px'; inn.style.setProperty('--chip-pad', pad + 'px');
      const R = inn.getBoundingClientRect().right;
      const cut = Array.from(inn.children).find(b => { const r = b.getBoundingClientRect(); return r.left < R && r.right > R; });
      if (!cut) return -1;
      const r = cut.getBoundingClientRect();
      return (R - r.left) / r.width;
    };
    let best = null;
    for (let pad = 0; pad <= 6; pad++) for (let g = 3; g <= 12; g++) {
      const f = seen(g, pad);
      if (f < 0) continue;
      const ok = f >= 0.3 && f <= 0.7;
      const score = ok ? Math.abs(g - 5) + pad * 1.5 : 100 + Math.abs(f - 0.5) * 100;
      if (!best || score < best.score) best = { g, pad, score };
    }
    inn.style.columnGap = best ? best.g + 'px' : '';
    if (best) inn.style.setProperty('--chip-pad', best.pad + 'px'); else inn.style.removeProperty('--chip-pad');
  }
  /* 札の帯が横にはみ出しているか。左に戻れる／右に続きがある、を別々に。 */
  function navEdges(nav) {
    const inn = nav.firstElementChild, max = inn.scrollWidth - inn.clientWidth;
    nav.classList.toggle('can-l', max > 1 && inn.scrollLeft > 1);
    nav.classList.toggle('can-r', max > 1 && inn.scrollLeft < max - 1);
  }

  let resizeFrame;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(draw_);
  });
  draw_();
})();
