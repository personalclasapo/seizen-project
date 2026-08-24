/* SeiZen プロトタイプ｜銀行口座の状態
   ------------------------------------------------------------------
   この領域で扱う事実を、表示から切り離してここに持つ。画面は
   この状態を描いた結果であって、状態の置き場所ではない。

   ここに置く理由は移植性ではない。正本 §8「一度取得した情報を
   後のステップで再利用する」を、プロトタイプで試せるようにする
   ためのもの。用途・備え・持ち物が互いを参照できる形にしておく。

   保存はしない。リロードで消えてよい。実在の口座番号や家族の
   情報をブラウザへ残す導線を、プロトタイプの段階では作らない。   */
(function (global) {
  'use strict';

  /* ── 語彙 ───────────────────────────────────────────
     選択肢と、その意味づけを一箇所で決める。画面の色や記号は
     状態から引くので、意味と見た目が離れない。                 */

  const KINDS = ['普通預金', '定期預金', '当座預金', '通常貯金', '定額貯金'];
  const ROLES = ['生活費', '給与受取', '年金の受取', '公共料金', 'カード引落', '貯蓄'];

  /* 備えの進捗だけを表す状態。「今のうちだけ」は制度そのものの
     性質であって進捗ではないので、ここには置かない（SITUATIONS側）。 */
  const PREP_STATES = {
    '対応済み':       { tone: 'r-gr' },
    '未対応':         { tone: 'r-or' },
    '確認中':         { tone: 'r-gy' },
    '対象外':         { tone: 'r-gy' },
    '別の方法を検討': { tone: 'r-gy' }
  };

  /* 持ち物の状態。done は「探せる」ことが確かめられたもの、
     open は家族がまだ辿れないもの。na はこの銀行では問わない。   */
  const KIT_STATES = {
    '確認済み': { tone: 'ok', mark: '✓', done: true,  open: false },
    '未確認':   { tone: 'no', mark: '!', done: false, open: true  },
    '利用あり': { tone: 'na', mark: '−', done: false, open: false },
    '利用なし': { tone: 'na', mark: '−', done: false, open: false },
    '発行なし': { tone: 'na', mark: '−', done: false, open: false },
    '登録なし': { tone: 'na', mark: '−', done: false, open: false }
  };

  /* 物によって答えられることが違う。通帳に「利用あり」は選ばせない。 */
  const KIT_STATES_BY_ITEM = {
    '通帳':             ['確認済み', '未確認', '発行なし'],
    'キャッシュカード': ['確認済み', '未確認', '発行なし'],
    '届出印':           ['確認済み', '未確認', '登録なし'],
    '契約印（届出印）': ['確認済み', '未確認', '登録なし'],
    'ネットバンキング': ['利用あり', '利用なし', '未確認'],
    '本人確認書類':     ['確認済み', '未確認'],
    '印鑑（実印）':     ['確認済み', '未確認'],
    '委任状':           ['確認済み', '未確認', '発行なし']
  };
  const KIT_STATES_ANY = ['確認済み', '未確認'];

  /* 銀行マスタ。制度名は銀行が決めるものであって、家族が書き込む
     ものではない（正本 §3・§8）。means は situation ごとの制度名で、
     null はその銀行にその仕組みがないことを表す。

     完成版では外部の制度データベースから引く。ここに載っているのは
     プロトタイプの挙動（＝銀行を選ぶと制度名が自動で決まる）を
     確かめるための仮データで、既存3行（三井住友・ゆうちょ・ソニー）
     以外は精度を作り込んでいない。                                */
  const BANKS = [
    { name: '三菱UFJ銀行',      means: { immobile: '代理人カード',     capacity: '代理人指名手続' } },
    { name: 'みずほ銀行',        means: { immobile: '代理人カード',     capacity: null } },
    { name: '三井住友銀行',      means: { immobile: '代理人カード',     capacity: '代理人指名手続' } },
    { name: 'りそな銀行',        means: { immobile: null,               capacity: '代理人指名手続' } },
    { name: 'ゆうちょ銀行',      means: { immobile: 'ゆうちょ代理人カード', capacity: '代理人サービス' } },
    { name: '楽天銀行',          means: { immobile: '代理人カード',     capacity: null } },
    { name: '住信SBIネット銀行', means: { immobile: null,               capacity: null } },
    { name: 'ソニー銀行',        means: { immobile: null,               capacity: null } },
    { name: 'PayPay銀行',       means: { immobile: null,               capacity: null } },
    { name: 'イオン銀行',        means: { immobile: null,               capacity: null } }
  ];

  /* 備えの「もし◯◯のとき」は制度側の問い。銀行が変わっても
     問いは変わらないので、口座ではなくここに持つ。urgent は
     「本人の判断能力があるうちにしか申し込めない」という、この
     制度そのものの性質（正本 §3）。銀行や進捗が変わっても動かない。 */
  const SITUATIONS = [
    { id: 'immobile', label: '入院などで動けないとき', hint: 'ATM での引き出しなど',     urgent: false,
      /* about は制度そのものの説明。when はそれがいつ効いてくるかの補足。
         前者を読めば何の手続きか分かり、後者で自分ごとになる。       */
      about: 'ATMで引き出し・振り込みができるようになる仕組み。',
      when:  '本人が窓口やATMへ行けないとき、生活費等を家族が動かせます。' },
    { id: 'capacity', label: '判断能力が低下したとき', hint: '窓口での手続き・解約など', urgent: true,
      about: '窓口での手続き・解約などに必要な手続き。',
      when:  '認知症などで本人の判断能力が下がると口座は凍結されます。' }
  ];

  /* 持ち物は制度（prep）ごとに別の問い。「もし◯◯のとき」に必要な
     ものは、それぞれの手段によって変わる。届出印と契約印のように
     同じ実印を指していても、確認の文脈が違えば別項目として持つ。   */
  const KIT_ITEMS_BY_SITUATION = {
    immobile: ['通帳', 'キャッシュカード', '届出印'],
    capacity: ['本人確認書類', '印鑑（実印）', '契約印（届出印）', '委任状']
  };

  let seq = 0;
  const uid = p => p + '-' + (++seq);

  /* ── 事実 ───────────────────────────────────────────
     いま画面に出ている3行は、ここから描かれる。               */

  const banks = [
    {
      id: uid('bank'),
      name: '三井住友銀行',
      updated: '2025.05.18',
      dormant: false,
      note: '2件の口座はまとめて対象になります。同じ窓口で手続きでき、手数料はかかりません。',
      accounts: [
        { id: uid('acc'), kind: '普通預金', branch: '渋谷支店', number: '1234567', owner: '本人（父）', roles: ['生活費', '公共料金'] },
        { id: uid('acc'), kind: '定期預金', branch: '渋谷支店', number: '1234568', owner: '本人（父）', roles: ['貯蓄'] }
      ],
      prep: [
        { situation: 'immobile', who: '長男', state: '対応済み', doneOn: '2025.05.18', note: '',
          kit: [
            { item: '通帳',             state: '確認済み', where: '自宅・リビング収納の上段' },
            { item: 'キャッシュカード', state: '確認済み', where: '自宅・本人の財布' },
            { item: '届出印',           state: '確認済み', where: '自宅・仏壇の引き出し' }
          ] },
        { situation: 'capacity', who: '', state: '未対応', doneOn: '', note: '',
          kit: [
            { item: '本人確認書類',     state: '確認済み', where: '自宅・書類ケース' },
            { item: '印鑑（実印）',     state: '未確認',   where: '' },
            { item: '契約印（届出印）', state: '確認済み', where: '自宅・仏壇の引き出し' },
            { item: '委任状',           state: '未確認',   where: '' }
          ] }
      ]
    },
    {
      id: uid('bank'),
      name: 'ゆうちょ銀行',
      updated: '2025.05.18',
      dormant: false,
      note: '年金の受取口座です。引き出せなくなると生活費に直接影響します。',
      accounts: [
        { id: uid('acc'), kind: '通常貯金', branch: '記号 12345', number: '番号 6789012', owner: '本人（父）', roles: ['年金の受取'] }
      ],
      prep: [
        { situation: 'immobile', who: '', state: '未対応', doneOn: '', note: '同居の家族1名まで',
          kit: [
            { item: '通帳',             state: '確認済み', where: '自宅・仏壇の引き出し' },
            { item: 'キャッシュカード', state: '未確認',   where: '' },
            { item: '届出印',           state: '未確認',   where: '' }
          ] },
        { situation: 'capacity', who: '', state: '未対応', doneOn: '', note: '',
          kit: [
            { item: '本人確認書類',     state: '未確認',   where: '' },
            { item: '印鑑（実印）',     state: '未確認',   where: '' },
            { item: '契約印（届出印）', state: '未確認',   where: '' },
            { item: '委任状',           state: '未確認',   where: '' }
          ] }
      ]
    },
    {
      id: uid('bank'),
      name: 'ソニー銀行',
      updated: '2025.05.20',
      dormant: true,
      note: 'この銀行だけでの対策はできません。ほかの資産とあわせて検討する必要があります。',
      accounts: [
        { id: uid('acc'), kind: '定期預金', branch: '', number: '', owner: '本人（父）', roles: [] }
      ],
      prep: [
        { situation: 'immobile', who: '', state: '対象外', doneOn: '', note: '',
          kit: [
            { item: '通帳',             state: '発行なし', where: 'ネット専業のため通帳はありません' },
            { item: 'キャッシュカード', state: '未確認',   where: '' },
            { item: '届出印',           state: '登録なし', where: '印鑑の届出がありません' }
          ] },
        { situation: 'capacity', who: '', state: '別の方法を検討', doneOn: '', note: '任意後見・口座の集約',
          kit: [
            { item: '本人確認書類',     state: '未確認',   where: '' },
            { item: '印鑑（実印）',     state: '登録なし', where: '印鑑の届出がありません' },
            { item: '契約印（届出印）', state: '登録なし', where: '印鑑の届出がありません' },
            { item: '委任状',           state: '未確認',   where: '' }
          ] }
      ]
    }
  ];

  /* ── 引き出し ───────────────────────────────────────
     見出しの件数も、警告の文言も、行の色も、事実から毎回引く。
     画面のどこかに数字を書き置きしない。                       */

  const prepState = p => PREP_STATES[p.state] || PREP_STATES['確認中'];
  const kitState  = k => KIT_STATES[k.state]  || KIT_STATES['未確認'];

  /* 制度名は家族が書き込むものではなく、銀行が決めているもの
     （正本 §3・§8）。表示のたびに銀行マスタから引き直すので、
     prep 自身は「その制度をどう使っているか（誰が・いつ）」だけを持つ。
     マスタに載っていない銀行は、その場しのぎの呼び名として
     situation ラベルを使う（新規追加銀行のプレースホルダー）。       */
  function prepMeans(bank, p) {
    const master = BANKS.find(b => b.name === bank.name);
    const m = master && master.means[p.situation];
    if (m === null) return null;
    if (m) return m;
    return situation(p.situation).label.replace(/とき$/, '制度');
  }

  /* 判断能力があるうちにしか申し込めない制度で、まだ片付いていない
     状態（未対応・確認中）は、期限そのものが見出しになる。事実は
     一つのまま、その制度の性質に応じて呼び方だけを変える。         */
  const OPEN_STATES = ['未対応', '確認中'];
  function isUrgentOpen(p) {
    return OPEN_STATES.includes(p.state) && situation(p.situation).urgent;
  }

  /* バッジは「今のうちの対応が必要：確認中」のように2段で読ませる。
     lead は期限、tail は進捗。tail が空なら期限だけを出す。        */
  function prepStateLabel(p) {
    if (!isUrgentOpen(p)) return { lead: '', tail: p.state };
    return { lead: '今のうちの対応が必要', tail: p.state === '未対応' ? '' : p.state };
  }

  /* 口座の見え方。支店と番号は別の事実なので、繋ぐのは描くときだけ。 */
  function accountDetail(acc) {
    const parts = [acc.branch, acc.number].filter(Boolean);
    return parts.length ? parts.join('　') : '口座番号 未入力';
  }

  /* 持ち物の数え上げ。制度ごと・銀行全体、どちらでも同じ数え方。 */
  function kitTally(kit) {
    return {
      done: kit.filter(k => kitState(k).done).length,
      open: kit.filter(k => kitState(k).open).length
    };
  }
  function tally(bank) {
    return kitTally(bank.prep.flatMap(p => p.kit));
  }

  /* カードの表紙に出る状態。備えに未対応・確認中が残っていれば
     要手続き。確認中もまだ片付いていないことに変わりはない。       */
  function bankBadge(bank) {
    if (bank.dormant) return { text: '取 扱 い な し', cls: 'off' };
    const pending = bank.prep.some(p => OPEN_STATES.includes(p.state));
    return pending ? { text: '要 手 続 き', cls: 'warn' } : { text: '確 認 中', cls: 'off' };
  }

  /* 「判断能力が低下したとき」の制度は、本人が元気なうちにしか
     申し込めない（urgent は SITUATIONS 側の性質）。まだ片付いて
     いない行（未対応・確認中）を拾う。確認中もまだ間に合っていない
     ことに変わりはないので、上部の警告はここから引く。            */
  function urgentPreps() {
    const out = [];
    banks.forEach(b => b.prep.forEach(p => {
      if (isUrgentOpen(p)) out.push({ bank: b, prep: p });
    }));
    return out;
  }

  /* 正本 §8 の再利用。用途は口座に付くが、備えの重みはそこから
     決まる。年金の受取が止まると生活に直に響く、という判断を
     画面ではなく事実の側で持つ。                                */
  const CRITICAL_ROLES = ['年金の受取', '生活費', '公共料金'];
  function criticalRoles(bank) {
    const found = new Set();
    bank.accounts.forEach(a => a.roles.forEach(r => {
      if (CRITICAL_ROLES.includes(r)) found.add(r);
    }));
    return [...found];
  }

  function findBank(id)  { return banks.find(b => b.id === id); }
  function situation(id) { return SITUATIONS.find(s => s.id === id); }

  function addBank(name) {
    const master = BANKS.find(b => b.name === name);
    const bank = {
      id: uid('bank'), name: name, updated: today(), dormant: false, note: '',
      accounts: [],
      prep: SITUATIONS.map(s => {
        const has = master ? master.means[s.id] !== null : true;
        return {
          situation: s.id, who: '', doneOn: '', note: '',
          state: has ? '確認中' : '対象外',
          kit: has ? (KIT_ITEMS_BY_SITUATION[s.id] || []).map(i => ({ item: i, state: '未確認', where: '' })) : []
        };
      })
    };
    banks.push(bank);
    return bank;
  }

  function addAccount(bank, acc) {
    const row = {
      id: uid('acc'),
      kind: acc.kind || KINDS[0],
      branch: (acc.branch || '').trim(),
      number: (acc.number || '').trim(),
      owner: (acc.owner || '').trim(),
      roles: acc.roles || []
    };
    bank.accounts.push(row);
    bank.updated = today();
    return row;
  }

  function removeAccount(bank, index) {
    bank.accounts.splice(index, 1);
    bank.updated = today();
  }

  function removeBank(id) {
    const i = banks.findIndex(b => b.id === id);
    if (i > -1) banks.splice(i, 1);
  }

  function today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }

  global.SeiZenBank = {
    KINDS, ROLES, BANKS, SITUATIONS, KIT_ITEMS_BY_SITUATION,
    PREP_STATES, KIT_STATES, KIT_STATES_BY_ITEM, KIT_STATES_ANY,
    banks,
    prepState, kitState, prepMeans, prepStateLabel, accountDetail, tally, kitTally, bankBadge,
    urgentPreps, criticalRoles,
    findBank, situation, addBank, addAccount, removeAccount, removeBank, today,
    prepStateNames: () => Object.keys(PREP_STATES),
    /* 選択肢は事実の名前をそのまま並べる。期限の言い添えは表示側の
       役目で、選ぶときは「どの状態を選ぶか」だけが問題になる。      */
    prepStateOptions: () => Object.keys(PREP_STATES).map(s => ({ value: s, label: s })),
    kitStatesFor: item => KIT_STATES_BY_ITEM[item] || KIT_STATES_ANY
  };
})(window);
