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
  /* 足したばかりの行へ画面を送るか（次の render() で一度だけ実行）。 */
  let scrollToEditingAfterRender = false;
  /* 削除の確認を開いている行の id。 */
  let confirmDelete = null;
  /* 候補ピッカーの開き具合。picker=どの項目の候補パネルを開いているか
     （'condition' | 'treatment' | 'device' | null）。pickerGroups=その中で
     展開している系統見出し（"condition/循環器・血管" のような鍵の集合）。 */
  let picker = null;
  let pickerGroups = new Set();
  /* 治療中の病気・状態を全件見せるモーダルを開いているか。 */
  let condModal = false;

  /* どの節が、どの path を受け持つか。前方一致。
     左エリア＝本人そのもの／右エリア＝場面。                         */
  const SEC_OF = {
    person:   ['medical.person.'],
    current:  ['medical.conditions', 'medical.treatments', 'medical.devices'],
    vitals:   ['medical.allergies', 'medical.adverse'],
    memo:     ['medical.memo'],
    visit:    ['medical.clinics'],
    medsrc:   ['medical.medSources'],
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
  /* 顔写真のプレースホルダー。写真が未登録のあいだ、枠の中に置く
     本人のしるし（正本 §11：空欄と該当なしを同じにしない――ここは
     「まだ貼っていない」欄なので、空白ではなく人の形を残す）。 */
  const PHOTO_PH = '<svg class="sf-photo-ph" viewBox="0 0 72 72" aria-hidden="true">' +
    '<circle cx="36" cy="28" r="13" fill="#c8bfa6"/>' +
    '<path d="M13 66c0-13 10-22 23-22s23 9 23 22Z" fill="#c8bfa6"/>' +
    '</svg>';
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

  /* 「体に合わないもの」（アレルギー・副作用歴）の欄のしるし。
     警告標識（三角＋！・丸に×）はこの面には強すぎるので使わない。
     手つきは他の欄の見出し記号と同じ静かな線画――薬包と、それを
     はねる小さな線。 */
  const VITALS_IC =
    '<path d="M9 3.5h6M10 3.5v3.2L5.5 15c-1 1.9-.2 4 1.7 4.6.5.2 1 .3 1.6.3h6.4' +
    'c.6 0 1.1-.1 1.6-.3 1.9-.6 2.7-2.7 1.7-4.6L14 6.7V3.5"/>' +
    '<path d="M7 12.5h10"/><path d="M8.5 8.5 15.5 15.5"/>';
  /* 薬を確認するところ｜入口の種類ごとの記号。 */
  const MEDSRC_IC = {
    paper:  '<path d="M6.5 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-11Z"/><path d="M6.5 3v18"/>' +
            '<path d="M9.5 8h6M9.5 12h6"/>',
    digital:'<rect x="6.5" y="2.5" width="11" height="19" rx="2.4"/><path d="M10.5 18.6h3"/>',
    myna:   '<rect x="3.5" y="6" width="17" height="12" rx="1.6"/>' +
            '<circle cx="8.8" cy="11" r="2"/>' +
            '<path d="M5.6 15.6c0-1.8 1.4-2.8 3.2-2.8s3.2 1 3.2 2.8"/>' +
            '<path d="M14.5 10.5h4M14.5 13.5h4"/>',
    pharmacy: '<path d="M8.5 4.5h7M12 4.5v3"/><path d="M6.5 9.5h11L16 20H8L6.5 9.5Z"/>'
  };

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
      /* 生年月日は自由記述にしない。カレンダーから選ぶ日付欄にする。
         未入力のときは、今日を基準にした近年ではなく1990年あたりを
         初期表示にしたい（家族の生年月日は今日から遠いことが多い）。
         value を仮の日付にすると「もう入力済み」に見えてしまうので、
         value は空のまま、min でピッカーの開始年だけ1990年に寄せる。 */
      if (kind === 'date')
        return '<input type="date" class="i-ef" data-ef="1" data-path="' + path + '"' +
          (value ? '' : ' min="1990-01-01"') +
          ' value="' + esc(value || '') + '">';
      return '<input class="i-ef" data-ef="1" data-path="' + path + '"' + ph +
        ' value="' + esc(value || '') + '">';
    }
    const empty = value === '' || value == null;
    const shown = kind === 'date' ? S.formatBirth(value) : value;
    const isEmpty = kind === 'date' ? !shown : empty;
    return '<span class="i-ev' + (isEmpty ? ' i-ev-empty' : '') + '" data-edit="' + path +
      '" data-kind="' + (kind || 'line') + '">' +
      (isEmpty ? esc(placeholder || '未入力') : esc(shown)) + '</span>';
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

  /* 部位セレクト。継続処置・体内機器の行に付く。value は部位の鍵
     （'chest' など）。空文字は「候補から自動で当てる」。generic な
     change ハンドラが el.value をそのまま書き戻すので、表示は
     部位名でも保存されるのは鍵。 */
  function evRegionSelect(path, value) {
    const cur = value || '';
    if (isOpen(path)) {
      const opt = (v, label, sel) =>
        '<option value="' + v + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>';
      return '<select class="i-ef i-ef-sel cef-region" data-ef="1" data-path="' + path + '">' +
        opt('', '部位：自動', !cur) +
        S.BODY_REGIONS.filter(r => r.key !== 'unknown').map(r =>
          opt(r.key, r.label, cur === r.key)).join('') +
        opt('unknown', '部位未設定', cur === 'unknown') +
        '</select>';
    }
    return '';
  }

  /* 状態バッジ（正本 §11）。医療・介護の状態は候補が4つ（確認済み／
     未確認／確認中／該当なし）ある。候補が3つ以上あるものは、
     クリックで順送りではなく選択肢を開く（銀行口座の kitRow と同じ
     語彙：2択はその場トグル、3つ以上はセレクト）。ここは常に
     セレクトだが、地・色はバッジの見た目のまま（appearance:none）。
     山形は付けない――他エリアのバッジと揃える。 */
  function stBadge(path) {
    const row = S.getByPath(path);
    const st = S.checkState(row);
    const cur = row && row.state ? row.state : '未確認';
    return '<span class="st st-sel st-' + st.tone + '">' +
      '<select class="st-sel-el" data-ef="1" data-path="' + path + '.state" ' +
        'aria-label="状態を選ぶ">' +
      S.CHECK_ORDER.map(s => '<option value="' + esc(s) + '"' +
        (s === cur ? ' selected' : '') + '>' + esc(s) + '</option>').join('') +
      '</select>' +
      '</span>';
  }

  /* 節見出しの鉛筆。押すとその節をまとめて編集モードに。 */
  function editBtn(key) {
    const on = editSection && editSection.key === key;
    return '<button type="button" class="i-secedit' + (on ? ' on' : '') + '" ' +
      'data-editsec="' + key + '" aria-label="' + (on ? '編集を終える' : 'この節を編集') + '">' +
      (on ? DONE : PEN) + '</button>';
  }
  function secOn(key) { return editSection && editSection.key === key; }

  /* 行を消すボタン（節を開いているときだけ出す）。1度目のクリックで
     「削除しますか？」の文字を出す――アイコンの意味を途中で変えない
     （✕ が ✓ に化けると、何が起きるのか読めない）。 */
  function delBtn(id) {
    if (confirmDelete === id) {
      return '<span class="rowdel-ask">削除しますか？' +
        '<button type="button" class="rowdel-yes" data-delyes="' + id + '">削除</button>' +
        '<button type="button" class="rowdel-no" data-delno="1">やめる</button>' +
        '</span>';
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
        '<path d="M0 0h22v96l-11-11-11 11Z" fill="#c58c55"/>' +
        '<path d="M0 0h22v10H0Z" fill="#a97243" fill-opacity=".55"/>' +
        '<path d="M14 0h8v96l-4-4Z" fill="#000" fill-opacity=".12"/>' +
      '</svg>';
  }

  /* 場面。右面の単位はこれ1種類だけ。「いつ・何が起きたとき」に
     何を見るかで割る。項目の種類で割ると分類の羅列になる。

     場面ごとに重みが違うが、正本モック（医療.png）では右面3節の
     見出しはすべて「白地の角丸チップ＋緑の線グリフ＋タイトル＋一言」で
     揃えてある。拍子は見出しではなく本文の造形（カードホルダー／
     実物タイル／カードホルダー）で割る。ここは骨だけ。

     グリフは緑の線（currentColor）で描く。チップの地は白（.scene-ic）
     なので、白ヌキではなく線画で対象を見せる。薄い面取りだけ
     fill-opacity で入れる。                                        */
  const SCENE_IC = {
    /* いつもの通院｜建物（かかりつけの先）。 */
    visit: '<path d="M5 21V6.5L12 3l7 3.5V21" fill="currentColor" fill-opacity=".12"/>' +
      '<path d="M4 21h16M5 21V6.5L12 3l7 3.5V21M9.5 21v-4h5v4" ' +
      'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
      '<path d="M8.3 8.7h1.6M14.1 8.7h1.6M8.3 12h1.6M14.1 12h1.6" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    /* 薬を確認するとき｜カプセル。 */
    medsrc: '<path d="M8.2 4.6 4.6 8.2a5.1 5.1 0 0 0 7.2 7.2l3.6-3.6a5.1 5.1 0 0 0-7.2-7.2Z" ' +
      'fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.7"/>' +
      '<path d="M8.2 11.8 12 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path d="M14.8 19.4 19.4 14.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path d="M16.4 15.2 20 18.8a2.5 2.5 0 0 1-3.6 3.6L12.8 18.8Z" ' +
      'fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'
  };
  function sceneHeadIcon(key) {
    const d = SCENE_IC[key];
    if (!d) return '';
    return '<span class="scene-ic"><svg viewBox="0 0 24 24" aria-hidden="true" ' +
      'focusable="false">' + d + '</svg></span>';
  }
  function scene(key, title, lead, body, cls) {
    return '<section class="scene ' + (cls || '') + '">' +
      '<div class="scene-h">' +
        sceneHeadIcon(key) +
        '<h5>' + esc(title) + '</h5>' +
        (lead ? '<small>' + esc(lead) + '</small>' : '') +
        editBtn(key) + '</div>' +
      '<div class="scene-body">' + body + '</div></section>';
  }

  /* 左面＝本人そのもの。場面によらず変わらない事実だけを置く。
     器は敷かないが、罫だけで流すと13個の等価なスロットに見える
     （＝羅列）。手帳の記入面には欄の「格」があり、それが階層に
     なっている――一等は太い罫と記入枠、二等は罫の走る記入欄、
     三等は細い罫の備考欄。左面もその3つの格で組む。

       一等 .sf-head  … 識別欄（氏名・生年月日・年齢・血液型）
       二等 .sf-sec   … 現在の医療状態
       三等 .sf-sub   … メモ                                        */

  /* 一等｜識別欄。手帳の表紙裏にある記入欄。救急で最初に読まれるので、
     面の頭として太い罫で締める。生年月日・年齢・血液型はどれも同格の
     記入欄で並べ、罫の上に書く（血液型だけを枠で囲うと、四角に入った
     一文字が診断名のように強く読めてしまうため、他の欄と同じ扱いに
     揃える）。

     年齢は生年月日から決まる値なので、別に入力させると二重管理に
     なり、生年月日を直しても値がずれたまま残る（正本の線）。だから
     年齢欄は編集を持たず、生年月日から毎回計算して表示するだけ。   */
  function personBlock() {
    const p = S.data.medical.person || {};
    const age = S.ageFromBirth(p.birth);
    /* 生年月日の input[type=date] はブラウザのネイティブ最小幅を持ち、
       CSS だけでは3列の横並びに縮め切れない（左面の幅を超えて右の
       場面パネルに重なって見えたのはこれが原因）。編集中だけ生年月日
       を単独の行にし、年齢・血液型はその下に回す。表示専用のときは
       文字列なので幅の心配が無く、今まで通り横一列でよい。         */
    const editingPerson = secOn('person');
    /* 顔写真。手帳に貼った一枚の証明写真。押すと差し替え（ファイルを
       選ぶ）、写真があれば右肩に外すボタン。写真は data URI で持つ
       ので、他の欄と同じ「その場で書き換え」の手つきに寄せる。 */
    const photo = '<button type="button" class="sf-photo' +
        (p.photo ? ' has' : '') + '" data-photo="1" ' +
        'aria-label="' + (p.photo ? '顔写真を差し替える' : '顔写真を貼る') + '">' +
        (p.photo
          ? '<img src="' + esc(p.photo) + '" alt="本人の顔写真">'
          : PHOTO_PH + '<span class="sf-photo-hint">写真を貼る</span>') +
      '</button>' +
      (p.photo
        ? '<button type="button" class="sf-photo-clr" data-photoclr="1" ' +
          'aria-label="顔写真を外す">' + XMARK + '</button>'
        : '');
    return '<div class="sf-head">' +
      '<div class="sf-idcard">' +
      '<div class="sf-photo-wrap">' + photo + '</div>' +
      '<div class="sf-idmain">' +
      '<div class="sf-nm">' +
        '<span class="sf-lb">本人</span>' +
        '<h4>' + ev('medical.person.name', p.name, 'line', '氏名') + '</h4>' +
        editBtn('person') +
      '</div>' +
      '<div class="sf-idrow' + (editingPerson ? ' sf-idrow-edit' : '') + '">' +
        '<div class="sf-fld">' +
          '<span class="sf-fld-lb">生年月日</span>' +
          '<span class="sf-fld-v">' +
            ev('medical.person.birth', p.birth, 'date', '生年月日') + '</span>' +
        '</div>' +
        '<div class="sf-fld sf-fld-age">' +
          '<span class="sf-fld-lb">年齢</span>' +
          '<span class="sf-fld-v sf-fld-ro">' +
            (age == null ? '<span class="i-ev-empty">—</span>' : esc(age + '歳')) + '</span>' +
        '</div>' +
        '<div class="sf-fld sf-fld-blood">' +
          '<span class="sf-fld-lb">血液型</span>' +
          '<span class="sf-fld-v">' +
            evSelect('medical.person.blood', p.blood, S.BLOOD_TYPES) + '</span>' +
        '</div>' +
      '</div>' +
      '</div>' + /* .sf-idmain */
      '</div>' + /* .sf-idcard */
      '</div>';
  }

  /* ═══ 現在の医療状態 ═══════════════════════════════════
     5項目。入力単位が項目ごとに違う（病名／継続行為／存在物／
     原因＋反応／薬・治療＋起きたこと）ので、同じ「候補チップ」
     フォームにしない（参考：入力分類と表示構造を意図的に分ける）。

       閲覧 … 相関図。病気 →「治療中」→ 治療・機器。下にアレルギー・
              副作用歴の囲み。
       編集 … 項目ごとに「あり／なし」を選び、「あり」の
              ときだけ中身のフォームを開く。「なし」＝確認したうえで
              無い。まだ押していないのは空欄（§11）。                                        */

  /* 病名の脇のしるし。診断名は描けないので、関わる臓器・系統の形で
     見分ける（診察票のアイコンの手つき）。viewBox 0 0 24 24、線。
     左右対称に組めるものは軸 x=12 で対称にして、雑に見えないよう
     にする。 */

  /* 心臓｜左右対称のハート。上の窪みと下の尖りを軸に合わせる。 */
  const IC_HEART =
    '<path d="M12 20.5C12 20.5 3.5 15 3.5 8.8 3.5 5.8 5.9 3.8 8.5 3.8 10.4 3.8 11.4 4.9 12 6' +
    'c.6-1.1 1.6-2.2 3.5-2.2 2.6 0 5 2 5 5C20.5 15 12 20.5 12 20.5Z"/>';
  /* 心臓＋心電図｜ハートの中を横切る1拍ぶんの波形。 */
  const IC_HEART_ECG = IC_HEART +
    '<path d="M6.5 11.2h2.2l1-2.2 1.6 5 1.4-4 .9 1.2h2.4"/>';
  /* 脳｜左右2つの半球。上部が波打ち、下に脳幹。軸 x=12 で対称に
     組み、片側だけの「豆」に見えないようにする。 */
  const IC_BRAIN =
    /* 外周（左半球の上→前頭→下、右も対称）。 */
    '<path d="M12 5.2c-1-1-2.6-1.3-3.9-.6-1 .5-1.7 1.5-1.9 2.6-1.1.3-2 1.2-2.2 2.4' +
    '-.9.6-1.4 1.7-1.2 2.8.1 1 .7 1.9 1.6 2.4-.1 1.2.5 2.4 1.6 3 .9.5 2 .5 2.9 0' +
    'M12 5.2c1-1 2.6-1.3 3.9-.6 1 .5 1.7 1.5 1.9 2.6 1.1.3 2 1.2 2.2 2.4' +
    '.9.6 1.4 1.7 1.2 2.8-.1 1-.7 1.9-1.6 2.4.1 1.2-.5 2.4-1.6 3-.9.5-2 .5-2.9 0"/>' +
    /* 正中の溝と脳幹。 */
    '<path d="M12 5.2v10.6"/>' +
    '<path d="M10.5 15.8c0 2 .5 3.5 1.5 4.5 1-1 1.5-2.5 1.5-4.5"/>' +
    /* しわ（回）を左右対称に。 */
    '<path d="M8.4 8.2c.9.7 1.9.8 3 .3M15.6 8.2c-.9.7-1.9.8-3 .3' +
    'M8 12c1 .8 2.2.9 3.4.2M16 12c-1 .8-2.2.9-3.4.2"/>';
  /* 肺｜気管（縦）→ 左右の気管支 → 2つの肺葉。木のような形。 */
  const IC_LUNGS =
    '<path d="M12 3.2v6.3M8.6 7.6 12 9.5l3.4-1.9"/>' +
    '<path d="M8.6 7.6c.4 2.9-1.6 4.6-3.2 7.3C4.3 16.8 3.8 18.8 3.8 20c0 1.1.9 1.8 2.2 1.5' +
    '2.6-.5 4.6-2.3 4.6-5.3V9.5Z"/>' +
    '<path d="M15.4 7.6c-.4 2.9 1.6 4.6 3.2 7.3 1.1 1.9 1.6 3.9 1.6 5.1 0 1.1-.9 1.8-2.2 1.5' +
    '-2.6-.5-4.6-2.3-4.6-5.3V9.5Z"/>';
  /* 腎臓｜そら豆を2つ、内側にへこみを向けて。上に血管が1本ずつ。 */
  const IC_KIDNEY =
    '<path d="M8.6 5C6 5 4.5 7.6 4.5 11.5S6 18 8 18c1.8 0 2.7-1.4 2.7-3.3 0-1.5-.9-2.3-.9-3.7' +
    's.9-2.3.9-3.6C10.7 6 10 5 8.6 5Z"/>' +
    '<path d="M15.4 5C18 5 19.5 7.6 19.5 11.5S18 18 16 18c-1.8 0-2.7-1.4-2.7-3.3 0-1.5.9-2.3.9-3.7' +
    's-.9-2.3-.9-3.6C13.3 6 14 5 15.4 5Z"/>' +
    '<path d="M8.6 5V3M15.4 5V3"/>';
  /* 血糖（糖尿病）｜血のしずく＋中に「＋」。 */
  const IC_DROP =
    '<path d="M12 3.5c3.4 4.2 5.5 7.3 5.5 10.3a5.5 5.5 0 0 1-11 0c0-3 2.1-6.1 5.5-10.3Z"/>';
  const IC_DROP_PLUS = IC_DROP + '<path d="M12 10v6M9 13h6"/>';
  /* 骨｜対角の骨幹＋両端の二瘤の骨頭。骨幹は太い線、骨頭は円を
     2つずつ重ねる。 */
  const IC_BONE =
    '<path d="M7.5 7.5 16.5 16.5" stroke-width="2.4"/>' +
    '<circle cx="6" cy="6.4" r="2.1"/><circle cx="7.6" cy="4.8" r="2.1"/>' +
    '<circle cx="18" cy="17.6" r="2.1"/><circle cx="16.4" cy="19.2" r="2.1"/>';
  /* 関節｜2つの骨頭が向き合う。 */
  const IC_JOINT =
    '<path d="M9 4c0 3-2 4-2 6.5S9 15 9 18M15 4c0 3 2 4 2 6.5S15 15 15 18"/>' +
    '<circle cx="8" cy="10.5" r="1.4"/><circle cx="16" cy="10.5" r="1.4"/>';

  const COND_IC = {
    '高血圧':   IC_HEART_ECG,
    '糖尿病':   IC_DROP_PLUS,
    '脂質異常症': IC_DROP,
    '心房細動・不整脈': IC_HEART_ECG,
    '心不全':   IC_HEART,
    '狭心症・心筋梗塞': IC_HEART_ECG,
    '脳梗塞・脳出血後': IC_BRAIN,
    '喘息':     IC_LUNGS,
    'COPD・慢性呼吸器疾患': IC_LUNGS,
    '慢性腎臓病': IC_KIDNEY,
    'がん':     '<circle cx="12" cy="12" r="4.5"/><path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21M5.6 5.6l2.5 2.5M15.9 15.9l2.5 2.5M18.4 5.6l-2.5 2.5M8.1 15.9l-2.5 2.5"/>',
    '認知症':   IC_BRAIN,
    'パーキンソン病': IC_BRAIN,
    'てんかん': IC_BRAIN,
    '骨粗しょう症': IC_BONE,
    '関節リウマチ': IC_JOINT,
    'うつ病・精神疾患': IC_BRAIN
  };
  const COND_FALLBACK =
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 8.5v7M8.5 12h7"/>';
  /* ── 相関図（閲覧）───────────────────────────────── */

  /* 上段の病名1つ。アイコン → 病名 → 一言（淡く）。 */
  function condCell(r) {
    const ic = COND_IC[r.text] || COND_FALLBACK;
    const note = S.conditionNote(r);
    return '<li class="cmap-cell">' +
      '<span class="cmap-ic">' + svgIc(ic, 26) + '</span>' +
      '<span class="cmap-tx">' + esc(r.text) + '</span>' +
      (note ? '<span class="cmap-note">（' + esc(note) + '）</span>' : '') +
      '</li>';
  }
  /* 上段に並べる病名は4つまで。5つ以上あるときは4つ目の後ろに
     「ほか◯件」を置き、押すと全件をモーダルで見せる。 */
  const COND_MAX = 4;
  /* 「あり」でないときの一言。「なし」＝確認したうえで無い、
     それ以外（未確認）＝まだ書かれていない（§11）。 */
  function presenceNote(kind) {
    return S.grpOf(kind).presence === 'なし' ? '該当なし' : 'まだ書かれていません';
  }
  /* ── 体の処置マップ ───────────────────────────────────
     医療機器・続けている処置を、名前を並べたリストではなく人体
     シルエットに刺したピンで見せる（正本 §4-2：造形を持つ）。
     救急でまず要るのは「体の中に金属があるか」「どこに何が入って
     いるか」――部位が形で分かることが要点。

       体内にある機器 … 塗りの円板のピン（緑）
       続けている処置 … 白抜きのリングのピン（オレンジ）
       部位未設定     … 体の脇に置く（§11：空欄と同じにしない）

  ── 人体シルエット ───────────────────────────────────
     `assets/body-front.svg` を読み込んで使う。自前のベジェ曲線で
     描くのは諦めた――関節（肩・肘・手・膝・足首）のある人体の輪郭は
     座標を手で置いて詰める作業に向かず、何度書き直しても腕が胴に
     飲まれる／脚が棒になる、といった破綻が残った。

     素材は Wikimedia Commons の Human silhouette gender neutral.svg
     （パブリックドメイン／CC0）から正面の1体を取り出したもの。
     出どころと理由は assets/body-front.README.md に置いた。

     CLAUDE.md の「モチーフは SVG で描く」は「角丸の矩形で代用するな
     ＝対象に見える造形を出せ」という要求なので、既製の PD 素材を
     使うことはこれに反しない（破綻した自作を置くほうが反する）。

     素材はここに直接埋め込む。ファイルを fetch すると file:// で開いた
     ときに CORS で拒まれ、体だけが消える（プロトタイプは file:// で
     直接開いて確認する）。5.8KB なので埋め込んで差し支えない。元の
     ファイルは assets/body-front.svg に残してあるので、描き替えたい
     ときはそちらを直してここへ貼り直す。

     viewBox は 0 0 151 321、中心軸 x=75.5。部位のアンカーは
     state.js の BODY_REGIONS がこの座標系で持つ。                  */
  const BODY_VB = { w: 151.02, h: 321.46 };
  const BODY_ART =
    '<g transform="translate(-3.486,-19.026)"><path transform="matrix(1,0,0,1,0,0)" d="M79 54' +
    '.282H68.824c.038 4.586-1.385 8.232-6.538 11.407-7.58 4.67-9.766 1.589-16.504 5.364-7.18 ' +
    '4.022-9.839 16.322-12.894 25.27-2.701 7.914-3.117 16.702-4.642 24.654-.96 5.011-3.727 6.' +
    '429-4.641 12.172-1.757 11.036-3.522 24.117-4.596 34.05-.276 2.561-2.591 3.421-3.874 4.53' +
    '8-1.219 1.06-2.22 1.889-3.999 3.642-.543.535-.672 1.678-1.192 2.751-.444.915-1.52 1.539-' +
    '1.807 2.352-.817 2.305-3.163 3.662-2.55 4.548.571.823 2.963-.165 4.11-.981.735-.523 1.36' +
    '2-1.352 1.457-2.282.916-.331 2.108-2.771 2.696-2.658.255.049.358 4.46-.575 7.508-.363 1.' +
    '188-.67 1.746-.674 2.528-.006 1.006-.16 3.338-.28 4.41-.178 1.575.308 3.032 1.256 3.104.' +
    '221.017 1.34-.282 1.348-2.017.003-.633.08-1.127.196-1.94.2-1.41 1.494-4.138 1.725-5.36.0' +
    '73-.386.352-1.376.62-1.344.082.01-.405 2.901-.686 4.113-.311 1.344.145 2.27-.003 5.033-.' +
    '129 2.425.035 3.81 1.266 3.857.389.015 1.558.013 1.588-3.536.01-1.045.366-2.909.633-4.71' +
    '7.196-1.328.213-2.719 1.035-4.298-.045 1.672-.144 1.89-.228 3.518-.052 1-.405 6.609-.105' +
    ' 4.25.126-.994-1.25 4.052.94 4.15.731.033 1.703-.889 2.127-7.134.124-1.828.436-4.288.92-' +
    '5.66.278 1.198.342 1.72.34 2.309 0 .417.182 1.77-.008 3.119-.275 1.938-.424 3.24.59 3.35' +
    '3.563.063 1.243-.686 1.658-2.026.144-.468.1-1.138.254-1.678.516-1.826.189-3.734.364-4.95' +
    '8.24-1.666.536-2.492.768-3.213.238-.741.558-2.94.586-5.338.029-2.398-.968-2.465-.583-8.9' +
    '18.384-6.453 8.154-18.314 9.738-27.921.473-2.867 1.92-5.448 2.661-8.237 1.276-4.802 1.52' +
    '6-9.863 3.064-14.587 1.138-3.498 4.521-10.065 4.521-10.065s3.182 11.689 3.818 15.85c1.98' +
    '5 12.977-3.566 24.173-6.04 38.02-1.97 11.022-4.033 18.866-3.904 33.362.153 17.179 3.793 ' +
    '32.78 4.084 42.012.037 1.167-1.263 5.772-1.05 10.691.214 4.919-.912 11.933-.846 18.338.1' +
    '54 15.018 4.941 26.356 6.856 33.113.94 3.315 2.014 8.499 2.072 11.147.078 3.488-1.054 3.' +
    '863-1.29 5.849-.171 1.447 1.404 3.98 1.432 4.53 0 0-1.043 1.238-1.213 2-.24 1.068.41 2.0' +
    '44-.065 2.763-.95 1.44-.887.8-1.376 1.576-.506.802-3.655 4.06-4.223 5.238-.448.93-.328 1' +
    '.605-.152 2.641.244 1.439.81 2.807 2.358 2.398.478.321 1.065 1.026 1.485.333.117.795 1.6' +
    '84.863 2.444.514 1.09.992 3.102.854 4.167-.008 1.423 1.224 5.613.643 5.96-1.689 1.357-.5' +
    '92 1.717-1.758 1.496-3.055-.37-2.172-.335-4.06-.712-6.231-.295-1.69-.157-4.057.783-5.499' +
    ' 1.485-2.278.777-6.197.323-6.985-.453-.787-.22-15.214.078-23.764.276-7.938 2.694-15.697 ' +
    '3.063-23.632.157-3.378-.512-6.76-.365-10.138.199-4.552 1.255-9.03 1.678-13.566.389-4.172' +
    '.263-8.388.79-12.545 1.88-14.845 6.893-16.859 8.44-44.09m0 0c1.548 27.231 6.56 29.245 8.' +
    '441 44.09.527 4.157.401 8.374.79 12.545.423 4.537 1.48 9.014 1.678 13.566.147 3.379-.522' +
    ' 6.76-.365 10.138.37 7.935 2.787 15.693 3.063 23.632.298 8.551.531 22.976.078 23.764-.45' +
    '4.788-1.162 4.707.323 6.985.94 1.442 1.078 3.808.783 5.499-.377 2.17-.343 4.059-.712 6.2' +
    '3-.22 1.298.139 2.464 1.496 3.056.347 2.332 4.537 2.913 5.96 1.689 1.065.862 3.078 1 4.1' +
    '67.008.76.349 2.327.28 2.444-.514.42.693 1.007-.012 1.485-.333 1.548.409 2.114-.96 2.358' +
    '-2.398.176-1.036.296-1.712-.152-2.64-.568-1.18-3.717-4.437-4.223-5.239-.489-.776-.426-.1' +
    '36-1.376-1.576-.475-.72.174-1.695-.065-2.763-.17-.762-1.213-2-1.213-2 .028-.55 1.603-3.0' +
    '83 1.432-4.53-.236-1.986-1.368-2.36-1.29-5.849.058-2.648 1.132-7.832 2.072-11.147 1.915-' +
    '6.758 6.702-18.096 6.856-33.113.066-6.406-1.06-13.419-.847-18.338s-1.086-9.524-1.05-10.6' +
    '91c.292-9.231 3.932-24.833 4.085-42.012.13-14.497-1.933-22.34-3.903-33.362-2.475-13.847-' +
    '8.026-25.043-6.041-38.02.636-4.161 3.818-15.85 3.818-15.85s3.383 6.567 4.521 10.065c1.53' +
    '8 4.725 1.788 9.786 3.064 14.587.74 2.789 2.188 5.37 2.66 8.237 1.585 9.607 9.355 21.468' +
    ' 9.74 27.921s-.613 6.52-.584 8.918c.028 2.397.348 4.597.586 5.338.232.721.529 1.547.768 ' +
    '3.213.176 1.224-.152 3.132.365 4.958.152.54.109 1.21.254 1.678.414 1.34 1.094 2.089 1.65' +
    '7 2.026 1.014-.114.865-1.415.59-3.353-.19-1.348-.008-2.702-.009-3.119-.002-.59.063-1.111' +
    '.341-2.31.484 1.373.796 3.833.92 5.661.424 6.245 1.396 7.167 2.128 7.134 2.189-.098.813-' +
    '5.144.94-4.15.299 2.359-.054-3.25-.106-4.25-.084-1.628-.183-1.846-.228-3.518.822 1.58.83' +
    '9 2.97 1.035 4.298.267 1.808.624 3.672.633 4.717.03 3.549 1.2 3.551 1.588 3.536 1.23-.04' +
    '7 1.395-1.432 1.266-3.857-.148-2.764.308-3.689-.003-5.033-.281-1.212-.768-4.103-.685-4.1' +
    '13.267-.032.546.958.619 1.344.231 1.222 1.524 3.95 1.726 5.36.116.813.192 1.307.195 1.94' +
    '.008 1.735 1.127 2.034 1.348 2.017.948-.072 1.434-1.53 1.257-3.104-.12-1.072-.275-3.404-' +
    '.28-4.41-.006-.782-.312-1.34-.675-2.528-.933-3.047-.83-7.46-.575-7.508.588-.113 1.78 2.3' +
    '27 2.696 2.658.095.93.722 1.759 1.457 2.282 1.147.816 3.539 1.804 4.11.98.613-.885-1.733' +
    '-2.242-2.55-4.547-.287-.813-1.363-1.437-1.807-2.352-.52-1.073-.649-2.216-1.192-2.751-1.7' +
    '8-1.753-2.78-2.582-3.999-3.642-1.283-1.117-3.598-1.977-3.874-4.537-1.074-9.934-2.839-23.' +
    '014-4.596-34.051-.914-5.743-3.68-7.16-4.641-12.172-1.525-7.951-1.94-16.74-4.642-24.653-3' +
    '.055-8.95-5.714-21.25-12.894-25.271-6.738-3.775-8.923-.693-16.504-5.364-5.153-3.175-6.57' +
    '6-6.821-6.538-11.407H78.998"/><path transform="matrix(1,0,0,1,0,0)" d="M79 59.397c-3.914' +
    ' 0-7.324-2.644-10.175-5.115-.86-.746-1.197-4.034-1.914-4.866-.748.224-2.416-.196-2.946-1' +
    '.32-.736-1.56-2.257-4.293-2.194-7.266.03-1.354.961-3.111 2.909-3.104-.284-9.913 5.816-16' +
    '.699 14.317-16.7 8.5 0 14.6 6.786 14.319 16.7 1.947-.009 2.88 1.748 2.909 3.103.063 2.97' +
    '3-1.457 5.705-2.193 7.266-.53 1.124-2.199 1.544-2.946 1.32-.717.833-1.053 4.12-1.914 4.8' +
    '66-2.85 2.472-6.26 5.116-10.173 5.117-3.914 0-7.323-2.645-10.173-5.117-.86-.746-1.197-4.' +
    '033-1.914-4.866-.747.224-2.415-.196-2.946-1.32-.735-1.56-2.256-4.293-2.192-7.266.029-1.3' +
    '55.96-3.112 2.908-3.104-.282-9.913 5.819-16.699 14.32-16.699 8.5.001 14.6 6.787 14.316 1' +
    '6.7 1.948-.007 2.88 1.75 2.909 3.104.063 2.973-1.458 5.705-2.194 7.266-.53 1.125-2.198 1' +
    '.544-2.946 1.32-.717.832-1.053 4.12-1.914 4.866-2.85 2.47-6.26 5.115-10.174 5.115"/></g>';

  /* ピン1本。体内機器＝塗りの円板（緑）、続けている処置＝白抜きの
     リング（オレンジ）。 */
  function bmapPin(x, y, filled) {
    return '<circle class="bmap-pin ' + (filled ? 'is-dev' : 'is-tr') +
      '" cx="' + x + '" cy="' + y + '" r="4.6"/>';
  }

  /* ラベルカード1枚（foreignObject の中の HTML）。品名を主に、続け方・
     補足を下に。部位が分かれば品名の後ろに括弧で添える（部位名だけを
     見出しにはしない――リーダー線が体の該当部を指せば十分）。 */
  /* note が体の部位そのもの（「右膝」など）を言っているかどうか。
     そのときだけ品名の後ろに括弧で添える（部位名ラベルは出さない――
     リーダー線が体の該当部を指せば十分）。 */
  const NOTE_IS_PLACE = /^(右|左|両)?(膝|ひざ|肘|ひじ|肩|かた|手首|足首|手|足|腕|脚|胸|腹|首|頭|背|腰|眼|耳)/;
  function bmapCard(it) {
    const r = it.row;
    const noteIsPlace = r.note && NOTE_IS_PLACE.test(r.note);
    const suffix = noteIsPlace ? '（' + r.note + '）' : '';
    const sub = [];
    if (r.note && !noteIsPlace) sub.push('<span class="bmc-note">' + esc(r.note) + '</span>');
    if (r.memo) sub.push('<span class="bmc-purpose">' + esc(r.memo) + '</span>');
    return '<div class="bmap-card ' + (it.filled ? 'is-dev' : 'is-tr') + '">' +
      '<span class="bmc-name">' + esc(r.text) + esc(suffix) + '</span>' +
      (sub.length ? '<span class="bmc-sub">' + sub.join('') + '</span>' : '') +
      '</div>';
  }

  /* 体の処置マップ本体。trItems / dvItems は行の配列。
     ピンが1つも無くても人体シルエットは描く――ここは「体のどこに
     何があるか」の地図なので、地図そのものは消さない。空のときは
     図の下に一言だけ添える（noteText）。 */
  function bodyMap(trItems, dvItems, noteText) {
    const all = []
      .concat((dvItems || []).map(r => ({ row: r, filled: true })))
      .concat((trItems || []).map(r => ({ row: r, filled: false })));

    /* 図は viewBox 0 0 380 250。素材（151×321）は縦を 236 に収まる
       よう縮めて中央へ置く。左右に 122 幅のカード欄。 */
    const VB_W = 380, VB_H = 250;
    const BODY_H = 236;
    const BS = BODY_H / BODY_VB.h;               /* 素材の縮尺 */
    const OX = VB_W / 2 - (BODY_VB.w * BS) / 2;  /* 素材の左端 x */
    const OY = (VB_H - BODY_H) / 2;              /* 素材の上端 y */
    /* 素材の座標 → 図の座標。 */
    const bx = x => OX + x * BS;
    const by = y => OY + y * BS;
    const TOP = 4, BOT = VB_H - 4;
    const CW = 122;   /* カード幅 */
    const TXW = 98;   /* カード内テキスト幅（枠・余白を引いた実寸） */
    /* 文字列が TXW に何行で収まるか。日本語は全角なので字数×字幅で
       足りる（英数が混じるぶんは切り上げが吸収する）。 */
    const linesOf = (s, px) => Math.max(1, Math.ceil((String(s || '').length * px) / TXW));
    /* カードの高さ見積り。foreignObject は高さを固定するので、足りないと
       中身が切れる。行の高さ・行間・上下余白を多めに見る。 */
    const cardH = it => {
      const r = it.row;
      const isPlace = r.note && NOTE_IS_PLACE.test(r.note);
      const name = r.text + (isPlace ? '（' + r.note + '）' : '');
      let h = linesOf(name, 11) * 15;                    /* 品名 */
      if (r.note && !isPlace) h += linesOf(r.note, 9.5) * 13 + 2;  /* 続け方・使用状況 */
      if (r.memo) h += linesOf(r.memo, 9.5) * 13 + 1;  /* メモ */
      return h + 16;                                     /* 上下余白＋枠 */
    };

    /* 各項目にピンの点を与える。同じ部位に複数来たら少しずらす。
       アンカーは素材の座標系なので bx()/by() で図の座標へ直す。 */
    const seen = {};
    const nodes = all.map(it => {
      const key = S.regionOfRow(it.row);
      const reg = S.bodyRegion(key);
      const n = (seen[key] = (seen[key] || 0) + 1);
      const dx = n > 1 ? ((n % 2) ? 1 : -1) * Math.ceil((n - 1) / 2) * 8 : 0;
      const dy = n > 1 ? ((n % 2) ? -1 : 1) * 4 : 0;
      return {
        it: it,
        side: reg.side,
        px: bx(reg.at[0]) + dx,
        py: by(reg.at[1]) + dy
      };
    });

    const svgCards = [];
    const leaders = [];
    const pins = [];

    const layoutSide = (side) => {
      const list = nodes.filter(nd => nd.side === side)
        .sort((a, b) => a.py - b.py);
      const cx = side === 'l' ? 2 : VB_W - 2 - CW;    /* カード左端 */
      const edgeX = side === 'l' ? cx + CW : cx;      /* リーダーが刺さる辺 */
      let cursor = TOP;
      list.forEach(nd => {
        const h = cardH(nd.it);
        let top = Math.max(cursor, nd.py - h / 2);
        if (top + h > BOT) top = BOT - h;
        cursor = top + h + 10;
        const midY = top + h / 2;
        const cls = nd.it.filled ? 'is-dev' : 'is-tr';

        /* カードは箱の上端に合わせる（箱の中で上下中央に置くと、箱と
           カードの高さの差だけ実際の位置がずれ、隣のカードと重なる）。
           箱の高さは見積りなので、描画後に実測して組み直す
           （relayoutCards）。そのための目印を data- に持たせる。 */
        svgCards.push(
          '<foreignObject class="bmap-fo" x="' + cx + '" y="' + top +
            '" width="' + CW + '" height="' + h + '"' +
            ' data-side="' + side + '" data-px="' + nd.px + '" data-py="' + nd.py +
            '" data-edge="' + edgeX + '" data-bend="' +
            (side === 'l' ? edgeX + 14 : edgeX - 14) + '">' +
            '<div xmlns="http://www.w3.org/1999/xhtml" class="bmap-cardwrap ' +
              (side === 'l' ? 'to-r' : 'to-l') + '">' + bmapCard(nd.it) + '</div>' +
          '</foreignObject>');
        /* リーダー：カードの辺 → 少し水平 → ピン。ピンの色を帯びる。 */
        const bend = side === 'l' ? edgeX + 14 : edgeX - 14;
        leaders.push('<path class="bmap-leader ' + cls + '" d="M' + edgeX + ' ' +
          midY + 'H' + bend + 'L' + nd.px + ' ' + nd.py + '"/>');
        pins.push(bmapPin(nd.px, nd.py, nd.it.filled));
      });
    };
    layoutSide('l');
    layoutSide('r');

    /* 素材を縮めて中央へ。色は CSS（.bmap-body の fill）で当てる
       ――素材は黒で塗られているので、ここで上書きする。 */
    const body =
      '<g class="bmap-body" transform="translate(' + OX.toFixed(2) + ',' +
        OY.toFixed(2) + ') scale(' + BS.toFixed(5) + ')">' + BODY_ART + '</g>';

    /* viewBox の左右に 6 ずつ余白を足す（カードの縁が切れないように）。 */
    const empty = !all.length;
    return '<div class="bmap' + (empty ? ' is-empty' : '') + '" data-editsec="current">' +
      '<svg class="bmap-svg" viewBox="-6 0 ' + (VB_W + 12) + ' ' + VB_H + '" ' +
        'role="img" aria-label="体のどこに治療・機器があるか">' +
        body +
        leaders.join('') + svgCards.join('') + pins.join('') +
      '</svg>' +
      (empty
        ? '<p class="bmap-empty">' +
          esc(noteText || '体内の機器・続けている処置はありません') + '</p>'
        : '<div class="bmap-legend">' +
            '<span class="bmap-lg"><i class="bmap-sw is-dev"></i>体内にある機器</span>' +
            '<span class="bmap-lg"><i class="bmap-sw is-tr"></i>続けている処置・管理</span>' +
          '</div>') +
      '</div>';
  }

  /* 相関図｜上下2段。
       上段 … 治療中の病気・状態を幅いっぱいに並べる（名前が折れない）。
       下段 … 体の処置マップ（人体シルエットに治療・機器のピン）。
     病名の束とマップは上下に置くだけ。以前は間に「治療中」ハブを
     挟んで、右のリストが特定の1病名に対応すると読ませないための
     緩衝にしていたが、リストをやめて体そのものへ刺すマップにした
     いま、その役目はマップが果たす（ピンは部位に刺さり、病名には
     繋がらない）。ハブは束からの線の受け皿でしかなく、削除した。 */
  function currentMap() {
    const condG = S.grpOf('condition');
    const trG   = S.grpOf('treatment');
    const dvG   = S.grpOf('device');

    const condItems = condG.presence === 'あり'
      ? (condG.items || []).filter(r => r.text) : [];
    const condShown = condItems.slice(0, COND_MAX).map(condCell).join('');
    const condRest  = condItems.length - COND_MAX;
    const trItems = trG.presence === 'あり'
      ? (trG.items || []).filter(r => r.text) : [];
    const dvItems = dvG.presence === 'あり'
      ? (dvG.items || []).filter(r => r.text) : [];
    /* 空のときシルエットの下に添える一言。両方「なし」なら該当なし、
       それ以外はまだ書かれていない。 */
    const emptyNote = (trG.presence === 'なし' && dvG.presence === 'なし')
      ? '体内の機器・続けている処置は該当なし'
      : '体内の機器・続けている処置は、まだ書かれていません';
    const map = bodyMap(trItems, dvItems, emptyNote);

    const topBody = condItems.length
      ? '<ul class="cmap-cells">' + condShown + '</ul>' +
        (condRest > 0
          ? '<button type="button" class="cmap-morebtn" data-condmodal="1">' +
            'ほか' + condRest + '件をすべて見る</button>'
          : '')
      : '<p class="cmap-none" data-editsec="current">' +
        esc(presenceNote('condition')) + '</p>';
    const rightBody = map;

    return '<div class="cmap">' +
      '<div class="cmap-top">' +
        '<span class="cmap-clb">治療中の病気・状態</span>' + topBody +
      '</div>' +
      '<div class="cmap-mapwrap">' + rightBody + '</div>' +
      '</div>';
  }

  /* ── 編集フォーム（項目ごとに形が違う）───────────────── */

  /* 「あり／なし」の2択。入力の分岐だけ（あり＝中身を開く、なし＝
     閉じて「該当なし」）。どちらも押していない間は未確認＝空欄。
     状態バッジのような見せ方はしない。 */
  function presencePicker(kind) {
    const g = S.grpOf(kind);
    return '<div class="pgz" role="group" aria-label="この項目の有無">' +
      ['あり', 'なし'].map(o =>
        '<button type="button" class="pgz-b' + (g.presence === o ? ' on' : '') +
        '" data-presence="' + kind + '|' + o + '">' + esc(o) + '</button>').join('') +
      '</div>';
  }

  const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

  /* 候補ピッカー。チップを平置きにすると20個超が画面を埋めるので、
     「＋ 候補から選ぶ」で開くパネルにし、中は系統ごとに畳む。
     選ぶと本文の行に足す／外す（data-chip="kind|値"）。               */
  function candidatePicker(kind, groups, chosenSet) {
    if (picker !== kind) {
      return '<button type="button" class="pick-open" data-pick="' + kind + '">' +
        '＋ 候補から選ぶ</button>';
    }
    const body = groups.map(([name, list]) => {
      const key = kind + '/' + name;
      const open = pickerGroups.has(key);
      const n = list.filter(c => chosenSet.has(c)).length;
      const chips = open
        ? '<div class="chipz">' + list.map(c =>
            '<button type="button" class="chip' + (chosenSet.has(c) ? ' on' : '') +
            '" data-chip="' + kind + '|' + esc(c) + '">' + esc(c) + '</button>'
          ).join('') + '</div>'
        : '';
      return '<div class="pick-grp' + (open ? ' open' : '') + '">' +
        '<button type="button" class="pick-gh" data-pickgrp="' + esc(key) + '">' +
          '<span class="pick-gch">' + CHEVRON + '</span>' + esc(name) +
          (n ? '<span class="pick-gn">' + n + '</span>' : '') +
        '</button>' + chips +
        '</div>';
    }).join('');
    return '<div class="pick">' +
      '<div class="pick-h">候補から選ぶ' +
        '<button type="button" class="pick-close" data-pick="' + kind + '">閉じる</button>' +
      '</div>' + body +
      '</div>';
  }

  /* 病気・治療・機器の「あり」フォーム。
       ・追加する操作（候補から選ぶ／自由に書く）を先頭に置く
         ――一覧の下に埋めると「どうやって足すのか」が読めない。
       ・足した項目は1件ずつカードにし、病名（見出し）とその補足
         （一言／続け方…）が同じカードに入っていると分かる形にする。 */
  function pickListForm(kind) {
    const g = S.grpOf(kind);
    const items = g.items || [];
    const chosen = new Set(items.map(r => r.text).filter(Boolean));
    const groups = kind === 'condition' ? S.CONDITION_CHOICE_GROUPS
      : kind === 'treatment' ? S.TREATMENT_CHOICE_GROUPS
      : S.DEVICE_CHOICE_GROUPS;

    const store = kind + 's';
    const withRegion = kind === 'treatment' || kind === 'device';

    /* カード内の補足フィールド1つ（ラベルと入力欄を横に並べる）。 */
    const fld = (label, hint, inputHtml) =>
      '<div class="cef-fld">' +
        '<span class="cef-flb">' + label +
          (hint ? '<em>' + hint + '</em>' : '') + '</span>' +
        '<span class="cef-fv">' + inputHtml + '</span>' +
      '</div>';
    /* よく使う語をチップで平置き。押すと欄に入る（もう一度で外す）。
       datalist（黒背景のネイティブ候補）はやめ、他の欄と同じチップの
       手つきに揃える。それ以外は下の欄に直接書ける。 */
    const chipField = (label, hint, path, cur, choices, ph) =>
      '<div class="cef-fld cef-fld-col">' +
        '<span class="cef-flb">' + label +
          (hint ? '<em>' + hint + '</em>' : '') + '</span>' +
        '<span class="cef-fv cef-fv-col">' +
          '<span class="chipz cef-chipz">' + choices.map(c =>
            '<button type="button" class="chip' + (cur === c ? ' on' : '') +
            '" data-setval="' + path + '|' + esc(c) + '">' + esc(c) + '</button>').join('') +
          '</span>' +
          ev(path, cur, 'line', ph) +
        '</span>' +
      '</div>';

    const cards = items.map((r, i) => {
      const p = 'medical.' + store + '.items.' + i + '.';
      const noteFld = kind === 'condition'
        ? chipField('いまの扱い', '任意', p + 'note', r.note || '',
            S.CONDITION_NOTE_CHOICES, '自由に書く')
        : '';
      let ptFlds = '';
      if (withRegion) {
        const autoKey = S.regionOfRow(r);
        const regionFld = fld('体の部位', '', evRegionSelect(p + 'region', r.region) +
          (!r.region
            ? '<small class="cef-region-auto">' +
              (autoKey === 'unknown'
                ? '自動で当てられません'
                : '自動：' + esc(S.bodyRegion(autoKey).label)) + '</small>'
            : ''));
        const relatedFld = fld('関連するもの', '存在する場合だけ',
          ev(p + 'related', r.related, 'line',
            '例：ペースメーカー手帳＝寝室の引き出し'));
        const memoFld = fld('メモ', '', ev(p + 'memo', r.memo, 'line',
          'ここまでで表せない補足'));
        /* treatment と device は同じ骨（名前・続け方・関連・部位・メモ）
           だが、ラベルは性質に合わせて出し分ける（正本 §13：形は
           共有しても、機械的に同じ言葉を流用しない）。
             treatment … 頻度・場所を持って続く行為（インスリン注射等）
                         なので「継続のしかた」「対応先」が実質を持つ
             device    … 入れたら常時ある／使う物なので「対応先」は
                         機能せず（かかりつけ経由になる）持たない       */
        ptFlds = kind === 'treatment'
          ? fld('継続のしかた', '必要な治療・処置だけ', ev(p + 'note', r.note, 'line',
              '例：1日2回（朝・夜）／夜間のみ')) +
            fld('対応先', '必要な場合だけ', ev(p + 'contact', r.contact, 'line',
              '例：訪問看護ステーション○○')) +
            relatedFld + regionFld + memoFld
          : fld('使用状況', '機器ごとに必要なら', ev(p + 'note', r.note, 'line',
              '例：常時作動／夜間の睡眠中のみ')) +
            relatedFld + regionFld + memoFld;
      }
      return '<li class="cef-item">' +
        '<div class="cef-item-h">' +
          '<span class="cef-name">' +
            ev(p + 'text', r.text, 'line', S.currentKind(kind).placeholder) +
          '</span>' +
          delBtn(r.id) +
        '</div>' +
        (noteFld || ptFlds
          ? '<div class="cef-item-b">' + noteFld + ptFlds + '</div>'
          : '') +
        '</li>';
    }).join('');

    const addBar =
      '<div class="cef-add">' +
        candidatePicker(kind, groups, chosen) +
        '<button type="button" class="cef-freebtn" data-add="' + kind + '">' +
          '候補にないものを書く</button>' +
      '</div>';

    return '<div class="cef">' +
      addBar +
      (cards
        ? '<ul class="cef-items">' + cards + '</ul>'
        : '<p class="cef-empty i-ev-empty">まだありません。上のボタンから足してください。</p>') +
      '</div>';
  }

  /* 反応・起きたことのチップ群（畳まず平置き）。1行＝1カードの
     頭に置く――「まず起きたことを選ぶ」を先にする。書く人は原因の
     物質名を覚えていないことが多いので、選べる方から入る。 */
  function reactionChips(dataKey, choices, chosen) {
    const set = new Set(chosen || []);
    return '<div class="chipz">' + choices.map(x =>
      '<button type="button" class="chip' + (set.has(x) ? ' on' : '') +
      '" data-multi="' + dataKey + '|' + esc(x) +
      '">' + esc(x) + '</button>').join('') + '</div>';
  }

  /* アレルギーの「あり」フォーム。1行＝1カード。
       起きた反応（チップ）→ 原因になったもの（任意・自由記述）
     「原因の種類」セレクト（薬／食べ物／…）は廃止――物質名から
     種類は分かるし、閲覧側でも使っていなかった。原因は思い出せる
     範囲でよく、空でも成立する。 */
  function allergyForm() {
    const g = S.grpOf('allergy');
    const items = g.items || [];
    const rows = items.map((r, i) => {
      const p = 'medical.allergies.items.' + i + '.';
      return '<li class="cef-card">' +
        '<div class="cef-card-h">' +
          '<span class="cef-card-n">' + (i + 1) + '</span>' + delBtn(r.id) +
        '</div>' +
        '<div class="cef-line cef-line-col">' +
          '<span class="cef-lb">起きた反応</span>' +
          reactionChips('medical.allergies.items.' + i + '|reactions',
            S.ALLERGY_REACTIONS, r.reactions) +
        '</div>' +
        '<div class="cef-line cef-line-col">' +
          '<span class="cef-lb">原因になったもの<em>分かれば。そばなど食べ物も</em></span>' +
          ev(p + 'cause', r.cause, 'line', '例：ペニシリン、そば、造影剤') +
        '</div>' +
        '</li>';
    }).join('');
    return '<div class="cef">' +
      (rows ? '<ul class="cef-list">' + rows + '</ul>' : '') +
      '<button type="button" class="rowadd" data-add="allergy">＋ アレルギーを足す</button>' +
      '</div>';
  }

  /* 副作用歴の「あり」フォーム。1行＝1カード。
       起きたこと（チップ）→ 思い当たる薬・治療（任意・自由記述）
     アレルギーと同じ骨。副作用は「何の薬だったか」を覚えていない
     ことがさらに多いので、原因は完全に任意にして、まず起きたことを
     選ばせる。「今後避けるよう言われたか」の欄は廃止――この節は
     すべて"受診時に伝える＝避けるもの"なので、行ごとに持つ意味が
     薄かった。 */
  function adverseForm() {
    const g = S.grpOf('adverse');
    const items = g.items || [];
    const rows = items.map((r, i) => {
      const p = 'medical.adverse.items.' + i + '.';
      return '<li class="cef-card">' +
        '<div class="cef-card-h">' +
          '<span class="cef-card-n">' + (i + 1) + '</span>' + delBtn(r.id) +
        '</div>' +
        '<div class="cef-line cef-line-col">' +
          '<span class="cef-lb">起きたこと</span>' +
          reactionChips('medical.adverse.items.' + i + '|events',
            S.ADVERSE_EVENTS, r.events) +
        '</div>' +
        '<div class="cef-line cef-line-col">' +
          '<span class="cef-lb">思い当たる薬・治療<em>分かれば。覚えていなければ空欄で</em></span>' +
          ev(p + 'cause', r.cause, 'line', '例：解熱鎮痛薬、手術後の点滴') +
        '</div>' +
        '</li>';
    }).join('');
    return '<div class="cef">' +
      (rows ? '<ul class="cef-list">' + rows + '</ul>' : '') +
      '<button type="button" class="rowadd" data-add="adverse">＋ 副作用歴を足す</button>' +
      '</div>';
  }

  /* 編集モードの1項目。頭に見出し（右端に「編集を終える」チェック）、
     次に説明、「あり／なし」、「あり」のときだけフォーム。
     チェックはどの項目の見出しにも置く――節が縦に長いので、上まで
     スクロールして戻らなくても、その場で保存して閉じられるように。 */
  function editItem(kind, lead) {
    const g = S.grpOf(kind);
    const body = g.presence !== 'あり'
      ? ''
      : kind === 'allergy' ? allergyForm()
      : kind === 'adverse' ? adverseForm()
      : pickListForm(kind);
    /* 節の鉛筆は、その項目が属する節の鍵で（病気・治療・機器＝current、
       アレルギー・副作用歴＝vitals）。 */
    const secKey = (kind === 'allergy' || kind === 'adverse') ? 'vitals' : 'current';
    return '<div class="cei">' +
      '<div class="cei-h">' +
        '<span class="cei-lb">' + esc(S.currentKind(kind).label) + '</span>' +
        editBtn(secKey) +
      '</div>' +
      (lead ? '<p class="cei-lead">' + esc(lead) + '</p>' : '') +
      presencePicker(kind) +
      body +
      '</div>';
  }

  /* 現在の医療状態（病気・治療・機器）。閲覧＝相関図、編集＝3項目の
     フォーム。アレルギー・副作用歴は別の節（vitals）に分けた――
     いま治療していることと、体に入れてはいけないものは別のことで、
     編集も別に開きたい。 */
  function currentStateBlock() {
    const on = secOn('current');
    if (!on) return '<div class="cur">' + currentMap() + '</div>';
    return '<div class="cur cur-edit">' +
      editItem('condition') +
      editItem('treatment', '毎日の内服薬はここではなく「薬を確認するところ」で扱います。') +
      editItem('device') +
      '</div>';
  }

  /* 体に合わないもの（アレルギー・副作用歴）。閲覧＝1つの表、
     編集＝2項目のフォーム。節見出しは leftFace 側が持つ。 */
  function vitalsBlock() {
    const on = secOn('vitals');
    if (!on) return '<div class="cur-vitals">' + vitalsView() + '</div>';
    return '<div class="cur-vitals cur-edit">' +
      editItem('allergy', '薬や食べ物などに対するアレルギー反応。') +
      editItem('adverse', 'アレルギーではないが、薬や治療で強い症状が出たこと。') +
      '</div>';
  }

  /* アレルギー・副作用歴の閲覧。
     この2つは「体に入れると良くない反応が出るもの」という一つのこと
     で、読む側（家族・医療者）には1本の禁忌リスト。だから別々の囲み・
     別々の警告記号で切らず、「原因 → 反応」を全行そろえた1つの表に
     して、種別は行末の淡いしるしに落とす。
     presence が「あり」なら行、そうでなければ一言（該当なし／未記入）。 */
  function vitalsRow(kind, r) {
    /* 原因（左）と反応（右）を分けて持つ。ラベルの " → " に頼らず
       素の値から組み、列を全行でそろえる。causeKind／drug は種類
       セレクト・薬名欄を廃止する前の旧データの穴埋め。 */
    const cause = kind === 'allergy'
      ? (r.cause || (r.causeKind && r.causeKind !== '薬' ? r.causeKind : '') || '')
      : [r.cause, r.drug].filter(Boolean).join('｜');
    const list = kind === 'allergy' ? r.reactions : r.events;
    const react = (list || []).filter(x => x && x !== '詳細不明').join('・');
    const tag = kind === 'allergy' ? 'アレルギー' : '副作用';
    /* 原因（物質名）は任意。書いてあれば「原因 → 反応」で先頭に置く
       ――医療者はまず「何を投与してはいけないか」を読みたい。書いて
       なければ書き忘れではないので「（未記入）」を出さず、反応だけを
       先頭に置いて矢印も消す。 */
    const inner = cause
      ? '<span class="vv-cause">' + esc(cause) + '</span>' +
        '<span class="vv-arw" aria-hidden="true"></span>' +
        '<span class="vv-react">' + esc(react || '反応は未記入') + '</span>'
      : '<span class="vv-react-lead">' +
        esc(react || '内容がまだ書かれていません') + '</span>';
    return '<li class="vv-row">' +
      inner +
      '<span class="vv-tag vv-tag-' + kind + '">' + tag + '</span>' +
      '</li>';
  }
  function vitalsView() {
    const kinds = ['allergy', 'adverse'];
    const grp = k => S.grpOf(k);
    /* 「あり」で中身のある行を、種別をまたいで1本に並べる。 */
    const rows = kinds.flatMap(k =>
      grp(k).presence === 'あり'
        ? (grp(k).items || []).map(r => vitalsRow(k, r))
        : []).join('');
    /* 行が無い種別について一言添える。「該当なし」（確認して無い）と
       未確認（まだ書かれていない）を混ぜない（§11）。両方とも同じ
       状態なら1文にまとめる。 */
    const LB = { allergy: 'アレルギー', adverse: '強い副作用歴' };
    const empties = kinds.filter(k =>
      grp(k).presence !== 'あり' ||
      !(grp(k).items || []).some(r => S.currentRowLabel(k, r)));
    const phrase = k => {
      const p = grp(k).presence;
      return p === 'なし' ? '確認したうえで無し'
        : p === 'あり' ? '内容がまだ書かれていません'
        : 'まだ書かれていません';
    };
    let note = '';
    if (empties.length === 2 && phrase('allergy') === phrase('adverse')) {
      note = phrase('allergy') === '確認したうえで無し'
        ? '合わない薬・食べ物は、確認したうえで無し'
        : phrase('allergy');
    } else {
      note = empties.map(k => LB[k] + 'は、' + phrase(k)).join(' ／ ');
    }
    return '<div class="vv">' +
      (rows ? '<ul class="vv-list">' + rows + '</ul>' : '') +
      (note ? '<p class="vv-note" data-editsec="vitals">' + esc(note) + '</p>' : '') +
      '</div>';
  }

  /* 左エリア。本人そのもの。器は敷かず、手帳の記入面の「欄の格」で
     階層を作る（一等＝識別欄／二等＝医療状態／三等＝備考）。

     節見出しは配下の小見出しより強くする。以前は節が 10.5px の
     添え字で、その中の小見出しが 11.5px の太字――親より子が強く、
     5つの小見出しがトップレベルに並んで見えていた（＝羅列の骨）。 */
  function leftFace() {
    return '<div class="sf">' +
      personBlock() +
      '<div class="sf-sec">' +
        '<span class="sf-glb">現在の医療状態' + editBtn('current') + '</span>' +
        currentStateBlock() +
      '</div>' +
      '<div class="sf-sec sf-sec-vitals">' +
        '<span class="sf-glb sf-glb-vitals">' +
          svgIc(VITALS_IC, 13) + '体に合わないもの' +
          '<span class="sf-glb-sub">受診時に必ず伝える</span>' +
          editBtn('vitals') +
        '</span>' +
        vitalsBlock() +
      '</div>' +
      memoBlock() +
      /* 未記入の欄。記入面なので罫は面の下端まで刷ってある――中身の
         終わりで罫も終わると、面が途中で切れて見える。空いた罫は
         「まだ書かれていない欄」として読める（正本 §11）。        */
      '<div class="sf-rules" aria-hidden="true"></div>' +
      '</div>';
  }

  /* ── 診療案内カード ─────────────────────────────────
     「いつもの通院」の1件は、手帳に挟んだ診療案内カード1枚。
     角丸の矩形に色を敷いただけにしない（CLAUDE.md）。契約・デジタル
     の券面（.paycard）と同じ組み方：カードの「頭」を SVG で描き
     （固定の実寸比）、その下に印字の続く白い面（.cg-body）を継ぐ。

     頭（.cg-head の SVG）に描くもの：
       1) 帯     … 診療科の色地。ただし科ごとに塗り分けず、医療の
                   1色で通す（塗り分けるとカードの列が色見本帳になる）。
                   彩度は落とす（.paycard の規律）。
       2) 上角   … 帯の左右上だけ丸める（下は白い面へ続くので角無し）。
       3) 医療マーク … 帯の右端に白抜きの十字を1つだけ。券面の唯一の
                   絵柄。
     印字（診療科名・病院名・理由・連絡先）は HTML。SVG は物の形、
     HTML は物に刷られた文字。頭の実寸比は名刺と同じ 91:55 に近い
     帯として置く（カード全体は下に伸びるので固定しない）。         */
  const CARD_GUIDE_ACCENT = '#5b7f92';   /* 医療の青。彩度控えめ */
  /* 帯の地。上の2角だけ丸めた色地。preserveAspectRatio=slice で
     縦横比を保ったまま帯を満たす（帯は単色なので切れても見えない）。
     十字は帯の中で歪むので SVG には入れず、HTML 側で置く。 */
  function cardGuideHead() {
    return '<svg class="cg-head-svg" viewBox="0 0 120 40" ' +
        'preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
      '<path d="M0 40 V10 A10 10 0 0 1 10 0 H110 A10 10 0 0 1 120 10 V40 Z" ' +
        'fill="' + CARD_GUIDE_ACCENT + '"/>' +
    '</svg>';
  }
  /* 帯の右端に置く白抜きの十字。券面の唯一の絵柄（.paycard の規律）。
     固定サイズの独立グリフなので歪まない。 */
  const CARD_CROSS = '<svg class="cg-cross" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z" fill="#ffffff" opacity=".9"/></svg>';

  /* カードの白い面の右下に敷く、建物の淡いシルエット（正本モック
     医療.png の指定「右端に建物の淡い絵」）。診療科で色分けしない・
     医療の1色で通す・彩度は落とす（.paycard の規律）。素材調査の
     結論：Maki の building グリフは 24px 格でモックの2棟クラスタに
     届かず、CC0 の乳鉢 SVG も register が合わない → 幾何プリミティブ
     で自作（medical-right-motifs.RESEARCH.md 2026-09-08 追記）。
     形：左に平屋根の低い棟（3列の窓）、右にやや高い切妻屋根の棟
     （2列の窓）＋屋根の頂きに小さな塔。単色・面のみ・不透明度は
     CSS 側（.cg-bldg）で落とす。viewBox は 116×88。 */
  const CARD_BLDG =
    '<svg class="cg-bldg" viewBox="0 0 116 88" aria-hidden="true" focusable="false">' +
      '<g fill="currentColor">' +
        /* 左：平屋根の低い棟。屋上中央に小さなパラペット。 */
        '<path d="M4 88V34h50v54Z"/>' +
        '<path d="M18 34v-6h22v6Z"/>' +
        /* 右：切妻屋根の高い棟。 */
        '<path d="M58 88V26h44v62Z"/>' +
        '<path d="M53 27 80 6l27 21Z"/>' +
        /* 屋根の頂きの小さな塔。 */
        '<path d="M76 8h8v-8h-8Z"/>' +
      '</g>' +
      /* 窓は白抜き（面の上に地の色で抜く）。CSS で塗りを親に合わせる。 */
      '<g class="cg-bldg-win">' +
        '<path d="M12 42h8v9h-8ZM24 42h8v9h-8ZM36 42h8v9h-8Z"/>' +
        '<path d="M12 58h8v9h-8ZM24 58h8v9h-8ZM36 58h8v9h-8Z"/>' +
        '<path d="M12 74h8v9h-8ZM24 74h8v9h-8ZM36 74h8v9h-8Z"/>' +
        '<path d="M66 36h10v11h-10ZM84 36h10v11h-10Z"/>' +
        '<path d="M66 54h10v11h-10ZM84 54h10v11h-10Z"/>' +
        '<path d="M66 72h10v11h-10ZM84 72h10v11h-10Z"/>' +
      '</g>' +
    '</svg>';

  /* 主な医療機関。1件ずつが「かかっている先」として並立するので、
     診療案内カードを並べる。カードの中では
       診療科 →（帯の下に）病院名 → 理由 → 主治医・電話・Web・診療時間
     の順で、上から重要度が下がる。                                 */
  function clinicsBlock() {
    const m = S.data.medical;
    /* 節の鍵は scene('visit', …) 側と揃える（薬局・薬は節の中に
       自前の鉛筆を持つので、そちらは別の鍵のままでよい）。 */
    const on = secOn('visit');
    const head = cardGuideHead();
    const cards = (m.clinics || []).map((c, i) => {
      const p = 'medical.clinics.' + i + '.';
      const dept = on
        ? ev(p + 'depts', S.tagsToText(c.depts), 'line', '診療科（読点区切り）')
        : ((c.depts || []).join('・') || '<span class="i-ev-empty">診療科</span>');
      /* Web は1本。編集中はただの欄、表示時はリンクとして開ける。 */
      const web = c.web
        ? (on
            ? ev(p + 'web', c.web, 'line', 'https://…')
            : '<a href="' + esc(c.web) + '" target="_blank" rel="noopener" ' +
              'class="cg-link">' + esc(webLabel(c.web)) + ' ↗</a>')
        : (on ? ev(p + 'web', c.web, 'line', 'https://…') : '');
      /* 状態バッジは付けない。診療案内カードは「かかっている先の
         連絡先」で、書いた時点で家族が辿れている――§11 の状態
         （辿れるか・確認できたか）を問う対象ではない。 */
      return '<div class="cg">' +
        '<div class="cg-head">' + head +
          '<span class="cg-dept">' + dept + '</span>' +
          (on ? delBtn(c.id) : '') +
          CARD_CROSS +
        '</div>' +
        '<div class="cg-body">' +
          CARD_BLDG +
          '<div class="cg-name">' + ev(p + 'name', c.name, 'line', '医療機関の名前') + '</div>' +
          '<div class="cg-reason">' + ev(p + 'reason', c.reason, 'line', '通っている理由') + '</div>' +
          '<dl class="cg-kv">' +
            '<dt>主治医</dt><dd>' + ev(p + 'doctor', c.doctor, 'line', '担当の先生') + '</dd>' +
            '<dt>電話</dt><dd class="cg-tel">' + TEL +
              ev(p + 'tel', c.tel, 'line', '電話番号') + '</dd>' +
            (web || on
              ? '<dt>Web</dt><dd>' + (web || '<span class="i-ev-empty">なし</span>') + '</dd>'
              : '') +
            '<dt>診療</dt><dd>' + ev(p + 'hours', c.hours, 'line', '診療時間') + '</dd>' +
          '</dl>' +
        '</div>' +
        '</div>';
    }).join('');
    return '<div class="cggrid">' +
      (cards || '<p class="i-ev-empty">まだ登録がありません。</p>') + '</div>' +
      (on ? '<button type="button" class="rowadd" data-add="clinic">＋ 医療機関を足す</button>' : '');
  }

  /* Web の表示名。スキームと末尾スラッシュを落として読みやすく。 */
  function webLabel(url) {
    return String(url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  /* 薬を確認するとき。正本モック（医療.png）に合わせて、上段は実物
     タイル3つ（紙のお薬手帳／お薬手帳アプリ／マイナポータル）、下段は
     かかりつけ薬局の帯。標準行は常設で消せない（§11：確認していない
     ＝未確認であって、欄は消えない）。かかりつけ薬局は複数あり得るので、
     2件目以降を足せる。連絡先も自前で持つ。

     タイルの実物イラストは SVG（角丸矩形に色を敷くだけにしない――
     CLAUDE.md）。紙の手帳＝綴じた冊子、アプリ＝スマホの画面、
     マイナポータル＝PC のモニタ。 */
  const MEDSRC_TILE = {
    paper:   { name: 'お薬手帳',       sub: '紙の手帳',
      wherePh: '例：保管場所（本人の鞄）' },
    digital: { name: 'お薬手帳アプリ', sub: 'スマートフォン',
      wherePh: '例：アプリ名（○○）' },
    myna:    { name: 'マイナポータル', sub: 'オンライン',
      wherePh: '例：ログインは本人のスマホから' }
  };
  /* 実物の絵。viewBox 0 0 64 48、淡い塗り＋医療の緑の線。 */
  const MEDSRC_ART = {
    /* 紙のお薬手帳｜綴じた冊子。表紙と、背から覗く中身の紙、綴じ目。 */
    paper:
      '<path d="M16 9h30a3 3 0 0 1 3 3v27a2 2 0 0 1-2 2H17a3 3 0 0 1-3-3V11a2 2 0 0 1 2-2Z" ' +
        'fill="#eaf3ec" stroke="#3B7855" stroke-width="1.8"/>' +
      '<path d="M18 12v27" stroke="#3B7855" stroke-width="1.6"/>' +
      '<path d="M14 13c-2 .4-3.3 1.7-3.3 3.4v20c0 1.7 1.3 3 3.3 3.4" ' +
        'fill="none" stroke="#3B7855" stroke-width="1.6"/>' +
      '<circle cx="34" cy="20" r="4.4" fill="none" stroke="#3B7855" stroke-width="1.6"/>' +
      '<path d="M34 16.4v7.2M30.4 20h7.2" stroke="#3B7855" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M26 30h16M26 34h11" stroke="#7ba98c" stroke-width="1.6" stroke-linecap="round"/>',
    /* お薬手帳アプリ｜スマホ。画面の中に薬のしるし。 */
    digital:
      '<rect x="21" y="5" width="22" height="38" rx="4" fill="#eaf3ec" ' +
        'stroke="#3B7855" stroke-width="1.8"/>' +
      '<rect x="24" y="10" width="16" height="24" rx="1.5" fill="#fff" ' +
        'stroke="#7ba98c" stroke-width="1.4"/>' +
      '<path d="M29 15.5 33.5 20a3.2 3.2 0 0 1-4.5 4.5L24.5 20" fill="none"/>' +
      '<path d="M27.6 16.2 35 23.6a3.4 3.4 0 0 1-4.8 4.8L22.8 21Z" ' +
        'fill="#d7e8dc" stroke="#3B7855" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M27.6 16.2 31.3 19.9M31.3 19.9 35 23.6" stroke="#3B7855" stroke-width="1.5"/>' +
      '<path d="M30 38.5h4" stroke="#3B7855" stroke-width="1.6" stroke-linecap="round"/>',
    /* マイナポータル｜PC のモニタ＋台座。画面に人型＋カード。 */
    myna:
      '<rect x="8" y="8" width="48" height="30" rx="2.5" fill="#eaf3ec" ' +
        'stroke="#3B7855" stroke-width="1.8"/>' +
      '<path d="M26 38h12l1.5 5h-15Z" fill="#d7e8dc" stroke="#3B7855" stroke-width="1.6" ' +
        'stroke-linejoin="round"/>' +
      '<circle cx="24" cy="19" r="3.6" fill="none" stroke="#3B7855" stroke-width="1.6"/>' +
      '<path d="M18 30c0-3.6 2.7-5.6 6-5.6s6 2 6 5.6" fill="none" ' +
        'stroke="#3B7855" stroke-width="1.6"/>' +
      '<rect x="34" y="16" width="12" height="8" rx="1" fill="#fff" ' +
        'stroke="#7ba98c" stroke-width="1.4"/>' +
      '<path d="M36 22h8" stroke="#7ba98c" stroke-width="1.4" stroke-linecap="round"/>'
  };
  /* タイルの状態バッジ。確認済み＝緑、それ以外は淡く（§11：未確認・
     確認中・該当なしを「確認済みでない」で潰さない）。候補は4つある
     ので、クリックで順送りではなく選択肢を開く（stBadge と同じ）。 */
  function medSrcTileBadge(path) {
    const row = S.getByPath(path);
    const st = S.checkState(row);
    const cur = row && row.state ? row.state : '未確認';
    return '<span class="mst-badge mst-sel mst-' + st.tone + '">' +
      '<select class="st-sel-el" data-ef="1" data-path="' + path + '.state" ' +
        'aria-label="状態を選ぶ">' +
      S.CHECK_ORDER.map(s => '<option value="' + esc(s) + '"' +
        (s === cur ? ' selected' : '') + '>' + esc(s) + '</option>').join('') +
      '</select>' +
      '</span>';
  }
  /* かかりつけ薬局の帯の右端に敷く、乳鉢と杵の淡いシルエット。
     病院カードの建物（CARD_BLDG）と対の造形――現実で病院と薬局は
     対なので、薬局の帯にも同じ格の絵を1つ置く。医療の1色・低彩度・
     不透明度は CSS 側（.msb-mortar）で落とす。素材調査：freesvg の
     CC0 乳鉢 SVG（mortar_pestle_yellow）を比率の下敷きにしたが、
     Rx 記号入り・ベタ黒で register が合わず、鉢の口径:高さと杵の
     角度だけ借りて幾何で引き直した（RESEARCH.md 2026-09-08 追記）。
     形：口の楕円＋くびれた鉢＋右上から差す杵。viewBox 96×88。 */
  const CARD_MORTAR =
    '<svg class="msb-mortar" viewBox="0 0 100 96" aria-hidden="true" focusable="false">' +
      '<g fill="currentColor">' +
        /* 杵。鉢の口へ右上から斜めに立てかかる。頭は少し太い楕円。 */
        '<path d="M74 6 88 16 40 52l-8-6Z"/>' +
        '<ellipse cx="83" cy="9" rx="9" ry="7" transform="rotate(35 83 9)"/>' +
        /* 鉢の口（楕円）。 */
        '<ellipse cx="46" cy="40" rx="38" ry="10"/>' +
        /* 鉢。口から下へ左右対称にすぼまり、脚でわずかに開く。 */
        '<path d="M9 40c0 0 4 34 12 40 6 5 44 5 50 0 8-6 12-40 12-40 ' +
          '0 9-17 14-37 14S9 49 9 40Z"/>' +
      '</g>' +
    '</svg>';

  function medSourcesBlock() {
    const m = S.data.medical;
    const on = secOn('medsrc');
    const list = m.medSources || [];

    /* 上段｜実物タイル3つ。paper / digital / myna の順で固定。 */
    const tiles = ['paper', 'digital', 'myna'].map(kind => {
      const i = list.findIndex(r => r.kind === kind);
      if (i < 0) return '';
      const r = list[i];
      const t = MEDSRC_TILE[kind];
      const p = 'medical.medSources.' + i + '.';
      /* どこで見られるか（where）はタイルに常設する。未入力のときは
         入口ごとの「例：…」を薄字で残す（呼び水――畳むと用途が
         読めない）。補足（note）は書いたときだけ出す。 */
      const whereRow = '<span class="mst-where">' +
        ev(p + 'where', r.where, 'line', t.wherePh) + '</span>';
      const noteRow = (r.note || on)
        ? '<span class="mst-note">' + ev(p + 'note', r.note, 'line', '補足') + '</span>'
        : '';
      return '<div class="mst">' +
        '<span class="mst-art"><svg viewBox="0 0 64 48" aria-hidden="true" ' +
          'focusable="false">' + MEDSRC_ART[kind] + '</svg></span>' +
        '<span class="mst-name">' + esc(t.name) + '</span>' +
        '<span class="mst-sub">' + esc(t.sub) + '</span>' +
        medSrcTileBadge('medical.medSources.' + i) +
        whereRow + noteRow +
        '</div>';
    }).join('');

    /* 下段｜かかりつけ薬局の帯。1件ずつ。 */
    const bands = list.map((r, i) => {
      if (r.kind !== 'pharmacy') return '';
      const p = 'medical.medSources.' + i + '.';
      /* 薬局名の下は、通院の診療案内カード（.cg-kv）と同じ「ラベル＋値」
         の縦グリッドで、電話／Web／メモ を揃える。
         メモ＝家族の書き込み欄（困ったときの連絡・往診の有無・担当薬剤師
         など。「調剤・飲み合わせ確認」は薬局の定義なので書かない）。
         プレースホルダを「例：…」にして、未入力でも用途が伝わるように
         する（表示時は薄字で例が残る――行ごと畳むと呼び水も消える）。 */
      const memoRow = '<dt>メモ</dt><dd class="msb-memo-tx">' +
        ev(p + 'note', r.note, 'line',
          '例：薬のことで困ったら、まずここに電話。往診にも来てくれる。') +
        '</dd>';
      /* Web は公式サイト1本（通院カードの clinics.web と同じ扱い）。
         編集中はただの欄、表示時は <a target=_blank rel=noopener>。 */
      const web = r.web
        ? (on
            ? ev(p + 'web', r.web, 'line', 'https://…')
            : '<a href="' + esc(r.web) + '" target="_blank" rel="noopener" ' +
              'class="cg-link">' + esc(webLabel(r.web)) + ' ↗</a>')
        : (on ? ev(p + 'web', r.web, 'line', 'https://…') : '');
      /* 状態バッジは付けない。かかりつけ薬局は「かかっている先の
         連絡先」で、書いた時点で家族が辿れている――§11 の状態を
         問う対象ではない（通院の診療案内カードと揃える）。 */
      return '<div class="msb">' +
        CARD_MORTAR +
        '<div class="msb-h">' +
          '<span class="msb-ic">' + svgIc(MEDSRC_IC.pharmacy, 16) + '</span>' +
          '<span class="msb-lb">かかりつけ薬局</span>' +
          (on && S.canRemoveMedSource(r.id) ? delBtn(r.id) : '') +
        '</div>' +
        '<div class="msb-name">' + ev(p + 'name', r.name, 'line', '薬局の名前') + '</div>' +
        '<dl class="cg-kv msb-kv">' +
          '<dt>電話</dt><dd class="cg-tel">' + TEL +
            ev(p + 'tel', r.tel, 'line', '電話番号') + '</dd>' +
          (web || on
            ? '<dt>Web</dt><dd>' + (web || '<span class="i-ev-empty">なし</span>') + '</dd>'
            : '') +
          memoRow +
        '</dl>' +
        '</div>';
    }).join('');

    return '<div class="ms-tiles">' + tiles + '</div>' +
      '<div class="ms-bands">' + bands + '</div>' +
      (on ? '<button type="button" class="rowadd" data-add="pharm">＋ かかりつけ薬局を足す</button>' : '');
  }

  /* メモ。三等の欄（備考）。手帳の記入面の末尾にある自由記入欄で、
     構造化するほどではない医療情報を書く。付箋のように面から浮かせ
     ない――浮かせると、器を持たない他の欄の中で1つだけ物になり、
     格の並び（一等→二等→三等）から外れて見える。                 */
  function memoBlock() {
    const m = S.data.medical;
    const memoLines = String(m.memo || '').split('\n').filter(Boolean);
    return '<div class="sf-sub bk-slips">' +
      '<div class="slip slip-memo">' +
        '<div class="slip-h">メモ' + editBtn('memo') + '</div>' +
        (isOpen('medical.memo')
          ? ev('medical.memo', m.memo, 'area', 'メモ（1行1件）')
          : (memoLines.length
              ? '<ul>' + memoLines.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>'
              : '<span class="i-ev i-ev-empty" data-edit="medical.memo" data-kind="area">メモ</span>')) +
      '</div>' +
      '</div>';
  }

  function renderMedical() {
    if (!medEl) return;

    medEl.innerHTML =
      '<div class="bk">' +
        bookBinding() +
        /* 表紙。本人の識別情報は左エリア（leftFace）が持つので、
           ここは表紙の題だけ。同じ事実を表紙と左面の2箇所に出すと、
           どちらが正かが読み手に決められない。 */
        '<div class="bk-cover">' +
          '<div class="bk-title">' +
            '<h4>医療の記録</h4>' +
            '<p>この記録があれば、はじめての場所でも安心して診てもらえます。</p>' +
          '</div>' +
        '</div>' +

        /* 見開き。手帳は開くと2面ある。左右で役割を変える：
             左 … 本人そのもの。個人情報・現在の医療状態・メモ。器を
                  持たせず、罫と文字の大小だけで置く。救急でまず読む
                  もの（病名・アレルギー・副作用歴）は「現在の医療状態」
                  が持つ。別に「伝えること」の節を設けると、同じ内容の
                  写しになる（派生ビューは置かない）。
             右 … 場面。いつもの通院・薬を確認するところ。

           どちらの面も、載せるのは「必要になったとき家族が思い出せ
           ない・調べられないこと」に限る（正本 §13-1）。日々の様子
           （普段の状態）と、付随物を集めた棚（必要になるものと所在）
           は、この基準から外れるので持たない。前者は家族が知っている
           うえ継続更新しなければ古い記述が「確認済み」の顔で残り、
           後者は診察券＝通院先・機器の手帳＝その機器と、既に親のいる
           情報を二度書かせていた（§8）。所在そのものは各対象の側で
           持つ。                                                */
        '<div class="bk-spread">' +
          '<div class="bk-page bk-page-l">' + leftFace() + '</div>' +
          '<div class="bk-page bk-page-r">' +
            /* いつもの通院。日常の側。かかりつけ薬局は「薬を確認する
               ところ」に一本化したので、ここには持たない。 */
            scene('visit', 'いつもの通院', 'かかっている先の連絡先です。',
              clinicsBlock(), 'sc-visit') +
            /* 薬を確認するところ。複数の入口への案内。 */
            scene('medsrc', '薬を確認するとき', '最新の薬の情報への入口です。',
              medSourcesBlock(), 'sc-medsrc') +
          '</div>' +
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
      /* 円柱の陰影。左に回り込みの暗部、やや左寄りに芯のハイライト、
         右に落ち込み。段を多く取るほど丸く見える。 */
      '<linearGradient id="bdPost2" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="#7d5c37"/>' +
        '<stop offset=".1" stop-color="#a17c4f"/>' +
        '<stop offset=".3" stop-color="#d9bd97"/>' +
        '<stop offset=".42" stop-color="#efdcc0"/>' +
        '<stop offset=".56" stop-color="#c9a878"/>' +
        '<stop offset=".8" stop-color="#9a7549"/>' +
        '<stop offset="1" stop-color="#785634"/>' +
      '</linearGradient>' +
      '<filter id="bdPostSh" x="-40%" y="-10%" width="180%" height="130%">' +
        '<feGaussianBlur stdDeviation="4"/>' +
      '</filter>' +
      '<radialGradient id="bdKnob" cx=".36" cy=".3" r=".78">' +
        '<stop offset="0" stop-color="#f2e0c6"/>' +
        '<stop offset=".5" stop-color="#d3b088"/>' +
        '<stop offset="1" stop-color="#9a7648"/>' +
      '</radialGradient>' +
      '</defs>' +
      /* 柱が背板へ落とす影。柱を板より手前に出す。 */
      '<path d="M26 44c-3 8-4 16-4 24v104c0 10 1 16 4 22h18c3-6 4-12 4-22V68c0-8-1-16-4-24Z" ' +
        'fill="#6b4f2c" fill-opacity=".4" filter="url(#bdPostSh)"/>' +
      /* 胴。径が上下で変わる輪郭。左右対称の1本のパスで削り出す。 */
      '<path d="M22 44c-3 8-4 16-4 24v104c0 10 1 16 4 22h16c3-6 4-12 4-22V68c0-8-1-16-4-24Z" ' +
        'fill="url(#bdPost2)"/>' +
      /* くびれ（下寄り）。径がすぼまる部分に陰を落として溝に見せる。 */
      '<path d="M18 150c4 3 20 3 24 0v10c-4 3-20 3-24 0Z" fill="#8a6740" fill-opacity=".55"/>' +
      /* 肩の輪。玉の下の首飾り。 */
      '<ellipse cx="30" cy="44" rx="15" ry="5" fill="#c9a677"/>' +
      '<ellipse cx="30" cy="40" rx="12" ry="4" fill="#dcc09a"/>' +
      /* 玉飾り。球に見せるには、明部→暗部の境（ターミネータ）と、
         下からの照り返し、そして首への落ち影が要る。 */
      '<circle cx="30" cy="22" r="18" fill="url(#bdKnob)"/>' +
      /* 下の照り返し。球の底が完全に黒く沈まないようにする。 */
      '<path d="M14 28a18 18 0 0 0 32 0 18 18 0 0 1-32 0Z" fill="#e8cba4" fill-opacity=".5"/>' +
      /* 首への落ち影。 */
      '<ellipse cx="30" cy="39" rx="13" ry="4" fill="#7d5c37" fill-opacity=".4" ' +
        'filter="url(#bdPostSh)"/>' +
      '<circle cx="23.5" cy="15" r="5.5" fill="#fdf6e8" fill-opacity=".8"/>' +
      '<circle cx="21.5" cy="13" r="2.2" fill="#fffdf7"/>' +
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
        /* 柔らかい影。部品同士の隙間に落として前後を出す。 */
        '<filter id="bdSoft" x="-20%" y="-20%" width="140%" height="150%">' +
          '<feGaussianBlur stdDeviation="6"/>' +
        '</filter>' +
        '<filter id="bdSoft2" x="-30%" y="-30%" width="160%" height="170%">' +
          '<feGaussianBlur stdDeviation="3"/>' +
        '</filter>' +
        /* 木目。乱流を横に引き伸ばして board の縞にする。 */
        '<filter id="bdGrain" x="0" y="0" width="100%" height="100%">' +
          '<feTurbulence type="fractalNoise" baseFrequency="0.9 0.012" ' +
            'numOctaves="3" seed="7" result="n"/>' +
          '<feColorMatrix in="n" type="saturate" values="0"/>' +
        '</filter>' +
        /* 木の面。上が明るく下が沈む。 */
        '<linearGradient id="bdWood" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#d6b78f"/>' +
          '<stop offset=".18" stop-color="#c9a479"/>' +
          '<stop offset=".62" stop-color="#b78f61"/>' +
          '<stop offset="1" stop-color="#9d7a4c"/>' +
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
      /* 板が壁に落とす影。ぼかして、板を壁から浮かせる。 */
      '<rect x="30" y="42" width="846" height="146" rx="8" fill="#7a5c34" ' +
        'fill-opacity=".34" filter="url(#bdSoft)"/>' +
      /* 背板。 */
      '<rect x="20" y="26" width="860" height="150" rx="8" fill="url(#bdWood)"/>' +
      /* 木目。板の上に薄く重ねる。 */
      '<rect x="20" y="26" width="860" height="150" rx="8" filter="url(#bdGrain)" ' +
        'opacity=".16" style="mix-blend-mode:multiply"/>' +
      /* 上辺の受け光と下辺の沈み。通帳の表紙と同じ「縁ごとの光」。 */
      '<path d="M28 28h844" stroke="#f4e0c2" stroke-opacity=".75" stroke-width="2.5"/>' +
      '<path d="M28 174h844" stroke="#7d5f36" stroke-opacity=".55" stroke-width="3"/>' +
      /* 落とし込みの内枠。彫り込みなので、上辺に濃い影・下辺に受け光。 */
      '<rect x="44" y="46" width="812" height="112" rx="4" fill="#8a6a42" fill-opacity=".3" ' +
        'filter="url(#bdSoft2)"/>' +
      '<rect x="46" y="48" width="808" height="108" rx="3" fill="url(#bdWood)"/>' +
      '<rect x="46" y="48" width="808" height="108" rx="3" filter="url(#bdGrain)" ' +
        'opacity=".14" style="mix-blend-mode:multiply"/>' +
      '<path d="M46 49.5h808" stroke="#6f5330" stroke-opacity=".5" stroke-width="3"/>' +
      '<path d="M46 155h808" stroke="#f6e5c9" stroke-opacity=".5" stroke-width="2.5"/>' +
      /* 縦の桟。溝は幅を持った帯（暗→明）で彫りに見せる。 */
      '<g>' +
        Array.from({ length: 12 }, (_, i) =>
          '<rect x="' + (78 + i * 64) + '" y="52" width="5" height="100" ' +
          'fill="url(#bdGroove)"/>').join('') +
      '</g>' +
      /* 笠木（上桟）。板の上に載る一本。手前に張り出すので、板へ影を落とす。
         断面は丸いので、上に受け光・中ほどに芯・下に沈みの3段。 */
      '<rect x="20" y="46" width="860" height="14" fill="#7a5c34" fill-opacity=".38" ' +
        'filter="url(#bdSoft2)"/>' +
      '<rect x="8" y="14" width="884" height="30" rx="9" fill="url(#bdWood)"/>' +
      '<rect x="8" y="14" width="884" height="30" rx="9" filter="url(#bdGrain)" ' +
        'opacity=".13" style="mix-blend-mode:multiply"/>' +
      '<path d="M14 17h872" stroke="#f7e6cc" stroke-opacity=".85" stroke-width="3"/>' +
      '<path d="M12 41.5h876" stroke="#6f5330" stroke-opacity=".6" stroke-width="3"/>' +

      /* ── 寝具 ──
         マットレス（厚みの側面つき）→ 敷きシーツ → 掛け布団の折り返し。
         面の境に必ず段差を置いて、layer を見せる。 */
      /* マットレスの上面（厚みの小口）。 */
      '<rect x="0" y="176" width="900" height="26" fill="#f7f4ea"/>' +
      '<path d="M0 201h900" stroke="#cec6b0" stroke-width="2"/>' +
      /* ヘッドボードがマットレスへ落とす影。ぼかして接地させる。 */
      '<rect x="0" y="172" width="900" height="16" fill="#8d7f63" fill-opacity=".42" ' +
        'filter="url(#bdSoft)"/>' +
      /* 敷きシーツ。 */
      '<rect x="0" y="200" width="900" height="46" fill="url(#bdSheet)"/>' +
      /* シーツの浅いしわ。間隔も丈も揃えない。 */
      '<g fill="none" stroke="#cfc7b2" stroke-opacity=".65" stroke-width="1.6" stroke-linecap="round">' +
        '<path d="M64 214c26 7 44 4 62-3"/>' +
        '<path d="M286 210c18 9 39 7 52 1"/>' +
        '<path d="M470 216c30 6 46 2 58-4"/>' +
        '<path d="M690 212c22 8 41 5 56-2"/>' +
      '</g>' +
      /* 掛け布団の折り返し。記録（シーツ面）はこの下に続くので、絵の
         側は「めくった縁」までを描き、下端で切る。 */
      '<path d="M0 252c120-9 210 7 316 2 96-4 158-11 262-6 118 6 206-4 322-8v60H0Z" ' +
        'fill="url(#bdQuilt)"/>' +
      '<path d="M0 252c120-9 210 7 316 2 96-4 158-11 262-6 118 6 206-4 322-8v14' +
        'c-116 4-204 14-322 8-104-5-166 2-262 6-106 5-196-11-316-2Z" ' +
        'fill="#eef3f2" fill-opacity=".8"/>' +
      /* 布団のひだ。長さも間隔も不揃いにする。 */
      '<g fill="none" stroke="#a8b7b7" stroke-opacity=".5" stroke-width="1.8" stroke-linecap="round">' +
        '<path d="M96 280c14 11 30 14 44 8"/>' +
        '<path d="M243 286c9 8 21 11 31 7"/>' +
        '<path d="M395 278c17 13 36 15 51 7"/>' +
        '<path d="M596 284c12 9 26 12 38 7"/>' +
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

  /* 治療中の病気・状態を全件見せるモーダル。相関図では4つまでしか
     置かないので、5件以上あるとき「ほか◯件」から開く。手帳の面の
     外（body 直下）に scrim ごと置く――面の中に入れると、外側クリック
     で編集を閉じるハンドラや手帳のはみ出し隠しと干渉する。
     他領域にモーダルの前例は無いので、ここで完結させる（正本 §13）。 */
  let condModalEl = null;
  function renderCondModal() {
    if (!condModal) {
      if (condModalEl) { condModalEl.remove(); condModalEl = null; }
      return;
    }
    const items = (S.grpOf('condition').items || []).filter(r => r.text);
    const rows = items.map(r =>
      '<li class="cm-row">' +
        '<span class="cm-ic">' +
          svgIc(COND_IC[r.text] || COND_FALLBACK, 15) + '</span>' +
        '<span class="cm-tx">' + esc(S.conditionLabel(r)) + '</span>' +
      '</li>').join('');
    if (!condModalEl) {
      condModalEl = document.createElement('div');
      condModalEl.className = 'cm-scrim';
      document.body.appendChild(condModalEl);
    }
    condModalEl.innerHTML =
      '<div class="cm-panel" role="dialog" aria-modal="true" aria-label="治療中の病気・状態">' +
        '<div class="cm-h">' +
          '<span class="cm-h-tx">治療中の病気・状態<em>' + items.length + '件</em></span>' +
          '<button type="button" class="cm-close" data-condmodal-close="1" ' +
            'aria-label="閉じる">' + XMARK + '</button>' +
        '</div>' +
        '<ul class="cm-list">' + rows + '</ul>' +
      '</div>';
  }

  /* 体の処置マップ｜カードの高さを実測して組み直す。
     foreignObject は高さを固定するので、描く前は中身の折り返し行数が
     分からず、見積りで置くしかない。見積りがずれると隣のカードと
     重なる。描画後にここで実測し、上から詰め直してリーダー線も
     引き直す（見積りは初回の当て置きでしかない）。 */
  function relayoutCards(root) {
    const svg = root && root.querySelector('.bmap-svg');
    if (!svg) return;
    const foList = [...svg.querySelectorAll('.bmap-fo')];
    if (!foList.length) return;
    const leaderList = [...svg.querySelectorAll('.bmap-leader')];
    const vb = svg.viewBox.baseVal;
    const TOP = vb.y + 4, BOT = vb.y + vb.height - 4;

    ['l', 'r'].forEach(side => {
      const list = foList.filter(fo => fo.dataset.side === side)
        .sort((a, b) => (+a.dataset.py) - (+b.dataset.py));
      let cursor = TOP;
      list.forEach(fo => {
        const card = fo.querySelector('.bmap-card');
        if (!card) return;
        /* 実測（CSS px）を viewBox の単位へ直す。SVG は幅なりに
           拡縮されるので、その比を掛ける。 */
        const scale = vb.width / svg.getBoundingClientRect().width;
        const h = card.getBoundingClientRect().height * scale + 2;
        const py = +fo.dataset.py;
        let top = Math.max(cursor, py - h / 2);
        if (top + h > BOT) top = BOT - h;
        cursor = top + h + 8;
        fo.setAttribute('y', top);
        fo.setAttribute('height', h);
        /* リーダー線を引き直す。カードの縦中央からピンへ。 */
        const leader = leaderList[foList.indexOf(fo)];
        if (leader) {
          leader.setAttribute('d', 'M' + fo.dataset.edge + ' ' + (top + h / 2) +
            'H' + fo.dataset.bend + 'L' + fo.dataset.px + ' ' + py);
        }
      });
    });
  }

  function render() {
    renderMedical();
    renderCare();
    renderCondModal();
    relayoutCards(medEl);

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
        if (scrollToEditingAfterRender) {
          const card = el.closest('.cef-item') || el;
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
    scrollToEditingAfterRender = false;
  }

  /* ── 編集の確定 ─────────────────────────────────────
     開いている入力欄の値を state へ書き戻す。配列で持っている項目
     （診療科・箇条書き）は専用の適用関数を通す。                   */
  const TAG_PATHS  = [];
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
    const key = editSection.key;
    const changed = flushInputs();
    editSection = null;
    editing = null;
    picker = null;
    pickerGroups.clear();
    if (changed) S.save();
    render();
    /* 編集を閉じるとフォームが畳まれてページ高が縮む――スクロール
       位置がそのままだと、閉じた節がはるか下（または画面外）に
       残る。閉じた節の見出しを画面内に戻す。 */
    scrollSectionIntoView(key);
  }
  /* 節の見出し（閲覧モードの鉛筆 .i-secedit[data-editsec=KEY]）を
     画面の上寄りに収める。render 直後に呼ぶ。 */
  function scrollSectionIntoView(key) {
    const anchor = document.querySelector('.i-secedit[data-editsec="' + key + '"]');
    if (!anchor) return;
    const head = anchor.closest('.sf-glb, .sf-sglb, .subsec-lb, .cm-h, .sec-h') || anchor;
    const y = head.getBoundingClientRect().top + window.pageYOffset - 84;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }
  function cancelAll() {
    editing = null;
    editSection = null;
    confirmDelete = null;
    picker = null;
    pickerGroups.clear();
    render();
  }

  /* 顔写真を選ぶ。<input type=file> を作って開き、選ばれた画像を
     縮小してから data URI で state へ入れる。手帳に貼る証明写真は
     小さくてよいので、長辺 480px・JPEG 品質 .82 まで落とす。      */
  function pickPhoto() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.addEventListener('change', () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 480;
          let w = img.naturalWidth, h = img.naturalHeight;
          if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
          else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          let uri;
          try { uri = cv.toDataURL('image/jpeg', 0.82); }
          catch (err) { uri = String(reader.result); }
          S.data.medical.person.photo = uri;
          S.save();
          render();
        };
        img.onerror = () => show('画像を読み込めませんでした');
        img.src = String(reader.result);
      };
      reader.onerror = () => show('画像を読み込めませんでした');
      reader.readAsDataURL(file);
    });
    inp.click();
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

      /* 顔写真。押すとファイルを選び、読み込んで data URI で持つ。
         大きい写真はキャンバスで長辺 480px まで縮めてから保存する
         （localStorage の仮保存に載る大きさに抑える）。 */
      const ph = e.target.closest('[data-photo]');
      if (ph) { pickPhoto(); return; }
      const phc = e.target.closest('[data-photoclr]');
      if (phc) {
        S.data.medical.person.photo = '';
        S.save();
        render();
        return;
      }

      /* 治療中の病気・状態｜「ほか◯件」で全件モーダルを開く。 */
      const cmo = e.target.closest('[data-condmodal]');
      if (cmo) { condModal = true; render(); return; }

      /* 節ごとの編集を開く／閉じる。 */
      const se = e.target.closest('[data-editsec]');
      if (se) {
        const key = se.dataset.editsec;
        if (editSection && editSection.key === key) { commitSection(); return; }
        if (editing) flushInputs();
        editing = null;
        confirmDelete = null;
        picker = null;
        pickerGroups.clear();
        editSection = { key: key };
        render();
        return;
      }

      /* 現在の医療状態｜「あり／なし」を選ぶ。 */
      const pz = e.target.closest('[data-presence]');
      if (pz) {
        flushInputs();
        const [kind, val] = pz.dataset.presence.split('|');
        if (val !== 'あり') { picker = null; pickerGroups.clear(); }
        if (S.setPresence(kind, val)) S.save();
        render();
        return;
      }

      /* 候補ピッカーの開閉。data-pick="kind"。 */
      const pk = e.target.closest('[data-pick]');
      if (pk) {
        flushInputs();
        const kind = pk.dataset.pick;
        if (picker === kind) { picker = null; pickerGroups.clear(); }
        else { picker = kind; pickerGroups.clear(); }
        render();
        return;
      }
      /* 系統見出しの展開・折りたたみ。data-pickgrp="kind/系統名"。 */
      const pg = e.target.closest('[data-pickgrp]');
      if (pg) {
        const key = pg.dataset.pickgrp;
        if (pickerGroups.has(key)) pickerGroups.delete(key);
        else pickerGroups.add(key);
        render();
        return;
      }

      /* 現在の医療状態｜候補チップの入り切り（病気・治療・機器）。
         data-chip="kind|値"。足したときは、名前はチップの値で埋まって
         いるので、次に書く補足欄（いまの扱い／続け方・使用状況）へ
         すぐ入れる。「＋ 自由に書く」で名前欄へ送るのと対になる導線
         （正本 §2：埋める場所が読めない状態を作らない）。            */
      const cz = e.target.closest('[data-chip]');
      if (cz) {
        flushInputs();
        const [kind, value] = cz.dataset.chip.split('|');
        const g = S.grpOf(kind);
        g.items = g.items || [];
        const at = g.items.findIndex(r => r.text === value);
        if (at > -1) g.items.splice(at, 1);
        else {
          const row = S.addCurrentRow(kind);
          row.text = value;
          const idx = g.items.length - 1;
          editing = { path: 'medical.' + kind + 's.items.' + idx + '.note', kind: 'line' };
          scrollToEditingAfterRender = true;
        }
        S.save();
        render();
        return;
      }

      /* 行の中の複数選択（反応・起きたこと）。
         data-multi="medical.allergies.items.0|reactions|値" */
      const mz = e.target.closest('[data-multi]');
      if (mz) {
        flushInputs();
        const [rowPath, field, value] = mz.dataset.multi.split('|');
        S.toggleInArray(S.getByPath(rowPath), field, value);
        S.save();
        render();
        return;
      }

      /* 候補チップで1つの値を入れる／外す（ひとこと等）。
         data-setval="path|値"。同じ値ならトグルで空に戻す。 */
      const sv = e.target.closest('[data-setval]');
      if (sv) {
        flushInputs();
        const at = sv.dataset.setval.indexOf('|');
        const path = sv.dataset.setval.slice(0, at);
        const value = sv.dataset.setval.slice(at + 1);
        S.setByPath(path, (S.getByPath(path) || '') === value ? '' : value);
        S.save();
        render();
        return;
      }

      /* 行を足す。 */
      const add = e.target.closest('[data-add]');
      if (add) {
        flushInputs();
        const what = add.dataset.add;
        if (what === 'clinic') S.addClinic();
        else if (what === 'pharm') {
          const row = S.addPharmacySource();
          editing = { path: 'medical.medSources.' +
            (S.data.medical.medSources.length - 1) + '.name', kind: 'line' };
          scrollToEditingAfterRender = true;
        }
        else if (what === 'condition' || what === 'treatment' || what === 'device') {
          S.addCurrentRow(what);
          /* 足したその行の名前欄をすぐ開く。開かないと画面のいちばん上に
             空カードが増えるだけで「どこに書くのか」が読めない。
             render() が data-path の欄へ focus し、下で見える位置へ送る。 */
          const idx = (S.grpOf(what).items || []).length - 1;
          const path = 'medical.' + what + 's.items.' + idx + '.text';
          editing = { path: path, kind: 'line' };
          scrollToEditingAfterRender = true;
        }
        else if (what === 'allergy') S.addAllergy();
        else if (what === 'adverse') S.addAdverse();
        else if (what === 'service') S.addService('', 'home');
        else if (what === 'cpaper')
          S.data.care.papers.push({ id: 'cp-' + Date.now(), item: '', where: '', state: '未確認' });
        S.save();
        render();
        return;
      }

      /* 行を消す。1度目で「削除しますか？」、[削除] で実行、[やめる] で戻す。 */
      const del = e.target.closest('[data-del]');
      if (del) { confirmDelete = del.dataset.del; render(); return; }
      const dno = e.target.closest('[data-delno]');
      if (dno) { confirmDelete = null; render(); return; }
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

    /* セレクトは選ばれた瞬間に書き戻す。日付欄はここに含めない――
       年・月・日を1桁ずつ打っている途中でも change が飛ぶことがあり、
       そのたびに render() で input が作り直されてフォーカスが切れる
       （キー入力が1回で止まって見えるバグの原因だった）。日付欄は
       他の文字欄と同じく、Enter か編集終了の操作で確定させる。     */
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

  /* 病名モーダルの閉じ方｜×ボタン・scrim の外側・Escape。 */
  function closeCondModal() { if (condModal) { condModal = false; render(); } }
  document.addEventListener('click', e => {
    if (!e.target.isConnected) return;
    if (e.target.closest('[data-condmodal-close]')) { closeCondModal(); return; }
    if (condModal && e.target.classList.contains('cm-scrim')) closeCondModal();
  });

  /* Enter で確定、Escape で閉じる。節ごとの編集中は、Enter はその欄を
     確定して節は開いたまま。Escape は節ごと閉じる。 */
  document.addEventListener('keydown', e => {
    if (condModal && e.key === 'Escape') { e.stopPropagation(); closeCondModal(); return; }
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
