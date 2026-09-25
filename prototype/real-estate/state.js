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
  /* 画面の文で対象の家族を呼ぶ続柄（既定「父」）。「本人」とは書かない
     ―― 操作するのは基本的に家族で、読み手が迷う（2026-09-24）。 */
  const WHO = (window.SeiZen && window.SeiZen.person && window.SeiZen.person.rel) || '父';
  const SPOUSE = (window.SeiZen && window.SeiZen.person && window.SeiZen.person.spouse) || '母';

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
               about: WHO + 'に確認して、記録に残した状態です。' },
    doing:   { label: '確認中',     tone: 'or', sym: '△',
               about: '調べている・問い合わせている途中です。' },
    todo:    { label: '未確認',     tone: 'or', sym: '△',
               about: 'まだ確認していません。' + WHO + 'に聞けるうちに。' },
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
    unknown: { label: '未確認',     tone: 'bl' },
    done:    { label: '確認済み',   tone: 'gr' },
    action:  { label: '対応が必要', tone: 'or' },
    none:    { label: '該当なし',   tone: 'gy' }
  };

  /* 「本人しか知らない度」。§13-1 の基準を状態と別の軸で持つ。
     家族が後から調べられるものと、本人が失われると消えるものを
     画面で区別するため。進捗（§12）はこちらを重く数える。      */
  const REACH = {
    onlyself: { label: WHO + 'しか知らない', tone: 'or',
                about: WHO + 'に聞けなくなると、調べる先がありません。' },
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
    self:   { label: WHO + 'が住んでいる', tone: 'gr' },
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
    /* 境界は答えだけを持つ（2026-09-24）。問い・文は editor.js と
       render.js の boundaryBody、状態は boundaryStatus。 */
    boundary: { label: '境界・越境', icon: 'bound' },
    /* 私道・通行・配管も答えだけを持つ（2026-09-24）。roadStatus の注記を参照。 */
    road: { label: '私道・通行・配管', icon: 'road' },
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
               about: WHO + 'にも分からない・確認できていない状態です。',
               open: true  },
    unasked: { label: '未確認',     tone: 'or',
               about: 'まだ確認していません。' + WHO + 'に聞けるうちに。',
               open: false }
  };

  /* 3. 契約・やり取り。項目設計 §3 の A・B・C。
     「管理会社」「賃貸管理会社」などを別分類にはしない（§3-C）。 */
  const DEALS = {
    lend:   { label: '貸す・使わせる', tone: 'gr',
              about: WHO + '側の不動産を、' + WHO + '以外が使っている関係です。',
              who: '誰が使っているか' },
    borrow: { label: '借りる',         tone: 'bl',
              about: WHO + 'が他人の土地・建物などを使っている関係です。',
              who: '誰から借りているか' },
    manage: { label: '管理',           tone: 'bl',
              about: WHO + '以外が物件の管理に関わっている関係です。',
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
      /* hold＝権利の種類（所有／共有／借地／その他）。項目設計 §2。
         借地は登記されないことが多く、登記を見ても分からない。
         地主（相手）は §3「借りる」が持つ（§2 の連動指示）。 */
      rights: {
        land:  { hold: 'own', owner: '祖父 一郎（故人）', shares: '', match: 'differ',
                 st: 'action', reach: 'onlyself', memo: '' },
        bldg:  { hold: 'own', owner: WHO, shares: '単独', match: 'same',
                 st: 'done', reach: 'public',
                 memo: '2004年6月に保存登記。' }
      },

      /* 4. 担保。借入の有無に依らず持つ（物上保証があるため）。 */
      security: { has: 'yes', whose: 'self',
                  what: '住宅ローンの担保', bank: '○○銀行',
                  order: '第1順位', st: 'done', reach: 'public' },

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
        debtor: WHO + '単独', gtee: 'あり（団体信用生命保険）', gteeStatus: 'yes',
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
        /* 境界は答えだけを持つ（boundaryStatus の注記を参照）。 */
        boundary: { deal: 'yes', reach: 'onlyself', entries: [
          { side: 'left', who: '◇◇さん', kinds: ['line'], mark: 'wall', wallOwner: 'both', paper: 'no',
            content: '塀を直すときの費用は、半分ずつ出す。' }] },
        /* 前面道路は市道。他人の土地を通る・使わせていることはない。 */
        road:     { has: 'no', links: [], reach: 'onlyself' },
        changed:  { find: 'yes', st: 'action', reach: 'onlyself',
          uiStatus: 'action',
          memo: '北側に約6畳の増築あり（1998年ごろ）。登記には未反映。' +
                '確認申請の有無は工務店に照会中。',
          detail: { what: '北側に約6畳を増築',
                    reg: '未対応', state: '確認申請の有無を照会中' } }
      },

      /* 前の代の相続登記。答えだけを持ち、状態・次の対応・期限は
         priorStatus() と render.js が答えから出す（自由記入は持たない）。
           remains … 前の代の名義が残っているか yes／no／unknown
           parcels … どれが前の代の名義か（land・bldg）
           died    … 前の代が亡くなった時期 before（2024年4月より前）／after／unknown
           stage   … none 話がついていない／agreed 取得する人は決まった（書面なし）／
                     signed 協議書に全員が署名した／registered 相続登記まで済んだ
           taker   … 取得する人 self（本人）／other（takerName）             */
      priorInheritance: { remains: 'yes', parcels: ['land'], owner: '祖父 一郎（故人）', rel: 'parent', route: 'split', died: 'before',
        stage: 'agreed', taker: 'self', takerName: '' },
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
      /* 持つのは**所在**だけ（項目設計 §6・調査 §10-3）。
         揃い具合の管理はしない。中身と原本は「書類・資料」カテゴリ。 */
      docs: {
        place: '書斎のキャビネット上段',
        at: {
          deed:    { st: 'have', place: '書斎のキャビネット上段' },
          acquire: { st: 'lost',  place: '' },
          borrow:  { st: 'have', place: '書斎のキャビネット上段' }
        },
        st: 'action'
      }
    },

    {
      id: 'p2',
      /* 本人（親）が自分の情報を残す画面なので、物件名も本人の視点で持つ。
         「実家」は本人から見れば自分の親の家であって、ここには並ばない。 */
      name: '長岡の家', kind: 'house', use: 'empty',
      addr: '新潟県長岡市○○町2-5-1',
      built: '1971年', note: WHO + 'が生まれ育った家。施設に移ってから空き家。',
      rights: {
        land: { hold: 'own', owner: WHO, shares: '単独', match: 'same',
                st: 'done', reach: 'public', memo: '' },
        bldg: { hold: 'own', owner: WHO, shares: '単独', match: 'same',
                st: 'done', reach: 'public', memo: '' }
      },

      security: { has: 'no', st: 'none', reach: 'public' },
      /* 見回りは「管理を頼んでいる親族等」（§3-C の対象例）。 */
      deals: [
        { kind: 'manage', who: '近所の□□さん', flow: 'none',
          what: '見回り・郵便物の確認。月1回ほど様子を見てもらっている',
          tel: '0258-00-0000', st: 'doing' }
      ],
      loan: { has: false, gteeStatus: 'none', st: 'none', reach: 'public', memo: '完済済み。' },
      matters: {
        boundary: { deal: 'unasked', entries: [], reach: 'onlyself' },
        /* 前面は私道（持分は未確認）。舗装の費用の分け方は口頭のまま。
           裏の家の下水の管が、この家の土地の下を通っている。 */
        road:     { has: 'yes', reach: 'onlyself', links: [
          { land: 'road', who: '向かいの3軒', uses: [{ what: 'pass', by: 'ours' }, { what: 'water', by: 'ours' }, { what: 'sewer', by: 'ours' }],
            share: 'unknown', pact: 'oral', content: '私道の舗装を直すときは、4軒で費用を等分する。' },
          { land: 'back', who: '△△さん', uses: [{ what: 'sewer', by: 'theirs' }], share: '', pact: 'none', content: '' }] },
        changed:  { find: 'unasked', st: 'todo', reach: 'onlyself',
          uiStatus: 'ask',
          memo: '北側に増築部分あり。時期・施工者・登記状況が分からない。', detail: null }
      },
      priorInheritance: { remains: 'no', parcels: [], died: 'unknown', stage: 'none', taker: '', takerName: '' },
      ownerReport: {
        state: 'needed',
        deadline: 'この自治体では、現所有者であることを知った日の翌日から3か月以内'
      },
      access: {
        who: '', key: '', keyKind: '', code: '', how: '',
        st: 'todo', reach: 'onlyself'
      },
      docs: {
        place: '',
        at: {
          deed:    { st: 'unknown', place: '' },
          acquire: { st: 'unknown', place: '' }
        },
        st: 'todo'
      }
    }
  ];

  // 旧版の「誰に聞くか」「作業中か」を示す値は、事実の状態へ読み替える。
  const LEGACY_NOW_STATUS = {
    problem: 'none', ask: 'unknown', check: 'unknown', doing: 'action'
  };
  const canonicalNowStatus = status => LEGACY_NOW_STATUS[status] || status;

  function inferredMatterStatus(key, m) {
    const stored = canonicalNowStatus(m && m.uiStatus);
    if (NOW_STATUS[stored]) return stored;
    if (!m || m.find === 'unasked' || m.find === 'unknown') return 'unknown';
    if (m.find === 'no') return 'none';
    if (m.st === 'action') return 'action';
    if (m.st === 'doing') return 'action';
    return 'done';
  }

  /* 旧 localStorage を読み込んだ場合も、新しい判定項目を補う。 */
  function normalize(p) {
    p.matters = p.matters || {};
    p.docs = p.docs || {};
    p.docs.at = p.docs.at || {};
    p.deals = p.deals || [];
    p.rights = p.rights || {};
    /* 以前の保存では名義・債務者を「本人」と書いていた。続柄へ読み替える。 */
    Object.values(p.rights).forEach(r => { if (r && r.owner === '本人') r.owner = WHO; });
    if (p.loan && typeof p.loan.debtor === 'string') p.loan.debtor = p.loan.debtor.replace(/^本人/, WHO);

    if (p.matters.boundary) {
      p.matters.boundary = migrateBoundary(p.matters.boundary);
      p.matters.boundary.st = stOf(boundaryStatus(p.matters.boundary).status);
    }
    if (p.matters.road) {
      p.matters.road = migrateRoad(p.matters.road);
      p.matters.road.st = stOf(roadStatus(p.matters.road).status);
    }
    ['changed'].forEach(k => {
      if (p.matters[k]) {
        const status = inferredMatterStatus(k, p.matters[k]);
        p.matters[k].uiStatus = status;
        p.matters[k].statusRecords = p.matters[k].statusRecords || {};
        if (!p.matters[k].statusRecords[status]) {
          p.matters[k].statusRecords[status] = {
            memo: p.matters[k].memo || '',
            detail: p.matters[k].detail == null ? null
              : JSON.parse(JSON.stringify(p.matters[k].detail))
          };
        }
        p.matters[k].st = status === 'action' ? 'action'
          : status === 'none' ? 'none'
          : status === 'done' ? 'done' : 'todo';
      }
    });
    p.priorInheritance = migratePrior(p);
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
    return p;
  }

  /* 旧版の前の代の相続（status と各権利の inheritance）を、答えの形へ読み替える。 */
  function migratePrior(p) {
    const pr = p.priorInheritance || {};
    if (pr.remains) {
      /* 道と続柄を持たなかった版は、話し合いの道・父の親として読む。 */
      if (!pr.route) pr.route = 'split';
      if (!pr.rel) pr.rel = 'parent';
      if (pr.stage === 'ready') { pr.stage = 'signed'; pr.seal = 'given'; }
      return pr;
    }
    const keys = Object.keys(p.rights || {});
    const inh = k => (p.rights[k] || {}).inheritance;
    const pending = keys.filter(k => inh(k) === 'pending' ||
      (!inh(k) && pr.status === 'action' && p.rights[k].match === 'differ'));
    const complete = keys.filter(k => inh(k) === 'complete');
    keys.forEach(k => {
      delete p.rights[k].inheritance;
      p.rights[k].owner = String(p.rights[k].owner || '').replace(/名義のまま$/, '');
    });
    const base = { died: 'unknown', taker: '', takerName: '', route: 'split', rel: 'parent' };
    if (pending.length) return { ...base, remains: 'yes', parcels: pending, stage: 'none' };
    if (complete.length) return { ...base, remains: 'yes', parcels: complete, stage: 'registered' };
    if (pr.status === 'none' || pr.status === 'problem') return { ...base, remains: 'no', parcels: [], stage: 'none' };
    return { ...base, remains: 'unknown', parcels: [], stage: 'none' };
  }

  /* ■ 境界・越境の取り決め（2026-09-24 作り直し）
     答えだけを持ち、状態・文は答えから出す（前の代の相続登記と同じ考え方）。
       entries … 隣ごとの取り決め（隣1つにつき1件。以下の side〜content を持つ）
       deal    … 隣と境界や塀・越境について決めたことがあるか
                 yes／no／unasked（まだ聞いていない）／unknown（父も覚えていない）
       kinds   … 決めたこと line 境界の位置／over 越境しているもの
       overs   … 越境しているもの。[{ what, owner }] の並び（隣1つに複数ありうる ――
                 隣の木の枝と自宅の配管、など。持ち主もものごとに違う）。
                 what  wall 塀（地上）／footing 塀の基礎（地中）／roof 屋根・ひさし／
                       tree 木の枝／pipe 配管／other
                 owner ours 自宅／theirs 隣。越境は2軒の間でしか起きないので、
                       持ち主が決まれば向きも決まる（向きは聞かない）
                 （以前の over／overWhat の1件は、読み込み時に overs へ移す）
       side    … どの隣か。玄関を出て right 右隣／left 左隣／back 裏（玄関の反対側）。
                 方角では聞かない ―― 家族は実家の方角を即答できず、父も「裏の
                 山田さん」「右隣」で言う。以前の n・e・s・w は位置不明（''）へ。
                 who … 相手の名前（任意）
       paper   … 書面にしてあるか yes 覚書・境界確認書がある／no 口頭のまま／unknown。
                 父が覚えていないときは、境界確認書・測量図が yes 見つかった／
                 no 探したが無い／unknown まだ探していない
       mark    … 境界の位置の目印 wall 塀／stake 境界標／none 目印はない
       wallOwner … 目印の塀の持ち主 both 両家（塀の中心が境界）／ours 自宅（隣側の面が境界）／
                 theirs 隣（自宅側の面が境界）。位置ではなく持ち主で聞く
                 （以前の center／ourWall／theirWall は読み込み時に読み替える）
       docKinds … 書類があるとき、その種類 confirm 境界確認書／memo 覚書／map 測量図
       docAge  … 図面の日付 after 2005年3月以降（座標入り）／before／unknown
       content … 決めた内容（父しか知らない、構造にできない中身。唯一の自由記入）
     今のうちに当たるのは、書面にない取り決めがあるときだけ ―― 何を決めたかを
     知っているのは当事者だけだから。境界が曖昧なこと自体は、家族が後から
     測量できるので今のうちではない（地籍調査53%／筆界特定0.18%：下エリア調査 §1-4）。 */
  const BD_SIDES = ['right', 'left', 'back'];
  const BD_OVER = ['roof', 'tree', 'pipe', 'wall', 'footing', 'other'];
  /* 越境しているものの並びを整える。1件だけ持っていた版（over／overWhat）も読む。 */
  function toOvers(x) {
    const list = Array.isArray(x.overs) ? x.overs : x.overWhat ? [{ what: x.overWhat, owner: x.over }] : [];
    const seen = new Set();
    return list.filter(o => o && BD_OVER.includes(o.what) && !seen.has(o.what) && seen.add(o.what))
      .map(o => ({ what: o.what, owner: o.owner === 'theirs' ? 'theirs' : 'ours' }));
  }
  function boundaryStatus(b) {
    b = b || {};
    if (b.deal === 'no') return { status: 'none', label: '' };
    /* 父が覚えていないときは、書類を探すところまで進める（paper を
       「見つかった／探したが無い／まだ探していない」として読む）。 */
    if (b.deal === 'unknown') return b.paper === 'yes' ? { status: 'done', label: '書類あり' }
      : b.paper === 'no' ? { status: 'none', label: '記録なし' } : { status: 'unknown', label: '' };
    if (b.deal !== 'yes') return { status: 'unknown', label: '' };
    /* 隣ごとの取り決め。どれか1つでも口頭のまま・書面が分からなければ対応が必要。 */
    const es = b.entries || [];
    if (!es.length) return { status: 'unknown', label: '' };
    if (es.every(e => e.paper === 'yes')) return { status: 'done', label: '書面あり' };
    return { status: 'action', label: '' };
  }
  function stOf(status) { return status === 'unknown' ? 'todo' : status; }
  /* 旧版を答えへ読み替える。
       ・find／detail／memo の版 … 1件の取り決めとして entries へ
       ・取り決めを1件だけ持っていた版（kinds／sides／mark… が直下）… 最初の辺の1件へ
         （隣を複数選んでいても、中身は1件ぶんしかない。辺ごとに複製しない） */
  function migrateBoundary(m) {
    const entry = x => ({
      side: x.side || '', who: x.who || '', kinds: x.kinds || [],
      mark: x.mark || ((x.kinds || []).includes('line') ? (/中心/.test(x.content || '') ? 'center' : /境界標|杭|鋲/.test(x.content || '') ? 'stake' : 'none') : ''),
      wallOwner: x.wallOwner || '',
      overs: toOvers(x), paper: x.paper || 'unknown',
      docKinds: x.docKinds || [], docAge: x.docAge || '', content: x.content || ''
    });
    /* 目印の旧値（位置で持っていた版）を、塀＋持ち主へ。 */
    const OLD_MARK = { center: 'both', ourWall: 'ours', theirWall: 'theirs' };
    const remark = e => { if (OLD_MARK[e.mark]) { e.wallOwner = OLD_MARK[e.mark]; e.mark = 'wall'; }
      if (!BD_SIDES.includes(e.side)) e.side = '';
      e.overs = toOvers(e); delete e.over; delete e.overWhat; return e; };
    if (m.deal && Array.isArray(m.entries)) { m.entries.forEach(remark); return m; }
    if (m.deal) {
      const out = { deal: m.deal, reach: m.reach || 'onlyself', entries: [] };
      if (m.deal === 'yes') out.entries = [remark(entry(Object.assign({}, m, { side: (m.sides || [])[0] || '' })))];
      if (m.deal === 'unknown') { out.paper = m.paper; out.docKinds = m.docKinds || []; out.docAge = m.docAge || ''; }
      return out;
    }
    const d = m.detail || {};
    const deal = m.find === 'yes' ? 'yes' : m.find === 'no' ? 'no' : 'unasked';
    return { deal, reach: m.reach || 'onlyself', entries: deal !== 'yes' ? [] : [remark(entry({
      side: '', who: String(d.who || '').replace(/^[東西南北]隣の?/, ''),
      kinds: [/越境/.test((d.what || '') + (m.memo || '')) ? 'over' : 'line'],
      paper: d.paper === 'あり' ? 'yes' : d.paper === 'なし' ? 'no' : 'unknown',
      content: m.memo || '' }))] };
  }
  /* ■ 私道・通行・配管の取り決め（2026-09-24 作り直し。設計 §8）
     境界の持ち方は写さない。境界は2軒の間の1本の線の上の合意だが、こちらは
     「ある土地のために別の土地を通る・管を通す」という向きのある依存で、相手は
     隣とは限らない（前の私道の持ち主、離れた土地）。
       has   … この家が他人の土地を使っている・使わせていることがあるか
               yes／no／unasked（まだ聞いていない）／unknown（父も分からない）
       links … 相手の土地ごとに1件。
         land  road 前の私道／right 右隣／left 左隣／back 裏の家／other ほかの土地
               （隣は境界と同じく、玄関を出て見た向き）
         who   持ち主の名前・どこの土地か（任意）
         uses  何に使っているか [{ what, by }]
               what pass 通る／water 水道の管／sewer 下水の管／gas ガスの管
               by   ours この家のための通行・管（相手の土地を使っている）／
                    theirs 相手のための通行・管（この家の土地を使わせている）。
                    同じ相手との間に両向きがありうるので、向きは使い方ごとに持つ。
                    前の私道は ours だけ
         share 前の私道のとき、この家も持分を持っているか yes／no／unknown
         pact  取り決め paper 承諾書・覚書がある／oral 口頭で決めた／
               none 特に決めていない／unknown 分からない
         content 決めた内容（書面・口頭のとき。唯一の自由記入）
     今のうちに当たるのは2つ（設計 §8-2）：書面にない取り決め（口頭・分からない）と、
     相手の管がこの家の土地の下を通っていること（見えず、登記にも出ず、他人の管の
     図面は家族には見られない）。後者は記録した時点で今のうちの分が済む。
     承諾書をもらうこと自体は今のうちではない ―― 要るのは管を直す・建て替える・
     売るときで、頼む相手はその時点の持ち主（登記で辿れる）。法律も、管を通す
     しかないときは通知で足りる（民法213条の2、2023年4月）。 */
  const RD_LANDS = ['road', 'right', 'left', 'back', 'other'];
  const RD_USES = ['pass', 'water', 'sewer', 'gas'];
  function toUses(list, land) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).filter(u => u && RD_USES.includes(u.what) && !seen.has(u.what) && seen.add(u.what))
      .map(u => ({ what: u.what, by: land !== 'road' && u.by === 'theirs' ? 'theirs' : 'ours' }));
  }
  function roadStatus(r) {
    r = r || {};
    if (r.has === 'no') return { status: 'none', label: '' };
    if (r.has !== 'yes') return { status: 'unknown', label: '' };
    const ls = r.links || [];
    if (!ls.length) return { status: 'unknown', label: '' };
    if (ls.some(l => l.pact === 'oral' || l.pact === 'unknown')) return { status: 'action', label: '' };
    if (ls.every(l => l.pact === 'paper')) return { status: 'done', label: '書面あり' };
    return { status: 'done', label: '' };
  }
  /* 旧版（find／detail／memo）を答えへ読み替える。前面が私道と書いてあれば
     前の私道の1件にする（持分・取り決めは分からないまま）。 */
  function migrateRoad(m) {
    if (m.has) {
      m.links = (m.links || []).map(l => ({ land: RD_LANDS.includes(l.land) ? l.land : 'other', who: l.who || '',
        uses: toUses(l.uses, l.land), share: l.land === 'road' ? (['yes', 'no'].includes(l.share) ? l.share : 'unknown') : '',
        pact: ['paper', 'oral', 'none'].includes(l.pact) ? l.pact : 'unknown', content: l.content || '' }));
      return m;
    }
    const d = m.detail || {}, text = (m.memo || '') + (d.what || '');
    const out = { has: m.find === 'no' ? 'no' : 'unasked', reach: 'onlyself', links: [] };
    if (m.find !== 'no' && /私道/.test(text)) {
      out.has = 'yes';
      out.links = [{ land: 'road', who: '', uses: [{ what: 'pass', by: 'ours' }], share: 'unknown',
        pact: d.paper === 'あり' ? 'paper' : 'unknown', content: '' }];
    }
    return out;
  }
  /* 書面が「ある」と答えた事情だけ、書類のありかに所在が立つ（下エリア §10-3）。 */
  function matterPaper(p, key) {
    const m = (p.matters || {})[key];
    if (!m) return false;
    if (key === 'boundary') return m.deal === 'unknown' ? m.paper === 'yes' : m.deal === 'yes' && (m.entries || []).some(e => e.paper === 'yes');
    if (key === 'road') return m.has === 'yes' && (m.links || []).some(l => l.pact === 'paper');
    return m.find !== 'no' && !!m.detail && m.detail.paper === 'あり';
  }
  /* 今のうちの行の状態。境界・私道は答えから、建物の変更はまだ旧版の選んだ状態から。 */
  function matterStatus(p, key) {
    const m = (p.matters || {})[key] || {};
    if (key === 'boundary') return boundaryStatus(m);
    if (key === 'road') return roadStatus(m);
    return { status: NOW_STATUS[m.uiStatus] ? m.uiStatus : matterProgress(p, key).status, label: '' };
  }

  let props = (loadSaved() || JSON.parse(JSON.stringify(SEED))).map(normalize);

  // 確認した事実だけを書き戻す。状態の変更から事実を生成しない。
  function matterProgress(p, key) {
    const m = p.matters[key] || {};
    const d = m.detail || {};
    const doc = (p.docs.at || {})[key] || {};
    if (m.find === 'no') return { status: 'none', label: '該当なし', next: '' };
    if (!m.interview && m.uiStatus === 'done') {
      if (d.paper === 'あり' && (!doc.place || doc.st !== 'have'))
        return { status: 'unknown', label: '書類の所在を確認', next: '合意書・資料の保管場所を確認し、家族が取り出せるようにする。' };
      return { status: 'done', label: '記録あり', next: '' };
    }
    if (m.interview !== 'heard' && !m.source) return {
      status: 'unknown', label: m.interview === 'unavailable' ? '別の確認先を探す' : WHO + 'への確認',
      next: m.next || (m.interview === 'unavailable' ? '関係する相手や、残っている資料に手掛かりがないか確認する。' : '')
    };
    if (m.find !== 'yes') return { status: 'unknown', label: '確認先を整理', next: m.next || WHO + 'にも分からなかった点を、資料や関係する相手に確認する。' };
    if (m.next) return { status: 'action', label: '対応が残っています', next: m.next };
    if (m.resolution !== 'resolved') return { status: m.resolution === 'pending' ? 'action' : 'unknown',
      label: m.resolution === 'pending' ? '対応が残っています' : '資料・状況の確認',
      next: m.next || (key === 'changed' ? '工事資料と登記への反映を確認する。' : '取り決めの内容と、残っている確認・相談を整理する。') };
    if (d.paper === 'あり' && (doc.st !== 'have' || !doc.place)) return {
      status: 'unknown', label: '書類の所在を確認', next: '書面の保管場所を確認し、家族が取り出せるようにする。' };
    if (!m.memo || !m.source) return { status: 'unknown', label: '確認の記録を残す', next: '分かった内容と、誰・何で確認したかを記録する。' };
    return { status: 'done', label: '確認・記録済み', next: '' };
  }

  /* 前の代の相続登記の状態は、答えそのものから決まる。状態の欄を別に
     置かない ―― 両方あると「該当なし」なのに「名義が残っている」が作れる。
     取得する人が本人以外で協議書が済めば、本人の手でしかできない部分は
     終わっている（協議書と印鑑証明書に相続登記での期限はない）。
     取得する人が本人なら、登記の申請まで本人が要る。                */
  /* ■ 名義を移す道と、協議の当事者（2026-09-24）
     相続登記は遺産分割協議書を経るとは限らない。道は4つ：
       split 相続人が複数で、話し合い（遺産分割協議）で決める
       will  遺言がある（協議は要らない。取得した人が遺言書で申請）
       sole  相続人が1人だけ（協議は要らない）
       unknown まだ分からない（遺言の有無・相続人を確かめる）
     法定相続分での共有登記は「移す道」ではなく、話し合いがまとまら
     ないうちに義務を果たす手の一つとして、くわしくで扱う。
     協議の当事者（party）は、名義人が父から見て誰かで決まる。父の親・
     祖父母なら父、母の親なら母。その他なら特定しない。
     話し合いの道の段階は4つ：none 話がついていない／agreed 口頭で
     決まった／signed 協議書ができた（全員が署名・実印）／registered。
     遺言・1人の道の段階は none（登記はまだ）と registered だけ。
     seal … 取得するのが当事者以外で協議書ができたとき、当事者の印鑑
     証明書を取得する人に渡したか（given／notyet）。登記には協議書と
     全員の印鑑証明書が要り、亡くなった人の印鑑証明書は取れない。渡す
     前に亡くなると、当事者の相続人全員が「協議書が真正に作られた」旨
     の証明書に実印を押すことになる。当事者の手続きが終わるのは、渡した
     とき。（以前は段階 ready として持っていた。読み込み時に読み替える）
     取得するのが当事者なら、当事者の印鑑証明書は問わない。          */
  const priorParty = pr => pr.rel === 'spouseParent' ? SPOUSE : pr.rel === 'other' ? '' : WHO;
  const priorRoute = pr => ['split', 'will', 'sole', 'unknown'].includes(pr.route) ? pr.route : 'split';
  /* 取得する人が当事者以外に決まり、当事者の手続きが残っていないか。 */
  function priorPartyDone(pr) {
    const route = priorRoute(pr);
    if (pr.taker !== 'other') return false;
    return (route === 'split' && pr.stage === 'signed' && pr.seal === 'given') || route === 'will';
  }
  function priorStatus(p) {
    const pr = p.priorInheritance || {};
    if (pr.remains === 'no') return 'none';
    if (pr.remains !== 'yes') return 'unknown';
    if (pr.stage === 'registered') return 'done';
    if (priorPartyDone(pr)) return 'done';
    return 'action';
  }
  /* 前の代の名義は、前の代の相続登記と権利関係の2つのフォームから
     入力できる。どちらで直しても、もう一方に連動させる（2026-09-24）。
     以前は本人名義のものを選べなくして「先に権利関係を直して」と止めて
     いたが、不便すぎた。
       前の代のフォームで保存 … 選んだ部分の権利関係の名義を、前の代の
         名義人（pr.owner）にする。外した部分は、名義が前の代の名義人の
         ままなら空ける。登記まで済んだら取得した人の名義にし、登記との
         一致も「一致」にする
       権利関係で保存 … 前の代の名義の部分を本人名義に直したら、その
         部分を前の代の名義から外す（全部外れたら「残っていない」）。
         別の名前に直したら、前の代の名義人をその名前にする。前の代の
         名義でなかった部分を前の代の名義人と同じ名前にしたら、加える */
  const selfOwned = owner => (owner === WHO || /本人/.test(owner || '')) && !/故人/.test(owner || '');
  const priorTakerName = pr => pr.taker === 'other' ? (pr.takerName || 'ほかの相続人') : (priorParty(pr) || '相続人');
  /* 前の代の名義人。記録がなければ、前の代の名義の部分の名義から取る。 */
  function priorOwner(p) {
    const pr = p.priorInheritance || {};
    if (pr.owner) return pr.owner;
    const k = (pr.parcels || []).find(k => p.rights[k] && p.rights[k].owner && !selfOwned(p.rights[k].owner));
    return k ? p.rights[k].owner : '';
  }
  /* 前の代の答えを、権利関係の名義・登記との一致へ映す。 */
  /* 前の代の名義に加えたとき、それまでの権利関係の記録（名義・一致）を
     pr.was に取っておき、外したら戻す。取っておいたものがなければ空ける。 */
  function syncPriorToRights(p, prevOwner, prevStage) {
    const pr = p.priorInheritance || {};
    const was = pr.was || (pr.was = {});
    Object.keys(p.rights).forEach(k => {
      const r = p.rights[k];
      const on = pr.remains === 'yes' && (pr.parcels || []).includes(k);
      if (on && pr.stage === 'registered') { r.owner = priorTakerName(pr); r.match = 'same'; }
      else if (on) {
        /* 登記済みから戻したときの名義は取得した人のもので、取っておかない。 */
        if (!was[k] && prevStage !== 'registered' && r.owner && r.owner !== pr.owner && r.owner !== prevOwner) was[k] = { owner: r.owner, match: r.match };
        if (pr.owner) r.owner = pr.owner;
        r.match = 'differ';
      }
      /* まだ確かめていないなら、権利関係の記録には触れない。 */
      else if (pr.remains !== 'unknown' && was[k]) { r.owner = was[k].owner; r.match = was[k].match; delete was[k]; }
      else if (pr.remains !== 'unknown' && r.owner && (r.owner === prevOwner || r.owner === pr.owner)) { r.owner = ''; r.match = 'unknown'; }
      r.st = rightSt(p, k, r);
    });
  }

  /* この権利（land／bldg）に、前の代の名義が登記まで済まずに残っているか。 */
  function priorPending(p, key) {
    const pr = p.priorInheritance || {};
    return pr.remains === 'yes' && pr.stage !== 'registered' && (pr.parcels || []).includes(key);
  }
  const rightSt = (p, key, r) => r.match === 'unknown' || !r.match ? 'todo'
    : (r.match === 'differ' || priorPending(p, key)) ? 'action' : 'done';

  function updateRecord(id, type, key, values) {
    const next = JSON.parse(JSON.stringify(props));
    const p = next.find(x => x.id === id);
    if (!p) throw new Error('物件が見つかりません。');
    const assign = (target, fields) => fields.forEach(k => {
      if (Object.prototype.hasOwnProperty.call(values, k)) target[k] = String(values[k]).trim();
    });
    if (type === 'matter' && key === 'boundary') {
      const m = p.matters.boundary || (p.matters.boundary = { reach: 'onlyself' });
      /* 父が覚えていない道の答え（書類を探した結果）は直下、隣ごとの取り決めは entries。 */
      assign(m, ['deal', 'paper', 'docAge']);
      const docs = v => (v || []).filter(k => ['confirm', 'memo', 'map'].includes(k));
      m.docKinds = docs(values.docKinds);
      if (Array.isArray(values.entries)) m.entries = values.entries.map(e => ({
        side: BD_SIDES.includes(e.side) ? e.side : '', who: String(e.who || '').trim(),
        kinds: (e.kinds || []).filter(k => ['line', 'over'].includes(k)), mark: ['wall', 'stake'].includes(e.mark) ? e.mark : 'none',
        wallOwner: ['ours', 'theirs'].includes(e.wallOwner) ? e.wallOwner : 'both',
        overs: toOvers(e),
        paper: ['yes', 'no'].includes(e.paper) ? e.paper : 'unknown',
        docKinds: docs(e.docKinds), docAge: e.docAge || 'unknown', content: String(e.content || '').trim() }));
      m.st = stOf(boundaryStatus(m).status);
      m.updatedAt = new Date().toISOString();
    } else if (type === 'matter' && key === 'road') {
      const m = p.matters.road || (p.matters.road = { reach: 'onlyself' });
      assign(m, ['has']);
      if (Array.isArray(values.links)) m.links = values.links.map(l => {
        const land = RD_LANDS.includes(l.land) ? l.land : 'other';
        return { land, who: String(l.who || '').trim(), uses: toUses(l.uses, land),
          share: land === 'road' ? (['yes', 'no'].includes(l.share) ? l.share : 'unknown') : '',
          pact: ['paper', 'oral', 'none'].includes(l.pact) ? l.pact : 'unknown',
          content: ['paper', 'oral'].includes(l.pact) ? String(l.content || '').trim() : '' };
      });
      m.st = stOf(roadStatus(m).status);
      m.updatedAt = new Date().toISOString();
    } else if (type === 'matter' && MATTERS[key]) {
      const m = p.matters[key] || (p.matters[key] = {});
      assign(m, ['find', 'interview', 'memo', 'source', 'resolution', 'next', 'assignee', 'timing']);
      m.detail = m.detail || {};
      ['what', 'who', 'deal', 'paper', 'state', 'reg', 'when'].forEach(k => {
        if (Object.prototype.hasOwnProperty.call(values, k)) m.detail[k] = String(values[k]).trim();
      });
      if (values.docSt) {
        p.docs.at[key] = { ...(p.docs.at[key] || {}), st: values.docSt, place: String(values.docPlace || '').trim() };
      }
      /* 状態は、ポップアップの状態欄で選んだ値（values.status）だけで
         決める ―― フォームの答えから状態を推し量ると、選んだ状態を
         次の保存で上書きしてしまう（2026-09-23）。                */
      if (NOW_STATUS[values.status]) m.uiStatus = values.status;
      else if (!NOW_STATUS[m.uiStatus]) m.uiStatus = matterProgress(p, key).status;
      m.st = m.uiStatus === 'unknown' ? 'todo' : m.uiStatus;
      m.updatedAt = new Date().toISOString();
    } else if (type === 'prior') {
      const pr = p.priorInheritance || (p.priorInheritance = {});
      const prevOwner = priorOwner(p), prevStage = pr.stage;
      assign(pr, ['remains', 'died', 'stage', 'taker', 'takerName', 'owner', 'rel', 'route', 'seal']);
      /* 1人の道では、取得するのは当事者。分からない道では段階を持たない。 */
      if (pr.route === 'sole') pr.taker = 'self';
      if (pr.route === 'unknown') pr.stage = 'none';
      if (pr.route !== 'split' && !['none', 'registered'].includes(pr.stage)) pr.stage = 'none';
      if (!pr.owner) pr.owner = prevOwner;
      pr.parcels = (values.parcels || []).filter(k => p.rights[k]);
      if (pr.taker !== 'other') pr.takerName = '';
      syncPriorToRights(p, prevOwner, prevStage);
      pr.updatedAt = new Date().toISOString();
    } else if (type === 'right' && ['land', 'bldg'].includes(key)) {
      const r = p.rights[key] || (p.rights[key] = {});
      const before = r.owner, beforeMatch = r.match;
      assign(r, ['owner', 'hold', 'shares', 'match', 'memo', 'source', 'next', 'assignee', 'timing']);
      /* 前の代の相続登記へ連動（上の syncPriorToRights の逆向き）。
         登記まで済んだ後の名義は取得した人のものなので、連動しない。 */
      const pr = p.priorInheritance || {};
      if (pr.remains === 'yes' && pr.stage !== 'registered' && r.owner !== before) {
        const parcels = pr.parcels || [];
        if (parcels.includes(key)) {
          if (!r.owner || selfOwned(r.owner)) {
            pr.parcels = parcels.filter(k => k !== key);
            if (!pr.parcels.length) pr.remains = 'no';
            if (pr.was) delete pr.was[key];
            /* 「違いがある」は前の代の名義のせいだったので、触っていなければ一致に戻す。 */
            if (r.match === 'differ' && beforeMatch === 'differ') r.match = 'same';
          } else {
            pr.owner = r.owner;
            syncPriorToRights(p, before);
          }
        } else if (r.owner && r.owner === priorOwner(p)) {
          pr.parcels = parcels.concat(key);
          (pr.was || (pr.was = {}))[key] = { owner: before, match: beforeMatch };
          if (r.match === beforeMatch) r.match = 'differ';
        }
      }
      Object.keys(p.rights).forEach(k => { p.rights[k].st = rightSt(p, k, p.rights[k]); });
    } else if (type === 'loan') {
      assign(p.loan, ['bank', 'type', 'debtor', 'gteeStatus', 'memo', 'tel', 'source']);
      p.loan.has = values.has === 'yes' ? true : values.has === 'no' ? false : null;
      p.loan.gtee = { yes: 'あり', no: 'なし', unknown: '不明', none: '該当なし' }[p.loan.gteeStatus] || '不明';
      p.loan.st = p.loan.has === false ? 'none' : !p.loan.bank || !p.loan.debtor || p.loan.gteeStatus === 'unknown' ? 'todo' : 'done';
    } else if (type === 'security') {
      p.security = p.security || {};
      assign(p.security, ['has', 'whose', 'what', 'bank', 'order']);
    } else if (type === 'deal') {
      const index = key === 'new' ? p.deals.length : Number(key);
      if (!Number.isInteger(index) || index < 0 || index > p.deals.length) throw new Error('契約が見つかりません。');
      const d = p.deals[index] || {};
      assign(d, ['kind', 'who', 'what', 'tel', 'flow', 'source', 'next', 'assignee', 'timing']);
      d.st = d.who && d.what && d.source && !d.next ? 'done' : 'doing';
      p.deals[index] = d;
    } else if (type === 'doc' && DOC_KINDS[key]) {
      const d = p.docs.at[key] || {};
      assign(d, ['st', 'place', 'note']);
      p.docs.at[key] = d;
      const m = p.matters[key];
      if (m && key === 'boundary') {
        /* 所在が分かった＝見つかった、と読めるのは父が覚えていない道だけ。
           隣ごとの取り決めは、どの隣の書面か分からないので触らない。 */
        if (d.st === 'have' && m.deal === 'unknown') { m.paper = 'yes'; m.st = stOf(boundaryStatus(m).status); }
      } else if (m && key === 'road') {
        /* 私道も相手ごとに書面を持つので、所在からは書き戻さない。 */
      } else if (m) {
        m.detail = m.detail || {};
        if (d.st === 'have') m.detail.paper = 'あり';
        // 「見つからない」は「書面なし」と同義ではない。
      }
    } else throw new Error('編集する項目が見つかりません。');
    // 保存失敗時は画面の事実も変更しない。
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); }
    catch (e) { throw new Error('保存できませんでした。ブラウザーの保存設定・空き容量を確認してください。入力はこの画面に残っています。'); }
    props = next;
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
    changed:  { label: '増改築・建物変更の資料',     from: 'matter:changed' },
    /* 前の代の協議書・遺言書は、当事者が取得する側で登記がまだのときだけ。 */
    prior:    { label: '前の代の遺産分割協議書',     from: 'prior' },
    priorWill: { label: '前の代の遺言書',            from: 'prior' }
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
        const key = d.from.slice(7), m = (p.matters || {})[key];
        need = key === 'boundary' || key === 'road' ? matterPaper(p, key) : !!m && (m.find === 'yes' || m.find === 'unknown');
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
    updateRecord, matterProgress, matterStatus, matterPaper, priorStatus, priorPending, priorOwner, priorParty, priorRoute, priorPartyDone,
    save
  };
})(window);
