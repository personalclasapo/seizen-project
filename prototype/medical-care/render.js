/* SeiZen プロトタイプ｜医療・介護の描画
   ------------------------------------------------------------------
   画面は state.js の事実を描いた結果。医療ゾーン（手帳）と介護ゾーン
   （連絡ボード）を両方描く。

   書いてある場所がそのまま入力欄になる（銀行口座・保険・契約デジタル
   と同じ手つき）。欄をひとつ押せばその場で書き換えられ、節見出しの
   鉛筆を押せばその節をまとめて開く。状態バッジは押すと次の状態へ
   回る（確認済み→未確認→確認中→該当なし）。

   造形は医療＝手帳、介護＝連絡ボード（2026-09-08 ユーザー承認）。通帳・証券フォルダ
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
    /* 木札の帯は1つの編集単位＝介護認定と主な相談先をまとめて開く
       （鉛筆は帯に1つ。認定だけ別セクションだと、鉛筆を押しても
       認定が編集できない＝2026-09-10 指摘）。 */
    manager: ['care.level', 'care.manager'],
    service: ['care.services'],
    equipment: ['care.equipment'],
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
  /* 外部リンク。★`↗` の文字を本文に混ぜない（2026-09-09 指摘：
     矢印がチープ）。生の矢印文字は本文と同じ字送り・同じウエイトで
     並ぶので、記号ではなく「文の一部」に見えてしまう。外部リンクの
     慣用記号は**枠から出ていく矢印**――枠（開いた角）と矢羽根の
     2要素で描く。他の領域と同じく専用の viewBox を持つグリフにする。 */
  const EXT = '<svg class="i-ext" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
      /* 枠。右上だけ開いていて、そこから矢印が出ていく。 */
      '<path d="M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5"/>' +
      /* 出ていく矢羽根。 */
      '<path d="M14 3h7v7"/><path d="M21 3 11.5 12.5"/>' +
    '</svg>';
  const svgIc = (d, w) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="' +
    (w || 18) + '" height="' + (w || 18) + '">' + d + '</svg>';
  /* 塗り面のグリフ（サービス表の行頭）。currentColor を fill に使う。 */
  const fillIc = (d, w) => '<svg viewBox="0 0 24 24" fill="currentColor" width="' +
    (w || 18) + '" height="' + (w || 18) + '">' + d + '</svg>';

  /* サービス表の行頭アイコン。ここは白チップの線グリフ（節見出し）
     とは役割が別――「4種類のサービスがある」を色で見分けさせる塗り
     面のしるし（正本モック `介護イメージ.png` どおり）。currentColor
     を塗りに使い、系統色（.c-home など）で色が変わる。               */
  const SV_IC = {
    home: '<path d="M12 3.2 3.4 10.4a1 1 0 0 0-.4.8V20a1 1 0 0 0 1 1h5v-5.5a3 3 0 0 1 6 0V21h5a1 1 0 0 0 1-1v-8.8a1 1 0 0 0-.4-.8Z"/>',
    out:  '<path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h8A1.5 1.5 0 0 1 15 6.5V8h2.6a1.5 1.5 0 0 1 1.3.8l1.5 2.7a1.5 1.5 0 0 1 .2.7v3.3a1 1 0 0 1-1 1h-1a2.4 2.4 0 0 0-4.8 0H10a2.4 2.4 0 0 0-4.8 0h-1a1 1 0 0 1-1-1v-8Z" />' +
          '<path d="M6 8.4h3.2v2.4H6Zm5 0h3v2.4h-3Zm4.7 0h1.5l1.2 2.4h-2.7Z" fill="#fff"/>' +
          '<circle cx="7.6" cy="17.4" r="1.5"/><circle cx="15.4" cy="17.4" r="1.5"/>',
    /* 配食＝皿＋カトラリー。フォークとナイフは Openclipart の CC0 素材
       （`assets/care-cutlery.svg` / `care-cutlery.README.md`）から。
       元 viewBox 276.285×286.559 を 24 系へ収める。皿だけ円で描き、
       その左右に置く――自前のベジェで歯の間隔を詰め始めない。      */
    meal: '<circle cx="12" cy="12" r="6.6" fill="none" stroke="currentColor" ' +
            'stroke-width="1.9"/>' +
          '<circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" ' +
            'stroke-width="1.2" stroke-opacity=".55"/>' +
          '<g transform="translate(1.15 2.2) scale(0.0655)">' +
            '<path d="m45.476 281.86c0.009 2.584-2.099 4.699-4.684 4.699h-20.513c-2.585 0-4.668-2.115-4.629-4.699l2.56-168.01c0.039-2.584 2.186-4.7 4.771-4.7h17.189c2.585 0 4.708 2.116 4.717 4.7l0.589 168.01z"/>' +
            '<path d="m57.017 0c-2.109 0-3.834 1.726-3.834 3.833v51.469c0 2.109-1.496 3.833-3.326 3.833-1.829 0-3.326-1.724-3.326-3.833v-51.469c0-2.107-1.725-3.833-3.833-3.833h-3.964c-2.109 0-3.834 1.726-3.834 3.833v51.469c0 2.109-1.495 3.833-3.323 3.833s-3.323-1.724-3.323-3.833v-51.469c-0.001-2.107-1.726-3.833-3.834-3.833h-3.968c-2.108 0-3.833 1.726-3.833 3.833v51.469c0 2.109-1.496 3.833-3.324 3.833s-3.324-1.724-3.324-3.833v-51.469c0-2.107-1.725-3.833-3.834-3.833h-2.304c-2.108 0-3.833 1.726-3.833 3.833v113.89c0 2.109 1.725 3.833 3.833 3.833h55.484c2.108 0 3.833-1.725 3.833-3.833v-113.89c0.001-2.104-1.724-3.83-3.833-3.83h-2.3z"/>' +
          '</g>' +
          '<g transform="translate(4.72 2.2) scale(0.0655)">' +
            '<path d="m276.28 174.43c0.101 2.072-1.384 4.426-3.297 5.23l-32.008 13.447c-1.912 0.805-3.478-0.236-3.478-2.311v-89.376-7.543-89.375c0-2.074 1.122-3.771 2.494-3.771s3.614 0 4.985 0 2.963 1.63 3.541 3.624 17.97 62.084 21.294 85.082c3.57 24.563 6.49 84.993 6.49 84.993z"/>' +
            '<path d="m272.31 282.88c0.048 2.021-1.566 3.674-3.588 3.674h-22.56c-2.021 0-3.663-1.652-3.649-3.674l0.687-101.07c0.015-2.021 1.68-3.674 3.7-3.674h19.24c2.021 0 3.715 1.652 3.763 3.674l2.41 101.07z"/>' +
          '</g>',
    /* 生活支援＝バケツ。参考画像はほうきだが、18px に耐える CC0 の
       ほうきが無く、自前のベジェは人体ループになる（RESEARCH.md）。
       台形＋口の楕円＋半円の取っ手で「家事の道具」として通る。     */
    life: '<path d="M4.8 8.4h14.4l-1.5 11.1a2 2 0 0 1-2 1.7H8.3a2 2 0 0 1-2-1.7Z"/>' +
          '<ellipse cx="12" cy="8.4" rx="7.2" ry="1.9" fill="none" ' +
            'stroke="currentColor" stroke-width="1.7"/>' +
          '<path d="M7.4 8a4.6 4.6 0 0 1 9.2 0" fill="none" ' +
            'stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    equip: '<path d="M8 3.4a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z"/>' +
           '<path d="M6.6 8.7A2 2 0 0 0 5 10.6l-.5 3.1a6 6 0 1 0 6.9 8.3l-2-1a3.9 3.9 0 1 1-3.6-5.5l.3-1.8 3.5 2.3a2 2 0 0 0 1.1.3H16v-2h-4.6L7.9 9.6a2 2 0 0 0-1.3-.9Z"/>' +
           '<path d="M17 20.5 15 15h-2.2l2.3 6.2a1 1 0 0 0 .9.65H20v-2h-2.5Z"/>'
  };
  /* サービス表の「名前」「支援内容」欄の例文。★分類（訪問／通い／食事／
     暮らし）で中身が変わるので、分類ごとに持つ。長い例文はモバイルの
     狭い欄（233px 級）で右が見切れ、プレースホルダーは横スクロールでき
     ないので読めない（2026-09-10 指摘）――「例：」込みで11字以内に収める。 */
  const SV_PH = {
    home: { name: '例：訪問介護',       does: '例：入浴や着替えの介助' },
    out:  { name: '例：デイサービス',   does: '例：日中の預かり・入浴' },
    meal: { name: '例：配食サービス',   does: '例：昼食を毎日届ける'   },
    life: { name: '例：見守りサービス', does: '例：週1回の安否確認'   }
  };
  /* 顔写真のプレースホルダー。写真が未登録のあいだ、枠の中に置く
     本人のしるし（正本 §11：空欄と該当なしを同じにしない――ここは
     「まだ貼っていない」欄なので、空白ではなく人の形を残す）。 */
  const PHOTO_PH = '<svg class="sf-photo-ph" viewBox="0 0 72 72" aria-hidden="true">' +
    '<circle cx="36" cy="28" r="13" fill="#c8bfa6"/>' +
    '<path d="M13 66c0-13 10-22 23-22s23 9 23 22Z" fill="#c8bfa6"/>' +
    '</svg>';
  /* 節見出しの記号。医療の左面・右面と同じく、白チップ＋緑線の部品
     （headChip）に包む。中身も揃える――輪郭を fill-opacity の面で
     1枚敷き、その上を線が通る2層構成（SCENE_IC.visit と同じ密度）。
     各 path が stroke/fill を自前で持つ。介護の4節ぶん。            */

  /* ※ CARE_LEVEL_IC（書類＋チェック）と CARE_PERSON_IC（二人）は、
     介護認定・担当者をプレートから上部の木札の帯へ移した際に
     使い手がいなくなったので削除した（2026-09-09）。帯の見出しは
     白チップではなく彫り込んだ文字なので、グリフを持たない。      */

  /* ※ CARE_HEART_IC（寄り添うハート）は「今の支援」プレートの見出しを
     落とした際（opt.noHead・器は残す）に使い手がなくなったので削除した
     （2026-09-10）。 */

  /* 暮らしの時間に入る支援｜時計。カレンダー紙面の頭書きに置くチップの
     グリフ。この節の中身（週のカレンダー）が「時間軸に入る予定」だから
     時計――モチーフとの連動（2026-09-10）。綴じ帯と同じ茶地に白で抜く
     ので、白チップ＋緑線の headChip ではなく、塗り面のグリフにする
     （文字盤の円＋短針・長針）。 */
  const CARE_CLOCK_IC =
    '<circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8"/>' +
    '<path d="M12 7.2V12l3.4 2" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';

  /* 書類やもの｜綴じた書類。所在をまとめる場所。 */
  const CARE_DOC_IC =
    '<rect x="4.5" y="4" width="12" height="16" rx="1.6" ' +
      'fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M8 4v16" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M10.5 8.5h4M10.5 12h4" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round"/>' +
    '<path d="M17 7.5l2.4.7-3 10.3-2.4-.7" fill="currentColor" fill-opacity=".12" ' +
      'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>';

  /* 小さなしるし。メモの付箋アイコン（文字ラベルは置かない）と、
     所在のピン。どちらも本文の中に添える。 */
  const MEMO_MARK = '<svg class="mk mk-memo" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M3 2.2h7l3.5 3.5V13a.8.8 0 0 1-.8.8H3A.8.8 0 0 1 2.2 13V3A.8.8 0 0 1 3 2.2Z" ' +
      'fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.1" ' +
      'stroke-linejoin="round"/>' +
    '<path d="M9.6 2.3v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.1" ' +
      'stroke-linejoin="round"/>' +
    '<path d="M4.6 8.4h5M4.6 10.6h3.2" fill="none" stroke="currentColor" ' +
      'stroke-width="1.1" stroke-linecap="round"/></svg>';
  const PIN_MARK = '<svg class="mk mk-pin" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M8 1.6a4.6 4.6 0 0 0-4.6 4.6c0 3.2 4.6 8.2 4.6 8.2s4.6-5 4.6-8.2A4.6 4.6 0 0 0 8 1.6Z" ' +
      'fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="1.1" ' +
      'stroke-linejoin="round"/>' +
    '<circle cx="8" cy="6.2" r="1.7" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';

  /* 「現在の医療状態」｜バイタルモニターの画面と波形。画面の角丸を
     面取りで敷き、中を脈波の折れ線が通る（headChip 用、各 path が
     stroke/fill を自分で持つ）。 */
  const PULSE_IC =
    '<rect x="2.5" y="4.5" width="19" height="15" rx="2.4" ' +
      'fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M5 12.5h2.6l1.6-4 2.4 8 2-6.4 1.3 2.4H19" ' +
      'fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>';

  /* 「体に合わないもの」（アレルギー・副作用歴）の欄のしるし。
     警告標識（三角＋！・丸に×）はこの面には強すぎるので使わない。
     薬包（フラスコ）に面取りを敷き、はねる一滴を添える（headChip
     用、各 path が stroke/fill を自分で持つ）。 */
  const VITALS_IC =
    '<path d="M10 3.5v3.2L5.5 15c-1 1.9-.2 4 1.7 4.6.5.2 1 .3 1.6.3h6.4' +
    'c.6 0 1.1-.1 1.6-.3 1.9-.6 2.7-2.7 1.7-4.6L14 6.7V3.5Z" ' +
    'fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linejoin="round"/>' +
    '<path d="M9 3.5h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
    '<path d="M7.3 12.8h9.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';

  /* メモ｜書きかけの紙と鉛筆。紙に面取りを敷き、罫を2本、右上から
     鉛筆が下りてくる（headChip 用、各 path が stroke/fill を自前で
     持つ）。「書き留める」ことそのものの絵で、内容を限定しない。 */
  const MEMO_IC =
    '<path d="M4.5 3.5h9.2l5.8 5.8v10.7a1 1 0 0 1-1 1h-14a1 1 0 0 1-1-1v-15.5a1 1 0 0 1 1-1Z" ' +
      'fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linejoin="round"/>' +
    '<path d="M13.5 3.6v5.7h5.7" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linejoin="round"/>' +
    '<path d="M7 13h7M7 16.5h4.5" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round"/>';

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
  /* Web の入力欄（医療・介護の Web 欄すべてで共通）。★https:// を
     プレースホルダではなく欄の中身そのものの実値として持たせる
     （2026-09-11 ユーザー指示）――空欄のまま編集を始めても
     「https://」が最初から入っていて、続きを打つだけでよい。
     プレースホルダだと入力の瞬間に消えるので、URL の頭を毎回
     自分で打つ手間が残っていた。 */
  function evWeb(path, value) {
    return ev(path, String(value || '').trim() || 'https://', 'line', '');
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

  /* 参考画像「外観.png」の薄いカバーと紙の重なりを抽出。
     外周は全幅の約2%、紙の小口は約0.4%。内容の高さに追従する
     装飾層。文字や操作部品は伸縮させず、通常のHTMLで重ねる。 */
  function bookBinding() {
    return `<svg class="bk-binding" viewBox="0 0 1000 1000"
      preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="bkJacket" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#dbe9df" stop-opacity=".8"/>
          <stop offset=".5" stop-color="#a9c5b4" stop-opacity=".72"/>
          <stop offset="1" stop-color="#cbded0" stop-opacity=".9"/>
        </linearGradient>
        <linearGradient id="bkLeaf" x1="0" y1="0" x2="0" y2="1">
          <stop stop-color="#fffef9"/><stop offset="1" stop-color="#f5f3e9"/>
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="996" height="996" rx="22"
        fill="url(#bkJacket)" stroke="#9cb5a6" vector-effect="non-scaling-stroke"/>
      <rect x="7" y="6" width="986" height="987" rx="18"
        fill="none" stroke="#ffffff" stroke-opacity=".8" vector-effect="non-scaling-stroke"/>
      <rect x="15" y="14" width="970" height="972" rx="9"
        fill="#93b5a0" fill-opacity=".56"/>
      <path d="M24 26 Q270 16 526 27 Q760 16 976 26 L976 977
        Q760 986 526 977 Q260 986 24 978 Z" fill="#dedfd0" stroke="#b7bdaa"
        vector-effect="non-scaling-stroke"/>
      <path d="M21 22 Q270 14 526 24 Q760 14 979 22 L979 973
        Q760 982 526 973 Q260 982 21 974 Z" fill="url(#bkLeaf)" stroke="#d0d1bf"
        vector-effect="non-scaling-stroke"/>
      <path d="M25 970 Q275 977 526 969 Q770 977 975 969"
        fill="none" stroke="#fffef9" vector-effect="non-scaling-stroke"/>
    </svg>`;
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
  /* 白地チップ＋緑の線グリフの見出し記号（正本モック：右面3節と同じ
     手つき）。左面の節見出しにも同じ部品を使う――「これは何の絵か」を
     一言で言える密度を、見出し全体で共通にする（CLAUDE.md）。 */
  function headChip(d) {
    if (!d) return '';
    return '<span class="scene-ic"><svg viewBox="0 0 24 24" aria-hidden="true" ' +
      'focusable="false">' + d + '</svg></span>';
  }
  function sceneHeadIcon(key) { return headChip(SCENE_IC[key]); }
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
     なっている――一等は太い罫と記入枠、二等は罫の走る記入欄。
     左面はその2つの格で組む。

       一等 .sf-head  … 識別欄（氏名・生年月日・年齢・血液型）
       二等 .sf-sec   … 現在の医療状態／体に合わないもの

     三等（備考＝メモ）は右面の頭へ移した。自由記述は「変わらない
     事実」ではないので、この面の格の並びに乗らない。             */

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

    /* 図は viewBox 0 0 380 280。素材（151×321）は縦を 264 に収まる
       よう縮めて中央へ置く。左右に 122 幅のカード欄。左面が右面の
       連絡先より短く、下に余白が空きがちなので、図そのものを一回り
       大きく取って上下の間合いも広げてある（勘で詰めるのではなく、
       縦寸を一段だけ上げた）。 */
    const VB_W = 380, VB_H = 280;
    const BODY_H = 264;
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

  /* 候補チップにない反応を書き足す欄。チップ群のすぐ下に置く（診療科
     depts と同じ手つき：読点区切りの1行で複数書ける）。ここに書いた
     値もチップで選んだ値も、同じ reactions / events 配列へ混ざって
     入る――閲覧側は配列を素で繋ぐだけなので区別を持たせない。
     data-path は applyOne が正規表現で拾って applyReactionFree へ回す。
     チップと地続きに見えると「選ぶもの」と誤解されるので、小見出しを
     1本立てて別の欄として切る。 */
  function reactionFreeField(path, value, placeholder) {
    return '<div class="cef-react-free-wrap">' +
      '<span class="cef-react-free-lb">上の候補にないものは、ここに書く' +
        '<em>読点で区切って複数可</em></span>' +
      '<input class="i-ef cef-react-free" data-ef="1" data-path="' + path + '"' +
        ' placeholder="' + esc(placeholder) + '" value="' + esc(value || '') + '">' +
      '</div>';
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
          reactionFreeField('medical.allergies.items.' + i + '.reactionsFree',
            S.reactionFreeText(r.reactions, S.ALLERGY_REACTIONS),
            '候補にない反応（例：喉の腫れ、下痢）') +
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
          reactionFreeField('medical.adverse.items.' + i + '.eventsFree',
            S.reactionFreeText(r.events, S.ADVERSE_EVENTS),
            '候補にない症状（例：発熱、味覚障害）') +
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

  /* 左エリア。本人そのもの。本文には器を敷かず、手帳の記入面の
     「欄の格」で階層を作る（一等＝識別欄／二等＝医療状態）。
     節見出しの記号だけは右面の場面カードと同じ白チップ（headChip）
     に揃える――見出しの格は左右で同じでなければならない。

     節見出しは配下の小見出しより強くする。以前は節が 10.5px の
     添え字で、その中の小見出しが 11.5px の太字――親より子が強く、
     5つの小見出しがトップレベルに並んで見えていた（＝羅列の骨）。

     2段の骨：識別欄（.sf-head）が段1、それ以外が段2（.sf-rest）。
     見開きの段組み（.bk-spread の subgrid）に乗せて、右面のメモと
     頭・尻を揃えるため（area.css「見開き」参照）。               */
  function leftFace() {
    return '<div class="sf">' +
      personBlock() +
      '<div class="sf-rest">' +
      '<div class="sf-sec">' +
        '<span class="sf-glb">' + headChip(PULSE_IC) +
          '<span class="sf-glb-tx">現在の医療状態</span>' +
          editBtn('current') + '</span>' +
        currentStateBlock() +
      '</div>' +
      '<div class="sf-sec sf-sec-vitals">' +
        '<span class="sf-glb sf-glb-vitals">' +
          headChip(VITALS_IC) +
          '<span class="sf-glb-tx">体に合わないもの</span>' +
          '<span class="sf-glb-sub">受診時に必ず伝える</span>' +
          editBtn('vitals') +
        '</span>' +
        vitalsBlock() +
      '</div>' +
      '</div>' + /* .sf-rest */
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
            ? evWeb(p + 'web', c.web)
            : '<a href="' + esc(c.web) + '" target="_blank" rel="noopener" ' +
              'class="cg-link">' + esc(webLabel(c.web)) + EXT + '</a>')
        : (on ? evWeb(p + 'web', c.web) : '');
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
    /* 件数を data-count で渡す。1件のときは器が広くても2列にせず、
       カード幅を止めて中央へ寄せる（area.css .cggrid）。 */
    const n = (m.clinics || []).length;
    return '<div class="cggrid" data-count="' + n + '">' +
      (cards || '<p class="i-ev-empty">まだ登録がありません。</p>') + '</div>' +
      (on ? '<button type="button" class="rowadd" data-add="clinic">＋ 医療機関を足す</button>' : '');
  }

  /* Web の表示名。スキームと末尾スラッシュを落として読みやすく。 */
  /* ★以前は https:// を削ってドメイン名だけ見せていたが、実在しない
     ダミー URL で確認したときに「https:// がどこにも表示されない」と
     見えた（2026-09-11 ユーザー指摘）。URL であることが一見して分かる
     ほうを優先し、https:// は残す（末尾の "/" だけ、見た目上の意味が
     薄いので落とす）。医療・介護の全 Web 欄で共通の見せ方。 */
  function webLabel(url) {
    return String(url || '').replace(/\/$/, '');
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
            ? evWeb(p + 'web', r.web)
            : '<a href="' + esc(r.web) + '" target="_blank" rel="noopener" ' +
              'class="cg-link">' + esc(webLabel(r.web)) + EXT + '</a>')
        : (on ? evWeb(p + 'web', r.web) : '');
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

    /* かかりつけ薬局の件数。通院カードと同じく、1件なら器が広くても
       引き伸ばさず幅を止めて中央へ（area.css .ms-bands）。 */
    const pharmN = list.filter(r => r.kind === 'pharmacy').length;
    return '<div class="ms-tiles">' + tiles + '</div>' +
      '<div class="ms-bands" data-count="' + pharmN + '">' + bands + '</div>' +
      (on ? '<button type="button" class="rowadd" data-add="pharm">＋ かかりつけ薬局を足す</button>' : '');
  }

  /* メモ。右面の頭に置く記入面。左面の識別欄（.sf-head）と高さを
     揃え、見開きの頭に「左＝本人／右＝書き留めたこと」の帯を1本通す。

     左面へは置かない。左面は「場面によらず変わらない事実」の面で、
     自由記述は事実の記入欄ではない――格の並び（一等→二等）の末尾に
     ぶら下げると、格の違うものが一番下に付く形になる。

     器は持たせない（囲みの箱にすると、面の上で1つだけ物になる）。
     地も影も持たず、罫だけが刷ってある欄として置く。空いた罫は
     「まだ書かれていない欄」として読める（正本 §11）。            */
  function memoBlock() {
    const m = S.data.medical;
    const memoLines = String(m.memo || '').split('\n').filter(Boolean);
    return '<div class="rmemo">' +
      '<div class="rmemo-h">' + headChip(MEMO_IC) +
        '<span class="sf-glb-tx">メモ</span>' +
        '<span class="rmemo-sub">気づいたこと・伝えておきたいこと</span>' +
        editBtn('memo') + '</div>' +
      '<div class="rmemo-body">' +
        (isOpen('medical.memo')
          ? ev('medical.memo', m.memo, 'area', 'メモ（1行1件）')
          : (memoLines.length
              ? memoLines.map(l =>
                  '<p class="rmemo-line">' + esc(l) + '</p>').join('')
              : '<span class="i-ev i-ev-empty rmemo-line" data-edit="medical.memo" ' +
                'data-kind="area">例：夜間の痛みが続いている。主治医には未相談。</span>')) +
      '</div>' +
      '</div>';
  }

  function renderMedical() {
    if (!medEl) return;

    medEl.innerHTML =
      '<div class="bk">' +
        bookBinding() +
        '<div class="bk-paper">' +
        /* 見開き。手帳は開くと2面ある。左右で役割を変える：
             左 … 本人そのもの。個人情報・現在の医療状態。器を持たせず、
                  罫と文字の大小だけで置く。救急でまず読むもの（病名・
                  アレルギー・副作用歴）は「現在の医療状態」が持つ。
                  別に「伝えること」の節を設けると、同じ内容の写しに
                  なる（派生ビューは置かない）。
             右 … 書き留めたことと、場面。メモ・いつもの通院・薬を
                  確認するとき。

           面の頭は左右で揃える。手帳を開いたとき、上段に
           「左＝本人が誰か／右＝その人について書き留めたこと」の帯が
           1本通り、その下から左は医療状態、右は場面2節へ続く。
           またがる1つの欄にはしない――綴じ目（ノド）に枠は引けない
           ので、左右それぞれが自分の面に頭を持ち、高さだけを揃える。
           段組みは area.css の subgrid が持つ（.sf-head と .rmemo が
           段1、.sf-rest と .bk-rest が段2）。

           メモを左面へ置かないのは、左面が「場面によらず変わらない
           事実」の面だから。自由記述は事実の記入欄ではないので、
           格の並び（一等→二等）の末尾にぶら下げると、格の違うものが
           一番下に付く形になる。

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
            /* 段1。左の識別欄と頭・尻が揃う。 */
            memoBlock() +
            '<div class="bk-rest">' +
              /* いつもの通院。日常の側。かかりつけ薬局は「薬を確認する
                 ところ」に一本化したので、ここには持たない。 */
              scene('visit', 'いつもの通院', 'かかっている先の連絡先です。',
                clinicsBlock(), 'sc-visit') +
              /* 薬を確認するところ。複数の入口への案内。 */
              scene('medsrc', '薬を確認するとき', '最新の薬の情報への入口です。',
                medSourcesBlock(), 'sc-medsrc') +
            '</div>' +
          '</div>' +
        '</div>' +
        '</div>' +
      '</div>';
  }

  /* ══ 介護｜連絡ボード ═════════════════════════════════
     造形の正本は `prototype/assets/介護イメージ.png`。木の額縁に、
     真鍮ネジで留めた乳白のプレートが貼ってあるボード。iPhone フレーム
     と同じ密度で、額・面取り・ダボ・プレート・ネジを層として重ねる
     （CLAUDE.md）。div＋border-radius＋グラデで代用しない。         */

  /* ボードの器。額縁は「木の枠」という1つの物なので、輪郭・木目・
     合口・面取り・背板・ダボを **1枚の SVG** の層として重ねる
     （CLAUDE.md の iPhone フレームと同じ組み方）。div＋border-radius＋
     グラデでは、額の見附に厚みが出ず、板が手前に浮いて見える。

     寸法は正本 `介護イメージ.png` の実測から引く
     （`assets/care-board-motifs.RESEARCH.md`）：
       ・見附＝ボード幅の 2.9%（実測 36/1223）
       ・面取り＝見附のおよそ 1/4.5（実測 8px）
     木目の明暗は実測 Δ78（R=153〜231）。従来の Δ3 の縞では平板だった。

     引き伸ばしに耐えるよう、額は `preserveAspectRatio="none"` の
     引き伸ばす層（木地・背板）と、比率を保つ層（ダボ・合口）に
     分ける――ダボを一緒に引き伸ばすと楕円に化ける。               */

  /* 柾目。幅と濃度の違う縦筋を不等間隔に置く。等間隔の縞は布に見える
     ので、素数寄りの間隔でずらして「木」にする。座標は乱数ではなく
     固定（再描画でちらつかせない）。                                */
  const WOOD_GRAIN = (() => {
    const seeds = [
      [1.5, 1.0, .10], [4.2, 0.6, .06], [7.0, 1.6, .13], [9.3, 0.5, .05],
      [12.8, 1.1, .09], [15.1, 0.7, .07], [18.6, 1.9, .12], [21.4, 0.6, .05],
      [24.9, 1.3, .10], [27.2, 0.8, .06], [30.7, 1.7, .13], [33.5, 0.5, .05],
      [36.9, 1.2, .09], [39.8, 0.9, .07], [43.1, 1.5, .11], [46.0, 0.6, .05],
      [49.4, 1.8, .12], [52.3, 0.7, .06], [55.8, 1.1, .09], [58.6, 1.4, .10],
      [62.0, 0.6, .05], [64.9, 1.6, .12], [68.2, 0.9, .07], [71.5, 1.2, .09],
      [74.8, 1.9, .13], [77.6, 0.5, .05], [81.0, 1.3, .10], [84.2, 0.8, .06],
      [87.7, 1.5, .11], [90.5, 0.7, .06], [93.9, 1.7, .12], [96.8, 1.0, .08]
    ];
    return seeds.map(([x, w, o]) =>
      '<rect x="' + x + '" y="0" width="' + w + '" height="100" ' +
      'fill="#6b4426" fill-opacity="' + o + '"/>').join('');
  })();

  function careBoardFrame() {
    /* 実測由来（RESEARCH.md）。見附＝2.9%、面取り＝見附の約1/4.5。
       ★桟は「1枚の正方 viewBox を額の形へ引き伸ばす」形をやめた
       （2026-09-11）。preserveAspectRatio="none" で縦に伸ばすと、
       上下桟だけが額の高さに比例して太り（実測：1400px 幅で 36px、
       900px で 45.6px、375px で 80px）、幅基準の --rail で組んだ
       padding・ダボ位置と食い違って、木札が桟に潜っていた。
       現実の額縁は四辺とも同じ材＝同じ太さなので、造形としても
       こちらが正しい。上下と左右を別レイヤーにし、それぞれ長手の
       1方向だけ引き伸ばす（太さは CSS の --rail が持つ）。       */
    /* ダボ（木の留め具）。桟の中央、四隅に。真円を保つため別レイヤー。 */
    const peg = (cls) => '<span class="cbf-peg ' + cls + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="10.5" fill="#c69a63"/>' +
        '<circle cx="12" cy="12" r="10.5" fill="none" stroke="#7d5a35" ' +
          'stroke-opacity=".5"/>' +
        '<circle cx="9.2" cy="9.2" r="3.6" fill="#f0dab4" fill-opacity=".7"/>' +
        '<circle cx="12" cy="12" r="10.5" fill="none" stroke="#000" ' +
          'stroke-opacity=".10" stroke-width="1.6"/>' +
      '</svg></span>';

    /* 共有の塗り。同じ id を何枚もの svg で参照できないので、defs は
       各レイヤーが自前で持つ（描画コストより取り違えの無さを採る）。 */
    const defs =
      '<defs>' +
        /* 木地の地色。実測 #d9ac81 / #ce945f を明暗に振る。 */
        '<linearGradient id="cbfWood" x1="0" y1="0" x2="0.7" y2="1">' +
          '<stop offset="0" stop-color="#e3b98d"/>' +
          '<stop offset=".45" stop-color="#ce945f"/>' +
          '<stop offset="1" stop-color="#dbab7a"/>' +
        '</linearGradient>' +
      '</defs>';

    /* ① 背板＋額が落とす内影。額の口いっぱいに敷く1枚。 */
    const board =
      '<svg class="cbf-board" viewBox="0 0 100 100" preserveAspectRatio="none">' +
        '<defs>' +
          /* 背板。桟より暗い下地。プレートのすき間で実測した #a06b3c
             （額の木地 #ce945f より一段沈む＝板が奥にある）。 */
          '<linearGradient id="cbfBoard" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#9a6537"/>' +
            '<stop offset=".5" stop-color="#a06b3c"/>' +
            '<stop offset="1" stop-color="#986338"/>' +
          '</linearGradient>' +
          /* 額が背板へ落とす内影。上と左を濃く（光は左上から）。 */
          '<linearGradient id="cbfDropT" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#3d2712" stop-opacity=".38"/>' +
            '<stop offset="1" stop-color="#3d2712" stop-opacity="0"/>' +
          '</linearGradient>' +
          '<linearGradient id="cbfDropL" x1="0" y1="0" x2="1" y2="0">' +
            '<stop offset="0" stop-color="#3d2712" stop-opacity=".26"/>' +
            '<stop offset="1" stop-color="#3d2712" stop-opacity="0"/>' +
          '</linearGradient>' +
        '</defs>' +
        '<rect x="0" y="0" width="100" height="100" fill="url(#cbfBoard)"/>' +
        '<rect x="0" y="0" width="100" height="9" fill="url(#cbfDropT)"/>' +
        '<rect x="0" y="0" width="6" height="100" fill="url(#cbfDropL)"/>' +
      '</svg>';

    /* ② 桟。長手方向にだけ引き伸ばす帯＝太さは CSS の --rail が持つ。
       木目は帯の中で長手に走る（材の木理と同じ向き）。上下は横桟、
       左右は縦桟。viewBox は「長手 100 × 太さ 10」に閉じる。      */
    const railH =                                   /* 上桟・下桟（横） */
      '<svg class="cbf-rail cbf-rail-h" viewBox="0 0 100 10" ' +
        'preserveAspectRatio="none">' + defs +
        '<rect x="0" y="0" width="100" height="10" fill="url(#cbfWood)"/>' +
        /* 木目：100×100 の筋を 90°回して長手へ走らせ、帯の太さへ潰す。 */
        '<g transform="translate(100 0) rotate(90) scale(.1 1)">' +
          WOOD_GRAIN + '</g>' +
      '</svg>';
    const railV =                                   /* 左桟・右桟（縦） */
      '<svg class="cbf-rail cbf-rail-v" viewBox="0 0 10 100" ' +
        'preserveAspectRatio="none">' + defs +
        '<rect x="0" y="0" width="10" height="100" fill="url(#cbfWood)"/>' +
        '<g transform="scale(.1 1)">' + WOOD_GRAIN + '</g>' +
      '</svg>';

    /* ③ 隅の合口（45°）＝留め接ぎの線。桟の角の正方（--rail 角）に
       1本ずつ引く。4隅とも同じ絵を回して使う。 */
    const miter =
      '<svg class="cbf-miter" viewBox="0 0 10 10">' +
        '<path d="M0 0 10 10" stroke="#6f5030" stroke-opacity=".42" ' +
          'stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/>' +
      '</svg>';

    return '<div class="care-board-frame" aria-hidden="true">' +
      board +
      '<span class="cbf-r cbf-r-t">' + railH + '</span>' +
      '<span class="cbf-r cbf-r-b">' + railH + '</span>' +
      '<span class="cbf-r cbf-r-l">' + railV + '</span>' +
      '<span class="cbf-r cbf-r-r">' + railV + '</span>' +
      '<span class="cbf-m cbf-m-tl">' + miter + '</span>' +
      '<span class="cbf-m cbf-m-tr">' + miter + '</span>' +
      '<span class="cbf-m cbf-m-br">' + miter + '</span>' +
      '<span class="cbf-m cbf-m-bl">' + miter + '</span>' +
      /* ④ 面取り＝額の内外の稜線。外周のハイライトと、額の口が背板へ
         落ちる稜線（手前の光→奥の陰）。CSS の枠線1本ずつで持つ
         （どの辺も同じ 1px＝物の稜線は太らない）。 */
      '<span class="cbf-edge cbf-edge-out"></span>' +
      '<span class="cbf-edge cbf-edge-lip"></span>' +
      '<span class="cbf-edge cbf-edge-in"></span>' +
      peg('cbf-peg-tl') + peg('cbf-peg-tr') +
      peg('cbf-peg-bl') + peg('cbf-peg-br') +
      '</div>';
  }

  /* ══ 上部の木札 ═══════════════════════════════════════
     介護度と主な相談先は、下のプレート（乳白の樹脂板＋真鍮ネジ）より
     一段軽い格に置く。ただし「軽い」は「装飾なし」ではない――背板に
     文字が直に乗ることは実物では起きないので、物として札を留める。

     材は**額縁と同じ木**（額の桟と同じ WOOD_GRAIN の柾目を使う）。
     同じ材から切り出した札なので画風が必ず揃い、幅の伸び縮みにも
     額縁と同じ理屈で耐える。外部のクリップアート（Openclipart の
     木札4点）は素朴派の看板で、明るいオークの直線的な柾目という
     この板の register と合わなかった（RESEARCH.md に採否を記録）。

     プレートとの格の差は3点で出す：
       ・厚み … プレートは落ち影が大きい。札は板に沈む（彫り込み）
       ・留め … プレートは真鍮ネジ4本。札はネジ無しで面が接している
       ・面   … プレートは乳白で下地を隠す。札は木地のまま
     文字は彫り込み＝内側に影が落ち、下辺に光が返る。               */
  /* 札の柾目。板は横に伸びるので、筋は**長手＝左右**に走る。
     筋の太さは vector-effect="non-scaling-stroke" で実 px に固定する
     ――こうすると札が何px幅になっても筋は 1px 前後のままで、
     引き伸ばしても色ムラに化けない（額の桟の筋との違いはここ）。
     y は札の高さに対する割合。木は等間隔に木理を持たないので、
     間隔・濃さ・太さを不揃いにする。座標は固定（再描画でちらつかせない）。 */
  const CWS_GRAIN = (() => {
    /* 濃さは実測 Δ78 に合わせる（care-board-motifs.RESEARCH.md §1）。
       .05〜.13 で置くと Δ5 にしかならず色帯に見える――額の桟で一度
       通った失敗。逆に等間隔で濃く並べると、今度は木ではなく
       ルーバー（羽板）に見える。木理は**寄る所と空く所がある**ので、
       間隔を 3〜11 の幅で散らし、筋ごとに始点・終点を変えて
       途中で消えるようにする（x0/x1）。
       [y, 太さ, 濃さ, 明るい筋か, x0, x1] */
    const seeds = [
      [ 6, .8, .30, 0,   0, 78], [ 9, .5, .16, 1,  12, 100],
      [17, 1.2, .40, 0,   0, 100], [20, .5, .14, 1,  34, 92],
      [30, .7, .24, 0,   8, 100], [33, .6, .18, 1,   0, 61],
      [41, 1.4, .46, 0,   0, 100], [45, .6, .20, 1,  20, 100],
      [55, .9, .30, 0,   0, 88], [58, .5, .14, 1,  46, 100],
      [67, 1.1, .38, 0,   0, 100], [70, .6, .18, 1,   0, 53],
      [79, .8, .26, 0,  16, 100], [83, .5, .16, 1,   0, 72],
      [92, 1.0, .34, 0,   0, 100]
    ];
    return '<g fill="none" stroke-linecap="round">' +
      seeds.map(([y, w, o, light, x0, x1]) =>
        '<path d="M' + x0 + ' ' + y + 'H' + x1 + '" stroke="' +
        (light ? '#f6dcba' : '#6b4426') +
        '" stroke-width="' + w + '" stroke-opacity="' + o + '" ' +
        'vector-effect="non-scaling-stroke"/>').join('') +
      '</g>';
  })();

  function careWoodSlat() {
    /* 札は横に伸びるので、木地と柾目は preserveAspectRatio="none" で
       引き伸ばす（額の桟と同じ扱い）。彫り込みの稜線は太さを保つため
       vector-effect="non-scaling-stroke"。 */
    return '<span class="cws" aria-hidden="true">' +
      '<svg class="cws-svg" viewBox="0 0 100 100" preserveAspectRatio="none">' +
        '<defs>' +
          /* 額の桟より一段明るい木地。同じ材の、削って新しい面。
             上から下へ光が回る（札は板に伏せて置かれている）。 */
          '<linearGradient id="cwsWood" x1="0" y1="0" x2="0.15" y2="1">' +
            '<stop offset="0" stop-color="#e9c49c"/>' +
            '<stop offset=".55" stop-color="#d7a26c"/>' +
            '<stop offset="1" stop-color="#c68f5c"/>' +
          '</linearGradient>' +
        '</defs>' +
        '<rect x="0" y="0" width="100" height="100" fill="url(#cwsWood)"/>' +
        /* 柾目。札は横長なので筋は長手＝左右に走る（額の横桟と同じ）。
           ★額の WOOD_GRAIN をそのまま流用しない――あれは幅 34px の桟
           向けの筋幅（0.5〜1.9 / 100）で、900px の札に引き伸ばすと
           1本が 5〜17px の帯になって「木目」ではなく色ムラに見える。
           札は札の実寸で筋を持つ（下の CWS_GRAIN）。 */
        CWS_GRAIN +
        /* 縁の面取り。上辺に光、下辺に陰――板に伏せて置かれた札。 */
        '<g vector-effect="non-scaling-stroke" fill="none">' +
          '<path d="M0 .5H100" stroke="#f6e0bd" stroke-opacity=".7"/>' +
          '<path d="M0 99.5H100" stroke="#7d5027" stroke-opacity=".45"/>' +
        '</g>' +
      '</svg>' +
      /* 彫り込んだ平面（字を彫る面）。実物の彫り看板と同じで、字の下だけ
         木を削って平らにする――木目が字を横切らなくなるので、木の札の
         まま可読性が出る（文字の影で誤魔化さない）。

         ★別レイヤーにする理由：上の SVG は preserveAspectRatio="none"
         で引き伸ばすので、彫り面の角丸と削り口の稜線を同じ SVG に置くと
         幅が広いとき角丸が寝て「潰れた楕円」になる。彫り面は CSS の
         box で置き、稜線は border で持たせる（太さが実 px で固定される）。
         木目を弱めるのはこの面の内側だけ（.cws-plane の地）。       */
      '<span class="cws-plane" aria-hidden="true"></span>' +
      '</span>';
  }

  /* 乳白プレートを背板へ留める真鍮ネジ。円＋マイナスの切り込み。
     切り込みの向きは左右で対にする（実物のネジは向きが揃わない）。 */
  function careScrews(wide) {
    const s = (cls, rot) => '<span class="cp-screw ' + cls + '">' +
      '<svg viewBox="0 0 16 16" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="7" fill="#c99a5e"/>' +
        '<circle cx="8" cy="8" r="7" fill="none" stroke="#7d5a33" ' +
          'stroke-opacity=".7"/>' +
        '<circle cx="6.2" cy="6.2" r="2.6" fill="#f2ddb6" fill-opacity=".8"/>' +
        '<path d="M3.6 8h8.8" stroke="#6d5233" stroke-opacity=".85" ' +
          'stroke-width="1.5" stroke-linecap="round" ' +
          'transform="rotate(' + rot + ' 8 8)"/>' +
      '</svg></span>';
    return '<span class="cp-screws">' +
      s('cp-sc-tl', 28) + s('cp-sc-tr', -34) +
      (wide ? s('cp-sc-bl', -22) + s('cp-sc-br', 40) : '') +
      '</span>';
  }

  /* 節（プレート1枚）。医療と同じく番号は振らない。見出しは白チップ＋
     緑線グリフ（headChip、契約デジタル／医療右面と同じ手つき）。
     一言（lead）は付けない――README のとおり素っ気なくする。
     opt.noEdit … プレートの中に性質の違う複数節を持ち、鉛筆を節ごと
     （careSubHead）に持たせるとき、プレート本体の鉛筆は省く。
     opt.noHead … プレート見出し（.cp-h）そのものを出さない。「今の支援」
     はプレートの器（白い地・ネジ・落ち影）は要るが、中身がカレンダー
     1枚＋絵札で、その頭書き（.wcal-lead）が見出しを兼ねるので、プレート
     見出しは二重になる（2026-09-10：文字と ❤️ だけ落とす。器は残す）。 */
  function carePlate(key, glyph, title, body, opt) {
    const o = opt || {};
    return '<section class="cp' + (o.cls ? ' ' + o.cls : '') +
        (o.noHead ? ' cp-nohead' : '') + '">' +
      careScrews(!!o.wide) +
      (o.noHead ? ''
        : '<div class="cp-h">' + headChip(glyph) +
            '<h5>' + esc(title) + '</h5>' +
            (o.noEdit ? '' : editBtn(key)) + '</div>') +
      '<div class="cp-body">' + body + '</div></section>';
  }

  /* ══ 上部の帯｜介護度と主な相談先 ═══════════════════
     どちらも「今どうなっているか」の見出しで、家族が読んで何かする
     ものではない（介護度は制度上の区分、相談先は書いた時点で辿れる
     連絡先）。下の「今の支援」が主役なので、格を一段下げて1本の帯に
     まとめる。左右は同じ木札の上に並ぶので、背丈は必ず揃う。

     ★「薄く」は**格**の話であって**行数**の話ではない（2026-09-09）。
     1行に押し込んだ結果、介護度も相談先も 11〜13px に潰れ、右側が
     「介護の主な相談先 山田 花子 ○○居宅介護支援事業所 045-… サイト」
     という切れ目のない一続きの文字列になって、両方とも読めず二者の
     区別も付かなくなっていた。札は1枚のまま、中で格を分ける：

       ・介護度 … ラベル（小）＋値（大）。彫り面の左に置く
       ・相談先 … ラベル（小）＋名前・電話（中）。彫り面の右
       ・境目   … 彫り込んだ縦の区切り（物として溝を1本入れる）

     どちらもラベルを値の上に置くので、値だけを拾い読みできる。   */

  /* ⓘ ＝ 要介護度の説明への入口。押すとガイドが開く。値そのものでは
     なく「この区分は何か」を開くので、鉛筆（編集）とは別の記号。   */
  const INFO_IC =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" ' +
        'stroke-width="1.3"/>' +
      '<circle cx="8" cy="5" r="1" fill="currentColor"/>' +
      '<path d="M8 7.4v4.2" stroke="currentColor" stroke-width="1.5" ' +
        'stroke-linecap="round"/>' +
    '</svg>';

  /* ① 介護認定。要介護度は制度上の区分（正本 §9）。認定の有無だけを
     状態として持つ。帯の左に、彫り込んだ文字として置く。 */
  function levelBlock() {
    const c = S.data.care;
    const certified = S.isCertified(c.level);
    if (isOpen('care.level')) {
      return '<div class="cws-item cws-level cl-edit">' +
        '<span class="cws-lb">介護認定</span>' +
        evSelect('care.level', c.level, S.CARE_LEVELS) + '</div>';
    }
    return '<div class="cws-item cws-level">' +
      '<span class="cws-lb">介護認定' +
        /* ⓘ は要介護度という区分の説明。いまは title 属性まで――
           用語解説の器（モーダル／ポップオーバー）は介護にまだ無く、
           医療の「治療中の病気」モーダルは領域内で完結させたものなので
           機械的に持ち出さない（正本 §13）。器を作るときに差し替える。 */
        '<span class="cws-info" title="' + esc(S.levelAbout(c.level)) + '" ' +
          'role="img" aria-label="' + esc(S.levelAbout(c.level)) + '">' +
          INFO_IC + '</span>' +
      '</span>' +
      '<button type="button" class="cws-lv' + (certified ? '' : ' cws-lv-off') + '" ' +
        'data-edit="care.level" data-kind="select">' +
        esc(c.level || '未確認') +
      '</button>' +
      '</div>';
  }

  /* ② 主な相談先（担当ケアマネジャー）。介護の入口なので、事業所名・
     担当者名・電話・Web を落とさず出す――階層を下げたのはプレートの
     ネジ・落ち影であって、情報量ではない（2026-09-09 レビュー指摘：
     「本当に名前が主役？事業所名は？」「WEB URLはどこ？」）。
     事業所名を先頭に置く。実際に電話をかける先・検索する先は
     法人としての窓口であり、担当者名はその中の「誰か」を添える
     情報――主従を逆にしていたのを直した。
     Web は医療の通院カード／薬局と同じ扱い（webLabel でドメイン名を
     出す。「サイト」だけの抽象リンクにしない）。
     状態バッジは持たない（state.js の manager 参照）。 */
  /* ラベルと値の1行。★横並びの一続きの文字列にしない――正本
     （介護イメージ.png）の相談先も「ケアマネジャー：山田 花子／
     事業所名：○○／電話番号：045-…」の**ラベル列＋値列の表**で、
     だから3つが別々の情報として拾い読みできる。ラベルを固定幅の
     左列に揃えることで、値の頭が縦に揃う（2026-09-09 の直し）。   */
  function mgrRow(lb, val, cls) {
    return '<span class="cws-mgr-row">' +
      '<span class="cws-mgr-lb">' + esc(lb) + '</span>' +
      '<span class="cws-mgr-v' + (cls ? ' ' + cls : '') + '">' + val + '</span>' +
      '</span>';
  }

  function managerBlock() {
    const mg = S.data.care.manager || {};
    const on = isOpen('care.manager');
    const web = String(mg.web || '').trim();
    /* 2グループ：左＝どこの・誰（事業所／担当）、右＝連絡手段（電話／Web）
       （2026-09-10 ユーザー指示）。各グループが自前のラベル列＋値列を持ち、
       グループ内で値の頭が縦に揃う。グループ間の間隔は .cws-mgr-tb の
       column-gap ひとつで決める（ラベル→値の詰まりと混ざらない）。 */
    const webVal = on
      ? '<span class="cws-web">' +
          evWeb('care.manager.web', mg.web) + '</span>'
      : (web
        ? '<a class="cws-web" href="' + esc(web) + '" target="_blank" ' +
            'rel="noopener">' + esc(webLabel(web)) + EXT + '</a>'
        : '');
    const groupWho = '<div class="cws-mgr-grp">' +
      mgrRow('事業所', ev('care.manager.office', mg.office, 'line', '事業所名'),
        'cws-mgr-office') +
      mgrRow('担当', ev('care.manager.name', mg.name, 'line', '担当者名')) +
      '</div>';
    /* 電話の受話器アイコンは閲覧時だけ――番号に寄り添って「これは
       電話番号」と伝える。編集時は入力欄の頭を事業所・担当と揃えたい
       ので出さない（2026-09-10 ユーザー指示）。 */
    const telVal = on
      ? ev('care.manager.tel', mg.tel, 'line', '電話番号')
      : '<span class="cws-tel">' + TEL +
          ev('care.manager.tel', mg.tel, 'line', '電話番号') + '</span>';
    const groupHow = '<div class="cws-mgr-grp">' +
      mgrRow('電話', telVal) +
      (on || web ? mgrRow('Web', webVal) : '') +
      '</div>';
    return '<div class="cws-item cws-mgr">' +
      '<span class="cws-lb">介護の主な相談先</span>' +
      '<div class="cws-mgr-tb">' + groupWho + groupHow + '</div>' +
      '</div>';
  }

  /* 帯そのもの。1枚の木札に彫り込んだ平面を持ち、その上に介護度と
     相談先を置く。二者の間は彫り込んだ溝（.cws-groove）で仕切る
     ――区切り線を CSS の border で引くのではなく、木を彫った溝と
     して持たせる（陰＋削り口の光の2本）。鉛筆は札の外の右端。   */
  function careTopSlat() {
    return '<div class="cws-band">' +
      careWoodSlat() +
      '<div class="cws-inner">' +
        levelBlock() +
        '<span class="cws-groove" aria-hidden="true"></span>' +
        managerBlock() +
        editBtn('manager') +
      '</div>' +
      '</div>';
  }

  /* ══ 今の支援 ═════════════════════════════════════════
     1つのプレートの中に性質の違う2節を持つ（正本 §13-1 の割り付け
     とは別に、2026-09-09 のレイアウト検討で決めた新しい割り付け）。

       上＝暮らしの時間に入る支援 … 訪問・デイ・配食など、曜日と
           時間を持つもの。造形は卸しカレンダーの1週分
       下＝継続して使っている支援 … ベッド・歩行器などの福祉用具。
           曜日を持たない・ずっと家にある。造形は物の絵札

     どちらも「今の支援」という1枚のプレートの中の節なので、プレート
     本体（.cp／ネジ／彫りの格）は1つ。

     ★上節「暮らしの時間に入る支援」の見出しは、プレート地の上に浮かせず
     **カレンダー台紙の紙面の中**へ、その1ページ目の頭書きとして取り込む
     （2026-09-10 認識合わせ）。リング＋綴じ帯 → 紙面の頭書き（時計チップ
     ＋見出し＋補足文）→ 列見出し → 各行、の順。見出しはカレンダーが持つ
     （weekCalendarLead）ので、ここでは careSubHead を呼ばない。
     過去に「プレート地に直接置く／綴じ帯に文言を入れる／文字を出さない」
     の3案を ?subhead= で見比べたが（plain/band/bare）、いずれも見出しが
     カレンダーの部品に見えるか浮くかで、全部捨てた。

     下節「継続して使っている支援」（絵札）は今回保留。従来どおり
     careSubHead（csh-plain：太字＋間隔）を使う。                    */

  /* 小見出し＋鉛筆。いまは equipment 節だけが使う。 */
  function careSubHead(key, title) {
    return '<div class="cp-sub-h csh-plain">' +
      '<h6>' + esc(title) + '</h6>' +
      editBtn(key) +
      '</div>';
  }

  /* 曜日の読み取り。use の自由文（「月・木 午前」「毎日 夕方」等）
     から、その支援がどの曜日に入るかを**読み取るだけ**――管理項目
     ではないので data には残さない（2026-09-09 ユーザー明言：
     「本当に曜日ごとに管理したいというより、デザインとしての描写
     目的」）。書き方が揺れて拾えない行は空配列を返し、帯には何も
     打たない（推測で打つと書いた文字と絵が食い違う）。            */
  /* ★曜日は days が持つ実データ（2026-09-09 ユーザー判断）。use の自由文
     から読み取る方式（旧 weekdaysOf）は撤去した――編集中に点を押して
     入切できるようにしたので、読み取りでは辻褄が合わない。         */
  const WEEKDAY_CHARS = ['月', '火', '水', '木', '金', '土', '日'];
  function daysOf(sv) {
    return Array.isArray(sv && sv.days) ? sv.days : [];
  }

  /* 卸しカレンダーの1週分。造形は「上の紙をめくって留めるリング＋
     台紙＋ミシン目で切り離す1週分」。

     ★曜日の点は**描写**であって管理項目ではない（2026-09-09 ユーザー
     明言）。だから点だけを出して中身を編集モードの奥に置くと、この節
     には読むものが何も無くなる――家族が必要とするのは「訪問介護がどこ
     で、いつ、何番か」であって、月曜に点があることではない（§13-1）。
     行そのものが事業所・利用状況・連絡先を持ち、曜日の帯はその行の
     右に添う。カレンダーは表現であって、シフト表ではない
     （2026-09-09 ユーザー判断）。

     読み取れた曜日が1つも無い行は点を打たない。空欄と「該当なし」を
     同じにしない正本 §11 と同じ理屈で、「曜日が無い」と「曜日を書いて
     いない／読めない」を区別する――利用状況の自由文は行に出るので、
     点が無くても家族は use の文字を読める。                        */
  /* ══ 1週分の表 ═══════════════════════════════════════
     ★2026-09-09：骨格を作り直した（ユーザー判断）。

     それまでは「左＝文章の塊／右＝7列の表」で、行の中に**設計の違う
     2つの領域が同居**していた。左はカード風に積み、右は表の列として
     振る舞う――その境目に置いた要素（時間帯・Web）が必ず宙に浮き、
     置き場所を何度動かしても直らなかった。事業所|電話 のあとに Web が
     折り返して落ちていたのも、設計ではなく「入りきらなかった結果」。

     **全体を1枚の表にする。** 各項目が列を持ち、編集はその列のセルに
     直接書く。表示と編集で構造が変わらないので、時間帯が浮く・Web が
     折り返す、といった事故が起きる場所そのものが無くなる。
     正本 `介護イメージ.png` も4列の表（種類／事業所／利用状況／連絡先）
     で、途中でこれを捨てて「行＝カード」に作り変えたのが誤りだった。

     列： 支援（絵＋名前＋内容）／連絡先／曜日7列／時間帯               */

  /* 連絡先セルのレイアウト案。★ここは横並びだと3つ目（Web）が必ず
     溢れる場所なので、複数パターンを実際に並べて選ぶ（?contact=）。
       'stack' … 事業所／電話／Web を縦に積む
       'link'  … 事業所名自体をリンクにし、電話だけ添える（2行）
       'split' … 事業所名の下に、電話とWebを横に並べる              */
  const CARE_CONTACT_VARIANT = (function () {
    try {
      const q = new URLSearchParams(location.search).get('contact');
      if (q === 'stack' || q === 'link' || q === 'split') return q;
    } catch (e) { /* file:// などで URL が読めなくても既定へ倒す */ }
    /* link ＝ 事業所名自体をリンクにする案で確定（2026-09-09 ユーザー
       判断）。URL の文字列は家族が読んで判断する情報ではなく、押せれば
       足りる。1段減るので、Web を持つ行と持たない行で高さが揃う。   */
    return 'link';
  })();

  const telHref = t => 'tel:' + String(t).replace(/[^0-9+]/g, '');

  /* 連絡先セル（表示）。案ごとに組み方だけが変わる。 */
  function contactCell(sv) {
    const v = CARE_CONTACT_VARIANT;
    const tel = sv.tel
      ? '<a class="wc-tel" href="' + esc(telHref(sv.tel)) + '">' + TEL +
          esc(sv.tel) + '</a>'
      : '';
    if (v === 'link') {
      /* 事業所名そのものをリンクにする。URL の文字列は出さない。 */
      const name = sv.provider
        ? (sv.web
          ? '<a class="wc-prov wc-prov-link" href="' + esc(sv.web) +
              '" target="_blank" rel="noopener">' + esc(sv.provider) + EXT + '</a>'
          : '<span class="wc-prov">' + esc(sv.provider) + '</span>')
        : '';
      return name + tel;
    }
    const name = sv.provider
      ? '<span class="wc-prov">' + esc(sv.provider) + '</span>' : '';
    const web = sv.web
      ? '<a class="wc-web" href="' + esc(sv.web) + '" target="_blank" ' +
          'rel="noopener">' + esc(webLabel(sv.web)) + EXT + '</a>'
      : '';
    if (v === 'split') {
      /* 事業所名の下に、電話とWebを横に並べる（2段）。 */
      return name +
        ((tel || web) ? '<span class="wc-line">' + tel + web + '</span>' : '');
    }
    /* stack ＝ 3つを縦に積む。折り返し事故が構造的に起きない。 */
    return name + tel + web;
  }

  /* 連絡先セル（編集）。表示と同じ順序で、セルの中に欄を縦に置く。 */
  function contactCellEdit(sv, p) {
    return '<span class="wc-ef">' +
      efLine('事業所', p + 'provider', sv.provider, '例：○○ケアサービス') +
      efLine('電話', p + 'tel', sv.tel, '例：045-111-2222') +
      '<label class="wc-ef-l"><span class="wc-ef-lb">Web</span>' +
        evWeb(p + 'web', sv.web) + '</label>' +
      '</span>';
  }

  /* セルの中の1欄。★ラベルは必ず持たせる――placeholder は入力すると
     消えるので、書いたあとに何の欄か分からなくなる（2026-09-09 指摘）。
     ラベルは小さく上に置き、セルの列幅を食わないようにする。       */
  function efLine(lb, path, value, ph) {
    return '<label class="wc-ef-l">' +
      '<span class="wc-ef-lb">' + esc(lb) + '</span>' +
      ev(path, value, 'line', ph) +
      '</label>';
  }

  function weekCalendar(list) {
    /* 編集中かどうかは表そのものが持つ（下に別の表を出さない）。 */
    const on = secOn('service');
    const rows = list.map(sv => ({
      sv: sv, kind: S.serviceKind(sv.kind), days: daysOf(sv)
    }));
    /* 紙の上端の帯（綴じ側）。リングが貫く濃色の帯で、中身は持たない。 */
    const band = '<div class="wcal-band">' + weekCalendarHeadPlate() + '</div>';
    /* 紙面の頭書き。節「暮らしの時間に入る支援」の見出しを、カレンダー
       台紙の1ページ目の頭書きとして紙の面に置く（2026-09-10）。
       時計チップ＋見出し＋補足文＋鉛筆。列見出しはこの下に来る。 */
    const lead = '<div class="wcal-lead">' +
      '<span class="wcal-lead-ic" aria-hidden="true">' +
        svgIc(CARE_CLOCK_IC, 22) + '</span>' +
      '<span class="wcal-lead-tx">' +
        '<span class="wcal-lead-tt">暮らしの時間に入る支援</span>' +
        '<span class="wcal-lead-nt">人が来る・出かける・サービスを受けるなど、' +
          '予定が決まっている支援です。</span>' +
      '</span>' +
      editBtn('service') +
      '</div>';
    /* 列見出し。★全列に見出しを付ける――1枚の表になったので、
       曜日だけが見出しを持つのは筋が通らない。 */
    const head = '<div class="wcal-head">' +
      '<span class="wc-h wc-h-sv">支援・連絡先</span>' +
      '<span class="wcal-cells">' +
        WEEKDAY_CHARS.map((d, i) =>
          '<span class="wcal-d' + (i > 4 ? ' wcal-d-end' : '') + '">' +
            d + '</span>').join('') +
      '</span>' +
      '<span class="wc-h wc-h-tm">時間帯</span>' +
      '</div>';
    const body = rows.map((r, ri) => {
      const sv = r.sv;
      const p = 'care.services.' + ri + '.';
      /* 曜日のマス。編集中は押して入切できるボタンにする。 */
      const cells = WEEKDAY_CHARS.map((d, i) => {
        const hit = r.days.indexOf(d) > -1;
        /* ★色トークン（--sc）は .c-home 等のクラスが定義する。前は
           .wcal-dot にこのクラスを直接付けていたので点が色を持てたが、
           編集用のボタンへ切り替えたとき .wcal-c 側に残したまま
           ボタン自体には付けておらず、点灯色が出ていなかった
           （2026-09-10 発覚：塗り円が消えて見えた）。ボタンにも
           同じトーンを持たせる。 */
        const cls = 'wcal-c ' + r.kind.tone + (hit ? ' on' : '') +
          (i > 4 ? ' wcal-c-end' : '');
        const dot = hit ? '<span class="wcal-dot"></span>' : '';
        if (!on) return '<span class="' + cls + '" data-d="' + d + '">' + dot + '</span>';
        return '<button type="button" class="' + cls + ' wcal-c-btn" data-d="' + d + '" ' +
          'data-day="' + esc(sv.id) + '|' + d + '" ' +
          'aria-pressed="' + (hit ? 'true' : 'false') + '" ' +
          'title="' + d + '曜日を入切"><span class="i-sr">' + d + '</span>' +
          dot + '</button>';
      }).join('');
      /* ① 支援＝絵・名前・内容。編集中は同じセルの中が欄になる。
         ★分類は**先頭**に置く（2026-09-09 指摘）。行頭の絵と色を決める
         ＝この行が何の支援かを決める設定なので、名前より前に来る。

         ★✕（行削除）はアイコンの**下**に縦に積む（2026-09-10 判断）。
         時間帯の隣など「項目の並び」の中に置くと、その項目と横に並ぶ
         意味が必ず問われる（実際、時間帯の隣にした結果を繰り返し
         指摘された）。アイコンは「この行が何の支援か」を示す唯一の
         固定要素で、行の左端に項目の並びとは別の縦の帯として立って
         いる――削除も「行そのもの」への操作なので、項目の列とは別の
         この帯に、アイコンと縦に積む。どの項目とも並ばないので、
         「なぜこの項目の隣か」という問いが起きない。                */
      const svCell = on
        ? '<div class="wc-sv">' +
            '<span class="wc-sv-rail">' +
              '<span class="wcal-ic ' + r.kind.tone + '">' +
                fillIc(SV_IC[sv.kind] || SV_IC.life, 15) + '</span>' +
              delBtn(sv.id) +
            '</span>' +
            '<span class="wc-sv-ef">' +
              /* ラベルは「分類」だけにする。★「（行頭の絵と色）」まで
                 入れると折り返して2行になり、隣の列と段がずれる
                 （2026-09-09 実測：3つ目の欄で 56px のずれ）。
                 何が変わるかは、選ぶと左の絵が変わるので分かる。 */
              '<label class="wc-ef-l wc-ef-kind">' +
                '<span class="wc-ef-lb">分類</span>' +
                evServiceKind(p + 'kind', sv.kind) +
              '</label>' +
              efLine('名前', p + 'name', sv.name,
                (SV_PH[sv.kind] || SV_PH.life).name) +
              efLine('支援内容', p + 'does', sv.does,
                (SV_PH[sv.kind] || SV_PH.life).does) +
            '</span>' +
          '</div>'
        : '<div class="wc-sv">' +
            '<span class="wcal-ic ' + r.kind.tone + '">' +
              fillIc(SV_IC[sv.kind] || SV_IC.life, 15) + '</span>' +
            '<span class="wc-sv-tx">' +
              '<span class="wcal-name">' + esc(sv.name || '') + '</span>' +
              (sv.does ? '<span class="wcal-does">' + esc(sv.does) + '</span>' : '') +
            '</span>' +
          '</div>';
      /* ② 連絡先 ③ 曜日 ④ 時間帯。 */
      return '<div class="wcal-row' + (on ? ' wcal-row-edit' : '') + '">' +
        '<div class="wc-info">' + svCell +
        '<div class="wc-ct">' +
          (on ? contactCellEdit(sv, p) : contactCell(sv)) +
        '</div></div>' +
        '<span class="wcal-cells">' + cells + '</span>' +
        '<div class="wc-tm">' +
          (on
            ? efLine('時間帯', p + 'use', sv.use, '例：午前（9:00〜12:00頃）')
            : (sv.use ? '<span class="wcal-use">' + esc(sv.use).replace(/([（(].*[）)])$/, '<span class="wcal-use-detail">$1</span>') + '</span>' : '')) +
        '</div>' +
        '</div>';
    }).join('');
    /* リング。参考画像は2本だが、あれは横幅の狭い卓上型。ここは横長
       （780px 級）なので、リング製本らしい間隔で並ぶ本数を置く。
       ★同じリング列を2枚出す――奥の弧だけの器を紙の**下**へ、手前の
       弧だけの器を紙の**上**へ。紙がその間に挟まって「貫いている」に
       なる（1枚では紙の前か後ろかにしか置けない）。CSS が
       .wcal-rings-back / -front でそれぞれ片側だけを出す。         */
    const ringRow = cls => '<span class="wcal-rings ' + cls + '" aria-hidden="true">' +
      Array(9).fill(0).map(() => weekCalendarRing()).join('') +
      '</span>';
    /* 縦の軸。★カレンダーがカレンダーに見えるのは「縦と横に軸があって、
       その交点に印が置かれている」から。線は**見出しから最終行まで貫く
       1枚**として、表（見出し＋行）の裏に敷く――見出しだけ罫が無いと
       表として不自然（2026-09-10 指摘）。 */
    const grid = '<span class="wcal-grid" aria-hidden="true">' +
      /* 列の仕切り。支援｜連絡先｜曜日｜時間帯 の4ブロックを分ける縦罫
         （曜日7列の内側の細罫は .wcal-collines）。 */
      '<span class="wcal-cells wcal-collines">' +
        WEEKDAY_CHARS.map((d, i) =>
          '<span class="wcal-col' + (i > 4 ? ' wcal-col-end' : '') + '"></span>'
        ).join('') +
      '</span>' +
      '</span>';
    return '<div class="wcal' + (on ? ' wcal-edit' : '') + '">' +
      ringRow('wcal-rings-back') +
      weekCalendarFrame() +
      band +
      '<div class="wcal-inner">' +
        lead +
        '<div class="wcal-table">' +
          grid +
          head +
          '<div class="wcal-rows">' + body + '</div>' +
        '</div>' +
      '</div>' +
      ringRow('wcal-rings-front') +
      '</div>';
  }

  /* カレンダーの紙。参考画像（卓上リングカレンダー）から取った要素を
     正面から見た1枚として組む（2026-09-09 ユーザー判断＝B案）。

       ・束ねられた紙 … 右と下に下の紙がのぞく（1枚ではなく束）
       ・見出し帯     … 上部の濃い色の帯。曜日はこの帯の上に乗る
       ・綴じ穴       … 紙に開いた穴。リングはここを貫く
       ・罫のマス     … 予定が乗る場所。罫があるから「マス」になる

     ★前回はここが `rect` 1つに色を塗って下辺に破線を引いただけで、
     CLAUDE.md が禁じている「角丸の矩形に色を敷いただけ」を SVG の中で
     やっていた。紙・帯・穴・罫のどれも無いのだから、カレンダーに
     見えないのは当然だった（2026-09-09 指摘）。

     横に伸びる器なので preserveAspectRatio="none"。**真円・正しい形が
     要るもの（リング）はこの SVG に入れない**――引き伸ばすと楕円に
     なる。額のダボ（cbf-peg）と同じ理屈で CSS レイヤーへ出す。
     穴のほうは紙と一緒に伸びてよい（紙が伸びれば穴も伸びる）。      */
  function weekCalendarFrame() {
    return '<svg class="wcal-svg" viewBox="0 0 100 100" preserveAspectRatio="none" ' +
      'aria-hidden="true">' +
      /* 下に重なる紙。右と下に少しずつずらして束に見せる。 */
      '<rect x="1.4" y="2.6" width="98.6" height="97.4" rx="1.6" fill="#e6dcc4"/>' +
      '<rect x="0.7" y="1.3" width="98.9" height="98.1" rx="1.6" fill="#f0e7d2"/>' +
      /* いちばん上の紙。 */
      '<rect x="0" y="0" width="99.2" height="98.8" rx="1.6" fill="#fdfaf3"/>' +
      '</svg>';
  }

  /* 見出し帯（曜日が乗る濃い色の帯）と綴じ穴。★帯と穴は「紙のどこに
     開いているか」が要るので、紙と同じ器の中に置く必要がある。ただし
     曜日の文字は CSS グリッドで列に揃えるので、SVG が持つのは帯の地と
     穴だけ――文字は wcal-head が持つ。                              */
  function weekCalendarHeadPlate() {
    return '<svg class="wcal-headsvg" viewBox="0 0 100 100" ' +
      'preserveAspectRatio="none" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="wcalBand" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#7d6a45"/>' +
          '<stop offset="1" stop-color="#6a5936"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<rect x="0" y="0" width="100" height="100" fill="url(#wcalBand)"/>' +
      '</svg>';
  }

  /* リング。参考画像のとおり**紙を貫く**――穴の位置で紙の裏に回り、
     手前側だけが見える。前回は紙の上に円を11個置いただけで、綴じられて
     いなかった（左端の4個は文字の無い空白の上に浮いていた）。

     1本のリングは「紙の裏に回る部分（奥）」と「手前に出る部分」の
     2層でできている。紙（.wcal-headsvg）を挟んで前後に置くことで
     貫通に見せる――奥の弧は帯の上端より上に出る部分だけが見える。   */
  function weekCalendarRing() {
    /* viewBox 26×30。輪は縦に長い楕円ではなく**真円に近い輪**で、
       下端が紙に潜る。参考画像のリングは「紙の手前を回って、穴を
       通って裏へ抜ける」――だから手前側の弧のほうが太く明るく、
       奥側は紙の向こうに細く暗く見える。

       ・奥の弧  … 輪の上〜左。紙の裏へ回る側。細く・暗く
       ・手前の弧 … 輪の右〜下。紙の表を通る側。太く・明るく
       2つで1つの輪。紙が間に挟まるので「貫いている」になる。      */
    return '<span class="wcal-ring" aria-hidden="true">' +
      /* 奥＝向こう側。輪の左半分（上から下へ左回り）。紙に潜って終わる。 */
      '<svg class="wcal-ring-b" viewBox="0 0 26 30">' +
        '<path d="M13 5.4 A7.8 7.8 0 0 0 13 21" fill="none" ' +
          'stroke="#7e838c" stroke-width="2.2" stroke-linecap="round"/>' +
      '</svg>' +
      /* 手前＝こちら側。輪の右半分と、紙に開いた**穴**。
         ★穴が要る（Openclipart のスパイラルノートで判明）。穴が無いと、
         輪が紙の上に置かれたフックにしか見えない――綴じ具は「紙に開いた
         穴を通っている」から綴じ具に見える。穴は帯の上に落ちる小さな
         楕円（紙の面に開いた穴なので、正面から見ると横長）。        */
      '<svg class="wcal-ring-f" viewBox="0 0 26 30">' +
        '<ellipse cx="13" cy="20.4" rx="3.4" ry="1.9" fill="#5a4a2c"/>' +
        '<ellipse cx="13" cy="20.1" rx="3.4" ry="1.9" fill="#4a3d24"/>' +
        '<path d="M13 5.4 A7.8 7.8 0 0 1 13 21" fill="none" ' +
          'stroke="#aeb4bd" stroke-width="3" stroke-linecap="round"/>' +
        /* 金属のハイライト（手前の弧の外側に細く乗る）。 */
        '<path d="M14.4 6.6 A6.4 6.4 0 0 1 19.2 13.6" fill="none" ' +
          'stroke="#f2f4f7" stroke-width="1" stroke-linecap="round"/>' +
      '</svg>' +
      '</span>';
  }

  /* 介護で使うもの｜福祉用具のグリフ。

     ★**自作**（2026-09-11）。既製セットは全て不採用――調査の記録は
     `care-board-motifs.RESEARCH.md`。要点：Health Icons（CC0）は塗りの
     シルエットで医療タイルと別系統・網羅も3種、ICOOON MONO は再配布
     禁止（ソースに埋めて Git に入れる＝再配布に当たる）、Tabler は
     均一線の UI アイコンで層が無い。どれも「医療タイルと同じ手つき」で
     は出来ていない――医療タイルはこのプロジェクトのために描かれた
     実物の絵で、汎用アイコンセットとは種類が違う。

     ★手つきは医療の `MEDSRC_ART` から借りる。借りるのは**層の組み立て
     方**であって形そのものではない（正本 §13）：
       ・外形の器を1枚置く（淡い地＋いちばん太い線）
       ・中身を別の層として覗かせる／入れ子にする
         ――ここが「冊子に見える／画面に見える」理由。器だけでは板
       ・接地・支持の層を持つ（台座・脚・キャスター）。無いと宙に浮く
       ・「何の絵か」を決める記号を**1つだけ**載せる
       ・線幅が層の遠近に対応する（手前の外形が太い）

     色は医療の緑を介護の茶へ置き換えたもの（.c-equip の系統）。
     全て viewBox 0 0 48 48、線画（`fill="none"` ではなく面は淡色で
     塗り、線を主にする）。パスが色を自前で持つので `currentColor` は
     使わない――医療タイルと同じ扱い。                                */
  const EQ_L = '#b3823c';   /* 線。いちばん手前の外形 */
  const EQ_B = '#f6eddd';   /* 地。本体の面（＝--sc-bg） */
  const EQ_M = '#eddcc0';   /* 中間。一段手前に出る面（台座・グリップ） */
  const EQ_W = '#fff';      /* 明。別素材（枕・車輪・便座・名札） */
  const EQ_F = '#cfa870';   /* 弱線。罫・穴・スポークなど弱い要素 */
  const EQUIP_IC = {

  /* 介護ベッド｜側面図。マットレス（器）／起き上がったヘッドボード／
     フレームの脚とキャスター／枕（中身）／サイドレール（手前の層）。 */
  bed:
    /* ヘッドボード（奥の層・背あて） */
    '<path d="M7 14h3.5v18H7z" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linejoin="round"/>' +
    /* マットレス本体。頭側が少し上がる。 */
    '<path d="M10.5 22h29a2.5 2.5 0 0 1 2.5 2.5V31H10.5Z" fill="'+EQ_B+'" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linejoin="round"/>' +
    /* 枕（中身の層・マットレスの上に出る） */
    '<rect x="12.5" y="17.5" width="9" height="4.5" rx="2.2" fill="'+EQ_W+'" stroke="'+EQ_L+'" stroke-width="1.4"/>' +
    /* フレーム（マットレスの下の桁） */
    '<path d="M8.5 31h33.5v3H8.5z" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linejoin="round"/>' +
    /* 脚とキャスター */
    '<path d="M12 34v4M39 34v4" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="12" cy="40" r="2.2" fill="'+EQ_W+'" stroke="'+EQ_L+'" stroke-width="1.5"/>' +
    '<circle cx="39" cy="40" r="2.2" fill="'+EQ_W+'" stroke="'+EQ_L+'" stroke-width="1.5"/>' +
    /* フットボード（手前の層・いちばん太い） */
    '<path d="M42 20v12" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M40 20h4.5" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linecap="round"/>',

  /* 車椅子｜側面図。大車輪（手回しリム＋スポーク）／座面と背もたれ／
     アームレスト／フットレスト／前の小車輪。 */
  chair:
    /* 背もたれ（奥の層） */
    '<path d="M17 10h2.5a1.5 1.5 0 0 1 1.5 1.5V26h-4V11.5A1.5 1.5 0 0 1 17 10Z" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linejoin="round"/>' +
    /* 座面 */
    '<path d="M20 24h13v3.5H20z" fill="'+EQ_B+'" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linejoin="round"/>' +
    /* アームレスト（手前の層） */
    '<path d="M21 19h11v2" fill="none" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    /* フットレストへ降りる脚 */
    '<path d="M33 27.5 36 36h4.5" fill="none" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    /* 大車輪（外リム＝手回しリム、内輪、スポーク） */
    '<circle cx="24" cy="33" r="9.5" fill="none" stroke="'+EQ_L+'" stroke-width="1.8"/>' +
    '<circle cx="24" cy="33" r="6.2" fill="'+EQ_B+'" stroke="'+EQ_F+'" stroke-width="1.4"/>' +
    '<path d="M24 26.8v12.4M17.8 33h12.4M19.6 28.6l8.8 8.8M28.4 28.6l-8.8 8.8" stroke="'+EQ_F+'" stroke-width="1.4" stroke-linecap="round"/>' +
    '<circle cx="24" cy="33" r="1.8" fill="'+EQ_L+'"/>' +
    /* 前の小車輪 */
    '<circle cx="39" cy="38.5" r="3" fill="'+EQ_W+'" stroke="'+EQ_L+'" stroke-width="1.6"/>',

  /* 歩行器｜正面図。上の握りバー（手前の層）／左右の縦フレーム／
     中段の補強バー／前脚のキャスターと後脚のゴム脚。 */
  walker:
    /* 握りバー（いちばん手前・太い） */
    '<path d="M12 12h24" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linecap="round"/>' +
    /* 握り（左右のグリップ＝中身の層） */
    '<rect x="9" y="10" width="6" height="4" rx="2" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.5"/>' +
    '<rect x="33" y="10" width="6" height="4" rx="2" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.5"/>' +
    /* 縦フレーム。下へ向けてわずかに開く。 */
    '<path d="M12 14 9.5 36M36 14l2.5 22" fill="none" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linecap="round"/>' +
    /* 中段の補強バー（弱い層） */
    '<path d="M11 23h26M10.3 29.5h27.4" stroke="'+EQ_F+'" stroke-width="1.5" stroke-linecap="round"/>' +
    /* 脚先とキャスター */
    '<path d="M9.5 36v2M38.5 36v2" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="9.5" cy="40" r="2.4" fill="'+EQ_W+'" stroke="'+EQ_L+'" stroke-width="1.5"/>' +
    '<circle cx="38.5" cy="40" r="2.4" fill="'+EQ_W+'" stroke="'+EQ_L+'" stroke-width="1.5"/>',

  /* 杖｜T字（オフセット）型のステッキ。握り（中間色の面）／シャフト／
     ゴム石突き。1本だけなので、握りの曲がりで「杖」を決める。 */
  cane:
    /* 握り。上で前へ折れる（オフセットハンドル） */
    '<path d="M15 10h8.5a3.5 3.5 0 0 1 3.5 3.5V17" fill="none" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    /* 握りのグリップ面（中身の層） */
    '<path d="M13.5 8h7v4h-7a2 2 0 0 1 0-4Z" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.5" stroke-linejoin="round"/>' +
    /* シャフト */
    '<path d="M27 17v19" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linecap="round"/>' +
    /* 高さ調節の穴（弱い層――医療の罫線にあたる） */
    '<circle cx="27" cy="24" r="1" fill="'+EQ_F+'"/>' +
    '<circle cx="27" cy="28" r="1" fill="'+EQ_F+'"/>' +
    /* ゴム石突き */
    '<path d="M24.8 36h4.4l.8 4.5h-6Z" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linejoin="round"/>',

  /* 手すり（工事なし）｜取付座の付いた握りバー、それ単体。
     ★ここは3回作り替えた（CLAUDE.md の検出器に従い、座標いじりでは
     なく毎回**構図から**変えている）：
       1回目 床置きの支柱＋片持ちの横棒 → 「何かの装置」
       2回目 門型＋床の台座          → 「鞄・カート」
       3回目 壁の面に付いたバー       → 「カード・間取り図」
     3回とも敗因は同じで、**環境（床の台座・壁の面）を一緒に描いていた**
     こと。台座も壁も大きな矩形なので、細いバーより先に目に入り、絵の
     主語を奪う。他の9種は「棚に立つ単体の物」なのに、手すりだけ場所を
     描こうとしていた。→ 環境を捨て、物だけにする。
     縦向きにするのは、横一本だと棚の上で「ただの線」になるため
     （立てかけて置かれた縦手すり＝玄関・トイレで実際に多い形）。 */
  rail:
    /* 取付座（上下2枚。中間の層。ビス穴まで描くと「留める物」になる） */
    '<path d="M16 9h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M16 33h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<circle cx="17.5" cy="13" r="1.1" fill="'+EQ_F+'"/><circle cx="30.5" cy="13" r="1.1" fill="'+EQ_F+'"/>' +
    '<circle cx="17.5" cy="37" r="1.1" fill="'+EQ_F+'"/><circle cx="30.5" cy="37" r="1.1" fill="'+EQ_F+'"/>' +
    /* バー（いちばん手前・太い丸棒）。座から座へ通る。 */
    '<path d="M24 15v20" stroke="'+EQ_L+'" stroke-width="1.8"/>' +
    '<path d="M19.6 15h8.8v20h-8.8z" fill="'+EQ_B+'" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linejoin="round"/>' +
    /* 丸棒のハイライト（円筒に見せる層） */
    '<path d="M21.6 17.5v15" stroke="'+EQ_W+'" stroke-width="1.6" stroke-linecap="round"/>' +
    /* 滑り止めの刻み（弱い層） */
    '<path d="M20.4 22h7.2M20.4 25h7.2M20.4 28h7.2" stroke="'+EQ_F+'" stroke-width="1.3" stroke-linecap="round"/>',

  /* スロープ｜段差に架けた板。段（奥の器）／斜めの板（手前の主役）／
     板の滑り止めの溝／下端の接地。 */
  ramp:
    /* 段差（奥の層・器） */
    '<path d="M27 20h14v18H27z" fill="'+EQ_B+'" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M31 24h7M31 28h5" stroke="'+EQ_F+'" stroke-width="1.4" stroke-linecap="round"/>' +
    /* 斜めの板（手前・いちばん太い） */
    '<path d="M6 38 27 18.5l3.2 3.2L11 38Z" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linejoin="round"/>' +
    /* 板の滑り止めの溝（弱い層） */
    '<path d="M13.5 32.6 16.4 35.5M18.5 27.8l2.9 2.9M23.3 23.1l2.9 2.9" stroke="'+EQ_F+'" stroke-width="1.4" stroke-linecap="round"/>' +
    /* 床（接地） */
    '<path d="M5 40.5h37" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linecap="round"/>',

  /* 入浴補助用具｜シャワーチェア。★正面図では背もたれが「左端の板」に
     なって机に見えたので、**側面図**に変えた（同じ絵の別の描き方）。
     横から見ると、背もたれの傾き・座面の奥行き・下へ開く脚が同時に
     出るので椅子として読める。 */
  bath:
    /* 背もたれ（奥の層。少し後ろへ倒れている） */
    '<path d="M12 11h4.5l1.5 13h-4.5z" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linejoin="round"/>' +
    /* 背もたれの抜き（弱い層。樹脂の背あて） */
    '<path d="M13.6 15h3.2M13.9 19h3.2" stroke="'+EQ_F+'" stroke-width="1.4" stroke-linecap="round"/>' +
    /* 座面（手前・太い。側面なので奥行きのある板） */
    '<path d="M13 24h22a1.8 1.8 0 0 1 1.8 1.8v2.4H13Z" fill="'+EQ_B+'" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linejoin="round"/>' +
    /* 座面の水抜き穴（記号の層） */
    '<circle cx="22" cy="26.2" r="1.1" fill="'+EQ_F+'"/>' +
    '<circle cx="27" cy="26.2" r="1.1" fill="'+EQ_F+'"/>' +
    '<circle cx="32" cy="26.2" r="1.1" fill="'+EQ_F+'"/>' +
    /* 肘掛け（手前の層。座面の上に浮かず、後ろの支柱から前へ伸びる） */
    '<path d="M17 17.5h17a1.5 1.5 0 0 1 1.5 1.5v1.5" fill="none" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M35.5 20.5V24" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linecap="round"/>' +
    /* 脚（下へ開く）と高さ調節の穴 */
    '<path d="M16 28.2 14 39M33 28.2l2 10.8" fill="none" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linecap="round"/>' +
    '<circle cx="15.3" cy="33" r="1" fill="'+EQ_F+'"/>' +
    '<circle cx="33.7" cy="33" r="1" fill="'+EQ_F+'"/>' +
    /* ゴム脚 */
    '<path d="M11.8 39h4.4v3h-4.4zM32.8 39h4.4v3h-4.4z" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.5" stroke-linejoin="round"/>',

  /* ポータブルトイレ｜家具調。本体の箱（器）／開いた便座のふた（中身が
     覗く層）／便座の輪／肘掛け。 */
  toilet:
    /* 本体の箱（器） */
    '<path d="M12 24h24v15a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2Z" fill="'+EQ_B+'" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linejoin="round"/>' +
    /* ふた（奥へ開いている＝別の層） */
    '<path d="M15 22V12h18v10" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linejoin="round"/>' +
    /* 便座の輪（中身。ふたの手前に見える） */
    '<ellipse cx="24" cy="23.5" rx="10" ry="3.6" fill="'+EQ_W+'" stroke="'+EQ_L+'" stroke-width="1.6"/>' +
    '<ellipse cx="24" cy="23.7" rx="5.5" ry="1.7" fill="'+EQ_B+'" stroke="'+EQ_F+'" stroke-width="1.3"/>' +
    /* 肘掛け（手前の層） */
    '<path d="M10 27.5h2.5M35.5 27.5H38" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linecap="round"/>' +
    /* 脚 */
    '<path d="M15 41v1.5M33 41v1.5" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linecap="round"/>',

  /* 見守りセンサー｜壁掛けの人感センサー。筐体（器）／レンズ（中身の
     入れ子）／飛ぶ電波の弧（弱い層）／壁の取付板。
     ★抽象記号ではなく「壁に付いた実物」として描く。 */
  sensor:
    /* 取付板（奥の層・壁側） */
    '<path d="M14 11h20a2 2 0 0 1 2 2v3H12v-3a2 2 0 0 1 2-2Z" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.6" stroke-linejoin="round"/>' +
    /* 筐体。下へすぼまる台形（人感センサーの形） */
    '<path d="M12 16h24l-3 12a2 2 0 0 1-2 1.6H17a2 2 0 0 1-2-1.6Z" fill="'+EQ_B+'" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linejoin="round"/>' +
    /* レンズ（入れ子の層） */
    '<circle cx="24" cy="22.5" r="4.2" fill="'+EQ_W+'" stroke="'+EQ_L+'" stroke-width="1.6"/>' +
    '<circle cx="24" cy="22.5" r="1.6" fill="'+EQ_L+'"/>' +
    /* 検知の弧（弱い層・下へ飛ぶ） */
    '<path d="M17.5 33.5a9 9 0 0 0 13 0" fill="none" stroke="'+EQ_F+'" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path d="M14.5 38a14 14 0 0 0 19 0" fill="none" stroke="'+EQ_F+'" stroke-width="1.5" stroke-linecap="round"/>',

  /* その他＝自由入力の受け皿｜名札を下げた箱。何の用具かは文字で
     読ませるので、絵は「まだ名前でしか分からない物」を表す。
     ★車椅子を流用しない（2026-09-11 の指摘）。 */
  other:
    /* 箱（器）。ふたの合わせ目が見える。 */
    '<path d="M10 18h28v20a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2Z" fill="'+EQ_B+'" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linejoin="round"/>' +
    /* ふた（手前の層・箱より張り出す） */
    '<path d="M8 13h32v5H8z" fill="'+EQ_M+'" stroke="'+EQ_L+'" stroke-width="1.8" stroke-linejoin="round"/>' +
    /* 名札（中身の記号。ここに用具名が書かれている、という絵） */
    '<path d="M17 24h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 31 35H17a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 17 24Z" fill="'+EQ_W+'" stroke="'+EQ_L+'" stroke-width="1.5" stroke-linejoin="round"/>' +
    /* 名札の罫線（弱い層） */
    '<path d="M19 28h10M19 31.5h6.5" stroke="'+EQ_F+'" stroke-width="1.4" stroke-linecap="round"/>'
  };
  /* 用具のグリフ。線画（面は淡色、線が主）。パスが色を自前で持つので
     CSS の color には依存しない――医療タイル（MEDSRC_ART）と同じ扱い。
     知らない kind は other（名札の箱）へ落とす。★ここを chair に
     落とさない：専用の絵が無いものを車椅子で代用すると、棚に車椅子が
     並んで「何の絵か」が読めなくなる（2026-09-11 の指摘）。 */
  function equipGlyph(kind) {
    return '<svg class="eqs-glyph" viewBox="0 0 48 48" aria-hidden="true">' +
      (EQUIP_IC[kind] || EQUIP_IC.other) + '</svg>';
  }

  /* 用具を載せる棚板。1枚ずつの持ち送り棚（プランク＋三角の受け）を
     SVG で描く――CLAUDE.md の振り分けでは「矩形＋三角ふたつ、寸法を
     数個決めれば完成する」＝自作可の側。角丸の div に色を敷いた
     カード（旧 .eqc）はやめる（CLAUDE.md：物の輪郭を CSS の矩形で
     代用しない）。材は額縁と同じオーク（.cbf-wood と同系）で、板の
     上面に光・小口に陰、受けの三角にも陰。用具はこの板の上面
     （y≈13）に接地して立つ。板は幅が伸び縮みするので
     preserveAspectRatio="none"、稜線は non-scaling-stroke で実 px 固定。 */
  function careShelf() {
    return '<span class="eqs-plank" aria-hidden="true">' +
      '<svg viewBox="0 0 100 30" preserveAspectRatio="none">' +
        '<defs>' +
          '<linearGradient id="eqsWood" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#e6c096"/>' +
            '<stop offset=".5" stop-color="#d29f68"/>' +
            '<stop offset="1" stop-color="#b8834f"/>' +
          '</linearGradient>' +
        '</defs>' +
        /* 受けの三角（左右）。板より暗く、壁から板を支える持ち送り。
           板の下から斜めに壁へ戻る形――これが無いと板が宙に浮く。 */
        '<path d="M2 14 H20 L2 30 Z" fill="#9a6c42"/>' +
        '<path d="M98 14 H80 L98 30 Z" fill="#9a6c42"/>' +
        '<g vector-effect="non-scaling-stroke" fill="none">' +
          '<path d="M20 14 L2 30" stroke="#78502e" stroke-opacity=".55"/>' +
          '<path d="M80 14 L98 30" stroke="#78502e" stroke-opacity=".55"/>' +
        '</g>' +
        /* 板本体。上面（薄い層）＋小口（前面の厚み）。 */
        '<rect x="0" y="13" width="100" height="3.6" fill="#eccfa8"/>' +
        '<rect x="0" y="16.6" width="100" height="8.4" fill="url(#eqsWood)"/>' +
        '<g vector-effect="non-scaling-stroke" fill="none">' +
          '<path d="M0 13.5H100" stroke="#f7e6c8" stroke-opacity=".85"/>' +
          '<path d="M0 16.6H100" stroke="#8a5f38" stroke-opacity=".45"/>' +
          '<path d="M0 24.6H100" stroke="#6b4527" stroke-opacity=".6"/>' +
        '</g>' +
      '</svg>' +
      '</span>';
  }

  /* ★「足したがまだ書いていない用具」を、書き終えた用具と同じ格で
     出さない（正本 §11：空欄と該当なしを同じ扱いにしない）。名前が
     無いうちは棚の**空きスペース**として、破線の受け皿＋一言で持つ
     ――事業所名・電話のプレースホルダを3行並べても読むものが無い。 */
  function equipCard(eq, i) {
    const on = secOn('equipment');
    const p = 'care.equipment.' + i + '.';
    const blank = !String(eq.name || '').trim();
    if (blank && !on) {
      return '<li class="eqs eqs-blank">' +
        '<span class="eqs-stage">' +
          '<span class="eqs-obj c-equip">' + equipGlyph('other') + '</span>' +
          careShelf() +
        '</span>' +
        '<span class="eqs-cap"><span class="eqs-capin">' +
          '<span class="eqs-name eqs-name-blank">まだ書いていない用具</span>' +
          '<span class="eqs-prov">鉛筆から名前と連絡先を書けます</span>' +
        '</span></span>' +
        '</li>';
    }
    return '<li class="eqs' + (blank ? ' eqs-blank' : '') + '">' +
      /* 用具は棚板の上に立つ。色は c-equip 固定（種類は絵で見分ける
         ので、行の識別色は要らない）。★削除ボタンは絵の右上に置く
         （2026-09-11 ユーザー指摘）――以前は名前欄の右横にあり、
         172px 幅の欄をさらに圧迫していた。棚に立つ物を丸ごと消す
         操作なので、物の絵に添えるほうが自然。 */
      '<span class="eqs-stage">' +
        '<span class="eqs-obj c-equip">' + equipGlyph(eq.kind) + '</span>' +
        careShelf() +
        (on ? delBtn(eq.id) : '') +
      '</span>' +
      '<span class="eqs-cap"><span class="eqs-capin">' +
        (on
          ? equipEditFields(p, eq)
          : ('<span class="eqs-name">' + esc(eq.name || '') + '</span>' +
             equipProvView(eq) +
             (eq.tel ? '<span class="eqs-tel">' + TEL + esc(eq.tel) + '</span>' : ''))) +
      '</span></span>' +
      '</li>';
  }

  /* 貸与元・購入元（閲覧時）。★サービス表の連絡先セル（contactCell の
     'link' 案）と同じ手つきに揃えた（2026-09-11 ユーザー指摘）――
     「暮らしの時間に入る支援」では事業所名そのものをリンクにし、URL の
     文字列は出さない。用具だけ Web を独立行にして URL 文字列
     （example.or.jp/hamakko）を出していたのは、介護ゾーン内で手つきが
     割れていた。URL は家族が読んで判断する情報ではなく、押せれば足りる
     という同じ理由で、ここも貸与元・購入元の名前自体をリンクにする。
     Web が無い用具は名前をただの文字として出す（該当する連絡先を
     持たないだけで、状態としては空欄）。 */
  function equipProvView(eq) {
    const prov = String(eq.provider || '').trim();
    if (!prov) return '';
    const web = String(eq.web || '').trim();
    return web
      ? '<a class="eqs-prov eqs-prov-link" href="' + esc(web) + '" target="_blank" ' +
          'rel="noopener">' + esc(prov) + EXT + '</a>'
      : '<span class="eqs-prov">' + esc(prov) + '</span>';
  }

  /* 編集中の中身。★ラベル無しでプレースホルダだけに頼っていたら
     「項目名が分からない」（2026-09-11 ユーザー指摘）。医療のカード
     （fld()）と同格で、欄の上に小さく固定ラベルを1本ずつ持つ。 */
  function equipEditFields(p, eq) {
    const efld = (label, inputHtml) =>
      '<span class="eqs-fld">' +
        '<span class="eqs-flb">' + label + '</span>' +
        inputHtml +
      '</span>';
    return efld('用具の名前', ev(p + 'name', eq.name, 'line', '用具の名前')) +
      efld('種類', equipKindSelect(p, eq)) +
      efld('貸与元・購入元', ev(p + 'provider', eq.provider, 'line', '事業所名')) +
      efld('電話', ev(p + 'tel', eq.tel, 'line', '電話番号')) +
      efld('Web', equipWeb(p, eq));
  }

  /* 用具の種類。★以前はチップを折りたたんでいたが、選択肢が常に
     見えないと「文字だけのボタン」にしか見えない（2026-09-11
     ユーザー指摘）。ネイティブ <select> にし、選ぶと名前欄にも
     その名前が入る（kind は setEquipName が名前から連動して決める
     ので、ここは名前を書き換えるだけでよい）。名前欄は選んだ後も
     自由に書き換えられる（例：「車椅子」→「車椅子（電動）」）。
     現在の名前が候補に無い（自由入力中）ときは選ばれた状態を持たない
     ――候補と違う名前を「選んだことにしない」。 */
  function equipKindSelect(p, eq) {
    const cur = String(eq.name || '').trim();
    const hit = S.EQUIP_TYPES.some(t => t.name === cur);
    /* ★data-path は名前欄と共有しない。同じ path を2つの [data-ef] 欄
       （テキスト欄とこのセレクト）に付けると、flushInputs() が両方を
       順に書き戻して後勝ちになり、自由入力した名前をセレクトの空欄が
       消してしまう。data-setval（候補チップと同じしくみ）でイベント
       側から名前欄へ反映する「選んだ瞬間のアクション」にする。 */
    return '<select class="i-ef i-ef-sel" data-setselval="' + p + 'name">' +
      '<option value=""' + (hit ? '' : ' selected') + '>選択してください</option>' +
      S.EQUIP_TYPES.map(t => '<option value="' + esc(t.name) + '"' +
        (cur === t.name ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') +
      '</select>';
  }

  /* 用具1件の Web 入力欄（編集中のみ）。★閲覧時は equipProvView() が
     貸与元・購入元の名前自体をリンクにするので、Web の URL 文字列を
     単独で出す場所はもう無い（サービス表の contactCell と同じ手つき
     に揃えた。2026-09-11 ユーザー指摘）。ここは名前と kind が
     決まったあとの「連絡先の裏付け」として、編集中だけ書ける欄。 */
  function equipWeb(p, eq) {
    return '<span class="eqs-web">' + evWeb(p + 'web', eq.web) + '</span>';
  }

  /* 「介護で使うもの」節の頭書き。上節（カレンダー紙面の .wcal-lead）と
     同格――用具チップ＋見出し＋補足文＋鉛筆。カレンダー節＝時間軸なら
     この節＝家に据わっている物、なのでチップのグリフは棚に置いた箱
     （CARE_SHELF_IC）。プレート地に直接文字を置かない（§3b・§7 で
     木札・カレンダー見出しについて2回通った「軽い＝装飾なし」の誤り）。 */
  const CARE_SHELF_IC =
    '<rect x="5" y="9" width="14" height="10" rx="1.4" fill="currentColor" ' +
      'fill-opacity=".16" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M4 19h16" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round"/>' +
    '<path d="M10 9V7.4a2 2 0 0 1 4 0V9" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linejoin="round"/>';
  function equipLead() {
    return '<div class="eqs-lead">' +
      '<span class="eqs-lead-ic" aria-hidden="true">' +
        svgIc(CARE_SHELF_IC, 19) + '</span>' +
      '<span class="eqs-lead-tx">' +
        '<span class="eqs-lead-tt">介護で使うもの</span>' +
        '<span class="eqs-lead-nt">暮らしを支えている、ずっと家にある用具です。</span>' +
      '</span>' +
      editBtn('equipment') +
      '</div>';
  }

  function equipmentBlock() {
    const list = S.data.care.equipment || [];
    const on = secOn('equipment');
    return equipLead() +
      (list.length
        ? '<ul class="eqshelf">' +
            list.map((eq, i) => equipCard(eq, i)).join('') +
          '</ul>'
        : '<p class="i-ev-empty">まだ登録がありません。</p>') +
      (on ? '<button type="button" class="rowadd" data-add="equip">＋ 用具を足す</button>' : '');
  }

  /* 「今の支援」プレートの中身。2節を縦に積む。 */
  function careSupportBlock() {
    const services = S.data.care.services || [];
    const editingService = secOn('service');
    return '<div class="cp-sub">' +
      /* ★上節の見出しはカレンダー台紙の紙面が持つ（weekCalendarLead）。
         空欄のときだけ、器が無いので従来の小見出しを出す。 */
      (services.length
        ? weekCalendar(services)
        : careSubHead('service', '暮らしの時間に入る支援') +
          '<p class="i-ev-empty">まだ登録がありません。</p>') +
      /* ★編集用の表を下に出さない（2026-09-09 指摘）。表示と編集で場所が
         変わるうえ、同じ項目が2箇所に出て「どちらが本物か」が分からな
         かった。カレンダーの行そのものが入力欄になる（weekCalendar の
         on）。足すボタンだけは行の外に要る。 */
      (editingService
        ? '<button type="button" class="rowadd" data-add="service">' +
            '＋ 支援を足す</button>'
        : '') +
      '</div>' +
      '<div class="cp-sub">' +
      equipmentBlock() +
      '</div>';
  }

  /* ★旧・サービスの表（serviceRow / servicesBlock）は撤去した
     （2026-09-09）。編集用にカレンダーの下へ出していたものだが、表示と
     編集で場所が変わり、同じ項目が2箇所に出ていた。行そのものが入力欄に
     なった（weekCalendar）ので、この表の役目は無くなった。          */

  /* サービスの型セレクト（編集時のみ）。行頭アイコンの色・記号を決める。 */
  function evServiceKind(path, value) {
    const keys = Object.keys(S.SERVICE_KINDS);
    return '<select class="i-ef i-ef-sel svr-kindsel" data-ef="1" data-path="' + path + '">' +
      keys.map(k => '<option value="' + k + '"' + (k === value ? ' selected' : '') + '>' +
        esc(S.SERVICE_KINDS[k].label) + '</option>').join('') +
      '</select>';
  }

  /* 荷札そのもの。輪郭を CSS の角丸矩形で代用しない（CLAUDE.md）――
     荷札は「左端が斜めに切り落とされ、穴にハトメが入った紙片」で、
     その切り欠きとハトメが無いとただのカードに見える。
     紙片は縦に伸びるので、輪郭だけ `preserveAspectRatio="none"` で
     引き伸ばし、ハトメは真円を保つ別レイヤーに置く。               */
  /* 札の輪郭は3つの層に分ける――引き伸ばしても斜めの切り欠きが
     鈍らないように、左の「頭」（切り欠き＋ハトメ）は縦横比を保つ
     固定幅の SVG、右の「胴」は伸びる矩形。1枚の SVG を
     `preserveAspectRatio="none"` で伸ばすと、45°の斜めが寝て
     矢印に見える（実際にそうなった）。                            */
  /* 札は1本の閉じたパスで描く。分割して重ねると、頭の輪郭の端が
     胴の途中で切れて「札の中を斜め線が走る」（実際にそうなった）。
     幅は札ごとに変わるので、`viewBox` の幅を実寸から作り直す――
     引き伸ばさないので、切り欠きの 45°もハトメの真円も保たれる。 */
  function ctagShape(w, h) {
    /* 切り欠きの奥行き。実物の荷札は「短く鈍い導入」で、深く取ると
       矢印に見える。札の高さのおよそ 1/4.5 に収める。 */
    const N = Math.round(h / 4.5);
    const r = 7;               /* 右の角丸 */
    return '<span class="ctag-shape" aria-hidden="true">' +
      '<svg class="ctag-svg" viewBox="0 0 ' + w + ' ' + h + '" ' +
        'preserveAspectRatio="none">' +
        '<defs>' +
          '<linearGradient id="ctagPaper" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#f7eee2"/>' +
            '<stop offset="1" stop-color="#eaddc9"/>' +
          '</linearGradient>' +
        '</defs>' +
        '<path d="M' + N + ' 1 H' + (w - r - 1) + ' a' + r + ' ' + r +
          ' 0 0 1 ' + r + ' ' + r + ' V' + (h - r - 1) + ' a' + r + ' ' + r +
          ' 0 0 1 -' + r + ' ' + r + ' H' + N + ' L3 ' + (h / 2 + 5) +
          ' a7 7 0 0 1 0-10 Z" ' +
          'fill="url(#ctagPaper)" stroke="#cdb894" stroke-width="1.3" ' +
          'vector-effect="non-scaling-stroke"/>' +
        /* 紙に開いた穴＋真鍮のハトメ。真円を保つ位置に置く。 */
        '<g transform="translate(' + (N - 8) + ' ' + (h / 2) + ')">' +
          '<circle r="6.4" fill="none" stroke="#a8905f" stroke-width="2.2"/>' +
          '<circle r="6.4" fill="none" stroke="#7d6636" stroke-opacity=".45" ' +
            'stroke-width=".8"/>' +
          '<circle r="4.3" fill="#cbb896"/>' +
          '<path d="M-3.6-2.8a4.3 4.3 0 0 1 6.2-1.4" fill="none" ' +
            'stroke="#f3e8d2" stroke-opacity=".8" stroke-width="1.1" ' +
            'stroke-linecap="round"/>' +
        '</g>' +
      '</svg>' +
    '</span>';
  }
  /* 札の実寸。CSS の flex-basis と高さに合わせる（幅は伸びるが、
     viewBox も同じ比で作るので斜めは寝ない）。 */
  const CTAG_SHAPE = ctagShape(220, 80);

  /* ④ 介護関係の書類やもの｜荷札（タグ）の横並び。その家にある、
     比較的安定した書類・ものの所在だけを持つ（§13-1）。中身は持たない。 */
  function carePapersBlock() {
    const c = S.data.care;
    const on = secOn('cpapers');
    const tags = (c.papers || []).map((r, i) => {
      const p = 'care.papers.' + i + '.';
      return '<div class="ctag">' +
        CTAG_SHAPE +
        '<div class="ctag-body">' +
          '<div class="ctag-item">' + ev(p + 'item', r.item, 'line', '書類・ものの名前') +
            (on ? delBtn(r.id) : '') + '</div>' +
          '<div class="ctag-where">' + PIN_MARK +
            ev(p + 'where', r.where, 'line', '置き場所') + '</div>' +
          '<div class="ctag-foot">' + stBadge('care.papers.' + i) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="ctags">' + tags +
      (on ? '<button type="button" class="ctag-add rowadd" data-add="cpaper">＋ 足す</button>' : '') +
      '</div>' +
      '<p class="sec-lead" style="margin:10px 0 0">原本の場所は「書類・資料」にまとめています。</p>';
  }

  function renderCare() {
    if (!careEl) return;
    careEl.innerHTML =
      '<div class="care-board">' +
        careBoardFrame() +
        '<div class="care-board-inner">' +
          careTopSlat() +
          /* ★「今の支援」プレートは器（白い地・ネジ・落ち影）は残し、
             見出し（「今の支援」＋❤️）だけ落とす（2026-09-10 opt.noHead）。
             中身のカレンダー頭書き（.wcal-lead）が見出しを兼ねるので、
             プレート見出しは二重になる。❤️（CARE_HEART_IC）は削除。
             「継続して使っている支援」「介護関係の書類やもの」の造形は
             まだ手を付けていない（次）。 */
          carePlate(null, null, '', careSupportBlock(),
            { wide: true, cls: 'cp-service', noHead: true }) +
          carePlate('cpapers', CARE_DOC_IC, '介護関係の書類やもの',
            carePapersBlock(), { wide: true, cls: 'cp-papers' }) +
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
     （診療科）は専用の適用関数を通す。                             */
  function applyOne(path, value) {
    /* Web 欄は共通で「https://」を欄の実値として持たせている
       （evWeb）。頭だけ残して中身を書かずに確定した／全部消して
       確定した場合、"https://" や "http://" がそのまま保存されて
       「リンクなのに何も指さない」URL になるので、ここで空文字へ
       落とす。それ以外（続きを書いた分）はそのまま通す。 */
    if (/\.web$/.test(path) && /^https?:\/\/$/.test(String(value).trim())) value = '';
    if (/^medical\.clinics\.\d+\.depts$/.test(path)) return S.applyTags(path, value);
    /* 起きた反応・起きたことの「候補にない」自由入力欄。チップの選択は
       保ったまま、自由入力ぶんだけを reactions / events 配列へ差し替える。 */
    let rf = /^medical\.allergies\.items\.(\d+)\.reactionsFree$/.exec(path);
    if (rf) return S.applyReactionFree(
      S.getByPath('medical.allergies.items.' + rf[1]), 'reactions',
      S.ALLERGY_REACTIONS, value);
    rf = /^medical\.adverse\.items\.(\d+)\.eventsFree$/.exec(path);
    if (rf) return S.applyReactionFree(
      S.getByPath('medical.adverse.items.' + rf[1]), 'events',
      S.ADVERSE_EVENTS, value);
    /* サービス名・福祉用具名は型（kind）が連動する。 */
    const m = /^care\.services\.(\d+)\.name$/.exec(path);
    if (m) {
      const sv = S.data.care.services[+m[1]];
      return S.setServiceName(sv, String(value).trim());
    }
    const eqm = /^care\.equipment\.(\d+)\.name$/.exec(path);
    if (eqm) {
      const eq = S.data.care.equipment[+eqm[1]];
      return S.setEquipName(eq, String(value).trim());
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
    const head = anchor.closest('.sf-glb, .rmemo-h, .subsec-lb, .cp-h, .sec-h') || anchor;
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
         data-setval="path|値"。同じ値ならトグルで空に戻す。
         ★applyOne を通す（setByPath 直書きにしない）――用具名・
         サービス名はチップで入れたときも型（kind）が連動する必要が
         あり、直書きだと絵だけ前のままになる。 */
      const sv = e.target.closest('[data-setval]');
      if (sv) {
        flushInputs();
        const at = sv.dataset.setval.indexOf('|');
        const path = sv.dataset.setval.slice(0, at);
        const value = sv.dataset.setval.slice(at + 1);
        applyOne(path, (S.getByPath(path) || '') === value ? '' : value);
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
        else if (what === 'equip') S.addEquip('', 'other');
        else if (what === 'cpaper')
          S.data.care.papers.push({ id: 'cp-' + Date.now(), item: '', where: '', state: '未確認' });
        S.save();
        render();
        return;
      }

      /* 曜日の点を押して入切する（編集中のみ）。★入力欄の値は先に
         書き戻す――押した拍子に、書きかけの文字が捨てられないように。 */
      const day = e.target.closest('[data-day]');
      if (day) {
        const cut = String(day.dataset.day).split('|');
        const sv = (S.data.care.services || []).find(x => x && x.id === cut[0]);
        if (sv && S.toggleServiceDay(sv, cut[1])) {
          flushInputs();
          S.save();
          render();
        }
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
      /* 用具の種類セレクト。選んだ値をそのまま名前欄へ書く（path は
         セレクト自身ではなく別の欄＝name を指す、data-setval の
         セレクト版）。空を選んだときは書き戻さない――選択肢に無い
         自由入力を「選び直して消す」事故を防ぐ。 */
      const ksel = e.target.closest('[data-setselval]');
      if (ksel) {
        if (ksel.value && applyOne(ksel.dataset.setselval, ksel.value)) S.save();
        render();
        return;
      }
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
