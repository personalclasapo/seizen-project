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

  const S = window.SeiZenRealEstate;
  const { ST, NOW_STATUS, MATCH, KINDS, USES, MATTERS, FINDINGS, DEALS } = S;

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
    matter: ic('<path d="M12 3.6 21 19.4H3Z"/><path d="M12 9.6v4.2M12 16.6h.01"/>')
  };

  /* ══════════════════════════════════════════════════════════
     ■ 今のうち／そのとき｜v28 からの移植（項目・文言・ロジック）
     ══════════════════════════════════════════════════════════ */

  function nowRows(p) {
    const out = [];
    const defaultDescriptions = {
      boundary: {
        problem: '境界標を確認済み。隣地との個別の取り決めなし。',
        done: '西側の境界について隣家との合意書あり。境界標も確認済み。',
        ask: '西側の境界について、書類だけでは経緯が分からない。',
        check: '境界標と、隣地との取り決めの有無を確認できていない。',
        action: '西側の境界は、隣家と口頭で「ブロック塀の中心」と決めたまま。境界標なし。'
      },
      road: {
        none: '前面道路は市道。私道持分なし。通行・配管について隣地との個別の取り決めなし。',
        done: '前面道路は私道。持分あり。通行・配管に必要な権利は書類で確認済み。',
        check: '前面道路は私道。持分と、給排水管の経路が確認できていない。',
        action: '給水管が隣地を通っている。使用について隣家と口頭の了承のみ。'
      },
      changed: {
        none: '取得後の増築・取り壊しなど、登記に影響する変更なし。',
        done: '2008年に2階部分を増築。登記への反映を確認済み。',
        ask: '北側に増築部分あり。時期・施工者・登記状況が分からない。',
        check: '増改築の有無と、現在の建物が登記内容に反映されているかを確認できていない。',
        action: '北側に約6畳の増築あり（1998年ごろ）。登記には未反映。確認申請の有無は工務店に照会中。'
      }
    };
    const addMatter = (key, name, choices, actions) => {
      const m = (p.matters || {})[key];
      const status = m ? m.uiStatus : (key === 'boundary' ? 'check' : 'none');
      const sm = NOW_STATUS[status] || NOW_STATUS.check;
      out.push({ key, choices, nm: name,
        de: (m && m.memo) || (defaultDescriptions[key] && defaultDescriptions[key][status]),
        act: actions[status] || null, lbl: sm.label, tone: sm.tone });
    };

    addMatter('boundary', '境界・隣地との取り決め',
      ['problem', 'done', 'ask', 'check', 'action'], {
        ask: '本人に、隣家との取り決めや過去の境界確認について聞いておく。',
        check: '境界標と、隣地との取り決めが残っていないかを確認する。',
        action: '当時の取り決めを双方で確認し、必要なら書面や図面に残しておく。' +
          '代替わりすると、当時の合意内容を確認できなくなる。'
      });

    addMatter('road', '私道・通行・配管の取り決め',
      ['none', 'done', 'check', 'action'], {
        check: '権利関係と現在の利用条件を確認する。',
        action: '現在の当事者同士で内容を確認し、必要なら書面に残しておく。'
      });

    if (p.kind === 'land') {
      out.push({ key: null, choices: [], nm: '増改築・登記',
        de: '建物のない土地のため、増改築については該当しない。',
        act: null, lbl: NOW_STATUS.none.label, tone: NOW_STATUS.none.tone });
    } else {
      addMatter('changed', '増改築・登記',
        ['none', 'done', 'ask', 'check', 'action'], {
          ask: 'いつ、誰に依頼して工事したかを本人に確認し、残っている資料を探す。',
          check: '増改築の有無と、現在の建物が登記内容に反映されているかを確認する。',
          action: '工事時期・施工者・図面・確認申請書類などを確認し、' +
            '増築部分を登記に反映するための資料をそろえる。'
        });
    }

    const priorStatus = (p.priorInheritance && p.priorInheritance.status) || 'none';
    const pm = NOW_STATUS[priorStatus] || NOW_STATUS.none;
    const mismatched = ['land', 'bldg'].map(k => ({ k, r: p.rights && p.rights[k] }))
      .find(x => x.r && x.r.match !== 'same');
    let priorDe = '現在の登記名義は本人。未了の相続なし。';
    let priorAct = null;
    if (priorStatus === 'done') priorDe = '本人名義への相続登記を確認済み。';
    if (priorStatus === 'doing') {
      priorDe = '前の代の相続関係を整理し、相続登記を申請中。';
    }
    if (priorStatus === 'action') {
      priorDe = mismatched
        ? (mismatched.k === 'land' ? '土地' : '建物') + 'は' +
          (mismatched.r.owner || '前の代の名義') + '。' +
          (mismatched.r.memo || '相続登記は未了。')
        : '前の代の名義が残っており、相続登記は未了。';
      priorAct = '本人が自分で判断できるうちに、前の代の相続関係を整理する。' +
        '判断能力が失われると、本人に代わって遺産分割等を進めるための手続きが増える。';
    }
    out.push({ key: 'prior', choices: ['none', 'done', 'doing', 'action'],
      nm: '前の代の相続登記', de: priorDe, act: priorAct,
      lbl: pm.label, tone: pm.tone });

    if (p.loan && p.loan.has && p.loan.gteeStatus === 'unknown') {
      out.push({ key: null, choices: [], nm: '住宅ローンの団信加入状況',
        de: (p.loan.bank || '金融機関') + '｜住宅ローンあり。' +
          '団信加入の有無が確認できていない。',
        act: '契約書類または金融機関で、団信加入の有無と保障内容を確認する。',
        lbl: NOW_STATUS.check.label, tone: NOW_STATUS.check.tone });
    }

    return out;
  }

  function goneRows(p) {
    const out = [];
    const owns = ['land', 'bldg'].some(k => {
      const r = p.rights && p.rights[k];
      return r && /本人/.test(r.owner || '');
    });

    if (owns && p.ownerReport && p.ownerReport.state !== 'hidden') {
      if (p.ownerReport.state === 'not_needed') {
        out.push({ icon: 'todoke', nm: '固定資産税の現所有者申告',
          de: '相続登記が申告期限内に完了すれば、この申告は不要。',
          lbl: '相続登記が先なら不要', tone: 'gr' });
      } else {
        out.push({ icon: 'todoke', nm: '固定資産税の現所有者を申告する',
          de: '本人名義の不動産について、相続登記が期限内に完了しない場合は、' +
            '市町村へ現所有者を申告する。相続登記とは別の、固定資産税のための手続き。',
          lim: p.ownerReport.deadline || '自治体の期限を確認',
          lbl: '対応が必要', tone: 'or' });
      }
    }

    const bad = ['land', 'bldg'].filter(k =>
      p.rights[k] && p.rights[k].match !== 'same');
    const need = S.neededDocs(p), have = need.filter(d => d.st === 'done');
    if (owns) {
      out.push({ icon: 'toki', nm: '相続登記をする',
        de: bad.length
          ? 'この物件は、前の代の相続登記も未了。前の代からの相続関係を' +
            '整理したうえで、今回の相続登記を進める必要がある。'
          : '本人名義の不動産について、相続した人への名義変更が必要。',
        lim: '不動産を相続したことを知った日から3年以内',
        lbl: '対応が必要', tone: 'or', docs: { have: have.length, need: need.length } });
    }

    if (p.loan && p.loan.has && p.loan.gteeStatus === 'yes') {
      out.push({ icon: 'tsushin', nm: '団信による住宅ローンの弁済手続きをする',
        de: (p.loan.bank || '金融機関') + '｜住宅ローン残高 ' +
          (p.loan.balance || '要確認') + '｜団信加入あり。' +
          '取扱金融機関へ連絡し、必要書類を提出する。保険金の支払対象になれば、' +
          '残りの住宅ローンが弁済される。', lbl: '対応が必要', tone: 'or' });
    } else if (p.loan && p.loan.has && p.loan.gteeStatus === 'no') {
      out.push({ icon: 'tsushin', nm: '住宅ローンの残債を確認する',
        de: (p.loan.bank || '金融機関') + '｜住宅ローン残高 ' +
          (p.loan.balance || '要確認') + '｜団信なし。' +
          '残っている住宅ローンも相続の対象になるため、金融機関へ連絡して' +
          '今後の返済方法を確認する。', lbl: '対応が必要', tone: 'or' });
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
  function statusControl(p, x) {
    if (!x.key || !x.choices || !x.choices.length)
      return '<span class="bdg ' + x.tone + '">' + esc(x.lbl) + '</span>';
    return '<select class="bdg status-pick ' + x.tone + '" ' +
      'data-status-p="' + esc(p.id) + '" data-status-key="' + esc(x.key) + '" ' +
      'aria-label="' + esc(x.nm) + 'の状態">' +
      x.choices.map(k => {
        const s = NOW_STATUS[k];
        return '<option value="' + esc(k) + '"' + (s.label === x.lbl ? ' selected' : '') +
          '>' + esc(s.label) + '</option>';
      }).join('') + '</select>';
  }

  function nowHTML(p) {
    const rows = nowRows(p);
    if (!rows.length) return '<div class="de">該当する項目がありません。</div>';
    return '<div class="rail">' + rows.map(x =>
      '<div class="rw">' + nodeSVG(x.tone) +
        '<div class="rh"><div class="nm">' + esc(x.nm) + '</div>' +
        '<div class="bd">' + statusControl(p, x) + '</div></div>' +
        (x.de ? '<div class="de">' + esc(x.de) + '</div>' : '') +
        (x.act ? '<div class="act"><span class="ar">→</span><span>' +
          esc(x.act) + '</span></div>' : '') +
        (x.lim ? '<div class="lim">' + esc(x.lim) + '</div>' : '') +
      '</div>').join('') + '</div>';
  }

  function tilesHTML(x) {
    const t = [];
    if (x.lim) t.push('<div class="tile">' + T_CAL + '<div>' +
      '<div class="tl">手続きの期限</div>' +
      '<div class="tv">' + esc(x.lim) + '</div>' +
      (x.limn ? '<div class="tn">' + esc(x.limn) + '</div>' : '') +
      '</div></div>');
    if (x.docs) t.push('<div class="tile">' + T_DOC + '<div>' +
      '<div class="tl">必要な資料</div>' +
      '<div class="tv"><b>' + x.docs.have + ' / ' + x.docs.need + '件</b>' +
        'が手元にあります</div>' +
      '<div class="tn">' + (x.docs.have < x.docs.need
        ? '足りないものは「関係書類」で見る' : '所在は「関係書類」にある') +
      '</div></div></div>');
    return t.length ? '<div class="tiles' + (t.length === 1 ? ' one' : '') +
      '">' + t.join('') + '</div>' : '';
  }

  /* ── 描く：そのとき ─────────────────────────────── */
  function whenHTML(p) {
    const rows = goneRows(p);
    if (!rows.length) return '<div class="card"><div class="de">' +
      '登録内容から該当する手続きはありません。</div></div>';
    const lead = rows.find(r => r.icon === 'toki') || rows[0];
    const rest = rows.filter(r => r !== lead);

    let h = '<div class="card">' +
      '<div class="lead-item"><div class="lh">' +
        (GLYPH[lead.icon] ? GLYPH[lead.icon]({ w: 54 }) : '') +
        '<div class="lt">' +
          '<div class="nm">' + esc(lead.nm) + '</div>' +
          '<div class="de">' + esc(lead.de) + '</div>' +
        '</div>' +
        (lead.lbl ? '<div class="lbd"><span class="bdg ' + lead.tone + '">' +
          esc(lead.lbl) + '</span></div>' : '') +
      '</div>' +
      (lead.only ? '<div class="only"><div class="ol">この物件では</div>' +
        '<div class="ot">' + esc(lead.only) + '</div></div>' : '') +
      tilesHTML(lead) +
      '</div></div>';

    if (rest.length) {
      h += '<div class="card rest">' +
        '<div class="rhd"><div class="rt">この物件では、ほかに次の手続きが' +
          '発生します</div></div>' +
        rest.map(x => '<div class="sub">' +
          '<div class="nm">' + esc(x.nm) + '</div>' +
          ((x.lbl || x.lim) ? '<div class="srt">' +
            (x.lbl ? '<span class="bdg ' + x.tone + '">' + esc(x.lbl) + '</span>' : '') +
            (x.lim ? '<div class="slim">' + T_CAL_S +
              '<div><div class="sv">' + esc(x.lim) + '</div>' +
              (x.limn ? '<div class="sn">' + esc(x.limn) + '</div>' : '') +
              '</div></div>' : '') + '</div>' : '') +
          '<div class="de">' + esc(x.de) + '</div>' +
          (x.docs ? '<div class="sdoc">必要な資料　<b>' + x.docs.have + ' / ' +
            x.docs.need + '件</b>が手元にあります</div>' : '') +
        '</div>').join('') +
        '<div class="foot">' + T_INFO + '<div>' +
          'この物件に当てはまらない手続きは表示されません。' +
          '条件が分からないものは、「今のうち」に確認事項として' +
          '出ることがあります。</div></div>' +
        '</div>';
    }

    return h;
  }

  /* ── 部屋へ渡す入口 ──────────────────────────────
     v27 の .pane は「地」を背景に持つ div だったが、間取りでは
     部屋の床そのものが地なので、.pane は作らない。室名札が
     大見出しの役をし、その下に説明、白いカードが載る。            */
  function roomLiv(p) {
    return roomTag('liv', '今のうち', tagCounts(nowRows(p))) +
      '<div class="pn">本人がまだ判断し、意思を伝えられるうちにしか、' +
      '確認・対応できないこと。</div>' +
      '<div class="card">' + nowHTML(p) + '</div>';
  }
  function roomWhen(p) {
    return roomTag('when', 'そのとき', tagCounts(goneRows(p))) +
      '<div class="pn">必要になったときに、家族が何をすることに' +
      'なるかを、今のうちに把握しておく。</div>' + whenHTML(p);
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

  /* 要対応の件数だけを数える。合計は中身を見れば分かるので出さない。 */
  function tagCounts(rows) {
    return { act: rows.filter(r => r.tone === 'or').length };
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
    /* 要対応の件数。板の右に打つ小さな金物の札（副表札）。
       0件のときは付けない ―― 何も無いことを札で言わない。    */
    const cnt = c && c.act
      ? '<span class="rt-n">要対応 <b>' + c.act + '</b></span>'
      : '';
    return '<div class="rtag rt-' + kind + '">' +
      '<div class="rt-plate-w">' + plate +
        '<h4 class="rt-nm">' + esc(title) + '</h4>' +
      '</div>' + cnt +
      '</div>';
  }

  /* 事情：問いと答え。SeiZen 側が問いを持つ（正本 §9）ので、
     問いの文がそのまま見出しになる。答えが続くときだけ話が伸びる。 */
  function roomMatters(p) {
    return roomHead('matter', '後から分かりにくい事情') +
      Object.keys(p.matters).map(k => {
        const m = p.matters[k], f = FINDINGS[m.find];
        const t = m.find === 'no' ? 'gy' : 'or';
        let h = '<div class="q"><div class="qh"><span class="qt">' +
          esc(MATTERS[k].label) + '</span>' +
          '<span class="bdg ' + t + '">' + esc(f.label) + '</span></div>';
        if (m.memo) h += '<div class="qa">' + esc(m.memo) + '</div>';
        if (m.detail) {
          const d = m.detail, bits = [];
          if (d.who)   bits.push('<i>相手</i>' + esc(d.who));
          if (d.deal)  bits.push('<i>取り決め</i>' + esc(d.deal));
          if (d.paper) bits.push('<i>書面</i>' + esc(d.paper));
          if (d.reg)   bits.push('<i>登記</i>' + esc(d.reg));
          if (d.state) bits.push('<i>状況</i>' + esc(d.state));
          h += '<div class="qd">' + bits.join('　') + '</div>';
        }
        return h + '</div>';
      }).join('');
  }

  /* 権利：土地と建物の対。2ブロック固定なので、横に並べて対にする。 */
  function roomRights(p) {
    const one = (k, lb) => {
      const r = p.rights[k], mt = MATCH[r.match];
      return '<div><div class="ow">' + lb + '</div>' +
        '<div class="onm">' + esc(r.owner) +
        (r.shares ? '<span class="bdg gy" style="margin-left:4px">' + esc(r.shares) + '</span>' : '') +
        '</div>' +
        '<div class="osub"><span class="bdg ' + (mt.tone === 'gr' ? 'gr' : 'or') + '">' +
        '登記と' + esc(mt.label) + '</span>' +
        (r.memo ? '<br>' + esc(r.memo) : '') + '</div></div>';
    };
    return roomHead('right', '権利関係') +
      '<div class="own">' + one('land', '土地') + one('bldg', '建物') + '</div>';
  }

  /* ローン・契約：相手ごとの塊。相手の名前が頭に立つ。 */
  function roomParty(p) {
    let h = '';
    const l = p.loan;
    if (l.has) {
      h += '<div class="who"><span class="wn">' + esc(l.bank) + '</span>' +
        '<span class="wk">借入</span>' +
        '<div class="wd">' + esc(l.type) + '・' + esc(l.debtor) + '。団信' + esc(l.gtee) + '</div>' +
        '<div class="wd">担保 ' + esc(l.mortgage) +
        (l.cross && l.cross !== 'なし' ? '／他の借入の担保 ' + esc(l.cross) : '') +
        '</div></div>';
    } else {
      h += '<div class="who"><span class="wn">借入なし</span>' +
        '<span class="bdg gy" style="margin-left:5px">該当なし</span>' +
        (l.memo ? '<div class="wd">' + esc(l.memo) + '</div>' : '') + '</div>';
    }
    (p.deals || []).forEach(d => {
      h += '<div class="who"><span class="wn">' + esc(d.who) + '</span>' +
        '<span class="wk">' + esc(DEALS[d.kind].label) + '</span>' +
        '<div class="wd">' + esc(d.what) + '</div>' +
        '<div class="wt">' + esc(d.tel) + '</div></div>';
    });
    if (!(p.deals || []).length) {
      h += '<div class="who"><span class="wn">続いている関係なし</span>' +
        '<span class="bdg gy" style="margin-left:5px">該当なし</span></div>';
    }
    return roomHead('loan', 'ローン・契約') + h;
  }

  /* 書類：索引。1件1行、名前と状態だけ。中身は持たない。 */
  function roomDocs(p) {
    let h = S.neededDocs(p).map(d => {
      const st = ST[d.st] || { label: d.st, sym: '' };
      return '<div class="doc"><span class="nm">' + esc(d.label) + '</span>' +
        '<span class="bdg ' + tone(d.st) + '">' + esc(st.label) + '</span></div>';
    }).join('');
    h += '<div class="place">' +
      (p.docs && p.docs.place ? esc(p.docs.place) : '保管場所は未確認') + '</div>';
    return roomHead('doc', '関係書類') + h +
      '<a class="dc-link" href="../preparing.html?area=documents">' +
      '書類・資料でこの原本を扱う' + ICONS.pin + '</a>';
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
      right: roomRights(p), party: roomParty(p),
      matter: roomMatters(p), docs: roomDocs(p) };

    /* 横方向の割り。上段＝今のうち／そのとき 5：5。下段＝廊下を挟んで
       書類4：権利＋ローン契約＋事情6（v27/v28 の実測から決めた比）。 */
    const VN = Math.round(W_ * 0.5);
    const CW = 110;
    const V2 = Math.round((W_ - CW) * 0.4);
    const V3 = V2 + CW;
    const V4 = V3 + Math.round((W_ - V3) * 0.46);

    const wUnit = {
      liv: VN - TO / 2 - TI / 2,
      when: W_ - VN - TI / 2 - TO / 2,
      docs: V2 - TO / 2 - TI / 2,
      right: V4 - V3 - TI / 2 - TI / 2,
      party: W_ - V4 - TI / 2 - TO / 2,
      matter: W_ - V3 - TI / 2 - TO / 2
    };
    const PADIN = 13;
    const HEADPX = { liv: 28, when: 28 }, HEADPX_D = 23;
    const headOf = k => HEADPX[k] != null ? HEADPX[k] : HEADPX_D;
    const viewW = W_ + SITE_U * 2;
    const u2px = u => u / viewW * stageW;
    const px2u = x => x * viewW / stageW;
    const toPx = u => u2px(u - PADIN * 2);

    const wallY = { liv: [TO, TI], when: [TO, TI], docs: [TI, TO],
      right: [TI, TI], party: [TI, TI], matter: [TI, TO] };
    const raw = {}, need = {};
    Object.keys(html).forEach(k => {
      raw[k] = measureHTML(html[k], Math.max(50, toPx(wUnit[k])));
      const walls = (wallY[k][0] + wallY[k][1]) / 2;
      const inUnit = px2u(raw[k] + headOf(k)) + PADIN * 2 + walls;
      need[k] = Math.min(MAXR, Math.max(MINR, Math.ceil(inUnit)));
    });

    const H1 = Math.max(need.liv, need.when);
    const docsH = need.docs;
    const topH = Math.max(need.right, need.party);
    const rSum = topH + need.matter;
    const CORR = Math.max(docsH, rSum);
    const H = H1 + CORR;
    const KAMA = H - GK;
    const toFoot = y => (H - y) < GK ? H : y;
    const Y2 = H1 + topH;
    const docsBottom = H;

    const rooms = [
      { id: 'liv', label: '今のうち', kind: 'liv', x1: 0, y1: 0, x2: VN, y2: H1 },
      { id: 'when', label: 'そのとき', kind: 'main2', x1: VN, y1: 0, x2: W_, y2: H1 },
      { id: 'corr', label: '', kind: 'corr', x1: V2, y1: H1, x2: V3, y2: KAMA },
      { id: 'gk', label: '玄関', kind: 'gk', x1: V2, y1: KAMA, x2: V3, y2: H },
      { id: 'docs', label: '書類', kind: 'room', x1: 0, y1: H1, x2: V2, y2: docsBottom },
      { id: 'right', label: '権利関係', kind: 'room', x1: V3, y1: H1, x2: V4, y2: Y2 },
      { id: 'party', label: 'ローン・契約', kind: 'room', x1: V4, y1: H1, x2: W_, y2: Y2 },
      { id: 'matter', label: '事情', kind: 'room', x1: V3, y1: Y2, x2: W_, y2: toFoot(H1 + rSum) }
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
    const links = [['liv', 'when'], ['corr', 'right'], ['corr', 'docs'],
      ['corr', 'matter'], ['right', 'party']];
    const NOWALL = [['corr', 'gk'], ['corr', 'liv']];
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
      box('matters', roomMatters(p)) +
      box('rights', roomRights(p)) +
      box('party', roomParty(p)) +
      box('docs', roomDocs(p)) +
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
      const g = S.gauge(p);
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
    document.querySelectorAll('[data-go]').forEach(b => {
      b.onclick = () => {
        const el = document.getElementById(b.dataset.go);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
    document.querySelectorAll('[data-status-p][data-status-key]').forEach(sel => {
      sel.onchange = () => {
        if (S.setNowStatus(sel.dataset.statusP, sel.dataset.statusKey, sel.value)) draw_();
      };
    });
  }

  draw_();
})();
