/* SeiZen プロトタイプ｜保険の描画
   ------------------------------------------------------------------
   画面は state.js の事実を描いた結果。一覧ゾーン（証券フォルダの
   目次）と詳細ゾーン（証券の記録）を両方描く。

   詳細ゾーンは、書いてある場所がそのまま入力欄になる（銀行口座・
   契約デジタルと同じ手つき）。欄をひとつ押せばその場で書き換えられ、
   ブロック見出しの鉛筆を押せばその節をまとめて開く。保存はしない。

   造形は保険証券・契約内容を連想する（正本 §4-2）。通帳（銀行口座）
   とは別の骨格でよい。ここで作った形を他領域へ機械的に持ち出さない
   （正本 §13）。                                                    */
(function (S) {
  'use strict';

  const esc  = SeiZen.esc;
  const show = SeiZen.toast;

  const sec  = document.getElementById('policies');
  const rack = document.getElementById('rack');

  /* 書いてある場所がそのまま入力欄になる。
       editing     … 欄ひとつだけを開く { id, path, kind }
       editSection … 節ごとにまとめて開く { id, key } */
  let editing = null;
  let editSection = null;
  /* 「選択式＋その他」で、値が空でも自由入力欄を出しておきたい path。 */
  let pickOther = new Set();
  /* この保険を削除するか、確認を展開しているか。id を持つ。 */
  let confirmDelete = null;
  /* 次の描画で、開いたばかりのセレクトを自動で開くか。編集の開始時だけ
     true。セレクトを選び直した後の再描画では開かない（選ぶたびに
     メニューが開き直すのを防ぐ）。 */
  let autoOpenPicker = false;

  /* どの節が、どの path を受け持つか。節ごとの編集で使う。前方一致。 */
  const SEC_OF = {
    label:  ['product', 'policyNo', 'insurer', 'kind'],
    party:  ['holder', 'insured', 'beneficiary', 'startedOn'],
    terms:  ['facts.'],
    pay:    ['admin.'],
    ben:    ['benefits', 'facts.riders'],
    contact:['contact.'],
    checks: ['checks.'],
    memo:   ['memo']
  };
  function inSection(key, path) {
    return (SEC_OF[key] || []).some(p => path === p || path.indexOf(p) === 0);
  }

  const PEN  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="m4 20 4-1 11-11-3-3L5 16z"/></svg>';
  const DONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>';

  /* ── 編集プリミティブ ───────────────────────────────
     ev()       … 一行テキスト／複数行テキストの値。開いていれば入力欄。
     evSelect() … 選択肢から選ぶ値。開いた瞬間からセレクト。          */
  function isOpen(id, path) {
    if (editing && editing.id === id && editing.path === path) return true;
    if (editSection && editSection.id === id && inSection(editSection.key, path)) return true;
    return false;
  }
  function ev(id, path, value, kind, placeholder) {
    if (isOpen(id, path)) {
      const ph = placeholder ? ' placeholder="' + esc(placeholder) + '"' : '';
      if (kind === 'area')
        return '<textarea class="i-ef i-ef-area" data-ef="1" data-path="' + path + '"' + ph + '>' +
          esc(value || '') + '</textarea>';
      return '<input class="i-ef" data-ef="1" data-path="' + path + '"' + ph +
        ' value="' + esc(value || '') + '">';
    }
    const empty = value === '' || value == null;
    return '<span class="i-ev' + (empty ? ' i-ev-empty' : '') + '" data-edit="' + path +
      '" data-kind="' + (kind || 'line') + '">' +
      (empty ? esc(placeholder || '未入力') : esc(value)) + '</span>';
  }
  /* 選択肢から選ぶが「その他」で自由入力にも切り替えられる欄。保険期間・
     満期など、型はだいたい決まっているが表現に幅がある項目に使う。
     いまの値が候補に無ければ自動で自由入力欄を出す。                 */
  const PICK_OTHER = '__other__';
  function evPick(id, path, value, choices, placeholder) {
    const inList = choices.indexOf(value) > -1;
    if (isOpen(id, path)) {
      const otherOpen = pickOther.has(path) || (!inList && value !== '' && value != null);
      /* select は data-pick だけを持ち、選ばれた瞬間に change ハンドラが
         state へ書く。data-ef は付けない（flushInputs が古い値で上書き
         するのを防ぐ）。「その他」のときだけ下の text 欄が data-ef。 */
      const sel = '<select class="i-ef i-ef-sel" data-pick="' + path + '">' +
        choices.map(c => '<option value="' + esc(c) + '"' +
          (c === value ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
        '<option value="' + PICK_OTHER + '"' + (otherOpen ? ' selected' : '') + '>その他（自由に入力）</option>' +
        '</select>';
      const field = otherOpen
        ? '<input class="i-ef i-ef-other" data-ef="1" data-path="' + path + '"' +
          (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') +
          ' value="' + esc(value || '') + '">'
        : '';
      return '<span class="i-pick">' + sel + field + '</span>';
    }
    const empty = value === '' || value == null;
    return '<span class="i-ev' + (empty ? ' i-ev-empty' : '') + '" data-edit="' + path +
      '" data-kind="pick">' + (empty ? esc(placeholder || '未入力') : esc(value)) + '</span>';
  }

  function evSelect(id, path, value, options) {
    if (isOpen(id, path)) {
      return '<select class="i-ef i-ef-sel" data-ef="1" data-path="' + path + '">' +
        options.map(o => '<option value="' + esc(o.value) + '"' +
          (o.value === value ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') +
        '</select>';
    }
    const cur = options.find(o => o.value === value);
    return '<span class="i-ev" data-edit="' + path + '" data-kind="select">' +
      esc(cur ? cur.label : (value || '未入力')) + '</span>';
  }

  const KIND_OPTS = Object.keys(S.KIND_TONES).map(k => ({ value: k, label: S.KIND_TONES[k].label }));
  const INSURER_OPTS = S.INSURERS.map(i => ({ value: i.name, label: i.name }));
  const PAYMETHOD_OPTS = ['口座振替', 'クレジットカード', '団体扱い', '振込', '現金'].map(v => ({ value: v, label: v }));

  /* 商品タイプの候補。会社を選ぶと、その会社が扱うカテゴリの商品だけが
     出る。ここに無い商品名は「その他」で自由入力できる（そのときだけ
     カテゴリを選んでもらう）。 */
  function productChoices(insurer) {
    return S.productsForInsurer(insurer).map(p => p.name);
  }

  /* 契約の条件の候補。型はだいたい決まっているので候補を出す。
     ここに無い契約は「その他」で自由入力できる。 */
  const TERM_CHOICES    = ['終身', '10年', '15年', '20年', '30年', '60歳まで', '65歳まで', '70歳まで', '1年（自動更新）'];
  const RENEWAL_CHOICES = ['満期なし（終身）', '自動更新（案内は届かない）', '更新時に案内が届く', '満期で終了（更新なし）'];

  /* ── アイコン ─────────────────────────────────────── */

  /* カテゴリの盾。死亡＝ハート、医療＝十字、貯蓄・年金＝芽（育てて実る）、
     損害＝屋根／車。詳細の型押しや一覧の紋章に使う。 */
  const SHIELD_BODY = '<path d="M12 3 4 6v5.5C4 16.5 7.4 20.3 12 21.5 16.6 20.3 20 16.5 20 11.5V6Z"/>';
  const SHIELD = {
    death:    SHIELD_BODY +
             '<path d="M12 15.5c-2.4-1.6-4-3-4-4.7A2 2 0 0 1 12 9.3 2 2 0 0 1 16 10.8c0 1.7-1.6 3.1-4 4.7Z"/>',
    medical:  SHIELD_BODY + '<path d="M12 8.2v6M9 11.2h6"/>',
    savings:  SHIELD_BODY +
             '<path d="M12 17.5v-5"/><path d="M12 12.5c-.3-2-1.7-3.2-3.7-3.2 0 2 1.4 3.3 3.7 3.2Z"/>' +
             '<path d="M12 11.5c.3-2.2 1.9-3.5 4-3.5 0 2.2-1.7 3.6-4 3.5Z"/>',
    property: SHIELD_BODY +
             '<path d="M8 14.5 12 11l4 3.5"/><path d="M9 14.5v3h6v-3"/>'
  };

  /* 場面（給付）ごとの小アイコン。 */
  const BEN_IC = {
    death:      '<path d="M12 20c-3.5-2-6-4.6-6-8a3.4 3.4 0 0 1 6-2.2A3.4 3.4 0 0 1 18 12c0 3.4-2.5 6-6 8Z"/>',
    disability: '<circle cx="12" cy="6.5" r="2.6"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5S18.5 16.4 18.5 20"/>',
    hospital:   '<rect x="4" y="6" width="16" height="13" rx="2"/><path d="M12 9.5v6M9 12.5h6"/>',
    surgery:    '<path d="M4 15 14 5l4 4L8 19H4Z"/><path d="M12 7l4 4"/>',
    diagnosis:  '<circle cx="12" cy="12" r="7.5"/><path d="M12 8.5v7M8.5 12h7"/>',
    disabled:   '<circle cx="12" cy="6" r="2.4"/><path d="M12 8.5v6l-3 4M12 12h4"/>',
    nursing:    '<circle cx="9" cy="7" r="2.2"/><path d="M6 20v-4l-2-2 3-3h3l3 3M15 20l3-6h2"/>',
    maturity:   '<path d="M12 21v-8"/><path d="M12 13c-.5-3-2.6-4.8-5.6-4.8 0 3 2.3 4.9 5.6 4.8Z"/>' +
                '<path d="M12 11c.5-3.3 2.9-5.2 6-5.2 0 3.3-2.6 5.3-6 5.2Z"/>',
    waiver:     '<path d="M6 6l12 12M6 18 18 6"/><circle cx="12" cy="12" r="9"/>',
    accident:   '<path d="M6 14h12l-1.4-3.6A2 2 0 0 0 14.7 9H9.3a2 2 0 0 0-1.9 1.4Z"/>' +
                '<path d="M4.5 14h15v3.5h-15z"/><circle cx="8" cy="17.5" r="1.4"/><circle cx="16" cy="17.5" r="1.4"/>',
    liability:  '<circle cx="12" cy="12" r="8.5"/><path d="M8 12l3 3 5-6"/>'
  };

  const svg = (d, w) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="' +
    (w || 18) + '" height="' + (w || 18) + '">' + d + '</svg>';

  const BRAND = {
    '日本生命': { color: '#B4322E', d:
      '<path d="M12 2.6 15 6l-3 3.4L9 6Z"/><path d="M18 8.6 21.4 12 18 15.4 14.6 12Z"/>' +
      '<path d="M6 8.6 9.4 12 6 15.4 2.6 12Z"/><path d="M12 14.6 15 18l-3 3.4L9 18Z"/>' },
    '第一生命': { color: '#0A4E8C', d:
      '<path d="M4 15a8 8 0 0 1 16 0"/><circle cx="12" cy="7" r="2.6"/>' },
    '住友生命': { color: '#00913A', d:
      '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>' },
    '明治安田生命': { color: '#003F7E', d:
      '<path d="M4 18V7l8 5 8-5v11"/>' },
    'アフラック': { color: '#1B75BC', fill:
      '<path d="M15.5 5.2a2.8 2.8 0 0 1 2.8 2.8c0 .5-.1.9-.3 1.3l2.5.6-2 1.2c.1 2.2-1 4.4-3 5.6-1.8 1.1-4 1.3-6 .9l-2.5 1.4.7-2.6C4.4 15.9 3 13.4 3 10.8c0-.9.7-1.6 1.6-1.6.5 0 1 .2 1.3.6C6.9 7 9 5.4 11.6 5.2c.4-1 1.3-1.6 2.4-1.6.5 0 1 .1 1.5.4l-1.2 1.4c.4-.1.8-.2 1.2-.2Z"/>' +
      '<circle cx="15.4" cy="7.6" r=".9" fill="#fff"/>' },
    'メットライフ生命': { color: '#0090DA', d:
      '<circle cx="8.5" cy="12" r="4.5"/><circle cx="15.5" cy="12" r="4.5"/>' },
    'オリックス生命': { color: '#F08300', d:
      '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 12h16"/>' },
    '東京海上日動': { color: '#0C2C7C', d:
      '<circle cx="9" cy="10" r="4.4"/><circle cx="15" cy="10" r="4.4"/><circle cx="12" cy="15" r="4.4"/>' },
    '損保ジャパン': { color: '#E60012', d:
      '<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/>' },
    '三井住友海上': { color: '#009CD6', d:
      '<path d="M4 16 12 5l8 11Z"/>' }
  };

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

  /* ── 一覧ゾーン：証券フォルダを並べた目次 ──────────────── */

  function folderPocket() {
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
      '<path fill="url(#rpSlot)" d="' + lip + ' L100,16 Q50,46 0,16 Z"/>' +
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

    return '<button class="rkfolder ' + tone + '" type="button" data-goto="' + pol.id + '">' +
      '<span class="rk-back"></span>' +
      '<span class="rk-tab">保険 No.' + String(S.policyNo(pol)).padStart(3, '0') + '</span>' +
      '<span class="rk-card">' +
        '<span class="rk-head">' +
          '<span class="rk-logo">' + brandLogo(pol.insurer, 24) + '</span>' +
          '<span class="rk-name">' + esc(pol.insurer) + '</span>' +
          '<span class="rk-bar"></span>' +
          '<span class="rk-kind">' + esc(pol.product || S.kindLabel(pol.kind)) + '</span>' +
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
          'stroke-linecap="round" stroke-linejoin="round">' + (SHIELD[pol.kind] || SHIELD.death) + '</svg>' +
      '</span>' +
      '</button>';
  }

  /* ── 詳細ゾーン ────────────────────────────────────── */

  /* 節見出しの鉛筆。押すとその節をまとめて編集モードに。 */
  function editBtn(id, key) {
    const on = editSection && editSection.id === id && editSection.key === key;
    return '<button type="button" class="i-secedit' + (on ? ' on' : '') + '" ' +
      'data-editsec="' + key + '" aria-label="' + (on ? '編集を終える' : 'この節を編集') + '">' +
      (on ? DONE : PEN) + '</button>';
  }

  /* 「この保険で請求できること」。給付の候補はカテゴリが決める（正本
     §3・§9）。そのうちこの契約で実際に効くものを、編集で入り切りできる。
     カテゴリを変えると候補ごと入れ替わる（＝取り残しは出ない）。      */
  function benefitBlock(pol) {
    const id = pol.id;
    const editOn = editSection && editSection.id === id && editSection.key === 'ben';
    const f = pol.facts || {};

    if (editOn) {
      const on = new Set(S.benefitIds(pol));
      const items = S.catBenefitIds(pol.kind).map(k => {
        const b = S.BENEFITS[k];
        return '<label class="ben-pick' + (on.has(k) ? ' on' : '') + '">' +
          '<input type="checkbox" data-benefit="' + k + '"' + (on.has(k) ? ' checked' : '') + '>' +
          '<span class="ben-pick-ic">' + svg(BEN_IC[k] || BEN_IC.death, 18) + '</span>' +
          '<span class="ben-pick-tx"><b>' + esc(b.trigger) + '</b>' +
            '<small>' + esc(b.name) + '</small></span></label>';
      }).join('');
      return '<p class="ben-lead">この契約で請求できる場面にチェックを入れてください。</p>' +
        '<div class="ben-picks">' + items + '</div>' +
        '<div class="ben-riders-ed"><small>主な特約</small>' +
          ev(id, 'facts.riders', f.riders, 'line', '例：リビング・ニーズ特約') + '</div>';
    }

    const rows = S.benefitRows(pol);
    const list = rows.length
      ? rows.map(b => {
          const key = Object.keys(S.BENEFITS).find(k => S.BENEFITS[k] === b);
          return '<div class="ben-row">' +
            '<span class="ben-ic">' + svg(BEN_IC[key] || BEN_IC.death, 20) + '</span>' +
            '<div class="ben-tx">' +
              '<div class="ben-line"><b>' + esc(b.trigger) + '</b>' +
                '<span class="ben-name">' + esc(b.name) + '</span></div>' +
              '<div class="ben-about">' + esc(b.about) + '<span class="ben-by">請求：' + esc(b.by) + '</span></div>' +
            '</div></div>';
        }).join('')
      : '<p class="ben-note">請求できる場面が未整理です。鉛筆から選んでください。</p>';

    const riders = f.riders
      ? '<div class="ben-riders"><small>主な特約</small><b>' + esc(f.riders) + '</b></div>'
      : '';

    return list + riders +
      '<p class="ben-note">※給付の候補は商品の種類から示しています。実際の保障内容は約款・証券をご確認ください。</p>';
  }

  function contactBlock(pol) {
    const id = pol.id;
    const c = pol.contact || {};
    return '<div class="ct-grid">' +
      '<div class="ct-col">' +
        '<span class="ct-cap ct-cap-a">保険会社</span>' +
        '<div class="ct-name">' + ev(id, 'contact.company', c.company, 'area', '会社名・窓口名') + '</div>' +
        '<div class="ct-tel">' + telSvg() + ev(id, 'contact.companyTel', c.companyTel, 'line', '0120-…') + '</div>' +
        '<div class="ct-hours">受付時間　' + ev(id, 'contact.hours', c.hours, 'line', '例：9:00〜17:00') + '</div>' +
      '</div>' +
      '<div class="ct-col">' +
        '<span class="ct-cap ct-cap-b">Web</span>' +
        '<div class="ct-sub">' + ev(id, 'contact.web', c.web, 'line', '保険金・給付金のお問い合わせ／ご請求') + '</div>' +
        '<span class="ct-link">公式サイトで確認する ↗</span>' +
      '</div>' +
      '<div class="ct-col">' +
        '<span class="ct-cap ct-cap-c">担当代理店・担当者</span>' +
        '<div class="ct-name">' + ev(id, 'contact.agent', c.agent, 'line', '代理店名') + '</div>' +
        '<div class="ct-sub">' + ev(id, 'contact.agentPerson', c.agentPerson, 'line', '担当：○○さん') + '</div>' +
        '<div class="ct-tel">' + telSvg() + ev(id, 'contact.agentTel', c.agentTel, 'line', '045-…') + '</div>' +
      '</div>' +
    '</div>' +
    '<p class="ct-note">※請求方法や必要書類は、上記窓口へお問い合わせください。</p>';
  }
  function telSvg() {
    return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9">' +
      '<path d="M6 4h3l1.6 4-2 1.4a11 11 0 0 0 5 5l1.4-2 4 1.6v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 6 4Z"/></svg>';
  }

  /* 左翼＝フォルダの内側。証券に刷られていて動かない事実。 */
  function lfRow(id, cap, path, val, kind, ph) {
    return lfRowH(cap, ev(id, path, val, kind || 'line', ph));
  }
  function lfRowH(cap, inner) {
    return '<div class="lf-row"><small>' + esc(cap) + '</small><b>' + inner + '</b></div>';
  }
  function lfGroup(id, key, title, rows) {
    return '<div class="lf-g"><span class="lf-gh">' + esc(title) + editBtn(id, key) + '</span>' + rows + '</div>';
  }
  function leftFace(pol) {
    const id = pol.id;
    const f = pol.facts || {}, a = pol.admin || {};
    const labelOn = editSection && editSection.id === id && editSection.key === 'label';
    return '<div class="pv-left">' +
      '<span class="lf-crest" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" ' +
          'stroke-linecap="round" stroke-linejoin="round">' + (SHIELD[pol.kind] || SHIELD.death) + '</svg>' +
      '</span>' +

      '<div class="lf-label">' +
        '<span class="lf-logo">' + brandLogo(pol.insurer, 26) + '</span>' +
        '<span class="lf-labedit">' + editBtn(id, 'label') + '</span>' +
        '<div class="lf-insurer">' +
          (labelOn ? evSelect(id, 'insurer', pol.insurer, INSURER_OPTS) : esc(pol.insurer)) + '</div>' +
        '<h4 class="lf-product">' +
          evPick(id, 'product', pol.product, productChoices(pol.insurer), '契約の商品名') + '</h4>' +
        /* この保険の分類。分類は商品タイプから一意に決まるので、マスタ
           商品なら常にタグ表示（手で選ばせない＝商品と矛盾しない）。
           商品名が「その他（自由入力）」のときだけ、分類を select で
           指定してもらう（他に決めようがないため）。 */
        (labelOn && (pickOther.has('product') || (pol.product && !S.kindOfProduct(pol.product)))
          ? '<div class="lf-no"><small>この保険の分類</small>' +
              evSelect(id, 'kind', pol.kind, KIND_OPTS) + '</div>'
          : '<div class="lf-cat' + (labelOn ? ' lf-cat-fixed' : '') + '">' +
              esc(S.kindLabel(pol.kind)) +
              (labelOn ? '<small>商品から自動で決まります</small>' : '') + '</div>') +
        '<div class="lf-no"><small>証券番号</small><b>' + ev(id, 'policyNo', pol.policyNo, 'line', '1234-567890') + '</b></div>' +
      '</div>' +

      lfGroup(id, 'party', '契約の当事者',
        lfRow(id, '契約者', 'holder', pol.holder, 'line', '父 太郎') +
        lfRow(id, '被保険者', 'insured', pol.insured, 'line', '父 太郎') +
        lfRow(id, '受取人', 'beneficiary', pol.beneficiary, 'line', '母 花子（配偶者）') +
        lfRow(id, '契約日', 'startedOn', pol.startedOn, 'line', '2015年4月1日')) +

      lfGroup(id, 'terms', '契約の条件',
        lfRow(id, '保険金額', 'facts.amount', f.amount, 'line', '死亡保険金 1,000万円') +
        lfRowH('保険期間', evPick(id, 'facts.term', f.term, TERM_CHOICES, '例：25年')) +
        lfRowH('満期・更新', evPick(id, 'facts.renewal', f.renewal, RENEWAL_CHOICES, '満期や更新の扱い'))) +

      lfGroup(id, 'pay', '保険料の支払い',
        lfRow(id, '保険料', 'admin.premium', a.premium, 'line', '月額 12,000円') +
        '<div class="lf-row"><small>支払方法</small><b>' +
          evSelect(id, 'admin.payMethod', a.payMethod, PAYMETHOD_OPTS) + '</b></div>' +
        lfRow(id, '引落口座', 'admin.payFrom', a.payFrom, 'line', '横浜銀行 普通 1234567')) +

      '<p class="lf-note">保険料・支払方法は契約管理のための参考情報です。</p>' +

      deleteZone(pol) +
    '</div>';
  }

  /* フォルダ内面のいちばん下に置く、この保険を記録から外す一角。押すと
     その場で確認を展開し、もう一段踏んでから消す（画面内の確認。ブラウザ
     標準ダイアログは使わない）。                                     */
  function deleteZone(pol) {
    if (confirmDelete === pol.id) {
      return '<div class="lf-del confirming">' +
        '<p>「' + esc(pol.insurer) + '　' + esc(pol.product || S.kindLabel(pol.kind)) +
          '」をこの記録から削除しますか？<br>元に戻せません。</p>' +
        '<div class="lf-del-btns">' +
          '<button type="button" class="lf-del-yes" data-delpol="' + pol.id + '">削除する</button>' +
          '<button type="button" class="lf-del-no" data-delpolno="1">やめる</button>' +
        '</div></div>';
    }
    return '<div class="lf-del">' +
      '<button type="button" class="lf-del-open" data-delpolopen="' + pol.id + '" ' +
        'aria-label="この保険を削除" title="この保険を削除">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
          'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></button>' +
    '</div>';
  }

  /* 状態バッジ。押すと状態が回る（確認済み→未確認→対象外）。 */
  function ckBadge(i, state) {
    const st = S.CHECK_STATES[state] || S.CHECK_STATES['未確認'];
    const tone = st.done ? 'ok' : st.open ? 'no' : 'na';
    return '<button type="button" class="ck-badge ' + tone + '" data-cyclecheck="' + i + '" ' +
      'title="押すと状態が変わります（確認済み→未確認→対象外）">' + esc(state) + '</button>';
  }

  /* 確認の紙。状態バッジ（押して切替）はいつでも効く。鉛筆で編集を
     開くと「場所」やマスタ外の項目名が入力欄になり、行の追加・削除も
     できる。編集を閉じれば読み取りに戻る。                           */
  function checksBlock(pol) {
    const id = pol.id;
    const list = pol.checks || [];
    const editOn = editSection && editSection.id === id && editSection.key === 'checks';

    const rows = list.map((c, i) => {
      const st = S.checkState(c);
      const master = S.isMasterCheck(pol, c.item);
      const name = (editOn && !master)
        ? '<span class="ck-item">' + ev(id, 'checks.' + i + '.item', c.item, 'line', '確認することを書く') + '</span>'
        : '<span class="ck-item">' + esc(c.item) + '</span>';
      const where = editOn
        ? '<span class="ck-where">' + ev(id, 'checks.' + i + '.where', c.where, 'line', '場所を書く') + '</span>'
        : '<span class="ck-where">' + esc(c.where || '') + '</span>';
      const del = (editOn && !master)
        ? '<button type="button" class="ck-del" data-delcheck="' + i + '" aria-label="この項目を削除">✕</button>'
        : '';
      return '<li class="' + st.tone + (editOn ? ' ck-editing' : '') + '">' +
        ckBadge(i, c.state) + name + where + del +
      '</li>';
    }).join('');

    return '<ul class="ck-list">' + rows + '</ul>' +
      (editOn
        ? '<button type="button" class="ck-add" data-addcheck="1">＋ 確認することを足す</button>'
        : '');
  }

  function blockHead(icon, label, id, key) {
    return '<div class="pv-bh"><span class="pv-bh-ic">' + svg(icon, 17) + '</span><b>' + esc(label) + '</b>' +
      (key ? editBtn(id, key) : '') + '</div>';
  }

  function policyHTML(pol) {
    const id = pol.id;
    const tone = S.kindTone(pol.kind);
    const t = S.tally(pol);
    const memoOn = editSection && editSection.id === id && editSection.key === 'memo';

    const right = '<div class="pv-right">' +
      '<div class="pv-cert">' +
        '<div class="pv-block pv-ben">' +
          blockHead(SHIELD[pol.kind] || SHIELD.death, 'この保険で請求できること', id, 'ben') +
          benefitBlock(pol) + '</div>' +
        '<div class="pv-block pv-ct">' +
          blockHead('<path d="M6 4h3l1.6 4-2 1.4a11 11 0 0 0 5 5l1.4-2 4 1.6v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 6 4Z"/>', '請求するときの窓口', id, 'contact') +
          contactBlock(pol) + '</div>' +
      '</div>' +

      '<div class="pv-slip">' +
        '<div class="sl-h"><span class="sl-ic">' +
          svg('<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>', 16) +
          '</span><b>家族が困らないための確認</b>' +
          '<span class="sl-tally' + (t.open ? ' open' : '') + '">' + t.done + '/' + (t.done + t.open) + '</span>' +
          editBtn(id, 'checks') + '</div>' +
        checksBlock(pol) +
      '</div>' +

      '<div class="pv-letter">' +
        '<div class="lt-h"><span class="lt-ic">' +
          svg('<path d="M4 15 14 5l5 5L9 20H4Z"/><path d="M12 7l5 5"/>', 15) +
          '</span>メモ' + editBtn(id, 'memo') + '</div>' +
        '<div class="lt-body">' +
          (memoOn
            ? ev(id, 'memo', pol.memo, 'area', '家族へ伝えておきたいこと')
            : (pol.memo || '').split('\n').map(l => '<p>' + esc(l) + '</p>').join('') ||
              '<p class="lt-empty">メモは未記入です。</p>') +
        '</div>' +
      '</div>' +
    '</div>';

    return '<div class="pv ' + tone + '" data-policy="' + id + '">' +
      '<span class="pv-tab">保険 No.' + String(S.policyNo(pol)).padStart(3, '0') + '</span>' +
      '<div class="pv-folder">' + leftFace(pol) + right + '</div>' +
    '</div>';
  }

  function render() {
    S.save();
    if (rack) rack.innerHTML = S.policies.map(rackCard).join('');
    sec.innerHTML = S.policies.map(policyHTML).join('');
    const n = S.policies.length;
    const b = document.getElementById('cntDetails');
    if (b) b.textContent = n + '件';
    SeiZen.setNavCount('insurance', n + '件');
    focusEditor();
  }

  /* ── 編集の確定・キャンセル ─────────────────────────── */

  function applyOne(pol, path, val) {
    if (path === 'kind') {
      const ch = S.setKind(pol, val);
      if (ch) S.ensureMasterChecks(pol);
      return ch;
    }
    if (path === 'product') {
      const ch = S.setProduct(pol, String(val).trim());
      if (ch) S.ensureMasterChecks(pol);
      return ch;
    }
    if (path === 'insurer') {
      if (pol.insurer === val) return false;
      pol.insurer = val;
      /* 会社を変えたら、その会社が扱わないマスタ商品は空に戻す。
         （自由入力の商品名は会社を跨いでも残す＝勝手に消さない） */
      const carriesProduct = S.productsForInsurer(val).some(p => p.name === pol.product);
      if (!carriesProduct && S.kindOfProduct(pol.product)) pol.product = '';
      /* 商品が空になり、新しい会社が1カテゴリしか扱わないなら、分類も
         そこへ寄せる（宙に浮いた分類を残さない）。 */
      const m = S.INSURERS.find(i => i.name === val);
      if (!pol.product && m && m.kinds.length === 1 && pol.kind !== m.kinds[0]) {
        S.setKind(pol, m.kinds[0]);
        S.ensureMasterChecks(pol);
      }
      return true;
    }
    if (path === 'admin.payMethod') {
      if (S.getByPath(pol, path) === val) return false;
      S.setByPath(pol, path, val); return true;
    }
    return S.applyValue(pol, path, val);
  }

  /* 開いている入力欄をすべて書き戻す。except を渡すと、その要素と
     同じ path の欄は飛ばす（そのセレクトを別で確定する呼び出し用。
     insurer 変更が kind を再計算した直後に、古い kind 欄で上書きし
     返すのを防ぐ）。 */
  function flushInputs(pol, exceptPath) {
    let changed = false;
    sec.querySelectorAll('[data-ef]').forEach(el => {
      if (exceptPath && el.dataset.path === exceptPath) return;
      if (applyOne(pol, el.dataset.path, el.value)) changed = true;
    });
    return changed;
  }

  /* 名前が空のままの「足しかけ」行を捨てる。 */
  function dropBlankChecks(pol) {
    if (!pol || !pol.checks) return;
    for (let i = pol.checks.length - 1; i >= 0; i--) {
      const c = pol.checks[i];
      if (!String(c.item).trim() && !S.isMasterCheck(pol, c.item)) pol.checks.splice(i, 1);
    }
  }

  function commitEdit() {
    if (!editing) return;
    const pol = S.findPolicy(editing.id);
    const path = editing.path;
    /* その欄の入力要素だけを探す。無ければ（＝data-pick の select だけで
       確定済み、など）何もしない。他の欄を巻き込まない。 */
    const el = sec.querySelector('[data-ef][data-path="' + path + '"]');
    if (pol && el) applyOne(pol, path, el.value);
    editing = null;
    pickOther.clear();
    /* 単一欄編集で足しかけの行を閉じたときだけ掃除（節編集中は節を閉じる
       ときにまとめて掃除する）。 */
    if (!editSection && /^checks\.\d+\.item$/.test(path)) dropBlankChecks(pol);
    render();
  }
  function commitSection() {
    if (!editSection) return;
    const pol = S.findPolicy(editSection.id);
    if (pol) flushInputs(pol);
    editing = null;
    if (editSection.key === 'checks') dropBlankChecks(pol);
    editSection = null;
    pickOther.clear();
    render();
  }
  function cancelAll() { editing = null; editSection = null; pickOther.clear(); render(); }

  function focusEditor() {
    if (!editing && !editSection) return;
    const el =
      (editing && sec.querySelector('[data-ef][data-path="' + editing.path + '"]:not([type=hidden])')) ||
      sec.querySelector('[data-ef]:not([type=hidden])') ||
      sec.querySelector('.i-pick select[data-pick]');
    if (!el) return;
    el.focus();
    if (el.tagName === 'SELECT') {
      if (autoOpenPicker && el.showPicker) { try { el.showPicker(); } catch (e) {} }
      autoOpenPicker = false;
      return;
    }
    autoOpenPicker = false;
    if (typeof el.setSelectionRange === 'function' && el.type !== 'number') {
      const n = el.value.length;
      try { el.setSelectionRange(n, n); } catch (e) {}
    }
  }

  /* ── 一覧→詳細のジャンプ ──────────────────────────── */
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

  /* ── 詳細ゾーンの編集操作 ─────────────────────────── */
  sec.addEventListener('click', e => {
    const pvEl = e.target.closest('.pv');
    const polId = pvEl && pvEl.dataset.policy;

    /* 節ごとの鉛筆。 */
    const secBtn = e.target.closest('[data-editsec]');
    if (secBtn) {
      e.preventDefault();
      const key = secBtn.dataset.editsec;
      if (editSection && editSection.id === polId && editSection.key === key) { commitSection(); return; }
      if (editSection) commitSection();
      if (editing) commitEdit();
      const pol = S.findPolicy(polId);
      if (pol && key === 'checks') S.ensureMasterChecks(pol);
      editSection = { id: polId, key: key };
      autoOpenPicker = true;
      render();
      return;
    }

    /* 確認の紙｜状態バッジを押す → 状態を回す（読み取りでも編集でも）。 */
    const cyc = e.target.closest('[data-cyclecheck]');
    if (cyc) {
      e.preventDefault();
      const pol = S.findPolicy(polId);
      if (pol) {
        if (editing) commitEdit();
        else if (editSection && editSection.key === 'checks') flushInputs(pol);
        S.cycleCheckState(pol, +cyc.dataset.cyclecheck);
        render();
      }
      return;
    }

    /* 確認の紙｜項目を1行足す（編集中のみ表示）。名前欄をすぐ開く。 */
    if (e.target.closest('[data-addcheck]')) {
      e.preventDefault();
      const pol = S.findPolicy(polId);
      if (pol) {
        flushInputs(pol);
        S.addCheck(pol, '');
        editSection = { id: polId, key: 'checks' };
        editing = { id: polId, path: 'checks.' + (pol.checks.length - 1) + '.item', kind: 'line' };
        render();
      }
      return;
    }
    const delC = e.target.closest('[data-delcheck]');
    if (delC) {
      e.preventDefault();
      const pol = S.findPolicy(polId);
      if (pol) { flushInputs(pol); S.removeCheck(pol, +delC.dataset.delcheck); render(); }
      return;
    }

    /* この保険の削除。開く → 確認 → 実行の2段。 */
    const dpo = e.target.closest('[data-delpolopen]');
    if (dpo) {
      e.preventDefault();
      if (editing) commitEdit();
      if (editSection) commitSection();
      confirmDelete = dpo.dataset.delpolopen;
      render();
      const z = sec.querySelector('.lf-del.confirming');
      if (z) z.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (e.target.closest('[data-delpolno]')) {
      e.preventDefault();
      confirmDelete = null;
      render();
      return;
    }
    const dpy = e.target.closest('[data-delpol]');
    if (dpy) {
      e.preventDefault();
      const pol = S.findPolicy(dpy.dataset.delpol);
      const name = pol ? pol.insurer : '';
      confirmDelete = null;
      editing = null; editSection = null;
      S.removePolicy(dpy.dataset.delpol);
      render();
      show('「' + name + '」を記録から削除しました');
      return;
    }

    /* 別の欄を押したら、開いていた単一欄はそこで確定。 */
    const inEditor = e.target.closest('[data-ef]');
    if (editing && !inEditor) { commitEdit(); return; }

    /* 値をクリック → その欄だけ開く。 */
    const edit = e.target.closest('[data-edit]');
    if (edit && !editSection) {
      if (editing) commitEdit();
      editing = { id: polId, path: edit.dataset.edit, kind: edit.dataset.kind };
      autoOpenPicker = true;
      render();
      return;
    }
  });

  sec.addEventListener('change', e => {
    const pvEl = e.target.closest('.pv');
    const pol = pvEl && S.findPolicy(pvEl.dataset.policy);
    if (!pol) return;

    /* 給付（請求できる場面）の入り切り。 */
    const bp = e.target.closest('[data-benefit]');
    if (bp) {
      if (editSection) flushInputs(pol);
      S.toggleBenefit(pol, bp.dataset.benefit);
      render();
      return;
    }

    /* 「選択式＋その他」のドロップダウン（商品名・保険期間・満期など）。 */
    const pick = e.target.closest('select[data-pick]');
    if (pick) {
      const path = pick.dataset.pick;
      /* 商品を変えると分類が再計算されうるので、古い分類欄は飛ばす。 */
      if (editSection) flushInputs(pol, path === 'product' ? 'kind' : path);
      if (pick.value === PICK_OTHER) {
        pickOther.add(path);          // 自由入力欄を開く
        render();
        return;
      }
      pickOther.delete(path);
      applyOne(pol, path, pick.value);
      if (editing && editing.path === path) editing = null;
      render();
      return;
    }

    /* 単一欄編集中のセレクト（会社・種類・支払方法）は選んだら確定。
       節編集中はその場で反映し、節は閉じない。 */
    const el = e.target.closest('[data-ef]');
    if (!el || el.tagName !== 'SELECT') return;
    if (editSection) {
      /* この節の他の入力欄（自由入力の商品名など）を先に書き戻してから、
         このセレクトを反映する。再描画で打ちかけの値を失わない。
         会社を変えると分類が再計算されうるので、古い分類欄は飛ばす。 */
      const path = el.dataset.path;
      flushInputs(pol, path === 'insurer' ? 'kind' : path);
      applyOne(pol, path, el.value);
      if (path === 'kind') S.ensureMasterChecks(pol);
      render();
      return;
    }
    commitEdit();
  });

  sec.addEventListener('focusout', e => {
    if (editSection) return;
    if (!editing || !e.target.closest('[data-ef]')) return;
    setTimeout(() => {
      if (editing && !sec.contains(document.activeElement)) commitEdit();
    }, 0);
  });

  sec.addEventListener('keydown', e => {
    /* 節編集中に足しかけの1行（editing）を Enter したら、その名前だけ
       確定して節は開いたまま。Escape は節ごと閉じる。 */
    if (editSection) {
      if (e.key === 'Escape') { e.stopPropagation(); commitSection(); return; }
      if (editing && e.key === 'Enter' && e.target.closest('[data-ef][data-path="' + editing.path + '"]')) {
        e.preventDefault();
        const pol = S.findPolicy(editing.id);
        if (pol) applyOne(pol, editing.path, e.target.value);
        editing = null;
        render();
      }
      return;
    }
    if (!editing) return;
    if (e.key === 'Escape') { e.stopPropagation(); cancelAll(); return; }
    if (e.key === 'Enter' && (editing.kind !== 'area' || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitEdit();
    }
  });

  /* 画面のどこか外側を押したら、開いている編集を確定して閉じる。
     詳細ゾーン内のクリックで render() が走ると target が DOM から外れる。
     その場合は「外側」ではないので何もしない。                       */
  document.addEventListener('click', e => {
    if (!e.target.isConnected) return;
    if (e.target.closest('#policies')) return;
    if (editing) commitEdit();
    if (editSection) commitSection();
    if (confirmDelete) { confirmDelete = null; render(); }
  });

  /* ── 保険を追加する ─────────────────────────────────
     登録は「種類（生命/医療…）を選ばせる」のではなく、会社→商品タイプ
     の順で選ぶ（正本 §2・§8）。カテゴリ・系統色・給付・確認項目は商品
     タイプから SeiZen が決める。会社が無い／商品が候補に無いときだけ、
     自由入力とカテゴリ選択に切り替える。                             */
  const addBtn  = document.getElementById('addPolicy');
  const addForm = document.getElementById('addForm');
  let addState = null;   // { insurer, product, freeProduct, kind } or null

  function optionList(items, cur, blank) {
    return (blank ? '<option value="">' + esc(blank) + '</option>' : '') +
      items.map(v => '<option value="' + esc(v) + '"' +
        (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
  }

  function renderAddForm() {
    if (!addForm) return;
    if (!addState) { addForm.hidden = true; addForm.innerHTML = ''; return; }
    addForm.hidden = false;

    const insurers = S.INSURERS.map(i => i.name);
    const products = addState.insurer ? S.productsForInsurer(addState.insurer).map(p => p.name) : [];
    const usingFree = addState.product === '__free__';
    const known = !usingFree && S.kindOfProduct(addState.product);
    const canAdd = !!addState.insurer &&
      ((known) || (usingFree && addState.freeProduct.trim() && addState.kind));

    addForm.innerHTML =
      '<div class="af-row">' +
        '<label class="af-f"><span>保険会社</span>' +
          '<select class="af-sel" data-af="insurer">' +
            optionList(insurers, addState.insurer, '選んでください') +
          '</select></label>' +
        '<label class="af-f"><span>商品</span>' +
          '<select class="af-sel" data-af="product"' + (addState.insurer ? '' : ' disabled') + '>' +
            optionList(products, usingFree ? '__free__' : addState.product, '選んでください') +
            '<option value="__free__"' + (usingFree ? ' selected' : '') + '>この一覧にない（自分で入力）</option>' +
          '</select></label>' +
      '</div>' +
      (usingFree
        ? '<div class="af-row">' +
            '<label class="af-f"><span>商品名</span>' +
              '<input class="af-in" data-af="freeProduct" value="' + esc(addState.freeProduct) + '" ' +
                'placeholder="証券に書かれている商品名"></label>' +
            '<label class="af-f"><span>この保険の分類</span>' +
              '<select class="af-sel" data-af="kind">' +
                optionList(Object.keys(S.KIND_TONES).map(k => S.KIND_TONES[k].label), S.KIND_TONES[addState.kind] && S.KIND_TONES[addState.kind].label, '選んでください') +
              '</select></label>' +
          '</div>'
        : '') +
      '<div class="af-btns">' +
        '<button type="button" class="af-add" data-afadd="1"' + (canAdd ? '' : ' disabled') + '>この内容で追加</button>' +
        '<button type="button" class="af-cancel" data-afcancel="1">やめる</button>' +
      '</div>';
  }

  function kindFromLabel(label) {
    const k = Object.keys(S.KIND_TONES).find(x => S.KIND_TONES[x].label === label);
    return k || '';
  }

  if (addBtn) addBtn.addEventListener('click', () => {
    if (editing) commitEdit();
    if (editSection) commitSection();
    addState = addState
      ? null
      : { insurer: '', product: '', freeProduct: '', kind: '' };
    renderAddForm();
    if (addState) addForm.querySelector('[data-af="insurer"]').focus();
  });

  if (addForm) {
    addForm.addEventListener('change', e => {
      const el = e.target.closest('[data-af]');
      if (!el || !addState) return;
      const key = el.dataset.af;
      if (key === 'insurer') {
        addState.insurer = el.value;
        addState.product = ''; addState.freeProduct = ''; addState.kind = '';
      } else if (key === 'product') {
        addState.product = el.value;
        if (el.value !== '__free__') addState.kind = S.kindOfProduct(el.value) || '';
      } else if (key === 'kind') {
        addState.kind = kindFromLabel(el.value);
      }
      renderAddForm();
    });
    addForm.addEventListener('input', e => {
      const el = e.target.closest('[data-af="freeProduct"]');
      if (el && addState) {
        addState.freeProduct = el.value;
        const btn = addForm.querySelector('[data-afadd]');
        const ok = addState.insurer && addState.freeProduct.trim() && addState.kind;
        if (btn) btn.disabled = !ok;
      }
    });
    addForm.addEventListener('click', e => {
      if (e.target.closest('[data-afcancel]')) { addState = null; renderAddForm(); return; }
      if (e.target.closest('[data-afadd]')) {
        if (!addState || !addState.insurer) return;
        const free = addState.product === '__free__';
        const productName = free ? addState.freeProduct.trim() : addState.product;
        const kind = free ? addState.kind : S.kindOfProduct(addState.product);
        if (!productName || !kind) return;
        const pol = S.addPolicy(addState.insurer, productName, kind);
        S.ensureMasterChecks(pol);
        addState = null;
        renderAddForm();
        render();
        const el = sec.querySelector('.pv[data-policy="' + pol.id + '"]');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('hit');
        }
        show('「' + pol.insurer + '　' + productName + '」を追加しました');
      }
    });
  }

  /* 種類ごとのマスタ確認項目は、行が無ければ補って常に並べる。 */
  S.policies.forEach(S.ensureMasterChecks);

  render();
})(window.SeiZenInsurance);
