/* SeiZen プロトタイプ｜保険の状態
   ------------------------------------------------------------------
   この領域で扱う事実を、表示から切り離してここに持つ。画面は
   この状態を描いた結果であって、状態の置き場所ではない。

   銀行口座（bank-account/state.js）と同じ方向性：制度側の問い
   （どんなときに、何を請求できるか）は保険会社・種類が決めるもので、
   家族が書き込むものではない（正本 §3・§8）。契約ごとの事実は
   「その契約をどう使い、いざというとき誰がどう動くか」だけを持つ。

   保存はしない。リロードで消えてよい。実在の証券番号や口座番号を
   ブラウザへ残す導線を、プロトタイプの段階では作らない。          */
(function (global) {
  'use strict';

  /* ── 語彙 ───────────────────────────────────────────
     保険の種類と、その種類が持つ「確認する場面（給付）」を一箇所で
     決める。一覧のタグも詳細の場面カードも、ここから引く。         */

  /* 種類ごとの見た目の系統。生命＝ピンク、医療＝ブルー、損保＝ベージュ。
     色は種類から引くので、意味と見た目が離れない。                */
  const KIND_TONES = {
    life:    { label: '生命',   tone: 'k-life' },
    medical: { label: '医療',   tone: 'k-med'  },
    nonlife: { label: '損保',   tone: 'k-non'  }
  };

  /* 給付マスタ。「どんなとき」に「何を」請求できるか。about は制度
     そのものの説明、who はふつう誰が請求するか。銀行口座の SITUATIONS
     と同じで、契約が変わっても問いは変わらないのでここに持つ。      */
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
    accident: {
      trigger: '事故があったとき', name: '保険金（対人・対物・車両ほか）', by: '契約者',
      about: '自動車事故の相手方への賠償・自分の車の修理などに使えます。' }
  };

  /* 種類ごとの、代表的な確認場面。詳細の「この保険を確認する場面」に
     並ぶ順でもある。契約側で trigger を足し引きできるが、既定は種類が
     決める。                                                        */
  const KIND_BENEFITS = {
    life:    ['death', 'disability'],
    medical: ['hospital', 'surgery'],
    nonlife: ['accident']
  };

  /* 保険会社マスタ。ロゴの代わりに頭文字と系統色を持つ。完成版では
     外部データから引く。ここはプロトタイプの挙動（会社を選ぶと種類の
     候補や連絡先の枠が決まる）を確かめるための仮データ。            */
  const INSURERS = [
    { name: '日本生命',       kinds: ['life'],            initial: 'N',  tel: '0120-XXX-XXXX' },
    { name: '第一生命',       kinds: ['life'],            initial: 'D',  tel: '0120-XXX-XXXX' },
    { name: '住友生命',       kinds: ['life'],            initial: 'S',  tel: '0120-XXX-XXXX' },
    { name: '明治安田生命',   kinds: ['life'],            initial: 'M',  tel: '0120-XXX-XXXX' },
    { name: 'アフラック',     kinds: ['medical', 'life'], initial: 'A',  tel: '0120-XXX-XXXX' },
    { name: 'メットライフ生命', kinds: ['medical', 'life'], initial: 'ML', tel: '0120-XXX-XXXX' },
    { name: 'オリックス生命', kinds: ['medical', 'life'], initial: 'O',  tel: '0120-XXX-XXXX' },
    { name: '東京海上日動',   kinds: ['nonlife'],         initial: 'T',  tel: '0120-XXX-XXXX' },
    { name: '損保ジャパン',   kinds: ['nonlife'],         initial: 'SJ', tel: '0120-XXX-XXXX' },
    { name: '三井住友海上',   kinds: ['nonlife'],         initial: 'MS', tel: '0120-XXX-XXXX' }
  ];

  /* 家族が請求のときに困らないために確認しておく持ち物・段取り。
     状態は銀行口座の KIT_STATES と同じ考え方：done は「家族が辿れる」
     ことが確かめられたもの、open はまだ辿れないもの、na はこの契約
     では問わないもの。                                              */
  const CHECK_STATES = {
    '確認済み': { tone: 'ok', done: true,  open: false },
    '未確認':   { tone: 'no', done: false, open: true  },
    '対象外':   { tone: 'na', done: false, open: false }
  };

  let seq = 0;
  const uid = p => p + '-' + (++seq);

  /* ── 事実 ───────────────────────────────────────────
     一覧・詳細に出ている3件は、ここから描かれる。画像の No.001〜003
     に対応する。                                                    */

  const policies = [
    {
      id: uid('pol'), no: 1,
      insurer: '日本生命', product: '終身保険', kind: 'life',
      policyNo: '1234-567890',
      holder: '父 太郎', insured: '父 太郎',
      beneficiary: '母 花子（配偶者）',
      startedOn: '2015年4月1日',
      /* 確認する場面。種類の既定に、この契約で実際に効くものだけを残す。 */
      benefits: ['death', 'disability'],
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
      /* 保険の主な情報。把握のための参考として持つ事実。 */
      facts: {
        term: '終身（更新の必要なし）',
        renewal: '終身のため満期なし',
        amount: '死亡保険金 1,000万円',
        docsAt: '書斎の保険ファイル（書棚A-2）',
        proxy: '未指定',
        riders: 'リビング・ニーズ特約'
      },
      /* その他の契約情報。保険料・支払方法などの契約管理情報。参考扱い。 */
      admin: {
        premium: '月額 12,000円',
        payMethod: '口座振替',
        payFrom: '横浜銀行 普通 1234567'
      },
      /* 家族への申し送り。手書き風メモ。 */
      memo: '証券原本は書斎の「保険」ファイルに保管。\n担当の○○さんとは母も面識あり。',
      /* 請求のときの持ち物・段取り。 */
      checks: [
        { item: '証券（保管場所）', state: '確認済み', where: '書斎の保険ファイル（書棚A-2）' },
        { item: '受取人の連絡・意思確認', state: '確認済み', where: '母と共有済み' },
        { item: '指定代理請求人の登録', state: '未確認', where: '' }
      ]
    },
    {
      id: uid('pol'), no: 2,
      insurer: 'アフラック', product: '医療保険', kind: 'medical',
      policyNo: '2345-678901',
      holder: '父 太郎', insured: '父 太郎',
      beneficiary: '父 太郎（本人）',
      startedOn: '2018年9月1日',
      benefits: ['hospital', 'surgery'],
      contact: {
        company: 'アフラック\nコールセンター',
        companyTel: '0120-XXX-XXXX',
        hours: '9:00〜17:00（土日祝除く）',
        web: '入院・手術給付金のご請求',
        agent: '（保険ショップ経由・担当者なし）',
        agentPerson: '',
        agentTel: ''
      },
      facts: {
        term: '10年更新',
        renewal: '2028年9月に更新（保険料が上がる見込み）',
        amount: '入院日額 10,000円／手術は約款所定',
        docsAt: '書斎の保険ファイル（書棚A-2）',
        proxy: '母 花子',
        riders: '先進医療特約・通院特約'
      },
      admin: {
        premium: '月額 6,400円',
        payMethod: 'クレジットカード',
        payFrom: '○○カード（末尾1234）'
      },
      memo: '入院したら母がアプリから請求できる。IDは本人に確認。\n更新の案内が来たら家族で相談する。',
      checks: [
        { item: '証券（保管場所）', state: '確認済み', where: '書斎の保険ファイル（書棚A-2）' },
        { item: '指定代理請求人の登録', state: '確認済み', where: '母 花子で登録済み' },
        { item: '請求アプリのID', state: '未確認', where: '' }
      ]
    },
    {
      id: uid('pol'), no: 3,
      insurer: '東京海上日動', product: '自動車保険', kind: 'nonlife',
      policyNo: '3456-789012',
      holder: '父 太郎', insured: '父 太郎',
      beneficiary: '父 太郎（本人）',
      startedOn: '2024年6月1日',
      benefits: ['accident'],
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
        term: '1年（毎年6月に自動更新）',
        renewal: '2025年6月に更新',
        amount: '対人・対物 無制限／車両 150万円',
        docsAt: '車の車検証入れ（グローブボックス）',
        proxy: '—',
        riders: '弁護士費用特約・ロードサービス'
      },
      admin: {
        premium: '年額 68,000円',
        payMethod: '口座振替',
        payFrom: '横浜銀行 普通 1234567'
      },
      memo: '事故のときはまず事故受付センターへ。車内に連絡先カードあり。\n運転するのは本人のみ。',
      checks: [
        { item: '証券・連絡先カード（車内）', state: '確認済み', where: '車のグローブボックス' },
        { item: '事故時の連絡手順', state: '未確認', where: '' }
      ]
    }
  ];

  /* ── 引き出し ───────────────────────────────────────
     見出しの件数も、一覧のタグも、詳細の場面も、事実から毎回引く。   */

  const kindTone   = k => (KIND_TONES[k] || KIND_TONES.life).tone;
  const kindLabel  = k => (KIND_TONES[k] || KIND_TONES.life).label;
  const benefit    = id => BENEFITS[id] || null;
  const checkState = c => CHECK_STATES[c.state] || CHECK_STATES['未確認'];

  /* 一覧のタグに出す「どんなとき」。契約の benefits を trigger 文言へ。 */
  function triggerLabels(pol) {
    return (pol.benefits || []).map(id => (BENEFITS[id] || {}).trigger).filter(Boolean);
  }

  /* 詳細の「この保険を確認する場面」。給付名と説明を一組で返す。 */
  function benefitRows(pol) {
    return (pol.benefits || []).map(id => BENEFITS[id]).filter(Boolean);
  }

  /* 請求の持ち物の数え上げ。銀行口座の tally と同じ数え方。 */
  function tally(pol) {
    const list = pol.checks || [];
    return {
      done: list.filter(c => checkState(c).done).length,
      open: list.filter(c => checkState(c).open).length
    };
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

  function addPolicy(insurerName, kind) {
    const master = INSURERS.find(i => i.name === insurerName);
    const k = kind || (master && master.kinds[0]) || 'life';
    const pol = {
      id: uid('pol'),
      no: (policies.reduce((m, p) => Math.max(m, p.no), 0) || 0) + 1,
      insurer: insurerName, product: '', kind: k,
      policyNo: '', holder: '', insured: '', beneficiary: '', startedOn: '',
      benefits: (KIND_BENEFITS[k] || []).slice(),
      contact: { company: insurerName, companyTel: (master && master.tel) || '',
        hours: '', web: '', agent: '', agentPerson: '', agentTel: '' },
      facts: { term: '', renewal: '', amount: '', docsAt: '', proxy: '未指定', riders: '' },
      admin: { premium: '', payMethod: '', payFrom: '' },
      memo: '',
      checks: [{ item: '証券（保管場所）', state: '未確認', where: '' }]
    };
    policies.push(pol);
    return pol;
  }

  function removePolicy(id) {
    const i = policies.findIndex(p => p.id === id);
    if (i > -1) policies.splice(i, 1);
  }

  global.SeiZenInsurance = {
    KIND_TONES, KIND_BENEFITS, BENEFITS, INSURERS, CHECK_STATES,
    policies,
    kindTone, kindLabel, benefit, checkState,
    triggerLabels, benefitRows, tally, policyBadge, unresolved,
    findPolicy, addPolicy, removePolicy
  };
})(window);
