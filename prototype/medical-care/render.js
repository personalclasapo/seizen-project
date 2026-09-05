/* SeiZen プロトタイプ｜医療・介護の描画
   ------------------------------------------------------------------
   画面は state.js の事実を描いた結果。医療ゾーン（手帳）と介護ゾーン
   （ベッド）を両方描く。

   書いてある場所がそのまま入力欄になる（銀行口座・保険・契約デジタル
   と同じ手つき）。欄をひとつ押せばその場で書き換えられ、節見出しの
   鉛筆を押せばその節をまとめて開く。状態バッジは押すと次の状態へ
   回る（確認済み→未確認→確認中→該当なし）。

   造形は医療＝手帳、介護＝ベッド（正本 §4-2）。通帳・証券フォルダ
   とは別の骨格でよい。ここで作った形を他領域へ機械的に持ち出さない
   （正本 §13）。                                                    */
(function (S) {
  'use strict';

  const esc  = SeiZen.esc;
  const show = SeiZen.toast;

  const medEl  = document.getElementById('medBook');
  const careEl = document.getElementById('careBed');

  /* 書いてある場所がそのまま入力欄になる。
       editing     … 欄ひとつだけを開く { path, kind }
       editSection … 節ごとにまとめて開く { key } */
  let editing = null;
  let editSection = null;
  /* 削除の確認を開いている行の id。 */
  let confirmDelete = null;

  /* どの節が、どの path を受け持つか。前方一致。 */
  const SEC_OF = {
    person:  ['medical.person.'],
    clinic:  ['medical.clinics'],
    pharm:   ['medical.pharmacies'],
    cond:    ['medical.conditions'],
    treat:   ['medical.treatments'],
    tell:    ['medical.tells'],
    meds:    ['medical.meds.'],
    docs:    ['medical.pocket', 'medical.papers'],
    slips:   ['medical.voice', 'medical.memo'],
    level:   ['care.level', 'care.place'],
    manager: ['care.manager.'],
    service: ['care.services'],
    know:    ['care.notes'],
    cpapers: ['care.papers']
  };
  function inSection(key, path) {
    return (SEC_OF[key] || []).some(p => path === p || path.indexOf(p) === 0);
  }

  const PEN  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="m4 20 4-1 11-11-3-3L5 16z"/></svg>';
  const DONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>';
  const XMARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const TEL = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.3 2.2Z"/></svg>';
  const WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round"><path d="M12 4 2.5 20.5h19L12 4Z"/><path d="M12 10v4.5M12 17.6v.1"/></svg>';

  const svgIc = (d, w) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="' +
    (w || 18) + '" height="' + (w || 18) + '">' + d + '</svg>';

  /* 型ごとの記号。放射図のカードと週の帯に出る。 */
  const SV_IC = {
    home:    '<path d="M4 11 12 4.5 20 11"/><path d="M6 9.6V19h12V9.6"/><path d="M10.2 19v-4.4h3.6V19"/>',
    out:     '<rect x="3" y="6.5" width="14" height="9" rx="1.6"/><path d="M17 9.5h2.5L21 12v3.5h-4"/>' +
             '<circle cx="7" cy="17" r="1.7"/><circle cx="17.5" cy="17" r="1.7"/>',
    equip:   '<circle cx="12" cy="12" r="7"/><path d="M12 7.5v9M7.5 12h9"/>',
    support: '<circle cx="8.6" cy="9" r="2.5"/><circle cx="15.6" cy="9" r="2.5"/>' +
             '<path d="M3.5 18.5c0-2.6 2.3-4.4 5.1-4.4M20.5 18.5c0-2.6-2.3-4.4-5.1-4.4"/>'
  };
  const PERSON_IC = '<circle cx="12" cy="7.6" r="3.5"/>' +
    '<path d="M4.8 20.5c0-4 3.2-7 7.2-7s7.2 3 7.2 7"/>';
  const CLINIC_IC = '<path d="M4 20V7.5L12 4l8 3.5V20"/><path d="M12 9.5v6M9 12.5h6"/>';
  const PHARM_IC = '<path d="M8.5 4.5h7M12 4.5v3"/><path d="M6.5 9.5h11L16 20H8L6.5 9.5Z"/>';

  /* ── 編集プリミティブ ───────────────────────────────
     ev()       … 一行／複数行テキスト。開いていれば入力欄。
     evSelect() … 選択肢から選ぶ値。                                */
  function isOpen(path) {
    if (editing && editing.path === path) return true;
    if (editSection && inSection(editSection.key, path)) return true;
    return false;
  }
  function ev(path, value, kind, placeholder) {
    if (isOpen(path)) {
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
  function evSelect(path, value, choices) {
    if (isOpen(path)) {
      return '<select class="i-ef i-ef-sel" data-ef="1" data-path="' + path + '">' +
        choices.map(c => '<option value="' + esc(c) + '"' +
          (c === value ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
        '</select>';
    }
    const empty = value === '' || value == null;
    return '<span class="i-ev' + (empty ? ' i-ev-empty' : '') + '" data-edit="' + path +
      '" data-kind="select">' + (empty ? '未選択' : esc(value)) + '</span>';
  }

  /* 状態バッジ。押すと次の状態へ回る（正本 §11）。 */
  function stBadge(path) {
    const row = S.getByPath(path);
    const st = S.checkState(row);
    return '<button type="button" class="st st-' + st.tone + '" data-cycle="' + path +
      '" aria-label="状態を変える">' + esc(row && row.state ? row.state : '未確認') + '</button>';
  }

  /* 節見出しの鉛筆。押すとその節をまとめて編集モードに。 */
  function editBtn(key) {
    const on = editSection && editSection.key === key;
    return '<button type="button" class="i-secedit' + (on ? ' on' : '') + '" ' +
      'data-editsec="' + key + '" aria-label="' + (on ? '編集を終える' : 'この節を編集') + '">' +
      (on ? DONE : PEN) + '</button>';
  }
  function secOn(key) { return editSection && editSection.key === key; }

  /* 行を消すボタン（節を開いているときだけ出す）。 */
  function delBtn(id) {
    if (confirmDelete === id) {
      return '<button type="button" class="rowdel" data-delyes="' + id +
        '" aria-label="削除する" style="border-color:#e0b3ae;color:#c9544b">' + DONE + '</button>';
    }
    return '<button type="button" class="rowdel" data-del="' + id +
      '" aria-label="この行を削除">' + XMARK + '</button>';
  }

  /* ══ 医療｜手帳 ═══════════════════════════════════════ */

  /* ── 手帳の造り ─────────────────────────────────────
     手帳を「緑の角丸矩形」で済ませない（CLAUDE.md）。綴じのある本
     として組む。

       1) 背（スパイン）… 左端の一段濃い帯と、そこに走る綴じ目
       2) 綴じ糸        … 背に等間隔で並ぶステッチ
       3) 型押しの罫    … 表紙の内側を回る細い箔の線
       4) しおり        … 上から垂れる細いリボン

     背は縦に伸びてよい（本が厚くなるだけ）ので幅なりに伸ばし、
     しおりの結び目のように形が決まっているものは原寸で置く。      */
  function bookBinding() {
    return '<svg class="bk-spine" viewBox="0 0 46 400" preserveAspectRatio="none" ' +
      'aria-hidden="true" focusable="false">' +
      '<defs>' +
        '<linearGradient id="bkSp" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0" stop-color="#1c3f2e"/>' +
          '<stop offset=".45" stop-color="#2c5a42"/>' +
          '<stop offset=".82" stop-color="#1b3d2c"/>' +
          '<stop offset="1" stop-color="#2f6046"/>' +
        '</linearGradient>' +
      '</defs>' +
      /* 背の地。 */
      '<rect width="46" height="400" fill="url(#bkSp)"/>' +
      /* 綴じの溝。背と表紙の境。 */
      '<path d="M38 0v400" stroke="#14301F" stroke-width="3" stroke-opacity=".8"/>' +
      '<path d="M41.5 0v400" stroke="#4a7d5e" stroke-width="1.5" stroke-opacity=".5"/>' +
      '</svg>' +
      /* 綴じ糸。等間隔のステッチ。糸1目の長さは本の高さで変わらない
         ので、伸ばさずに <pattern> で縦へ繰り返す。 */
      '<svg class="bk-stitch" aria-hidden="true">' +
        '<defs>' +
          '<pattern id="bkStitch" x="0" y="0" width="10" height="24" ' +
            'patternUnits="userSpaceOnUse">' +
            '<path d="M5 5v13" stroke="#8fae97" stroke-opacity=".5" ' +
              'stroke-width="2.4" stroke-linecap="round"/>' +
          '</pattern>' +
        '</defs>' +
        '<rect width="100%" height="100%" fill="url(#bkStitch)"/>' +
      '</svg>' +
      /* しおり。上から垂れ、先が V に切られている。 */
      '<svg class="bk-ribbon" viewBox="0 0 22 96" aria-hidden="true">' +
        '<path d="M0 0h22v78l-11-9-11 9Z" fill="#c58c55"/>' +
        '<path d="M0 0h22v10H0Z" fill="#a97243" fill-opacity=".55"/>' +
        '<path d="M14 0h8v78l-4-3.3Z" fill="#000" fill-opacity=".12"/>' +
      '</svg>';
  }

  function medSection(no, key, title, lead, body, cls) {
    return '<div class="bs ' + (cls || '') + '">' +
      '<div class="bs-h"><span class="bs-no">' + no + '</span>' +
      '<h5>' + esc(title) + '</h5>' +
      (lead ? '<small>' + esc(lead) + '</small>' : '') +
      editBtn(key) + '</div>' +
      '<div class="bs-body">' + body + '</div></div>';
  }

  /* ① 主な医療機関 */
  function clinicsBlock() {
    const m = S.data.medical;
    const on = secOn('clinic');
    const rows = (m.clinics || []).map((c, i) => {
      const p = 'medical.clinics.' + i + '.';
      const tags = on
        ? '<span class="cl-tags">' + ev(p + 'depts', S.tagsToText(c.depts), 'line', '診療科（読点区切り）') + '</span>'
        : '<span class="cl-tags">' + (c.depts || []).map(d =>
            '<span class="tag">' + esc(d) + '</span>').join('') + '</span>';
      return '<div class="cl">' +
        '<span class="cl-ic">' + svgIc(CLINIC_IC, 16) + '</span>' +
        '<span class="cl-name">' + ev(p + 'name', c.name, 'line', '医療機関の名前') + '</span>' +
        tags +
        '<span class="cl-reason">' + ev(p + 'reason', c.reason, 'line', '通っている理由') + '</span>' +
        '<span class="cl-tel">' + TEL + ev(p + 'tel', c.tel, 'line', '電話番号') + '</span>' +
        '<span class="cl-doctor">' + ev(p + 'doctor', c.doctor, 'line', '担当の先生') + '</span>' +
        stBadge('medical.clinics.' + i) +
        (on ? delBtn(c.id) : '') +
        '</div>';
    }).join('');
    return (rows || '<p class="i-ev-empty">まだ登録がありません。</p>') +
      (on ? '<button type="button" class="rowadd" data-add="clinic">＋ 医療機関を足す</button>' : '');
  }

  /* ② かかりつけ薬局 */
  function pharmBlock() {
    const m = S.data.medical;
    const on = secOn('pharm');
    const rows = (m.pharmacies || []).map((c, i) => {
      const p = 'medical.pharmacies.' + i + '.';
      return '<div class="cl cl-ph">' +
        '<span class="cl-ic">' + svgIc(PHARM_IC, 16) + '</span>' +
        '<span class="cl-name">' + ev(p + 'name', c.name, 'line', '薬局の名前') + '</span>' +
        '<span class="cl-tel">' + TEL + ev(p + 'tel', c.tel, 'line', '電話番号') + '</span>' +
        '<span class="cl-note">' + ev(p + 'note', c.note, 'line', '補足') + '</span>' +
        stBadge('medical.pharmacies.' + i) +
        (on ? delBtn(c.id) : '') +
        '</div>';
    }).join('');
    return (rows || '<p class="i-ev-empty">まだ登録がありません。</p>') +
      (on ? '<button type="button" class="rowadd" data-add="pharm">＋ 薬局を足す</button>' : '');
  }

  /* ③④ タグの並び（病名・治療）。編集では読点区切りの一行になる。 */
  function tagBlock(path, list, cls, placeholder) {
    if (isOpen(path)) {
      return '<div class="tagrow">' + ev(path, S.tagsToText(list), 'line', placeholder) + '</div>';
    }
    if (!(list || []).length) {
      return '<div class="tagrow"><span class="i-ev i-ev-empty" data-edit="' + path +
        '" data-kind="line">' + esc(placeholder) + '</span></div>';
    }
    return '<div class="tagrow">' + list.map(t =>
      '<span class="tag ' + cls + '">' + esc(t) + '</span>').join('') + '</div>';
  }

  /* ⑤ 医療機関に必ず伝えること。この領域の核。 */
  function tellBlock() {
    const m = S.data.medical;
    const on = secOn('tell');
    const rows = (m.tells || []).map((t, i) => {
      const type = S.tellType(t.type);
      const p = 'medical.tells.' + i + '.';
      const kindLine = on
        ? evSelect(p + 'type', t.type, Object.keys(S.TELL_TYPES))
        : esc(type.label);
      return '<div class="tell">' +
        '<span class="tell-dot"></span>' +
        '<span class="tell-tx"><b class="tell-kind">' + kindLine + '</b>' +
          ev(p + 'text', t.text, 'line', type.placeholder || '伝えることを書く') + '</span>' +
        stBadge('medical.tells.' + i) +
        (on ? delBtn(t.id) : '') +
        '</div>';
    }).join('');

    /* 空・未確認のものがあれば注意を出す。いざというとき家族が言えない。 */
    const pending = S.tellsUnresolved();
    const warn = pending.length
      ? '<div class="tell-warn">' + WARN + '<span><b>' + pending.length +
        '件</b>、まだ確かめられていません。救急のとき家族が伝えられるよう、' +
        '本人かかかりつけ医に確認しておきます。</span></div>'
      : '';

    return (rows || '<p class="i-ev-empty">まだ登録がありません。</p>') + warn +
      (on ? '<button type="button" class="rowadd" data-add="tell">＋ 伝えることを足す</button>' : '');
  }

  /* ⑥ 薬の正確な情報への入口 */
  function medsBlock() {
    const md = S.data.medical.meds;
    return '<table class="kv"><tbody>' +
      '<tr><th>現在の服薬</th><td>' +
        (isOpen('medical.meds.taking')
          ? evSelect('medical.meds.taking', md.taking, ['あり', 'なし', '未確認'])
          : '<span class="pill">' + esc(md.taking || '未確認') + '</span>') +
        '</td></tr>' +
      '<tr><th>お薬手帳</th><td>' +
        (isOpen('medical.meds.bookKind')
          ? evSelect('medical.meds.bookKind', md.bookKind, S.MEDBOOK_KINDS)
          : '<span class="pill">' + esc(md.bookKind || '未確認') + '</span>') +
        '　' + ev('medical.meds.bookWhere', md.bookWhere, 'line', 'どこで見られるか') +
        '</td></tr>' +
      '<tr><th>保管場所・アプリ</th><td>' +
        ev('medical.meds.appWhere', md.appWhere, 'line', '手帳・アプリの場所') + '</td></tr>' +
      '<tr><th>補足</th><td>' +
        ev('medical.meds.note', md.note, 'line', '家族への申し送り') + '</td></tr>' +
      '<tr><th>確認の状態</th><td>' + stBadge('medical.meds') + '</td></tr>' +
      '</tbody></table>';
  }

  /* ⑦ 書類。持ち歩くもの（ポケット）／自宅にあるもの（表）。 */
  function docsBlock() {
    const m = S.data.medical;
    const on = secOn('docs');

    const slots = (m.pocket || []).map((r, i) => {
      const p = 'medical.pocket.' + i + '.';
      return '<div class="pocket-slot">' +
        '<span class="pocket-item">' +
          (on ? evSelect(p + 'item', r.item, S.POCKET_ITEMS) : esc(r.item)) + '</span>' +
        '<span class="pocket-where">' + ev(p + 'where', r.where, 'line', 'どこにあるか') + '</span>' +
        stBadge('medical.pocket.' + i) +
        (on ? delBtn(r.id) : '') +
        '</div>';
    }).join('');

    const papers = (m.papers || []).map((r, i) => {
      const p = 'medical.papers.' + i + '.';
      return '<tr><th>' + ev(p + 'item', r.item, 'line', '書類の種類') + '</th>' +
        '<td>' + ev(p + 'where', r.where, 'line', '保管場所') + '　' +
        stBadge('medical.papers.' + i) +
        (on ? ' ' + delBtn(r.id) : '') + '</td></tr>';
    }).join('');

    return '<div class="bk-docs">' +
      '<div class="pocket">' +
        '<div class="pocket-h">' +
          svgIc('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18"/>', 14) +
          '持ち歩くもの</div>' +
        (slots || '<p class="i-ev-empty">まだ登録がありません。</p>') +
        (on ? '<button type="button" class="rowadd" data-add="pocket">＋ 足す</button>' : '') +
      '</div>' +
      '<div class="papers">' +
        '<div class="pocket-h">' +
          svgIc('<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4"/>', 14) +
          '自宅にあるもの</div>' +
        '<table class="kv"><tbody>' + papers + '</tbody></table>' +
        (on ? '<button type="button" class="rowadd" data-add="paper">＋ 足す</button>' : '') +
      '</div>' +
      '</div>';
  }

  /* 本人の声＋通院メモ。手帳に挟んだ紙。 */
  function slipsBlock() {
    const m = S.data.medical;
    const memoLines = String(m.memo || '').split('\n').filter(Boolean);
    return '<div class="bk-slips">' +
      '<div class="slip slip-voice">' +
        '<div class="slip-h">本人より</div>' +
        ev('medical.voice', m.voice, 'line', '本人のことば') +
        '<cite>── 本人</cite>' +
      '</div>' +
      '<div class="slip slip-memo">' +
        '<div class="slip-h">メモ</div>' +
        (isOpen('medical.memo')
          ? ev('medical.memo', m.memo, 'area', '通院のメモ（1行1件）')
          : (memoLines.length
              ? '<ul>' + memoLines.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>'
              : '<span class="i-ev i-ev-empty" data-edit="medical.memo" data-kind="area">通院のメモ</span>')) +
      '</div>' +
      '</div>';
  }

  function renderMedical() {
    if (!medEl) return;
    const m = S.data.medical;
    const p = m.person || {};

    medEl.innerHTML =
      '<div class="bk">' +
        bookBinding() +
        /* 表紙。救急で最初に読まれる識別情報を、いちばん上に置く。 */
        '<div class="bk-cover">' +
          '<div class="bk-title">' +
            '<h4>医療の記録</h4>' +
            '<p>この記録があれば、はじめての場所でも安心して診てもらえます。</p>' +
          '</div>' +
          '<div class="bk-id">' +
            '<div class="bk-id-name">' +
              '<b>' + ev('medical.person.name', p.name, 'line', '氏名') + '</b>' +
              '<span>様</span>' + editBtn('person') +
            '</div>' +
            '<dl>' +
              '<dt>生年月日</dt><dd>' + ev('medical.person.birth', p.birth, 'line', '生年月日') + '</dd>' +
              '<dt>血液型</dt><dd>' + ev('medical.person.blood', p.blood, 'line', '血液型') + '</dd>' +
            '</dl>' +
          '</div>' +
        '</div>' +

        '<div class="bk-page">' +
          medSection(1, 'clinic', '主な医療機関', 'いつも診てもらっている医療機関です。', clinicsBlock()) +
          medSection(2, 'pharm', 'かかりつけ薬局', 'いつも調剤してもらっている薬局です。', pharmBlock()) +
          medSection(3, 'cond', '現在治療中の主な病気・状態', '',
            tagBlock('medical.conditions', m.conditions, 'tag-cond', '病名（読点区切り）')) +
          medSection(4, 'treat', '継続している重要な治療・処置', '',
            tagBlock('medical.treatments', m.treatments, 'tag-treat', '治療・処置（読点区切り）')) +
          medSection(5, 'tell', '医療機関に必ず伝えること',
            '救急のとき、まっさきに伝えます。', tellBlock(), 'bs-tell') +
          medSection(6, 'meds', '薬の正確な情報への入口',
            'くすりの詳しい内容は、ここから確認できます。', medsBlock()) +
          medSection(7, 'docs', '医療関係書類',
            '診察券や医療の書類の保管場所です。', docsBlock()) +
          '<div class="bs">' + slipsBlock() + '</div>' +
        '</div>' +
      '</div>';
  }

  /* ══ 介護｜ベッド ═══════════════════════════════════════ */

  /* ── ベッドの絵 ─────────────────────────────────────
     介護ベッドを描く。角丸の矩形に色を敷いただけでは「茶色い板」に
     しかならないので、物として組む（CLAUDE.md）。

       1) 支柱（左右）と笠木、その間に縦の桟 … ヘッドボードの骨格
       2) マットレス と 掛け布団の折り返し   … 枕が載る面
       3) 柵（サイドレール）                 … 介護ベッドの記号
       4) リモコン（ボタン＋コード）         … 介護が必要な生活の記号

     枕は HTML 側（.bed-pillow）が持つ。文字が載るので、絵の中では
     なく上に重ねる。ここで描くのはその「下地」まで。

     幅は preserveAspectRatio="none" で伸ばさず、slice で中央を保つ。
     縦は固定寸なので、幅が変わっても桟や柵の太さが歪まない。       */
  /* 支柱1本。柱・球の飾り・そのハイライト。左右で使い回す。 */
  function bedPost() {
    return '<rect x="14" y="24" width="32" height="184" rx="16" fill="url(#bdPost2)"/>' +
      '<circle cx="30" cy="22" r="19" fill="#d8b993"/>' +
      '<circle cx="30" cy="22" r="19" fill="none" stroke="#b18f63" stroke-width="1.5"/>' +
      '<circle cx="24" cy="16" r="6.5" fill="#f0e2cc" fill-opacity=".85"/>' +
      /* 柱に巻く帯。作りを一段見せる。 */
      '<rect x="12" y="52" width="36" height="7" rx="3.5" fill="#b48f61"/>' +
      '<defs><linearGradient id="bdPost2" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="#a8825a"/>' +
        '<stop offset=".35" stop-color="#d9bb96"/>' +
        '<stop offset="1" stop-color="#9c764d"/>' +
      '</linearGradient></defs>';
  }

  function bedScene() {
    return '<svg class="bed-svg" viewBox="0 0 900 300" preserveAspectRatio="none" ' +
      'aria-hidden="true" focusable="false">' +
      '<defs>' +
        /* 木の面。上が明るく下が沈む。 */
        '<linearGradient id="bdWood" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#cfae87"/>' +
          '<stop offset=".55" stop-color="#bd9769"/>' +
          '<stop offset="1" stop-color="#a88254"/>' +
        '</linearGradient>' +
        '<linearGradient id="bdPost" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0" stop-color="#a8825a"/>' +
          '<stop offset=".35" stop-color="#d3b48f"/>' +
          '<stop offset="1" stop-color="#9c764d"/>' +
        '</linearGradient>' +
        /* 寝具。ほぼ白いが、影で面を出す。 */
        '<linearGradient id="bdSheet" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#fbf9f2"/>' +
          '<stop offset="1" stop-color="#e9e5d8"/>' +
        '</linearGradient>' +
        '<linearGradient id="bdQuilt" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#dfe7e6"/>' +
          '<stop offset="1" stop-color="#c4d0d0"/>' +
        '</linearGradient>' +
      '</defs>' +

      /* 壁。ヘッドボードの背後。 */
      '<rect width="900" height="300" fill="#efe7da"/>' +

      /* ── ヘッドボード（横に伸びてよい部分）──
         背板・笠木・桟・寝具は幅なりに伸びる。伸びても意味が壊れない
         （板は横長になるだけ）。 */
      '<rect x="20" y="26" width="860" height="150" rx="10" fill="url(#bdWood)"/>' +
      '<g stroke="#96774f" stroke-opacity=".45" stroke-width="2">' +
        Array.from({ length: 13 }, (_, i) =>
          '<path d="M' + (78 + i * 62) + ' 44V162"/>').join('') +
      '</g>' +
      /* 笠木（上桟）。板の上に載る一本。 */
      '<rect x="8" y="12" width="884" height="28" rx="14" fill="#d8b993"/>' +
      '<rect x="8" y="12" width="884" height="11" rx="5.5" fill="#e6cba9"/>' +

      /* ── 寝具 ── */
      '<rect x="0" y="176" width="900" height="72" fill="url(#bdSheet)"/>' +
      '<path d="M0 196h900" stroke="#d8d2c2" stroke-width="2"/>' +
      /* 掛け布団の折り返し。 */
      '<rect x="0" y="238" width="900" height="62" fill="url(#bdQuilt)"/>' +
      '<path d="M0 238h900" stroke="#b7c4c4" stroke-width="2"/>' +
      /* 掛け布団のしわ。折り返しの下に柔らかい弧を数本。 */
      '<g fill="none" stroke="#aebcbc" stroke-opacity=".6" stroke-width="2" stroke-linecap="round">' +
        '<path d="M90 262q40 12 80 0M330 266q40 12 80 0M580 262q40 12 80 0"/>' +
      '</g>' +
      '</svg>' +

      /* ── 伸ばしてはいけない物 ──────────────────────
         支柱の球飾りとリモコンは、伸ばすと楕円・平たい板になって
         「何の絵か」が壊れる。幅に追従させず、左右の端と決まった
         位置に原寸で置く（iPhone のステータスバーと同じ考え方）。 */
      '<svg class="bed-post bed-post-l" viewBox="0 0 60 210" aria-hidden="true">' +
        bedPost() + '</svg>' +
      '<svg class="bed-post bed-post-r" viewBox="0 0 60 210" aria-hidden="true">' +
        bedPost() + '</svg>' +
      '<svg class="bed-remote-svg" viewBox="0 0 60 190" aria-hidden="true">' +
        /* コード。笠木のあたりから垂れる。 */
        '<path d="M34 0c0 34-18 40-18 74" fill="none" stroke="#b6b0a2" ' +
          'stroke-width="4" stroke-linecap="round"/>' +
        /* 本体 */
        '<rect x="1.5" y="74" width="40" height="94" rx="11" fill="#f2f0e8" ' +
          'stroke="#aca696" stroke-width="2.5"/>' +
        /* 画面の窓 */
        '<rect x="9" y="83" width="25" height="16" rx="4.5" fill="#9fb0a4"/>' +
        /* ボタン */
        '<g fill="#b9b3a6">' +
          '<rect x="10" y="108" width="23" height="8" rx="4"/>' +
          '<rect x="10" y="122" width="23" height="8" rx="4"/>' +
          '<rect x="10" y="136" width="23" height="8" rx="4"/>' +
          '<rect x="10" y="150" width="23" height="8" rx="4"/>' +
        '</g>' +
      '</svg>';
  }

  function careSection(no, key, title, lead, body) {
    return '<div class="cs">' +
      '<div class="cs-h"><span class="cs-no">' + no + '</span>' +
      '<h5>' + esc(title) + '</h5>' +
      (lead ? '<small>' + esc(lead) + '</small>' : '') +
      editBtn(key) + '</div>' +
      '<div class="cs-body">' + body + '</div></div>';
  }

  /* ① 現在の介護状態 */
  function levelBlock() {
    const c = S.data.care;
    const certified = S.isCertified(c.level);
    const badge = isOpen('care.level')
      ? evSelect('care.level', c.level, S.CARE_LEVELS)
      : '<span class="lv-badge' + (certified ? '' : ' off') + '">' +
        esc(c.level || '未確認') + '</span>';
    return '<div class="lv"><span class="lv-lb">要介護度</span>' + badge + '</div>' +
      '<div class="lv-place">' +
        '<span class="lv-place-ic">' + svgIc('<path d="M4 11 12 4.5 20 11"/><path d="M6 9.6V19h12V9.6"/>', 17) + '</span>' +
        '<span class="lv-lb">現在の生活場所</span>' +
        '<b>' + (isOpen('care.place')
          ? evSelect('care.place', c.place, S.PLACES)
          : esc(c.place || '未確認')) + '</b>' +
        '<span class="lv-note">' + ev('care.placeNote', c.placeNote, 'line', '住まいの様子') + '</span>' +
      '</div>';
  }

  /* ② 担当ケアマネジャー。連絡先ではなく「介護の入口」。 */
  function managerBlock() {
    const mg = S.data.care.manager || {};
    return '<div class="cm">' +
      '<span class="cm-av">' + svgIc(PERSON_IC, 26) + '</span>' +
      '<span class="cm-tx">' +
        '<span class="cm-name">' + ev('care.manager.name', mg.name, 'line', 'ケアマネジャーの名前') +
          '<small>さん</small></span>' +
        '<span class="cm-office">' + ev('care.manager.office', mg.office, 'line', '事業所名') + '</span>' +
        '<span class="cm-tel">' + TEL + ev('care.manager.tel', mg.tel, 'line', '電話番号') + '</span>' +
      '</span>' +
      '<span class="cm-note">' + ev('care.manager.note', mg.note, 'line', '補足') + '<br>' +
        stBadge('care.manager') + '</span>' +
      '<span class="cm-sticky">困ったときは、<br>まずケアマネさんに<br>連絡してください。</span>' +
      '</div>';
  }

  /* ③ 利用中の介護サービス｜放射図＋週の帯 */
  function serviceCard(sv, i, side) {
    const kind = S.serviceKind(sv.kind);
    const on = secOn('service');
    const p = 'care.services.' + i + '.';
    /* 矢印は中心へ向かう。左列は右向き、右列は左向き（CSSが反転）。 */
    const arrow = '<span class="sv-arrow">' +
      '<svg viewBox="0 0 20 12" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M1 6h16"/><path d="m13 2 4 4-4 4"/></svg></span>';

    const days = on
      ? '<span class="dayedit">' + S.DAYS.map((d, di) =>
          '<button type="button" class="' + ((sv.days || []).indexOf(di) > -1 ? 'on' : '') +
          '" data-day="' + i + ':' + di + '">' + d + '</button>').join('') + '</span>'
      : '';

    return '<div class="sv ' + kind.tone + '">' +
      '<div class="sv-h">' +
        '<span class="sv-ic">' + svgIc(SV_IC[sv.kind] || SV_IC.support, 16) + '</span>' +
        '<span class="sv-name">' + ev(p + 'name', sv.name, 'line', 'サービス名') + '</span>' +
      '</div>' +
      '<div class="sv-provider">' + ev(p + 'provider', sv.provider, 'line', '事業所名') + '</div>' +
      '<div class="sv-tel">' + TEL + ev(p + 'tel', sv.tel, 'line', '電話番号') + '</div>' +
      '<div class="sv-freq">' + ev(p + 'freq', sv.freq, 'line', '頻度・曜日') + '</div>' +
      '<div class="sv-detail">' + ev(p + 'detail', sv.detail, 'line', '内容') + '</div>' +
      days +
      '<div class="sv-foot">' + stBadge('care.services.' + i) +
        (on ? delBtn(sv.id) : '') + '</div>' +
      arrow +
      '</div>';
  }

  function weekBlock() {
    if (!S.hasSchedule()) return '';
    const grid = S.weekGrid().map((d, i) => {
      const chips = d.services.map(sv => {
        const kind = S.serviceKind(sv.kind);
        return '<span class="wd-chip ' + kind.tone + '">' +
          esc(sv.name || kind.label) + '</span>';
      }).join('');
      return '<div class="wd wd-' + (i + 1) + '">' +
        '<span class="wd-lb">' + esc(d.label) + '</span>' +
        (chips || '<span class="wd-none">—</span>') + '</div>';
    }).join('');
    return '<div class="week">' +
      '<div class="week-h">' +
        svgIc('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>', 14) +
        '一週間の予定<small>　常時のもの（福祉用具など）は上の図に出ています</small></div>' +
      '<div class="week-grid">' + grid + '</div>' +
      '</div>';
  }

  function servicesBlock() {
    const list = S.data.care.services || [];
    const on = secOn('service');
    if (!list.length) {
      return '<p class="i-ev-empty">まだ登録がありません。</p>' +
        (on ? '<button type="button" class="rowadd" data-add="service">＋ サービスを足す</button>' : '');
    }
    /* 中心を挟んで左右に振り分ける。奇数なら左が1つ多い。 */
    const half = Math.ceil(list.length / 2);
    const left  = list.slice(0, half);
    const right = list.slice(half);

    return '<div class="radial">' +
      '<div class="radial-l">' +
        left.map((sv, k) => serviceCard(sv, k, 'l')).join('') + '</div>' +
      '<div class="radial-c">' +
        '<span class="person">' + svgIc(PERSON_IC, 44) + '</span>' +
        '<span class="person-lb">本人</span>' +
      '</div>' +
      '<div class="radial-r">' +
        right.map((sv, k) => serviceCard(sv, half + k, 'r')).join('') + '</div>' +
      '</div>' +
      weekBlock() +
      (on ? '<button type="button" class="rowadd" data-add="service">＋ サービスを足す</button>' : '');
  }

  /* ④ 家族が知っておきたいこと */
  function knowBlock() {
    const c = S.data.care;
    const body = isOpen('care.notes')
      ? ev('care.notes', S.linesToText(c.notes), 'area', '1行に1件')
      : ((c.notes || []).length
          ? '<ul class="knowlist">' + c.notes.map(n =>
              '<li>' + esc(n) + '</li>').join('') + '</ul>'
          : '<span class="i-ev i-ev-empty" data-edit="care.notes" data-kind="area">' +
            '急に対応することになったとき、知っておくと安心なこと</span>');
    return '<div class="know-wrap">' +
      '<div style="flex:1;min-width:240px">' + body + '</div>' +
      '<span class="know-sticky">普段と様子が違うときは、無理せずケアマネさんに相談しましょう。</span>' +
      '</div>';
  }

  /* ⑤ 介護関係書類 */
  function carePapersBlock() {
    const c = S.data.care;
    const on = secOn('cpapers');
    const rows = (c.papers || []).map((r, i) => {
      const p = 'care.papers.' + i + '.';
      return '<tr><th>' + ev(p + 'item', r.item, 'line', '書類の種類') + '</th>' +
        '<td>' + ev(p + 'where', r.where, 'line', '保管場所') + '　' +
        stBadge('care.papers.' + i) +
        (on ? ' ' + delBtn(r.id) : '') + '</td></tr>';
    }).join('');
    return '<table class="kv"><tbody>' + rows + '</tbody></table>' +
      '<p class="sec-lead" style="margin:9px 0 0">原本の場所は「書類・資料」にまとめています。</p>' +
      (on ? '<button type="button" class="rowadd" data-add="cpaper">＋ 足す</button>' : '');
  }

  function renderCare() {
    if (!careEl) return;
    careEl.innerHTML =
      '<div class="bed">' +
        '<div class="bed-head">' +
          bedScene() +
          '<div class="bed-pillows">' +
            '<div class="bed-pillow bed-pillow-main">' +
              '<span class="bed-pillow-ic">' +
                svgIc('<path d="M4 11 12 4.5 20 11"/><path d="M6 9.6V19h12V9.6"/>' +
                      '<path d="M10.2 19v-4.4h3.6V19"/>', 26) + '</span>' +
              '<div><h4>介護</h4><p>支えてもらう。つながる。安心して暮らす。</p></div>' +
            '</div>' +
            '<div class="bed-pillow bed-pillow-say">' +
              '<p>なじみの場所で、これからも<br>自分らしく過ごせるように。<br>みんなで支えています。</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bed-body">' +
          careSection(1, 'level', '現在の介護状態', '現在の認定状況や生活場所です。', levelBlock()) +
          careSection(2, 'manager', '担当ケアマネジャー（介護の中心・入口）',
            '介護に関する相談や調整の窓口です。', managerBlock()) +
          careSection(3, 'service', '利用中の介護サービス',
            '現在利用している支援の体制です。', servicesBlock()) +
          careSection(4, 'know', '家族が知っておきたいこと',
            '急に対応することになったときに、知っておくと安心なことです。', knowBlock()) +
          careSection(5, 'cpapers', '介護関係書類',
            '介護保険やケアプランなどの書類の保管場所です。', carePapersBlock()) +
        '</div>' +
      '</div>';
  }

  /* ══ 描画とカウント ═══════════════════════════════════ */

  function render() {
    renderMedical();
    renderCare();

    /* 見出しの件数。まだ辿れないものがあれば出す（正本 §12：入力率
       ではなく、必要な状態がどこまで成立しているか）。 */
    const mt = S.medicalTally(), ct = S.careTally();
    const cnt = (el, t) => {
      if (!el) return;
      if (t.open) { el.hidden = false; el.textContent = '未確認 ' + t.open + '件'; }
      else { el.hidden = false; el.textContent = '確認済み'; }
    };
    cnt(document.getElementById('cntMed'), mt);
    cnt(document.getElementById('cntCare'), ct);
    SeiZen.setNavCount('medical-care', S.openCount() || '');

    /* 開いたばかりの欄へ入る。 */
    if (editing) {
      const el = document.querySelector('[data-ef][data-path="' + editing.path + '"]');
      if (el) {
        el.focus();
        if (el.select && editing.kind !== 'area') el.select();
      }
    }
  }

  /* ── 編集の確定 ─────────────────────────────────────
     開いている入力欄の値を state へ書き戻す。配列で持っている項目
     （病名・治療・箇条書き）は専用の適用関数を通す。               */
  const TAG_PATHS  = ['medical.conditions', 'medical.treatments'];
  const LINE_PATHS = ['care.notes'];

  function applyOne(path, value) {
    if (TAG_PATHS.indexOf(path) > -1) return S.applyTags(path, value);
    if (LINE_PATHS.indexOf(path) > -1) return S.applyLines(path, value);
    if (/^medical\.clinics\.\d+\.depts$/.test(path)) return S.applyTags(path, value);
    /* サービス名は型（kind）が連動する。 */
    const m = /^care\.services\.(\d+)\.name$/.exec(path);
    if (m) {
      const sv = S.data.care.services[+m[1]];
      return S.setServiceName(sv, String(value).trim());
    }
    return S.applyValue(path, value);
  }

  /* いま開いている入力欄をすべて state へ流し込む。 */
  function flushInputs() {
    let changed = false;
    document.querySelectorAll('[data-ef][data-path]').forEach(el => {
      if (applyOne(el.dataset.path, el.value)) changed = true;
    });
    return changed;
  }

  function commitEdit() {
    if (!editing) return;
    const changed = flushInputs();
    editing = null;
    if (changed) S.save();
    render();
  }
  function commitSection() {
    if (!editSection) return;
    const changed = flushInputs();
    editSection = null;
    editing = null;
    if (changed) S.save();
    render();
  }
  function cancelAll() {
    editing = null;
    editSection = null;
    confirmDelete = null;
    render();
  }

  /* ── 操作 ───────────────────────────────────────────
     医療ゾーンと介護ゾーンで同じ手つきなので、両方の器に同じ
     ハンドラを掛ける。                                            */
  function wire(host) {
    if (!host) return;

    host.addEventListener('click', e => {
      /* 状態バッジ。押すと次の状態へ回る。 */
      const cy = e.target.closest('[data-cycle]');
      if (cy) {
        const row = S.getByPath(cy.dataset.cycle);
        S.cycleState(row);
        S.save();
        render();
        return;
      }

      /* 節ごとの編集を開く／閉じる。 */
      const se = e.target.closest('[data-editsec]');
      if (se) {
        const key = se.dataset.editsec;
        if (editSection && editSection.key === key) { commitSection(); return; }
        if (editing) flushInputs();
        editing = null;
        confirmDelete = null;
        editSection = { key: key };
        render();
        return;
      }

      /* 行を足す。 */
      const add = e.target.closest('[data-add]');
      if (add) {
        flushInputs();
        const what = add.dataset.add;
        if (what === 'clinic') S.addClinic();
        else if (what === 'pharm') S.addPharmacy();
        else if (what === 'tell') S.addTell('other');
        else if (what === 'service') S.addService('', 'home');
        else if (what === 'pocket')
          S.data.medical.pocket.push({ id: 'pk-' + Date.now(), item: '診察券', where: '', state: '未確認' });
        else if (what === 'paper')
          S.data.medical.papers.push({ id: 'pp-' + Date.now(), item: '', where: '', state: '未確認' });
        else if (what === 'cpaper')
          S.data.care.papers.push({ id: 'cp-' + Date.now(), item: '', where: '', state: '未確認' });
        S.save();
        render();
        return;
      }

      /* 行を消す。1度目で確認、2度目で実行。 */
      const del = e.target.closest('[data-del]');
      if (del) { confirmDelete = del.dataset.del; render(); return; }
      const yes = e.target.closest('[data-delyes]');
      if (yes) {
        S.removeAny(yes.dataset.delyes);
        confirmDelete = null;
        S.save();
        render();
        show('1件削除しました');
        return;
      }

      /* 曜日の入り切り。 */
      const day = e.target.closest('[data-day]');
      if (day) {
        const parts = day.dataset.day.split(':');
        S.toggleDay(S.data.care.services[+parts[0]], +parts[1]);
        S.save();
        render();
        return;
      }

      /* 欄をひとつ開く。 */
      const cell = e.target.closest('[data-edit]');
      if (cell) {
        const path = cell.dataset.edit;
        if (editing && editing.path === path) return;
        if (editing) flushInputs();
        editing = { path: path, kind: cell.dataset.kind || 'line' };
        render();
      }
    });

    /* セレクトは選ばれた瞬間に書き戻す。 */
    host.addEventListener('change', e => {
      const el = e.target.closest('[data-ef][data-path]');
      if (!el || el.tagName !== 'SELECT') return;
      if (applyOne(el.dataset.path, el.value)) S.save();
      /* 節ごとの編集中は開いたまま。単独の欄なら閉じる。 */
      if (!editSection) editing = null;
      render();
    });
  }
  wire(medEl);
  wire(careEl);

  /* Enter で確定、Escape で閉じる。節ごとの編集中は、Enter はその欄を
     確定して節は開いたまま。Escape は節ごと閉じる。 */
  document.addEventListener('keydown', e => {
    if (editSection) {
      if (e.key === 'Escape') { e.stopPropagation(); commitSection(); return; }
      if (editing && e.key === 'Enter' &&
          e.target.closest('[data-ef][data-path="' + editing.path + '"]') &&
          editing.kind !== 'area') {
        e.preventDefault();
        if (applyOne(editing.path, e.target.value)) S.save();
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
     ゾーン内のクリックで render() が走ると target が DOM から外れる。
     その場合は「外側」ではないので何もしない。                       */
  document.addEventListener('click', e => {
    if (!e.target.isConnected) return;
    if (e.target.closest('#medBook') || e.target.closest('#careBed')) return;
    if (editing) commitEdit();
    if (editSection) commitSection();
    if (confirmDelete) { confirmDelete = null; render(); }
  });

  render();
})(window.SeiZenMedicalCare);
