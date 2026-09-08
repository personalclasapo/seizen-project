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

     左右2エリアで組む。
       左… 本人そのもの（個人情報・いまの医療状態・普段の状態・メモ）
       右… 場面（何かあったとき・いつもの通院・薬を確認するところ・
            必要なものと所在）

     「現在の医療状態」が実データを持ち、「何かあったときに伝える
     こと」はそこから参照・抽出するだけの派生ビュー（二重入力をしない）。
     おくすり手帳はそのうちの一つ（薬の正確な情報への入口）でしかない
     ので、成果物の名前にはしない。造形として手帳の形を借りるだけ。 */

  /* 現在の医療状態｜5項目。入力単位は項目ごとに違う（病名／継続行為／
     存在物／原因＋反応／薬・治療＋起きたこと）ので、同じ「候補チップ」
     フォームにしない。表示側（相関図）は入力から編集して組み立てる。

     各項目は presence（'あり' / 'なし'）で入力の分岐だけを持つ。
     「あり」で中身のフォームを開き、「なし」で閉じる。まだどちらも
     押していない状態は '未確認'（＝空欄。§11：空欄と「なし」を
     同じにしない――「なし」は"確認したうえで無い"）。
     状態バッジのような見せ方はしない（入力上の交通整理だけ）。 */
  const PRESENCE = ['あり', 'なし'];

  const CURRENT_KINDS = {
    condition: { label: '治療中の病気・状態',   placeholder: '例：高血圧',
      unit: '病名' },
    treatment: { label: '継続している治療・処置', placeholder: '例：インスリン自己注射',
      unit: '治療・処置' },
    device:    { label: '医療機器・体内機器',     placeholder: '例：ペースメーカー',
      unit: '機器・装置' },
    allergy:   { label: 'アレルギー',            placeholder: '例：ペニシリン',
      unit: '原因＋反応' },
    adverse:   { label: '強い副作用歴',          placeholder: '例：解熱鎮痛薬',
      unit: '薬・治療＋起きたこと' }
  };
  /* 相関図・伝えることで拾う3項目（アレルギー・副作用歴は別扱い）。 */
  const CURRENT_ORDER = ['condition', 'treatment', 'device'];

  /* 治療中の病気・状態｜候補。いま治療・経過観察しているものに限る
     （既往歴は混ぜない）。系統ごとに畳めるピッカーにするので、
     フラットな配列ではなく { 系統: [...] } で持つ。ここに無いものは
     自由入力できる（候補は網羅ではなく、書き落としを防ぐ呼び水）。 */
  const CONDITION_CHOICE_GROUPS = [
    ['循環器・血管', ['高血圧', '脂質異常症', '心房細動・不整脈', '心不全',
      '狭心症・心筋梗塞']],
    ['代謝・内分泌', ['糖尿病', '痛風・高尿酸血症', '甲状腺の病気']],
    ['脳・神経',     ['脳梗塞・脳出血後', '認知症', 'パーキンソン病', 'てんかん']],
    ['呼吸器',       ['喘息', 'COPD・慢性呼吸器疾患']],
    ['消化器',       ['逆流性食道炎・胃潰瘍']],
    ['腎・泌尿器',   ['慢性腎臓病', '前立腺肥大']],
    ['目・耳',       ['緑内障・白内障', '難聴']],
    ['運動器',       ['骨粗しょう症', '関節リウマチ']],
    ['こころ・睡眠', ['うつ病・精神疾患', '不眠症']],
    ['その他',       ['がん']]
  ];
  /* 平坦な一覧（アイコン引き・存在判定に使う）。 */
  const CONDITION_CHOICES = CONDITION_CHOICE_GROUPS.reduce(
    (all, g) => all.concat(g[1]), []);
  /* 病名カードの下に添える「いまその病気とどう付き合っているか」。
     固定2択（治療中／経過観察中）では「病気は治ったが再発予防で
     服薬中」「落ち着いていて定期受診だけ」のような実態が書けないので、
     自由記述にして候補だけ呼び水に出す。動作が見える言い方にそろえる。
       治療中          … その病気が今もあり、抑える／治す通院・服薬を続けている
       経過観察中      … 治療はせず、悪化しないか定期的に診てもらうだけ
       術後・再発予防で服薬中 … 病気は取り切ったが、戻らないよう薬・処置を続けている
       定期受診のみ    … 状態は落ち着き、処方の継続・確認で通うだけ
       自宅で測定・管理 … 医療機関でなく家で測って管理している（血圧手帳・血糖測定など） */
  const CONDITION_NOTE_CHOICES = ['治療中', '経過観察中', '術後・再発予防で服薬中',
    '定期受診のみ', '自宅で測定・管理'];

  /* 継続している治療・処置｜候補。途中で止まると困る／家族が知らないと
     困る継続処置を中心に置く。毎日の内服（降圧薬など）はここに入れない
     ――薬剤情報と二重管理になるため（右面「薬を確認するところ」が担当）。
     こちらも系統ごとに畳む。 */
  const TREATMENT_CHOICE_GROUPS = [
    ['注射・輸液', ['インスリン自己注射', 'その他の自己注射',
      '在宅点滴・中心静脈栄養', '定期的な注射・点滴', '定期的な輸血']],
    ['呼吸',       ['在宅酸素療法', 'CPAP・呼吸補助', '吸引']],
    ['栄養・排泄', ['経管栄養', '胃ろう', '自己導尿', '留置カテーテル',
      'ストーマ管理']],
    ['血液浄化・がん', ['人工透析', '定期的な抗がん剤治療']],
    ['その他',     ['リハビリテーション']]
  ];
  const TREATMENT_CHOICES = TREATMENT_CHOICE_GROUPS.reduce(
    (all, g) => all.concat(g[1]), []);

  /* 医療機器・体内機器｜候補を2群に分ける（表示は一緒でよい）。
       body  … 体内にあるもの（埋込み・留置）
       daily … 日常的に使っているもの                                */
  const DEVICE_CHOICES = {
    body: ['心臓ペースメーカー', 'ICD（植込み型除細動器）', 'CRT・心臓再同期療法機器',
      '人工内耳', '人工関節', '人工心臓弁', '血管ステント',
      '脳動脈クリップ・コイル', 'シャント', 'CVポート', '神経刺激装置',
      'その他の体内金属・医療機器'],
    daily: ['インスリンポンプ', '持続血糖測定器（CGM）', '酸素濃縮器・酸素ボンベ',
      'CPAP', '補聴器']
  };
  const DEVICE_GROUPS = { body: '体内にあるもの', daily: '日常的に使っているもの' };
  const DEVICE_CHOICE_GROUPS = [
    [DEVICE_GROUPS.body,  DEVICE_CHOICES.body],
    [DEVICE_GROUPS.daily, DEVICE_CHOICES.daily]
  ];

  /* 体の部位｜継続処置・体内機器が「体のどこに効いているか」。相関図の
     右側を、名前を並べたリストではなく人体シルエットに変える（正本 §4-2）。
     救急でまず要るのは「体の中に金属があるか」「どこに何が入っているか」
     なので、部位ごとにピンを刺す。

       key   … 内部の鍵
       label … 図の脇に出す部位名
       at    … 人体シルエット（assets/body-front.svg、viewBox
               0 0 151 321、中心軸 x=75.5）の中の点 [x, y]
       side  … ラベルを図のどちら側へ出すか（'l' | 'r'）

     シルエットの目印（実測）：
       頭 y6-46（最大幅 y24）／首 y34-46／肩 y50-58／
       胴 y58-150／手 y154-178／脚 y182-／足 y310-318

     部位が確認できていない項目は 'unknown'。§11：空欄と同じにせず、
     「部位が確認できていない」項目として体の脇にまとめて置く。 */
  const BODY_REGIONS = [
    { key: 'head',    label: '頭部',     at: [ 75,  22], side: 'l' },
    { key: 'ear',     label: '耳',       at: [ 87,  24], side: 'r' },
    { key: 'neck',    label: '首・のど', at: [ 75,  44], side: 'l' },
    { key: 'chest',   label: '胸部・心臓', at: [ 65,  76], side: 'l' },
    { key: 'lung',    label: '肺・呼吸', at: [ 88,  80], side: 'r' },
    { key: 'abdomen', label: '腹部',     at: [ 68, 112], side: 'l' },
    { key: 'stoma',   label: 'おなかの造設部', at: [ 88, 120], side: 'r' },
    { key: 'urinary', label: '膀胱・尿路', at: [ 75, 145], side: 'l' },
    { key: 'arm',     label: '腕',       at: [ 26, 118], side: 'l' },
    { key: 'vascular',label: '血管（透析）', at: [124, 130], side: 'r' },
    { key: 'leg',     label: '脚・関節', at: [ 60, 215], side: 'l' },
    { key: 'whole',   label: '全身',     at: [ 92, 170], side: 'r' },
    { key: 'unknown', label: '部位未設定', at: [118, 250], side: 'r' }
  ];
  const BODY_REGION_KEYS = BODY_REGIONS.map(r => r.key).filter(k => k !== 'unknown');
  const bodyRegion = key => BODY_REGIONS.find(r => r.key === key) ||
    BODY_REGIONS[BODY_REGIONS.length - 1];

  /* 候補の値から部位を引く。候補外・自由入力は編集時に部位を選ばせる
     （行の region が空なら、この表で引けたぶんだけ自動で当てる）。 */
  const REGION_OF_CHOICE = {
    /* 継続している治療・処置 */
    'インスリン自己注射': 'abdomen', 'その他の自己注射': 'abdomen',
    '在宅点滴・中心静脈栄養': 'chest', '定期的な注射・点滴': 'arm',
    '定期的な輸血': 'arm',
    '在宅酸素療法': 'lung', '在宅酸素': 'lung', 'CPAP・呼吸補助': 'lung', '吸引': 'neck',
    '経管栄養': 'abdomen', '胃ろう': 'stoma', '自己導尿': 'urinary',
    '留置カテーテル': 'urinary', 'ストーマ管理': 'stoma',
    '人工透析': 'vascular', '定期的な抗がん剤治療': 'chest',
    'リハビリテーション': 'whole',
    /* 医療機器・体内機器 */
    '心臓ペースメーカー': 'chest', 'ペースメーカー': 'chest', 'ICD（植込み型除細動器）': 'chest',
    'CRT・心臓再同期療法機器': 'chest', '人工内耳': 'ear', '人工関節': 'leg',
    '人工心臓弁': 'chest', '血管ステント': 'chest',
    '脳動脈クリップ・コイル': 'head', 'シャント': 'vascular', 'CVポート': 'chest',
    '神経刺激装置': 'whole', 'その他の体内金属・医療機器': 'unknown',
    'インスリンポンプ': 'abdomen', '持続血糖測定器（CGM）': 'arm',
    '酸素濃縮器・酸素ボンベ': 'lung', 'CPAP': 'lung', '補聴器': 'ear'
  };
  /* 行の部位。手で選んだ region があればそれ、無ければ候補表、それも
     無ければ 'unknown'。 */
  function regionOfRow(row) {
    if (!row) return 'unknown';
    if (row.region && BODY_REGIONS.some(r => r.key === row.region)) return row.region;
    return REGION_OF_CHOICE[row.text] || 'unknown';
  }

  /* アレルギー｜「起きた反応」をまず選び、原因の物質名は思い出せる
     範囲で書く（任意）。「原因の種類」（薬／食べ物／…）の分類は持た
     ない――物質名から分かるし、閲覧側でも使っていなかった。 */
  const ALLERGY_REACTIONS = ['発疹・じんましん', 'かゆみ', '腫れ', '呼吸苦',
    '血圧低下・意識障害', 'アナフィラキシー', 'その他', '詳細不明'];

  /* 強い副作用歴｜「起きたこと」をまず選び、思い当たる薬・治療は任意。
     固定の薬剤候補は持たない。「今後避けるよう言われたか」の欄は
     廃止した（この節はすべて"避けるもの"なので行ごとに持つ意味が
     薄い）。 */
  const ADVERSE_EVENTS = ['強い吐き気・嘔吐', '強い胃腸症状', 'めまい・ふらつき',
    '意識障害', '強い眠気', '出血', '肝機能障害', '腎機能障害',
    '血球減少', 'その他', '詳細不明'];

  /* 血液型。ABO式の4型＋不明。自由記述にすると「A」「A型」「ａ」など
     表記が揺れるので、救急で誤読が無いよう選択式にする。          */
  const BLOOD_TYPES = ['A型', 'B型', 'O型', 'AB型', '不明'];

  /* 診療科。医療機関のタグに使う。ここに無いものは自由入力できる。 */
  const DEPARTMENTS = [
    '内科', '循環器内科', '消化器内科', '呼吸器内科', '糖尿病内科',
    '脳神経内科', '整形外科', '外科', '泌尿器科', '眼科', '耳鼻咽喉科',
    '皮膚科', '歯科', '精神科', '心療内科', 'リハビリテーション科'
  ];

  /* 薬を確認するところ｜入口の型。
       fixed  … 標準の入口。行が1つ常設で、消せない（§11：確認して
                いない＝未確認であって、欄そのものは消えない）。
       multi  … 複数あり得る入口。標準1行は常設、2件目以降は足す・
                消すができる。
     かかりつけ薬局はここで完結させる（連絡先も自前で持つ）。以前は
     「主な医療機関」と並ぶ pharmacies 側の実体を指していたが、家族が
     「薬をどこで確認するか」を1か所で辿れるほうがよいので、薬の入口の
     ひとつとしてここへ寄せた。 */
  const MEDSRC_KINDS = {
    paper:    { label: '紙のお薬手帳' },
    digital:  { label: '電子お薬手帳' },
    myna:     { label: 'マイナポータル' },
    pharmacy: { label: 'かかりつけ薬局', multi: true }
  };
  const MEDSRC_ORDER = ['paper', 'digital', 'myna', 'pharmacy'];
  const MEDSRC_FIXED = MEDSRC_ORDER;   /* 標準行が常設される入口 */

  /* 医療で必要になるものと所在｜カテゴリの型。カテゴリは制度側で
     決まっている括り（診察券・お薬手帳・受給者証…）なので固定で持つ
     ――消せるのはその下の実物だけ。実物は { name, where } で、1枚
     ずつ「どこにあるか」を書く（正本 §4-2：見出し＝棚、実物＝そこに
     入っている物）。 */
  const SUPPLY_CATS = [
    { key: 'license',   label: '診察券',              hint: 'クリニックごと' },
    { key: 'mynumber',  label: 'マイナンバーカード等', hint: '本人確認' },
    { key: 'medbook',   label: 'お薬手帳',            hint: '紙・アプリ' },
    { key: 'handbooks', label: '各種医療手帳',         hint: '身体障害者手帳など' },
    { key: 'devcard',   label: '医療機器のカード・手帳', hint: 'ペースメーカー手帳など' },
    { key: 'benefit',   label: '受給者証等',           hint: '医療費助成' }
  ];
  const SUPPLY_CAT_KEYS = SUPPLY_CATS.map(c => c.key);
  const supplyCat = key => SUPPLY_CATS.find(c => c.key === key) || SUPPLY_CATS[0];

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
      /* 個人情報。救急で最初に読まれる識別情報。photo は data URI
         （未登録なら空。画面側は空のとき人物シルエットを描く）。 */
      person: {
        name: '山田 太郎',
        birth: '1985-03-12',
        blood: 'A型',
        photo: ''
      },

      /* 現在の医療状態｜5項目。項目ごとに presence（なし／あり／未確認
         ／分からない）を持ち、「あり」のときだけ items に中身がある。
         「何かあったときに伝えること」は presence:'あり' の全件を規則で
         抽出する（家族が行ごとに選ばない――入力と表示は分ける）。      */

      /* 治療中の病気・状態｜行は { text, note }。note はカードの下に
         添える一言（自由記述）。 */
      conditions: {
        presence: 'あり',
        items: [
          { id: uid('cd'), text: '心房細動・不整脈',   note: '経過観察中' },
          { id: uid('cd'), text: '脳梗塞・脳出血後',   note: '再発予防の治療中' },
          { id: uid('cd'), text: 'COPD・慢性呼吸器疾患', note: '治療中' },
          { id: uid('cd'), text: '慢性腎臓病',         note: '定期受診' }
        ]
      },
      /* 継続している治療・処置｜毎日の内服はここに置かない。行は
         { text, region, purpose, note }。purpose＝何のためか、
         note＝頻度・条件（1日2回、夜間のみ、など）。 */
      treatments: {
        presence: 'あり',
        items: [
          { id: uid('tr'), text: 'インスリン自己注射', region: '',
            purpose: '血糖値をコントロールするため', note: '1日2回（朝・夜）' },
          { id: uid('tr'), text: '在宅酸素', region: 'lung',
            purpose: '呼吸を助けるため', note: '夜間に使用' }
        ]
      },
      /* 医療機器・体内機器｜行は { text, group:'body'|'daily', region,
         purpose, note }。region は空なら候補表から部位を当てる。 */
      devices: {
        presence: 'あり',
        items: [
          { id: uid('dv'), text: 'ペースメーカー', group: 'body', region: '',
            purpose: '心臓のリズムを整えるため', note: '' },
          { id: uid('dv'), text: '人工関節', group: 'body', region: 'leg',
            purpose: '歩行機能を補助するため', note: '右膝' }
        ]
      },
      /* アレルギー｜行は { cause, reactions[] }。反応をまず選び、原因
         （物質名）は任意。 */
      allergies: {
        presence: 'あり',
        items: [
          { id: uid('al'), cause: 'ペニシリン', reactions: ['発疹・じんましん'] }
        ]
      },
      /* 強い副作用歴｜行は { cause, events[] }。起きたことをまず選び、
         思い当たる薬・治療は任意。 */
      adverse: {
        presence: 'あり',
        items: [
          { id: uid('ad'), cause: '解熱鎮痛薬', events: ['強い胃腸症状'] }
        ]
      },

      /* 普段の状態。介護領域とは独立に、医療の判断材料として持つ。 */
      daily: {
        talk: '会話は問題なくできる。もの忘れは少しある。',
        cognition: '日常の判断は自分でできる。',
        mobility: '杖を使えば一人で歩ける。長距離は付き添いが必要。',
        meal: '普通食。むせることがある。'
      },

      /* メモ。構造化するほどではない医療情報の自由記述欄。 */
      memo: '次回受診：11/12\n血液検査の結果を提出する\n体調の変化があれば家族にも共有',

      /* いつもの通院｜主な医療機関。行は { name, depts[], reason,
         doctor, tel, web, hours }。web は公式サイト1本
         （<a target=_blank rel=noopener> で開ける）。hours は診療時間。
         状態（§11）は持たない――「かかっている先の連絡先」で、書いた
         時点で家族が辿れる。 */
      clinics: [
        { id: uid('cl'), name: '横浜中央クリニック', depts: ['内科'],
          reason: '高血圧の経過観察', doctor: '山田 一郎 先生',
          tel: '045-123-4567', web: 'https://yokohama-chuo.example.jp',
          hours: '平日 9:00–12:30 / 14:00–17:30' },
        { id: uid('cl'), name: 'みなとみらい循環器クリニック', depts: ['循環器内科'],
          reason: '心房細動の治療', doctor: '鈴木 健一 先生',
          tel: '045-987-6543', web: '',
          hours: '平日 9:00–12:00 / 15:00–18:00　土 9:00–13:00' }
      ],
      /* 薬を確認するところ｜入口を並列で持つ。標準の4つ（紙・電子・
         マイナポータル・かかりつけ薬局）は行が常設で消えない。
         かかりつけ薬局は複数あり得るので、2件目以降を足せる。
         行は { kind, where, note }。標準3つ（paper・digital・myna）
         は state（§11 の状態）を持つ。かかりつけ薬局だけは
         連絡先（name・tel・web）を自前で持ち、state は持たない――
         書いた時点で家族が辿れる「連絡先」で、辿れるかを問う対象では
         ない（通院の診療案内カードと揃える）。note はかかりつけ薬局
         では家族の書き込みメモ（困ったときの連絡・往診の有無・担当
         薬剤師など。「調剤・飲み合わせ確認」は薬局の定義なので
         書かない）。 */
      medSources: [
        { id: uid('ms'), kind: 'paper', where: '', note: '', state: '該当なし' },
        { id: uid('ms'), kind: 'digital', where: 'アプリ名（おくすり手帳Link）',
          note: '', state: '確認済み' },
        { id: uid('ms'), kind: 'myna', where: 'ログインは本人のスマホから',
          note: '新しい薬が追加されたら家族にも共有してください。', state: '確認済み' },
        { id: uid('ms'), kind: 'pharmacy', name: 'さくら薬局　横浜店', tel: '045-321-9876',
          web: 'https://sakura-ph.example.jp', where: '', note: '' }
      ],

      /* 医療で必要になるものと所在｜カテゴリ（固定）ごとに、実物を
         ぶら下げる。カテゴリは消せない――消せるのは実物の行だけ。
         実物は { id, name, where, state }。name＝どのカードか（診察券
         なら医療機関名）、where＝どこにあるか。 */
      supplies: {
        license: [
          { id: uid('sp'), name: '横浜中央クリニック', where: '本人の財布', state: '確認済み' },
          { id: uid('sp'), name: 'みなとみらい循環器クリニック', where: '本人の財布', state: '確認済み' }
        ],
        mynumber: [
          { id: uid('sp'), name: 'マイナンバーカード', where: '本人の財布', state: '未確認' }
        ],
        medbook: [
          { id: uid('sp'), name: 'お薬手帳アプリ', where: 'スマートフォン', state: '確認済み' }
        ],
        handbooks: [],
        devcard: [
          { id: uid('sp'), name: 'ペースメーカー手帳', where: '自宅の書類箱（医療）', state: '確認済み' }
        ],
        benefit: []
      }
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
    /* 旧フォーマット（現在の医療状態が配列）の保存分は捨てて仮データを
       使う。プロトタイプの仮保存なので、作り替えのたびに移行コードを
       積まない――形が変わったら初期の仮データに戻す。 */
    const stale = saved.medical && (
      Array.isArray(saved.medical.conditions) ||
      /* 旧・薬／書類の形（pharmacies 配列、pocket/papers 配列）。作り
         替えたので、保存分は捨てて仮データに戻す。 */
      Array.isArray(saved.medical.pharmacies) ||
      Array.isArray(saved.medical.pocket) ||
      Array.isArray(saved.medical.papers) ||
      (saved.medical.supplies && Array.isArray(saved.medical.supplies)));
    if (stale) { try { localStorage.removeItem(STORE_KEY); } catch (e) {} return; }
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

  /* 生年月日（ISO "YYYY-MM-DD"）から年齢を数える。年齢は生年月日から
     決まる値なので、別に入力させると二重管理になる（正本の線）。
     今日の日付との誕生日前後で1つずれるところまで数える。          */
  function ageFromBirth(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    const birth = new Date(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const beforeBirthday =
      today.getMonth() < birth.getMonth() ||
      (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
    if (beforeBirthday) age--;
    return age >= 0 ? age : null;
  }
  /* 生年月日の表示｜和暦の日付らしい書き方に整える。 */
  function formatBirth(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    return m[1] + '年' + (+m[2]) + '月' + (+m[3]) + '日';
  }

  const checkState = row => CHECK_STATES[row && row.state] || CHECK_STATES['未確認'];
  const currentKind = k => CURRENT_KINDS[k] || CURRENT_KINDS.condition;
  const medSrcKind  = k => MEDSRC_KINDS[k] || MEDSRC_KINDS.other;
  const serviceKind = k => SERVICE_KINDS[k] || SERVICE_KINDS.support;

  /* ── 現在の医療状態｜5項目の引き出し ─────────────────
     どの項目も { presence, items } の形。presence が 'あり' のときだけ
     items を読む。行の見せ方（1行の文字列）は項目ごとに違う。       */
  function currentGroup(kind) {
    const g = data.medical[kind + (kind === 'allergy' ? 'ies' :
      kind === 'adverse' ? '' : 's')];
    return g && typeof g === 'object' && !Array.isArray(g)
      ? g : { presence: '未確認', items: [] };
  }
  /* 項目名から state のキー（conditions / treatments / devices /
     allergies / adverse）を引く。 */
  const CURRENT_STORE = {
    condition: 'conditions', treatment: 'treatments', device: 'devices',
    allergy: 'allergies', adverse: 'adverse'
  };
  function grpOf(kind) {
    const g = data.medical[CURRENT_STORE[kind]];
    if (!g || Array.isArray(g) || typeof g !== 'object') {
      data.medical[CURRENT_STORE[kind]] = { presence: '未確認', items: [] };
    }
    return data.medical[CURRENT_STORE[kind]];
  }
  function setPresence(kind, val) {
    const g = grpOf(kind);
    if (PRESENCE.indexOf(val) < 0 || g.presence === val) return false;
    g.presence = val;
    /* 「あり」で中身が空なら1行用意する（すぐ書けるように）。 */
    if (val === 'あり' && !(g.items || []).length) addCurrentRow(kind);
    return true;
  }

  /* 1行を「本人の状態」の一文にする。相関図・伝えることが使う。
     note（自由記述の一言）があれば括弧で添える。旧データの status
     も拾って移行の穴を塞ぐ。 */
  function conditionNote(r) {
    if (!r) return '';
    if (r.note != null) return String(r.note);
    /* 旧フォーマット（status:'治療中'|'経過観察中'）。 */
    return r.status && r.status !== '治療中' ? r.status : '';
  }
  function conditionLabel(r) {
    if (!r || !r.text) return '';
    const n = conditionNote(r);
    return n ? r.text + '（' + n + '）' : r.text;
  }
  function allergyLabel(r) {
    if (!r) return '';
    /* causeKind は旧データの穴埋め（種類セレクトは廃止済み）。 */
    const cause = r.cause || (r.causeKind && r.causeKind !== '薬' ? r.causeKind : '') || '';
    const rx = (r.reactions || []).filter(x => x && x !== '詳細不明');
    return cause + (rx.length ? ' → ' + rx.join('・') : '');
  }
  function adverseLabel(r) {
    if (!r) return '';
    const cause = [r.cause, r.drug].filter(Boolean).join('｜');
    const ev = (r.events || []).filter(x => x && x !== '詳細不明');
    return cause + (ev.length ? ' → ' + ev.join('・') : '');
  }
  function currentRowLabel(kind, r) {
    if (kind === 'condition') return conditionLabel(r);
    if (kind === 'allergy')   return allergyLabel(r);
    if (kind === 'adverse')   return adverseLabel(r);
    return (r && r.text) || '';
  }

  /* 状態を次へ回す（確認済み→未確認→確認中→該当なし→…）。 */
  function cycleState(row) {
    if (!row) return;
    const cur = CHECK_ORDER.indexOf(row.state);
    row.state = CHECK_ORDER[(cur + 1) % CHECK_ORDER.length];
  }

  /* 状態を持つ行を、医療・介護それぞれから集める。数え上げと警告は
     すべてこの一覧から引くので、行の増減に自動で追随する。

     状態バッジは「家族が辿れるか」を問う対象（連絡先・外部機関・
     カード等の所在）にのみ持たせる。病気・治療・機器・アレルギー・
     副作用歴・普段の状態は本人の状態を書き並べるだけの項目なので、
     ここには含めない（正本 §11 の対象は"辿れるか"であって、本人の
     状態そのものではない）。                                       */
  function medicalRows() {
    const m = data.medical;
    /* いつもの通院（clinics）とかかりつけ薬局（medSources の
       kind:'pharmacy'）は状態を持たない――書いた時点で家族が辿れる
       「かかっている先の連絡先」で、§11 の状態を問う対象ではない。
       数え上げからも外す。 */
    const medSrc = (m.medSources || []).filter(r => r.kind !== 'pharmacy');
    return [].concat(medSrc, supplyRows());
  }
  /* 医療で必要になるものと所在｜全カテゴリの実物行を1本に。 */
  function supplyRows() {
    const s = data.medical.supplies || {};
    return SUPPLY_CAT_KEYS.reduce((all, k) => all.concat(s[k] || []), []);
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
    return findIn(m.clinics, id) ||
           findIn((m.conditions || {}).items, id) ||
           findIn((m.treatments || {}).items, id) ||
           findIn((m.devices || {}).items, id) ||
           findIn((m.allergies || {}).items, id) ||
           findIn((m.adverse || {}).items, id) ||
           findIn(m.medSources, id) ||
           findIn(supplyRows(), id) ||
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

  /* 配列で持っているタグ（診療科）。改行／読点区切りの一行テキストと
     して編集し、配列へ戻す。 */
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
      tel: '', web: '', hours: '' };
    data.medical.clinics.push(row);
    return row;
  }
  /* 薬を確認するところ｜かかりつけ薬局を1件足す（複数あり得る入口）。 */
  function addPharmacySource() {
    const row = { id: uid('ms'), kind: 'pharmacy', name: '', tel: '',
      where: '', note: '', state: '未確認' };
    data.medical.medSources.push(row);
    return row;
  }
  /* 医療で必要になるものと所在｜カテゴリに実物を1件足す。 */
  function addSupply(catKey) {
    const s = data.medical.supplies || (data.medical.supplies = {});
    const list = s[catKey] || (s[catKey] = []);
    const row = { id: uid('sp'), name: '', where: '', state: '未確認' };
    list.push(row);
    return row;
  }
  /* 現在の医療状態｜5項目に1行足す。項目ごとに行の形が違う。
     presence は触らない（「あり」にするのは setPresence の仕事）。 */
  function addCurrentRow(kind) {
    const g = grpOf(kind);
    g.items = g.items || [];
    let row;
    if (kind === 'condition')
      row = { id: uid('cd'), text: '', note: '' };
    else if (kind === 'treatment')
      row = { id: uid('tr'), text: '', region: '', purpose: '', note: '' };
    else if (kind === 'device')
      row = { id: uid('dv'), text: '', group: 'body', region: '', purpose: '', note: '' };
    else if (kind === 'allergy')
      row = { id: uid('al'), cause: '', reactions: [] };
    else if (kind === 'adverse')
      row = { id: uid('ad'), cause: '', events: [] };
    g.items.push(row);
    return row;
  }
  /* 旧名の互換（render 側の data-add ハンドラが呼ぶ）。 */
  function addCurrent(kind) { return addCurrentRow(kind); }
  function addAllergy() { return addCurrentRow('allergy'); }
  function addAdverse() { return addCurrentRow('adverse'); }

  /* 行の中の複数選択（反応・起きたこと）を入り切りする。 */
  function toggleInArray(row, field, value) {
    if (!row) return;
    const arr = row[field] = Array.isArray(row[field]) ? row[field] : [];
    const at = arr.indexOf(value);
    if (at > -1) arr.splice(at, 1); else arr.push(value);
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
  /* かかりつけ薬局の入口は、標準の1件（medSources 内で最初の
     kind:'pharmacy'）は残す。2件目以降だけ消せる。 */
  function canRemoveMedSource(id) {
    const list = data.medical.medSources || [];
    const row = findIn(list, id);
    if (!row || row.kind !== 'pharmacy') return false;
    return list.filter(r => r.kind === 'pharmacy').findIndex(r => r.id === id) > 0;
  }

  /* どの一覧に居るか分からない行を消す。現在の医療状態の5項目は
     { presence, items } なので items を渡す。標準の入口（薬の
     入口の1件目など）は消さない。 */
  function removeAny(id) {
    const m = data.medical, c = data.care;
    if (findIn(m.medSources, id)) {
      if (canRemoveMedSource(id)) removeFrom(m.medSources, id);
      return;
    }
    [m.clinics, c.services, c.papers].forEach(list => removeFrom(list, id));
    SUPPLY_CAT_KEYS.forEach(k => removeFrom((m.supplies || {})[k], id));
    ['conditions', 'treatments', 'devices', 'allergies', 'adverse'].forEach(k => {
      const g = m[k];
      if (g && Array.isArray(g.items)) removeFrom(g.items, id);
    });
  }

  global.SeiZenMedicalCare = {
    /* 語彙 */
    CHECK_STATES, CHECK_ORDER, CURRENT_KINDS, CURRENT_ORDER, BLOOD_TYPES, DEPARTMENTS,
    PRESENCE, CONDITION_CHOICES, CONDITION_CHOICE_GROUPS, CONDITION_NOTE_CHOICES,
    TREATMENT_CHOICES, TREATMENT_CHOICE_GROUPS,
    DEVICE_CHOICES, DEVICE_CHOICE_GROUPS, DEVICE_GROUPS,
    BODY_REGIONS, BODY_REGION_KEYS, REGION_OF_CHOICE,
    ALLERGY_REACTIONS, ADVERSE_EVENTS,
    MEDSRC_KINDS, MEDSRC_ORDER, MEDSRC_FIXED,
    SUPPLY_CATS, SUPPLY_CAT_KEYS, supplyCat,
    CARE_LEVELS, PLACES, SERVICE_KINDS, SERVICE_TYPES, DAYS,
    /* 事実 */
    data, save,
    /* 引き出し */
    ageFromBirth, formatBirth,
    bodyRegion, regionOfRow,
    checkState, cycleState, currentKind, medSrcKind, serviceKind, isCertified,
    serviceType, kindOfService,
    currentGroup, grpOf, setPresence, currentRowLabel,
    conditionLabel, conditionNote, allergyLabel, adverseLabel,
    medicalTally, careTally, openCount, supplyRows,
    weekGrid, hasSchedule, toggleDay,
    findIn, findAny,
    /* 編集 */
    getByPath, setByPath, applyValue,
    tagsToText, textToTags, applyTags, linesToText, applyLines,
    toggleInArray,
    /* 足す・消す */
    addClinic, addPharmacySource, addSupply,
    addCurrent, addCurrentRow, addAllergy, addAdverse, addService,
    setServiceName, setServiceKind, removeFrom, removeAny, canRemoveMedSource
  };
})(window);
