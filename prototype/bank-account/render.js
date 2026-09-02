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

  /* ── 描く ─────────────────────────────────────────── */

  /* 口座情報の1行。クリックすると同じ行がそのまま入力欄になる。 */
  function accountRow(bank, acc, i) {
    const tags = acc.roles.length
      ? acc.roles.map(r => '<span class="u">' + esc(r) + '</span>').join('')
      : '<span class="u q">用途をあとで確認する</span>';
    return '<tr data-bank="' + bank.id + '" data-acc="' + i + '">' +
      '<td>' + esc(acc.kind) + '</td>' +
      '<td>' + esc(acc.branch || '—') + '</td>' +
      '<td>' + esc(acc.number || '—') + '</td>' +
      '<td>' + esc(acc.owner || '—') + '</td>' +
      '<td>' + tags + '</td></tr>';
  }

  function accountForm(bank, acc, i) {
    const kinds = S.KINDS.map(k =>
      '<option' + (acc && k === acc.kind ? ' selected' : '') + '>' + k + '</option>').join('');
    const roles = S.ROLES.map(r =>
      '<button class="rtag' + (acc && acc.roles.includes(r) ? ' on' : '') +
      '" type="button">' + r + '</button>').join('');
    return '<tr class="edit" data-bank="' + bank.id + '" data-acc="' + i + '">' +
      '<td><select class="ef f-kind">' + kinds + '</select></td>' +
      '<td><input class="ef f-branch" placeholder="支店名" value="' + esc(acc ? acc.branch : '') + '"></td>' +
      '<td><input class="ef f-no" placeholder="口座番号" value="' + esc(acc ? acc.number : '') + '"></td>' +
      '<td><input class="ef f-owner" placeholder="名義人" value="' + esc(acc ? acc.owner : '') + '"></td>' +
      '<td><div class="ed"><span class="roles">' + roles + '</span>' +
      '<span class="eact">' + (acc ? '<button class="e-del" type="button">削除</button>' : '') +
      '<button class="e-no" type="button">やめる</button>' +
      '<button class="e-ok" type="button">保存</button></span></div></td></tr>';
  }

  /* 制度アイコンは「必要時の対応」と「手続きに必要なもの」で共有する。
     同じ制度を指すのに見た目が違うと、別々の話に見えてしまうので。 */
  const sitIcon = p => p.situation === 'capacity' ? 'sit_name' : 'sit_card';

  /* ① 必要時の対応。制度カードは白地の並列2枚。制度名は銀行が決める
     ものなので表示専用。編集できるのは進捗（state）・対象者（who）・
     補足（note）で、それぞれをクリックした場所がそのまま入力欄になる
     ── 口座情報・持ち物と同じ作法。カード全体をクリックの的にしない。 */
  function sitField(bank, p, i, field) {
    return editing && editing.type === 'prep' && editing.bank === bank.id &&
           editing.index === i && editing.field === field;
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

  function sitCard(bank, p, i) {
    const st = S.prepState(p), sit = S.situation(p.situation);
    const means = S.prepMeans(bank, p);

    /* 大きめのアイコンの右に、状況と制度名を縦に積む。「どんなときの、
       何という手続きか」がひと塊で読める。                          */
    const head = '<div class="sit-head"><span class="sit-ic">' + svg(sitIcon(p), 30) + '</span>' +
      '<div class="sit-headtx">' +
      '<div class="sit-cap">' + esc(sit.label.replace(/とき$/, '場合')) + '</div>' +
      '<div class="sit-mean">' + esc(means || '仕組みなし') + '</div></div></div>';

    /* 進捗バッジ。クリックするとその場で select に変わり、選ぶと即確定。
       判断能力があるうちにしか申し込めない制度で未対応・確認中のときは、
       期限（lead）を前に出し、進捗（tail）を後ろに添える。            */
    const lb = S.prepStateLabel(p);
    const badgeTone = lb.lead ? 'r-urg' : st.tone;
    const badge = sitField(bank, p, i, 'state')
      ? '<select class="ef sit-badge-ef" data-bank="' + bank.id + '" data-prep="' + i + '" autofocus>' +
        S.prepStateOptions().map(o =>
          '<option value="' + esc(o.value) + '"' + (o.value === p.state ? ' selected' : '') + '>' +
          esc(o.label) + '</option>').join('') + '</select>'
      : '<button class="sit-badge ' + badgeTone + (lb.lead && lb.tail ? ' two' : '') +
        '" type="button" data-bank="' + bank.id + '" data-prep="' + i + '" data-field="state">' +
        (lb.lead ? '<span class="sit-badge-lead">' + esc(lb.lead) + '</span>' : '') +
        (lb.lead && lb.tail ? '<span class="sit-badge-tail">' + esc(lb.tail) + '</span>' : '') +
        (lb.lead ? '' : esc(lb.tail)) + '</button>';

    /* バッジの下は、済ませた日だけを出す場所。 */
    const badgeSub = (p.state === '対応済み' && p.doneOn)
      ? '<div class="sit-sub">' + esc(p.doneOn) + ' 対応</div>'
      : '<div class="sit-sub empty"></div>';

    /* 任せる人とメモは、点線の下にラベルと値を並べた明細として置く。
       どこが入力できる場所なのかが、ラベルの並びそのもので分かる。   */
    const whoHint = WHO_HINT[p.situation] || '例：長男（ひろし）';
    const who = sitField(bank, p, i, 'who')
      ? '<input class="ef sit-who-ef" data-bank="' + bank.id + '" data-prep="' + i + '" value="' + esc(p.who) +
        '" placeholder="' + esc(whoHint) + '" autofocus>'
      : '<span class="sit-val' + (p.who ? '' : ' ph') + '" data-bank="' + bank.id + '" data-prep="' + i + '" data-field="who">' +
        esc(p.who || whoHint) + '</span>';

    const noteHint = NOTE_HINT[p.situation] || '例：必要な書類を確認しておく';
    const note = sitField(bank, p, i, 'note')
      ? '<input class="ef sit-note-ef" data-bank="' + bank.id + '" data-prep="' + i + '" value="' + esc(p.note) +
        '" placeholder="' + esc(noteHint) + '" autofocus>'
      : '<span class="sit-val' + (p.note ? '' : ' ph') + '" data-bank="' + bank.id + '" data-prep="' + i + '" data-field="note">' +
        esc(p.note || noteHint) + '</span>';

    /* 制度の説明が先、それがいつ効いてくるかの補足が後。仕組みが
       ない銀行では説明することがないので、その事実だけを書く。       */
    const desc = means
      ? '<div class="sit-about">' + esc(sit.about) + '</div>' +
        '<div class="sit-when">' + esc(sit.when) + '</div>'
      : '<div class="sit-about">この銀行にはこの仕組みがありません。</div>';

    /* 枠線の色も状態から引く。カードを一目見た瞬間に、そこが片付いて
       いるのか急ぐのかが分かる。塗りつぶさずに輪郭だけで伝える。     */
    return '<div class="sit s-' + badgeTone + '" data-bank="' + bank.id + '" data-prep="' + i + '">' +
      '<div class="sit-row">' + head +
        '<div class="sit-badge-wrap">' + badge + badgeSub + '</div></div>' +
      desc +
      '<dl class="sit-dl">' +
        '<dt>任せる人</dt><dd>' + who + '</dd>' +
        '<dt>メモ</dt><dd>' + note + '</dd>' +
      '</dl>' +
      '</div>';
  }

  /* ② 手続きに必要なもの。制度ごとの列。1行目にアイコン・名前・状態、
     2行目に保管場所を置く2段組みにして、場所の文字が切れないようにする。
     クリックの的は行全体ではなく、状態バッジと保管場所のそれぞれ
     ── 「必要時の対応」と同じ作法。                                 */
  function kitField(bank, pi, i, field) {
    return editing && editing.type === 'kit' && editing.bank === bank.id &&
           editing.prep === pi && editing.index === i && editing.field === field;
  }

  function kitRow(bank, pi, k, i) {
    const st = S.kitState(k);
    const icon = ITEM_ICON[k.item] || 'item_doc';
    const at = ' data-bank="' + bank.id + '" data-prep="' + pi + '" data-kit="' + i + '"';

    /* 選択肢が2つしかない品目は、クリックでその場を行き来させる方が
       セレクトを開くより速い。3つ以上ある品目（発行なし等も選べる
       通帳・キャッシュカードなど）だけ、従来通り選択肢を開く。       */
    const stOptions = S.kitStatesFor(k.item);
    const state = stOptions.length > 2
      ? (kitField(bank, pi, i, 'kstate')
          ? '<select class="ef kit-st-ef"' + at + ' autofocus>' +
            stOptions.map(s => '<option' + (s === k.state ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>'
          : '<button class="st" type="button"' + at + ' data-kfield="kstate">' + esc(k.state) + '</button>')
      : '<button class="st" type="button"' + at + ' data-kfield="kstate" data-ktoggle="1">' + esc(k.state) + '</button>';

    /* 未入力の欄には例を薄く出す。値としては空のままなので、
       クリックしてもその文字を消す手間はいらない。                 */
    const whHint = WHERE_HINT[k.item] || '例：自宅・書類ケース';
    const where = kitField(bank, pi, i, 'where')
      ? '<input class="ef kit-wh-ef"' + at + ' value="' + esc(k.where) + '" placeholder="' + esc(whHint) + '" autofocus>'
      : '<span class="wh' + (k.where ? '' : ' ph') + '"' + at + ' data-kfield="where">' +
        esc(k.where || whHint) + '</span>';

    return '<li class="' + st.tone + '"' + at + '>' +
      '<div class="kit-l1"><span class="ic2">' + svg(icon, 19) + '</span>' +
      '<span class="nm2">' + esc(k.item) + '</span>' + state + '</div>' +
      '<div class="kit-l2">' + where + '</div></li>';
  }

  function kitGroup(bank, p, pi) {
    const means = S.prepMeans(bank, p);
    return '<div class="kit-col">' +
      '<div class="kit-col-h"><span class="ic">' + svg(sitIcon(p), 18) + '</span>' +
      '<span class="nm">' + esc(means || '仕組みなし') + 'に必要なもの</span></div>' +
      (p.kit.length
        ? '<div class="kit"><ul>' + p.kit.map((k, i) => kitRow(bank, pi, k, i)).join('') + '</ul></div>'
        : '<div class="kit-empty">この銀行にはこの仕組みがありません。</div>') + '</div>';
  }

  /* 大事なのは判断能力低下（urgent）側。左に置く。実データの並び
     （immobile→capacity）は変えず、表示順だけをここで決める。       */
  function displayOrder(bank) {
    return bank.prep
      .map((p, i) => i)
      .sort((a, b) => (S.situation(bank.prep[b].situation).urgent ? 1 : 0) -
                      (S.situation(bank.prep[a].situation).urgent ? 1 : 0));
  }

  function blockHead(num, label, extra) {
    return '<div class="blk-h"><span class="num">' + num + '</span><b>' + esc(label) + '</b>' +
      (extra ? '<span>' + extra + '</span>' : '') + '</div>';
  }

  function bookHTML(bank) {
    const badge = S.bankBadge(bank);
    const addingHere = editing && editing.type === 'acc' &&
                       editing.bank === bank.id && editing.index === bank.accounts.length;

    let acctRows = bank.accounts.map((a, i) =>
      (editing && editing.type === 'acc' && editing.bank === bank.id && editing.index === i)
        ? accountForm(bank, a, i) : accountRow(bank, a, i)).join('');
    if (addingHere) acctRows += accountForm(bank, null, bank.accounts.length);

    const count = bank.accounts.length;

    return '<div class="pb' + (bank.dormant ? ' gy' : '') + '" data-bank="' + bank.id + '">' +
      '<div class="cv"><span class="nm">' + esc(bank.name) + '</span>' +
      '<span class="kd">口座 ' + count + '件</span>' +
      '<span class="bd' + (badge.cls === 'warn' ? '' : ' off') + '">' + badge.text.replace(/\s/g, '') + '</span></div>' +

      '<div class="body">' +

      '<div class="blk">' + blockHead('①', '必要時の対応', '（家族が代わりに手続きするための方法）') +
      '<div class="sit-grid">' + displayOrder(bank).map(i => sitCard(bank, bank.prep[i], i)).join('') + '</div></div>' +

      '<div class="blk">' + blockHead('②', '手続きに必要なもの', '（方法ごとに必要な情報・物が異なります）') +
      '<div class="kit-grid">' + displayOrder(bank).map(i => kitGroup(bank, bank.prep[i], i)).join('') + '</div></div>' +

      '<div class="blk">' + blockHead('③', '口座情報') +
      '<div class="acctinfo"><table><thead><tr><th>口座種別</th><th>支店名</th><th>口座番号</th><th>名義人</th><th>用途</th></tr></thead>' +
      '<tbody>' + acctRows + '</tbody></table></div></div>' +

      (bank.note ? '<div class="ft"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
        'stroke="#6B6963" stroke-width="1.8"><circle cx="12" cy="12" r="9"/>' +
        '<path d="M12 8v5M12 16h.01"/></svg>' + esc(bank.note) + '</div>' : '') +
      '</div>' +
      '<button class="addrow" data-add="' + bank.id + '"><span class="plus">＋</span>' +
        esc(bank.name) + 'に口座を追加</button>' +
      '<button class="del" type="button" data-bank="' + bank.id + '" title="' + esc(bank.name) + 'を削除" aria-label="' + esc(bank.name) + 'を削除">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/></svg></button>' +
      '</div>';
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
    /* 仕組みが無い銀行は、その事実自体が一覧で一番効く情報。ただし
       別の手を検討していることが記録されていれば、バッジをそちらに
       替える。「不可」で終わらせると次の一手が一覧から消えるので。
       検討の中身（任意後見など）はこの行に入れると状況の説明ごと
       切れてしまうため、下の通帳で読ませる。                       */
    if (!means) {
      const alt = p.state === '別の方法を検討';
      return '<li class="sh-sit none">' +
        '<span class="ic">' + svg(sitIcon(p), 17) + '</span>' +
        '<span class="nm">仕組みなし</span>' +
        '<span class="cap">' + esc(sit.label.replace(/とき$/, '場合')) + '</span>' +
        '<span class="st ' + (alt ? 'alt' : 'na') + '">' +
          (alt ? '別の方法を検討' : 'この銀行では不可') + '</span></li>';
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

  /* 表紙の地紋。銀行ごとに固定の1枚を割り当てる。写実的な箔ではなく、
     冊子だと分かる程度の淡い織り柄をインライン SVG で表紙に敷く。
     ベクターなのでカード幅が変わっても密度が保たれる（ラスターだと
     1カラム落ちで間延びする）。柄は白の線だけで描き、opacity は
     .sh-weave 側で寝かせる。並び順で回すので銀行が増えても破綻しない。 */
  const WEAVE_TILE = {
    /* 縦の箔ストライプ。通帳の表紙で一番よくある型。 */
    stripe: '<pattern id="w-stripe" width="9" height="9" patternUnits="userSpaceOnUse">' +
            '<path d="M0 0V9M4.5 0V9" stroke="#fff" stroke-width="1"/></pattern>',
    /* クローバー。4枚の葉を小円で。ゆうちょの地紋の見立て。 */
    clover: '<pattern id="w-clover" width="26" height="26" patternUnits="userSpaceOnUse">' +
            '<g fill="none" stroke="#fff" stroke-width="1">' +
            '<circle cx="13" cy="9" r="3"/><circle cx="9" cy="13" r="3"/>' +
            '<circle cx="17" cy="13" r="3"/><circle cx="13" cy="17" r="3"/>' +
            '<path d="M13 13v6"/></g></pattern>',
    /* 葉脈。斜めの主脈から羽状に。ソニー銀行の見立て。 */
    vein:   '<pattern id="w-vein" width="30" height="30" patternUnits="userSpaceOnUse" patternTransform="rotate(20)">' +
            '<g fill="none" stroke="#fff" stroke-width="1">' +
            '<path d="M0 15h30"/><path d="M7 15l-4-5M7 15l-4 5M15 15l-4-5M15 15l-4 5M23 15l-4-5M23 15l-4 5"/>' +
            '</g></pattern>'
  };
  const WEAVES = ['stripe', 'clover', 'vein'];
  const weaveFor = bank => WEAVES[S.banks.indexOf(bank) % WEAVES.length];
  const weaveSVG = key =>
    '<svg class="sh-weave" aria-hidden="true" width="100%" height="100%" preserveAspectRatio="none">' +
    '<defs>' + WEAVE_TILE[key] + '</defs>' +
    '<rect width="100%" height="100%" fill="url(#w-' + key + ')"/></svg>';

  function shelfCard(bank) {
    const badge = S.bankBadge(bank);
    const t = S.tally(bank);
    const kinds = shelfKinds(bank);
    const roles = shelfRoles(bank);
    const weave = weaveFor(bank);

    /* 上層＝通帳の表紙。銀行名・口座数・名義だけを置く。「預金通帳」
       の箔押しは名乗りとして読み手に要らない情報で、その1行のぶん
       だけカードが縦に伸びていたので外した。                      */
    const owner = (bank.accounts.find(a => a.owner) || {}).owner || '';
    const face =
      '<div class="sh-face">' +
        '<div class="sh-nm">' + esc(bank.name) + '</div>' +
        '<div class="sh-meta">' +
          '<span class="sh-cnt">口座 ' + bank.accounts.length + '件</span>' +
          (kinds.length ? '<span class="sh-kd">' + esc(kinds.join('・')) + '</span>' : '') +
          (owner ? '<span class="sh-ow"><i>名義</i>' + esc(owner) + '</span>' : '') +
        '</div>' +
        '<span class="sh-bd' + (badge.cls === 'warn' ? '' : ' off') + '">' +
          esc(badge.text.replace(/\s/g, '')) + '</span>' +
      '</div>';

    /* 下層＝SeiZen の記録。制度2行のあとに、持ち物の数と用途。
       期限の警告は制度ごとのバッジ（今のうちの対応が必要）に
       もう出ているので、カード上部でも繰り返さない。              */
    const body =
      '<div class="sh-body">' +
        '<ul class="sh-sits">' + displayOrder(bank).map(i => shelfSitRow(bank, bank.prep[i])).join('') + '</ul>' +
        '<div class="sh-foot">' +
          '<span class="sh-kit' + (t.open ? ' open' : '') + '">持ち物 ' + t.done + '/' + (t.done + t.open) + ' 確認済み</span>' +
          '<span class="sh-use">' + (roles.length ? esc(roles.join('・')) : '用途 未入力') + '</span>' +
        '</div>' +
      '</div>';

    return '<button class="shbook' + (bank.dormant ? ' gy' : '') + '" type="button" data-goto="' + bank.id + '">' +
      weaveSVG(weave) +
      '<span class="sh-spine" aria-hidden="true"></span>' +
      '<span class="sh-edge r" aria-hidden="true"></span>' +
      '<span class="sh-edge b" aria-hidden="true"></span>' +
      face + body + '</button>';
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
    sec.innerHTML = S.banks.map(bookHTML).join('');
    if (draft) sec.appendChild(draftEl());
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
      const el = sec.querySelector('.acctinfo tr.edit .f-branch');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      return;
    }
    const sel = editing.type === 'prep'
      ? (editing.field === 'state' ? '.sit-badge-ef' :
         editing.field === 'who'   ? '.sit-who-ef'   : '.sit-note-ef')
      : (editing.field === 'kstate' ? '.kit-st-ef' : '.kit-wh-ef');
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
    if (!confirm(bank.name + 'を削除します。登録した口座情報もすべて削除されます。よろしいですか？')) return;
    if (editing && editing.bank === id) editing = null;
    S.removeBank(id);
    render();
    show(bank.name + 'を削除しました');
  }

  /* 備えの1フィールドだけを書き換える。行の形を保ったまま、
     値のあった場所がそのまま入力欄になる仕組みと対になる書き込み。   */
  function commitPrepField(bank, i, field, value, msg) {
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
    editing = null;
    render();
    show(msg);
  }

  /* 持ち物も同じく1フィールドずつ。銀行の更新日はここでも進む。 */
  function commitKitField(el, field, value, msg) {
    const bank = S.findBank(el.dataset.bank);
    const k = bank.prep[+el.dataset.prep].kit[+el.dataset.kit];
    if (field === 'kstate') k.state = value;
    if (field === 'where')  k.where = value.trim();
    bank.updated = S.today();
    editing = null;
    render();
    show(msg);
  }

  sec.addEventListener('change', e => {
    const p = e.target.closest('.sit-badge-ef');
    if (p) return commitPrepField(S.findBank(p.dataset.bank), +p.dataset.prep, 'state', p.value, '対応状況を更新しました');
    const k = e.target.closest('.kit-st-ef');
    if (k) return commitKitField(k, 'kstate', k.value, '持ち物の状況を更新しました');
  });

  sec.addEventListener('focusout', e => {
    const who = e.target.closest('.sit-who-ef'), note = e.target.closest('.sit-note-ef');
    if (who) return commitPrepField(S.findBank(who.dataset.bank), +who.dataset.prep, 'who', who.value, '対象者を更新しました');
    if (note) return commitPrepField(S.findBank(note.dataset.bank), +note.dataset.prep, 'note', note.value, '補足を更新しました');
    const wh = e.target.closest('.kit-wh-ef');
    if (wh) return commitKitField(wh, 'where', wh.value, '保管場所を更新しました');
  });

  sec.addEventListener('click', e => {
    const t = e.target;

    /* 用途タグはその場で拾う。確定するまで事実には触れない。 */
    if (t.classList.contains('rtag')) { t.classList.toggle('on'); return; }

    /* 銀行ごと削除。カード内のどこよりも先に拾う。 */
    const delBtn = t.closest('.pb > .del');
    if (delBtn) return deleteBank(delBtn.dataset.bank);

    /* 口座情報の行 -------------------------------------------- */
    const acctTr = t.closest('.acctinfo tr[data-acc]');
    if (acctTr) {
      if (t.closest('.e-ok')) return commitAccount(acctTr, true);
      if (t.closest('.e-del')) return deleteAccount(acctTr);
      if (t.closest('.e-no')) {
        editing = null; render();
        show(+acctTr.dataset.acc < S.findBank(acctTr.dataset.bank).accounts.length
          ? '編集をとりやめました' : '入力をとりやめました');
        return;
      }
      if (!acctTr.classList.contains('edit')) {
        editing = { type: 'acc', bank: acctTr.dataset.bank, index: +acctTr.dataset.acc };
        render();
      }
      return;
    }

    /* 行を足す。カードの外のボタンから、最後の行に続けて開く。 */
    const add = t.closest('.addrow');
    if (add) {
      const bank = S.findBank(add.dataset.add);
      editing = { type: 'acc', bank: bank.id, index: bank.accounts.length };
      render();
      return;
    }

    /* 備え。バッジ・対象者・補足は、それぞれをクリックした場所だけが
       入力欄になる（口座情報・持ち物と同じ作法。カード全体は的にしない）。 */
    const fieldEl = t.closest('[data-field]');
    if (fieldEl) {
      editing = { type: 'prep', bank: fieldEl.dataset.bank, index: +fieldEl.dataset.prep, field: fieldEl.dataset.field };
      render();
      return;
    }
    if (t.closest('.sit[data-prep]')) return;

    /* 持ち物。2値の状態は選択肢を開かず、クリックのたびに行き来させる。
       保管場所や3値以上の状態は、クリックした場所がそのまま入力欄になる。 */
    const kToggle = t.closest('[data-ktoggle]');
    if (kToggle) {
      const bank = S.findBank(kToggle.dataset.bank);
      const k = bank.prep[+kToggle.dataset.prep].kit[+kToggle.dataset.kit];
      const opts = S.kitStatesFor(k.item);
      const next = opts[(opts.indexOf(k.state) + 1) % opts.length];
      return commitKitField(kToggle, 'kstate', next, '持ち物の状況を更新しました');
    }
    const kEl = t.closest('[data-kfield]');
    if (kEl) {
      editing = { type: 'kit', bank: kEl.dataset.bank, prep: +kEl.dataset.prep,
                  index: +kEl.dataset.kit, field: kEl.dataset.kfield };
      render();
      return;
    }
    if (t.closest('li[data-kit]')) return;
  });

  /* Enter で確定、Escape でやめる。手が入力欄から離れない。 */
  sec.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (draft) { draft = null; editing = null; render(); show('銀行の追加をとりやめました'); return; }
      if (editing) { editing = null; render(); }
      return;
    }
    if (e.key !== 'Enter') return;
    const acctTr = e.target.closest('.acctinfo tr.edit');
    if (acctTr && !e.target.classList.contains('rtag')) { e.preventDefault(); commitAccount(acctTr, true); return; }
    if (e.target.closest('.sit-who-ef, .sit-note-ef, .kit-wh-ef')) { e.preventDefault(); e.target.blur(); }
  });

  /* ── 新しい銀行は、カードごと増える ────────────────── */
  let draft = null;   // {query:''}

  function startDraft() {
    if (draft) return sec.querySelector('.f-bank').focus();
    draft = { query: '' };
    render();
    sec.querySelector('.f-bank').focus();
  }

  function draftEl() {
    const book = document.createElement('div');
    book.className = 'pb draft';
    book.innerHTML =
      '<div class="cv"><span class="namewrap"><input class="f-bank" placeholder="銀行名を入力（例：三菱UFJ）" value="' +
        esc(draft.query) + '"><ul class="sug"></ul></span></div>' +
      '<div class="pending"><svg viewBox="0 0 24 24" fill="none" stroke="#9B988E" stroke-width="1.8">' +
      '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
      '<span>銀行名が決まると、その銀行で使える備えを自動で確認します。</span></div>';

    const input = book.querySelector('.f-bank'), sug = book.querySelector('.sug');

    const suggest = () => {
      const q = input.value.trim();
      draft.query = q;
      sug.innerHTML = '';
      if (!q) return;
      S.BANKS.filter(b => b.name.includes(q)).slice(0, 5).forEach(b => {
        const has = S.SITUATIONS.filter(s => b.means[s.id] !== null).length;
        const summary = has === 0 ? '代理の仕組みなし' : has === S.SITUATIONS.length ? '代理の仕組みあり' : '代理の仕組みは一部のみ';
        const li = document.createElement('li');
        li.dataset.name = b.name;
        li.innerHTML = esc(b.name) + '<small>' + esc(summary) + '</small>';
        li.addEventListener('mousedown', ev => { ev.preventDefault(); pick(b.name); });
        sug.append(li);
      });
    };
    input.addEventListener('input', suggest);
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const hot = sug.querySelector('li');
        pick(hot ? hot.dataset.name : input.value.trim());
      }
      if (ev.key === 'Escape') { draft = null; render(); show('銀行の追加をとりやめました'); }
    });

    /* 銀行名が決まった時点でカードが確定し、そのまま記帳へ進む。 */
    function pick(name) {
      name = (name || '').trim();
      if (!name) return show('銀行名を入力してください');
      const bank = S.addBank(name);
      draft = null;
      editing = { type: 'acc', bank: bank.id, index: 0 };
      render();
      show(name + 'を追加しました');
    }
    if (draft.query) suggest();
    return book;
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

  /* 見出し横の登録ボタンは #books の外にあるので、専用に配線する。 */
  const addBtn = document.getElementById('addbank');
  if (addBtn) addBtn.addEventListener('click', startDraft);

  render();
})(window.SeiZenBank);
