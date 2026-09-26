/* この物件の確認・記録。入口が違っても state.js の同じ記録を編集する。 */
(function () {
  'use strict';
  /* 画面の文で対象の家族を呼ぶ続柄（既定「父」）。「本人」とは書かない
     ―― 操作するのは基本的に家族で、読み手が迷う（2026-09-24）。 */
  const WHO = (window.SeiZen && window.SeiZen.person && window.SeiZen.person.rel) || '父';
  const SPOUSE = (window.SeiZen && window.SeiZen.person && window.SeiZen.person.spouse) || '母';
  const S = window.SeiZenRealEstate;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const field = (name, label, value, wide, hint) => '<label class="re-field' + (wide ? ' wide' : '') + '"><span>' + esc(label) + '</span>' +
    (wide ? '<textarea rows="3" name="' + name + '">' + esc(value) + '</textarea>' : '<input name="' + name + '" value="' + esc(value) + '">') +
    (hint ? '<small>' + esc(hint) + '</small>' : '') + '</label>';
  const select = (name, label, value, options) => '<label class="re-field"><span>' + esc(label) + '</span><select name="' + name + '">' +
    options.map(([v, text]) => '<option value="' + v + '"' + (value === v ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select></label>';
  /* 質問ひとつ＝問い＋選択肢を並べて見せる（前の代の相続登記で使う）。
     プルダウンにしない ―― 開くまで選択肢が見えず、長い選択肢は切れる。
     pill は短い選択肢を横に、row は説明の要る選択肢を縦に並べる。 */
  const choice = (name, value, options, kind, type) => '<div class="re-opts ' + (kind || 'pill') + '"' + (type === 'checkbox' ? '' : ' role="radiogroup"') + '>' +
    options.map(([v, label, sub, attr]) => '<label class="re-opt"' + (attr || '') + '><input type="' + (type || 'radio') + '" name="' + (type === 'checkbox' ? name + v : name) + '" value="' + (type === 'checkbox' ? 'on' : v) + '"' +
      ((type === 'checkbox' ? (value || []).includes(v) : v === value) ? ' checked' : '') + '><span><b>' + esc(label) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></label>').join('') + '</div>';
  const question = (title, body, hint, attr) => '<div class="re-q"' + (attr || '') + '><p class="re-q-t">' + title + '</p>' + body +
    (hint ? '<p class="re-q-h">' + esc(hint) + '</p>' : '') + '</div>';
  const section = (title, html, attr) => '<fieldset' + (attr || '') + '><legend>' + esc(title) + '</legend>' + html + '</fieldset>';
  const group = (title, html, note) => '<fieldset><legend>' + esc(title) + '</legend>' + (note ? '<p class="re-group-note">' + esc(note) + '</p>' : '') + '<div class="re-fields">' + html + '</div></fieldset>';
  const nextFields = v => group('残っている確認・対応', field('next', '次にすること', v.next, true, '分かったところまで保存できます。残る確認があれば書き留めてください。') + field('assignee', '確認する人', v.assignee) + field('timing', '確認する時期・きっかけ', v.timing));
  const docOptions = [['unknown', '所在が分からない'], ['have', '所在が分かる'], ['lost', '探したが見つからない']];
  const known = [['unknown', '分からない'], ['yes', 'あり'], ['no', 'なし']];
  const titles = { boundary: '境界・越境の取り決め', road: '私道・通行・配管の取り決め', changed: '建物の変更・登記' };
  /* 1件ぶんのブロックの頭：番号・名前・答えの要約（右端に削除の入口が続く）。
     番号と要約は conditionals が並び順と答えから入れ、頭の目次（renderToc）も同じものを写す。 */
  const entryHead = (attr, title) => '<div class="re-entry-h"><span class="re-entry-no" aria-hidden="true"></span>' +
    '<b ' + attr + ' tabindex="-1">' + esc(title) + '</b><span class="re-entry-sub" data-sub></span>';
  /* 件を削除する入口と、その確認の吹き出し（医療・介護の .rowdel-ask と同じ形：
     問い1行＋「やめる｜削除する」）。押してすぐ消えると、入力した中身ごと戻せない。
     入口は ✕ にしない ―― ダイアログ右上の「閉じる」✕ と並び、件を畳む意味に読める。
     「外す」とも書かない ―― 取り決めそのものを解いたように読めた（2026-09-26）。
     読み上げ用の名前（「右隣との取り決めを削除」）は renderToc が件の名前から入れる。 */
  const entryDel = '<span class="re-entry-delw"><button type="button" class="re-entry-del" data-entry-del aria-expanded="false">削除</button>' +
    '<span class="re-entry-ask" role="alertdialog" aria-label="削除の確認" hidden><span>削除しますか？</span>' +
    '<span class="re-entry-ask-btns"><button type="button" class="re-entry-cancel" data-entry-no>やめる</button>' +
    '<button type="button" class="re-entry-yes" data-entry-yes>削除する</button></span></span></span>';
  /* 境界：隣1つぶんの取り決め。名前は e<番号>-… で、番号は足した順（削除しても詰めない）。
     決めたことは、チェックを入れた項目のすぐ下にその問いを開く。 */
  function bdEntry(i, e) {
    const n = k => 'e' + i + '-' + k;
    const kinds = e.kinds || [];
    const overs = e.overs || [];
    const ownerOf = k => (overs.find(o => o.what === k) || {}).owner || 'ours';
    const P = bdName;
    /* 〈隣〉は選んだ隣の名前（右隣など）に差し替える。「こちら／隣」とは書かない
       ―― 位置の「こちら側の面」と持ち主の「こちらのもの」が混ざって読みにくかった。
       隣は方角でなく、玄関を出た向きで聞く（「玄関から見て」は、外を向くか
       玄関を向くかで左右が逆になるので、動作で言う）。
       越境は向きを聞かず、持ち主を聞く（2軒の間なので持ち主で向きが決まる）。
       目印の「その塀は誰のものですか」と同じ形に揃える。
       選べない選択肢には、その下に理由を出す（data-e-why。conditionals）。 */
    const nb = html => html.replace(/〈隣〉/g, '<span data-nb>隣</span>');
    /* 見出しは選んだ相手の名前にする（「隣との取り決め」の下で「どの隣ですか」と
       聞くと、同じことを二度言う。裏の家は「隣」とは呼ばない）。 */
    return nb('<div class="re-entry" data-entry="' + i + '">' + entryHead('data-e-title', entryTitle(e.side)) +
      entryDel + '</div>' +
      question('相手はどの家ですか', choice(n('side'), e.side || '', [['right', '右隣'], ['left', '左隣'], ['back', '裏の家']]) +
        '<div class="re-q-sub"><input class="re-q-in" name="' + n('who') + '" value="' + esc(e.who) + '" placeholder="相手の名前（分かれば）" autocomplete="off" aria-label="相手の名前"></div>',
        '玄関を出て見た向きで。裏の家は、玄関の反対側の家。') +
      question('決めたこと',
        choice(n('kind-'), kinds, [['line', '境界の位置', '塀の中心を境界にした、など']], 'row multi', 'checkbox') +
        '<div class="re-sub" data-e-line><p class="re-sub-t">何を目印に決めましたか</p>' +
          choice(n('mark'), ['wall', 'stake'].includes(e.mark) ? e.mark : 'none', [['wall', '塀'], ['stake', '境界標（杭・金属の鋲など）'], ['none', '目印はない']]) +
          '<p class="re-why" data-e-why="mark" hidden></p>' +
          '<div data-e-wall><p class="re-sub-t">その塀は誰のものですか</p>' + choice(n('wallOwner'), e.wallOwner || 'both', [
            ['both', '両家のもの', '境界の上に建っている'], ['ours', P + 'のもの', P + 'の土地に建っている'], ['theirs', '〈隣〉のもの', '〈隣〉の土地に建っている']], 'row') + '</div></div>' +
        choice(n('kind-'), kinds, [['over', '越境しているものの扱い', '塀・屋根・枝・配管などが境界を越えている']], 'row multi', 'checkbox') +
        /* 越えているものは複数ありうる（隣の木の枝と自宅の配管、など）。
           持ち主はものごとに違うので、選んだものの数だけ持ち主を聞く。 */
        '<div class="re-sub" data-e-over><p class="re-sub-t">何が越えていますか（いくつでも）</p>' +
          choice(n('ow-'), overs.map(o => o.what), BD_OVER, 'pill', 'checkbox') +
          '<p class="re-why" data-e-why="over" hidden></p>' +
          BD_OVER.map(([k]) => '<div data-e-own="' + k + '"><p class="re-sub-t">' + BD_THING[k] + 'は誰のものですか</p>' +
            choice(n('oo-' + k), ownerOf(k), [['ours', P + 'のもの'], ['theirs', '〈隣〉のもの']]) +
            (k === 'footing' ? '<p class="re-why" data-e-why="owner" hidden></p>' : '') + '</div>').join('') + '</div>',
        '当てはまるものをすべて。') +
      question('書面にしてありますか', choice(n('paper'), e.paper || 'unknown', [['yes', '覚書・境界確認書がある'], ['no', '口頭のまま'], ['unknown', '分からない']])) +
      question('どんな書類ですか', choice(n('doc-'), e.docKinds || [], [
        ['confirm', '境界確認書', '隣と境界を確かめ、双方が署名したもの'], ['memo', '越境などの覚書'],
        ['map', '測量図', '地積測量図・確定測量図など']], 'row multi', 'checkbox'), '当てはまるものをすべて。', ' data-e-doc') +
      question('図面の作成日', choice(n('docAge'), e.docAge || 'unknown', [['after', '2005年3月以降'], ['before', 'それより前'], ['unknown', '分からない']]),
        '2005年3月以降の図面は、境界点の座標が入っています。', ' data-e-age') +
      /* 位置・持ち主は上で選んで答えるので、ここは選べないことだけを書く。 */
      question('ほかに決めたこと', '<textarea class="re-q-in" rows="2" name="' + n('content') + '">' + esc(e.content) + '</textarea>',
        '上で選んだこと以外に。例：越えている枝は、毎年秋に隣が切る。') + '</div>');
  }
  /* 私道・通行・配管：相手の土地1件ぶん。名前は l<番号>-…（足した順）。
     境界の「隣との取り決め」は写さない ―― 聞くのは、相手の土地・何に使うか・
     誰のための通行や管か（向き）・私道の持分・取り決め（state.js の roadStatus）。
     向きは使い方ごとに聞く（同じ相手との間に両向きがありうる）。前の私道では
     聞かない（私道はこの家が使う側）。 */
  function rdLink(i, l) {
    const n = k => 'l' + i + '-' + k;
    const uses = l.uses || [];
    const byOf = k => (uses.find(u => u.what === k) || {}).by || 'ours';
    const P = rdHome;
    const nb = html => html.replace(/〈相手〉/g, '<span data-rd>相手</span>');
    return nb('<div class="re-entry" data-link="' + i + '">' + entryHead('data-l-title', RD_LAND[l.land] || '相手の土地') +
      entryDel + '</div>' +
      question('相手はどの土地ですか', choice(n('land'), l.land || '', RD_LAND_OPTS) +
        '<div class="re-q-sub"><input class="re-q-in" name="' + n('who') + '" value="' + esc(l.who) + '" placeholder="持ち主の名前・どこの土地か（分かれば）" autocomplete="off" aria-label="持ち主の名前"></div>',
        '隣は、玄関を出て見た向きで。離れた土地や水路の向こうの土地は「ほかの土地」に。') +
      question('何に使っていますか', choice(n('use-'), uses.map(u => u.what), RD_USE_OPTS, 'pill', 'checkbox') +
        /* 向き：私道でなければ、選んだ使い方ごとに誰のためかを聞く。 */
        RD_USE_OPTS.map(([k]) => '<div class="re-sub" data-l-by="' + k + '"><p class="re-sub-t">' + (k === 'pass' ? '誰が通りますか' : 'その' + RD_PIPE_NAME[k] + 'の管は誰のものですか') + '</p>' +
          choice(n('by-' + k), byOf(k), k === 'pass'
            ? [['ours', P + 'の人', '〈相手〉の土地を通る'], ['theirs', '〈相手〉の人', P + 'の土地を通る']]
            : [['ours', P + 'の管', '〈相手〉の土地の下を通っている'], ['theirs', '〈相手〉の管', P + 'の土地の下を通っている']], 'row') + '</div>').join(''),
        '当てはまるものをすべて。') +
      question(P + 'も、この私道の持分を持っていますか', choice(n('share'), l.share || 'unknown', [['yes', '持っている'], ['no', '持っていない'], ['unknown', '分からない']]),
        '登記事項証明書で分かります（私道の地番で取ります）。', ' data-l-road') +
      question('取り決めはありますか', choice(n('pact'), l.pact || 'unknown', [
        ['paper', '承諾書・覚書がある'], ['oral', '口頭で決めた'], ['none', '特に決めていない'], ['unknown', '分からない']], 'row')) +
      question('決めた内容', '<textarea class="re-q-in" rows="2" name="' + n('content') + '">' + esc(l.content) + '</textarea>',
        '例：私道の舗装を直す費用は、4軒で等分する。建て替えるときは、隣の管を移す費用を隣が持つ。', ' data-l-content') + '</div>');
  }
  /* 建物の変更：変更1件ぶん。名前は c<番号>-…（足した順）。境界・私道のブロックは写さない
     ―― 聞くのは、何をしたか・場所と時期・この変更の記録（state.js の changedStatus）。
     「記録」は1つの問いにまとめ、登記／課税明細書／工事の書類を左に名前・右に選択肢で揃える。
     3つとも「この変更がどの記録に載っているか」の答えで、行の図が描く事実と同じ（以前は
     別々の問いにし、選択肢の形も長さ任せでばらばらだった：2026-09-26）。
     増える変更と取り壊しでは答えの言い方が逆になる（載っている／消えている）ので、値は
     同じにして言葉だけ差し替える（data-lg／data-ld）。場所と時期も同じ並べ方で1つに。 */
  const CH_WHAT = { ext: '増築', annex: '別棟', cut: '一部の取り壊し', demo: '取り壊し' };
  /* 並べる選択肢。opts＝[値, 増える変更の言葉, 取り壊しの言葉（省けば同じ）] */
  const pills = (name, value, opts) => '<div class="re-opts pill" role="radiogroup">' + opts.map(([v, lg, ld]) =>
    '<label class="re-opt"><input type="radio" name="' + name + '" value="' + v + '"' + (v === value ? ' checked' : '') + '><span><b' +
    (ld ? ' data-lg="' + esc(lg) + '" data-ld="' + esc(ld) + '"' : '') + '>' + esc(lg) + '</b></span></label>').join('') + '</div>';
  const line = (label, html, attr) => '<div class="re-ln"' + (attr || '') + '><span class="re-ln-lb">' + label + '</span><div class="re-ln-v">' + html + '</div></div>';
  /* いつごろ＝年を選ぶ（自由記入にしない）。建てた年から今年まで、和暦を添える。
     年が分からなくても登記はできるので「分からない」を先頭に。 */
  let chBuilt = 1950;
  const wareki = y => y >= 2019 ? '令和' + (y === 2019 ? '元' : y - 2018) + '年' : y >= 1989 ? '平成' + (y === 1989 ? '元' : y - 1988) + '年' : '昭和' + (y - 1925) + '年';
  function yearSelect(name, value) {
    const now = new Date().getFullYear(), ys = [];
    for (let y = now; y >= chBuilt; y--) ys.push(y);
    return '<select class="re-yr-sel" name="' + name + '" aria-label="いつごろ（年）"><option value="">分からない</option>' +
      ys.map(y => '<option value="' + y + '"' + (String(y) === String(value) ? ' selected' : '') + '>' + y + '年（' + wareki(y) + '）</option>').join('') + '</select>';
  }
  function chEntry(i, c) {
    const n = k => 'c' + i + '-' + k;
    return '<div class="re-entry" data-change="' + i + '">' + entryHead('data-c-title', CH_WHAT[c.what] || '変更') +
      entryDel + '</div>' +
      question('何をしましたか', choice(n('what'), c.what || '', [
        ['ext', '増築した', '横や上に部屋を足した'], ['annex', '別棟を建てた', '離れ・車庫・物置など'],
        ['cut', '一部を取り壊した', '部屋を減らした'], ['demo', '建物を取り壊した', '離れ・物置や、古い建物など']], 'row'),
        '物置でも、基礎に固定され、屋根と壁があれば建物として登記の対象になります。') +
      question('場所と時期', '<div class="re-lines">' +
        line('玄関から見て', pills(n('side'), c.side || '', [['back', '奥'], ['right', '右'], ['left', '左'], ['front', '玄関側']])) +
        line('階', pills(n('floor'), String(c.floor || 1), [['1', '1階'], ['2', '2階']]), ' data-c-floor') +
        line('何の建物', pills(n('bldg'), c.bldg || '', [['hanare', '離れ'], ['garage', '車庫'], ['shed', '物置'], ['other', 'その他']]), ' data-c-bldg') +
        line('<span data-c-partlb>どの部分</span>', '<input class="re-q-in" name="' + n('where') + '" value="' + esc(c.where) + '" placeholder="例：北側の約6畳" autocomplete="off" aria-label="どの部分">', ' data-c-part') +
        line('いつごろ', '<span class="re-yr">' + yearSelect(n('when'), c.when) + '<span>ごろ</span></span>') + '</div>',
        '分かる範囲で。年が分からなくても登記はできます。') +
      question('この変更の記録', '<div class="re-lines">' +
        line('登記', pills(n('reg'), c.reg || 'unknown', [['yes', '載っている', '消えている'], ['no', '載っていない', '残っている'], ['unknown', 'まだ確かめていない']])) +
        line('課税明細書', pills(n('tax'), c.tax || '', [['match', '載っている', '消えている'], ['miss', '載っていない', '残っている'], ['', 'まだ見ていない']]), ' data-c-tax') +
        line('工事の書類', pills(n('docs'), c.docs || 'unknown', [['yes', 'ある'], ['no', '見つからない'], ['unknown', 'まだ探していない']]) +
          '<div class="re-ln-sub" data-c-kinds>' + choice(n('kind-'), c.kinds || [], [
            ['confirm', '確認済証'], ['inspect', '検査済証'], ['contract', '工事請負契約書'], ['receipt', '領収書'], ['handover', '工事完了引渡証明書']], 'pill', 'checkbox') + '</div>', ' data-c-docs') +
        line('請け負った会社', '<input class="re-q-in" name="' + n('by') + '" value="' + esc(c.by) + '" placeholder="例：◯◯工務店" autocomplete="off" aria-label="工事を請け負った会社">', ' data-c-docs') + '</div>' +
        '<p class="re-q-h" data-c-rech></p>') + '</div>';
  }
  const RD_LAND = { road: '前の私道', right: '右隣', left: '左隣', back: '裏の家', other: 'ほかの土地' };
  const RD_LAND_OPTS = [['road', '前の私道'], ['right', '右隣'], ['left', '左隣'], ['back', '裏の家'], ['other', 'ほかの土地']];
  const RD_USE_OPTS = [['pass', '通る（出入りの道）'], ['water', '水道の管'], ['sewer', '下水の管'], ['gas', 'ガスの管']];
  const RD_PIPE_NAME = { water: '水道', sewer: '下水', gas: 'ガス' };
  const RD_USE_SHORT = { pass: '通る', water: '水道', sewer: '下水', gas: 'ガス' };
  const CH_SIDE = { back: '奥', right: '右', left: '左', front: '玄関側' };
  const CH_BLDG = { hanare: '離れ', garage: '車庫', shed: '物置' };
  /* 目次の頭に出す、件の呼び名。 */
  const TOC_NOUN = { boundary: '隣との取り決め', road: '相手の土地', changed: '建物の変更' };
  let rdHome = '';
  const BD_SIDE = { right: '右隣', left: '左隣', back: '裏の家' };
  const BD_OVER = [['roof', '屋根・ひさし'], ['tree', '木の枝'], ['pipe', '配管'], ['wall', '塀'], ['footing', '塀の基礎（地中）'], ['other', 'その他']];
  const BD_THING = { roof: 'その屋根・ひさし', tree: 'その木', pipe: 'その配管', wall: 'その塀', footing: 'その塀の基礎', other: 'その他のもの' };
  const entryTitle = side => BD_SIDE[side] ? BD_SIDE[side] + 'との取り決め' : '隣の家との取り決め';
  let bdName = '';
  let bdCount = 0;
  let dialog, opener, savedCallback, identity, initial;
  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 're-dialog';
    dialog.setAttribute('aria-labelledby', 're-dialog-title');
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', e => { e.preventDefault(); if (!closeAsk(true)) closeRequest(); });
    dialog.addEventListener('close', () => {
      document.body.classList.remove('re-editing');
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    });
  }
  const formData = () => Object.fromEntries(new FormData(dialog.querySelector('form')));
  function closeRequest() {
    if (JSON.stringify(formData()) !== initial) {
      const prompt = dialog.querySelector('.re-discard');
      prompt.hidden = false;
      prompt.querySelector('button').focus();
    } else dialog.close();
  }
  /* 件の目次。2件以上あるとき、ダイアログの頭（スクロールしない所）に件を並べる。
     1件目だけで本文の見える高さを超えるので、目次がないと2件目があることに
     気づけなかった（2026-09-26）。番号は並び順で振り直す（名前の番号は足した順のまま）。 */
  const entryEls = () => Array.from(dialog.querySelectorAll('.re-entry'));
  function renderToc() {
    const toc = dialog.querySelector('.re-toc'), els = entryEls();
    const many = els.length > 1 && !els[0].closest('[hidden]');
    els.forEach((el, i) => {
      const no = el.querySelector('.re-entry-no'); no.textContent = i + 1; no.hidden = els.length < 2;
      el.querySelector('[data-entry-del]').setAttribute('aria-label', el.querySelector('.re-entry-h b').textContent + 'を削除');
    });
    toc.hidden = !many;
    if (!many) { toc.innerHTML = ''; return; }
    toc.innerHTML = '<span class="re-toc-lb">' + esc(TOC_NOUN[identity.key]) + ' ' + els.length + '件</span>' + els.map((el, i) => {
      const t = el.querySelector('.re-entry-h b').textContent, s = el.querySelector('[data-sub]').textContent, bad = el.hasAttribute('data-invalid');
      return '<button type="button" data-jump="' + i + '"' + (bad ? ' data-invalid' : '') +
        ' aria-label="' + esc((i + 1) + '　' + t + (s ? '　' + s : '') + (bad ? '。入力が足りません' : '')) + '">' +
        '<span class="re-entry-no" aria-hidden="true">' + (i + 1) + '</span><span>' + esc(t) + (s ? '<small>' + esc(s) + '</small>' : '') + '</span></button>';
    }).join('');
    spy();
  }
  /* いま見ている件：本文の上から1/3の線を越えた最後の件。 */
  function spy() {
    const toc = dialog.querySelector('.re-toc');
    if (toc.hidden) return;
    const body = dialog.querySelector('.re-dialog-body'), r = body.getBoundingClientRect();
    const line = r.top + body.clientHeight / 3;
    let cur = -1;
    entryEls().forEach((el, i) => { if (el.getBoundingClientRect().top <= line) cur = i; });
    toc.querySelectorAll('[data-jump]').forEach((b, i) => {
      if (i === cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  }
  /* 件の頭を本文の上端へ。フォーカスも件の名前へ移す（読み上げで、どこへ来たか分かる）。 */
  function jump(el) {
    const body = dialog.querySelector('.re-dialog-body');
    body.scrollTo({ top: body.scrollTop + el.getBoundingClientRect().top - body.getBoundingClientRect().top - 12, behavior: 'smooth' });
    el.querySelector('.re-entry-h b').focus({ preventScroll: true });
  }
  /* 保存で足りない件に印を付け、最初の件へ飛ぶ（目次にも同じ印）。
     以前は文だけで、どの件のことか分からなかった。 */
  function flag(bad, text) {
    const els = entryEls();
    els.forEach((el, i) => { if (bad(i)) el.setAttribute('data-invalid', ''); else el.removeAttribute('data-invalid'); });
    dialog.querySelector('.re-error').textContent = text;
    renderToc();
    const first = els.find(el => el.hasAttribute('data-invalid'));
    if (first) jump(first);
  }
  /* 開いている削除の確認を閉じる。refocus なら入口の「削除」へフォーカスを戻す。
     閉じたものがあれば true（Esc でダイアログまで閉じないように使う）。 */
  function closeAsk(refocus) {
    const ask = dialog.querySelector('.re-entry-ask:not([hidden])');
    if (!ask) return false;
    ask.hidden = true;
    const del = ask.previousElementSibling;
    del.setAttribute('aria-expanded', 'false');
    if (refocus) del.focus();
    return true;
  }
  /* 同じ値がほかの件にもあるか（空は数えない）。 */
  const dup = (arr, i) => !!arr[i] && arr.filter(x => x === arr[i]).length > 1;
  function open(p, type, key, trigger, onSave) {
    ensureDialog();
    opener = trigger; savedCallback = onSave; identity = { id: p.id, type, key };
    let title = '', lead = '', body = '';
    if (type === 'matter' && key === 'boundary') {
      /* 境界・越境の取り決め。答えは選ぶだけ（相手の名前と、決めた内容を
         除く）。状態・次にすること・くわしくは答えから出すので、状態欄も
         「誰・何で確認したか」も置かない（state.js の boundaryStatus）。
         取り決めは隣ごとに別なので、隣1つを1ブロックにして足せるようにする。 */
      const b = p.matters.boundary || {};
      const es = (b.entries || []).length ? b.entries : [{}];
      bdCount = es.length; bdName = p.name;
      title = titles.boundary; lead = '';
      body = section('取り決め',
        question('隣と、境界や塀・越境について決めたことはありますか', choice('deal', b.deal || 'unasked',
          [['yes', 'ある'], ['no', 'ない'], ['unasked', 'まだ聞いていない'], ['unknown', WHO + 'も覚えていない']]),
          '境界標や法務局の地積測量図は家族でも確かめられます。口頭で決めたことは、' + WHO + 'に聞くしかありません。') +
        '<div data-bd-yes><div data-entries>' + es.map((x, i) => bdEntry(i, x)).join('') + '</div>' +
          '<button type="button" class="record-add re-entry-add" data-entry-add><span aria-hidden="true">＋</span>別の家との取り決めを足す</button></div>' +
        /* 父が覚えていないときは、書類を探した結果を聞く（保存は paper）。 */
        question('境界確認書や測量図は見つかりましたか', choice('found', b.deal === 'unknown' ? b.paper || 'unknown' : 'unknown',
          [['yes', '見つかった'], ['no', '探したが無い'], ['unknown', 'まだ探していない']]),
          '土地を買ったとき・家を建てたときの書類に入っていることがあります。法務局の地積測量図は家族でも取れます。', ' data-bd-unknown') +
        question('どんな書類ですか', choice('udoc-', b.docKinds || [], [
          ['confirm', '境界確認書', '隣と境界を確かめ、双方が署名したもの'], ['memo', '越境などの覚書'],
          ['map', '測量図', '地積測量図・確定測量図など']], 'row multi', 'checkbox'), '当てはまるものをすべて。', ' data-bd-udoc') +
        question('図面の作成日', choice('udocAge', b.docAge || 'unknown', [['after', '2005年3月以降'], ['before', 'それより前'], ['unknown', '分からない']]),
          '2005年3月以降の図面は、境界点の座標が入っています。', ' data-bd-uage'));
    } else if (type === 'matter' && key === 'road') {
      /* 私道・通行・配管の取り決め。答えは選ぶだけ（持ち主の名前と、決めた内容を
         除く）。状態・次にすること・くわしくは答えから出す（state.js の roadStatus）。
         使い方は相手の土地ごとに別なので、相手1つを1ブロックにして足せるようにする。 */
      const r = p.matters.road || {};
      const ls = (r.links || []).length ? r.links : [{}];
      bdCount = ls.length; rdHome = p.name;
      title = titles.road; lead = '';
      body = section('通る道と管',
        question(p.name + 'が他人の土地を使っていること、他人が' + p.name + 'の土地を使っていることはありますか', choice('has', r.has || 'unasked',
          [['yes', 'ある'], ['no', 'ない'], ['unasked', 'まだ聞いていない'], ['unknown', WHO + 'も分からない']]),
          '前の道が私道なら「ある」です（私道は他人の土地）。水道・下水・ガスの管が隣の土地の下を通っている、隣の管がこの家の土地の下を通っている、なども。') +
        '<div data-rd-yes><div data-entries>' + ls.map((x, i) => rdLink(i, x)).join('') + '</div>' +
          '<button type="button" class="record-add re-entry-add" data-entry-add><span aria-hidden="true">＋</span>別の土地を足す</button></div>');
    } else if (type === 'matter' && key === 'changed') {
      /* 建物の変更・登記。答えは選ぶだけ（どこを・いつ・頼んだ会社を除く）。状態・次に
         すること・くわしくは答えから出す（state.js の changedStatus）。変更ごとに要る登記と
         書類が違うので、変更1つを1ブロックにして足せるようにする。 */
      const m = p.matters.changed || {};
      const cs = (m.changes || []).length ? m.changes : [{}];
      bdCount = cs.length;
      chBuilt = Math.min(Number(String(p.built || '').replace(/[^0-9]/g, '').slice(0, 4)) || 1950, ...cs.map(c => Number(c.when) || 9999));
      title = titles.changed; lead = '';
      body = section('建物の変更',
        question('建ててから、増築や取り壊し、離れ・車庫を建てたことはありますか', choice('has', m.has || 'unasked',
          [['yes', 'ある'], ['no', 'ない'], ['unasked', 'まだ聞いていない'], ['unknown', WHO + 'も覚えていない']]),
          '市町村が把握している変更は、課税明細書でも分かります。工事を頼んだ会社や書類のありかは、' + WHO + 'に聞くしかありません。') +
        '<div data-ch-yes><div data-entries>' + cs.map((x, i) => chEntry(i, x)).join('') + '</div>' +
          '<button type="button" class="record-add re-entry-add" data-entry-add><span aria-hidden="true">＋</span>別の変更を足す</button></div>' +
        question('課税明細書で、登記床面積と現況床面積を比べましたか', choice('check', m.check || '', [
          ['diff', '違いがあった', '現況床面積のほうが大きい・「未登記家屋」の行がある'], ['same', '違いはなかった'], ['', 'まだ比べていない']], 'row'),
          '家屋の欄の「登記地積又は床面積」と「現況地積又は床面積」を比べます。', ' data-ch-unknown'));
    } else if (type === 'prior') {
      /* 前の代の相続登記。答えは選ぶだけ（名前の欄を除く）。状態・次の
         対応・誰が・期限は SeiZen が答えから出すので、欄を置かない。 */
      const pr = p.priorInheritance || {};
      const keys = ['land', 'bldg'].filter(k => p.rights[k]);
      const nm = k => k === 'land' ? '土地' : p.kind === 'condo' ? '専有部分' : '建物';
      /* 前の代の名義人と、どれが前の代の名義かは、権利関係の名義と連動する
         （state.js の syncPriorToRights）。ここで選べば権利関係も変わる。 */
      title = '前の代の相続登記';
      /* 冒頭の説明文は置かない。なぜ要るかは行の一文が言い、次にすること・
         期限は行が出す。フォームは問いだけで足りる（2026-09-24）。 */
      lead = '';
      /* 1列で、問いの順に上から答える。答えに応じて要る問いだけを出す
         （conditionals）。選択肢は並べて見せる（choice）。
         名義を移す道は4つ（state.js の priorRoute）。道ごとに段階の選択肢が
         違うので、段階の問いは道の数だけ持ち、見えている1つを保存する。
         印鑑証明書は、協議書ができていて取得するのが当事者以外のときだけ
         聞く ―― 当事者の手続きが終わったかは、そこで決まる。             */
      const route = S.priorRoute(pr);
      const party = rel => rel === 'spouseParent' ? SPOUSE : rel === 'other' ? '家族側の相続人' : WHO;
      const stage = pr.stage === 'ready' ? 'signed' : pr.stage || 'none';
      const seal = pr.seal || (pr.stage === 'ready' ? 'given' : 'notyet');
      body = section('名義',
          question('土地・建物の登記に、前の代の名義が残っていますか',
            choice('remains', pr.remains || 'unknown', [['yes', '残っている'], ['no', '残っていない'], ['unknown', 'まだ確かめていない']]),
            '登記事項証明書で分かります。家族でも法務局で取得できます。') +
          (keys.length > 1 ? question('前の代の名義のもの', choice('parcel-', pr.parcels || [], keys.map(k => [k, nm(k)]), 'pill', 'checkbox'), '', ' data-prior-yes')
            : '<input type="hidden" name="parcel-' + keys[0] + '" value="on">') +
          question('前の代の名義人', '<input class="re-q-in" name="owner" value="' + esc(S.priorOwner(p)) + '" autocomplete="off">',
            '登記のとおりに。権利関係の「名義」にも反映します。', ' data-prior-yes') +
          question('名義人は、' + WHO + 'から見て', choice('rel', pr.rel || 'parent',
            [['parent', WHO + 'の親'], ['grand', WHO + 'の祖父母'], ['spouseParent', SPOUSE + 'の親'], ['other', 'その他']]), '', ' data-prior-yes')) +
        section('名義の移し方',
          question('名義を移す方法', choice('route', route, [
            ['split', '話し合いで決める', '相続人が複数いる'],
            ['will', '遺言がある', '遺言で、取得する人が決まっている'],
            ['sole', '相続人が1人だけ', '話し合いは要らない'],
            ['unknown', '分からない', '遺言の有無や、相続人をまだ確かめていない']], 'row')) +
          question('どこまで進んでいますか', choice('stage-split', route === 'split' ? stage : 'none', [
            ['none', '誰が取得するか、まだ話がついていない'],
            ['agreed', '取得する人は決まった', '協議書はまだない'],
            ['signed', '遺産分割協議書ができた', '相続人全員が署名・実印を押した'],
            ['registered', '相続登記まで済んだ']], 'row'), '', ' data-prior-route="split"') +
          question('どこまで進んでいますか', choice('stage-once', route !== 'split' && stage === 'registered' ? 'registered' : 'none',
            [['none', '登記はまだ'], ['registered', '相続登記まで済んだ']]), '', ' data-prior-route="will sole"') +
          question('<span data-taker-title>取得する人</span>', choice('taker', pr.taker === 'other' ? 'other' : 'self',
            [['self', party(pr.rel), '', ' data-taker-self'], ['other', 'ほかの相続人']]) +
            '<div class="re-q-sub" data-prior-other><input class="re-q-in" name="takerName" value="' + esc(pr.takerName) + '" placeholder="名前" autocomplete="off" aria-label="取得する人の名前"><p class="re-q-h">例：' + esc(WHO) + 'の弟 次郎</p></div>',
            '', ' data-prior-taker') +
          question('<span data-seal-title></span>', choice('seal', seal, [['given', '渡した'], ['notyet', 'まだ渡していない']]),
            '登記には、協議書と一緒に全員の印鑑証明書が要ります。亡くなった人の印鑑証明書は取れません。', ' data-prior-seal') +
          question('前の代が亡くなったのは', choice('died', pr.died || 'unknown',
            [['before', '2024年4月より前'], ['after', '2024年4月以降'], ['unknown', '分からない']]),
            '相続登記の期限が、これで決まります。'), ' data-prior-yes');
    } else if (type === 'right') {
      const r = p.rights[key] || {};
      title = (key === 'land' ? '土地' : p.kind === 'condo' ? '専有部分' : '建物') + 'の権利関係';
      lead = '登記などで確認した名義と、' + WHO + 'が知っている事情を残します。分からない部分は、そのまま保存できます。';
      body = group('名義・持分', field('owner', '確認した名義', r.owner) + select('hold', '権利の種類', r.hold || 'own', [['own', '所有'], ['share', '共有'], ['lease', '借地'], ['other', 'その他']]) + field('shares', '持分', r.shares) +
        select('match', '登記と認識している権利関係', r.match || 'unknown', [['unknown', '未確認・分からない'], ['same', '一致している'], ['differ', '違いがある']])) +
        group('確認', field('source', '確認した資料・相手', r.source) + field('memo', '経緯・話合い・相談の記録', r.memo, true)) + nextFields(r);
    } else if (type === 'loan') {
      const l = p.loan;
      title = 'ローンの記録'; lead = '借入先・契約者・団信の記録は、「そのとき」の案内にも反映します。';
      body = group('借入', select('has', '借入はありますか', l.has === true ? 'yes' : l.has === false ? 'no' : 'unknown', known) +
        '<div data-loan-details class="wide re-fields">' + field('bank', '借入先・窓口', l.bank) + field('tel', '窓口の電話番号', l.tel) + field('type', '借入の種類', l.type) + field('debtor', '契約者・債務者', l.debtor) +
        select('gteeStatus', '団信の加入', l.gteeStatus === 'none' ? 'unknown' : l.gteeStatus || 'unknown', known) + field('source', '確認した資料・相手', l.source) + '</div>' + field('memo', '契約について残しておくこと', l.memo, true));
    } else if (type === 'security') {
      const s = p.security || {};
      title = '担保の記録'; lead = WHO + 'の借入がなくても、この物件が他の人の借入の担保になっている場合があります。';
      body = group('この物件の担保', select('has', '担保になっていますか', s.has || 'unknown', known) +
        select('whose', '誰の借入ですか', s.whose || 'unknown', [['unknown', '分からない'], ['self', WHO], ['other', WHO + '以外']]) + field('what', '誰の・何の借入か', s.what) + field('bank', '借入先', s.bank) + field('order', '登記で確認した順位など', s.order));
    } else if (type === 'deal') {
      const d = p.deals[Number(key)] || {};
      title = key === 'new' ? '契約・関係を追加' : '契約・関係の記録'; lead = '管理を頼んでいる人や、貸し借りの相手との関係を、家族が引き継げるように残します。';
      body = group('相手と関係', select('kind', '関係の種類', d.kind || 'manage', [['manage', '管理を頼む'], ['lend', '貸す・使わせる'], ['borrow', '借りる']]) +
        field('who', '相手の名前・会社名', d.who) + field('tel', '連絡先', d.tel) + select('flow', 'お金のやり取り', d.flow || 'none', [['none', 'なし'], ['pay', '支払う'], ['recv', '受け取る']]) +
        field('what', '頼んでいること・契約や取り決め', d.what, true) + field('source', '確認した資料・相手', d.source)) + nextFields(d);
    } else if (type === 'doc') {
      const d = p.docs.at[key] || {};
      title = key === 'new' ? '別の書類の所在を記録' : S.DOC_KINDS[key].label;
      lead = '家族が実際に取り出せる場所や、預けている相手を残します。';
      body = group('書類のありか', (key === 'new' ? select('docKind', '書類の種類', 'build', Object.entries(S.DOC_KINDS).filter(([k]) => k !== 'prior' && k !== 'priorWill' && !p.docs.at[k]).map(([k,v]) => [k,v.label])) : '') + select('st', '書類の所在', d.st || 'unknown', docOptions) + field('place', '保管場所・取り出し方', d.place) + field('note', '探した場所・補足', d.note, true));
    }
    dialog.innerHTML = '<form><header class="re-dialog-head"><div><p class="re-eyebrow">' + esc(p.name) + ' ／ 確認と記録</p><h2 id="re-dialog-title" tabindex="-1">' + esc(title) + '</h2></div><button type="button" class="re-close" aria-label="閉じる">×</button></header>' +
      '<nav class="re-toc" aria-label="件の一覧" hidden></nav>' +
      '<div class="re-dialog-body">' + (lead ? '<p class="re-lead">' + esc(lead) + '</p>' : '') + body + '</div>' +
      '<div class="re-discard" hidden><p>保存していない入力があります。</p><button type="button" data-keep>入力に戻る</button><button type="button" data-discard>変更を破棄して閉じる</button></div>' +
      '<footer class="re-dialog-foot"><p class="re-error" role="alert"></p><span>分かったところまで残せます</span><button type="button" data-cancel>キャンセル</button><button class="re-save" type="submit">記録を保存</button></footer></form>';
    dialog.querySelector('.re-close').onclick = closeRequest;
    dialog.querySelector('[data-cancel]').onclick = closeRequest;
    dialog.querySelector('[data-keep]').onclick = () => { dialog.querySelector('.re-discard').hidden = true; dialog.querySelector('input,select,textarea').focus(); };
    dialog.querySelector('[data-discard]').onclick = () => dialog.close();
    function conditionals() {
      const form = dialog.querySelector('form');
      if (form.elements.deal) {
        const deal = form.elements.deal.value;
        dialog.querySelectorAll('[data-bd-yes]').forEach(el => { el.hidden = deal !== 'yes'; });
        dialog.querySelector('[data-bd-unknown]').hidden = deal !== 'unknown';
        const udoc = deal === 'unknown' && form.elements.found.value === 'yes';
        dialog.querySelector('[data-bd-udoc]').hidden = !udoc;
        dialog.querySelector('[data-bd-uage]').hidden = !(udoc && (form.elements['udoc-confirm'].checked || form.elements['udoc-map'].checked));
        const entries = dialog.querySelectorAll('.re-entry');
        entries.forEach(el => {
          const f = k => form.elements['e' + el.dataset.entry + '-' + k];
          el.querySelector('[data-e-line]').hidden = !f('kind-line').checked;
          el.querySelector('[data-e-over]').hidden = !f('kind-over').checked;
          const doc = f('paper').value === 'yes';
          el.querySelector('[data-e-doc]').hidden = !doc;
          el.querySelector('[data-e-age]').hidden = !(doc && (f('doc-confirm').checked || f('doc-map').checked));
          el.querySelector('[data-entry-del]').hidden = entries.length < 2;
          /* 隣の名前を選択肢に写す。 */
          el.querySelectorAll('[data-nb]').forEach(s => { s.textContent = BD_SIDE[f('side').value] || '隣'; });
          el.querySelector('[data-e-title]').textContent = entryTitle(f('side').value);
          el.querySelector('[data-sub]').textContent = f('who').value.trim();
          /* 本当に矛盾する組み合わせだけを選べなくし、選べない理由をその下に出す：
               目印が塀 → その塀は境界に立っているので「塀（地上）」は越境しない
               目印が両家の塀 → 基礎も両家のもので、越境にならない
               目印が片方の塀で「塀の基礎」→ 基礎の持ち主は塀と同じ（固定）
               越境に「塀」→ 越えている塀は基礎も一緒に越えている（「塀の基礎」は要らない）。
                             その塀は境界に合わせて建っていないので、目印に「塀」は選べない
             すでに選んでいた答えを外したときは、外したことも言う（黙って消さない）。 */
          const opt = (k, v) => el.querySelector('input[name="e' + el.dataset.entry + '-' + k + '"][value="' + v + '"]');
          const ow = k => f('ow-' + k);
          const markWall = f('kind-line').checked && f('mark').value === 'wall';
          const owner = f('wallOwner').value;
          el.querySelector('[data-e-wall]').hidden = !markWall;
          const dropped = [];
          const lock = (input, off) => {
            if (off && input.checked) { input.checked = false; dropped.push(input.closest('.re-opt').querySelector('b').textContent); }
            input.disabled = off;
          };
          lock(ow('wall'), markWall);
          lock(ow('footing'), (markWall && owner === 'both') || ow('wall').checked);
          const overOn = f('kind-over').checked;
          const footingFixed = markWall && owner !== 'both' && overOn && ow('footing').checked;
          if (footingFixed) opt('oo-footing', owner).checked = true;
          opt('oo-footing', owner === 'ours' ? 'theirs' : 'ours').disabled = footingFixed;
          const overWall = overOn && ow('wall').checked;
          if (overWall && opt('mark', 'wall').checked) opt('mark', 'none').checked = true;
          opt('mark', 'wall').disabled = overWall;
          el.querySelectorAll('[data-e-own]').forEach(d => { d.hidden = !ow(d.dataset.eOwn).checked; });
          const why = (k, text) => { const w = el.querySelector('[data-e-why="' + k + '"]'); w.hidden = !text; w.textContent = text || ''; };
          why('over', (dropped.length ? '「' + dropped.join('」「') + '」の選択を外しました。' : '') +
            (markWall ? owner === 'both' ? '目印にした両家の塀は境界の上に立っているので、塀も基礎も越境になりません。'
              : '目印にした塀は境界に揃えて立っているので、塀そのものは越境になりません。' : '') +
            (overWall ? '越えている塀は、基礎も一緒に越えています。' : ''));
          why('owner', footingFixed ? '目印にした塀の基礎なので、持ち主は塀と同じです。' : '');
          why('mark', overWall ? '越境している塀は境界に合わせて建っていないので、目印にはなりません。' : '');
        });
        dialog.querySelector('[data-entry-add]').hidden = entries.length >= 4;
      }
      if (identity.key === 'road' && form.elements.has) {
        dialog.querySelector('[data-rd-yes]').hidden = form.elements.has.value !== 'yes';
        const links = dialog.querySelectorAll('[data-link]');
        links.forEach(el => {
          const f = k => form.elements['l' + el.dataset.link + '-' + k];
          const land = f('land').value, road = land === 'road';
          el.querySelector('[data-l-title]').textContent = RD_LAND[land] || '相手の土地';
          el.querySelector('[data-sub]').textContent = RD_USE_OPTS.filter(([k]) => f('use-' + k).checked).map(([k]) => RD_USE_SHORT[k]).join('・');
          /* 選択肢の〈相手〉に、選んだ相手の呼び名を写す。 */
          el.querySelectorAll('[data-rd]').forEach(s => { s.textContent = land === 'other' ? 'ほかの土地' : RD_LAND[land] || '相手'; });
          /* 前の私道は、この家が使う側だけ。向きは聞かず、持分を聞く。 */
          el.querySelectorAll('[data-l-by]').forEach(d => { d.hidden = road || !f('use-' + d.dataset.lBy).checked; });
          el.querySelector('[data-l-road]').hidden = !road;
          el.querySelector('[data-l-content]').hidden = !['paper', 'oral'].includes(f('pact').value);
          el.querySelector('[data-entry-del]').hidden = links.length < 2;
        });
        dialog.querySelector('[data-entry-add]').hidden = links.length >= 5;
      }
      if (identity.key === 'changed' && form.elements.has) {
        const has = form.elements.has.value;
        dialog.querySelector('[data-ch-yes]').hidden = has !== 'yes';
        dialog.querySelector('[data-ch-unknown]').hidden = has !== 'unknown';
        const items = dialog.querySelectorAll('[data-change]');
        items.forEach(el => {
          const f = k => form.elements['c' + el.dataset.change + '-' + k];
          const what = f('what').value, grow = what !== 'cut' && what !== 'demo', open = f('reg').value !== 'yes';
          el.querySelector('[data-c-title]').textContent = CH_WHAT[what] || '変更';
          el.querySelector('[data-c-floor]').hidden = what !== 'ext';
          /* 別棟・取り壊した建物は「何の建物か」を選ぶ（自由記入だと「建てた6畳」のようになった）。
             その他のときだけ名前を書く。増築・一部の取り壊しは、どの部分かを書く。 */
          const apart = what === 'annex' || what === 'demo';
          el.querySelector('[data-c-bldg]').hidden = !apart;
          el.querySelector('[data-c-part]').hidden = apart && f('bldg').value !== 'other';
          el.querySelector('[data-c-partlb]').textContent = apart ? '建物の名前' : 'どの部分';
          const bldg = f('bldg').value;
          el.querySelector('[data-sub]').textContent = [apart && (bldg === 'other' ? f('where').value.trim() : CH_BLDG[bldg]),
            CH_SIDE[f('side').value], f('when').value && f('when').value + '年ごろ'].filter(Boolean).join('・');
          f('where').placeholder = apart ? '例：納屋' : '例：北側の約6畳';
          /* 取り壊しは「消えている／残っている」で答える。 */
          el.querySelectorAll('[data-lg]').forEach(b => { b.textContent = grow ? b.dataset.lg : b.dataset.ld; });
          el.querySelector('[data-c-tax]').hidden = !open;
          el.querySelectorAll('[data-c-docs]').forEach(d => { d.hidden = !(open && grow); });
          el.querySelector('[data-c-kinds]').hidden = f('docs').value !== 'yes';
          /* 記録の問いの説明は、見えている行に合わせる。 */
          el.querySelector('[data-c-rech]').textContent = !what ? '' : grow
            ? '登記は登記事項証明書で、課税は課税明細書で確かめられます（現況床面積が登記床面積より大きければ、登記に載っていません）。' +
              (open ? '工事の書類は、増えた部分が' + WHO + 'のものだと示すのに使い、2種類以上あれば足ります。' : '')
            : '取り壊した建物が登記に残っているかは、登記事項証明書で確かめられます。';
          el.querySelector('[data-entry-del]').hidden = items.length < 2;
        });
        dialog.querySelector('[data-entry-add]').hidden = items.length >= 5;
      }
      const loanFields = dialog.querySelector('[data-loan-details]');
      if (loanFields) loanFields.hidden = form.elements.has.value === 'no';
      if (form.elements.remains) {
        const yes = form.elements.remains.value === 'yes';
        dialog.querySelectorAll('[data-prior-yes]').forEach(el => { el.hidden = !yes; });
        const route = form.elements.route.value, rel = form.elements.rel.value;
        const partyName = rel === 'spouseParent' ? SPOUSE : rel === 'other' ? '家族側の相続人' : WHO;
        dialog.querySelectorAll('[data-prior-route]').forEach(el => { el.hidden = !el.dataset.priorRoute.split(' ').includes(route); });
        /* 取得する人を聞くのは、決まっている段だけ（1人の道・分からない道では聞かない）。 */
        const splitStage = form.elements['stage-split'].value;
        const taker = route === 'will' || (route === 'split' && splitStage !== 'none');
        const other = taker && form.elements.taker.value === 'other';
        dialog.querySelector('[data-prior-taker]').hidden = !taker;
        dialog.querySelector('[data-prior-other]').hidden = !other;
        dialog.querySelector('[data-prior-seal]').hidden = !(route === 'split' && splitStage === 'signed' && other);
        dialog.querySelector('[data-taker-self] b').textContent = partyName;
        dialog.querySelector('[data-taker-title]').textContent = route === 'will' ? '遺言で取得する人' : '取得する人';
        dialog.querySelector('[data-seal-title]').textContent = partyName + 'の印鑑証明書を、' +
          (form.elements.takerName.value.trim() || '取得する人') + 'に渡しましたか';
      }
      renderToc();
    }
    /* 答えを直した件からは、足りない印を外す（全部外れたら文も消す）。 */
    dialog.querySelector('form').onchange = e => {
      const en = e.target.closest('.re-entry');
      if (en && en.hasAttribute('data-invalid')) {
        en.removeAttribute('data-invalid');
        if (!dialog.querySelector('.re-entry[data-invalid]')) dialog.querySelector('.re-error').textContent = '';
      }
      conditionals();
    };
    dialog.querySelector('.re-dialog-body').addEventListener('scroll', spy, { passive: true });
    /* 件を足す・削除する・目次から飛ぶ。 */
    dialog.querySelector('form').onclick = ev => {
      const add = ev.target.closest('[data-entry-add]'), del = ev.target.closest('[data-entry-del]'), to = ev.target.closest('[data-jump]');
      /* 吹き出しの外を押したら、吹き出しだけ閉じる。 */
      if (!ev.target.closest('.re-entry-delw')) closeAsk();
      if (to) jump(entryEls()[Number(to.dataset.jump)]);
      const road = identity.key === 'road', ch = identity.key === 'changed';
      if (add) { dialog.querySelector('[data-entries]').insertAdjacentHTML('beforeend', ch ? chEntry(bdCount++, {}) : road ? rdLink(bdCount++, {}) : bdEntry(bdCount++, {})); conditionals();
        jump(dialog.querySelector('.re-entry:last-child')); }
      if (del) {
        const ask = del.nextElementSibling, opening = ask.hidden;
        closeAsk();
        if (opening) { ask.hidden = false; del.setAttribute('aria-expanded', 'true'); ask.querySelector('[data-entry-no]').focus(); }
      }
      const yes = ev.target.closest('[data-entry-yes]'), no = ev.target.closest('[data-entry-no]');
      if (no) closeAsk(true);
      if (yes) { yes.closest('.re-entry').remove(); conditionals(); dialog.querySelector('[data-entry-add]').focus(); }
    };
    dialog.querySelector('form').oninput = e => { if (e.target.name === 'takerName') conditionals(); };
    conditionals();
    initial = JSON.stringify(formData());
    dialog.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const values = formData();
      if (identity.type === 'matter' && identity.key === 'boundary') {
        values.entries = Array.from(dialog.querySelectorAll('.re-entry'), el => {
          const v = k => values['e' + el.dataset.entry + '-' + k];
          return { side: v('side') || '', who: v('who') || '', kinds: ['line', 'over'].filter(k => v('kind-' + k)),
            mark: v('mark'), wallOwner: v('wallOwner'), paper: v('paper'),
            overs: BD_OVER.filter(([k]) => v('ow-' + k)).map(([k]) => ({ what: k, owner: v('oo-' + k) })),
            docKinds: ['confirm', 'memo', 'map'].filter(k => v('doc-' + k)), docAge: v('docAge'), content: v('content') || '' };
        });
        values.docKinds = ['confirm', 'memo', 'map'].filter(k => values['udoc-' + k]);
        values.docAge = values.udocAge;
        values.paper = values.deal === 'unknown' ? values.found : '';
        const noOver = i => values.entries[i].kinds.includes('over') && !values.entries[i].overs.length;
        if (values.deal === 'yes' && values.entries.some((x, i) => noOver(i))) { flag(noOver, '越境しているものを選んでください。'); return; }
        const sides = values.entries.map(x => x.side);
        if (values.deal === 'yes' && sides.some((x, i) => dup(sides, i))) { flag(i => dup(sides, i), '同じ家が2つあります。1つにまとめてください。'); return; }
      } else if (identity.type === 'matter' && identity.key === 'road') {
        values.links = Array.from(dialog.querySelectorAll('[data-link]'), el => {
          const v = k => values['l' + el.dataset.link + '-' + k];
          const land = v('land') || '';
          return { land, who: v('who') || '', share: v('share'), pact: v('pact'), content: v('content') || '',
            uses: RD_USE_OPTS.filter(([k]) => v('use-' + k)).map(([k]) => ({ what: k, by: land === 'road' ? 'ours' : v('by-' + k) })) };
        });
        Object.keys(values).filter(k => /^l\d+-/.test(k)).forEach(k => delete values[k]);
        /* 「ある」以外では、書きかけの空のブロックは残さない。 */
        if (values.has !== 'yes') values.links = values.links.filter(l => l.land && l.uses.length);
        if (values.has === 'yes') {
          if (values.links.some(l => !l.land)) { flag(i => !values.links[i].land, '相手の土地を選んでください。'); return; }
          if (values.links.some(l => !l.uses.length)) { flag(i => !values.links[i].uses.length, '何に使っているかを選んでください。'); return; }
          const lands = values.links.map(l => l.land === 'other' ? '' : l.land);
          if (lands.some((x, i) => dup(lands, i))) { flag(i => dup(lands, i), '同じ土地が2つあります。1つにまとめてください。'); return; }
        }
      } else if (identity.type === 'matter' && identity.key === 'changed') {
        const grow = w => w !== 'cut' && w !== 'demo';
        values.changes = Array.from(dialog.querySelectorAll('[data-change]'), el => {
          const v = k => values['c' + el.dataset.change + '-' + k];
          const what = v('what') || '';
          return { what, bldg: v('bldg') || '', side: v('side') || '', floor: Number(v('floor')) || 1, where: v('where') || '', when: v('when') || '',
            reg: v('reg'), tax: v('tax'), docs: v('docs'), by: v('by') || '',
            kinds: ['confirm', 'inspect', 'contract', 'receipt', 'handover'].filter(k => v('kind-' + k)) };
        });
        Object.keys(values).filter(k => /^c\d+-/.test(k)).forEach(k => delete values[k]);
        if (values.has === 'yes') {
          if (values.changes.some(c => !c.what)) { flag(i => !values.changes[i].what, '何をしたかを選んでください。'); return; }
          if (values.changes.some(c => !c.side)) { flag(i => !values.changes[i].side, 'どこか（玄関から見た向き）を選んでください。'); return; }
        }
      }
      if (identity.type === 'prior') {
        values.parcels = ['land', 'bldg'].filter(k => values['parcel-' + k]);
        values.stage = values.route === 'split' ? values['stage-split'] : values.route === 'unknown' ? 'none' : values['stage-once'];
        if (values.route === 'split' && values.stage === 'none') values.taker = 'self';
        delete values['stage-split']; delete values['stage-once'];
      }
      const error = dialog.querySelector('.re-error');
      if (identity.type === 'prior' && values.remains === 'yes' && !values.parcels.length) { error.textContent = '前の代の名義のものを選んでください。'; return; }
      if (identity.type === 'deal' && !values.who.trim()) { error.textContent = '相手の名前・会社名を記録してください。'; return; }
      try { S.updateRecord(identity.id, identity.type, values.docKind || identity.key, values); }
      catch (e) { error.textContent = e.message; return; }
      dialog.close();
      savedCallback();
    };
    document.body.classList.add('re-editing');
    dialog.showModal();
    dialog.querySelector('h2').focus();
  }
  window.SeiZenRealEstateEditor = { open };
})();
