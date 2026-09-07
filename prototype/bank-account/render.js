/* SeiZen プロトタイプ｜銀行口座の描画と書き込み
   ------------------------------------------------------------------
   画面は state.js の事実を描いた結果。編集は事実を書き換えてから
   描き直すので、表示された文字列を読み戻して値を復元しない。

   記帳行・備え・持ち物のどれも「書いてある場所がそのまま入力欄に
   なる」手つきは変えていない。変えたのは、確定したあと値がどこへ
   残るか。                                                        */
(function (S) {
  'use strict';

  /* エスケープとトーストは領域固有ではないので shared/shell.js が持つ。 */
  const esc  = SeiZen.esc;
  const show = SeiZen.toast;

  const sec = document.getElementById('books');
  const shelf = document.getElementById('shelf');
  /* 編集中の場所を覚えておく。描き直しても同じ行が開いたままになる。 */
  let editing = null;   // {type:'acc'|'prep'|'kit', bank, index}
  /* 削除の確認を開いている銀行。confirm() の代わりに、その場で2段。 */
  let confirmDel = null;

  /* ── アイコン ─────────────────────────────────────── */

  const ICONS = {
    /* 代理人カード：カードの上に持ち主の顔。誰かに預けるカードであること
       が、絵そのもので伝わる。                                        */
    sit_card:   '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 9.3h19"/>' +
                '<path d="M5.5 12.6h3M5.5 15.2h1.8"/>' +
                '<circle cx="16.4" cy="12.9" r="1.9"/>' +
                '<path d="M13.4 16.6c.5-1.3 1.6-2 3-2s2.5.7 3 2"/>',
    /* 代理人指名手続：人と、記入する書類とペン。窓口で手続きする姿。 */
    sit_name:   '<circle cx="7" cy="6.6" r="2.9"/>' +
                '<path d="M2.4 17.4c0-2.9 2-4.9 4.6-4.9"/>' +
                '<path d="M11.4 10.4h6.2v10.2h-6.2z"/>' +
                '<path d="M13.4 14.2h2.2M13.4 17h2.2"/>' +
                '<path d="m19.2 3.6 2.2 2.2-4.6 4.6-2.7.5.5-2.7z"/>',
    record_person: '<circle cx="12" cy="8" r="3.5"/>' +
                   '<path d="M5.5 20c.5-4.1 3-6.4 6.5-6.4s6 2.3 6.5 6.4"/>',
    record_note: '<path d="M5.5 3.5h10l3 3V20.5h-13Z"/>' +
                 '<path d="M15.5 3.5v3h3M8.5 11h7M8.5 14.5h7M8.5 18h4.5"/>',
    item_book:  '<path d="M5 4.5h11a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2Z"/><path d="M8 4.5V20M8 8.5h6M8 12h4"/>',
    item_card:  '<rect x="2.5" y="6" width="19" height="13" rx="2.2"/><path d="M2.5 10.2h19M6 15h4"/>',
    item_seal:  '<circle cx="12" cy="12" r="7.2"/><path d="M12 8v1.6M12 14.4V16M8.8 12h1.6M13.6 12h1.6"/><circle cx="12" cy="12" r="2.4"/>',
    item_doc:   '<path d="M6.5 3h8l4 4v14h-12Z"/><path d="M14.5 3v4h4"/><path d="M9 12.5h6M9 15.8h6M9 19h3.5"/>',
    item_id:    '<rect x="2.5" y="6" width="19" height="13" rx="2.2"/><circle cx="8.3" cy="12.4" r="2"/><path d="M5.3 16.5c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4M13.5 10.2h5.2M13.5 13.4h5.2"/>'
  };
  const ITEM_ICON = {
    '通帳': 'item_book', 'キャッシュカード': 'item_card',
    '届出印': 'item_seal', '契約印（届出印）': 'item_seal', '印鑑（実印）': 'item_seal',
    '本人確認書類': 'item_id', '委任状': 'item_doc', 'ネットバンキング': 'item_card'
  };
  const svg = (key, w) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="' +
    (w || 18) + '" height="' + (w || 18) + '">' + ICONS[key] + '</svg>';

  /* 節ごとの編集ボタン（鉛筆／レ点）。保険の i-secedit と同じ作法：
     押した場所ではなく、節見出しの鉛筆が編集の起点になる。          */
  const PEN  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="m4 20 4-1 11-11-3-3L5 16z"/></svg>';
  const DONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>';
  function secEditBtn(on, dataAttr) {
    return '<button type="button" class="pb-secedit' + (on ? ' on' : '') + '" ' +
      dataAttr + ' aria-label="' + (on ? '編集を終える' : 'この項目を編集') + '">' +
      (on ? DONE : PEN) + '</button>';
  }

  /* ── 描く ─────────────────────────────────────────── */

  /* 口座は通帳の印字面に刷られたもの。預金種類を最上段に単独で置き、
     支店・番号はその下の段にまとめる（支店名が長くても種別に噛んで
     意図しない折り返しにならないよう、段を分ける）。名義は口座を
     跨いで同じことが多いので毎回繰り返さない。ここでも、全口座で
     名義が揃っていれば銀行1件の
     共通事実として上（.pb-label 側）にまとめ、割れているときだけ
     口座ごとに出す（commonOwner が null を返す）。編集は、情報面
     全体ではなく右上の鉛筆からだけ開く。                            */
  function accountRow(bank, acc, i, commonOwner) {
    const tags = acc.roles.length
      ? acc.roles.map(r => '<span class="pb-use">' + esc(r) + '</span>').join('')
      : '<span class="pb-use q">用途をあとで確認する</span>';
    /* 未入力は薄いプレースホルダーで、実データと見分けられるように
       する。地の文字と同じ太さで「支店未確認」と刷ると、読む面では
       「これが本当の支店名か」と読み手を止めてしまう。              */
    const number = acc.number
      ? esc(acc.number) : '<span class="pb-acct-ph">番号未確認</span>';
    const branch = acc.branch
      ? esc(acc.branch) : '<span class="pb-acct-ph">支店未確認</span>';
    /* 名義が口座ごとに割れているときだけ、口座の素性として出す。
       全口座で同じなら、銀行1件の素性として上（.pb-meta2）が持つ。 */
    const owner = commonOwner ? '' :
      '<div class="pb-acct-field pb-acct-owner"><span class="pb-acct-label">名義</span>' +
        '<span class="pb-acct-value' + (acc.owner ? '' : ' pb-acct-ph') + '">' +
          esc(acc.owner || '名義未確認') + '</span></div>';
    /* PC見開きの印字面は、保険と同じ「項目名＋値」で読む。銀行だけは
       複数口座を持つので、種類・支店・番号・用途を1口座ずつ一組にする。
       レスポンシブでは CSS で従来の横並びへ戻す。                   */
    return '<div class="pb-acct" data-bank="' + bank.id + '" data-acc="' + i + '">' +
      '<div class="pb-acct-field pb-acct-kind"><span class="pb-acct-label">種類</span>' +
        '<span class="pb-acct-value">' + esc(acc.kind) + '</span></div>' +
      '<div class="pb-acct-field pb-acct-branch"><span class="pb-acct-label">支店</span>' +
        '<span class="pb-acct-value pb-acct-br">' + branch + '</span></div>' +
      '<div class="pb-acct-field pb-acct-number"><span class="pb-acct-label">番号</span>' +
        '<span class="pb-acct-value pb-acct-no">' + number + '</span></div>' +
      '<div class="pb-acct-field pb-acct-uses"><span class="pb-acct-label">用途</span>' +
        '<span class="pb-acct-value"><span class="pb-uses">' + tags + '</span></span></div>' +
      owner +
      '<button class="pb-acct-edit" type="button" data-acctedit="' + bank.id + ':' + i +
        '" title="口座情報を編集" aria-label="口座情報を編集">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13">' +
          '<path d="M4 16.5V20h3.5L18.8 8.7l-3.5-3.5L4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/>' +
        '</svg></button></div>';
  }

  /* 記帳欄。色地の上に置くので、白い紙に起こしてから組む。表の列に
     押し込まず、ラベルと欄を縦に積む。                             */
  function accountForm(bank, acc, i) {
    const kinds = S.KINDS.map(k =>
      '<option' + (acc && k === acc.kind ? ' selected' : '') + '>' + k + '</option>').join('');
    const roles = S.ROLES.map(r =>
      '<button class="rtag' + (acc && acc.roles.includes(r) ? ' on' : '') +
      '" type="button">' + r + '</button>').join('');
    const deleteAction = acc
      ? '<button class="e-del" type="button">削除</button>' : '';
    return '<div class="acctform" data-bank="' + bank.id + '" data-acc="' + i + '">' +
      '<div class="fr"><small>種別</small><select class="ef f-kind">' + kinds + '</select></div>' +
      '<div class="fr"><small>支店</small><input class="ef f-branch" placeholder="支店名" value="' +
        esc(acc ? acc.branch : '') + '"></div>' +
      '<div class="fr"><small>番号</small><input class="ef f-no" placeholder="口座番号" value="' +
        esc(acc ? acc.number : '') + '"></div>' +
      '<div class="fr"><small>名義</small><input class="ef f-owner" placeholder="名義人" value="' +
        esc(acc ? acc.owner : '') + '"></div>' +
      '<div class="acctform-use"><small>用途（複数選択）</small><span class="roles">' + roles + '</span></div>' +
      '<div class="acctform-actions">' +
        '<span class="eact"><button class="e-no" type="button">やめる</button>' +
        '<button class="e-ok" type="button">保存</button></span>' +
        deleteAction +
      '</div></div>';
  }

  /* 制度アイコンは「必要時の対応」と「手続きに必要なもの」で共有する。
     同じ制度を指すのに見た目が違うと、別々の話に見えてしまうので。 */
  const sitIcon = p => p.situation === 'capacity' ? 'sit_name' : 'sit_card';

  /* ① 必要時の対応。制度カードは白地の並列2枚。制度名は銀行が決める
     ものなので表示専用。編集できるのは進捗（state）・対象者（who）・
     補足（note）で、カード見出しの鉛筆を押すとこの3つがまとめて
     入力欄に変わる（保険の節編集と同じ作法）。押した場所がそのまま
     入力欄になる旧方式はやめ、編集の起点を鉛筆1つに絞る。          */
  function sitEditOn(bank, i) {
    return editing && editing.type === 'sit' && editing.bank === bank.id && editing.index === i;
  }

  /* 進捗バッジだけは節の鉛筆と関係なく、バッジ自体をクリックすると
     その場で select に変わるインライン編集（口座情報・持ち物と同じ
     クリック編集の作法）。任せる人・メモは鉛筆からの一括編集のみ。 */
  function badgeEditOn(bank, i) {
    return editing && editing.type === 'badge' && editing.bank === bank.id && editing.index === i;
  }

  /* 未入力の欄には、何を書けばいいかが分かる例を薄く出す。空欄に
     「未入力」とだけ書いても、次の一手が見えない。                 */
  const WHERE_HINT = {
    '通帳':             '例：自宅・リビング収納の上段',
    'キャッシュカード': '例：自宅・本人の財布',
    '届出印':           '例：自宅・仏壇の引き出し',
    '契約印（届出印）': '例：自宅・仏壇の引き出し',
    '印鑑（実印）':     '例：自宅・寝室の金庫',
    '本人確認書類':     '例：自宅・書類ケース',
    '委任状':           '例：窓口でもらって記入する',
    'ネットバンキング': '例：ID・パスワードは記録しません'
  };
  const WHO_HINT  = { capacity: '例：長男（ひろし）', immobile: '例：長男（ひろし）' };
  const NOTE_HINT = { capacity: '例：印鑑証明書を市役所で取っておく',
                      immobile: '例：暗証番号は本人に確認しておく' };

  /* 持ち物の進捗を、数字だけでなく点の列で見せる。確認済み＝塗り、
     未確認＝白抜き、対象外（利用なし・発行なし等）＝細いダッシュ。
     数字（2/4）は「あと何個」を、点の並びは「どれが空いているか」を
     同時に伝える。羅列した数字より、埋まり具合が体で分かる。      */
  function kitDots(kit) {
    return '<span class="sit-kit-dots" aria-hidden="true">' +
      kit.map(k => {
        const s = S.kitState(k);
        const cls = s.done ? 'd' : (s.open ? 'o' : 'n');
        return '<i class="' + cls + '"></i>';
      }).join('') + '</span>';
  }

  function sitCard(bank, p, i) {
    const st = S.prepState(p), sit = S.situation(p.situation);
    const means = S.prepMeans(bank, p);
    const editOn = sitEditOn(bank, i);
    const at = ' data-bank="' + bank.id + '" data-prep="' + i + '"';

    /* 大きめのアイコンの右に、状況と制度名を縦に積む。「どんなときの、
       何という手続きか」がひと塊で読める。末尾の鉛筆から、進捗・
       対象者・補足をまとめて編集する。                              */
    const head = '<div class="sit-head"><span class="sit-ic">' + svg(sitIcon(p), 30) + '</span>' +
      '<div class="sit-headtx">' +
      '<div class="sit-cap">' + esc(sit.label.replace(/とき$/, '場合')) + '</div>' +
      '<div class="sit-mean">' + esc(means) + '</div></div>' +
      secEditBtn(editOn, 'data-sitedit="' + bank.id + ':' + i + '"') + '</div>';

    /* 進捗バッジ。バッジ自体をクリックすると、鉛筆の一括編集とは
       別にその場で select に変わる（口座情報・持ち物と同じクリック
       編集の作法）。鉛筆で節を開いたときも同じ select を共有する。
       判断能力があるうちにしか申し込めない制度で未対応・確認中のときは、
       期限（lead）を前に出し、進捗（tail）を後ろに添える。            */
    const badgeOn = editOn || badgeEditOn(bank, i);
    const lb = S.prepStateLabel(p);
    const badgeTone = lb.lead ? 'r-urg' : st.tone;
    const badge = badgeOn
      ? '<select class="ef sit-badge-ef"' + at + '>' +
        S.prepStateOptions().map(o =>
          '<option value="' + esc(o.value) + '"' + (o.value === p.state ? ' selected' : '') + '>' +
          esc(o.label) + '</option>').join('') + '</select>'
      : '<button class="sit-badge ' + badgeTone + (lb.lead && lb.tail ? ' two' : '') +
        '" type="button"' + at + ' data-field="state">' +
        (lb.lead ? '<span class="sit-badge-lead">' + esc(lb.lead) + '</span>' : '') +
        (lb.lead && lb.tail ? '<span class="sit-badge-tail">' + esc(lb.tail) + '</span>' : '') +
        (lb.lead ? '' : esc(lb.tail)) + '</button>';

    /* バッジの下は、済ませた日だけを出す場所。 */
    const badgeSub = (p.state === '対応済み' && p.doneOn)
      ? '<div class="sit-sub">' + esc(p.doneOn) + ' 対応</div>'
      : '<div class="sit-sub empty"></div>';

    /* 任せる人は制度の担当者として一行で見せ、メモは補足を書き留める
       面として分ける。同じ定義リストに押し込まず、役割の違いを形にする。 */
    const whoHint = WHO_HINT[p.situation] || '例：長男（ひろし）';
    const who = editOn
      ? '<input class="ef sit-who-ef"' + at + ' value="' + esc(p.who) +
        '" placeholder="' + esc(whoHint) + '">'
      : '<span class="sit-val' + (p.who ? '' : ' ph') + '">' + esc(p.who || whoHint) + '</span>';

    const noteHint = NOTE_HINT[p.situation] || '例：必要な書類を確認しておく';
    const note = editOn
      ? '<input class="ef sit-note-ef"' + at + ' value="' + esc(p.note) +
        '" placeholder="' + esc(noteHint) + '">'
      : '<span class="sit-val' + (p.note ? '' : ' ph') + '">' + esc(p.note || noteHint) + '</span>';

    /* 制度の説明が先、それがいつ効いてくるかの補足が後。 */
    const desc = '<div class="sit-about">' + esc(sit.about) + '</div>' +
      '<div class="sit-when">' + esc(sit.when) + '</div>';

    /* 持ち物ゾーン。同じ制度の説明の下に、一段沈んだ記入欄として
       差し込む。別の紙（旧 .pb-slip）に分けず、1枚の書類として
       「説明 → 任せる人 → その持ち物」まで続けて読ませる。        */
    const tal = S.kitTally(p.kit);
    const kitEditing = kitEditOn(bank, i);
    const kitZone = p.kit.length
      ? '<div class="sit-kit' + (kitEditing ? ' sit-kit-editing' : '') + '">' +
          '<div class="sit-kit-h"><span class="sit-kit-cap">必要なもの</span>' +
            kitDots(p.kit) +
            '<span class="sit-kit-tally' + (tal.open ? ' open' : '') + '">' +
              tal.done + '/' + (tal.done + tal.open) + '</span>' +
            secEditBtn(kitEditing, 'data-kitedit="' + bank.id + ':' + i + '"') + '</div>' +
          '<ul class="kit">' + p.kit.map((k, ki) => kitRow(bank, i, k, ki, kitEditing)).join('') + '</ul>' +
        '</div>'
      : '';

    /* 状態のトーンはバッジとクラスへ集約する。カード自体が1枚の
       書類の実体（薄い枠・影・わずかな傾き）を持ち、並列は余白で示す。 */
    return '<div class="sit s-' + badgeTone + (editOn ? ' sit-editing' : '') +
      '" data-bank="' + bank.id + '" data-prep="' + i + '">' +
      '<div class="sit-body">' +
        '<div class="sit-row">' + head +
          '<div class="sit-badge-wrap">' + badge + badgeSub + '</div></div>' +
        desc +
        '<div class="sit-record">' +
          '<div class="sit-person">' +
            '<span class="sit-person-ic">' + svg('record_person', 16) + '</span>' +
            '<div class="sit-record-copy"><div class="sit-record-label">任せる人</div>' +
              '<div class="sit-record-value">' + who + '</div></div>' +
          '</div>' +
          '<div class="sit-note">' +
            '<span class="sit-note-ic">' + svg('record_note', 15) + '</span>' +
            '<div class="sit-record-copy"><div class="sit-record-label">メモ</div>' +
              '<div class="sit-record-value">' + note + '</div></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      kitZone +
      '</div>';
  }

  /* ② 手続きに必要なもの。制度ごとの列。1行目にアイコン・名前・状態、
     2行目に保管場所を置く2段組みにして、場所の文字が切れないようにする。
     状態バッジはクリックした場所がそのまま入力欄になる（口座情報・
     必要時の対応の進捗バッジと同じクリック編集の作法）。保管場所は
     インライン編集にせず、ゾーン見出しの鉛筆から全行まとめて編集する。 */
  function kitField(bank, pi, i, field) {
    return editing && editing.type === 'kit' && editing.bank === bank.id &&
           editing.prep === pi && editing.index === i && editing.field === field;
  }
  function kitEditOn(bank, pi) {
    return editing && editing.type === 'kitsec' && editing.bank === bank.id && editing.prep === pi;
  }

  function kitRow(bank, pi, k, i, whereEditOn) {
    const st = S.kitState(k);
    const icon = ITEM_ICON[k.item] || 'item_doc';
    const at = ' data-bank="' + bank.id + '" data-prep="' + pi + '" data-kit="' + i + '"';

    /* 選択肢が2つしかない品目は、クリックでその場を行き来させる方が
       セレクトを開くより速い。3つ以上ある品目（発行なし等も選べる
       通帳・キャッシュカードなど）だけ、従来通り選択肢を開く。       */
    const stOptions = S.kitStatesFor(k.item);
    const state = stOptions.length > 2
      ? (kitField(bank, pi, i, 'kstate')
          ? '<select class="ef kit-st-ef"' + at + '>' +
            stOptions.map(s => '<option' + (s === k.state ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>'
          : '<button class="st" type="button"' + at + ' data-kfield="kstate">' + esc(k.state) + '</button>')
      : '<button class="st" type="button"' + at + ' data-kfield="kstate" data-ktoggle="1">' + esc(k.state) + '</button>';

    /* 未入力の欄には例を薄く出す。値としては空のままなので、
       消す手間はいらない。保管場所はゾーンの鉛筆が開いているときだけ
       入力欄になる（単独クリックでは開かない）。                    */
    const whHint = WHERE_HINT[k.item] || '例：自宅・書類ケース';
    const where = whereEditOn
      ? '<input class="ef kit-wh-ef"' + at + ' value="' + esc(k.where) + '" placeholder="' + esc(whHint) + '">'
      : '<span class="wh' + (k.where ? '' : ' ph') + '">' + esc(k.where || whHint) + '</span>';

    return '<li class="' + st.tone + '"' + at + '>' +
      '<div class="kit-l1"><span class="ic2">' + svg(icon, 19) + '</span>' +
      '<span class="nm2">' + esc(k.item) + '</span>' + state + '</div>' +
      '<div class="kit-l2">' + where + '</div></li>';
  }

  /* 大事なのは判断能力低下（urgent）側。左に置く。実データの並び
     （immobile→capacity）は変えず、表示順だけをここで決める。       */
  function displayOrder(bank) {
    return bank.prep
      .map((p, i) => i)
      .sort((a, b) => (S.situation(bank.prep[b].situation).urgent ? 1 : 0) -
                      (S.situation(bank.prep[a].situation).urgent ? 1 : 0));
  }

  /* 記帳面の節見出し。番号（①②③）はやめた。番号は順序を言うだけで、
     どれが通帳に刷られた事実で、どれが家族の足した記録かを言わない。
     いまはその区別を左右のページが持っているので、見出しは名前だけ
     でよい。                                                       */
  function blockHead(icon, label, extra, action) {
    return '<div class="pb-bh"><span class="pb-bh-ic">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'width="17" height="17">' + icon + '</svg></span>' +
      '<b>' + esc(label) + '</b>' + (extra ? '<span>' + esc(extra) + '</span>' : '') +
      (action || '') + '</div>';
  }

  /* カテゴリの「メモ」。保険・契約デジタルと同じ、家族へ伝えておく
     ひとことの置き場所。必要時の対応（制度ごと）のメモとは別で、
     「この銀行全体で言い添えておきたいこと」――仕組みが無い銀行なら
     任意後見や口座の集約の相談状況、ある銀行なら手続きの段取りなど。
     造形は右ページに挟まる一枚の便箋（保険の pv-letter を踏襲）。   */
  function memoBlock(bank) {
    const editOn = editing && editing.type === 'memo' && editing.bank === bank.id;
    const body = editOn
      ? '<textarea class="pb-memo-ef" data-bank="' + bank.id + '" ' +
        'placeholder="家族へ伝えておきたいこと">' + esc(bank.memo || '') + '</textarea>'
      : (bank.memo
          ? '<div class="pb-memo-val">' +
            bank.memo.split('\n').map(l => '<p>' + esc(l) + '</p>').join('') + '</div>'
          : '<div class="pb-memo-val empty">' +
            '<p class="pb-memo-empty">メモは未記入です。</p></div>');
    return '<div class="pb-letter">' +
      '<div class="pb-letter-h"><span class="pb-letter-ic">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'width="15" height="15"><path d="M4 15 14 5l5 5L9 20H4Z"/><path d="M12 7l5 5"/></svg>' +
        '</span>メモ' + secEditBtn(editOn, 'data-memoedit="' + bank.id + '"') + '</div>' +
      '<div class="pb-letter-body">' + body + '</div>' +
    '</div>';
  }

  const PLUS_IC = '<path d="M12 5v14M5 12h14"/>';
  /* 節見出しの末尾に置く小さな＋。常時いちばん目立つ場所に置いていた
     「口座を追加」ボタンをここへ移した。読む面（口座情報）に操作
     ボタンが常設されているのはノイズで、編集の起点は保険・契約と
     同じく見出し横の小さな鉛筆相当に揃える。                       */
  function addAcctBtn(bankId) {
    return '<button class="pb-bh-add" type="button" data-add="' + esc(bankId) +
      '" title="口座を追加" aria-label="口座を追加">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'width="13" height="13">' + PLUS_IC + '</svg></button>';
  }

  /* 系統色は「代理の仕組みの状況」。家族が一番判断したい軸を色に取る
     （正本§15：何が登録されているかではなく、何を判断できるか）。
     一覧の表紙（.pb-book）と、この記録の見開き（.pb）は、どちらも
     必ず S.bankStatus() を経由する。以前はここで色を、state.js の
     bankBadge が鑑札の文言を別々に決めていて、対応済みでも鑑札が
     「確認中」のまま／一覧と詳細で色が食い違う、というずれがあった。 */
  const BANK_TONE = { urgent: 'bk-urg', open: 'bk-open', ok: 'bk-ok', none: 'bk-none' };
  function bankTone(bank) { return BANK_TONE[S.bankStatus(bank)]; }

  /* 印字面の空押し。一覧の表紙で薄く敷いていた織り柄を、開いた内面
     では大きな型押しにする。銀行の並び順で柄を回すのは表紙と同じ。 */
  const EMBOSS = [
    /* stripe */ '<path d="M14 6v52M30 6v52M46 6v52" stroke="#fff" stroke-width="3" fill="none"/>',
    /* clover */ '<g fill="none" stroke="#fff" stroke-width="3">' +
                 '<circle cx="32" cy="18" r="9"/><circle cx="18" cy="32" r="9"/>' +
                 '<circle cx="46" cy="32" r="9"/><circle cx="32" cy="46" r="9"/>' +
                 '<path d="M32 32v22"/></g>',
    /* vein   */ '<g fill="none" stroke="#fff" stroke-width="3">' +
                 '<path d="M6 32h52"/><path d="M20 32l-8-10M20 32l-8 10M34 32l-8-10M34 32l-8 10' +
                 'M48 32l-8-10M48 32l-8 10"/></g>'
  ];
  function embossHTML(bank) {
    const i = S.banks.indexOf(bank);
    const tile = EMBOSS[((i | 0) % EMBOSS.length + EMBOSS.length) % EMBOSS.length];
    return '<span class="pb-emboss" aria-hidden="true">' +
      '<svg viewBox="0 0 64 64">' + tile + '</svg></span>';
  }

  /* 開いた通帳。左＝銀行が刷った動かない事実、右＝SeiZen と家族が
     足した記録。物として別の面に載っているので、どちらがどちらかを
     読み手が数えなくていい。                                       */
  function bookHTML(bank) {
    const badge = S.bankBadge(bank);
    const addingHere = editing && editing.type === 'acc' &&
                       editing.bank === bank.id && editing.index === bank.accounts.length;
    const owner = S.commonOwner(bank);

    let acctRows = bank.accounts.map((a, i) =>
      (editing && editing.type === 'acc' && editing.bank === bank.id && editing.index === i)
        ? accountForm(bank, a, i) : accountRow(bank, a, i, owner)).join('');
    if (addingHere) acctRows += accountForm(bank, null, bank.accounts.length);

    /* 左ページ＝印字面。色地に直接刷る。
       名義は口座ごとの明細ではなく「この通帳は誰のものか」という
       素性なので、銀行名・状態と同じ並びに置くが、状態バッジとは
       別行（.pb-meta2）に立てる。＋もその行の右端に乗せる。      */
    const meta = [];
    if (owner) meta.push('<span><i>名義</i>' + esc(owner) + '</span>');
    if (bank.accounts.length) {
      meta.push('<span><i>口座</i>' + bank.accounts.length + '件</span>');
    }

    const left = '<div class="pb-left">' +
      '<div class="pb-label">' + embossHTML(bank) +
        '<div class="pb-bankcap">お取引銀行</div>' +
        '<div class="pb-bankname">' + esc(bank.name) + '</div>' +
        '<span class="pb-state' + (badge.cls === 'warn' ? '' : ' off') + '">' +
          esc(badge.text.replace(/\s/g, '')) + '</span>' +
        '<div class="pb-meta2">' + meta.join('') + addAcctBtn(bank.id) + '</div>' +
      '</div>' +
      '<div class="pb-acctsec">' + acctRows + '</div>' +
      '</div>';

    /* 右ページ＝記帳面。通帳に刷られていない、家族のための記録。
       仕組みが無い制度は、進捗も持ち物も無いので詳細を出さない
       （カードごと・列ごと省く）。仕組みが1つも無い銀行では、
       「必要時の対応」「手続きに必要なもの」の中身自体が空になるので、
       その事実を一言だけ述べてメモへ送る。但し書き（bank.note）は
       ①のブロックの下に控えめに添える。                           */
    const withMeans = displayOrder(bank).filter(i => S.prepMeans(bank, bank.prep[i]));
    const noMeansAtAll = withMeans.length === 0;

    /* 制度カード1枚が「手続きの案内 ＋ その持ち物の確認欄」で1つの
       書類。以前は説明（この白紙）と持ち物（別の挟み紙 .pb-slip）に
       割れていて、同じ制度の話をスクロールで往復して読ませていた。 */
    const sitBlock = '<div class="pb-block">' +
      blockHead('<circle cx="9" cy="7" r="3.2"/><path d="M3 19c0-3.2 2.5-5.4 6-5.4' +
        'M15.5 12.5h5.5v8h-5.5z"/><path d="M17 15.5h2.5M17 18h2.5"/>',
        'もしものときの手続き', '家族が代わりに手続きする方法と、そのとき要る持ち物') +
      (noMeansAtAll
        ? '<p class="pb-nomeans">この銀行には、家族が代わりに手続きするための仕組みがありません。</p>'
        : '<div class="sit-grid">' +
            withMeans.map(i => sitCard(bank, bank.prep[i], i)).join('') +
          '</div>' +
          (bank.note ? '<div class="ft">' + esc(bank.note) + '</div>' : '')) +
      '</div>';

    const right = '<div class="pb-right">' +
      '<div class="pb-sheet">' + sitBlock + '</div>' +
      memoBlock(bank) +
      '</div>';

    /* 休眠は bankStatus() の 'none' に含まれる（bankTone が bk-none を
       返す）ので、ここで別に .gy を足す必要はない。               */
    return '<div class="pb ' + bankTone(bank) +
      '" data-bank="' + bank.id + '">' +
      '<div class="pb-open">' +
        '<span class="pb-fore r" aria-hidden="true"></span>' +
        '<span class="pb-fore b" aria-hidden="true"></span>' +
        left + right +
        delZone(bank) +
      '</div></div>';
  }

  /* 削除は2段。押してから、その場で確かめる（保険の .lf-del と同じ
     作法だが、置き場所はこちらの印字面のいちばん下）。            */
  function delZone(bank) {
    if (confirmDel === bank.id) {
      return '<div class="pb-del confirming">' +
        '<p>' + esc(bank.name) + 'を削除します。<br>登録した口座情報もすべて消えます。</p>' +
        '<div class="pb-del-btns">' +
        '<button class="pb-del-yes" type="button" data-delyes="' + bank.id + '">削除する</button>' +
        '<button class="pb-del-no" type="button" data-delno="1">やめる</button></div></div>';
    }
    return '<div class="pb-del">' +
      '<button class="del" type="button" data-delopen="' + bank.id + '" title="' +
      esc(bank.name) + 'を削除" aria-label="' + esc(bank.name) + 'を削除">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
      '<path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>' +
      '<path d="M10 11v6M14 11v6"/></svg></button></div>';
  }

  /* ── 口座一覧（目次） ─────────────────────────────
     上部に通帳の表紙を並べる。契約・デジタルの支払いカードから
     借りたのは「券面＋記録」の二層構造だけで、載る事実は銀行口座
     のもの。上層は通帳を見れば分かること（銀行名・口座数・名義・
     用途）、下層は SeiZen が記録していること（代理の仕組み2つと
     その進捗、持ち物の数）。口座番号や支店名は一覧に出さない。

     ここは読むための場所なので、編集はしない。押すと下の該当
     通帳へ送る。詳細は下にそのまま在るので、一覧は目次に徹する。 */

  /* 表紙に出す用途。口座ごとの roles を銀行単位で畳む。生活に
     直に響くもの（年金の受取・生活費・公共料金）を先に出す。      */
  function shelfRoles(bank) {
    const crit = S.criticalRoles(bank);
    const rest = [];
    bank.accounts.forEach(a => a.roles.forEach(r => {
      if (!crit.includes(r) && !rest.includes(r)) rest.push(r);
    }));
    return crit.concat(rest);
  }

  /* 口座の種別を数える。「普通預金 ×2」まで出すと表紙が混むので、
     種別名だけを重複なく並べる。                                  */
  function shelfKinds(bank) {
    const out = [];
    bank.accounts.forEach(a => { if (!out.includes(a.kind)) out.push(a.kind); });
    return out;
  }

  /* 制度の1行。「代理人指名手続 …… 未対応」。制度名は銀行が決める
     固有名詞で、家族が知らないもの。ここが一覧の背骨なので、
     状態バッジより先に名前を読ませる。仕組みが無い銀行は、その
     ことこそが一覧で一番効く情報なので、はっきり書く。            */
  function shelfSitRow(bank, p) {
    const means = S.prepMeans(bank, p);
    const sit = S.situation(p.situation);
    /* 仕組みが無い銀行は、その事実自体が一覧で一番効く情報。銀行の外で
       取る手（任意後見・口座の集約など）は通帳の「メモ」で読ませる。 */
    if (!means) {
      return '<li class="sh-sit none">' +
        '<span class="ic">' + svg(sitIcon(p), 17) + '</span>' +
        '<span class="nm">仕組みなし</span>' +
        '<span class="cap">' + esc(sit.label.replace(/とき$/, '場合')) + '</span>' +
        '<span class="st na">この銀行では不可</span></li>';
    }
    const st = S.prepState(p), lb = S.prepStateLabel(p);
    const tone = lb.lead ? 'r-urg' : st.tone;
    /* 期限つきの行は「今のうちに・未対応」と点で繋ぐ。詳細カードの
       2段バッジを、1行に畳んだ形。                                */
    const text = lb.lead ? (lb.lead + (lb.tail ? '・' + lb.tail : '')) : lb.tail;
    return '<li class="sh-sit">' +
      '<span class="ic">' + svg(sitIcon(p), 17) + '</span>' +
      '<span class="nm">' + esc(means) + '</span>' +
      '<span class="cap">' + esc(sit.label.replace(/とき$/, '場合')) + '</span>' +
      '<span class="st ' + tone + '">' + esc(text) + '</span></li>';
  }

  /* 表紙の外枠・地紋は shared/passbook.js が持つ。地紋は銀行の並び順で
     割り当てる（写実的な箔ではなく、冊子だと分かる程度の淡い織り柄）。 */
  /* 一覧の表紙は passbook.js の tone（'urg'|'open'|'ok'|'gy'）を、
     詳細の見開きは area.css の bk-*（bankTone）を使う。名前は違うが
     どちらも同じ S.bankStatus() を経由するので、同じ銀行なら
     必ず同じ色になる。                                            */
  const SHELF_TONE = { urgent: 'urg', open: 'open', ok: '', none: 'gy' };

  function shelfCard(bank) {
    const badge = S.bankBadge(bank);
    const t = S.tally(bank);
    const kinds = shelfKinds(bank);
    const roles = shelfRoles(bank);
    const owner = (bank.accounts.find(a => a.owner) || {}).owner || '';

    /* 下層＝SeiZen の記録。制度2行のあとに、持ち物の数と用途。
       期限の警告は制度ごとのバッジ（今のうちの対応が必要）に
       もう出ているので、カード上部でも繰り返さない。              */
    const body =
      '<ul class="sh-sits">' + displayOrder(bank).map(i => shelfSitRow(bank, bank.prep[i])).join('') + '</ul>' +
      '<div class="sh-foot">' +
        '<span class="sh-kit' + (t.open ? ' open' : '') + '">持ち物 ' + t.done + '/' + (t.done + t.open) + ' 確認済み</span>' +
        '<span class="sh-use">' + (roles.length ? esc(roles.join('・')) : '用途 未入力') + '</span>' +
      '</div>';

    /* 上層＝通帳の表紙。銀行名・口座数・名義だけを置く。 */
    return SeiZen.passbook({
      key: bank.id,
      name: bank.name,
      weaveIndex: S.banks.indexOf(bank),
      tone: SHELF_TONE[S.bankStatus(bank)],
      meta: [
        { text: '口座 ' + bank.accounts.length + '件', lead: true },
        { text: kinds.join('・') },
        { text: owner, label: '名義' }
      ],
      badge: { text: badge.text.replace(/\s/g, ''), on: badge.cls === 'warn' },
      body: body
    });
  }

  /* 上部の警告は、事実から引き直す。 */
  function chromeHTML() {
    const urgent = S.urgentPreps();
    const alert = document.getElementById('alert');
    if (!urgent.length) { alert.style.display = 'none'; return; }
    alert.style.display = '';
    alert.querySelector('div').innerHTML =
      '<b>本人の判断能力があるうちにしか申し込めない手続きが【 ' + urgent.length + '件 】残っています。';
  }

  function render() {
    S.save();
    sec.innerHTML = S.banks.map(bookHTML).join('');
    if (shelf) shelf.innerHTML = S.banks.map(shelfCard).join('');
    chromeHTML();
    const cntTx = S.banks.length + '件';
    const cntShelf = document.getElementById('cntShelf');
    const cntBooks = document.getElementById('cntBooks');
    if (cntShelf) cntShelf.textContent = cntTx;
    if (cntBooks) cntBooks.textContent = cntTx;
    /* ナビの件数は外殻の持ち物。描き直すたびに知らせておく。 */
    SeiZen.setNavCount('bank-account', S.banks.length + '件');
    focusEditor();
  }

  /* 描き直したあとも、開いていた欄にそのまま書き続けられる。 */
  function focusEditor() {
    if (!editing) return;
    if (editing.type === 'acc') {
      const el = sec.querySelector('.acctform .f-branch');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      return;
    }
    if (editing.type === 'memo') {
      const el = sec.querySelector('.pb-memo-ef');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      return;
    }
    if (editing.type === 'sit' || editing.type === 'badge') {
      const el = sec.querySelector('.sit-badge-ef');
      if (el) { el.focus(); if (el.showPicker) { try { el.showPicker(); } catch (e) { /* 無視 */ } } }
      return;
    }
    if (editing.type === 'kitsec') {
      const el = sec.querySelector('.kit-wh-ef');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      return;
    }
    if (editing.type !== 'kit') return;
    const sel = editing.field === 'kstate' ? '.kit-st-ef' : '.kit-wh-ef';
    const el = sec.querySelector(sel);
    if (!el) return;
    el.focus();
    if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length);
    /* select はクリック1回で選択肢まで開く。フォーカスだけでは
       ブラウザが自動でドロップダウンを開かないため、明示的に開く。   */
    if (el.tagName === 'SELECT' && el.showPicker) {
      try { el.showPicker(); } catch (e) { /* 対応していない環境は無視 */ }
    }
  }

  /* ── 書き込む ─────────────────────────────────────── */

  function readAccountForm(row) {
    return {
      kind:   row.querySelector('.f-kind').value,
      branch: row.querySelector('.f-branch').value.trim(),
      number: row.querySelector('.f-no').value.trim(),
      owner:  row.querySelector('.f-owner').value.trim(),
      roles:  [...row.querySelectorAll('.rtag.on')].map(t => t.textContent.trim())
    };
  }

  function commitAccount(row, keepGoing) {
    const bank = S.findBank(row.dataset.bank), i = +row.dataset.acc;
    const v = readAccountForm(row);
    if (!v.branch && !v.number) {
      show('支店名か口座番号を入力してください');
      row.querySelector('.f-branch').focus();
      return;
    }
    if (i < bank.accounts.length) {
      Object.assign(bank.accounts[i], v);
      bank.updated = S.today();
      editing = null;
      render();
      show('口座情報を書き直しました');
    } else {
      S.addAccount(bank, v);
      editing = keepGoing ? { type: 'acc', bank: bank.id, index: bank.accounts.length } : null;
      render();
      show('口座を追加しました');
    }
  }

  function deleteAccount(row) {
    const bank = S.findBank(row.dataset.bank), i = +row.dataset.acc;
    if (!confirm('この口座情報を削除します。よろしいですか？')) return;
    S.removeAccount(bank, i);
    editing = null;
    render();
    show('口座情報を削除しました');
  }

  function deleteBank(id) {
    const bank = S.findBank(id);
    if (!bank) return;
    if (editing && editing.bank === id) editing = null;
    confirmDel = null;
    S.removeBank(id);
    render();
    show(bank.name + 'を削除しました');
  }

  /* 備えの1フィールドを書き換えるだけで、描き直しは呼び出し側に
     任せる。鉛筆で開いた節（進捗・対象者・補足）はまとめて編集中
     なので、closeSitEdit がまとめて読み戻すときに毎回render()しない
     で済むよう、ここでは値の反映だけをおこなう。                    */
  function commitPrepField(bank, i, field, value) {
    const p = bank.prep[i];
    if (field === 'who')   p.who   = value.trim();
    if (field === 'note')  p.note  = value.trim();
    /* 日付は「済ませた日」。対応済みにした時だけ刻み、外れたら消す。 */
    if (field === 'state') {
      const wasDone = p.state === '対応済み';
      p.state = value;
      if (value === '対応済み' && !wasDone) p.doneOn = S.today();
      if (value !== '対応済み') p.doneOn = '';
    }
    bank.updated = S.today();
  }

  /* カテゴリのメモ。銀行1件に1つ。空にしたらそのまま空で残す。 */
  function commitMemo(bank, value) {
    const v = value.replace(/\s+$/, '');
    if (bank.memo !== v) {
      bank.memo = v;
      bank.updated = S.today();
    }
  }

  /* 持ち物の1フィールドを書き換えるだけで、描き直しは呼び出し側に
     任せる（commitPrepField と同じ理由）。                        */
  function commitKitField(bank, pi, ki, field, value) {
    const k = bank.prep[pi].kit[ki];
    if (field === 'kstate') k.state = value;
    if (field === 'where')  k.where = value.trim();
    bank.updated = S.today();
  }

  sec.addEventListener('change', e => {
    /* 進捗の select。バッジを直接クリックして開いた単独編集
       （editing.type === 'badge'）なら選んだ場で確定して閉じる。
       鉛筆の節編集中（'sit'）なら、その欄だけ反映して節は開いたまま
       （節を閉じるのは鉛筆／外側クリック側の責務）。                */
    const p = e.target.closest('.sit-badge-ef');
    if (p) {
      commitPrepField(S.findBank(p.dataset.bank), +p.dataset.prep, 'state', p.value);
      if (editing && editing.type === 'badge') { editing = null; render(); show('対応状況を更新しました'); }
      else render();
      return;
    }
    /* 持ち物の状態 select は口座情報・進捗バッジと同じ単独クリック
       編集なので、選んだ場で確定して閉じる。                      */
    const k = e.target.closest('.kit-st-ef');
    if (k) {
      commitKitField(S.findBank(k.dataset.bank), +k.dataset.prep, +k.dataset.kit, 'kstate', k.value);
      editing = null;
      render();
      show('持ち物の状況を更新しました');
      return;
    }
  });

  /* 開いている節をその場で確定して閉じる。鉛筆をもう一度押した
     ときと、節の外を押したときの両方から呼ぶ。focusout の発火順に
     頼らず、開いている入力欄をここでまとめて読み戻す（保険の
     flushInputs と同じ作法）。フォーカス移動の経路に関わらず、
     最後に書いた値を必ず拾う。                                    */
  function closeSitEdit() {
    if (!editing || editing.type !== 'sit') { editing = null; return; }
    const bank = S.findBank(editing.bank), i = editing.index;
    const who  = sec.querySelector('.sit-who-ef[data-bank="' + editing.bank + '"][data-prep="' + i + '"]');
    const note = sec.querySelector('.sit-note-ef[data-bank="' + editing.bank + '"][data-prep="' + i + '"]');
    const st   = sec.querySelector('.sit-badge-ef[data-bank="' + editing.bank + '"][data-prep="' + i + '"]');
    if (who)  commitPrepField(bank, i, 'who', who.value);
    if (note) commitPrepField(bank, i, 'note', note.value);
    if (st)   commitPrepField(bank, i, 'state', st.value);
    editing = null;
  }
  /* 進捗バッジの単独クリック編集を閉じる。 */
  function closeBadgeEdit() {
    if (!editing || editing.type !== 'badge') { editing = null; return; }
    const st = sec.querySelector('.sit-badge-ef[data-bank="' + editing.bank + '"][data-prep="' + editing.index + '"]');
    if (st) commitPrepField(S.findBank(editing.bank), editing.index, 'state', st.value);
    editing = null;
  }
  function closeMemoEdit(bank) {
    const ta = sec.querySelector('.pb-memo-ef[data-bank="' + bank + '"]');
    if (ta) commitMemo(S.findBank(bank), ta.value);
    editing = null;
  }
  /* 必要なもの＝保管場所の一括編集。開いている入力欄をすべて読み戻す。 */
  function closeKitEdit() {
    if (!editing || editing.type !== 'kitsec') { editing = null; return; }
    const bank = S.findBank(editing.bank), pi = editing.prep;
    sec.querySelectorAll('.kit-wh-ef[data-bank="' + editing.bank + '"][data-prep="' + pi + '"]')
      .forEach(el => commitKitField(bank, pi, +el.dataset.kit, 'where', el.value));
    editing = null;
  }

  sec.addEventListener('click', e => {
    const t = e.target;

    /* 用途タグはその場で拾う。確定するまで事実には触れない。 */
    if (t.classList.contains('rtag')) { t.classList.toggle('on'); return; }

    /* 編集中の欄・節の外を押したら、そこで閉じる／確定する。以前は
       このガードが無く、focusout の setTimeout だけに頼っていたため、
       セクション内の別のボタン（別のバッジ等）を押してもフォーカスが
       sec の中に留まり、開いた select が閉じずに残る不具合があった。
       クリックで即座に閉じることで、フォーカスの移り先に関わらず
       必ず1つだけが開いた状態を保つ。                                */
    const inEditor = t.closest('.ef, [data-sitedit], [data-memoedit], [data-acctedit], .acctform, [data-kfield], [data-ktoggle], [data-kitedit]');
    if (editing && !inEditor) {
      if (editing.type === 'memo') closeMemoEdit(editing.bank);
      else if (editing.type === 'kitsec') closeKitEdit();
      else if (editing.type === 'badge') closeBadgeEdit();
      else if (editing.type === 'sit') closeSitEdit();
      else editing = null;
      render();
      return;
    }

    /* 銀行ごと削除。2段の確認を、印字面のいちばん下でその場で開く。 */
    const delOpen = t.closest('[data-delopen]');
    if (delOpen) { confirmDel = delOpen.dataset.delopen; render(); return; }
    const delYes = t.closest('[data-delyes]');
    if (delYes) return deleteBank(delYes.dataset.delyes);
    if (t.closest('[data-delno]')) { confirmDel = null; render(); return; }

    /* 口座の記帳 ----------------------------------------------- */
    const form = t.closest('.acctform[data-acc]');
    if (form) {
      if (t.closest('.e-ok')) return commitAccount(form, true);
      if (t.closest('.e-del')) return deleteAccount(form);
      if (t.closest('.e-no')) {
        editing = null; render();
        show(+form.dataset.acc < S.findBank(form.dataset.bank).accounts.length
          ? '編集をとりやめました' : '入力をとりやめました');
        return;
      }
      return;
    }
    const acctEdit = t.closest('[data-acctedit]');
    if (acctEdit) {
      const [bank, index] = acctEdit.dataset.acctedit.split(':');
      editing = { type: 'acc', bank, index: +index };
      render();
      return;
    }

    /* 行を足す。節見出し横の＋から、最後の行に続けて開く。 */
    const add = t.closest('.pb-bh-add');
    if (add) {
      const bank = S.findBank(add.dataset.add);
      editing = { type: 'acc', bank: bank.id, index: bank.accounts.length };
      render();
      return;
    }

    /* カテゴリのメモ。見出しの鉛筆から編集を開き、もう一度押すと確定。 */
    const memoEdit = t.closest('[data-memoedit]');
    if (memoEdit) {
      const bank = memoEdit.dataset.memoedit;
      if (editing && editing.type === 'memo' && editing.bank === bank) {
        closeMemoEdit(bank);
        render();
        show('メモを更新しました');
        return;
      }
      editing = { type: 'memo', bank };
      render();
      return;
    }

    /* 備え。見出しの鉛筆から、進捗・対象者・補足をまとめて編集する。
       もう一度押すと確定して閉じる。                                */
    const sitEdit = t.closest('[data-sitedit]');
    if (sitEdit) {
      const [bank, index] = sitEdit.dataset.sitedit.split(':');
      if (editing && editing.type === 'sit' && editing.bank === bank && editing.index === +index) {
        closeSitEdit();
        render();
        show('対応状況を更新しました');
        return;
      }
      editing = { type: 'sit', bank, index: +index };
      render();
      return;
    }

    /* 進捗バッジ。クリックした場所がそのまま入力欄になる（口座情報・
       持ち物の状態バッジと同じクリック編集の作法）。既に select に
       変わっている（鉛筆の節編集中）ときは data-field を持たない
       ボタンではなくなっているので、ここには来ない。                */
    const badgeEl = t.closest('.sit [data-field="state"]');
    if (badgeEl) {
      editing = { type: 'badge', bank: badgeEl.dataset.bank, index: +badgeEl.dataset.prep };
      render();
      return;
    }

    /* 必要なもの＝保管場所の一括編集。鉛筆を押すと全行の保管場所が
       まとめて入力欄になり、もう一度押すと確定して閉じる。この判定は
       .sit-kit が .sit[data-prep] の内側にあるので、その早期returnより
       前に置く。                                                    */
    const kitEdit = t.closest('[data-kitedit]');
    if (kitEdit) {
      const [bank, index] = kitEdit.dataset.kitedit.split(':');
      if (editing && editing.type === 'kitsec' && editing.bank === bank && editing.prep === +index) {
        closeKitEdit();
        render();
        show('保管場所を更新しました');
        return;
      }
      editing = { type: 'kitsec', bank, prep: +index };
      render();
      return;
    }

    /* 持ち物の状態バッジ。クリックでその場を編集する（2値ならその場で
       行き来、3値以上なら select）。口座情報・進捗バッジと同じ
       クリック編集の作法。保管場所はここでは編集を開かない。        */
    const kToggle = t.closest('[data-ktoggle]');
    if (kToggle) {
      const bank = S.findBank(kToggle.dataset.bank);
      const k = bank.prep[+kToggle.dataset.prep].kit[+kToggle.dataset.kit];
      const opts = S.kitStatesFor(k.item);
      const next = opts[(opts.indexOf(k.state) + 1) % opts.length];
      commitKitField(bank, +kToggle.dataset.prep, +kToggle.dataset.kit, 'kstate', next);
      render();
      show('持ち物の状況を更新しました');
      return;
    }
    const kEl = t.closest('[data-kfield="kstate"]');
    if (kEl) {
      editing = { type: 'kit', bank: kEl.dataset.bank, prep: +kEl.dataset.prep,
                  index: +kEl.dataset.kit, field: 'kstate' };
      render();
      return;
    }
    if (t.closest('.sit[data-prep]')) return;
  });

  /* Enter で確定、Escape でやめる。手が入力欄から離れない。 */
  sec.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (confirmDel) { confirmDel = null; render(); return; }
      if (editing && editing.type === 'memo') { closeMemoEdit(editing.bank); render(); return; }
      if (editing && editing.type === 'sit') { closeSitEdit(); render(); return; }
      if (editing && editing.type === 'kitsec') { closeKitEdit(); render(); return; }
      if (editing && editing.type === 'badge') { closeBadgeEdit(); render(); return; }
      if (editing) { editing = null; render(); }
      return;
    }
    if (e.key !== 'Enter') return;
    const form = e.target.closest('.acctform');
    if (form && !e.target.classList.contains('rtag')) {
      e.preventDefault();
      /* Enter では確定しない。支店名だけ書いて Enter → 番号も名義も
         空のまま登録される、という意図しない確定が起きていたため。
         確定は「保存」ボタンを押したときだけ（commitAccount の呼び
         出しはそちら1箇所に絞る）。Enter は次の欄への移動だけ担う。 */
      const fields = [...form.querySelectorAll('.f-kind, .f-branch, .f-no, .f-owner')];
      const at = fields.indexOf(e.target);
      if (at > -1 && at < fields.length - 1) fields[at + 1].focus();
      return;
    }
    if (e.target.closest('.sit-who-ef, .sit-note-ef, .kit-wh-ef')) { e.preventDefault(); e.target.blur(); }
  });

  /* ── 銀行を追加する ─────────────────────────────────
     登録は一覧セクションの見出し直下でおこなう（保険・契約デジタルと
     同じ手つき）。＋を押すと addForm が開き、銀行→最初の1口座を入れて
     足す。銀行名は BANKS マスタから選ぶ（選ぶと代理の仕組みが自動で
     決まる）。一覧に無い銀行は「自分で入力」で名前を打つ。追加すると
     下の該当通帳へ送る。詳細ゾーンにドラフトを生やす旧方式はやめた。 */
  const addBtn  = document.getElementById('addbank');
  const addForm = document.getElementById('addForm');
  /* { bank, freeBank, kind, branch, number, owner, roles:Set } or null */
  let addState = null;

  const BANK_FREE = '__free__';

  /* 選んだ銀行の代理の仕組みを一言で。BANKS に無ければ空。 */
  function bankMeansSummary(name) {
    const m = S.BANKS.find(b => b.name === name);
    if (!m) return '';
    const has = S.SITUATIONS.filter(s => m.means[s.id] != null).length;
    if (has === 0) return '代理の仕組みなし';
    if (has === S.SITUATIONS.length) return '代理の仕組みあり';
    return '代理の仕組みは一部のみ';
  }

  function optionList(items, cur, blank) {
    return (blank ? '<option value="">' + esc(blank) + '</option>' : '') +
      items.map(v => '<option value="' + esc(v) + '"' +
        (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
  }

  function renderAddForm() {
    if (!addForm) return;
    if (!addState) { addForm.hidden = true; addForm.innerHTML = ''; return; }
    addForm.hidden = false;

    const banks = S.BANKS.map(b => b.name);
    const usingFree = addState.bank === BANK_FREE;
    const bankName = usingFree ? addState.freeBank.trim() : addState.bank;
    const summary  = usingFree ? '' : bankMeansSummary(addState.bank);
    const canAdd = !!bankName && (!!addState.branch.trim() || !!addState.number.trim());

    const roleBtns = S.ROLES.map(r =>
      '<button type="button" class="af-rtag' + (addState.roles.has(r) ? ' on' : '') +
      '" data-afrole="' + esc(r) + '">' + esc(r) + '</button>').join('');

    addForm.innerHTML =
      '<div class="af-row">' +
        '<label class="af-f"><span>銀行</span>' +
          '<select class="af-sel" data-af="bank">' +
            optionList(banks, usingFree ? '' : addState.bank, '選んでください') +
            '<option value="' + BANK_FREE + '"' + (usingFree ? ' selected' : '') + '>この一覧にない（自分で入力）</option>' +
          '</select></label>' +
        (usingFree
          ? '<label class="af-f"><span>銀行名</span>' +
              '<input class="af-in" data-af="freeBank" value="' + esc(addState.freeBank) + '" ' +
                'placeholder="例：三菱UFJ銀行"></label>'
          : '<div class="af-f af-note-f"><span>代理の仕組み</span>' +
              '<p class="af-means">' + esc(summary || '—') + '</p></div>') +
      '</div>' +

      '<div class="af-sub">最初の口座（あとから足せます）</div>' +
      '<div class="af-row">' +
        '<label class="af-f af-f-s"><span>種別</span>' +
          '<select class="af-sel" data-af="kind">' + optionList(S.KINDS, addState.kind) + '</select></label>' +
        '<label class="af-f"><span>支店</span>' +
          '<input class="af-in" data-af="branch" value="' + esc(addState.branch) + '" placeholder="支店名"></label>' +
        '<label class="af-f"><span>口座番号</span>' +
          '<input class="af-in" data-af="number" value="' + esc(addState.number) + '" placeholder="口座番号"></label>' +
      '</div>' +
      '<div class="af-row">' +
        '<label class="af-f"><span>名義</span>' +
          '<input class="af-in" data-af="owner" value="' + esc(addState.owner) + '" placeholder="名義人"></label>' +
        '<div class="af-f af-f-2"><span>用途</span>' +
          '<div class="af-roles">' + roleBtns + '</div></div>' +
      '</div>' +

      '<div class="af-btns">' +
        '<button type="button" class="af-add" data-afadd="1"' + (canAdd ? '' : ' disabled') + '>この内容で追加</button>' +
        '<button type="button" class="af-cancel" data-afcancel="1">やめる</button>' +
      '</div>';
  }

  if (addBtn) addBtn.addEventListener('click', () => {
    if (editing) { editing = null; render(); }
    addState = addState
      ? null
      : { bank: '', freeBank: '', kind: S.KINDS[0], branch: '', number: '', owner: '', roles: new Set() };
    renderAddForm();
    if (addState) addForm.querySelector('[data-af="bank"]').focus();
  });

  if (addForm) {
    addForm.addEventListener('change', e => {
      const el = e.target.closest('[data-af]');
      if (!el || !addState) return;
      const key = el.dataset.af;
      if (key === 'bank') {
        addState.bank = el.value;
        if (el.value !== BANK_FREE) addState.freeBank = '';
        renderAddForm();
        const next = addForm.querySelector(el.value === BANK_FREE ? '[data-af="freeBank"]' : '[data-af="branch"]');
        if (next) next.focus();
        return;
      }
      addState[key] = el.value;
    });

    addForm.addEventListener('input', e => {
      const el = e.target.closest('[data-af]');
      if (!el || !addState) return;
      addState[el.dataset.af] = el.value;
      const btn = addForm.querySelector('[data-afadd]');
      const bankName = addState.bank === BANK_FREE ? addState.freeBank.trim() : addState.bank;
      const ok = bankName && (addState.branch.trim() || addState.number.trim());
      if (btn) btn.disabled = !ok;
    });

    addForm.addEventListener('click', e => {
      const role = e.target.closest('[data-afrole]');
      if (role && addState) {
        const r = role.dataset.afrole;
        if (addState.roles.has(r)) addState.roles.delete(r); else addState.roles.add(r);
        role.classList.toggle('on');
        return;
      }
      if (e.target.closest('[data-afcancel]')) { addState = null; renderAddForm(); return; }
      if (e.target.closest('[data-afadd]')) {
        if (!addState) return;
        const free = addState.bank === BANK_FREE;
        const name = (free ? addState.freeBank : addState.bank).trim();
        if (!name) return show('銀行名を入力してください');
        if (!addState.branch.trim() && !addState.number.trim()) {
          return show('支店名か口座番号を入力してください');
        }
        const bank = S.addBank(name);
        S.addAccount(bank, {
          kind: addState.kind, branch: addState.branch, number: addState.number,
          owner: addState.owner, roles: [...addState.roles]
        });
        addState = null;
        renderAddForm();
        render();
        const book = sec.querySelector('.pb[data-bank="' + bank.id + '"]');
        if (book) {
          book.scrollIntoView({ behavior: 'smooth', block: 'start' });
          book.classList.add('hit');
        }
        show(name + 'を追加しました');
      }
    });
  }

  /* 一覧は目次。押すと下の該当通帳へ送り、着いたことが分かるよう
     一瞬だけ縁を光らせる。開閉も編集もしない。                    */
  if (shelf) shelf.addEventListener('click', e => {
    const btn = e.target.closest('[data-goto]');
    if (!btn) return;
    const book = sec.querySelector('.pb[data-bank="' + btn.dataset.goto + '"]');
    if (!book) return;
    book.scrollIntoView({ behavior: 'smooth', block: 'start' });
    book.classList.remove('hit');
    void book.offsetWidth;
    book.classList.add('hit');
  });

  render();
})(window.SeiZenBank);
