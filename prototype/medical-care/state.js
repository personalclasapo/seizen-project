/* SeiZen プロトタイプ｜医療・介護の状態
   ------------------------------------------------------------------
   この領域で扱う事実を、表示から切り離してここに持つ。画面は
   この状態を描いた結果であって、状態の置き場所ではない。

   銀行口座・保険と同じ線を引く。制度側の問い――救急で必ず伝える
   ことは何か、要介護度はどう区分されるか、介護サービスにはどんな
   型があるか――は制度が決めるもので、家族が書き込むものではない
   （正本 §3・§9）。家庭が持つのは「うちの場合はこうだ」という
   中身だけ。

   1領域に2つの成果物UIを持つ（医療・介護）。両者は骨格が別なので、
   事実も medical と care に分けて持ち、共有するのは状態の語彙
   （CHECK_STATES）だけにする。片方の形をもう片方へ持ち出さない
   （正本 §13）。

   挙動確認のあいだ手が消えないよう、localStorage に仮保存する
   （実データではなく仮データの入れ替わりなので、残しても構わない）。
   初期の仮データに戻したいときは、コンソールで
   localStorage.removeItem('SeiZenMedicalCare.data') を実行する。   */
(function (global) {
  'use strict';

  const STORE_KEY = 'SeiZenMedicalCare.data';

  /* ── 語彙 ───────────────────────────────────────────

     状態は正本 §11 に寄せる。ただし9つ全部をこの領域へ並べても
     使い分けられないので、医療・介護で実際に区別が要るものだけを
     採る。

       確認済み … 家族が辿れる／聞けることが確かめられたもの
       未確認   … まだ辿れないもの（＝いま空欄なのか未着手なのかを
                  区別するための状態。空欄と該当なしを同じにしない）
       確認中   … 本人・機関に問い合わせ中
       該当なし … この家庭では起こらない・持っていない

     done は「家族が辿れる」、open は「まだ辿れない」。銀行口座の
     KIT_STATES・保険の CHECK_STATES と同じ数え方にして、領域を
     またいでも進捗の意味がずれないようにする。                    */
  const CHECK_STATES = {
    '確認済み': { tone: 'ok', done: true,  open: false },
    '未確認':   { tone: 'no', done: false, open: true  },
    '確認中':   { tone: 'wk', done: false, open: true  },
    '該当なし': { tone: 'na', done: false, open: false }
  };
  const CHECK_ORDER = ['確認済み', '未確認', '確認中', '該当なし'];

  /* ══ 医療 ═══════════════════════════════════════════════

     この領域の中心は「救急で運ばれたとき、家族が医師へ何を言えるか」。
     おくすり手帳はそのうちの一つ（薬の正確な情報への入口）でしかない
     ので、成果物の名前にはしない。造形として手帳の形を借りるだけ。 */

  /* 救急で必ず伝えることの型。これは制度側――というより救急医療の
     現場が決めている問いで、家庭ごとに変わるのは中身だけ。だから
     型はここに持ち、家庭は中身を書く（正本 §9）。

     urgent:true は、伝え漏らすと処置そのものが危険になるもの。
     赤枠で扱うのはこの3つだけに絞る。数を増やすと赤の意味が薄まる。 */
  const TELL_TYPES = {
    allergy: { label: '薬・食物のアレルギー', urgent: true,
      about: '投与してはいけない薬があります。最初に伝えます。',
      placeholder: '例：ペニシリンで発疹が出たことがあります' },
    adverse: { label: '過去に強く出た副作用', urgent: true,
      about: '同系統の薬を避ける判断に使われます。',
      placeholder: '例：解熱鎮痛薬で強い胃の不調がありました' },
    blood:   { label: '血を固まりにくくする薬', urgent: true,
      about: '手術・処置の可否と手順が変わります。',
      placeholder: '例：血液をサラサラにする薬を服用しています' },
    device:  { label: '体内の機器・金属', urgent: false,
      about: 'MRI など、受けられない検査があります。',
      placeholder: '例：ペースメーカーが入っています' },
    other:   { label: 'その他、先に伝えること', urgent: false,
      about: '',
      placeholder: '' }
  };

  /* 診療科。医療機関のタグに使う。ここに無いものは自由入力できる。 */
  const DEPARTMENTS = [
    '内科', '循環器内科', '消化器内科', '呼吸器内科', '糖尿病内科',
    '脳神経内科', '整形外科', '外科', '泌尿器科', '眼科', '耳鼻咽喉科',
    '皮膚科', '歯科', '精神科', '心療内科', 'リハビリテーション科'
  ];

  /* お薬手帳の持ち方。紙か電子かで、家族が見に行く先が変わる。 */
  const MEDBOOK_KINDS = ['紙', '電子', '紙と電子の両方', '持っていない'];

  /* 持ち歩くもの＝手帳の透明ポケットに挿さるカード類。自宅の書類箱に
     あるもの（＝書類の表が持つ）とは役割が違うので、別に持つ。
     救急のとき、家族が探すのはこちら側。                            */
  const POCKET_ITEMS = ['診察券', '保険証', 'お薬手帳', 'マイナンバーカード'];

  /* ══ 介護 ═══════════════════════════════════════════════ */

  /* 要介護度。制度上の区分で、使えるサービスと限度額がこれで決まる。
     家庭が決めるものではないので選択肢としてここに持つ（正本 §9）。 */
  const CARE_LEVELS = [
    '認定を受けていない', '申請中', '要支援1', '要支援2',
    '要介護1', '要介護2', '要介護3', '要介護4', '要介護5'
  ];
  /* 認定を受けている＝ケアマネ・サービスの話が実際に動いている状態。 */
  function isCertified(level) {
    return String(level || '').indexOf('要') === 0;
  }

  const PLACES = ['自宅', '子の家', 'サービス付き高齢者向け住宅',
    '介護付き有料老人ホーム', '住宅型有料老人ホーム', 'グループホーム',
    '特別養護老人ホーム', '介護老人保健施設', '入院中'];

  /* 介護サービスの型。放射図の四方に置く分類で、色と記号がここから
     決まる。制度の分類そのままではなく「家族から見て何をしてもらって
     いるか」で分けている（正本 §3）。

       home     人が家に来る（訪問介護・訪問看護・訪問リハビリ）
       out      本人が出かける（デイサービス・デイケア・ショートステイ）
       equip    物が家に入る（福祉用具・住宅改修）
       support  相談・見守りの窓口（地域包括支援センター・民生委員） */
  const SERVICE_KINDS = {
    home:    { label: '訪問',     tone: 'c-home',
      about: '人が家に来て支える' },
    out:     { label: '通い',     tone: 'c-out',
      about: '本人が出かけて過ごす' },
    equip:   { label: '福祉用具', tone: 'c-equip',
      about: '物が家に入って支える' },
    support: { label: '相談',     tone: 'c-support',
      about: '困ったときの相談先' }
  };

  /* サービスの型ごとの代表的なサービス名。追加のときの候補に使う。
     ここに無いものは自由入力できる。 */
  const SERVICE_TYPES = [
    { name: '訪問介護（ホームヘルプ）', kind: 'home'    },
    { name: '訪問看護',                 kind: 'home'    },
    { name: '訪問リハビリ',             kind: 'home'    },
    { name: '訪問入浴',                 kind: 'home'    },
    { name: 'デイサービス（通所介護）', kind: 'out'     },
    { name: 'デイケア（通所リハビリ）', kind: 'out'     },
    { name: 'ショートステイ',           kind: 'out'     },
    { name: '福祉用具貸与',             kind: 'equip'   },
    { name: '福祉用具購入',             kind: 'equip'   },
    { name: '住宅改修',                 kind: 'equip'   },
    { name: '地域包括支援センター',     kind: 'support' },
    { name: '民生委員',                 kind: 'support' },
    { name: '配食サービス',             kind: 'support' },
    { name: '見守りサービス',           kind: 'support' }
  ];
  function serviceType(name) { return SERVICE_TYPES.find(s => s.name === name) || null; }
  function kindOfService(name) { const t = serviceType(name); return t ? t.kind : null; }

  /* 曜日。週の帯で使う。並びは月曜始まり。 */
  const DAYS = ['月', '火', '水', '木', '金', '土', '日'];

  let seq = 0;
  const uid = p => p + '-' + (++seq);

  /* ── 事実 ───────────────────────────────────────────
     画面に出ているのは、ここから描かれる仮データ。               */

  const data = {
    /* 医療 ------------------------------------------------------ */
    medical: {
      /* 手帳の表紙。救急で最初に読まれる識別情報なので表紙にある。 */
      person: {
        name: '山田 太郎',
        birth: '1985年3月12日',
        blood: 'A型'
      },
      /* ① 主な医療機関 */
      clinics: [
        { id: uid('cl'), name: '横浜中央クリニック', depts: ['内科'],
          reason: '高血圧の経過観察', doctor: '山田 一郎 先生',
          tel: '045-123-4567', state: '確認済み' },
        { id: uid('cl'), name: 'みなとみらい循環器クリニック', depts: ['循環器内科'],
          reason: '心房細動の治療', doctor: '鈴木 健一 先生',
          tel: '045-987-6543', state: '確認済み' }
      ],
      /* ② かかりつけ薬局 */
      pharmacies: [
        { id: uid('ph'), name: 'さくら薬局　横浜店', tel: '045-321-9876',
          note: 'いつもこちらで調剤してもらっています。', state: '確認済み' }
      ],
      /* ③ 現在治療中の主な病気・状態 */
      conditions: ['高血圧', '糖尿病', '心房細動'],
      /* ④ 継続している重要な治療・処置 */
      treatments: ['インスリン自己注射', 'ペースメーカー'],
      /* ⑤ 医療機関に必ず伝えること。type は TELL_TYPES の鍵。 */
      tells: [
        { id: uid('tl'), type: 'allergy',
          text: 'ペニシリンで発疹が出たことがあります（薬剤アレルギー）',
          state: '確認済み' },
        { id: uid('tl'), type: 'adverse',
          text: '以前、解熱鎮痛薬で強い胃の不調がありました',
          state: '確認済み' },
        { id: uid('tl'), type: 'blood',
          text: '血液をサラサラにする薬を服用しています',
          state: '確認済み' }
      ],
      /* ⑥ 薬の正確な情報への入口 */
      meds: {
        taking: 'あり',
        bookKind: '電子',
        bookWhere: 'マイナポータル',
        appWhere: 'スマートフォン（マイナポータルアプリ）',
        note: '新しい薬が追加されたら家族にも共有してください。',
        state: '確認済み'
      },
      /* ⑦-a 持ち歩くもの＝透明ポケットに挿さっているカード類。 */
      pocket: [
        { id: uid('pk'), item: '診察券', where: '横浜中央クリニック ほか3枚', state: '確認済み' },
        { id: uid('pk'), item: '保険証', where: 'マイナ保険証（カード）', state: '確認済み' },
        { id: uid('pk'), item: 'お薬手帳', where: 'マイナポータル（アプリ）', state: '確認済み' },
        { id: uid('pk'), item: 'マイナンバーカード', where: '本人の財布', state: '未確認' }
      ],
      /* ⑦-b 自宅にある書類。原本の場所は「書類・資料」がまとめる。 */
      papers: [
        { id: uid('pp'), item: '医療関係書類', where: '自宅の書類箱（医療）', state: '確認済み' },
        { id: uid('pp'), item: 'その他重要資料', where: '健康診断の結果は「書類・資料」に保管', state: '確認済み' },
        { id: uid('pp'), item: '保管場所', where: '自宅 書類の引き出し（医療）', state: '確認済み' }
      ],
      /* 本人の声。他に置き場がないので手帳に挟んだメモとして持つ。 */
      voice: '体調がいつもと違うときは、早めに相談を。',
      /* 通院のメモ。 */
      memo: '次回受診：11/12\n血液検査の結果を提出する\n体調の変化があれば家族にも共有'
    },

    /* 介護 ------------------------------------------------------ */
    care: {
      /* ① 現在の介護状態 */
      level: '要介護2',
      place: '自宅',
      placeNote: '築年数のある戸建て。階段の昇り降りは見守りが必要です。',
      /* ② 担当ケアマネジャー。介護の中心・入口。 */
      manager: {
        name: '佐藤 陽子',
        office: 'みなとケアプランセンター',
        tel: '045-111-2222',
        note: 'いつも親身に相談にのってくださっています。',
        state: '確認済み'
      },
      /* ③ 利用中の介護サービス。放射図と週の帯の両方がここから描かれる。
         days は DAYS の添字（0=月）。常時（福祉用具など）は空配列。 */
      services: [
        { id: uid('sv'), kind: 'home', name: '訪問介護',
          provider: 'さくらヘルパーステーション', tel: '045-333-4444',
          freq: '週2回（火・金）', days: [1, 4],
          detail: '掃除・買い物支援・入浴介助', state: '確認済み' },
        { id: uid('sv'), kind: 'out', name: 'デイサービス',
          provider: 'みなとデイサービスセンター', tel: '045-555-6666',
          freq: '週3回（月・水・金）', days: [0, 2, 4],
          detail: '入浴・機能訓練・レクリエーション', state: '確認済み' },
        { id: uid('sv'), kind: 'equip', name: '福祉用具',
          provider: 'はまっ子福祉用具', tel: '045-777-8888',
          freq: '自宅で使用', days: [],
          detail: '介護ベッド・手すり', state: '確認済み' },
        { id: uid('sv'), kind: 'support', name: 'その他の支援',
          provider: '横浜市 地域包括支援センター', tel: '045-999-0000',
          freq: '随時', days: [],
          detail: '介護全般の相談先', state: '確認済み' }
      ],
      /* ④ 家族が知っておきたいこと */
      notes: [
        '一人での入浴は難しく、必ず見守りが必要です。',
        '足元が不安定で転びやすいため、外出時は付き添いをお願いします。',
        '本人だけでの服薬管理は難しいです。',
        '体調が急に悪化することがあり、様子がおかしいときは早めにケアマネに連絡してください。'
      ],
      /* ⑤ 介護関係書類 */
      papers: [
        { id: uid('cp'), item: '介護保険関係書類', where: '自宅の書類箱（リビングの棚）', state: '確認済み' },
        { id: uid('cp'), item: 'ケアプラン', where: '自宅の書類箱（リビングの棚）', state: '確認済み' },
        { id: uid('cp'), item: 'サービス関係資料', where: '自宅の書類箱（リビングの棚）', state: '確認済み' },
        { id: uid('cp'), item: '保管場所', where: '自宅 書類の引き出し（介護）', state: '未確認' }
      ]
    }
  };

  /* 保存済みがあれば仮データを差し替える。id は "xx-<n>" の形なので、
     続きの採番が既存分とぶつからないよう seq を合わせ直す。 */
  function hydrate() {
    let saved = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch (e) { return; }
    if (!saved || typeof saved !== 'object') return;
    if (saved.medical) data.medical = saved.medical;
    if (saved.care)    data.care    = saved.care;
    /* 保存分の中で一番大きい採番まで seq を進める。 */
    JSON.stringify(saved).replace(/"[a-z]{2}-(\d+)"/g, (m, n) => {
      const v = parseInt(n, 10);
      if (!isNaN(v) && v > seq) seq = v;
      return m;
    });
  }
  hydrate();

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* 無視 */ }
  }

  /* ── 引き出し ───────────────────────────────────────
     見出しの件数も、放射図の並びも、週の帯も、事実から毎回引く。   */

  const checkState = row => CHECK_STATES[row && row.state] || CHECK_STATES['未確認'];
  const tellType   = t => TELL_TYPES[t] || TELL_TYPES.other;
  const serviceKind = k => SERVICE_KINDS[k] || SERVICE_KINDS.support;

  /* 状態を次へ回す（確認済み→未確認→確認中→該当なし→…）。 */
  function cycleState(row) {
    if (!row) return;
    const cur = CHECK_ORDER.indexOf(row.state);
    row.state = CHECK_ORDER[(cur + 1) % CHECK_ORDER.length];
  }

  /* 状態を持つ行を、医療・介護それぞれから集める。数え上げと警告は
     すべてこの一覧から引くので、行の増減に自動で追随する。         */
  function medicalRows() {
    const m = data.medical;
    return []
      .concat(m.clinics || [], m.pharmacies || [], m.tells || [],
              m.pocket || [], m.papers || [], [m.meds]);
  }
  function careRows() {
    const c = data.care;
    return [].concat([c.manager], c.services || [], c.papers || []);
  }

  function tallyOf(rows) {
    const list = rows.filter(Boolean);
    return {
      all:  list.length,
      done: list.filter(r => checkState(r).done).length,
      open: list.filter(r => checkState(r).open).length
    };
  }
  const medicalTally = () => tallyOf(medicalRows());
  const careTally    = () => tallyOf(careRows());

  /* 左ナビの件数バッジ。両ゾーンの「まだ辿れない」を合わせて出す。 */
  function openCount() {
    return medicalTally().open + careTally().open;
  }

  /* 救急で伝えることのうち、伝え漏らすと処置が危険になるもの。
     赤枠に出す。中身が空・未確認なら、家族はいざというとき言えない。 */
  function urgentTells() {
    return (data.medical.tells || []).filter(t => tellType(t.type).urgent);
  }
  /* 赤枠の警告。中身が空か、まだ確かめられていないものを拾う。 */
  function tellsUnresolved() {
    return urgentTells().filter(t => !String(t.text || '').trim() || checkState(t).open);
  }

  /* 週の帯。曜日ごとに、その日に来る／出かけるサービスを返す。
     常時のもの（days が空）は帯に出さない――帯は「いつ誰が来るか」
     を見る場所で、常時のものは放射図の側が持っている。            */
  function weekGrid() {
    return DAYS.map((label, i) => ({
      label: label,
      index: i,
      services: (data.care.services || []).filter(s =>
        Array.isArray(s.days) && s.days.indexOf(i) > -1)
    }));
  }
  /* 曜日を持つサービスが一つでもあるか。無ければ帯そのものを出さない。 */
  function hasSchedule() {
    return (data.care.services || []).some(s => Array.isArray(s.days) && s.days.length);
  }

  function toggleDay(sv, i) {
    if (!sv) return;
    const days = sv.days = Array.isArray(sv.days) ? sv.days : [];
    const at = days.indexOf(i);
    if (at > -1) days.splice(at, 1); else days.push(i);
    days.sort((a, b) => a - b);
  }

  /* ── 探す ───────────────────────────────────────── */
  function findIn(list, id) { return (list || []).find(x => x.id === id) || null; }
  function findAny(id) {
    const m = data.medical, c = data.care;
    return findIn(m.clinics, id) || findIn(m.pharmacies, id) || findIn(m.tells, id) ||
           findIn(m.pocket, id) || findIn(m.papers, id) ||
           findIn(c.services, id) || findIn(c.papers, id) ||
           (c.manager && c.manager.id === id ? c.manager : null);
  }

  /* ── 編集 ───────────────────────────────────────────
     画面から書き換える。値の場所は 'medical.meds.taking' や
     'care.services.0.freq' のようなドット区切りで data から辿る。   */
  function getByPath(path) {
    return String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), data);
  }
  function setByPath(path, val) {
    const parts = String(path).split('.');
    const last = parts.pop();
    const host = parts.reduce((o, k) => (o == null ? o : o[k]), data);
    if (host) host[last] = val;
  }
  /* 実際に変わったときだけ true。呼び出し側は変更の有無をこれで見る。 */
  function applyValue(path, val) {
    if (!path) return false;
    const next = String(val).trim();
    if (String(getByPath(path) ?? '') === next) return false;
    setByPath(path, next);
    return true;
  }

  /* 配列で持っているタグ（病名・治療・診療科）。改行／読点区切りの
     一行テキストとして編集し、配列へ戻す。 */
  function tagsToText(list) { return (list || []).join('、'); }
  function textToTags(text) {
    return String(text || '').split(/[、,\n]/).map(s => s.trim()).filter(Boolean);
  }
  function applyTags(path, text) {
    const next = textToTags(text);
    const cur = getByPath(path) || [];
    if (cur.join(' ') === next.join(' ')) return false;
    setByPath(path, next);
    return true;
  }

  /* 箇条書き（家族が知っておきたいこと）。1行1件。 */
  function linesToText(list) { return (list || []).join('\n'); }
  function applyLines(path, text) {
    const next = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const cur = getByPath(path) || [];
    if (cur.join(' ') === next.join(' ')) return false;
    setByPath(path, next);
    return true;
  }

  /* ── 足す・消す ───────────────────────────────────── */

  function addClinic() {
    const row = { id: uid('cl'), name: '', depts: [], reason: '', doctor: '',
      tel: '', state: '未確認' };
    data.medical.clinics.push(row);
    return row;
  }
  function addPharmacy() {
    const row = { id: uid('ph'), name: '', tel: '', note: '', state: '未確認' };
    data.medical.pharmacies.push(row);
    return row;
  }
  function addTell(type) {
    const row = { id: uid('tl'), type: type || 'other', text: '', state: '未確認' };
    data.medical.tells.push(row);
    return row;
  }
  /* サービスを1件足す。型（kind）はサービス名から決まる。名前が候補に
     無ければ呼び出し側が kind を渡す（正本 §8・§9）。 */
  function addService(name, kind) {
    const k = kindOfService(name) || kind || 'home';
    const row = { id: uid('sv'), kind: k, name: name || '',
      provider: '', tel: '', freq: '', days: [], detail: '', state: '未確認' };
    data.care.services.push(row);
    return row;
  }
  /* サービス名を変えると型も連動する（手で直した型は上書きしない）。 */
  function setServiceName(sv, name) {
    if (!sv || sv.name === name) return false;
    sv.name = name;
    const k = kindOfService(name);
    if (k && k !== sv.kind) sv.kind = k;
    return true;
  }
  function setServiceKind(sv, kind) {
    if (!sv || !SERVICE_KINDS[kind] || sv.kind === kind) return false;
    sv.kind = kind;
    return true;
  }

  function removeFrom(list, id) {
    const i = (list || []).findIndex(x => x.id === id);
    if (i > -1) list.splice(i, 1);
  }
  /* どの一覧に居るか分からない行を消す。 */
  function removeAny(id) {
    const m = data.medical, c = data.care;
    [m.clinics, m.pharmacies, m.tells, m.pocket, m.papers,
     c.services, c.papers].forEach(list => removeFrom(list, id));
  }

  global.SeiZenMedicalCare = {
    /* 語彙 */
    CHECK_STATES, CHECK_ORDER, TELL_TYPES, DEPARTMENTS, MEDBOOK_KINDS,
    POCKET_ITEMS, CARE_LEVELS, PLACES, SERVICE_KINDS, SERVICE_TYPES, DAYS,
    /* 事実 */
    data, save,
    /* 引き出し */
    checkState, cycleState, tellType, serviceKind, isCertified,
    serviceType, kindOfService,
    medicalTally, careTally, openCount, urgentTells, tellsUnresolved,
    weekGrid, hasSchedule, toggleDay,
    findIn, findAny,
    /* 編集 */
    getByPath, setByPath, applyValue,
    tagsToText, textToTags, applyTags, linesToText, applyLines,
    /* 足す・消す */
    addClinic, addPharmacy, addTell, addService,
    setServiceName, setServiceKind, removeFrom, removeAny
  };
})(window);
