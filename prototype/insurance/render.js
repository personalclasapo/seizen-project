/* SeiZen プロトタイプ｜保険の描画
   ------------------------------------------------------------------
   画面は state.js の事実を描いた結果。まずは静的モックとして、
   一覧ゾーン（証券フォルダの目次）と詳細ゾーン（証券の記録）を
   両方描く。インライン編集・追加フローは次の増分で入れる。

   造形は保険証券・契約内容を連想する（正本 §4-2）。通帳（銀行口座）
   とは別の骨格でよい。ここで作った形を他領域へ機械的に持ち出さない
   （正本 §13）。                                                    */
(function (S) {
  'use strict';

  const esc  = SeiZen.esc;
  const show = SeiZen.toast;

  const sec  = document.getElementById('policies');
  const rack = document.getElementById('rack');

  /* ── アイコン ─────────────────────────────────────── */

  /* 種類ごとの盾。生命＝ハート、医療＝十字、損保＝車。封筒の口に
     はさまる小さな紋章として使う。                                */
  const SHIELD = {
    life:    '<path d="M12 3 4 6v5.5C4 16.5 7.4 20.3 12 21.5 16.6 20.3 20 16.5 20 11.5V6Z"/>' +
             '<path d="M12 15.5c-2.4-1.6-4-3-4-4.7A2 2 0 0 1 12 9.3 2 2 0 0 1 16 10.8c0 1.7-1.6 3.1-4 4.7Z"/>',
    medical: '<path d="M12 3 4 6v5.5C4 16.5 7.4 20.3 12 21.5 16.6 20.3 20 16.5 20 11.5V6Z"/>' +
             '<path d="M12 8.2v6M9 11.2h6"/>',
    nonlife: '<path d="M12 3 4 6v5.5C4 16.5 7.4 20.3 12 21.5 16.6 20.3 20 16.5 20 11.5V6Z"/>' +
             '<path d="M7.6 13.2h8.8l-1-2.6a1.4 1.4 0 0 0-1.3-.9H9.9a1.4 1.4 0 0 0-1.3.9Z"/>' +
             '<circle cx="9.2" cy="14.4" r="1"/><circle cx="14.8" cy="14.4" r="1"/>'
  };

  /* 場面（給付）ごとの小アイコン。詳細の「確認する場面」の左に置く。 */
  const BEN_IC = {
    death:      '<path d="M12 20c-3.5-2-6-4.6-6-8a3.4 3.4 0 0 1 6-2.2A3.4 3.4 0 0 1 18 12c0 3.4-2.5 6-6 8Z"/>',
    disability: '<circle cx="12" cy="6.5" r="2.6"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5S18.5 16.4 18.5 20"/>',
    hospital:   '<rect x="4" y="6" width="16" height="13" rx="2"/><path d="M12 9.5v6M9 12.5h6"/>',
    surgery:    '<path d="M4 15 14 5l4 4L8 19H4Z"/><path d="M12 7l4 4"/>',
    accident:   '<path d="M6 14h12l-1.4-3.6A2 2 0 0 0 14.7 9H9.3a2 2 0 0 0-1.9 1.4Z"/>' +
                '<path d="M4.5 14h15v3.5h-15z"/><circle cx="8" cy="17.5" r="1.4"/><circle cx="16" cy="17.5" r="1.4"/>'
  };

  const svg = (d, w) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="' +
    (w || 18) + '" height="' + (w || 18) + '">' + d + '</svg>';

  /* 保険会社のロゴ。契約・デジタルの simple-icons と同じ考え方だが、
     保険会社は simple-icons に無いので、各社マークを模した簡易な
     幾何 SVG を自作する（商標なので「それらしい記号」に留める）。
     塗り指定を持つので fill="currentColor" のグループで包む。      */
  const BRAND = {
    /* 日本生命：赤い菱形を4枚組んだ社章を寄せた形。 */
    '日本生命': { color: '#B4322E', d:
      '<path d="M12 2.6 15 6l-3 3.4L9 6Z"/><path d="M18 8.6 21.4 12 18 15.4 14.6 12Z"/>' +
      '<path d="M6 8.6 9.4 12 6 15.4 2.6 12Z"/><path d="M12 14.6 15 18l-3 3.4L9 18Z"/>' },
    /* 第一生命：ひとを抱くような弧。 */
    '第一生命': { color: '#0A4E8C', d:
      '<path d="M4 15a8 8 0 0 1 16 0"/><circle cx="12" cy="7" r="2.6"/>' },
    '住友生命': { color: '#00913A', d:
      '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>' },
    '明治安田生命': { color: '#003F7E', d:
      '<path d="M4 18V7l8 5 8-5v11"/>' },
    /* アフラック：横向きのアヒル。頭・くちばし・体のシルエット。 */
    'アフラック': { color: '#1B75BC', fill:
      '<path d="M15.5 5.2a2.8 2.8 0 0 1 2.8 2.8c0 .5-.1.9-.3 1.3l2.5.6-2 1.2c.1 2.2-1 4.4-3 5.6-1.8 1.1-4 1.3-6 .9l-2.5 1.4.7-2.6C4.4 15.9 3 13.4 3 10.8c0-.9.7-1.6 1.6-1.6.5 0 1 .2 1.3.6C6.9 7 9 5.4 11.6 5.2c.4-1 1.3-1.6 2.4-1.6.5 0 1 .1 1.5.4l-1.2 1.4c.4-.1.8-.2 1.2-.2Z"/>' +
      '<circle cx="15.4" cy="7.6" r=".9" fill="#fff"/>' },
    'メットライフ生命': { color: '#0090DA', d:
      '<circle cx="8.5" cy="12" r="4.5"/><circle cx="15.5" cy="12" r="4.5"/>' },
    'オリックス生命': { color: '#F08300', d:
      '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 12h16"/>' },
    /* 東京海上日動：3つの円を重ねた地球のマークを寄せた形。 */
    '東京海上日動': { color: '#0C2C7C', d:
      '<circle cx="9" cy="10" r="4.4"/><circle cx="15" cy="10" r="4.4"/><circle cx="12" cy="15" r="4.4"/>' },
    '損保ジャパン': { color: '#E60012', d:
      '<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/>' },
    '三井住友海上': { color: '#009CD6', d:
      '<path d="M4 16 12 5l8 11Z"/>' }
  };

  /* 一覧・詳細で共通のロゴ描画。マスタに無い会社は頭文字の角丸。 */
  function brandLogo(name, size) {
    const b = BRAND[name];
    const s = size || 22;
    if (b && b.fill) {
      return '<svg class="brand-svg" viewBox="0 0 24 24" width="' + s + '" height="' + s +
        '" fill="' + b.color + '">' + b.fill + '</svg>';
    }
    if (b) {
      return '<svg class="brand-svg" viewBox="0 0 24 24" width="' + s + '" height="' + s +
        '" fill="none" stroke="' + b.color + '" stroke-width="1.7" stroke-linejoin="round">' + b.d + '</svg>';
    }
    const initial = (S.INSURERS.find(i => i.name === name) || {}).initial || name.slice(0, 1);
    return '<span class="brand-initial">' + esc(initial) + '</span>';
  }

  /* ── 一覧ゾーン：証券フォルダを並べた目次 ────────────────
     契約・デジタルの二層構造にならい、上層は証券を見れば分かること
     （会社・種類・どんなとき・契約者・受取人）、下層は SeiZen が
     記録していること（請求の持ち物の数）。証券番号や保険料は一覧に
     出さない。押すと下の証券へ送る。                                */

  /* フォルダの前面ポケット。上辺が中央で下がる凹カーブの色帯。中央の
     凹みから証券の下端＋紋章が覗き、左右は色帯が高く上がって証券の
     下角を覆う（＝ポケットが抱える形）。

     SVG は高さ固定・preserveAspectRatio="none"。凹カーブは縦が固定寸
     なので歪まず、横は伸びるだけ。凹みは常に viewBox の中央（x=50）
     なので、盾を CSS で left:50% に置けば幅が変わっても必ず凹みに
     収まる。                                                        */
  function folderPocket() {
    /* viewBox 100×64。上辺：(0,0)→制御点(50,30)→(100,0)。中央で
       約 15 下がる緩い凹み。下辺は角丸。 */
    var lip  = 'M0,0 Q50,30 100,0';
    var body = lip + ' L100,52 Q100,64 88,64 L12,64 Q0,64 0,52 Z';
    return '<svg class="rk-pocket" viewBox="0 0 100 64" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="rpFace" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#ffffff" stop-opacity=".45"/>' +
          '<stop offset=".7" stop-color="#ffffff" stop-opacity="0"/>' +
          '<stop offset="1" stop-color="#000000" stop-opacity=".06"/>' +
        '</linearGradient>' +
        '<linearGradient id="rpSlot" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#4b422b" stop-opacity=".22"/>' +
          '<stop offset="1" stop-color="#4b422b" stop-opacity="0"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<path fill="var(--fold-flap)" d="' + body + '"/>' +
      '<path fill="url(#rpFace)" d="' + body + '"/>' +
      /* 差し込み口の陰：凹カーブのすぐ下に、上濃く下薄い帯。証券が
         ポケットに差し込まれて見える。 */
      '<path fill="url(#rpSlot)" d="' + lip + ' L100,16 Q50,46 0,16 Z"/>' +
      /* コバの明線と輪郭（横伸縮で太らないよう non-scaling）。 */
      '<path fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="1.4" ' +
        'vector-effect="non-scaling-stroke" d="M0,1.5 Q50,31 100,1.5"/>' +
      '<path fill="none" stroke="var(--fold-edge)" stroke-width="1" ' +
        'vector-effect="non-scaling-stroke" d="' + body + '"/>' +
      '</svg>';
  }

  function rackCard(pol) {
    const tone = S.kindTone(pol.kind);
    const badge = S.policyBadge(pol);
    const triggers = S.triggerLabels(pol);

    const tags = triggers.length
      ? triggers.map(t => '<span class="rk-tag">' + esc(t) + '</span>').join('')
      : '<span class="rk-tag q">確認する場面をあとで整理する</span>';

    /* 構造＝フォルダ：
         .rk-back    フォルダ本体（色付き角丸矩形）。一番奥（z1）。
         .rk-tab     耳（左上）。フォルダ本体の上辺に乗る（z2）。
         .rk-card    白い証券。左右と上にフォルダの色が覗く（z3）。
         .rk-pocket  前面ポケット（凹カーブの色帯）。証券の下端に
                     かぶさる（z4）。
         .rk-crest   紋章。証券の下端の中央、ポケットの凹みに収まる（z5）。 */
    return '<button class="rkfolder ' + tone + '" type="button" data-goto="' + pol.id + '">' +
      '<span class="rk-back"></span>' +
      '<span class="rk-tab">保険 No.' + String(pol.no).padStart(3, '0') + '</span>' +
      '<span class="rk-card">' +
        '<span class="rk-head">' +
          '<span class="rk-logo">' + brandLogo(pol.insurer, 24) + '</span>' +
          '<span class="rk-name">' + esc(pol.insurer) + '</span>' +
          '<span class="rk-bar"></span>' +
          '<span class="rk-kind">' + esc(pol.product || S.kindLabel(pol.kind) + '保険') + '</span>' +
          '<span class="rk-bd ' + (badge.cls === 'warn' ? 'warn' : 'off') + '">' + esc(badge.text.replace(/\s/g, '')) + '</span>' +
        '</span>' +
        '<span class="rk-tags">' + tags + '</span>' +
        '<span class="rk-rule"></span>' +
        '<span class="rk-people">' +
          '<span class="rk-role"><i>契約者</i>' + esc(pol.holder || '—') + '</span>' +
          '<span class="rk-role"><i>受取人</i>' + esc(pol.beneficiary || '—') + '</span>' +
        '</span>' +
      '</span>' +
      folderPocket() +
      '<span class="rk-crest">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="var(--kc-d)" stroke-width="1.8" ' +
          'stroke-linecap="round" stroke-linejoin="round">' + (SHIELD[pol.kind] || SHIELD.life) + '</svg>' +
      '</span>' +
      '</button>';
  }

  /* ── 詳細ゾーン：証券の記録 ─────────────────────────
     現実の証券が持つ情報階層を借りて、SeiZen で使いやすい形へ。
     上から：券面（会社・種類・証券番号・当事者）→ 確認する場面 →
     問い合わせ先 → 主な情報 → その他の契約情報（参考）→ 申し送り。 */

  function benefitBlock(pol) {
    const rows = S.benefitRows(pol);
    if (!rows.length) return '';
    return rows.map(b => {
      const ic = BEN_IC[Object.keys(S.BENEFITS).find(k => S.BENEFITS[k] === b)] || BEN_IC.death;
      return '<div class="ben-row">' +
        '<span class="ben-ic">' + svg(ic, 20) + '</span>' +
        '<div class="ben-tx">' +
          '<div class="ben-line"><b>' + esc(b.trigger) + '</b>' +
            '<span class="ben-name">' + esc(b.name) + '</span></div>' +
          '<div class="ben-about">' + esc(b.about) + '<span class="ben-by">請求：' + esc(b.by) + '</span></div>' +
        '</div></div>';
    }).join('') +
    '<p class="ben-note">※上記以外の給付がある場合は、約款をご確認ください。</p>';
  }

  function contactBlock(pol) {
    const c = pol.contact || {};
    const company = (c.company || '').split('\n');
    const agent = c.agent
      ? '<div class="ct-name">' + esc(c.agent) + '</div>' +
        (c.agentPerson ? '<div class="ct-sub">' + esc(c.agentPerson) + '</div>' : '') +
        (c.agentTel ? '<div class="ct-tel">' + telSvg() + esc(c.agentTel) + '</div>' : '')
      : '<div class="ct-sub">担当代理店・担当者なし</div>';
    return '<div class="ct-grid">' +
      '<div class="ct-col">' +
        '<span class="ct-cap ct-cap-a">保険会社</span>' +
        company.map((l, i) => '<div class="' + (i === 0 ? 'ct-name' : 'ct-sub') + '">' + esc(l) + '</div>').join('') +
        (c.companyTel ? '<div class="ct-tel">' + telSvg() + esc(c.companyTel) + '</div>' : '') +
        (c.hours ? '<div class="ct-hours">受付時間　' + esc(c.hours) + '</div>' : '') +
      '</div>' +
      '<div class="ct-col">' +
        '<span class="ct-cap ct-cap-b">Web</span>' +
        '<div class="ct-sub">' + esc(c.web || '保険金・給付金のお問い合わせ／ご請求') + '</div>' +
        '<span class="ct-link">公式サイトで確認する ↗</span>' +
      '</div>' +
      '<div class="ct-col">' +
        '<span class="ct-cap ct-cap-c">担当代理店・担当者</span>' +
        agent +
      '</div>' +
    '</div>' +
    '<p class="ct-note">※請求方法や必要書類は、上記窓口へお問い合わせください。</p>';
  }
  function telSvg() {
    return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9">' +
      '<path d="M6 4h3l1.6 4-2 1.4a11 11 0 0 0 5 5l1.4-2 4 1.6v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 6 4Z"/></svg>';
  }

  function factsBlock(pol) {
    const f = pol.facts || {};
    const cell = (ic, cap, val) => '<div class="fx-cell">' +
      '<span class="fx-ic">' + svg(ic, 16) + '</span>' +
      '<div><div class="fx-cap">' + esc(cap) + '</div>' +
      '<div class="fx-val">' + esc(val || '—') + '</div></div></div>';
    return '<div class="fx-grid">' +
      cell('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9h16M9 3v4M15 3v4"/>', '保険期間', f.term) +
      cell('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="m8 13 3 3 5-6"/>', '満期・更新', f.renewal) +
      cell('<circle cx="12" cy="12" r="8"/><path d="M9 9h6M9 12h6M12 8v8"/>', '保険金額', f.amount) +
      cell('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>', '証券・関連書類の保管場所', f.docsAt) +
      cell('<circle cx="12" cy="7.5" r="3"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5S18.5 16.4 18.5 20"/>', '指定代理請求人', f.proxy) +
      cell('<path d="M6.5 3h8l4 4v14h-12Z"/><path d="M14.5 3v4h4M9 12h6M9 15.3h5"/>', '主な特約', f.riders) +
    '</div>';
  }

  function adminBlock(pol) {
    const a = pol.admin || {};
    return '<div class="ad-grid">' +
      '<div class="ad-cell"><div class="ad-cap">保険料</div><div class="ad-val">' + esc(a.premium || '—') + '</div></div>' +
      '<div class="ad-cell"><div class="ad-cap">支払方法</div><div class="ad-val">' + esc(a.payMethod || '—') + '</div></div>' +
      '<div class="ad-cell"><div class="ad-cap">引落口座</div><div class="ad-val">' + esc(a.payFrom || '—') + '</div></div>' +
    '</div>' +
    '<p class="ad-note">※保険料・支払方法などの契約管理情報です。把握のための参考情報としてご確認ください。</p>';
  }

  function checksBlock(pol) {
    const list = pol.checks || [];
    if (!list.length) return '';
    return '<ul class="ck-list">' + list.map(c => {
      const st = S.checkState(c);
      return '<li class="' + st.tone + '">' +
        '<span class="ck-mark">' + (st.done ? '✓' : st.open ? '!' : '−') + '</span>' +
        '<span class="ck-item">' + esc(c.item) + '</span>' +
        '<span class="ck-where">' + esc(c.where || (st.open ? '未確認' : '')) + '</span>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function blockHead(icon, label) {
    return '<div class="pv-bh"><span class="pv-bh-ic">' + svg(icon, 17) + '</span><b>' + esc(label) + '</b></div>';
  }

  function policyHTML(pol) {
    const tone = S.kindTone(pol.kind);
    const t = S.tally(pol);

    return '<div class="pv ' + tone + '" data-policy="' + pol.id + '">' +
      '<span class="pv-tab">保険 No.' + String(pol.no).padStart(3, '0') + '</span>' +
      '<div class="pv-sheet">' +

        '<div class="pv-face">' +
          '<span class="pv-logo">' + brandLogo(pol.insurer, 26) + '</span>' +
          '<div class="pv-title">' +
            '<div class="pv-insurer">' + esc(pol.insurer) + '</div>' +
            '<h4 class="pv-product">' + esc(pol.product || S.kindLabel(pol.kind) + '保険') + '</h4>' +
          '</div>' +
          '<div class="pv-no"><i>証券番号</i>' + esc(pol.policyNo || '—') + '</div>' +
        '</div>' +

        '<div class="pv-parties">' +
          '<div><i>契約者</i>' + esc(pol.holder || '—') + '</div>' +
          '<div><i>被保険者</i>' + esc(pol.insured || '—') + '</div>' +
          '<div><i>受取人</i>' + esc(pol.beneficiary || '—') + '</div>' +
          '<div><i>契約日</i>' + esc(pol.startedOn || '—') + '</div>' +
        '</div>' +

        '<div class="pv-block pv-ben">' + blockHead(SHIELD[pol.kind] || SHIELD.life, 'この保険を確認する場面') +
          benefitBlock(pol) + '</div>' +

        '<div class="pv-block pv-ct">' + blockHead('<path d="M6 4h3l1.6 4-2 1.4a11 11 0 0 0 5 5l1.4-2 4 1.6v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 6 4Z"/>', '問い合わせ先') +
          contactBlock(pol) + '</div>' +

        '<div class="pv-block pv-fx">' + blockHead('<path d="M12 3 4 6v5.5C4 16.5 7.4 20.3 12 21.5 16.6 20.3 20 16.5 20 11.5V6Z"/><path d="m9 11.5 2 2 4-4.5"/>', '保険の主な情報') +
          factsBlock(pol) + '</div>' +

        '<div class="pv-block pv-ck">' + blockHead('<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>', '請求のときに家族が困らないための確認') +
          checksBlock(pol) +
          '<div class="ck-foot' + (t.open ? ' open' : '') + '">持ち物・段取り ' + t.done + '/' + (t.done + t.open) + ' 確認済み</div>' +
        '</div>' +

        '<div class="pv-block pv-ad">' + blockHead('<path d="M4 7h16M4 7l1 12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>', 'その他の契約情報') +
          adminBlock(pol) + '</div>' +

        '<div class="pv-memo">' +
          '<div class="pv-memo-h"><span class="pv-memo-ic">' + svg('<path d="M4 15 14 5l5 5L9 20H4Z"/><path d="M12 7l5 5"/>', 15) + '</span>家族への申し送り</div>' +
          '<div class="pv-memo-body">' + (pol.memo || '').split('\n').map(l => '<p>' + esc(l) + '</p>').join('') + '</div>' +
        '</div>' +

      '</div>' +
      '</div>';
  }

  function render() {
    if (rack) rack.innerHTML = S.policies.map(rackCard).join('');
    sec.innerHTML = S.policies.map(policyHTML).join('');
    const n = S.policies.length;
    const b = document.getElementById('cntDetails');
    if (b) b.textContent = n + '件';
    SeiZen.setNavCount('insurance', n + '件');
  }

  /* 一覧は目次。押すと下の該当証券へ送り、一瞬だけ縁を光らせる。 */
  if (rack) rack.addEventListener('click', e => {
    const btn = e.target.closest('[data-goto]');
    if (!btn) return;
    const el = sec.querySelector('.pv[data-policy="' + btn.dataset.goto + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  });

  /* 追加は次の増分。いまはトーストで受ける。 */
  const addBtn = document.getElementById('addPolicy');
  if (addBtn) addBtn.addEventListener('click', () => show('保険の追加は準備中です'));

  render();
})(window.SeiZenInsurance);
