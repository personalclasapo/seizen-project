/* SeiZen プロトタイプ｜保険の状態
   ------------------------------------------------------------------
   この領域で扱う事実を、表示から切り離してここに持つ。画面は
   この状態を描いた結果であって、状態の置き場所ではない。

   銀行口座（bank-account/state.js）と同じ方向性：制度側の問い
   （どんなときに、何を請求できるか）は保険会社・種類が決めるもので、
   家族が書き込むものではない（正本 §3・§8）。契約ごとの事実は
   「その契約をどう使い、いざというとき誰がどう動くか」だけを持つ。

   挙動確認のあいだ手が消えないよう、localStorage に仮保存する
   （実データではなく仮データの入れ替わりなので、残しても構わない）。
   初期の仮データに戻したいときは、コンソールで
   localStorage.removeItem('SeiZenInsurance.policies') を実行する。  */
(function (global) {
  'use strict';

  const STORE_KEY = 'SeiZenInsurance.policies';
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(policies)); } catch (e) { /* 無視 */ }
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* ── 語彙 ───────────────────────────────────────────
     保険を「種類」で分けるのは、家族がいざというとき請求するために
     必要なもの――請求しうる場面（給付）と、辿るべきもの（確認項目）
     ――のセットを決めるためだけ（正本 §3）。分類学でも業界区分でも
     ない。「請求のされ方」が実質的に違うのは次の4つ。

       death    死亡で支払われる保険。請求は受取人。受取人の把握が要。
       medical  生存中の医療費・働けない事態に支払われる保険（医療・
                がん・就業不能・介護）。請求は本人／指定代理請求人。
       savings  満期・年金で本人が受け取る保険（養老・個人年金・学資・
                貯蓄型終身）。受取開始時期・受取口座が要。
       property モノ・賠償の損害保険（自動車・火災・地震・賠償・傷害）。
                請求は契約者。事故時の連絡手順が要。

     この4つは内部の道具。利用者には見せず、会社と商品タイプから
     SeiZen が割り当てる（正本 §8・§9）。                          */

  /* カテゴリごとの見た目の系統。意味（請求のされ方）から色を引くので、
     意味と見た目が離れない。 */
  const KIND_TONES = {
    death:    { label: '死亡保障',       tone: 'k-death' },
    medical:  { label: '医療・就労不能', tone: 'k-med'   },
    savings:  { label: '貯蓄・年金',     tone: 'k-save'  },
    property: { label: '損害（モノ）',   tone: 'k-prop'  }
  };

  /* 給付マスタ。「どんなとき」に「何を」請求できるか。about は制度
     そのものの説明、by はふつう誰が請求するか。契約が変わっても問いは
     変わらないのでここに持つ。 */
  const BENEFITS = {
    death: {
      trigger: '亡くなったとき', name: '死亡保険金', by: '受取人',
      about: '被保険者が亡くなったとき、受取人が請求できます。' },
    disability: {
      trigger: '高度障害になったとき', name: '高度障害保険金', by: '本人・指定代理請求人',
      about: '所定の高度障害状態になった場合に請求できます。' },
    hospital: {
      trigger: '入院したとき', name: '入院給付金', by: '本人・指定代理請求人',
      about: '病気・けがで入院したとき、日数に応じて請求できます。' },
    surgery: {
      trigger: '手術したとき', name: '手術給付金', by: '本人・指定代理請求人',
      about: '約款所定の手術を受けたときに請求できます。' },
    diagnosis: {
      trigger: 'がんと診断されたとき', name: '診断給付金', by: '本人・指定代理請求人',
      about: '所定のがん・特定疾病と診断確定されたときに請求できます。' },
    disabled: {
      trigger: '働けなくなったとき', name: '就業不能・所得補償給付金', by: '本人・指定代理請求人',
      about: '病気・けがで所定の就業不能状態が続いたときに請求できます。' },
    nursing: {
      trigger: '要介護になったとき', name: '介護給付金', by: '本人・指定代理請求人',
      about: '公的介護保険の要介護認定など、所定の状態で請求できます。' },
    maturity: {
      trigger: '満期・年金開始のとき', name: '満期保険金・年金', by: '契約者・受取人',
      about: '契約した時期に達したとき、満期金や年金を受け取れます。' },
    waiver: {
      trigger: '契約者が亡くなったとき（払込免除）', name: '以後の保険料免除', by: '契約者の遺族',
      about: '契約者死亡・高度障害で以後の保険料が免除され、保障・積立は続きます。' },
    accident: {
      trigger: '事故・災害があったとき', name: '保険金（対人・対物・建物・家財ほか）', by: '契約者',
      about: '自動車事故の賠償・自分の車や家の修理などに使えます。' },
    liability: {
      trigger: '他人にけが・損害を与えたとき', name: '個人賠償責任保険金', by: '契約者',
      about: '日常生活で他人にけがをさせた・物を壊したときの賠償に使えます。' }
  };

  /* カテゴリごとに請求できる場面（給付）。詳細の「この保険で請求できる
     こと」に、この順で出る。制度が決めるものなので契約側では足し引き
     しない――カテゴリが変われば、この一覧ごと入れ替わる。 */
  const KIND_BENEFITS = {
    death:    ['death', 'disability'],
    medical:  ['hospital', 'surgery', 'diagnosis', 'disabled', 'nursing'],
    savings:  ['maturity', 'waiver', 'death'],
    property: ['accident', 'liability']
  };

  /* 保険会社マスタ。ロゴの代わりに頭文字を持つ。完成版では外部データ
     から引く。kinds は「この会社が扱う保険カテゴリ」で、商品候補の
     絞り込みに使う。共済も同じ枠で持つ。                            */
  const INSURERS = [
    { name: '日本生命',        kinds: ['death', 'medical', 'savings'], initial: 'N',  tel: '0120-XXX-XXXX' },
    { name: '第一生命',        kinds: ['death', 'medical', 'savings'], initial: 'D',  tel: '0120-XXX-XXXX' },
    { name: '住友生命',        kinds: ['death', 'medical', 'savings'], initial: 'S',  tel: '0120-XXX-XXXX' },
    { name: '明治安田生命',    kinds: ['death', 'medical', 'savings'], initial: 'M',  tel: '0120-XXX-XXXX' },
    { name: 'アフラック',      kinds: ['medical', 'death'],            initial: 'A',  tel: '0120-XXX-XXXX' },
    { name: 'メットライフ生命', kinds: ['medical', 'death', 'savings'], initial: 'ML', tel: '0120-XXX-XXXX' },
    { name: 'オリックス生命',   kinds: ['medical', 'death', 'savings'], initial: 'O',  tel: '0120-XXX-XXXX' },
    { name: 'ソニー生命',      kinds: ['death', 'savings', 'medical'], initial: 'SL', tel: '0120-XXX-XXXX' },
    { name: '県民共済',        kinds: ['death', 'medical'],            initial: '県', tel: '0120-XXX-XXXX' },
    { name: 'ＪＡ共済',        kinds: ['death', 'medical', 'savings', 'property'], initial: 'JA', tel: '0120-XXX-XXXX' },
    { name: 'こくみん共済 coop', kinds: ['death', 'medical', 'property'],           initial: 'C', tel: '0120-XXX-XXXX' },
    { name: '東京海上日動',    kinds: ['property'],                    initial: 'T',  tel: '0120-XXX-XXXX' },
    { name: '損保ジャパン',    kinds: ['property'],                    initial: 'SJ', tel: '0120-XXX-XXXX' },
    { name: '三井住友海上',    kinds: ['property'],                    initial: 'MS', tel: '0120-XXX-XXXX' }
  ];

  /* 商品タイプのマスタ。利用者はこれを選ぶ（種類は選ばない）。type が
     内部カテゴリ。会社を選ぶと、その会社の kinds に合う商品だけが候補
     に出る。ここに無い商品名は自由入力でき、そのときだけカテゴリを
     利用者に選んでもらう。 */
  const PRODUCT_TYPES = [
    { name: '終身保険',        kind: 'death'    },
    { name: '定期保険',        kind: 'death'    },
    { name: '収入保障保険',    kind: 'death'    },
    { name: '医療保険',        kind: 'medical'  },
    { name: 'がん保険',        kind: 'medical'  },
    { name: '三大疾病保険',    kind: 'medical'  },
    { name: '就業不能保険',    kind: 'medical'  },
    { name: '所得補償保険',    kind: 'medical'  },
    { name: '介護保険',        kind: 'medical'  },
    { name: '養老保険',        kind: 'savings'  },
    { name: '個人年金保険',    kind: 'savings'  },
    { name: '学資保険',        kind: 'savings'  },
    { name: '変額保険',        kind: 'savings'  },
    { name: '外貨建て保険',    kind: 'savings'  },
    { name: '自動車保険',      kind: 'property' },
    { name: '火災保険',        kind: 'property' },
    { name: '地震保険',        kind: 'property' },
    { name: '傷害保険',        kind: 'property' },
    { name: '個人賠償責任保険', kind: 'property' },
    { name: '旅行保険',        kind: 'property' },
    { name: 'ペット保険',      kind: 'property' }
  ];
  function productType(name)   { return PRODUCT_TYPES.find(p => p.name === name) || null; }
  function kindOfProduct(name) { const t = productType(name); return t ? t.kind : null; }
  /* その会社が扱えるカテゴリの商品タイプだけを候補として返す。 */
  function productsForInsurer(insurerName) {
    const m = INSURERS.find(i => i.name === insurerName);
    const kinds = m ? m.kinds : Object.keys(KIND_TONES);
    return PRODUCT_TYPES.filter(p => kinds.indexOf(p.kind) > -1);
  }

  /* 家族が請求のときに困らないために確認しておく持ち物・段取り。
     状態は銀行口座の KIT_STATES と同じ考え方：done は「家族が辿れる」
     ことが確かめられたもの、open はまだ辿れないもの、na はこの契約
     では問わないもの。                                              */
  const CHECK_STATES = {
    '確認済み': { tone: 'ok', done: true,  open: false },
    '未確認':   { tone: 'no', done: false, open: true  },
    '対象外':   { tone: 'na', done: false, open: false }
  };

  /* 確認項目のマスタ。家族が請求のときに辿るものはカテゴリごとに
     だいたい決まっている。編集では状態（確認済み／未確認／対象外）と
     場所を書き添える。ここに無いものだけ自由入力で足せる。          */
  const CHECK_ITEMS = {
    death: [
      '証券（保管場所）',
      '受取人の連絡・意思確認',
      '指定代理請求人の登録',
      '請求手続きの窓口・方法'
    ],
    medical: [
      '証券（保管場所）',
      '指定代理請求人の登録',
      '請求アプリ・会員サイトのID',
      '請求手続きの窓口・方法'
    ],
    savings: [
      '証券（保管場所）',
      '受取開始の時期',
      '受取口座',
      '契約者変更の要否',
      '請求手続きの窓口・方法'
    ],
    property: [
      '証券・連絡先カード（保管場所）',
      '事故時の連絡手順',
      '担当代理店の連絡先'
    ]
  };
  function checkItemsFor(kind) {
    return (CHECK_ITEMS[kind] || CHECK_ITEMS.death).slice();
  }

  let seq = 0;
  const uid = p => p + '-' + (++seq);

  /* ── 事実 ───────────────────────────────────────────
     一覧・詳細に出ているのは、ここから描かれる仮データ。4つのカテゴリ
     （死亡保障・医療・貯蓄年金・損害）が1件ずつ揃うようにしてある。   */

  const policies = [
    {
      id: uid('pol'),
      insurer: '日本生命', product: '終身保険', kind: 'death',
      policyNo: '1234-567890',
      holder: '父 太郎', insured: '父 太郎',
      beneficiary: '母 花子（配偶者）',
      startedOn: '2015年4月1日',
      /* 確認する場面。種類の既定に、この契約で実際に効くものだけを残す。 */
      /* 問い合わせ先。会社の窓口・Web・担当代理店。 */
      contact: {
        company: '日本生命\nお客様サービスセンター',
        companyTel: '0120-XXX-XXXX',
        hours: '9:00〜17:00（土日祝除く）',
        web: '保険金・給付金のお問い合わせ／ご請求',
        agent: '○○ライフサービス 横浜支店',
        agentPerson: '担当：○○さん',
        agentTel: '045-XXX-XXXX'
      },
      /* 契約の条件。証券に刷られていて動かない事実。保管場所・指定代理
         請求人は「確認できているか」まで含めて意味を持つので facts では
         なく checks が持つ（同じ事実を二重に持たない）。             */
      facts: {
        term: '終身',
        renewal: '満期なし（終身）',
        amount: '死亡保険金 1,000万円',
        riders: 'リビング・ニーズ特約'
      },
      /* その他の契約情報。保険料・支払方法などの契約管理情報。参考扱い。 */
      admin: {
        premium: '月額 12,000円',
        payMethod: '口座振替',
        payFrom: '横浜銀行 普通 1234567'
      },
      /* メモ。手書き風の自由記述。 */
      memo: '証券原本は書斎の「保険」ファイルに保管。\n担当の○○さんとは母も面識あり。',
      /* 請求のときの持ち物・段取り。 */
      checks: [
        { item: '証券（保管場所）', state: '確認済み', where: '書斎の保険ファイル（書棚A-2）' },
        { item: '受取人の連絡・意思確認', state: '確認済み', where: '母と共有済み' },
        { item: '指定代理請求人の登録', state: '未確認', where: '' },
        { item: '請求手続きの窓口・方法', state: '確認済み', where: 'お客様サービスセンター（証券に記載）' }
      ]
    },
    {
      id: uid('pol'),
      insurer: 'アフラック', product: 'がん保険', kind: 'medical',
      policyNo: '2345-678901',
      holder: '父 太郎', insured: '父 太郎',
      beneficiary: '父 太郎（本人）',
      startedOn: '2018年9月1日',
      /* 医療カテゴリの給付のうち、この契約で実際に効くもの。就業不能・
         介護特約は付けていないので外してある。 */
      benefits: ['diagnosis', 'hospital', 'surgery'],
      contact: {
        company: 'アフラック\nコールセンター',
        companyTel: '0120-XXX-XXXX',
        hours: '9:00〜17:00（土日祝除く）',
        web: 'がん診断・入院・手術給付金のご請求',
        agent: '（保険ショップ経由・担当者なし）',
        agentPerson: '',
        agentTel: ''
      },
      facts: {
        term: '終身',
        renewal: '満期なし（終身）',
        amount: 'がん診断一時金 100万円／入院日額 10,000円',
        riders: '先進医療特約・通院特約'
      },
      admin: {
        premium: '月額 6,400円',
        payMethod: 'クレジットカード',
        payFrom: '○○カード（末尾1234）'
      },
      memo: 'がんと診断されたら、まず診断一時金を請求。母がアプリから手続きできる。IDは本人に確認。',
      checks: [
        { item: '証券（保管場所）', state: '確認済み', where: '書斎の保険ファイル（書棚A-2）' },
        { item: '指定代理請求人の登録', state: '確認済み', where: '母 花子で登録済み' },
        { item: '請求アプリ・会員サイトのID', state: '未確認', where: '' },
        { item: '請求手続きの窓口・方法', state: '確認済み', where: 'アプリまたはコールセンター' }
      ]
    },
    {
      id: uid('pol'),
      insurer: 'ソニー生命', product: '学資保険', kind: 'savings',
      policyNo: '3210-987654',
      holder: '父 太郎', insured: '子 一郎',
      beneficiary: '父 太郎（契約者）',
      startedOn: '2016年4月1日',
      contact: {
        company: 'ソニー生命\nカスタマーセンター',
        companyTel: '0120-XXX-XXXX',
        hours: '9:00〜17:00（土日祝除く）',
        web: '学資金・満期金のお受け取り手続き',
        agent: 'ソニー生命 ○○ライフプランナー',
        agentPerson: '担当：□□さん',
        agentTel: '045-XXX-XXXX'
      },
      facts: {
        term: '子が18歳まで',
        renewal: '満期で終了（更新なし）',
        amount: '満期学資金 200万円（大学入学時）',
        riders: '育英年金なし・払込免除あり'
      },
      admin: {
        premium: '月額 14,000円',
        payMethod: '口座振替',
        payFrom: '横浜銀行 普通 1234567'
      },
      memo: '大学入学の年に満期金が下りる。受取口座は横浜銀行。\n父に万一のことがあれば以後の保険料は免除。',
      checks: [
        { item: '証券（保管場所）', state: '確認済み', where: '書斎の保険ファイル（書棚A-2）' },
        { item: '受取開始の時期', state: '確認済み', where: '子が18歳になる年（2034年）' },
        { item: '受取口座', state: '未確認', where: '' },
        { item: '契約者変更の要否', state: '未確認', where: '' }
      ]
    },
    {
      id: uid('pol'),
      insurer: '東京海上日動', product: '自動車保険', kind: 'property',
      policyNo: '3456-789012',
      holder: '父 太郎', insured: '父 太郎',
      beneficiary: '父 太郎（本人）',
      startedOn: '2024年6月1日',
      contact: {
        company: '東京海上日動\n事故受付センター（24時間）',
        companyTel: '0120-XXX-XXXX',
        hours: '24時間365日',
        web: '事故のご連絡・ロードサービス',
        agent: '△△保険サービス（横浜）',
        agentPerson: '担当：△△さん',
        agentTel: '045-XXX-XXXX'
      },
      facts: {
        term: '1年（自動更新）',
        renewal: '自動更新（案内は届かない・毎年6月）',
        amount: '対人・対物 無制限／車両 150万円',
        riders: '弁護士費用特約・ロードサービス'
      },
      admin: {
        premium: '年額 68,000円',
        payMethod: '口座振替',
        payFrom: '横浜銀行 普通 1234567'
      },
      memo: '事故のときはまず事故受付センターへ。車内に連絡先カードあり。\n運転するのは本人のみ。',
      checks: [
        { item: '証券・連絡先カード（保管場所）', state: '確認済み', where: '車のグローブボックス' },
        { item: '事故時の連絡手順', state: '未確認', where: '' },
        { item: '担当代理店の連絡先', state: '確認済み', where: '△△保険サービス（横浜）／担当△△さん' }
      ]
    }
  ];

  /* 保存済みがあれば仮データを丸ごと差し替える。id は "pol-<n>" の形
     なので、続きの採番が既存分とぶつからないよう seq を合わせ直す。 */
  const saved = loadSaved();
  if (Array.isArray(saved)) {
    policies.length = 0;
    saved.forEach(p => policies.push(p));
    policies.forEach(p => {
      const n = parseInt(String(p.id).split('-').pop(), 10);
      if (!isNaN(n) && n > seq) seq = n;
    });
  }

  /* ── 引き出し ───────────────────────────────────────
     見出しの件数も、一覧のタグも、詳細の場面も、事実から毎回引く。   */

  const kindTone   = k => (KIND_TONES[k] || KIND_TONES.life).tone;
  const kindLabel  = k => (KIND_TONES[k] || KIND_TONES.life).label;
  const benefit    = id => BENEFITS[id] || null;
  const checkState = c => CHECK_STATES[c.state] || CHECK_STATES['未確認'];

  /* このカテゴリで制度上ありうる給付（＝編集で選べる範囲）。 */
  function catBenefitIds(kind) {
    return (KIND_BENEFITS[kind] || KIND_BENEFITS.death).slice();
  }
  /* この契約で実際に効く給付。pol.benefits に無ければカテゴリの既定
     全部。あってもカテゴリ外のものは無視する（カテゴリを変えたあとの
     取り残しを出さない）。 */
  function benefitIds(pol) {
    const cat = catBenefitIds(pol.kind);
    if (!Array.isArray(pol.benefits)) return cat;
    const on = new Set(pol.benefits);
    return cat.filter(id => on.has(id));
  }
  /* 一覧のタグに出す「どんなとき」。 */
  function triggerLabels(pol) {
    return benefitIds(pol).map(id => (BENEFITS[id] || {}).trigger).filter(Boolean);
  }
  /* 詳細の「この保険で請求できること」。給付名と説明を一組で返す。 */
  function benefitRows(pol) {
    return benefitIds(pol).map(id => BENEFITS[id]).filter(Boolean);
  }

  /* 編集で給付を入り切りする。pol.benefits はカテゴリ内の並び順で持つ。 */
  function toggleBenefit(pol, id) {
    const cat = catBenefitIds(pol.kind);
    if (cat.indexOf(id) < 0) return false;
    const on = new Set(Array.isArray(pol.benefits) ? benefitIds(pol) : cat);
    if (on.has(id)) on.delete(id); else on.add(id);
    pol.benefits = cat.filter(x => on.has(x));
    return true;
  }

  /* 請求の持ち物の数え上げ。銀行口座の tally と同じ数え方。 */
  function tally(pol) {
    const list = pol.checks || [];
    return {
      done: list.filter(c => checkState(c).done).length,
      open: list.filter(c => checkState(c).open).length
    };
  }

  /* 表紙の通し番号。事実として持たず、いま並んでいる順（1始まり）
     から毎回引く。削除すれば自然に詰まり、欠番が残らない。          */
  function policyNo(pol) {
    return policies.indexOf(pol) + 1;
  }

  /* 一覧カードの状態。請求のときに家族が辿れない持ち物が残っていれば
     「要確認」。すべて辿れるなら「確認済み」。                       */
  function policyBadge(pol) {
    const t = tally(pol);
    return t.open
      ? { text: '要 確 認', cls: 'warn' }
      : { text: '確 認 済 み', cls: 'off' };
  }

  /* 上部の警告。死亡・高度障害の給付を持つ契約で、受取人や指定代理
     請求人の確認が済んでいないものを拾う。いざというとき「誰が請求
     するか」が宙に浮いていると家族が動けない（正本 §8）。          */
  function unresolved() {
    const out = [];
    policies.forEach(p => {
      const open = (p.checks || []).some(c => checkState(c).open);
      if (open) out.push(p);
    });
    return out;
  }

  function findPolicy(id) { return policies.find(p => p.id === id); }

  /* ── 編集 ───────────────────────────────────────────
     画面から書き換える。保存はしない（リロードで消える）。値の場所は
     'facts.amount' / 'checks.2.where' のようなドット区切りで指す。     */
  function getByPath(pol, path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), pol);
  }
  function setByPath(pol, path, val) {
    const parts = path.split('.');
    const last = parts.pop();
    parts.reduce((o, k) => o[k], pol)[last] = val;
  }

  /* 実際に変わったときだけ true。呼び出し側は変更の有無をこれで見る。 */
  function applyValue(pol, path, val) {
    if (!path) return false;
    const next = String(val).trim();
    if (String(getByPath(pol, path) ?? '') === next) return false;
    setByPath(pol, path, next);
    return true;
  }

  /* カテゴリを変える。系統色・確認項目・請求できる場面（給付）が連動
     する。給付は kind から毎回引くので、ここで保存し直すものは無い。
     利用者はふつう商品を選び直すのでこれを直接触らないが、マスタに
     無い商品名を自由入力したときだけカテゴリ選択に使う。 */
  function setKind(pol, kind) {
    if (!KIND_TONES[kind] || pol.kind === kind) return false;
    pol.kind = kind;
    /* 給付の入り切りはカテゴリ内でしか意味を持たない。カテゴリが変わったら
       選択をいったん解除し、新カテゴリの既定（全部）に戻す。 */
    delete pol.benefits;
    return true;
  }

  /* 商品を変える。実際に変わったときだけ、カテゴリが分かる商品タイプ
     なら kind も連動させる（変わっていなければ kind に触れない――手で
     直した分類を上書きしない）。 */
  function setProduct(pol, name) {
    if (pol.product === name) return false;
    pol.product = name;
    const k = kindOfProduct(name);
    if (k && k !== pol.kind) setKind(pol, k);
    return true;
  }

  /* 確認の紙。マスタ項目は種類で決まるので常に全部が行として在り、
     状態（確認済み／未確認／対象外）と場所だけを書き換える。マスタに
     無い項目は自由入力で足せる。                                     */
  const CHECK_ORDER = ['確認済み', '未確認', '対象外'];

  /* この契約の checks に、マスタ項目の行を（無ければ）補う。編集を
     開いたときに呼び、全項目が並ぶようにする。並びはマスタ優先。 */
  function ensureMasterChecks(pol) {
    const list = pol.checks = pol.checks || [];
    const master = checkItemsFor(pol.kind);
    master.forEach(item => {
      if (!list.some(c => c.item === item)) list.push({ item: item, state: '未確認', where: '' });
    });
    /* マスタ順 → その他（追加順）で整列。 */
    list.sort((a, b) => {
      const ia = master.indexOf(a.item), ib = master.indexOf(b.item);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }

  /* 状態を次へ回す（確認済み→未確認→対象外→…）。読み取り面でも編集面
     でもバッジを押すだけで切り替わる。 */
  function cycleCheckState(pol, i) {
    const c = pol.checks && pol.checks[i];
    if (!c) return;
    const cur = CHECK_ORDER.indexOf(c.state);
    c.state = CHECK_ORDER[(cur + 1) % CHECK_ORDER.length];
  }

  /* マスタに無い項目を自由入力で足す／消す。 */
  function addCheck(pol, item) {
    (pol.checks = pol.checks || []).push({ item: item || '', state: '未確認', where: '' });
  }
  function removeCheck(pol, i) {
    if (pol.checks && i > -1 && i < pol.checks.length) pol.checks.splice(i, 1);
  }
  function isMasterCheck(pol, item) {
    return checkItemsFor(pol.kind).indexOf(item) > -1;
  }

  /* 保険を1件足す。利用者は会社と商品タイプ（または自由入力の商品名＋
     カテゴリ）を選ぶ。カテゴリ（kind）は商品タイプから決まる。       */
  function addPolicy(insurerName, product, kind) {
    const master = INSURERS.find(i => i.name === insurerName);
    const k = kindOfProduct(product) || kind ||
              (master && master.kinds[0]) || 'death';
    const pol = {
      id: uid('pol'),
      insurer: insurerName || '', product: product || '', kind: k,
      policyNo: '', holder: '', insured: '', beneficiary: '', startedOn: '',
      contact: { company: insurerName || '', companyTel: (master && master.tel) || '',
        hours: '', web: '', agent: '', agentPerson: '', agentTel: '' },
      facts: { term: '', renewal: '', amount: '', riders: '' },
      admin: { premium: '', payMethod: '', payFrom: '' },
      memo: '',
      /* そのカテゴリの確認項目を、すべて「未確認」で並べておく。 */
      checks: checkItemsFor(k).map(item => ({ item: item, state: '未確認', where: '' }))
    };
    policies.push(pol);
    return pol;
  }

  function removePolicy(id) {
    const i = policies.findIndex(p => p.id === id);
    if (i > -1) policies.splice(i, 1);
  }

  global.SeiZenInsurance = {
    KIND_TONES, KIND_BENEFITS, BENEFITS, INSURERS, CHECK_STATES, CHECK_ITEMS,
    PRODUCT_TYPES,
    policies, save,
    kindTone, kindLabel, benefit, checkState, checkItemsFor,
    productType, kindOfProduct, productsForInsurer,
    triggerLabels, benefitRows, tally, policyNo, policyBadge, unresolved,
    findPolicy, addPolicy, removePolicy,
    getByPath, setByPath, applyValue, setKind, setProduct,
    catBenefitIds, benefitIds, toggleBenefit,
    ensureMasterChecks, cycleCheckState, addCheck, removeCheck, isMasterCheck
  };
})(window);
