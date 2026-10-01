/* この物件の確認・記録。入口が違っても state.js の同じ記録を編集する。 */
(function () {
  'use strict';
  /* 画面の文で対象の家族を呼ぶ続柄（既定「父」）。「本人」とは書かない
     ―― 操作するのは基本的に家族で、読み手が迷う（2026-09-24）。 */
  const WHO = (window.SeiZen && window.SeiZen.person && window.SeiZen.person.rel) || '父';
  const SPOUSE = (window.SeiZen && window.SeiZen.person && window.SeiZen.person.spouse) || '母';
  const S = window.SeiZenRealEstate;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /* 質問ひとつ＝問い＋選択肢を並べて見せる（前の代の相続登記で使う）。
     プルダウンにしない ―― 開くまで選択肢が見えず、長い選択肢は切れる。
     pill は短い選択肢を横に、row は説明の要る選択肢を縦に並べる。 */
  const choice = (name, value, options, kind, type) => '<div class="re-opts ' + (kind || 'pill') + '"' + (type === 'checkbox' ? '' : ' role="radiogroup"') + '>' +
    options.map(([v, label, sub, attr]) => '<label class="re-opt"' + (attr || '') + '><input type="' + (type || 'radio') + '" name="' + (type === 'checkbox' ? name + v : name) + '" value="' + (type === 'checkbox' ? 'on' : v) + '"' +
      ((type === 'checkbox' ? (value || []).includes(v) : v === value) ? ' checked' : '') + '><span><b>' + esc(label) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></label>').join('') + '</div>';
  const question = (title, body, hint, attr) => '<div class="re-q"' + (attr || '') + '><p class="re-q-t">' + title + '</p>' + body +
    (hint ? '<p class="re-q-h">' + esc(hint) + '</p>' : '') + '</div>';
  /* 話題ひとつ＝白い札（頭は灰色の帯に名詞の見出し、説明は札の中）。権利関係・境界の件の中から使う。
     見出しは HTML のまま入れる（境界の「当てはまるものをすべて」を添えるため。呼び出しは固定の文言）。 */
  const card = (title, body, hint, attr) => '<div class="re-card"' + (attr || '') + '><div class="re-card-h">' + title + '</div>' +
    '<div class="re-card-b">' + body + (hint ? '<p class="re-q-h">' + esc(hint) + '</p>' : '') + '</div></div>';
  /* いくつでも選べる問い：「当てはまるものをすべて」は問いの見出しの横に添える。
     問いの下に置くと、選択肢の下に開く入れ子の問いを並べ終えた後に出て、選ぶ前に読む指示が
     選んだ後の位置に来ていた（境界：2026-09-29）。 */
  const allOf = title => esc(title) + '<small class="re-q-note">当てはまるものをすべて</small>';
  /* 件を足す問い（境界・私道・建物の変更・ローン）：追加の入口は問いの右端。「ある」のときだけ出す（conditionals）。
     件の下に置くと、1件目を読み終えて最後までスクロールしないと見つからなかった（2026-09-29）。 */
  const withAdd = (title, what) => '<span>' + esc(title) + '</span>' +
    '<button type="button" class="record-add re-q-add" data-entry-add aria-label="' + esc(what) + 'を追加"><span aria-hidden="true">＋</span>追加</button>';
  /* 件の目次。件のある問いの下（本文の中）に置き、スクロールしたら上端に貼り付く。 */
  const tocNav = '<nav class="re-toc" aria-label="件の一覧" hidden></nav>';
  const section = (title, html, attr) => '<fieldset' + (attr || '') + '><legend>' + esc(title) + '</legend>' + html + '</fieldset>';
  const titles = { boundary: '境界・越境の取り決め', road: '私道・通行・配管の取り決め', changed: '建物の変更・登記' };
  /* 件（境界の隣・私道の相手の土地・建物の変更・借入）は枠で囲み、頭を濃い帯にする。中は
     話題ごとの白い札（card）で、権利関係の札と同じ形。札の見出しが問いの代わりをする。
     件の頭と話題の帯が同じ灰色の帯で並び、意味（件／話題）が見分けられなかった
     （2026-09-29 見本 `_検討/境界フォーム_案v8.html` の B）。
     1件ぶんのブロックの頭：番号・名前・答えの要約（右端に削除の入口が続く）。
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
    /* 話題：相手／決めたこと／書面／ほかに決めたこと。 */
    return nb('<div class="re-entry" data-entry="' + i + '">' + entryHead('data-e-title', entryTitle(e.side)) +
      entryDel + '</div>' +
      card('相手', choice(n('side'), e.side || '', [['right', '右隣'], ['left', '左隣'], ['back', '裏の家']]) +
        '<div class="re-q-sub"><input class="re-q-in" name="' + n('who') + '" value="' + esc(e.who) + '" placeholder="相手の名前（分かれば）" autocomplete="off" aria-label="相手の名前"></div>',
        '玄関を出て見た向きで。裏の家は、玄関の反対側の家。') +
      card(allOf('決めたこと'),
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
            (k === 'footing' ? '<p class="re-why" data-e-why="owner" hidden></p>' : '') + '</div>').join('') + '</div>') +
      /* 書類の種類と図面の作成日は、「覚書・境界確認書がある」を選んだすぐ下に開く（決めたことの
         入れ子の問いと同じ形）。 */
      card('書面', choice(n('paper'), e.paper || 'unknown', [['yes', '覚書・境界確認書がある'], ['no', '口頭のまま'], ['unknown', '分からない']]) +
        '<div class="re-sub" data-e-doc><p class="re-sub-t">' + allOf('どんな書類ですか') + '</p>' +
          choice(n('doc-'), e.docKinds || [], [
            ['confirm', '境界確認書', '隣と境界を確かめ、双方が署名したもの'], ['memo', '越境などの覚書'],
            ['map', '測量図', '地積測量図・確定測量図など']], 'row multi', 'checkbox') +
          '<div data-e-age><p class="re-sub-t">図面の作成日</p>' +
            choice(n('docAge'), e.docAge || 'unknown', [['after', '2005年3月以降'], ['before', 'それより前'], ['unknown', '分からない']]) +
            '<p class="re-q-h">2005年3月以降の図面は、境界点の座標が入っています。</p></div></div>') +
      /* 位置・持ち主は上で選んで答えるので、ここは選べないことだけを書く。 */
      card('ほかに決めたこと', '<textarea class="re-q-in" rows="2" name="' + n('content') + '" aria-label="ほかに決めたこと">' + esc(e.content) + '</textarea>',
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
      card('相手', choice(n('land'), l.land || '', RD_LAND_OPTS) +
        '<div class="re-q-sub"><input class="re-q-in" name="' + n('who') + '" value="' + esc(l.who) + '" placeholder="持ち主の名前・どこの土地か（分かれば）" autocomplete="off" aria-label="持ち主の名前"></div>',
        '隣は、玄関を出て見た向きで。離れた土地や水路の向こうの土地は「ほかの土地」に。') +
      card(allOf('使い方'), choice(n('use-'), uses.map(u => u.what), RD_USE_OPTS, 'pill', 'checkbox') +
        /* 向き：私道でなければ、選んだ使い方ごとに誰のためかを聞く。 */
        RD_USE_OPTS.map(([k]) => '<div class="re-sub" data-l-by="' + k + '"><p class="re-sub-t">' + (k === 'pass' ? '誰が通りますか' : 'その' + RD_PIPE_NAME[k] + 'の管は誰のものですか') + '</p>' +
          choice(n('by-' + k), byOf(k), k === 'pass'
            ? [['ours', P + 'の人', '〈相手〉の土地を通る'], ['theirs', '〈相手〉の人', P + 'の土地を通る']]
            : [['ours', P + 'の管', '〈相手〉の土地の下を通っている'], ['theirs', '〈相手〉の管', P + 'の土地の下を通っている']], 'row') + '</div>').join('')) +
      card(esc(P) + 'の私道の持分', choice(n('share'), l.share || 'unknown', [['yes', '持っている'], ['no', '持っていない'], ['unknown', '分からない']]),
        '登記事項証明書で分かります（私道の地番で取ります）。', ' data-l-road') +
      card('取り決め', choice(n('pact'), l.pact || 'unknown', [
        ['paper', '承諾書・覚書がある'], ['oral', '口頭で決めた'], ['none', '特に決めていない'], ['unknown', '分からない']], 'row')) +
      card('決めた内容', '<textarea class="re-q-in" rows="2" name="' + n('content') + '" aria-label="決めた内容">' + esc(l.content) + '</textarea>',
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
      card('したこと', choice(n('what'), c.what || '', [
        ['ext', '増築した', '横や上に部屋を足した'], ['annex', '別棟を建てた', '離れ・車庫・物置など'],
        ['cut', '一部を取り壊した', '部屋を減らした'], ['demo', '建物を取り壊した', '離れ・物置や、古い建物など']], 'row'),
        '物置でも、基礎に固定され、屋根と壁があれば建物として登記の対象になります。') +
      card('場所と時期', '<div class="re-lines">' +
        line('玄関から見て', pills(n('side'), c.side || '', [['back', '奥'], ['right', '右'], ['left', '左'], ['front', '玄関側']])) +
        line('階', pills(n('floor'), String(c.floor || 1), [['1', '1階'], ['2', '2階']]), ' data-c-floor') +
        line('何の建物', pills(n('bldg'), c.bldg || '', [['hanare', '離れ'], ['garage', '車庫'], ['shed', '物置'], ['other', 'その他']]), ' data-c-bldg') +
        line('<span data-c-partlb>どの部分</span>', '<input class="re-q-in" name="' + n('where') + '" value="' + esc(c.where) + '" placeholder="例：北側の約6畳" autocomplete="off" aria-label="どの部分">', ' data-c-part') +
        line('いつごろ', '<span class="re-yr">' + yearSelect(n('when'), c.when) + '<span>ごろ</span></span>') + '</div>',
        '分かる範囲で。年が分からなくても登記はできます。') +
      card('この変更の記録', '<div class="re-lines">' +
        line('登記', pills(n('reg'), c.reg || 'unknown', [['yes', '載っている', '消えている'], ['no', '載っていない', '残っている'], ['unknown', 'まだ確かめていない']])) +
        line('課税明細書', pills(n('tax'), c.tax || '', [['match', '載っている', '消えている'], ['miss', '載っていない', '残っている'], ['', 'まだ見ていない']]), ' data-c-tax') +
        line('工事の書類', pills(n('docs'), c.docs || 'unknown', [['yes', 'ある'], ['no', '見つからない'], ['unknown', 'まだ探していない']]) +
          '<div class="re-ln-sub" data-c-kinds>' + choice(n('kind-'), c.kinds || [], [
            ['confirm', '確認済証'], ['inspect', '検査済証'], ['contract', '工事請負契約書'], ['receipt', '領収書'], ['handover', '工事完了引渡証明書']], 'pill', 'checkbox') + '</div>', ' data-c-docs') +
        line('請け負った会社', '<input class="re-q-in" name="' + n('by') + '" value="' + esc(c.by) + '" placeholder="例：◯◯工務店" autocomplete="off" aria-label="工事を請け負った会社">', ' data-c-docs') + '</div>' +
        '<p class="re-q-h" data-c-rech></p>') + '</div>';
  }
  /* ローン・借入：1件ぶん。名前は n<番号>-…（足した順）。聞くのは、どこから借りているか
     （連絡先）と、借りている人・返済・団信・抵当権。会社や親族の借入にこの家を担保として
     入れている場合も、借りている人が「そのほか」の1件として同じ形で入れる（2026-09-28。
     前の版は「父の借入」と「ほかの人の借入の担保」を別の問いにして、呼び名で迷わせた）。 */
  const LN_TYPES = [['住宅ローン', '住宅ローン'], ['リフォームローン', 'リフォームローン'], ['その他の借入', 'その他']];
  function lnEntry(i, x) {
    const n = k => 'n' + i + '-' + k;
    const yn = v => ['yes', 'no'].includes(v) ? v : 'unknown';
    const type = LN_TYPES.some(t => t[0] === x.type) ? x.type : x.type ? 'その他の借入' : '住宅ローン';
    return '<div class="re-entry" data-loan="' + i + '">' + entryHead('data-n-title', type === 'その他の借入' ? 'その他の借入' : type) + entryDel + '</div>' +
      card('種類と借入先', '<div class="re-lines">' +
        line('種類', pills(n('type'), type, LN_TYPES)) +
        line('借入先', '<input class="re-q-in" name="' + n('bank') + '" value="' + esc(x.bank) + '" placeholder="例：○○銀行 青葉台支店" autocomplete="off" aria-label="借入先">') +
        line('電話', '<input class="re-q-in" name="' + n('tel') + '" value="' + esc(x.tel) + '" inputmode="tel" autocomplete="off" aria-label="借入先の電話">') + '</div>') +
      card('借入の中身', '<div class="re-lines">' +
        line('借りている人', pills(n('who'), x.who || '', [['self', WHO], ['pair', WHO + 'と' + SPOUSE], ['other', 'そのほか'], ['', 'まだ確かめていない']]) +
          '<div class="re-ln-sub" data-n-other><input class="re-q-in" name="' + n('whoName') + '" value="' + esc(x.whoName) + '" placeholder="例：○○工業（' + esc(WHO) + 'の会社）" autocomplete="off" aria-label="借りている人の名前"></div>') +
        line('返済', pills(n('paid'), x.paid ? 'paid' : 'paying', [['paying', '返している途中'], ['paid', '返し終えた']])) +
        line('団信', pills(n('gtee'), yn(x.gtee), [['yes', '付いている'], ['no', '付いていない'], ['unknown', 'まだ確かめていない']]), ' data-n-gtee') +
        line('抵当権', pills(n('lienY'), yn(x.lien), [['yes', '付いている'], ['no', '付いていない'], ['unknown', 'まだ確かめていない']]), ' data-n-lieny') +
        line('抵当権', pills(n('lienP'), yn(x.lien), [['no', '抹消した'], ['yes', 'まだ残っている'], ['unknown', 'まだ確かめていない']]), ' data-n-lienp') + '</div>' +
        '<p class="re-q-h" data-n-h></p>') + '</div>';
  }
  /* 契約の相手：関係ごとのお金の問い（値は pay／recv／none のまま）。聞くのは貸している・
     借りているだけ ―― 有償か無償（使用貸借）かで、そのときの扱いが変わる。管理を頼んでいる
     ときは聞かない（払っていても無償でも、家族がすることは相手に知らせるだけで変わらない。
     費用の中身は「頼んでいること」に書く：2026-09-28）。 */
  const DEAL_FLOW = [
    ['lend', '家賃を受け取っていますか', [['recv', '受け取っている'], ['none', '無償で使わせている']]],
    ['borrow', '地代を払っていますか', [['pay', '払っている'], ['none', '無償で借りている']]]];
  const RD_LAND = { road: '前の私道', right: '右隣', left: '左隣', back: '裏の家', other: 'ほかの土地' };
  const RD_LAND_OPTS = [['road', '前の私道'], ['right', '右隣'], ['left', '左隣'], ['back', '裏の家'], ['other', 'ほかの土地']];
  const RD_USE_OPTS = [['pass', '通る（出入りの道）'], ['water', '水道の管'], ['sewer', '下水の管'], ['gas', 'ガスの管']];
  const RD_PIPE_NAME = { water: '水道', sewer: '下水', gas: 'ガス' };
  const RD_USE_SHORT = { pass: '通る', water: '水道', sewer: '下水', gas: 'ガス' };
  const CH_SIDE = { back: '奥', right: '右', left: '左', front: '玄関側' };
  const CH_BLDG = { hanare: '離れ', garage: '車庫', shed: '物置' };
  /* 目次の頭に出す、件の呼び名。 */
  const TOC_NOUN = { boundary: '隣との取り決め', road: '相手の土地', changed: '建物の変更', loan: '借入' };
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
    dialog.addEventListener('cancel', e => { e.preventDefault(); if (!closeAsk(true) && !closeDiscard(true)) closeRequest(dialog.querySelector('.re-close')); });
    dialog.addEventListener('close', () => {
      document.body.classList.remove('re-editing');
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    });
  }
  const formData = () => Object.fromEntries(new FormData(dialog.querySelector('form')));
  /* 閉じる前の確認。押した入口（右上の ×・キャンセル。Esc は × と同じ）に吹き出しで添える
     （削除の確認と同じ形。2026-09-30）。以前はフッターの上に帯で出し、× から遠かった。
     吹き出しは1つで、押した入口の包み（.re-discardw）へ移して出す。 */
  function closeRequest(trigger) {
    if (JSON.stringify(formData()) === initial) { dialog.close(); return; }
    const ask = dialog.querySelector('.re-discard'), wrap = trigger.parentElement, opening = ask.hidden || ask.parentElement !== wrap;
    closeAsk();
    closeDiscard();
    if (!opening) { trigger.focus(); return; }
    wrap.appendChild(ask);
    ask.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    ask.querySelector('[data-keep]').focus();
  }
  /* 閉じる前の確認を下げる。refocus なら押した入口へフォーカスを戻す。下げたら true。 */
  function closeDiscard(refocus) {
    const ask = dialog.querySelector('.re-discard');
    if (!ask || ask.hidden) return false;
    ask.hidden = true;
    const trigger = ask.previousElementSibling;
    trigger.setAttribute('aria-expanded', 'false');
    if (refocus) trigger.focus();
    return true;
  }
  /* 件の目次。2件以上あるとき、件のある問いの下（本文の中）に件を並べ、スクロールしたら
     上端に貼り付く（2026-09-29。前はダイアログの頭に置いた）。
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
    /* 目次が本文の中にある（境界）ときは、上端に貼り付いた目次の下へ出す。 */
    const toc = body.querySelector('.re-toc'), under = toc && !toc.hidden ? toc.offsetHeight : 0;
    body.scrollTo({ top: body.scrollTop + el.getBoundingClientRect().top - body.getBoundingClientRect().top - 12 - under, behavior: 'smooth' });
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
  /* 郵便番号から住所を引く（物件の登録。2026-09-30）。7桁そろったら zipcloud に聞き、町名までを住所に入れる。
     住所が空か、前に引いて入れたままのときだけ書き換える（書き足した番地や、手で書いた住所は消さない）。
     1つの番号に町名が複数あるときは、全部に共通する前の部分（市区町村まで）を入れる。 */
  function wireZip() {
    const zip = dialog.querySelector('[name="zip"]'), addr = dialog.querySelector('[name="addr"]'), msg = dialog.querySelector('[data-zip-msg]');
    let seq = 0;
    zip.oninput = () => {
      const d = zip.value.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '');
      msg.textContent = ''; msg.classList.remove('ng');
      if (d.length !== 7) return;
      const my = ++seq;
      msg.textContent = '住所を探しています…';
      fetch('https://zipcloud.ibsnet.co.jp/api/search?zipcode=' + d).then(r => r.json()).then(j => {
        if (my !== seq) return;
        const rs = (j && j.results) || [];
        if (!rs.length) { msg.textContent = 'この郵便番号の住所は見つかりませんでした。'; msg.classList.add('ng'); return; }
        const all = rs.map(x => x.address1 + x.address2 + x.address3);
        let found = all[0];
        all.forEach(a => { let i = 0; while (i < found.length && found[i] === a[i]) i++; found = found.slice(0, i); });
        msg.textContent = '';
        /* 書き足した住所は消さない。黙って残すと郵便番号と住所が食い違ったままになるので、言う。 */
        if (addr.value.trim() && addr.value !== addr.dataset.auto) {
          if (!addr.value.startsWith(found)) msg.textContent = 'この番号は' + found + 'です。住所は書き換えていません。';
          return;
        }
        addr.value = addr.dataset.auto = found;
        addr.focus(); addr.setSelectionRange(found.length, found.length);
      }).catch(() => {
        if (my !== seq) return;
        msg.textContent = '住所を引けませんでした。住所を書いてください。'; msg.classList.add('ng');
      });
    };
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
      /* 節の見出し（legend「取り決め」）は置かない ―― ダイアログの見出しと同じ言葉が並んだ。
         問いの注記も置かない ―― 問いと選択肢で答え方が決まり、家族でも確かめられる書類の話は
         「父も覚えていない」の後の問いが受け持つ。
         追加の入口は問いの右端（「ある」のときだけ）。件の下に置くと、1件目を読み終えて
         最後までスクロールしないと見つからなかった。件の目次は問いの下（本文の中）に置き、
         スクロールしたら上端に貼り付く（renderToc・area.css の .re-dialog-body .re-toc）。
         （2026-09-29 見本 `_検討/境界フォーム_案v1〜v7.html` のうち、色以外で合意したもの） */
      body =
        question(withAdd('隣と、境界や塀・越境について決めたことはありますか', '隣との取り決め'),
          choice('deal', b.deal || 'unasked',
          [['yes', 'ある'], ['no', 'ない'], ['unasked', 'まだ聞いていない'], ['unknown', WHO + 'も覚えていない']]), '', ' data-entry-q') +
        '<div data-bd-yes>' + tocNav + '<div data-entries>' + es.map((x, i) => bdEntry(i, x)).join('') + '</div></div>' +
        /* 父が覚えていないときは、書類を探した結果を聞く（保存は paper）。 */
        question('境界確認書や測量図は見つかりましたか', choice('found', b.deal === 'unknown' ? b.paper || 'unknown' : 'unknown',
          [['yes', '見つかった'], ['no', '探したが無い'], ['unknown', 'まだ探していない']]),
          '土地を買ったとき・家を建てたときの書類に入っていることがあります。法務局の地積測量図は家族でも取れます。', ' data-bd-unknown') +
        question(allOf('どんな書類ですか'), choice('udoc-', b.docKinds || [], [
          ['confirm', '境界確認書', '隣と境界を確かめ、双方が署名したもの'], ['memo', '越境などの覚書'],
          ['map', '測量図', '地積測量図・確定測量図など']], 'row multi', 'checkbox'), '', ' data-bd-udoc') +
        question('図面の作成日', choice('udocAge', b.docAge || 'unknown', [['after', '2005年3月以降'], ['before', 'それより前'], ['unknown', '分からない']]),
          '2005年3月以降の図面は、境界点の座標が入っています。', ' data-bd-uage');
    } else if (type === 'matter' && key === 'road') {
      /* 私道・通行・配管の取り決め。答えは選ぶだけ（持ち主の名前と、決めた内容を
         除く）。状態・次にすること・くわしくは答えから出す（state.js の roadStatus）。
         使い方は相手の土地ごとに別なので、相手1つを1ブロックにして足せるようにする。 */
      const r = p.matters.road || {};
      const ls = (r.links || []).length ? r.links : [{}];
      bdCount = ls.length; rdHome = p.name;
      title = titles.road; lead = '';
      /* 節の見出し・追加の入口・目次は境界と同じ置き方（2026-09-29）。問いの注記は、何が「ある」に
         入るか（私道・管）を言うので残す。 */
      body =
        question(withAdd(p.name + 'が他人の土地を使っていること、他人が' + p.name + 'の土地を使っていることはありますか', '相手の土地'),
          choice('has', r.has || 'unasked',
          [['yes', 'ある'], ['no', 'ない'], ['unasked', 'まだ聞いていない'], ['unknown', WHO + 'も分からない']]),
          '前の道が私道なら「ある」です（私道は他人の土地）。水道・下水・ガスの管が隣の土地の下を通っている、隣の管がこの家の土地の下を通っている、なども。', ' data-entry-q') +
        '<div data-rd-yes>' + tocNav + '<div data-entries>' + ls.map((x, i) => rdLink(i, x)).join('') + '</div></div>';
    } else if (type === 'matter' && key === 'changed') {
      /* 建物の変更・登記。答えは選ぶだけ（どこを・いつ・頼んだ会社を除く）。状態・次に
         すること・くわしくは答えから出す（state.js の changedStatus）。変更ごとに要る登記と
         書類が違うので、変更1つを1ブロックにして足せるようにする。 */
      const m = p.matters.changed || {};
      const cs = (m.changes || []).length ? m.changes : [{}];
      bdCount = cs.length;
      chBuilt = Math.min(Number(String(p.built || '').replace(/[^0-9]/g, '').slice(0, 4)) || 1950, ...cs.map(c => Number(c.when) || 9999));
      title = titles.changed; lead = '';
      /* 節の見出し・追加の入口・目次は境界と同じ置き方。問いの注記は置かない ―― 家族でも
         確かめられる課税明細書の話は、「父も覚えていない」の後の問いが受け持つ（2026-09-29）。 */
      body =
        question(withAdd('建ててから、増築や取り壊し、離れ・車庫を建てたことはありますか', '建物の変更'),
          choice('has', m.has || 'unasked',
          [['yes', 'ある'], ['no', 'ない'], ['unasked', 'まだ聞いていない'], ['unknown', WHO + 'も覚えていない']]), '', ' data-entry-q') +
        '<div data-ch-yes>' + tocNav + '<div data-entries>' + cs.map((x, i) => chEntry(i, x)).join('') + '</div></div>' +
        question('課税明細書で、登記床面積と現況床面積を比べましたか', choice('check', m.check || '', [
          ['diff', '違いがあった', '現況床面積のほうが大きい・「未登記家屋」の行がある'], ['same', '違いはなかった'], ['', 'まだ比べていない']], 'row'),
          '家屋の欄の「登記地積又は床面積」と「現況地積又は床面積」を比べます。', ' data-ch-unknown');
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
      /* 節は話題の白い札にする（権利関係・件の中と同じ形。2026-09-29）。 */
      body = card('名義',
          question((p.kind === 'condo' ? '専有部分' : '土地・建物') + 'の登記に、前の代の名義が残っていますか',
            choice('remains', pr.remains || 'unknown', [['yes', '残っている'], ['no', '残っていない'], ['unknown', 'まだ確かめていない']]),
            '登記事項証明書で分かります。家族でも法務局で取得できます。') +
          (keys.length > 1 ? question('前の代の名義のもの', choice('parcel-', pr.parcels || [], keys.map(k => [k, nm(k)]), 'pill', 'checkbox'), '', ' data-prior-yes')
            : '<input type="hidden" name="parcel-' + keys[0] + '" value="on">') +
          question('前の代の名義人', '<input class="re-q-in" name="owner" value="' + esc(S.priorOwner(p)) + '" autocomplete="off">',
            '登記のとおりに。権利関係の「名義」にも反映します。', ' data-prior-yes') +
          question('名義人は、' + WHO + 'から見て', choice('rel', pr.rel || 'parent',
            [['parent', WHO + 'の親'], ['grand', WHO + 'の祖父母'], ['spouseParent', SPOUSE + 'の親'], ['other', 'その他']]), '', ' data-prior-yes')) +
        card('名義の移し方',
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
            '相続登記の期限が、これで決まります。'), '', ' data-prior-yes');
    } else if (type === 'right') {
      const r = p.rights[key] || {};
      title = (key === 'land' ? '土地' : p.kind === 'condo' ? '専有部分' : '建物') + 'の権利関係';
      /* 聞くのは、権利関係の表が映すもの（持ち方・名義・持分・登記と違うところ・
         登記に出ない事情）だけ。確認した資料・次にすること・確認する人・時期の欄は
         置かない ―― どこにも映らず、次にすることは表が答えから出す（2026-09-28）。
         登記と違うところ・借地の地主は、ほかの区分と同じ記録なので、同じ問いを
         ここにも置いて、どちらで答えても同じ値にする（state.js の rightCheck）：
           前の代の名義 … 前の代の相続登記の「名義が残っているか」（この部分について）
           建物の変更   … 建物の変更・登記の、変更ごとの「登記」／床面積の比較
           地主         … ローン・契約の「借りている（地主）」の相手
           名義を得たときの紙 … 書類のありかの権利証・契約書の有無（物件に1つ。
                          土地・建物のどちらのフォームで答えても同じ）
         以前は答えを映して「開く」で向こうのフォームへ移していたが、ここで選んでも
         表の状態が変わらず、行き来も要った。「ほかに違うところ」の問いもやめた
         （何が違うのか・次に何をするのかを持てない）。
         左に名前・右に答えの行で揃える（建物の変更の「この変更の記録」と同じ組み方）。 */
      lead = '';
      const lease = key === 'land' && p.kind !== 'condo';
      const lord = (p.deals || []).find(d => d.kind === 'borrow');
      const m = p.matters.changed;
      const chs = key === 'bldg' && p.kind !== 'land' && m ? (m.has === 'yes' ? m.changes || [] : []) : [];
      const chCheck = key === 'bldg' && p.kind !== 'land' && m && m.has === 'unknown';
      const chLabel = c => esc(CH_WHAT[c.what] || '変更') + '<small class="re-ln-z">' +
        esc([CH_SIDE[c.side], c.when ? c.when + '年ごろ' : ''].filter(Boolean).join('・')) + '</small>';
      /* 話題ごとに白い札（2026-09-28 見本 `_検討/権利関係フォーム_案v1.html` の D）。
         札の頭は灰色の帯に名詞の見出し（ページの権利関係の表の行と同じ言葉）、説明は札の中。
         節の見出し（legend）を問いの上に重ねた形は、13pxの灰色の親見出しが問いより弱く、
         見出しを外して余白だけにした形は、問いの区切りが見えなかった。 */
      body =
        card('名義', '<div class="re-lines">' +
          line('持ち方', choice('hold', r.hold || '', [['own', '所有'], ['share', '共有']].concat(lease ? [['lease', '借地']] : [], [['other', 'その他']]))) +
          line('名義人', '<input class="re-q-in" name="owner" value="' + esc(r.owner) + '" autocomplete="off" aria-label="名義人">', ' data-rt-owner') +
          line('持分', '<input class="re-q-in" name="shares" value="' + esc(r.shares === '単独' ? '' : r.shares) + '" placeholder="例：' + esc(WHO) + ' 2分の1・' + esc(SPOUSE) + ' 2分の1" autocomplete="off" aria-label="持分">', ' data-rt-share') +
          (lease ? line('地主', '<input class="re-q-in" name="lord" value="' + esc(lord ? lord.who : '') + '" placeholder="地主の名前" autocomplete="off" aria-label="地主の名前">', ' data-rt-lord') : '') + '</div>' +
          '<p class="re-q-h" data-rt-owner-h></p>') +
        card('登記内容と違うところ', '<div class="re-lines">' +
          line('前の代の名義', choice('prior', S.priorAnswer(p, key), [['yes', '残っている'], ['no', '残っていない'], ['unknown', 'まだ確かめていない']])) +
          chs.map((c, i) => line(chLabel(c), pills('reg-' + i, c.reg || 'unknown', S.chGrow(c.what)
            ? [['yes', '載っている'], ['no', '載っていない'], ['unknown', 'まだ確かめていない']]
            : [['yes', '消えている'], ['no', '残っている'], ['unknown', 'まだ確かめていない']]))).join('') +
          (chCheck ? line('床面積', pills('chcheck', m.check || '', [['diff', '課税明細書と違った'], ['same', '違わなかった'], ['', 'まだ比べていない']])) : '') + '</div>',
          '登記事項証明書で分かります。', ' data-rt-gap') +
        /* 表の「書類」。場所は書類のありかが聞く（ここは有無だけ）。 */
        card('書類', '<div class="re-lines">' +
          [['deed', '権利証', '登記識別情報など'], ['acquire', '契約書・領収書', '買った・建てたとき']].map(([k, lb, sub]) =>
            line(lb + '<small class="re-ln-z">' + sub + '</small>', choice('paper-' + k, ((p.docs.at || {})[k] || {}).st || 'unknown',
              [['have', 'ある'], ['lost', '探したが無い'], ['unknown', 'まだ確かめていない']]))).join('') + '</div>',
          'どこにあるかは「書類のありか」で記録します。') +
        card('登記に出ない事情', '<textarea class="re-q-in" rows="3" name="memo">' + esc(r.memo) + '</textarea>',
          WHO + 'しか知らないことを。例：共有している叔父とは、固定資産税を' + WHO + 'が払う約束。');
    } else if (type === 'prop') {
      /* 物件の登録と基本情報（2026-09-30）。同じフォームを「＋ 物件を登録」と見出しの鉛筆から開く。
         聞くのは、どの物件か（種別・呼び名・住所・建った年）と、今そこに誰が住んでいるかだけ。
         名義・ローン・事情は各部屋のフォームが問いを持つので、ここでは聞かない。
         種別を最初に聞く ―― マンションだけ建物名・部屋番号の欄が要る。
         土地（建物の無い土地）は保留。選択肢には出し、選べなくする（`土地_カテゴリー検討.md`）。
         建った年は、マンションでは1984年より前かで相続登記の文が変わる（render.js の敷地権）。 */
      const isNew = key === 'new';
      title = isNew ? '物件を登録' : '基本情報';
      const now = new Date().getFullYear(), ys = [];
      for (let y = now; y >= 1920; y--) ys.push(y);
      const built = parseInt(p.built, 10);
      /* 組み方は権利関係・ローンのフォームと同じ：話題ごとの白い札、中は「左に名前・右に答え」の行、
         短い選択肢は横に並べる。問いを縦に積み、選択肢を大きな縦の札にした最初の版は、ほかの
         フォームと形が揃っていなかった（2026-09-30）。 */
      body =
        card('物件', '<div class="re-lines">' +
          line('種別', choice('kind', p.kind || '', [['house', '戸建て'], ['condo', 'マンション'], ['land', '土地（準備中）', '', ' data-off']])) +
          line('呼び名', '<input class="re-q-in" name="name" value="' + esc(p.name) + '" placeholder="例：自宅・長岡の家" autocomplete="off" aria-label="呼び名">') + '</div>',
          '別荘・アパート一棟は戸建て、店舗・事務所の区画はマンションに入れます。') +
        card('場所と建った年', '<div class="re-lines">' +
          line('郵便番号', '<input class="re-q-in re-q-zip" name="zip" value="' + esc(p.zip) + '" inputmode="numeric" maxlength="8" placeholder="例：940-0000" autocomplete="off" aria-label="郵便番号">' +
            '<span class="re-zip-msg" data-zip-msg aria-live="polite"></span>') +
          line('住所', '<input class="re-q-in re-q-wide" name="addr" value="' + esc(p.addr) + '" placeholder="例：新潟県長岡市○○町2-5-1" autocomplete="off" aria-label="住所">') +
          line('建物名・部屋番号', '<input class="re-q-in" name="room" value="' + esc(p.room) + '" placeholder="例：○○新横浜 604号室" autocomplete="off" aria-label="建物名・部屋番号">', ' data-prop-room') +
          line('建った年', '<select class="re-yr-sel" name="built" aria-label="建った年"><option value="">分からない</option>' +
            ys.map(y => '<option value="' + y + '"' + (y === built ? ' selected' : '') + '>' + y + '年（' + wareki(y) + '）</option>').join('') + '</select>') + '</div>',
          '郵便番号を入れると、町名までが住所に入ります。続けて番地を書きます。建った年は、登記事項証明書の建物の欄に新築の年月日が載っています。') +
        card('今ここで暮らしている人', choice('use', S.USES[p.use] ? p.use : '', Object.keys(S.USES).map(k => [k, S.USES[k].form])),
          '施設や病院に移った人は含めません。家族以外の人は、借りている人・使わせている人です。', ' data-prop-use') +
        (isNew ? '' : '<div class="re-deal-del">' + entryDel.replace('data-entry-del', 'data-prop-del').replace('data-entry-no', 'data-prop-no').replace('data-entry-yes', 'data-prop-yes').replace('>削除</button>', '>この物件を削除</button>')
          .replace('削除しますか？', 'この物件の記録を、部屋の中身ごと削除しますか？') + '</div>');
    } else if (type === 'addr') {
      /* 登記の住所（マンション、2026-09-30）。答えは選ぶだけ。何をするか・期限は render.js の行が出す。 */
      title = '登記の住所'; lead = '';
      body = question('登記の住所は、' + WHO + 'の今の住所と同じですか',
        choice('addrReg', ['same', 'differ'].includes(p.addrReg) ? p.addrReg : 'unknown',
          [['same', '同じ'], ['differ', '違う'], ['unknown', 'まだ確かめていない']]),
        '登記事項証明書の住所と、' + WHO + 'の住民票の住所を比べます。家族でも法務局・市区町村で取れます。');
    } else if (type === 'loan' || type === 'security') {
      /* ローン・借入（2026-09-28）。この家のローン・借入を1件ずつ入れるだけ。
         返し終えたものも入れる ―― 抵当権が登記に残っていることがある。 */
      const l = p.loan || {};
      const items = (l.items || []).length ? l.items : [{}];
      bdCount = items.length;
      title = 'ローン・借入'; lead = '';
      /* 節の見出しは置かない。ダイアログの見出し「ローン・借入」と同じ言葉が並んだ。
         追加の入口・目次は境界と同じ置き方（2026-09-29。前は件の一覧の帯の右端に置いた）。 */
      body = question(withAdd('この家のローン・借入はありますか', '借入'), choice('has', ['yes', 'no'].includes(l.has) ? l.has : 'unknown',
          [['yes', 'ある'], ['no', 'ない'], ['unknown', 'まだ確かめていない']]),
          '返し終えたものも入れます。抵当権が登記に残っていることがあります。', ' data-entry-q') +
        '<div data-ln-yes>' + tocNav + '<div data-entries>' + items.map((x, i) => lnEntry(i, x)).join('') + '</div></div>' +
        question('残しておくこと', '<textarea class="re-q-in" rows="2" name="memo">' + esc(l.memo) + '</textarea>', '例：返済は2044年3月まで。残高は借入先に聞けば分かる。');
    } else if (type === 'deal') {
      /* 契約の相手（2026-09-28）。1件＝相手。聞くのは、カードとそのとき（貸している・
         借地）が読むものだけ：関係・相手・電話・お金の向き・内容。貸している・借地は
         契約書があるかも聞く（書類のありかに出す・そのときがそろえる紙）。
         確認した資料・次にすること・確認する人・時期の欄は置かない。
         状態は答えから：相手と電話が分かれば、家族が連絡できる（state.js）。 */
      const isNew = key === 'new';
      const d = p.deals[Number(key)] || {};
      title = isNew ? '契約の相手を追加' : '契約の相手'; lead = '';
      const kind = d.kind || 'manage';
      body = section('相手',
        /* 選択肢は短いので横に並べ、選んだものの説明を下に出す（縦の札にすると、
           短い3択がフォームの幅いっぱいを3段取っていた）。 */
        question('どんな関係ですか', choice('kind', kind, [['manage', '管理を頼んでいる'], ['lend', '貸している'], ['borrow', '借りている（地主）']]) +
          '<p class="re-q-h" data-deal-kind-h></p>') +
        question('誰ですか', '<div class="re-lines">' +
          line('名前', '<input class="re-q-in" name="who" value="' + esc(d.who) + '" placeholder="例：○○管理株式会社" autocomplete="off" aria-label="相手の名前">') +
          line('電話', '<input class="re-q-in" name="tel" value="' + esc(d.tel) + '" inputmode="tel" autocomplete="off" aria-label="相手の電話">') + '</div>',
          '電話が分かれば、そのとき家族が連絡できます。')) +
        section('取り決め',
          /* お金の向きは関係で決まる（貸している＝受け取る側、借りている＝払う側）。
             聞くのは払っているか・無償か。無償の貸し借り（使用貸借）は、そのときの扱いが
             違う（借主が亡くなると終わる：民法597条3項）。関係ごとに問いを持ち、見えている
             1つを保存する（前の版は3つの向きを全部並べ、貸しているのに「父が払う」を選べた）。 */
          DEAL_FLOW.map(([k, t, opts]) => question(t, choice('flow-' + k, opts.some(o => o[0] === d.flow) && kind === k ? d.flow : opts[0][0], opts),
            '', ' data-deal-flow="' + k + '"')).join('') +
          question('<span data-deal-what>頼んでいること</span>', '<textarea class="re-q-in" rows="2" name="what">' + esc(d.what) + '</textarea>',
            '', ' data-deal-whatq') +
          question('契約書はありますか', choice('paper', d.paper || 'unknown', [['have', 'ある'], ['none', '口約束のまま'], ['unknown', 'まだ確かめていない']]),
            'あれば、どこにあるかは「書類のありか」で記録します。', ' data-deal-paper')) +
        (isNew ? '' : '<div class="re-deal-del">' + entryDel.replace('data-entry-del', 'data-deal-del').replace('data-entry-no', 'data-deal-no').replace('data-entry-yes', 'data-deal-yes').replace('>削除</button>', '>この相手を削除</button>') + '</div>');
    } else if (type === 'doc') {
      /* 書類のありか：聞くのは場所だけ。紙があるかどうかは、その紙が生まれた区分で
         答えている。権利証・買ったときの契約書は、権利関係のフォームで有無を聞くが、
         場所を記録するときに無いと分かることもあるので、ここでも聞く（data-doc-own。
         同じ記録 docs.at.deed・acquire）。 */
      const own = trigger && trigger.hasAttribute('data-doc-own');
      const at = p.docs.at || {};
      const d = at[key] || (String(key).includes(':') ? at[String(key).split(':')[0]] : null) || {};
      title = (trigger && trigger.dataset.docName) || S.DOC_KINDS[String(key).split(':')[0]].label;
      body = (own ? question('ありますか', choice('st', d.st || 'unknown', [['have', 'ある'], ['lost', '探したが無い'], ['unknown', 'まだ確かめていない']])) : '') +
        question('どこにありますか', choice('kind', d.kind || 'home', [['home', '家の中'], ['safe', '貸金庫'], ['kept', '預けている']]) +
          '<div class="re-q-sub"><input class="re-q-in re-doc-place" name="place" value="' + esc(d.place || '') + '" aria-label="場所" placeholder="例：書斎のキャビネット上段"></div>',
          '家の中なら部屋と棚、貸金庫なら銀行と支店、預けているなら相手の名前を書きます。貸金庫は、' + WHO + 'が亡くなると開けるのに相続人全員の同意が要ります。',
          ' data-doc-where');
    }
    const adding = type === 'prop' && key === 'new';
    dialog.innerHTML = '<form><header class="re-dialog-head"><div><p class="re-eyebrow">' + (adding ? '持っている不動産 ／ 登録' : esc(p.name) + ' ／ 確認と記録') + '</p><h2 id="re-dialog-title" tabindex="-1">' + esc(title) + '</h2></div><span class="re-discardw"><button type="button" class="re-close" aria-label="閉じる" aria-expanded="false">×</button>' +
      '<span class="re-discard" role="alertdialog" aria-label="閉じる前の確認" hidden><span>保存していない入力があります。</span>' +
      '<span class="re-entry-ask-btns"><button type="button" data-keep>入力に戻る</button><button type="button" data-discard>変更を破棄して閉じる</button></span></span></span></header>' +
      (body.includes('class="re-toc"') ? '' : '<nav class="re-toc" aria-label="件の一覧" hidden></nav>') +
      '<div class="re-dialog-body">' + (lead ? '<p class="re-lead">' + esc(lead) + '</p>' : '') + body + '</div>' +
      '<footer class="re-dialog-foot"><p class="re-error" role="alert"></p><span>分かったところまで残せます</span><span class="re-discardw"><button type="button" data-cancel aria-expanded="false">キャンセル</button></span><button class="re-save" type="submit">' + (adding ? '登録する' : '記録を保存') + '</button></footer></form>';
    /* 準備中の選択肢（土地）は見せて、選べなくする。 */
    dialog.querySelectorAll('[data-off] input').forEach(i => { i.disabled = true; });
    if (type === 'prop') wireZip();
    dialog.querySelector('.re-close').onclick = e => closeRequest(e.currentTarget);
    dialog.querySelector('[data-cancel]').onclick = e => closeRequest(e.currentTarget);
    dialog.querySelector('[data-keep]').onclick = () => closeDiscard(true);
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
        dialog.querySelector('[data-entry-add]').hidden = deal !== 'yes' || entries.length >= 4;
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
        dialog.querySelector('[data-entry-add]').hidden = form.elements.has.value !== 'yes' || links.length >= 5;
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
        dialog.querySelector('[data-entry-add]').hidden = has !== 'yes' || items.length >= 5;
      }
      const propRoom = dialog.querySelector('[data-prop-room]');
      if (propRoom) propRoom.hidden = form.elements.kind.value !== 'condo';
      const docWhere = dialog.querySelector('[data-doc-where]');
      if (docWhere && form.elements.st) docWhere.hidden = form.elements.st.value !== 'have';
      const rtShare = dialog.querySelector('[data-rt-share]');
      if (rtShare) {
        const hold = form.elements.hold.value;
        rtShare.hidden = hold !== 'share';
        /* 借地の登記は地主の名義で、表は答えによらず「登記に出ない」と出すので、
           名義・登記と違うところは聞かず、地主を聞く（契約の相手へ入る）。 */
        dialog.querySelector('[data-rt-owner]').hidden = hold === 'lease';
        dialog.querySelector('[data-rt-gap]').hidden = hold === 'lease';
        const lord = dialog.querySelector('[data-rt-lord]');
        if (lord) lord.hidden = hold !== 'lease';
        dialog.querySelector('[data-rt-owner-h]').textContent = hold === 'lease'
          ? '借地は、地主から土地を借りて、その上に' + WHO + 'の建物を建てている形です。地主はローン・契約にも入ります。'
          : (hold === 'share' ? '登記事項証明書のとおりに。共有している人を全員。' : '登記事項証明書のとおりに。') +
            (form.elements.prior.value === 'yes' ? '前の代の名義なら、前の代の名前を。' : '');
      }
      if (identity.type === 'loan' || identity.type === 'security') {
        dialog.querySelector('[data-ln-yes]').hidden = form.elements.has.value !== 'yes';
        const items = dialog.querySelectorAll('[data-loan]');
        items.forEach(el => {
          const f = k => form.elements['n' + el.dataset.loan + '-' + k];
          const who = f('who').value, paid = f('paid').value === 'paid', mine = who !== 'other';
          el.querySelector('[data-n-title]').textContent = f('type').value;
          el.querySelector('[data-sub]').textContent = [f('bank').value.trim(), who === 'other' ? f('whoName').value.trim() : ''].filter(Boolean).join('・');
          el.querySelector('[data-n-other]').hidden = who !== 'other';
          /* 団信は、父（と母）が借りていて返している途中のときだけ。 */
          el.querySelector('[data-n-gtee]').hidden = !mine || paid;
          el.querySelector('[data-n-lieny]').hidden = paid;
          el.querySelector('[data-n-lienp]').hidden = !paid;
          el.querySelector('[data-n-h]').textContent = paid
            ? '返し終えても、抹消の登記をしないと抵当権は残ります。登記事項証明書の「権利部（乙区）」で分かります。'
            : who === 'other' ? '会社や親族の借入に、この家を担保として入れている場合です。登記事項証明書の乙区で、債務者が' + WHO + 'ではない抵当権として載っています。'
            : '団信が付いていれば、残りは保険で返され、家族は返しません（フラット35では任意）。' + WHO + 'と' + SPOUSE + 'は、連帯債務・ペアローンのとき。';
          el.querySelector('[data-entry-del]').hidden = items.length < 2;
        });
        dialog.querySelector('[data-entry-add]').hidden = form.elements.has.value !== 'yes' || items.length >= 5;
      }
      const dealWhat = dialog.querySelector('[data-deal-what]');
      if (dealWhat) {
        const k = form.elements.kind.value;
        dealWhat.textContent = { manage: '頼んでいること', lend: '貸している中身', borrow: '借りている中身' }[k];
        const ta = form.elements.what;
        ta.placeholder = { manage: '例：建物管理。管理費・修繕積立金 月12,000円（毎月27日）', lend: '例：1階の店舗を貸している。家賃 月8万円、敷金2か月', borrow: '例：地代 年24万円（12月に振込）。更新は2031年' }[k];
        dialog.querySelector('[data-deal-paper]').hidden = k === 'manage';
        dialog.querySelector('[data-deal-kind-h]').textContent = { manage: '管理会社や、見回りを頼んでいる親族・近所の人など。',
          lend: 'この家・土地を、ほかの人が借りて使っている。', borrow: '借地。建物の下の土地を、地主から借りている。' }[k];
        dialog.querySelectorAll('[data-deal-flow]').forEach(el => { el.hidden = el.dataset.dealFlow !== k; });
      }
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
      /* 登録で足りないと言った問いを答えたら、文を消す。 */
      if (identity.type === 'prop') dialog.querySelector('.re-error').textContent = '';
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
      if (!ev.target.closest('.re-discardw')) closeDiscard();
      if (to) jump(entryEls()[Number(to.dataset.jump)]);
      const road = identity.key === 'road', ch = identity.key === 'changed', ln = identity.type === 'loan' || identity.type === 'security';
      if (add) { dialog.querySelector('[data-entries]').insertAdjacentHTML('beforeend', ln ? lnEntry(bdCount++, {}) : ch ? chEntry(bdCount++, {}) : road ? rdLink(bdCount++, {}) : bdEntry(bdCount++, {})); conditionals();
        jump(dialog.querySelector('.re-entry:last-child')); }
      if (del) {
        const ask = del.nextElementSibling, opening = ask.hidden;
        closeAsk();
        if (opening) { ask.hidden = false; del.setAttribute('aria-expanded', 'true'); ask.querySelector('[data-entry-no]').focus(); }
      }
      /* 契約の相手を削除する（件と同じ吹き出しで確かめてから）。 */
      const ddel = ev.target.closest('[data-deal-del]');
      if (ddel) {
        const ask = ddel.nextElementSibling, opening = ask.hidden;
        closeAsk();
        if (opening) { ask.hidden = false; ddel.setAttribute('aria-expanded', 'true'); ask.querySelector('[data-deal-no]').focus(); }
      }
      if (ev.target.closest('[data-deal-no]')) closeAsk(true);
      /* 物件を削除する（同じ吹き出しで確かめてから）。部屋の記録もすべて消える。 */
      const pdel = ev.target.closest('[data-prop-del]');
      if (pdel) {
        const ask = pdel.nextElementSibling, opening = ask.hidden;
        closeAsk();
        if (opening) { ask.hidden = false; pdel.setAttribute('aria-expanded', 'true'); ask.querySelector('[data-prop-no]').focus(); }
      }
      if (ev.target.closest('[data-prop-no]')) closeAsk(true);
      if (ev.target.closest('[data-prop-yes]')) {
        try { S.removeProp(identity.id); }
        catch (e) { dialog.querySelector('.re-error').textContent = e.message; return; }
        dialog.close();
        savedCallback({ removed: true });
        return;
      }
      if (ev.target.closest('[data-deal-yes]')) {
        try { S.updateRecord(identity.id, 'deal', identity.key, { remove: true }); }
        catch (e) { dialog.querySelector('.re-error').textContent = e.message; return; }
        dialog.close();
        savedCallback();
        return;
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
      if (identity.type === 'loan' || identity.type === 'security') {
        values.items = Array.from(dialog.querySelectorAll('[data-loan]'), el => {
          const v = k => values['n' + el.dataset.loan + '-' + k];
          const paid = v('paid') === 'paid';
          return { type: v('type'), bank: (v('bank') || '').trim(), tel: (v('tel') || '').trim(), who: v('who') || '',
            whoName: v('who') === 'other' ? (v('whoName') || '').trim() : '', paid,
            gtee: v('who') !== 'other' && !paid ? v('gtee') : '', lien: paid ? v('lienP') : v('lienY') };
        });
        Object.keys(values).filter(k => /^n\d+-/.test(k)).forEach(k => delete values[k]);
      }
      if (identity.type === 'prior') {
        values.parcels = ['land', 'bldg'].filter(k => values['parcel-' + k]);
        values.stage = values.route === 'split' ? values['stage-split'] : values.route === 'unknown' ? 'none' : values['stage-once'];
        if (values.route === 'split' && values.stage === 'none') values.taker = 'self';
        delete values['stage-split']; delete values['stage-once'];
      }
      const error = dialog.querySelector('.re-error');
      if (identity.type === 'prior' && values.remains === 'yes' && !values.parcels.length) { error.textContent = '前の代の名義のものを選んでください。'; return; }
      if (identity.type === 'prop') {
        const miss = !values.kind ? 'どんな物件かを選んでください。' : !(values.name || '').trim() ? '呼び名を書いてください。'
          : !values.use ? '今ここで暮らしている人を選んでください。' : '';
        if (miss) { error.textContent = miss; return; }
        if (identity.key === 'new') {
          let id;
          try { id = S.addProp(values); }
          catch (e) { error.textContent = e.message; return; }
          dialog.close();
          savedCallback({ id });
          return;
        }
      }
      if (identity.type === 'deal' && !values.who.trim()) { error.textContent = '相手の名前・会社名を記録してください。'; return; }
      if (identity.type === 'deal') {
        values.flow = values['flow-' + values.kind];
        DEAL_FLOW.forEach(([k]) => delete values['flow-' + k]);
      }
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
