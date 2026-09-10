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

   入力した内容は localStorage に保存する。保存フォーマットには版
   （SCHEMA）を持たせ、形を変えたコミットでは版を上げて MIGRATIONS に
   1段足す――こうすると、同じ版の保存分はそのまま読める（編集して
   再読み込みしても内容が消えない）し、古い版は移行関数で地続きに
   引き上がる。本番でユーザーのデータが入ったあとも同じ流れで運べる。
   保存を消して初期の仮データに戻したいときは、コンソールで
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
     ない――物質名から分かるし、閲覧側でも使っていなかった。
     候補に無い反応はチップの下の自由入力欄で書き足す（診療科 depts と
     同じ手つき）。だから「その他」チップは持たない。「詳細不明」は
     "選んで確認したが内容は分からない"の意味があるので残す。 */
  const ALLERGY_REACTIONS = ['発疹・じんましん', 'かゆみ', '腫れ', '呼吸苦',
    '血圧低下・意識障害', 'アナフィラキシー', '詳細不明'];

  /* 強い副作用歴｜「起きたこと」をまず選び、思い当たる薬・治療は任意。
     固定の薬剤候補は持たない。「今後避けるよう言われたか」の欄は
     廃止した（この節はすべて"避けるもの"なので行ごとに持つ意味が
     薄い）。候補外はアレルギーと同じく自由入力欄で書き足す。 */
  const ADVERSE_EVENTS = ['強い吐き気・嘔吐', '強い胃腸症状', 'めまい・ふらつき',
    '意識障害', '強い眠気', '出血', '肝機能障害', '腎機能障害',
    '血球減少', '詳細不明'];

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

  /* 「医療で必要になるものと所在」（診察券・お薬手帳・各種医療手帳等を
     固定カテゴリで束ねる棚）は撤去した（正本 §13-1）。カード・手帳の
     類は付随する対象（通院先・機器）の側で持つ――医療機器・体内機器の
     `related` 欄など。詳細は `prototype/assets/医療.README.md`。 */

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

  /* 要介護度が何を意味するかの一言。制度の区分なので家族には馴染みが
     薄く、数字だけ見ても軽重が分からない――帯の ⓘ で補う。
     区分の定義そのものなので、家庭ごとに書き換えるものではない。 */
  const LEVEL_ABOUT = {
    '認定を受けていない': '介護保険の申請をしていない状態。市区町村の窓口か地域包括支援センターが相談先。',
    '申請中': '認定の結果を待っている状態。結果が出るまでの間も、暫定のケアプランでサービスを使えることがある。',
    '要支援1': '日常生活はほぼ自分でできるが、一部に支えが要る状態。介護予防のサービスが対象。',
    '要支援2': '要支援1より支えが要るが、改善の見込みがある状態。介護予防のサービスが対象。',
    '要介護1': '立ち上がりや歩行が不安定で、日常生活の一部に介助が要る状態。',
    '要介護2': '立ち上がりや歩行が自力では難しく、食事や排せつにも介助が要ることがある状態。',
    '要介護3': '立ち上がりや歩行が自力ではできず、日常生活全般に介助が要る状態。',
    '要介護4': '介助なしでは日常生活を送るのが難しく、介護の手間が多くかかる状態。',
    '要介護5': 'ほぼ寝たきりで、意思の伝達も難しいことがある。生活全般に介助が要る状態。'
  };
  function levelAbout(level) {
    return LEVEL_ABOUT[level] ||
      '要介護度は市区町村が決める区分で、使えるサービスと限度額がこれで決まる。';
  }

  /* 介護サービスの型。サービス表の行頭アイコンの色と記号がここから
     決まる。制度の分類そのままではなく「家族から見て何をしてもらって
     いるか」で分けている（正本 §3）。色は行を見分けるためのもの。

     ★ここに並ぶのは**時間と曜日を持つ**もの（人が来る／出かける／
     届く）だけ。福祉用具（家に物がある）は性質が違うので分けた
     （下の EQUIP_KINDS）――造形も「暮らしの時間に入る支援」の帯と
     「継続して使っている支援」の絵札で別物になる（2026-09-09）。

       home   人が家に来る（訪問介護・訪問看護・訪問リハビリ）
       out    本人が出かける（デイサービス・デイケア・ショートステイ）
       meal   食事が届く（配食）
       life   暮らしの手伝い（家事・見守り・相談） */
  const SERVICE_KINDS = {
    home:  { label: '訪問',     tone: 'c-home'  },
    out:   { label: '通い',     tone: 'c-out'   },
    meal:  { label: '食事',     tone: 'c-meal'  },
    life:  { label: '暮らし',   tone: 'c-life'  }
  };

  /* サービスの型ごとの代表的なサービス名。追加のときの候補に使う。
     ここに無いものは自由入力できる。 */
  const SERVICE_TYPES = [
    { name: '訪問介護（ホームヘルプ）', kind: 'home'  },
    { name: '訪問看護',                 kind: 'home'  },
    { name: '訪問リハビリ',             kind: 'home'  },
    { name: '訪問入浴',                 kind: 'home'  },
    { name: 'デイサービス（通所介護）', kind: 'out'   },
    { name: 'デイケア（通所リハビリ）', kind: 'out'   },
    { name: 'ショートステイ',           kind: 'out'   },
    { name: '配食サービス',             kind: 'meal'  },
    { name: '生活支援',                 kind: 'life'  },
    { name: '家事援助',                 kind: 'life'  },
    { name: '見守りサービス',           kind: 'life'  },
    { name: '地域包括支援センター',     kind: 'life'  },
    { name: '民生委員',                 kind: 'life'  }
  ];
  function serviceType(name) { return SERVICE_TYPES.find(s => s.name === name) || null; }
  function kindOfService(name) { const t = serviceType(name); return t ? t.kind : null; }

  /* 継続して使っている福祉用具。介護保険では「貸与（レンタル）」
     「購入（買い切り）」「住宅改修（工事）」が別制度――住宅改修は
     家にある物ではなく工事済みの記録なので、絵札には含めない
     （2026-09-09 ユーザー判断）。貸与・購入だけを物として持つ。
     kind は絵札のグリフを決める（bed／walker／monitor）。 */
  const EQUIP_KINDS = {
    bed:     { label: '介護ベッド', unit: '貸与' },
    walker:  { label: '歩行器',     unit: '貸与' },
    monitor: { label: '見守り機器', unit: '貸与' },
    other:   { label: 'その他の用具', unit: '貸与' }
  };
  const EQUIP_TYPES = [
    { name: '介護ベッド',         kind: 'bed'     },
    { name: '車椅子',             kind: 'other'   },
    { name: '歩行器',             kind: 'walker'  },
    { name: '手すり（工事なし）', kind: 'other'   },
    { name: 'スロープ',           kind: 'other'   },
    { name: '見守りセンサー',     kind: 'monitor' },
    { name: '入浴補助用具',       kind: 'other'   },
    { name: 'ポータブルトイレ',   kind: 'other'   }
  ];
  function equipType(name) { return EQUIP_TYPES.find(s => s.name === name) || null; }
  function kindOfEquip(name) { const t = equipType(name); return t ? t.kind : null; }

  let seq = 0;
  const uid = p => p + '-' + (++seq);

  /* ── 事実 ───────────────────────────────────────────
     画面に出ているのは、ここから描かれる仮データ。               */

  /* 保存フォーマットの版。医療・介護のどちらかで持ち方（キーの構成・
     配列の要素の形）を変えたら、この番号を1つ上げる。上げ忘れると
     古い形の保存分を新しい画面がそのまま読んでしまうので、形を触った
     コミットでは必ず一緒に上げる。

     版が上がったときの流れは hydrate() を参照。要点：
       ・同じ版なら保存分をそのまま採用する（構造の当て推量はしない
         ＝「データが戻る」を起こさない）
       ・版が古いときは MIGRATIONS を順に当てて現在の版へ引き上げる。
         引き上げられない領域だけ、その領域を仮データに落とす
       ・本番でユーザーのデータが入ったあとに形を変えるときも、
         この番号を上げて MIGRATIONS に1段足せば地続きで移行できる */
  const SCHEMA = 5;

  const data = {
    /* この版で保存する。hydrate() が古い版を読んだら MIGRATIONS で
       ここまで引き上げてから採用する。 */
    schema: SCHEMA,
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
         { text, region, note, contact, related, memo }。
         note＝継続のしかた（頻度・タイミング）、contact＝対応先
         （継続や確認の連絡先）、related＝手帳・カード等の関連物、
         memo＝それ以外の補足。どれも該当する場合だけ書く。 */
      treatments: {
        presence: 'あり',
        items: [
          { id: uid('tr'), text: 'インスリン自己注射', region: '',
            note: '1日2回（朝・夜）' },
          { id: uid('tr'), text: '在宅酸素', region: 'lung',
            note: '夜間に使用' }
        ]
      },
      /* 医療機器・体内機器｜行は { text, region, note, related, memo }。
         region は空なら候補表から部位を当てる。note＝使用状況（常時／
         夜間のみ等）、related＝手帳・カード等の関連物（存在する場合
         だけ）、memo＝それ以外の補足。体内にあるか日常的に使うかは
         候補（DEVICE_CHOICES）の系統として案内するだけで、行には
         持たない――どちらの塗り分けも実際は devices/treatments という
         項目の違いだけで決まり、この行データを読む先が無かった。 */
      devices: {
        presence: 'あり',
        items: [
          { id: uid('dv'), text: 'ペースメーカー', region: '',
            note: '常時作動', related: 'ペースメーカー手帳＝自宅の書類箱（医療）' },
          { id: uid('dv'), text: '人工関節', region: 'leg' }
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
      ]
    },

    /* 介護 ------------------------------------------------------
       連絡ボード（`prototype/assets/介護イメージ.png` が造形の正本）。
       4節：介護認定／担当ケアマネ／利用している支援（表）／
       書類やもの（荷札）。生活場所・家族が知っておきたいこと・週の
       予定は落とした（§13-1。README 参照）。 */
    care: {
      /* ① 介護認定。要介護度は制度上の区分で、家庭が決めるものでは
         ない（正本 §9）。認定の有無だけが状態。 */
      level: '要介護2',
      /* ② 担当ケアマネジャー。連絡先ではなく「介護の入口」。
         状態は持たない――名前と電話を書いた時点で家族は辿れるので、
         §11 の「確認できたか」を問う対象ではない（医療の通院カード・
         かかりつけ薬局からバッジを撤去したのと同じ理由）。 */
      manager: {
        name: '山田 花子',
        office: '○○居宅介護支援事業所',
        tel: '045-123-4567',
        web: 'https://example.or.jp/kyotaku/',
        note: 'いつも親身に相談にのってくださっています。'
      },
      /* ③-a 暮らしの時間に入る支援。時間と曜日を持つもの（人が来る／
         出かける／届く）。「今の支援」の上段＝卸しカレンダーの1週分
         に描く。曜日は use の自由文から**読み取って**帯に薄く点を
         打つだけで、管理項目としては持たない（2026-09-09）。 */
      /* does … その時間に**何をしてもらっているか**（2026-09-09 追加）。
         種類（訪問介護）と事業所と曜日だけでは、家族が代わりに立ち会う
         とき「来て何をする人なのか」が分からない――正本 §13-1 の基準
         （必要時に家族が思い出せない・調べられないことか）に当たる。
         ケアプランの原本を写すのではなく、一言で分かる粒度で持つ。 */
      /* ★2026-09-09 の作り直し：
         ・sub（補足＝「ホームヘルプ」等の制度上の呼び名）を撤去し、
           does（支援内容）へ一本化。家族が読むのは「何をするか」で
           あって制度の呼称ではない（ユーザー判断）。
         ・days を実データとして持つ。曜日は編集中に点を押して入切する
           ――use の自由文から読み取る方式はやめた（同）。
         ・use は「時間帯」だけを持つ。曜日は days の側にあるので、
           二重に持たない（「月・木 午前」→「午前」）。
         ・web を足す。相談先（manager）が URL を持つのに事業所が
           持たないのは筋が通らない。 */
      services: [
        { id: uid('sv'), kind: 'home', name: '訪問介護',
          provider: '○○ケアサービス', tel: '045-111-2222',
          web: 'https://example.or.jp/homehelp/',
          does: '入浴の介助・着替え・服薬の見守り',
          days: ['月', '木'], use: '午前（9:00〜12:00頃）', state: '確認済み' },
        { id: uid('sv'), kind: 'out', name: 'デイサービス',
          provider: '△△デイサービスセンター', tel: '045-333-4444',
          web: 'https://example.or.jp/day/',
          does: '送迎つき。入浴・昼食・リハビリ体操',
          days: ['火', '金'], use: '9:00〜16:00', state: '確認済み' },
        { id: uid('sv'), kind: 'meal', name: '配食サービス',
          provider: '□□フードサービス', tel: '045-555-6666', web: '',
          does: '夕食を玄関まで届ける（塩分ひかえめ）',
          days: ['月', '火', '水', '木', '金', '土', '日'],
          use: '夕方', state: '確認済み' },
        { id: uid('sv'), kind: 'life', name: '生活支援',
          provider: '○○ライフサポート', tel: '045-777-8888', web: '',
          does: '掃除・洗濯・買い物の代行',
          days: ['火'], use: '10:00〜12:00', state: '確認済み' }
      ],
      /* ③-b 継続して使っている支援。ずっと家にある福祉用具（貸与・
         購入）。「今の支援」の下段＝物の絵札に並べる。事業所・連絡先は
         持つ（貸与元に連絡することがあるため）。住宅改修は工事済みの
         記録であって家にある物ではないので、ここには含めない
         （papers 側に「住宅改修の記録」として置ける）。 */
      equipment: [
        { id: uid('eq'), kind: 'bed', name: '介護ベッド',
          provider: 'はまっ子福祉用具', tel: '045-222-3333', state: '確認済み' },
        { id: uid('eq'), kind: 'walker', name: '歩行器',
          provider: 'はまっ子福祉用具', tel: '045-222-3333', state: '確認済み' }
      ],
      /* ④ 介護関係の書類やもの。その家にある、比較的安定した書類・
         ものの所在（§13-1）。中身（番号など）は持たない。並びは一例。 */
      papers: [
        { id: uid('cp'), item: '介護保険関係の書類', where: 'リビングの書類棚', state: '確認済み' },
        { id: uid('cp'), item: 'ケアプラン', where: 'リビングの書類棚', state: '確認済み' },
        { id: uid('cp'), item: '負担割合証', where: 'リビングの引き出し', state: '確認済み' },
        { id: uid('cp'), item: '介護保険証', where: 'リビングの書類棚', state: '未確認' }
      ]
    }
  };

  /* ── 保存フォーマットの移行 ───────────────────────────
     MIGRATIONS[n] は「版 n の保存分を版 n+1 の形へ書き換える」関数。
     破壊的に s を書き換えてよい（hydrate() が読んだ直後の生データ）。
     どうしても引き継げない部分は、その領域のキー（medical / care）を
     delete する――hydrate() がその領域だけ仮データで埋める。

     ここに載っているのは「本番でユーザーのデータが入ったあとでも
     地続きで運べる」変更。作り替えの途中でしか存在しなかった中間の形
     まで面倒を見る必要はない（引き継げなければ delete でよい）。 */
  const MIGRATIONS = {
    /* 版1→2：医療の作り替え（現在の医療状態が配列／旧・薬・書類の形）。
       引き継げないので medical を落とす。 */
    1: function (s) {
      const m = s.medical;
      if (m && (Array.isArray(m.conditions) || Array.isArray(m.pharmacies) ||
        Array.isArray(m.pocket) || Array.isArray(m.papers) ||
        (m.supplies && Array.isArray(m.supplies)))) {
        delete s.medical;
      }
    },
    /* 版2→3：介護を連絡ボードへ作り替え。
         ・生活場所／知っておきたいこと／週の曜日 → 落とす
         ・サービスの型 home/out/equip/support → home/out/meal/life
         ・福祉用具（kind:'equip'）を services から equipment へ
         ・manager に web を足し、状態バッジ（state）を外す
       services は型の載せ替えで拾えるが、equip 行の付け替えや旧・型の
       対応が絡むので、ここでは care を丸ごと落として仮データに戻す
       （介護に実データが入るのは本番以降。それまでの中間形は救わない）。 */
    2: function (s) {
      const c = s.care;
      if (c && ('place' in c || 'placeNote' in c || Array.isArray(c.notes) ||
        !Array.isArray(c.equipment) ||
        (c.manager && (!('web' in c.manager) || 'state' in c.manager)) ||
        (Array.isArray(c.services) && c.services.some(sv => sv &&
          (Array.isArray(sv.days) || 'freq' in sv || 'detail' in sv ||
           sv.kind === 'equip' || sv.kind === 'support'))))) {
        delete s.care;
      }
    },
    /* 版3→4：支援に「支援内容」（does）を足した。★これは**足しただけ**
       なので care を落とさない――旧い保存分は does が無いだけで、他の
       項目（事業所・電話・利用状況）はそのまま使える。空文字で埋めて
       おけば、未記入の欄として正しく出る（正本 §11：空欄は空欄として
       持つ。「該当なし」に化けさせない）。

       ★RESEARCH.md §3 の教訓：state.js の形を変えたら hydrate/移行を
       必ず見直す。前回これを飛ばして、旧セッションの保存分のせいで
       「直したはずの表示が直っていないように見える」事故を起こした。 */
    3: function (s) {
      const c = s.care;
      if (c && Array.isArray(c.services)) {
        c.services.forEach(sv => { if (sv && !('does' in sv)) sv.does = ''; });
      }
    },
    /* 版4→5：曜日を実データ（days）にし、sub を撤去、web を足す。
       ここは「足すだけ」では済まない――旧い use は「月・木 午前
       （9:00〜12:00頃）」のように**曜日が文字列に混ざっている**。
       days へ移したあと use から曜日を取り除かないと、点と文字で
       二重に曜日を持つことになる。

       ★取り除きは保守的に。先頭に固まっている曜日群（「月・木 」
       「毎日 」「火・金（」）だけを外し、確信が持てない書き方は
       use をそのまま残す――家族が書いた文字を勝手に消さない
       （正本 §11 の精神：分からないものを分かったことにしない）。 */
    4: function (s) {
      const c = s.care;
      if (!c || !Array.isArray(c.services)) return;
      const DAYS = ['月', '火', '水', '木', '金', '土', '日'];
      c.services.forEach(sv => {
        if (!sv) return;
        if (!('web' in sv)) sv.web = '';
        delete sv.sub;
        if (!Array.isArray(sv.days)) {
          const u = String(sv.use || '');
          /* 曜日の読み取りは旧 weekdaysOf と同じ規則。 */
          sv.days = /毎日/.test(u) ? DAYS.slice() : DAYS.filter(d => u.indexOf(d) > -1);
          /* use の先頭に固まっている曜日表記だけを落とす。
             例：「月・木 午前（…）」→「午前（…）」／「毎日 夕方」→「夕方」
                 「週1回（火）（10:00〜12:00）」→ 触らない（曜日が
                 文の途中にあり、外すと文が壊れる） */
          const head = /^\s*(?:毎日|[月火水木金土日](?:\s*[・,、]\s*[月火水木金土日])*)\s*[　\s]*/;
          if (sv.days.length && head.test(u)) sv.use = u.replace(head, '').trim();
        }
      });
    }
  };

  /* 保存分を現在の版まで引き上げる。引き上げられなかった領域は
     MIGRATIONS が delete しているので、hydrate() がそこを埋める。 */
  function migrate(saved) {
    /* 版が無い保存分＝版番号を導入する前のもの。医療は当時すでに
       現在に近い形だったが、確実を採って版1（要移行）として扱う。 */
    let v = (typeof saved.schema === 'number' && saved.schema > 0)
      ? saved.schema : 1;
    while (v < SCHEMA) {
      const step = MIGRATIONS[v];
      if (typeof step === 'function') {
        try { step(saved); }
        catch (e) { delete saved.medical; delete saved.care; }
      }
      v++;
    }
    saved.schema = SCHEMA;
    return saved;
  }

  /* 保存済みがあれば仮データを差し替える。
     ・同じ版なら保存分をそのまま採用する（構造を推測して捨てない
       ＝編集して再読み込みしても「データが戻る」を起こさない）
     ・古い版は migrate() で引き上げる。引き上げられなかった領域
       （medical / care のどちらか）は、その領域だけ仮データのまま
     id は "xx-<n>" の形なので、続きの採番が既存分とぶつからないよう
     seq を合わせ直す。 */
  function hydrate() {
    let saved = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch (e) { return; }
    if (!saved || typeof saved !== 'object') return;

    if (saved.schema !== SCHEMA) saved = migrate(saved);

    if (saved.medical && typeof saved.medical === 'object') {
      data.medical = saved.medical;
    }
    if (saved.care && typeof saved.care === 'object') {
      data.care = saved.care;
    }
    /* 採用した分の中で一番大きい採番まで seq を進める。 */
    JSON.stringify({ medical: data.medical, care: data.care })
      .replace(/"[a-z]{2}-(\d+)"/g, (m, n) => {
        const v = parseInt(n, 10);
        if (!isNaN(v) && v > seq) seq = v;
        return m;
      });
  }
  hydrate();

  function save() {
    data.schema = SCHEMA;
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
  /* 未知の型（型を作り替える前に保存された行）でも undefined を返さない。
     フォールバックは life（暮らしの手伝い）＝いちばん広く受ける型。 */
  const serviceKind = k => SERVICE_KINDS[k] || SERVICE_KINDS.life;
  const equipKind   = k => EQUIP_KINDS[k] || EQUIP_KINDS.other;

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
    return [].concat(medSrc);
  }
  /* ケアマネ（manager）は数え上げに入れない。状態を持たない行なので、
     入れると分母だけ増えて「まだ辿れない」が薄まる（§12：進捗は入力率
     ではなく、必要な状態がどこまで成立しているかで数える）。 */
  function careRows() {
    const c = data.care;
    return [].concat(c.services || [], c.equipment || [], c.papers || []);
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
           findIn(c.services, id) || findIn(c.papers, id) ||
           (c.manager && c.manager.id === id ? c.manager : null);
  }

  /* ── 編集 ───────────────────────────────────────────
     画面から書き換える。値の場所は 'medical.meds.taking' や
     'care.services.0.use' のようなドット区切りで data から辿る。    */
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
    if (cur.join(' ') === next.join(' ')) return false;
    setByPath(path, next);
    return true;
  }

  /* 起きた反応・起きたこと（reactions / events）は、チップで選んだ値と
     候補外の自由入力が同じ配列に混ざって入る。閲覧側は配列を素で
     繋ぐだけなので、区別を持たせずに1本の配列で扱う。
       reactionFreeText … 配列から既知チップを除いた「自由入力ぶん」を
                          読点区切りのテキストにして編集欄へ返す。
       applyReactionFree … 編集後のテキストを配列へ書き戻す。既知チップの
                          選択は保ったまま、自由入力ぶんだけ差し替える。 */
  function reactionFreeText(list, known) {
    const set = new Set(known || []);
    return (list || []).filter(x => x && !set.has(x)).join('、');
  }
  function applyReactionFree(row, field, known, text) {
    if (!row) return false;
    const set = new Set(known || []);
    const kept = (Array.isArray(row[field]) ? row[field] : []).filter(x => set.has(x));
    const free = textToTags(text);
    const next = kept.concat(free);
    const cur = Array.isArray(row[field]) ? row[field] : [];
    if (cur.join(' ') === next.join(' ')) return false;
    row[field] = next;
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
  /* 現在の医療状態｜5項目に1行足す。項目ごとに行の形が違う。
     presence は触らない（「あり」にするのは setPresence の仕事）。 */
  function addCurrentRow(kind) {
    const g = grpOf(kind);
    g.items = g.items || [];
    let row;
    if (kind === 'condition')
      row = { id: uid('cd'), text: '', note: '' };
    else if (kind === 'treatment')
      row = { id: uid('tr'), text: '', region: '', note: '', contact: '', related: '', memo: '' };
    else if (kind === 'device')
      row = { id: uid('dv'), text: '', region: '', note: '', related: '', memo: '' };
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
      provider: '', tel: '', web: '', does: '', days: [], use: '',
      state: '未確認' };
    data.care.services.push(row);
    return row;
  }
  /* 曜日の入切。★曜日は days が持つ実データになった（2026-09-09）。
     use の自由文から読み取る方式はやめたので、点を押して直接切り替える。
     順序は月〜日で保つ（押した順に並ぶと表示がばらつく）。 */
  const WEEK_ORDER = ['月', '火', '水', '木', '金', '土', '日'];
  function toggleServiceDay(sv, day) {
    if (!sv || WEEK_ORDER.indexOf(day) < 0) return false;
    const days = Array.isArray(sv.days) ? sv.days : (sv.days = []);
    const at = days.indexOf(day);
    if (at > -1) days.splice(at, 1); else days.push(day);
    days.sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
    return true;
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

  /* 福祉用具を1件足す。型（kind）は用具名から決まる（addService と同じ
     考え方）。事業所・連絡先は貸与元に連絡することがあるので持つ。 */
  function addEquip(name, kind) {
    const k = kindOfEquip(name) || kind || 'other';
    const row = { id: uid('eq'), kind: k, name: name || '',
      provider: '', tel: '', state: '未確認' };
    data.care.equipment.push(row);
    return row;
  }
  function setEquipName(eq, name) {
    if (!eq || eq.name === name) return false;
    eq.name = name;
    const k = kindOfEquip(name);
    if (k && k !== eq.kind) eq.kind = k;
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
    [m.clinics, c.services, c.equipment, c.papers].forEach(list => removeFrom(list, id));
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
    CARE_LEVELS, SERVICE_KINDS, SERVICE_TYPES, EQUIP_KINDS, EQUIP_TYPES,
    /* 事実 */
    data, save,
    /* 引き出し */
    ageFromBirth, formatBirth,
    bodyRegion, regionOfRow,
    checkState, cycleState, currentKind, medSrcKind, serviceKind, equipKind,
    isCertified, levelAbout,
    serviceType, kindOfService, equipType, kindOfEquip,
    currentGroup, grpOf, setPresence, currentRowLabel,
    conditionLabel, conditionNote, allergyLabel, adverseLabel,
    medicalTally, careTally, openCount,
    findIn, findAny,
    /* 編集 */
    getByPath, setByPath, applyValue,
    tagsToText, textToTags, applyTags,
    reactionFreeText, applyReactionFree,
    toggleInArray,
    /* 足す・消す */
    addClinic, addPharmacySource,
    addCurrent, addCurrentRow, addAllergy, addAdverse, addService,
    toggleServiceDay,
    setServiceName, setServiceKind, addEquip, setEquipName,
    removeFrom, removeAny, canRemoveMedSource
  };
})(window);
