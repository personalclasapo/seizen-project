/* SeiZen プロトタイプ｜不動産・住まいの状態
   ------------------------------------------------------------------
   この領域で扱う事実を、表示から切り離してここに持つ。画面は
   この状態を描いた結果であって、状態の置き場所ではない。

   ■ この領域が成立させたいもの（正本 §13）

   不動産は、家族が「調べれば分かる」ものが比較的多い領域である。
   登記は法務局で取れるし、残債は金融機関に聞けば分かる。それでも
   SeiZen に載せる理由は、§13-1 の基準――**必要になったとき家族が
   思い出せない・調べられないことか**――に照らして次が残るから。

     ・どこに何があるか（物件そのものの所在・書類の所在）
     ・登記に出てこない事情（境界の口約束、越境、私道の負担、
       未登記の増築、名義と実態のずれ、親族間の取り決め）
     ・家族が物理的に入れるか（鍵・暗証番号・立ち会いの要否）

   とくに3つ目の「事情」は、本人が亡くなると調べる先が消える。
   相手方も高齢化し、口約束は記録に残らない。この領域の中心は
   資産評価ではなく、**この事情の受け渡し**にある。

   逆に載せないもの（§13-1）：
     ・固定資産税評価額・時価（継続更新しなければ正しくならない。
       古い額が「確認済み」の顔で残るほうが判断を誤らせる）
     ・登記簿に書いてある内容そのもの（所在が分かれば現物へ辿れる）
     ・間取り・設備の詳細（家族が見れば分かる）

   ■ 造形（正本 §4-2）

   物件ファイルではなく **間取り図**。理由は、この領域で家族が最初に
   知りたいのが「どの部屋に何の話があるか」ではなく「この家が今
   どういう状態で、誰の手が入っているか」だから。間取り図は、
   権利・ローン・事情という抽象を、家という一つの物の上に並べて
   見せられる唯一の器である。部屋の広さは項目の内容量に対応させ、
   壁・開口・建具は実寸比（外壁150mm・内壁100mm・室内ドア780mm）
   から引く。詳細は render.js の PLAN を参照。

   挙動確認のあいだ手が消えないよう localStorage に仮保存する。
   初期の仮データに戻したいときは、コンソールで
   localStorage.removeItem('SeiZenRealEstate.props') を実行する。  */
(function (global) {
  'use strict';

  const STORE_KEY = 'SeiZenRealEstate.props';
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(props)); } catch (e) { /* 無視 */ }
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* ── 語彙 ─────────────────────────────────────────── */

  /* 状態（正本 §11）。「空欄」と「該当なし」を分ける。
     この領域では「調べれば分かるが、まだ調べていない」と
     「本人しか知らないことを聞けていない」が決定的に違う。
     前者は家族が後からでも取り返せるが、後者は取り返せない。 */
  const ST = {
    done:    { label: '確認済み',   tone: 'gr', sym: '○',
               about: '本人に確認して、記録に残した状態です。' },
    doing:   { label: '確認中',     tone: 'or', sym: '△',
               about: '調べている・問い合わせている途中です。' },
    todo:    { label: '未確認',     tone: 'or', sym: '△',
               about: 'まだ確認していません。本人に聞けるうちに。' },
    action:  { label: '対応が必要', tone: 'or', sym: '!',
               about: '確認の結果、手続きや相談が要ると分かった状態です。' },
    none:    { label: '該当なし',   tone: 'gy', sym: '—',
               about: 'この物件には当てはまりません。空欄とは違います。' },
    recheck: { label: '要再確認',   tone: 'bl', sym: '↻',
               about: '条件が変わったら確認しなおす必要があります。' }
  };

  /* 「今のうち」に表示する判定結果。項目ごとに使える値は異なるため、
     render.js 側で候補を絞る。バッジは単なる装飾ではなく、この値を
     選び直す入口として使う。 */
  const NOW_STATUS = {
    problem: { label: '問題なし',   tone: 'gr' },
    done:    { label: '確認済み',   tone: 'gr' },
    none:    { label: '該当なし',   tone: 'gy' },
    ask:     { label: '本人に確認', tone: 'bl' },
    check:   { label: '要確認',     tone: 'bl' },
    doing:   { label: '対応中',     tone: 'bl' },
    action:  { label: '対応が必要', tone: 'or' }
  };

  /* 「本人しか知らない度」。§13-1 の基準を状態と別の軸で持つ。
     家族が後から調べられるものと、本人が失われると消えるものを
     画面で区別するため。進捗（§12）はこちらを重く数える。      */
  const REACH = {
    onlyself: { label: '本人しか知らない', tone: 'or',
                about: '本人に聞けなくなると、調べる先がありません。' },
    askable:  { label: '相手に聞ける',     tone: 'bl',
                about: '金融機関・管理会社など、聞ける先があります。' },
    public:   { label: '公的に調べられる', tone: 'gy',
                about: '登記・役所で取得できます。急ぎではありません。' }
  };

  /* 登記上の名義と、現在認識している権利関係（項目設計 §2）。
     登記の記載そのものは調べれば分かる。家族が調べられないのは
     「実態と違う」という本人の認識のほうなので、それを状態に持つ。 */
  const MATCH = {
    same:    { label: '一致',       tone: 'gr',
               about: '登記の名義と、実際の権利関係が同じです。' },
    differ:  { label: '不一致',     tone: 'or',
               about: '登記の名義と実態が違います。手続きが要ります。' },
    unknown: { label: '分からない', tone: 'or',
               about: '登記を確認していない、または実態が不明です。' }
  };

  /* 物件の種別。家族の動き方が実質的に変わる分け方だけを持つ
     （分類学ではない。正本 §3）。
       house  戸建て … 土地と建物が別の権利。境界・越境が起きる
       condo  マンション … 敷地は共有持分。管理組合が相手に出る
       land   土地のみ … 建物が無い。境界と利用の取り決めが中心
       other  その他 … 収益物件・別荘・共有の山林など           */
  const KINDS = {
    house: { label: '戸建て',     icon: 'house' },
    condo: { label: 'マンション', icon: 'condo' },
    land:  { label: '土地',       icon: 'land'  },
    other: { label: 'その他',     icon: 'other' }
  };

  /* 利用状況。家族が次に取る行動が変わる分け方。 */
  const USES = {
    self:   { label: '本人が住んでいる', tone: 'gr' },
    family: { label: '家族が住んでいる', tone: 'gr' },
    rent:   { label: '貸している',       tone: 'bl' },
    empty:  { label: '空き家',           tone: 'or' },
    unused: { label: '使っていない土地', tone: 'or' }
  };

  /* 5. 確認しておきたい事情。項目設計 §5 の A・B・C の3つだけを持つ。

     以前は8つの型（境界／越境／私道／未登記／増改築／名義／取り決め／
     その他）を並べていたが、項目設計はこれを明示的に否定している。

       ・「未登記部分がある」は独立項目ではなく、C の確認結果として
         把握する（増改築したか → 必要な登記は済んでいるか）
       ・書面にない取り決め・話し合い中・未解決・関係する相手は
         独立分類にしない。すべて A〜C の詳細情報として持つ
       ・名義の事情は 2 権利関係（登記と実態の一致／不一致）が持つ

     正本 §9 に従い、何を確認すべきかの問いは SeiZen 側が持つ。
     利用者は問いに答えるだけでよく、論点を自分で思いつく必要がない。 */
  const MATTERS = {
    boundary: {
      label: '境界・越境', icon: 'bound',
      ask: '境界に不明・曖昧なところはありませんか。塀・建物・屋根' +
           'などの越境はありませんか。',
      why: '確定していないと、売却・建て替えのときに隣家との協議から' +
           '始めることになります。越境は口約束で済ませていることが' +
           '多く、代が変わると「聞いていない」になります。',
      /* 「あり」のとき確認する詳細（項目設計 §5-A） */
      detail: ['何があるか', '相手', '取り決め', '書面の有無'] },
    road: {
      label: '私道・通行・配管', icon: 'road',
      ask: '私道が関係しますか。他人の土地を通行している・させている、' +
           '水道やガスが他人の土地を通っていませんか。',
      why: '私道だと、水道・ガスの工事や再建築に承諾が要ります。' +
           '誰の承諾が要るかは本人しか知らないことが多い項目です。',
      detail: ['何についての関係か', '相手', '取り決め', '書面の有無'] },
    changed: {
      label: '建物の変更・登記', icon: 'build',
      ask: '増築・改築、取り壊し、物置などの新築をしたことは' +
           'ありませんか。必要な登記・手続きは済んでいますか。',
      why: '目的は増改築歴の保存ではなく、実際の建物と登記等に' +
           'ズレが残っていないかの確認です。未登記部分は売却・相続の' +
           '手続きで必ず表に出ます。',
      detail: ['何をしたか', '登記・手続きの状況'] }
  };

  /* 事情の確認結果。項目設計 §5「共通UI」。
     まず なし／あり／分からない で受け、あり・分からない のときだけ
     詳細を開く。§11 に従い「あり」と「分からない」を同じにしない。 */
  const FINDINGS = {
    no:      { label: 'なし',       tone: 'gy',
               about: '確認した結果、当てはまりませんでした。', open: false },
    yes:     { label: 'あり',       tone: 'or',
               about: '当てはまります。詳細を確認します。',     open: true  },
    unknown: { label: '分からない', tone: 'or',
               about: '本人にも分からない・確認できていない状態です。',
               open: true  },
    unasked: { label: '未確認',     tone: 'or',
               about: 'まだ確認していません。本人に聞けるうちに。',
               open: false }
  };

  /* 3. 契約・やり取り。項目設計 §3 の A・B・C。
     「管理会社」「賃貸管理会社」などを別分類にはしない（§3-C）。 */
  const DEALS = {
    lend:   { label: '貸す・使わせる', tone: 'gr',
              about: '本人側の不動産を、本人以外が使っている関係です。',
              who: '誰が使っているか' },
    borrow: { label: '借りる',         tone: 'bl',
              about: '本人が他人の土地・建物などを使っている関係です。',
              who: '誰から借りているか' },
    manage: { label: '管理',           tone: 'bl',
              about: '本人以外が物件の管理に関わっている関係です。',
              who: '誰が管理しているか' }
  };

  /* お金のやり取りの向き。 */
  const FLOWS = {
    pay:  { label: '支払う',   tone: 'or' },
    recv: { label: '受け取る', tone: 'gr' },
    none: { label: 'なし',     tone: 'gy' }
  };

  /* ── 仮データ ─────────────────────────────────────── */

  const SEED = [
    {
      id: 'p1',
      /* 1. 基本情報 */
      name: '自宅', kind: 'house', use: 'self',
      addr: '神奈川県横浜市青葉区あざみ野1丁目12-34',
      built: '2004年', note: '',

      /* 2. 権利関係。土地と建物を別に持つ（戸建ての要点）。
         match は「登記上の名義と、現在認識している権利関係」。
         登記の記載そのものは調べれば分かる。調べられないのは
         実態とのズレなので、そこを状態として持つ（§13-1）。 */
      rights: {
        land:  { owner: '父（故人）名義のまま', shares: '', match: 'differ',
                 st: 'action', reach: 'onlyself',
                 memo: '相続登記が済んでいない。兄弟3人が相続人。' },
        bldg:  { owner: '本人', shares: '単独', match: 'same',
                 st: 'done', reach: 'public',
                 memo: '2004年6月に保存登記。' }
      },

      /* 3. 契約・やり取り。本人以外との間で「現在も続いている関係」。
         公共料金（ガス・電気）はここに入れない。止める・名義を変える
         手続きであって、引き継ぐ関係ではないため（§3 の役割）。 */
      deals: [
        { kind: 'manage', who: '○○管理株式会社', flow: 'pay',
          what: '建物管理。管理費・修繕積立金 月12,000円（毎月27日）',
          tel: '045-123-4567', st: 'done' }
      ],

      /* 4. ローン・担保 */
      loan: {
        has: true, bank: '○○銀行 青葉台支店', type: '住宅ローン',
        debtor: '本人単独', gtee: 'あり（団体信用生命保険）', gteeStatus: 'yes',
        balance: '約1,240万円',
        mortgage: '第1順位・○○銀行', cross: 'なし',
        st: 'done', reach: 'askable',
        memo: '返済は2044年3月まで。残債は銀行に照会すれば分かる。'
      },

      /* 5. 確認しておきたい事情。A・B・C それぞれを
         なし／あり／分からない／未確認 で持つ。
         「あり」「分からない」のときだけ detail を持つ。

         以前あった未登記・名義・取り決めの行は、独立項目をやめて
         それぞれ C の結果・2 権利関係・各詳細の中へ移した。      */
      matters: {
        boundary: { find: 'yes', st: 'action', reach: 'onlyself',
          uiStatus: 'action',
          memo: '西側の境界は、隣家と口頭で「ブロック塀の中心」と' +
                '決めたまま。境界標なし。',
          detail: { what: '境界標がなく、位置が口約束のまま',
                    who: '西隣の◇◇さん', deal: '口頭のみ',
                    paper: 'なし', state: '未解決' } },
        road:     { find: 'no', st: 'done', reach: 'public',
          uiStatus: 'none',
          memo: '前面道路は市道。私道持分なし。通行・配管について隣地との個別の取り決めなし。',
          detail: null },
        changed:  { find: 'yes', st: 'action', reach: 'onlyself',
          uiStatus: 'action',
          memo: '北側に約6畳の増築あり（1998年ごろ）。登記には未反映。' +
                '確認申請の有無は工務店に照会中。',
          detail: { what: '北側に約6畳を増築',
                    reg: '未対応', state: '確認申請の有無を照会中' } }
      },

      priorInheritance: { status: 'action' },
      ownerReport: {
        state: 'needed',
        deadline: 'この自治体では、現所有者であることを知った日の翌日から3か月以内'
      },

      /* 6. 家族が入る方法 */
      access: {
        who: '長男', key: '長男が予備鍵を保管', keyKind: 'ディンプルキー',
        code: '玄関脇の門扉のみ暗証（家族は知っている）',
        how: '立ち会いは不要。管理会社への連絡も不要。',
        st: 'done', reach: 'onlyself'
      },

      /* 6. 確認・手続きに使う書類。
         ここは書類を入力する場所ではなく、この物件を扱うために
         必要な資料が揃っているかを見るインデックス（項目設計 §6）。
         実体と保管場所は「書類・資料」カテゴリが持つ。
         need は 3〜5 の内容から出る（下の neededDocs）。       */
      docs: {
        place: '書斎のキャビネット上段',
        /* 種類ごとの状態だけを持つ。'—' は連動先に記録が無い状態。 */
        have: { deed: 'done', acquire: 'done', build: 'done',
                manage: 'done', loan: 'done', gtee: 'done',
                boundary: 'action', road: 'none', changed: 'action' },
        st: 'action'
      }
    },

    {
      id: 'p2',
      /* 本人（親）が自分の情報を残す画面なので、物件名も本人の視点で持つ。
         「実家」は本人から見れば自分の親の家であって、ここには並ばない。 */
      name: '長岡の家', kind: 'house', use: 'empty',
      addr: '新潟県長岡市○○町2-5-1',
      built: '1971年', note: '本人が生まれ育った家。施設に移ってから空き家。',
      rights: {
        land: { owner: '本人', shares: '単独', match: 'same',
                st: 'done', reach: 'public', memo: '' },
        bldg: { owner: '本人', shares: '単独', match: 'same',
                st: 'done', reach: 'public', memo: '' }
      },
      /* 見回りは「管理を頼んでいる親族等」（§3-C の対象例）。 */
      deals: [
        { kind: 'manage', who: '近所の□□さん', flow: 'none',
          what: '見回り・郵便物の確認。月1回ほど様子を見てもらっている',
          tel: '0258-00-0000', st: 'doing' }
      ],
      loan: { has: false, gteeStatus: 'none', st: 'none', reach: 'public', memo: '完済済み。' },
      matters: {
        boundary: { find: 'unasked', st: 'todo', reach: 'onlyself',
          uiStatus: 'ask',
          memo: '西側の境界について、書類だけでは経緯が分からない。', detail: null },
        road:     { find: 'unknown', st: 'todo', reach: 'onlyself',
          uiStatus: 'check',
          memo: '前面道路は私道。持分と、給排水管の経路が確認できていない。',
          detail: { what: '前面道路が私道。持分の有無が不明',
                    who: '近隣3軒（未確認）', deal: '不明',
                    paper: '不明', state: '未解決' } },
        changed:  { find: 'unasked', st: 'todo', reach: 'onlyself',
          uiStatus: 'ask',
          memo: '北側に増築部分あり。時期・施工者・登記状況が分からない。', detail: null }
      },
      priorInheritance: { status: 'none' },
      ownerReport: {
        state: 'needed',
        deadline: 'この自治体では、現所有者であることを知った日の翌日から3か月以内'
      },
      access: {
        who: '', key: '', keyKind: '', code: '', how: '',
        st: 'todo', reach: 'onlyself'
      },
      docs: { place: '', have: {}, st: 'todo' }
    }
  ];

  function inferredMatterStatus(key, m) {
    if (m && NOW_STATUS[m.uiStatus]) return m.uiStatus;
    if (!m || m.find === 'unasked') return 'ask';
    if (m.find === 'unknown') return 'check';
    if (m.find === 'no') return key === 'boundary' ? 'problem' : 'none';
    if (m.st === 'action') return 'action';
    if (m.st === 'doing') return 'doing';
    return 'done';
  }

  /* 旧 localStorage を読み込んだ場合も、新しい判定項目を補う。 */
  function normalize(p) {
    p.matters = p.matters || {};
    ['boundary', 'road', 'changed'].forEach(k => {
      if (p.matters[k]) {
        const status = inferredMatterStatus(k, p.matters[k]);
        p.matters[k].uiStatus = status;
        p.matters[k].st = status === 'action' ? 'action'
          : status === 'doing' ? 'doing'
          : status === 'none' ? 'none'
          : (status === 'done' || status === 'problem') ? 'done' : 'todo';
        if (k === 'road' && status === 'none' &&
            p.matters[k].memo === '前面道路は市道。') {
          p.matters[k].memo = '前面道路は市道。私道持分なし。' +
            '通行・配管について隣地との個別の取り決めなし。';
        }
      }
    });
    if (!p.priorInheritance) {
      const unfinished = ['land', 'bldg'].some(k =>
        p.rights && p.rights[k] && p.rights[k].match !== 'same');
      p.priorInheritance = { status: unfinished ? 'action' : 'none' };
    }
    if (!p.ownerReport) {
      p.ownerReport = {
        state: 'needed',
        deadline: 'この自治体では、現所有者であることを知った日の翌日から3か月以内'
      };
    }
    p.loan = p.loan || { has: false, st: 'none', reach: 'public' };
    if (!p.loan.gteeStatus) {
      if (!p.loan.has) p.loan.gteeStatus = 'none';
      else if (/不明|未確認/.test(p.loan.gtee || '')) p.loan.gteeStatus = 'unknown';
      else if (/なし/.test(p.loan.gtee || '')) p.loan.gteeStatus = 'no';
      else p.loan.gteeStatus = 'yes';
    }
    if (p.id === 'p1' && p.loan.has && !p.loan.balance) p.loan.balance = '約1,240万円';
    return p;
  }

  let props = (loadSaved() || JSON.parse(JSON.stringify(SEED))).map(normalize);

  const MATTER_STATUS_PATCH = {
    boundary: {
      problem: { find: 'no', st: 'done', reach: 'public',
        memo: '境界標を確認済み。隣地との個別の取り決めなし。', detail: null },
      done: { find: 'yes', st: 'done', reach: 'public',
        memo: '西側の境界について隣家との合意書あり。境界標も確認済み。',
        detail: { what: '西側の境界', who: '西隣', deal: '合意済み', paper: 'あり', state: '解決済み' } },
      ask: { find: 'unasked', st: 'todo', reach: 'onlyself',
        memo: '西側の境界について、書類だけでは経緯が分からない。', detail: null },
      check: { find: 'unknown', st: 'todo', reach: 'askable',
        memo: '境界標と、隣地との取り決めの有無を確認できていない。', detail: null },
      action: { find: 'yes', st: 'action', reach: 'onlyself',
        memo: '西側の境界は、隣家と口頭で「ブロック塀の中心」と決めたまま。境界標なし。',
        detail: { what: '境界標がなく、位置が口約束のまま', who: '西隣', deal: '口頭のみ', paper: 'なし', state: '未解決' } }
    },
    road: {
      none: { find: 'no', st: 'none', reach: 'public',
        memo: '前面道路は市道。私道持分なし。通行・配管について隣地との個別の取り決めなし。', detail: null },
      done: { find: 'yes', st: 'done', reach: 'public',
        memo: '前面道路は私道。持分あり。通行・配管に必要な権利は書類で確認済み。',
        detail: { what: '私道・通行・配管', who: '私道共有者', deal: '権利を確認済み', paper: 'あり', state: '解決済み' } },
      check: { find: 'unknown', st: 'todo', reach: 'askable',
        memo: '前面道路は私道。持分と、給排水管の経路が確認できていない。', detail: null },
      action: { find: 'yes', st: 'action', reach: 'onlyself',
        memo: '給水管が隣地を通っている。使用について隣家と口頭の了承のみ。',
        detail: { what: '給水管が隣地を通る', who: '隣家', deal: '口頭の了承のみ', paper: 'なし', state: '未解決' } }
    },
    changed: {
      none: { find: 'no', st: 'none', reach: 'public',
        memo: '取得後の増築・取り壊しなど、登記に影響する変更なし。', detail: null },
      done: { find: 'yes', st: 'done', reach: 'public',
        memo: '2008年に2階部分を増築。登記への反映を確認済み。',
        detail: { what: '2階部分を増築', reg: '対応済み', state: '登記への反映を確認済み' } },
      ask: { find: 'unasked', st: 'todo', reach: 'onlyself',
        memo: '北側に増築部分あり。時期・施工者・登記状況が分からない。', detail: null },
      check: { find: 'unknown', st: 'todo', reach: 'askable',
        memo: '増改築の有無と、現在の建物が登記内容に反映されているかを確認できていない。', detail: null },
      action: { find: 'yes', st: 'action', reach: 'onlyself',
        memo: '北側に約6畳の増築あり（1998年ごろ）。登記には未反映。確認申請の有無は工務店に照会中。',
        detail: { what: '北側に約6畳を増築', reg: '未対応', state: '確認申請の有無を照会中' } }
    }
  };

  function setNowStatus(id, key, status) {
    const p = props.find(x => x.id === id);
    if (!p || !NOW_STATUS[status]) return false;
    if (key === 'prior') {
      p.priorInheritance.status = status;
      const rights = ['land', 'bldg'].map(k => p.rights && p.rights[k]).filter(Boolean);
      const r = rights.find(x => x.match !== 'same') || rights[0];
      if (r && (status === 'action' || status === 'doing')) {
        r.match = 'differ'; r.st = status === 'doing' ? 'doing' : 'action';
        if (!r.owner || r.owner === '本人') r.owner = '前の代の名義';
        r.memo = status === 'doing' ? '前の代の相続登記を申請中。' : '前の代の相続登記が未了。';
      } else if (rights.length) {
        rights.forEach(x => {
          x.match = 'same'; x.st = 'done'; x.owner = '本人';
          x.shares = x.shares || '単独';
          x.memo = status === 'done' ? '本人名義への相続登記を確認済み。' : '未了の相続なし。';
        });
      }
    } else {
      const patch = MATTER_STATUS_PATCH[key] && MATTER_STATUS_PATCH[key][status];
      const m = p.matters && p.matters[key];
      if (!patch || !m) return false;
      Object.assign(m, JSON.parse(JSON.stringify(patch)), { uiStatus: status });
    }
    save();
    return true;
  }

  /* ── 進捗（正本 §12）──────────────────────────────
     入力率ではなく「必要な状態がどこまで成立しているか」。
     成立とは、家族が動けること。なので数えるのは欄の数ではなく、
     §13-1 で「本人しか知らない」とした事実が受け渡されたか。

     重みづけ：onlyself を 3、askable を 1、public を 0 で数える。
     public（登記で取れるもの）を未確認のまま残しても、家族は
     困らない。困るのは onlyself が空のまま本人が失われること。  */
  const W = { onlyself: 3, askable: 1, public: 0 };

  function gauge(p) {
    let got = 0, need = 0, risk = [];
    const add = (st, reach, label) => {
      const w = W[reach || 'askable'];
      if (st === 'none') return;           /* 該当なしは分母に入れない */
      need += w;
      if (st === 'done') got += w;
      else if (w >= 3) risk.push(label);   /* 本人しか知らない×未確認 */
    };
    add(p.rights.land.st, p.rights.land.reach, '土地の権利関係');
    add(p.rights.bldg.st, p.rights.bldg.reach, '建物の権利関係');
    add(p.loan.st, p.loan.reach, 'ローン・担保');
    add(p.access.st, p.access.reach, '家族が入る方法');
    add(p.docs.st, 'onlyself', '書類のありか');
    Object.keys(p.matters || {}).forEach(k =>
      add(p.matters[k].st, p.matters[k].reach, MATTERS[k].label));
    (p.deals || []).forEach(x => add(x.st, 'askable', x.who));
    return { got, need, risk, pct: need ? Math.round(got / need * 100) : 0 };
  }

  /* 6. この物件で確認すべき書類。項目設計 §6。
     固定の一覧ではなく、3〜5 の内容から出る。基礎的なものは常に、
     残りは「その関係が実際にあるとき」だけ必要になる。          */
  const DOC_KINDS = {
    deed:     { label: '権利証・登記識別情報', base: true },
    acquire:  { label: '取得時の資料（売買・贈与・相続）', base: true },
    build:    { label: '建築・図面の資料', base: 'bldg' },
    manage:   { label: '管理委託契約', from: 'deal:manage' },
    lend:     { label: '賃貸借契約',   from: 'deal:lend' },
    borrow:   { label: '借地契約',     from: 'deal:borrow' },
    loan:     { label: 'ローン関係',   from: 'loan' },
    gtee:     { label: '団信関係',     from: 'loan' },
    boundary: { label: '境界・測量、越境の合意', from: 'matter:boundary' },
    road:     { label: '私道・通行・配管の取り決め', from: 'matter:road' },
    changed:  { label: '増改築・建物変更の資料',     from: 'matter:changed' }
  };

  function neededDocs(p) {
    const out = [];
    const hasBldg = p.kind !== 'land';
    Object.keys(DOC_KINDS).forEach(k => {
      const d = DOC_KINDS[k];
      let need = false;
      if (d.base === true) need = true;
      else if (d.base === 'bldg') need = hasBldg;
      else if (d.from === 'loan') need = !!(p.loan && p.loan.has);
      else if (d.from && d.from.indexOf('deal:') === 0)
        need = (p.deals || []).some(x => x.kind === d.from.slice(5));
      else if (d.from && d.from.indexOf('matter:') === 0) {
        const m = (p.matters || {})[d.from.slice(7)];
        need = !!m && (m.find === 'yes' || m.find === 'unknown');
      }
      if (need) out.push({ kind: k, label: d.label,
        st: (p.docs && p.docs.have && p.docs.have[k]) || 'todo' });
    });
    return out;
  }

  global.SeiZenRealEstate = {
    ST, NOW_STATUS, REACH, MATCH, KINDS, USES, MATTERS, FINDINGS, DEALS, FLOWS, DOC_KINDS,
    all: () => props,
    find: id => props.filter(p => p.id === id)[0] || null,
    gauge,
    neededDocs,
    setNowStatus,
    save
  };
})(window);
