/* SeiZen プロトタイプ｜契約・デジタルの状態（2軸版）
   ------------------------------------------------------------------
   1件の記録は、性質の違う2つの軸を独立して持つ。

     ■ 本人側 … policy
       intent   … 本人がどうしたいか（継続／解約／変更／未定）
       decision … その意思がどこまで固まったか
                  （決定済み／条件待ち／検討中／未確認）
       この2つは掛け合わせ。「解約 × 条件待ち」＝移行先が決まったら
       解約する、のように、方向と固さを別々に持てる。以前は
       「利用継続するか確認中」のように1つの文字列へ混ぜていた。

     ■ 家族側 … account
       手続きに必要な情報が家族の手元にあるか。項目ごとに
       確認済み／確認が必要を持ち、カード上部と索引に出る
       バッジ（準備済み／確認が必要／未着手）はここだけから引く。

   2つの軸は独立している。本人が決めていても家族が情報を持って
   いなければ動けないし、その逆もある。だから画面でも混ぜない。

     contract / procedure … 契約情報と手続きの手順。照合と実行の
              ための材料で、どちらの軸にも属さない。

   「必要になってから対応できる」側も同じ骨格を持つ。違うのは中身で、
   対応時期が「本人が亡くなった後」になり、account が指すのも認証
   情報ではなく契約番号・窓口・書類のありかになる。                 */
(function (global) {
  'use strict';

  /* ── 語彙 ─────────────────────────────────────────── */

  /* 本人の意思。「どうしたいか」への答えを5つに畳んだもの。
     以前は意思（継続／解約／変更／未定）と判断状態（決定済み／条件
     待ち／検討中／未確認）を掛け合わせていたが、決定済みと条件待ちは
     「次回判断のタイミングがあるか」から導けてしまい、同じことを二度
     言っていた。導けないのは検討中と未確認の違いだけなので、それを
     意思の値そのものにした。mark は「いまの状況」の ○△✕。        */
  const INTENTS = {
    continue: { label: '継続する', icon: 'loop',  tone: 'gr', mark: 'ok'      },
    cancel:   { label: '解約する', icon: 'power', tone: 'gr', mark: 'ok'      },
    change:   { label: '変更する', icon: 'swap',  tone: 'gr', mark: 'ok'      },
    weighing: { label: '検討中',   icon: 'scale', tone: 'or', mark: 'partial' },
    unknown:  { label: '未確認',   icon: 'quest', tone: 'gy', mark: 'none'    }
  };

  /* いまの状況の3段階。○＝揃っている、△＝途中、✕＝手つかず。 */
  const MARKS3 = {
    ok:      { sym: '○', tone: 'gr' },
    partial: { sym: '△', tone: 'or' },
    none:    { sym: '✕', tone: 'rd' }
  };

  /* ブロックごとの言い回し。同じ骨格を、その領域の言葉で見せる。 */
  const GROUP_UI = {
    pre: {
      title: '今のうちに準備が必要',
      lead: 'ご本人が亡くなった後に困らないよう、事前に<br>済ませておくと安心な契約です。',
      badges: { ready: '準備済み', open: '確認が必要' },
      accountTitle: 'アカウント情報', accountSub: '（対応可能か）',
      accountLead: '対応可能状態', accountNeed: '対応に必要なもの',
      okTitle: '対応できます', okNote: '必要な情報はそろっています。'
    },
    post: {
      title: '必要になってから対応できる',
      lead: '今すぐの準備は不要です。必要になったときに、<br>各窓口で手続きを行えます。',
      badges: { ready: '記録済み', open: '確認が必要' },
      accountTitle: '手続きに必要なもの', accountSub: '（必要時に使えるか）',
      accountLead: '記録の状態', accountNeed: '手続きに必要なもの',
      okTitle: '必要時に対応できます', okNote: '手続きに必要な情報はそろっています。'
    },
    /* 支払いカードは索引の対応タイミングには乗らないが、詳細の骨格は
       契約・アカウントと丸ごと同じにする。「いまの状況」の行見出しと
       バッジの言い回しだけ、ここから引く。                          */
    card: {
      accountTitle: 'アカウント情報',
      badges: { ready: '準備済み', open: '確認が必要' }
    }
  };

  /* ブランドの代替マーク。実ロゴは使わず、頭文字とブランド色で識別する。 */
  /* ブランドカラーは使わず、全サービス共通のモノクロ地に頭文字だけを置く。 */
  const MARKS = {
    'Netflix':                      { ch: 'N', bg: '#eef2f6', fg: '#6b7a89' },
    'Spotify':                      { ch: 'S', bg: '#eef2f6', fg: '#6b7a89' },
    'Amazonプライム':                { ch: 'a', bg: '#eef2f6', fg: '#6b7a89' },
    'Google One（100GB）':           { ch: '1', bg: '#eef2f6', fg: '#6b7a89' },
    'iCloud+（200GB）':              { ch: '☁', bg: '#eef2f6', fg: '#6b7a89' },
    'Googleアカウント（メール・写真）': { ch: 'G', bg: '#eef2f6', fg: '#6b7a89' },
    '東京電力エナジーパートナー':      { ch: '電', bg: '#eef2f6', fg: '#6b7a89' },
    '東京ガス':                      { ch: 'ガ', bg: '#eef2f6', fg: '#6b7a89' },
    '東京都水道局':                  { ch: '水', bg: '#eef2f6', fg: '#6b7a89' },
    'NTTドコモ（携帯電話）':          { ch: 'd', bg: '#eef2f6', fg: '#6b7a89' },
    'So-net光':                     { ch: 'S', bg: '#eef2f6', fg: '#6b7a89' },
    'NHK受信契約':                   { ch: 'N', bg: '#eef2f6', fg: '#6b7a89' }
  };

  const CATEGORIES = [
    { id: 'video',   label: '動画・音楽配信', hint: '例：Netflix、Amazonプライム、Spotify、Hulu、U-NEXT' },
    { id: 'cloud',   label: 'クラウド・ストレージ', hint: '例：Google One、iCloud+、Dropbox' },
    { id: 'news',    label: '新聞・雑誌・宅配', hint: '例：新聞購読、定期宅配、ミールキット' },
    { id: 'fitness', label: '会費制のサービス', hint: '例：ジム、習い事、会員制の駐車場' },
    { id: 'sns',     label: 'SNS・無料アカウント', hint: '例：X、LINE、Facebook、各種ポイント会員' }
  ];

  /* ── 事実：カード（支払いの経路） ─────────────────── */

  /* カードの詳細は、契約・アカウントと丸ごと同じ骨格（対応方針／
     アカウント情報／手続き方法／カード情報／メモ）を持つ。対応方針の
     intent は INTENTS をそのまま流用する（このカードを継続して使うか、
     他へ切り替えるか、解約するか、という家族側の判断）。契約情報に
     あたる部分は他カードへの支払いを持たないので「カード情報」という
     別の中身に置き換え、連絡先は手続き方法の「手続き先」に一本化して
     二重に持たない。                                                */
  const cards = [
    { id: 'card-rakuten', name: '楽天カード',
      group: 'card',
      policy: {
        intent: 'continue',
        reason: '複数の契約の支払いに使っているため、当面はこのカードのまま使い続けます。',
        nextTiming: ''
      },
      account: [
        { label: 'カード本体',           value: '保管場所：自宅・本人の財布', ok: true,  icon: 'card' },
        { label: '暗証番号',             value: '',      ok: false, icon: 'user' },
        { label: 'ネット明細のログイン', value: '未確認', ok: false, icon: 'mail' }
      ],
      info: { issuer: '楽天カード株式会社', holder: '父 太郎', tail: '5678', expiry: '2027/03' },
      procedure: {
        checked: true,
        where: '楽天カード コールセンター 0570-66-6910',
        steps: ['コールセンターに電話する', '契約者が亡くなったことを伝える', '利用停止・解約の手続きを申し込む', '紐づく契約の支払い方法を順に切り替える'],
        link: '楽天カード 会員が亡くなった場合の手続き',
        point: '解約すると、紐づく契約の支払いがすべて止まります。\n先に他の支払い方法へ切り替えてから手続きします。'
      },
      memo: ''
    },
    { id: 'card-smbc', name: '三井住友カード（NL）',
      group: 'card',
      policy: {
        intent: 'unknown',
        reason: '',
        nextTiming: ''
      },
      account: [
        { label: 'カード本体',           value: '', ok: false, icon: 'card' },
        { label: '暗証番号',             value: '', ok: false, icon: 'user' },
        { label: 'ネット明細のログイン', value: '', ok: false, icon: 'mail' }
      ],
      info: { issuer: '三井住友カード株式会社', holder: '父 太郎', tail: '1234', expiry: '2026/11' },
      procedure: {
        checked: false,
        where: '三井住友カード 総合案内 0120-919-013',
        steps: ['総合案内に電話する', '契約者が亡くなったことを伝える', '利用停止・解約の手続きを申し込む', '紐づく契約の支払い方法を順に切り替える'],
        link: '三井住友カード 会員が亡くなった場合の手続き',
        point: '解約すると、紐づく契約の支払いがすべて止まります。\n先に他の支払い方法へ切り替えてから手続きします。'
      },
      memo: ''
    }
  ];

  /* ── 事実：契約 ───────────────────────────────────── */

  const items = [
    /* --- 今のうちに準備が必要 --- */
    {
      id: 'svc-netflix', no: '001', name: 'Netflix', category: '動画配信', group: 'pre',
      registered: '2024.05.20', updated: '2024.05.20',
      policy: {
        intent: 'cancel',
        reason: '利用予定がないため、解約します。',
        nextTiming: ''
      },
      account: [
        { label: 'ログインID / パスワード', value: '保管場所：書類ケース「デジタル情報」', ok: true,  icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro***@gmail.com（父スマホ）',        ok: true,  icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '父のスマートフォン',                   ok: false, icon: 'phone' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'card-rakuten', amount: 1980, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
      procedure: {
        checked: true,
        where: 'Netflix ＞ アカウント ＞ メンバーシップ',
        steps: ['Netflixにログインする', '「アカウント」を開く', '「メンバーシップのキャンセル」を選択', '解約を確定する'],
        link: 'Netflix 解約方法ヘルプ',
        point: '解約はいつでも可能です。\n次回の請求日の前日までに手続きすると、\nその期間の終了まで視聴できます。'
      },
      memo: '家族がログインできるように、ログイン方法のメモを保管しておく。'
    },
    {
      id: 'svc-spotify', no: '002', name: 'Spotify', category: '音楽配信', group: 'pre',
      registered: '2024.05.20', updated: '2024.05.20',
      policy: {
        intent: 'cancel',
        reason: '他のサービスと重複しているため、解約します。',
        nextTiming: ''
      },
      account: [
        { label: 'ログインID / パスワード', value: '保管場所：書類ケース「デジタル情報」', ok: true, icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro***@gmail.com（父スマホ）',        ok: true, icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '設定なし',                            ok: true, icon: 'phone' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'card-rakuten', amount: 980, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
      procedure: {
        checked: true,
        where: 'Spotify ＞ アカウント ＞ プラン管理',
        steps: ['Spotifyのアカウントページにログインする', '「プランを変更する」を開く', '「Premiumをキャンセル」を選択', '解約を確定する'],
        link: 'Spotify 解約方法ヘルプ',
        point: '解約後も、支払い済みの期間が終わるまでは利用できます。\n無料プランへ自動的に切り替わります。'
      },
      memo: ''
    },
    {
      id: 'svc-amazon', no: '003', name: 'Amazonプライム', category: '動画・買い物', group: 'pre',
      registered: '2024.05.20', updated: '2024.05.20',
      policy: {
        intent: 'weighing',
        reason: '買い物でも使っているため、本人に利用状況を確認します。',
        nextTiming: '次回の帰省時（2024年8月）'
      },
      account: [
        { label: 'ログインID / パスワード', value: '保管場所：書類ケース「デジタル情報」', ok: true,  icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro***@gmail.com（父スマホ）',        ok: true,  icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '父のスマートフォン',                   ok: false, icon: 'phone' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'card-rakuten', amount: 5900, cycle: 'yearly', started: '不明', nextBill: '毎年〇月頃' },
      procedure: {
        checked: false,
        where: 'Amazon ＞ アカウントサービス ＞ プライム会員情報',
        steps: ['Amazonにログインする', '「アカウントサービス」を開く', '「プライム会員情報の設定・変更」を選択', '「会員資格を終了する」を選ぶ'],
        link: 'Amazonプライム 解約方法ヘルプ',
        point: '年額プランのため、途中解約すると未利用分が返金される場合があります。'
      },
      memo: ''
    },
    {
      id: 'svc-googleone', no: '004', name: 'Google One（100GB）', category: 'クラウド保存', group: 'pre',
      registered: '2024.05.20', updated: '2024.05.20',
      policy: {
        intent: 'continue',
        reason: '写真とメールの保存に利用しているため、当面は継続します。中身の移し先が決まった時点で、解約するかを判断します。',
        nextTiming: '移行先が決まり次第'
      },
      account: [
        { label: 'ログインID / パスワード', value: 'Googleアカウントの記録を参照',         ok: false, icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro.terasun@gmail.com',              ok: true,  icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '父のスマートフォン',                   ok: false, icon: 'phone' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'card-smbc', amount: 250, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
      procedure: {
        checked: true,
        where: 'Google One ＞ 設定 ＞ メンバーシップを管理',
        steps: ['Googleアカウントにログインする', 'Google One の設定を開く', '「メンバーシップを解約」を選択', '解約を確定する'],
        link: 'Google One 解約方法ヘルプ',
        point: '解約すると保存容量が無料枠に戻り、\n超過分のデータは順次利用できなくなります。'
      },
      memo: '解約前に、写真とメールの移し先を決めておく必要がある。移行先が決まったら移行作業を行い、本人と相談のうえ継続・解約を最終判断する。',
      dataLoss: true
    },
    {
      id: 'svc-icloud', no: '005', name: 'iCloud+（200GB）', category: 'クラウド保存', group: 'pre',
      registered: '2024.05.20', updated: '2024.05.20',
      policy: {
        intent: 'continue',
        reason: 'iPhoneのバックアップに使っているため、当面は継続します。',
        nextTiming: ''
      },
      account: [
        { label: 'ログインID / パスワード', value: '保管場所：書類ケース「デジタル情報」', ok: true, icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro.terasun@icloud.com',             ok: true, icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '父のスマートフォン・iPad',             ok: true, icon: 'phone' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'card-smbc', amount: 400, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
      procedure: {
        checked: false,
        where: 'iPhone ＞ 設定 ＞ Apple ID ＞ iCloud',
        steps: ['iPhoneの「設定」を開く', '最上部のApple IDを選択', '「iCloud」＞「アカウントのストレージを管理」を開く', '「プランを変更」から解約する'],
        link: 'Apple iCloud+ 解約方法ヘルプ',
        point: '「故人アカウント管理連絡先」は本人しか指定できません。\n指定しておくと、家族がデータにアクセスできます。'
      },
      memo: '',
      dataLoss: true
    },
    {
      id: 'goog-account', no: '006', name: 'Googleアカウント（メール・写真）', category: '無料アカウント', group: 'pre',
      registered: '2024.05.20', updated: '2024.05.20',
      policy: {
        intent: 'unknown',
        reason: '他の契約の連絡先にもなっているため、閉じてよいかどうかを本人に確認する必要があります。',
        nextTiming: '次回の帰省時（2024年8月）'
      },
      account: [
        { label: 'ログインID / パスワード', value: '未確認',                    ok: false, icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro.terasun@gmail.com',    ok: true,  icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '未確認',                    ok: false, icon: 'phone' }
      ],
      contract: { holder: '父 太郎', paymentCard: null, paymentLabel: '費用なし', amount: 0, cycle: 'none', started: '不明', nextBill: '—' },
      procedure: {
        checked: false,
        where: 'Google アカウント ＞ データとプライバシー',
        steps: ['Googleアカウントにログインする', '「データとプライバシー」を開く', '「アカウント無効化管理ツール」を設定する', 'データの引き継ぎ先を指定する'],
        link: 'Googleアカウント無効化管理ツール',
        point: 'このアカウントが開けないと、他の契約を調べる手段そのものが失われます。'
      },
      memo: '契約は他社にもわたるため、ここが開けないと調べる手段自体が失われます。',
      dataLoss: true
    },

    /* --- 必要になってから対応できる ---
       骨格は上と同じ。方針は本人が選んだものではなく事業者側の窓口が
       あることから決まり、account は認証情報ではなく「必要になった
       ときに手元に要るもの」を指す。                                */
    {
      id: 'svc-tepco', no: '007', name: '東京電力エナジーパートナー', category: '電気', group: 'post',
      registered: '2024.05.20', updated: '2024.05.20',
      policy: {
        intent: 'change', intentLabel: '名義変更する',
        reason: '同居の家族が住み続けるため、解約ではなく名義変更します。',
        nextTiming: ''
      },
      account: [
        { label: 'お客様番号',           value: '1234-5678-90',              ok: true, icon: 'doc' },
        { label: '手続き窓口',           value: 'カスタマーセンター 0120-995-113', ok: true, icon: 'phone' },
        { label: '検針票・請求書のありか', value: '自宅・リビングの書類ケース',   ok: true, icon: 'folder' }
      ],
      contract: { holder: '父 太郎', paymentCard: null, paymentLabel: 'ゆうちょ銀行 自動振替', amount: 8500, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
      procedure: {
        checked: true,
        where: '東京電力 カスタマーセンター（電話）',
        steps: ['カスタマーセンターに電話する', 'お客様番号を伝える', '契約者が亡くなったことを伝える', '名義変更または解約を申し込む'],
        link: '東京電力 名義変更・解約の手続き',
        point: '同じ住居に住み続ける場合は、解約ではなく\n名義変更を選びます。'
      },
      memo: ''
    },
    {
      id: 'svc-gas', no: '008', name: '東京ガス', category: 'ガス', group: 'post',
      registered: '2024.05.20', updated: '2024.05.20',
      policy: {
        intent: 'change', intentLabel: '名義変更する',
        reason: '同居の家族が住み続けるため、解約ではなく名義変更します。',
        nextTiming: ''
      },
      account: [
        { label: 'お客様番号',           value: '9012-3456-78',               ok: true, icon: 'doc' },
        { label: '手続き窓口',           value: 'お客さまセンター 0570-002-211', ok: true, icon: 'phone' },
        { label: '検針票・請求書のありか', value: '自宅・リビングの書類ケース',    ok: true, icon: 'folder' }
      ],
      contract: { holder: '父 太郎', paymentCard: null, paymentLabel: 'ゆうちょ銀行 自動振替', amount: 4200, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
      procedure: {
        checked: true,
        where: '東京ガス お客さまセンター（電話）',
        steps: ['お客さまセンターに電話する', 'お客様番号を伝える', '契約者が亡くなったことを伝える', '名義変更または解約を申し込む'],
        link: '東京ガス 名義変更・解約の手続き',
        point: '同じ住居に住み続ける場合は、解約ではなく\n名義変更を選びます。'
      },
      memo: ''
    },
    {
      id: 'svc-water', no: '009', name: '東京都水道局', category: '水道', group: 'post',
      registered: '2024.05.20', updated: '2024.05.20',
      policy: {
        intent: 'change', intentLabel: '使用者を変更する',
        reason: '同居の家族が住み続けるため、使用者の名義を変更します。',
        nextTiming: ''
      },
      account: [
        { label: 'お客様番号',           value: '5647-0192',                  ok: true,  icon: 'doc' },
        { label: '手続き窓口',           value: 'お客さまセンター 03-5326-1100', ok: true,  icon: 'phone' },
        { label: '検針票・請求書のありか', value: '未確認',                       ok: false, icon: 'folder' }
      ],
      contract: { holder: '父 太郎', paymentCard: null, paymentLabel: 'ゆうちょ銀行 自動振替', amount: 3100, cycle: 'monthly', started: '不明', nextBill: '隔月〇日頃' },
      procedure: {
        checked: true,
        where: '東京都水道局 お客さまセンター（電話）',
        steps: ['お客さまセンターに電話する', 'お客様番号を伝える', '使用者の変更を申し込む'],
        link: '東京都水道局 使用者変更の手続き',
        point: '隔月請求のため、契約情報の月額は目安額です。'
      },
      memo: ''
    },
    {
      id: 'svc-docomo', no: '010', name: 'NTTドコモ（携帯電話）', category: '携帯', group: 'post',
      registered: '2024.05.20', updated: '2024.05.20',
      policy: {
        intent: 'cancel',
        reason: '家族が電話番号を引き継ぐ予定はないため、解約します。',
        nextTiming: ''
      },
      account: [
        { label: '契約番号',      value: 'D-88213456',            ok: true,  icon: 'doc' },
        { label: '手続き窓口',    value: 'ドコモショップ（要来店）', ok: true,  icon: 'phone' },
        { label: '本人の端末のありか', value: '未確認',              ok: false, icon: 'folder' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'card-smbc', amount: 6480, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
      procedure: {
        checked: false,
        where: 'ドコモショップ（来店手続き）',
        steps: ['ドコモショップの来店予約をとる', '必要書類を持って来店する', '契約者が亡くなったことを伝える', '解約または承継を申し込む'],
        link: 'ドコモ 契約者死亡時の手続き',
        point: '電話番号を家族が引き継ぐ場合は、解約ではなく\n「承継」の手続きになります。'
      },
      memo: ''
    },
    {
      id: 'svc-sonet', no: '011', name: 'So-net光', category: '通信（固定回線）', group: 'post',
      registered: '2024.05.20', updated: '2024.05.20',
      policy: {
        intent: 'weighing',
        reason: '家族がインターネットを使い続けるかどうかで、名義変更か解約かが変わります。',
        nextTiming: '次回の家族会議'
      },
      account: [
        { label: 'お客様ID',         value: 'SN-2201987',                ok: true, icon: 'doc' },
        { label: '手続き窓口',       value: 'サポートデスク 0120-80-7761', ok: true, icon: 'phone' },
        { label: '契約書類のありか', value: '自宅・リビングの書類ケース',  ok: true, icon: 'folder' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'card-smbc', amount: 5200, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
      procedure: {
        checked: false,
        where: 'So-net サポートデスク（電話）',
        steps: ['サポートデスクに電話する', 'お客様IDを伝える', '契約者が亡くなったことを伝える', '名義変更または解約を申し込む'],
        link: 'So-net 名義変更・退会の手続き',
        point: '回線をそのまま使い続ける場合は、解約ではなく\n名義変更を選びます。'
      },
      memo: ''
    },
    {
      id: 'svc-nhk', no: '012', name: 'NHK受信契約', category: '受信料', group: 'post',
      registered: '2024.05.20', updated: '2024.05.20',
      policy: {
        intent: 'unknown',
        reason: '受信を続けるかどうかで、廃止か名義変更かが変わります。本人にはまだ確認できていません。',
        nextTiming: '次回の帰省時（2024年8月）'
      },
      account: [
        { label: 'お客様番号',           value: '未確認',                     ok: false, icon: 'doc' },
        { label: '手続き窓口',           value: 'ふれあいセンター 0120-151515', ok: true,  icon: 'phone' },
        { label: '検針票・請求書のありか', value: '未確認',                     ok: false, icon: 'folder' }
      ],
      contract: { holder: '父 太郎', paymentCard: null, paymentLabel: 'ゆうちょ銀行 自動振替', amount: 1225, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
      procedure: {
        checked: false,
        where: 'NHK ふれあいセンター（電話）',
        steps: ['ふれあいセンターに電話する', 'お客様番号を伝える', '契約者が亡くなったことを伝える', '廃止または名義変更を申し込む'],
        link: 'NHK 受信契約の住所変更・廃止',
        point: '同じ住居で受信を続ける場合は、廃止ではなく\n名義変更の手続きになります。'
      },
      memo: 'お客様番号がわからないため、まず請求書を探す必要があります。'
    }
  ];

  /* ── 引き出し ─────────────────────────────────────── */

  const byGroup = g => items.filter(it => it.group === g);
  const preItems  = () => byGroup('pre');
  const postItems = () => byGroup('post');

  const intentOf   = it => INTENTS[it.policy.intent];
  const intentLabel = it => it.policy.intentLabel || intentOf(it).label;
  const markOf = name => MARKS[name] || { ch: name.charAt(0), bg: '#eef2f6', fg: '#6b7a89' };

  /* 到達状態。「確認が必要」の残数がそのまま索引のバッジになる。 */
  function openCount(it) {
    return it.account.filter(a => !a.ok).length;
  }

  /* 手続きの手順を家族が確認したか。情報が揃っていても、どこへ
     どう連絡するかを知らなければ実際には動けない。               */
  const procChecked = it => !!it.procedure.checked;

  /* 必要な情報がどこまで揃っているか。全部あれば○、皆無なら✕。 */
  function accountMark(it) {
    const open = openCount(it);
    if (open === 0) return 'ok';
    return open >= it.account.length ? 'none' : 'partial';
  }

  /* 「いまの状況」の3行。画面には帰属（本人／家族）を語として出さず、
     補足文の主語で誰の番かが伝わるようにする。                    */
  function statusRows(it, who) {
    const ui = GROUP_UI[it.group];
    const w = who || '本人';
    const pMark = INTENTS[it.policy.intent].mark;
    const aMark = accountMark(it), open = openCount(it);
    const proc  = procChecked(it);
    return [
      { key: 'policy', title: '対応方針', mark: pMark,
        note: pMark === 'ok'      ? '「' + intentLabel(it) + '」に決めています'
            : pMark === 'partial' ? w + 'が検討中です'
            :                       w + 'にまだ確認できていません' },
      { key: 'account', title: ui.accountTitle, mark: aMark,
        note: aMark === 'ok'      ? '必要なものはそろっています'
            : aMark === 'partial' ? open + '件が未確認です'
            :                       'まだ確認できていません' },
      { key: 'proc', title: '手続き方法', mark: proc ? 'ok' : 'none',
        note: proc ? '家族が手順を確認しました' : '家族が手順を確認していません' }
    ];
  }

  /* 索引とカード上部のバッジ。家族側の軸だけから引く。本人が決めた
     かどうかは、ここには一切混ぜない。欠けているものの数は、必要な
     情報の不足と、手順が未確認であることの合計。未着手＝どちらも
     欠けていて、家族側の準備もまだ何ひとつ動いていない状態。      */
  function itemBadge(it) {
    const ui = GROUP_UI[it.group], open = openCount(it);
    const remain = open + (procChecked(it) ? 0 : 1);
    if (remain === 0) return { kind: 'ready', text: ui.badges.ready, tone: 'gr' };
    return { kind: 'open', text: ui.badges.open, tone: 'or', n: remain };
  }

  function groupSummary(g) {
    let ready = 0, open = 0;
    byGroup(g).forEach(it => {
      const b = itemBadge(it);
      if (b.kind === 'ready') ready++; else open++;
    });
    return { ready, open };
  }

  /* 「対応できるか」のまとめ。必要な情報と手順の両方を見る。
     ひとつでも欠けていれば一部確認が必要。                       */
  function accountSummary(it) {
    const ui = GROUP_UI[it.group];
    const missing = it.account.filter(a => !a.ok).map(a => a.label.replace(/（.*）/, ''));
    if (!procChecked(it)) missing.push('手続き方法');
    if (!missing.length) return { ok: true, title: ui.okTitle, note: ui.okNote };
    return { ok: false, title: '一部確認が必要です', note: missing.join('・') + 'の確認が必要です。' };
  }

  function paymentDisplay(it) {
    const c = it.contract || it;
    if (c.paymentCard) return findCard(c.paymentCard).name;
    return c.paymentLabel;
  }

  function amountText(it) {
    const c = it.contract || it;
    if (!c.paymentCard && c.amount === 0) return '費用なし';
    return yen(c.amount) + (c.cycle === 'yearly' ? '／年' : '／月');
  }

  function findItem(id) { return items.find(it => it.id === id); }
  function findCard(id) { return cards.find(c => c.id === id); }

  function linkedItems(cardId) {
    return items.filter(it => (it.contract ? it.contract.paymentCard : it.paymentCard) === cardId);
  }

  function cardFacts(cardId) {
    const linked = linkedItems(cardId);
    return {
      linked,
      hasPre:  linked.some(it => it.group === 'pre'),
      hasPost: linked.some(it => it.group === 'post')
    };
  }

  function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }

  global.SeiZenContract = {
    INTENTS, MARKS3, GROUP_UI, MARKS, CATEGORIES,
    cards, items,
    byGroup, preItems, postItems,
    intentOf, intentLabel, markOf, openCount, procChecked, accountMark, statusRows,
    itemBadge, groupSummary, accountSummary,
    paymentDisplay, amountText, findItem, findCard, linkedItems, cardFacts,
    yen
  };
})(window);
