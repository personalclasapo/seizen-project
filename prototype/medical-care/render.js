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
  /* 節見出しの記号。番号のかわりに、その節が何の話かを記号で言う。 */
  const WARN_IC  = '<path d="M12 3.5 2 20.5h20L12 3.5Z"/><path d="M12 10v4.6M12 17.6v.1"/>';
  const PULSE_IC = '<path d="M3 12.5h3.6l2-5.2 3 10 2.4-6.4 1.6 1.6H21"/>';
  const TREAT_IC = '<path d="M4.5 15.5 15.5 4.5l4 4-11 11H4.5Z"/><path d="M12.5 7.5l4 4"/>' +
                   '<path d="M3 21h8"/>';
  const PILL_IC  = '<rect x="3" y="9.5" width="18" height="9" rx="4.5" ' +
                   'transform="rotate(-40 12 14)"/><path d="M9 8.5 15 15"/>';
  const DOC_IC   = '<path d="M6.5 3h8l4 4v14h-12Z"/><path d="M14.5 3v4h4"/>' +
                   '<path d="M9 12h6M9 15.5h4"/>';
  /* 要介護度＝制度上の区分。段階を表す階段の記号。 */
  const LEVEL_IC = '<path d="M3.5 19h5v-4h5v-4h5.5"/><path d="M19 11v8H3.5"/>';

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

  /* 節。番号は振らない。①→⑦の順に埋めていくものではなく、救急で
     読む節（伝えること）も、辿るための節（薬の入口）も、性質が別だから
     （正本 §12：入力率を進捗にしない）。見出しは記号＋文字で分ける。 */
  function medSection(key, icon, title, lead, body, cls) {
    return '<div class="bs ' + (cls || '') + '">' +
      '<div class="bs-h"><span class="bs-ic">' + svgIc(icon, 16) + '</span>' +
      '<h5>' + esc(title) + '</h5>' +
      (lead ? '<small>' + esc(lead) + '</small>' : '') +
      editBtn(key) + '</div>' +
      '<div class="bs-body">' + body + '</div></div>';
  }

  /* 主な医療機関。1件ずつが「かかっている先」として並立するので、
     帯に潰さずカードで横に並べる。カードの中では
       診療科（何科か）→ 名前 → 何のために → 誰に → 連絡先
     の順で、上から重要度が下がる。                                 */
  function clinicsBlock() {
    const m = S.data.medical;
    const on = secOn('clinic');
    const cards = (m.clinics || []).map((c, i) => {
      const p = 'medical.clinics.' + i + '.';
      const tags = on
        ? '<div class="mc-depts">' + ev(p + 'depts', S.tagsToText(c.depts), 'line', '診療科（読点区切り）') + '</div>'
        : '<div class="mc-depts">' + (c.depts || []).map(d =>
            '<span class="tag tag-dept">' + esc(d) + '</span>').join('') + '</div>';
      return '<div class="mc">' +
        '<div class="mc-top">' +
          '<span class="mc-ic">' + svgIc(CLINIC_IC, 17) + '</span>' +
          tags + stBadge('medical.clinics.' + i) +
          (on ? delBtn(c.id) : '') +
        '</div>' +
        '<div class="mc-name">' + ev(p + 'name', c.name, 'line', '医療機関の名前') + '</div>' +
        '<div class="mc-reason">' + ev(p + 'reason', c.reason, 'line', '通っている理由') + '</div>' +
        '<dl class="mc-kv">' +
          '<dt>担当</dt><dd>' + ev(p + 'doctor', c.doctor, 'line', '担当の先生') + '</dd>' +
          '<dt>電話</dt><dd class="mc-tel">' + TEL +
            ev(p + 'tel', c.tel, 'line', '電話番号') + '</dd>' +
        '</dl>' +
        '</div>';
    }).join('');
    return '<div class="mcgrid">' +
      (cards || '<p class="i-ev-empty">まだ登録がありません。</p>') + '</div>' +
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
    /* 1件ずつを「読み上げる1項目」として組む。左に何の話か（種別）、
       右に読み上げる文。文字は本文より大きく――救急隊員に見せる／
       家族が声に出す場所なので、小さい字で3行並べない。            */
    const rows = (m.tells || []).map((t, i) => {
      const type = S.tellType(t.type);
      const p = 'medical.tells.' + i + '.';
      const kindLine = on
        ? evSelect(p + 'type', t.type, Object.keys(S.TELL_TYPES))
        : esc(type.label);
      return '<li class="tell' + (type.urgent ? ' tell-urgent' : '') + '">' +
        '<span class="tell-kind">' + kindLine + '</span>' +
        '<span class="tell-tx">' +
          ev(p + 'text', t.text, 'line', type.placeholder || '伝えることを書く') + '</span>' +
        '<span class="tell-st">' + stBadge('medical.tells.' + i) +
          (on ? delBtn(t.id) : '') + '</span>' +
        '</li>';
    }).join('');

    /* 空・未確認のものがあれば注意を出す。いざというとき家族が言えない。 */
    const pending = S.tellsUnresolved();
    const warn = pending.length
      ? '<div class="tell-warn">' + WARN + '<span><b>' + pending.length +
        '件</b>、まだ確かめられていません。救急のとき家族が伝えられるよう、' +
        '本人かかかりつけ医に確認しておきます。</span></div>'
      : '';

    return (rows ? '<ul class="telllist">' + rows + '</ul>'
                 : '<p class="i-ev-empty">まだ登録がありません。</p>') + warn +
      (on ? '<button type="button" class="rowadd" data-add="tell">＋ 伝えることを足す</button>' : '');
  }

  /* 薬の正確な情報への入口。ここは「入口」なので、4行の表ではなく
     行き先そのものを大きく出す。左＝どこを見ればよいか（行き先）、
     右＝いま服薬があるか（前提）と申し送り。                       */
  function medsBlock() {
    const md = S.data.medical.meds;
    const kind = md.bookKind || '未確認';
    /* 電子なら端末の中、紙なら物として在る。記号を変える。 */
    const isDigital = kind.indexOf('電子') > -1;
    const ic = isDigital
      ? '<rect x="6.5" y="2.5" width="11" height="19" rx="2.4"/><path d="M10.5 18.6h3"/>'
      : '<path d="M6.5 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-11Z"/><path d="M6.5 3v18"/>' +
        '<path d="M9.5 8h6M9.5 12h6"/>';

    return '<div class="entry">' +
      '<div class="entry-go">' +
        '<span class="entry-ic">' + svgIc(ic, 26) + '</span>' +
        '<div class="entry-tx">' +
          /* 種別も押して変えられる。読み取り面では太字だが、
             ev と同じ data-edit を持たせて編集への入口を塞がない。 */
          '<span class="entry-lb">お薬手帳は' +
            (isOpen('medical.meds.bookKind')
              ? evSelect('medical.meds.bookKind', md.bookKind, S.MEDBOOK_KINDS)
              : '<b class="i-ev" data-edit="medical.meds.bookKind" data-kind="select">' +
                esc(kind) + '</b>') + '</span>' +
          '<span class="entry-where">' +
            ev('medical.meds.bookWhere', md.bookWhere, 'line', 'どこで見られるか') + '</span>' +
          '<span class="entry-sub">' +
            ev('medical.meds.appWhere', md.appWhere, 'line', '手帳・アプリの場所') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="entry-side">' +
        '<div class="entry-row"><span>現在の服薬</span>' +
          (isOpen('medical.meds.taking')
            ? evSelect('medical.meds.taking', md.taking, ['あり', 'なし', '未確認'])
            : '<span class="pill">' + esc(md.taking || '未確認') + '</span>') + '</div>' +
        '<div class="entry-row"><span>確認</span>' + stBadge('medical.meds') + '</div>' +
        '<p class="entry-note">' +
          ev('medical.meds.note', md.note, 'line', '家族への申し送り') + '</p>' +
      '</div>' +
      '</div>';
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
          /* 救急で読む節を最初に置く。①→⑦と順に埋めるものではない
             ので番号は振らず、性質の近いものだけを並べる。 */
          medSection('tell', WARN_IC, '医療機関に必ず伝えること',
            '救急のとき、まっさきに伝えます。', tellBlock(), 'bs-tell') +
          medSection('clinic', CLINIC_IC, '主な医療機関',
            'いつも診てもらっている医療機関です。', clinicsBlock()) +
          medSection('pharm', PHARM_IC, 'かかりつけ薬局',
            'いつも調剤してもらっている薬局です。', pharmBlock()) +
          medSection('cond', PULSE_IC, '現在治療中の主な病気・状態', '',
            tagBlock('medical.conditions', m.conditions, 'tag-cond', '病名（読点区切り）')) +
          medSection('treat', TREAT_IC, '継続している重要な治療・処置', '',
            tagBlock('medical.treatments', m.treatments, 'tag-treat', '治療・処置（読点区切り）')) +
          medSection('meds', PILL_IC, '薬の正確な情報への入口',
            'くすりの詳しい内容は、ここから確認できます。', medsBlock()) +
          medSection('docs', DOC_IC, '医療関係書類',
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
  /* 支柱1本。旋盤で削ったくびれを持つ柱＋玉飾り。左右で使い回す。
     平たいカプセルにしないため、輪郭を径の変化で作る：
       玉 → 首 → 肩（テーパー）→ 胴 → くびれ → 台座
     ハイライトは1本の縦帯（円柱の照り）と、玉の小さな点。         */
  function bedPost() {
    return '<defs>' +
      '<linearGradient id="bdPost2" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="#8f6c45"/>' +
        '<stop offset=".18" stop-color="#b08c5f"/>' +
        '<stop offset=".42" stop-color="#e0c6a1"/>' +
        '<stop offset=".62" stop-color="#c2a074"/>' +
        '<stop offset="1" stop-color="#8a6740"/>' +
      '</linearGradient>' +
      '<radialGradient id="bdKnob" cx=".36" cy=".3" r=".78">' +
        '<stop offset="0" stop-color="#f2e0c6"/>' +
        '<stop offset=".5" stop-color="#d3b088"/>' +
        '<stop offset="1" stop-color="#9a7648"/>' +
      '</radialGradient>' +
      '</defs>' +
      /* 胴。径が上下で変わる輪郭。左右対称の1本のパスで削り出す。 */
      '<path d="M22 44c-3 8-4 16-4 24v104c0 10 1 16 4 22h16c3-6 4-12 4-22V68c0-8-1-16-4-24Z" ' +
        'fill="url(#bdPost2)"/>' +
      /* くびれ（下寄り）。径がすぼまる部分に陰を落として溝に見せる。 */
      '<path d="M18 150c4 3 20 3 24 0v10c-4 3-20 3-24 0Z" fill="#8a6740" fill-opacity=".55"/>' +
      /* 肩の輪。玉の下の首飾り。 */
      '<ellipse cx="30" cy="44" rx="15" ry="5" fill="#c9a677"/>' +
      '<ellipse cx="30" cy="40" rx="12" ry="4" fill="#dcc09a"/>' +
      /* 玉飾り。 */
      '<circle cx="30" cy="22" r="18" fill="url(#bdKnob)"/>' +
      '<circle cx="24" cy="15" r="5" fill="#fbf1de" fill-opacity=".75"/>' +
      /* 円柱の照り。縦に細く1本。 */
      '<path d="M25 52v140" stroke="#f4e3c8" stroke-opacity=".4" stroke-width="4" ' +
        'stroke-linecap="round"/>' +
      /* 台座（マットレスに隠れる手前まで）。 */
      '<path d="M17 192h26v12H17Z" fill="#a5804f"/>';
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
          '<stop offset="0" stop-color="#fdfbf6"/>' +
          '<stop offset=".62" stop-color="#f3efe4"/>' +
          '<stop offset="1" stop-color="#e2ddcd"/>' +
        '</linearGradient>' +
        '<linearGradient id="bdQuilt" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#e7eeec"/>' +
          '<stop offset=".5" stop-color="#d3dedd"/>' +
          '<stop offset="1" stop-color="#bcc9c9"/>' +
        '</linearGradient>' +
        /* 桟の溝。彫り込みは「暗い線＋その右の明るい線」の対で出す。 */
        '<linearGradient id="bdGroove" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0" stop-color="#8a6a42" stop-opacity=".55"/>' +
          '<stop offset=".55" stop-color="#8a6a42" stop-opacity=".18"/>' +
          '<stop offset="1" stop-color="#f0dcc0" stop-opacity=".5"/>' +
        '</linearGradient>' +
      '</defs>' +

      /* 壁。ヘッドボードの背後。下端にかけて僅かに沈ませる。 */
      '<rect width="900" height="300" fill="#efe7da"/>' +
      '<rect y="150" width="900" height="60" fill="#e3d9c8" fill-opacity=".5"/>' +

      /* ── ヘッドボード（横に伸びてよい部分）──
         背板・笠木・桟・寝具は幅なりに伸びる。伸びても意味が壊れない
         （板は横長になるだけ）。 */
      /* 板が壁に落とす影。板を壁から浮かせる。 */
      '<rect x="26" y="36" width="854" height="146" rx="8" fill="#8a6a42" fill-opacity=".28"/>' +
      /* 背板。 */
      '<rect x="20" y="26" width="860" height="150" rx="8" fill="url(#bdWood)"/>' +
      /* 落とし込みの内枠。framed panel の段差。 */
      '<rect x="44" y="46" width="812" height="112" rx="4" fill="#000" fill-opacity=".07"/>' +
      '<rect x="46" y="48" width="808" height="108" rx="3" fill="url(#bdWood)"/>' +
      '<path d="M46 48h808" stroke="#8a6a42" stroke-opacity=".4" stroke-width="2"/>' +
      '<path d="M46 155h808" stroke="#f0dcc0" stroke-opacity=".45" stroke-width="2"/>' +
      /* 縦の桟。溝は幅を持った帯（暗→明）で彫りに見せる。 */
      '<g>' +
        Array.from({ length: 12 }, (_, i) =>
          '<rect x="' + (78 + i * 64) + '" y="52" width="5" height="100" ' +
          'fill="url(#bdGroove)"/>').join('') +
      '</g>' +
      /* 笠木（上桟）。板の上に載る一本。手前に張り出すので、板へ影を落とす。 */
      '<rect x="8" y="14" width="884" height="30" rx="8" fill="#c8a578"/>' +
      '<rect x="8" y="14" width="884" height="13" rx="6" fill="#e4c8a4"/>' +
      '<path d="M8 40h884" stroke="#a5825a" stroke-width="2"/>' +
      '<rect x="20" y="44" width="860" height="9" fill="#8a6a42" fill-opacity=".3"/>' +

      /* ── 寝具 ──
         マットレス（厚みの側面つき）→ 敷きシーツ → 掛け布団の折り返し。
         面の境に必ず段差を置いて、layer を見せる。 */
      /* マットレスの上面。 */
      '<rect x="0" y="176" width="900" height="26" fill="#f7f4ea"/>' +
      /* ヘッドボードがマットレスへ落とす影。接地して見せる要。 */
      '<rect x="0" y="176" width="900" height="11" fill="#a4977c" fill-opacity=".33"/>' +
      /* 敷きシーツ。 */
      '<rect x="0" y="200" width="900" height="46" fill="url(#bdSheet)"/>' +
      /* シーツの浅いしわ。間隔も丈も揃えない。 */
      '<g fill="none" stroke="#cfc7b2" stroke-opacity=".65" stroke-width="1.6" stroke-linecap="round">' +
        '<path d="M64 214c26 7 44 4 62-3"/>' +
        '<path d="M286 210c18 9 39 7 52 1"/>' +
        '<path d="M470 216c30 6 46 2 58-4"/>' +
        '<path d="M690 212c22 8 41 5 56-2"/>' +
      '</g>' +
      /* 掛け布団。上端は直線にせず、たわんだ縁にする。 */
      '<path d="M0 246c120-9 210 7 316 2 96-4 158-11 262-6 118 6 206-4 322-8v66H0Z" ' +
        'fill="url(#bdQuilt)"/>' +
      /* 折り返しの厚み。縁のすぐ下に一段明るい帯。 */
      '<path d="M0 246c120-9 210 7 316 2 96-4 158-11 262-6 118 6 206-4 322-8v13' +
        'c-116 4-204 14-322 8-104-5-166 2-262 6-106 5-196-11-316-2Z" ' +
        'fill="#eef3f2" fill-opacity=".75"/>' +
      /* 布団のひだ。長さも間隔も不揃いにする。 */
      '<g fill="none" stroke="#a8b7b7" stroke-opacity=".55" stroke-width="1.8" stroke-linecap="round">' +
        '<path d="M96 274c14 12 30 15 44 9"/>' +
        '<path d="M243 281c9 9 21 12 31 8"/>' +
        '<path d="M395 272c17 14 36 16 51 8"/>' +
        '<path d="M596 278c12 10 26 13 38 8"/>' +
        '<path d="M742 271c19 13 38 15 54 7"/>' +
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
      '<svg class="bed-remote-svg" viewBox="0 0 64 196" aria-hidden="true">' +
        '<defs>' +
          '<linearGradient id="bdRem" x1="0" y1="0" x2="1" y2="0">' +
            '<stop offset="0" stop-color="#d8d4c8"/>' +
            '<stop offset=".3" stop-color="#f7f5ee"/>' +
            '<stop offset="1" stop-color="#cbc7ba"/>' +
          '</linearGradient>' +
        '</defs>' +
        /* コード。たわみを持たせて2度カーブさせる。 */
        '<path d="M40 0c1 22-16 26-19 44-2 14 3 22 3 32" fill="none" stroke="#a8a294" ' +
          'stroke-width="3.4" stroke-linecap="round"/>' +
        /* 本体が板へ落とす影。掛かっていることを影で示す。 */
        '<rect x="10" y="80" width="42" height="98" rx="12" fill="#6b5f45" fill-opacity=".3"/>' +
        /* 本体 */
        '<rect x="5" y="76" width="42" height="98" rx="12" fill="url(#bdRem)" ' +
          'stroke="#a39d8d" stroke-width="2"/>' +
        /* 上端の吊り金具。 */
        '<rect x="19" y="70" width="14" height="9" rx="4" fill="#b3ada0"/>' +
        /* 画面の窓。少し凹ませる。 */
        '<rect x="12" y="85" width="28" height="18" rx="4" fill="#7f9384"/>' +
        '<rect x="12" y="85" width="28" height="6" rx="3" fill="#000" fill-opacity=".14"/>' +
        /* ボタン。上下（昇降）は大きく、その他は小さく。 */
        '<g>' +
          '<rect x="13" y="111" width="26" height="12" rx="6" fill="#c3bcac"/>' +
          '<path d="M22 119l4-4 4 4" fill="none" stroke="#7d7767" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round"/>' +
          '<rect x="13" y="128" width="26" height="12" rx="6" fill="#c3bcac"/>' +
          '<path d="M22 133l4 4 4-4" fill="none" stroke="#7d7767" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round"/>' +
          '<rect x="13" y="147" width="11" height="9" rx="4.5" fill="#cdc7b8"/>' +
          '<rect x="28" y="147" width="11" height="9" rx="4.5" fill="#cdc7b8"/>' +
          '<rect x="13" y="160" width="11" height="9" rx="4.5" fill="#cdc7b8"/>' +
          '<rect x="28" y="160" width="11" height="9" rx="4.5" fill="#cdc7b8"/>' +
        '</g>' +
      '</svg>';
  }

  /* 介護の節。医療と同じく番号は振らない（順に埋めるものではない）。 */
  function careSection(key, icon, title, lead, body) {
    return '<div class="cs">' +
      '<div class="cs-h"><span class="cs-ic">' + svgIc(icon, 16) + '</span>' +
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
          careSection('level', LEVEL_IC, '現在の介護状態',
            '現在の認定状況や生活場所です。', levelBlock()) +
          careSection('manager', PERSON_IC, '担当ケアマネジャー（介護の中心・入口）',
            '介護に関する相談や調整の窓口です。', managerBlock()) +
          careSection('service', SV_IC.support, '利用中の介護サービス',
            '現在利用している支援の体制です。', servicesBlock()) +
          careSection('know', WARN_IC, '家族が知っておきたいこと',
            '急に対応することになったときに、知っておくと安心なことです。', knowBlock()) +
          careSection('cpapers', DOC_IC, '介護関係書類',
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
