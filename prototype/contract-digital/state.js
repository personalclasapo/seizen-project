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
      /* タブに出す短い名。束の耳なので、見出しの言い換えではなく
         時間の軸そのものを名指す。長い語は入らない。            */
      tab: 'いまのうち',
      title: '今のうちに準備が必要',
      lead: 'ご本人が亡くなった後に困らないよう、事前に済ませておくと安心な契約です。',
      badges: { ready: '準備済み', open: '確認が必要', done: '対応完了' },
      accountTitle: 'アカウント情報', accountSub: '（対応可能か）',
      accountLead: '対応可能状態', accountNeed: '対応に必要なもの',
      okTitle: '対応できます', okNote: '必要な情報はそろっています。'
    },
    post: {
      tab: 'そのとき',
      title: '必要になってから対応できる',
      lead: '今すぐの準備は不要です。必要になったときに、各窓口で手続きを行えます。',
      badges: { ready: '準備済み', open: '確認が必要', done: '対応完了' },
      accountTitle: '手続きに必要なもの', accountSub: '（必要時に使えるか）',
      accountLead: '記録の状態', accountNeed: '手続きに必要なもの',
      okTitle: '必要時に対応できます', okNote: '手続きに必要な情報はそろっています。'
    },
    /* どちらの時期で対応すべきか、まだ振り分けていないサービス。追加
       画面で「分からない」を選んだものが入る。対応の時期はサービスの
       性質（事業者側に窓口があるか等）で決まるもので、家族の意思では
       ない。ここは「調べて pre / post のどちらかへ動かす」ための一時
       置き場なので、pre/post の上に全幅で置き、中の進捗（準備済み等）は
       集計しない。中身が空になったら束ごと消える（render 側）。       */
    undecided: {
      tab: '振り分け前',
      title: '対応時期をまだ確認していないサービス',
      lead: '「今のうちに準備が必要」か「必要になってから対応できる」か、どちらで対応すべきかをまだ確認できていないサービスです。調べたうえで、いずれかに振り分けてください。',
      badges: { ready: '準備済み', open: '確認が必要', done: '対応完了' },
      accountTitle: 'アカウント情報', accountSub: '（対応可能か）',
      accountLead: '対応可能状態', accountNeed: '対応に必要なもの',
      okTitle: '対応できます', okNote: '必要な情報はそろっています。'
    },
    /* 支払いカードは索引の対応タイミングには乗らないが、詳細の骨格は
       契約・アカウントと丸ごと同じにする。「いまの状況」の行見出しと
       バッジの言い回しだけ、ここから引く。                          */
    card: {
      accountTitle: 'アカウント情報',
      badges: { ready: '準備済み', open: '確認が必要', done: '対応完了' }
    }
  };

  /* 実ロゴが確認できるブランドだけ、catalog.js の LOGOS（パスデータ）を
     モノクロで流用する。ブランドカラーでは塗らず、頭文字マークと同じ
     地色・同じインク色に揃えるので、実ロゴの有無で見た目の重さが
     変わらない。ロゴを持たないブランド（地域の電力・ガス・水道など、
     正確な意匠を確認できないもの）は、従来どおり頭文字マークのまま。 */
  const LOGO_ALIAS = {
    'Googleアカウント（メール・写真）': 'google',
    'Google One（100GB）':           'google',
    'iCloud+（200GB）':              'apple',
    'Amazonプライム':                'amazon'
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

  /* ── 事実：カード（支払いの経路） ─────────────────── */

  /* カードの詳細は、契約・アカウントと丸ごと同じ骨格（対応方針／
     アカウント情報／手続き方法／カード情報／メモ）を持つ。対応方針の
     intent は INTENTS をそのまま流用する（このカードを継続して使うか、
     他へ切り替えるか、解約するか、という家族側の判断）。契約情報に
     あたる部分は他カードへの支払いを持たないので「カード情報」という
     別の中身に置き換え、連絡先は手続き方法の「手続き先」に一本化して
     二重に持たない。                                                */
  /* ── 事実：支払い手段 ─────────────────────────────────
     本番では「支払い手段マスタ」（カード・口座・電子マネーを扱う共有
     データ。契約・デジタルの外）が持つもの。この画面はそれを参照し、
     書き戻すのは statement_checked（明細確認の記録）だけ。プロトタイプ
     では state.js がその写しを持つ。

       kind … 'card' | 'bank' | 'emoney'（見た目と手続き文面の出し分け）
       statement_checked … 「支払い明細から探す」で明細を確認した記録。
         { at: 'YYYY.MM.DD', ranges: [{ from, to }, …] } | null
         ranges は確認済みの期間（ISO 'YYYY-MM-DD'、from 昇順）。取り込む
         たびに新しい期間を足し、重なる／隙間が1か月以内のものだけ1本に
         まとめる。飛んだ期間はそのまま複数レンジで残す（部分確認を
         正確に表す）。旧 { coverage_from, coverage_to } は読み込み時に
         ranges 1本へ変換する（migrateStatementChecked）。
     旧名は cards。card 以外も入るので paymentMethods に改称。
     後方互換のため cards エイリアス（kind==='card' のみ）も残す。 */
  const paymentMethods = [
    { id: 'card-rakuten', name: '楽天カード',
      kind: 'card', group: 'card',
      /* 券面の地の色。実ロゴは使わないので、色だけで見分ける。 */
      brand: 'rakuten',
      /* 明細CSVの取り込みに対応しているか（§15-4）。カード明細は
         会社を問わず汎用アダプタ（statement-csv.js）が列を推定して
         読むので 'card_csv'。銀行口座・電子マネーは明細の構造が違う
         ため null（未対応）。会社ごとの区別は持たない。 */
      statement_format: 'card_csv',
      statement_checked: null,
      policy: {
        intent: 'continue',
        reason: '複数の契約の支払いに使っているため、当面はこのカードのまま使い続けます。',
        nextTiming: ''
      },
      account: [
        { label: 'カード本体',           value: '保管場所：自宅・本人の財布', state: 'ok',   icon: 'card' },
        { label: '暗証番号',             value: '',      state: 'none', icon: 'user' },
        { label: 'ネット明細のログイン', value: '',      state: 'none', icon: 'mail' }
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
      kind: 'card', group: 'card',
      brand: 'smbc',
      statement_format: 'card_csv',
      statement_checked: null,
      policy: {
        intent: 'unknown',
        reason: '',
        nextTiming: ''
      },
      account: [
        { label: 'カード本体',           value: '', state: 'none', icon: 'card' },
        { label: '暗証番号',             value: '', state: 'none', icon: 'user' },
        { label: 'ネット明細のログイン', value: '', state: 'none', icon: 'mail' }
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
    },
    { id: 'bank-jp-1', name: 'ゆうちょ銀行　通常貯金',
      kind: 'bank', group: 'bank',
      brand: 'bank',
      /* 銀行の入出金明細は入金/出金の2列構造でカード明細と形が違う。
         汎用アダプタ（カード明細向け）では読めないので未対応（§15-4）。 */
      statement_format: null,
      statement_checked: null,
      /* 口座は「止める」対象ではなく「相続手続きで凍結・名義変更される」
         もの。引き落とし契約は口座凍結の前に支払い方法を移す必要がある。 */
      policy: { intent: 'unknown', reason: '', nextTiming: '' },
      account: [
        { label: '通帳・キャッシュカード', value: '保管場所：自宅・本人の机', state: 'ok',   icon: 'card' },
        { label: '暗証番号',               value: '',                       state: 'none', icon: 'user' },
        { label: 'ネットバンキングのログイン', value: '',                   state: 'none', icon: 'mail' }
      ],
      info: { issuer: 'ゆうちょ銀行', holder: '父 太郎', tail: '5678', branch: '記号 10000 / 番号 12345678' },
      procedure: {
        checked: false,
        where: 'ゆうちょ銀行の窓口（相続手続き）',
        steps: ['ゆうちょ銀行に口座名義人が亡くなったことを伝える', '相続手続きの必要書類を確認する', '自動振替になっている契約の支払い方法を先に移す', '相続手続き（払い戻し・名義変更）を進める'],
        link: 'ゆうちょ銀行 相続手続きのご案内',
        point: '口座が凍結されると、自動振替の支払いが止まります。\n公共料金などは先に支払い方法を切り替えます。'
      },
      memo: ''
    },
    { id: 'emoney-1', name: 'PayPay',
      kind: 'emoney', group: 'emoney',
      brand: 'paypay',
      statement_format: null,   /* PayPay の取引履歴形式は未対応 */
      statement_checked: null,
      policy: { intent: 'unknown', reason: '', nextTiming: '' },
      account: [
        { label: 'アプリのログイン', value: '', state: 'none', icon: 'phone' },
        { label: '登録の携帯番号',   value: '090-****-**12', state: 'ok', icon: 'user' },
        { label: '本人確認の状況',   value: '', state: 'none', icon: 'doc' }
      ],
      info: { issuer: 'PayPay株式会社', holder: '父 太郎', tail: '**12' },
      procedure: {
        checked: false,
        where: 'PayPay カスタマーサポート',
        steps: ['PayPay に利用者が亡くなったことを伝える', '残高の相続・払い戻しの可否を確認する', '定期支払いに使っている契約があれば支払い方法を移す'],
        link: 'PayPay 利用者が亡くなった場合',
        point: '残高の扱いは事業者ごとに異なります。まず問い合わせて確認します。'
      },
      memo: ''
    }
  ];
  /* 後方互換：card だけを見たい既存呼び出し向け。 */
  const cards = paymentMethods;

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
        { label: 'ログインID / パスワード', value: '保管場所：書類ケース「デジタル情報」', state: 'ok',   icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro***@gmail.com（父スマホ）',        state: 'ok',   icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '父のスマートフォン',                   state: 'none', icon: 'phone' }
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
        { label: 'ログインID / パスワード', value: '保管場所：書類ケース「デジタル情報」', state: 'ok', icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro***@gmail.com（父スマホ）',        state: 'ok', icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '',                                    state: 'na', icon: 'phone' }
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
        { label: 'ログインID / パスワード', value: '保管場所：書類ケース「デジタル情報」', state: 'ok',   icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro***@gmail.com（父スマホ）',        state: 'ok',   icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '父のスマートフォン',                   state: 'none', icon: 'phone' }
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
        { label: 'ログインID / パスワード', value: '',                                     state: 'none', icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro.terasun@gmail.com',              state: 'ok',   icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '父のスマートフォン',                   state: 'none', icon: 'phone' }
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
        { label: 'ログインID / パスワード', value: '保管場所：書類ケース「デジタル情報」', state: 'ok', icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro.terasun@icloud.com',             state: 'ok', icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '父のスマートフォン・iPad',             state: 'ok', icon: 'phone' }
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
        { label: 'ログインID / パスワード', value: '',                          state: 'none', icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro.terasun@gmail.com',    state: 'ok',   icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '',                          state: 'none', icon: 'phone' }
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

    /* --- サンプル：一覧が6件を超えたときの「＋N件を見る」確認用 ---
       登録機能がまだないため、確認が必要／準備済み／対応完了が
       それぞれ揃うよう3件を仮に足しておく。実装が済んだら削除してよい。 */
    {
      id: 'svc-hulu', no: '013', name: 'Hulu', category: '動画配信', group: 'pre',
      registered: '2024.06.02', updated: '2024.06.02',
      policy: {
        intent: 'unknown',
        reason: '',
        nextTiming: ''
      },
      account: [
        { label: 'ログインID / パスワード', value: '',    state: 'none', icon: 'user' },
        { label: '登録メールアドレス',      value: '',    state: 'none', icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '',    state: 'none', icon: 'phone' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'card-rakuten', amount: 1026, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
      procedure: {
        checked: false,
        where: 'Hulu ＞ アカウント ＞ 契約内容の確認・解約',
        steps: ['Huluにログインする', '「アカウント」を開く', '「契約内容の確認・解約」を選択', '解約手続きを進める'],
        link: 'Hulu 解約方法ヘルプ',
        point: ''
      },
      memo: ''
    },
    {
      id: 'svc-dropbox', no: '014', name: 'Dropbox', category: 'クラウド保存', group: 'pre',
      registered: '2024.06.02', updated: '2024.06.02',
      policy: {
        intent: 'continue',
        reason: '仕事の資料の保存に使っているため、当面は継続します。',
        nextTiming: ''
      },
      account: [
        { label: 'ログインID / パスワード', value: '保管場所：書類ケース「デジタル情報」', state: 'ok', icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro.terasun@gmail.com',             state: 'ok', icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '父のスマートフォン',                  state: 'ok', icon: 'phone' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'card-smbc', amount: 1500, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
      procedure: {
        checked: true,
        where: 'Dropbox ＞ 設定 ＞ プラン',
        steps: ['Dropboxにログインする', '設定の「プラン」を開く', '「プランを変更」から解約する'],
        link: 'Dropbox 解約方法ヘルプ',
        point: ''
      },
      memo: ''
    },
    {
      id: 'svc-disneyplus', no: '015', name: 'Disney+', category: '動画配信', group: 'pre',
      registered: '2024.06.02', updated: '2024.06.02',
      policy: {
        intent: 'cancel',
        reason: 'ほとんど利用していないため解約します。',
        nextTiming: ''
      },
      account: [
        { label: 'ログインID / パスワード', value: '保管場所：書類ケース「デジタル情報」', state: 'ok', icon: 'user' },
        { label: '登録メールアドレス',      value: 'taro.terasun@gmail.com',             state: 'ok', icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '',                                    state: 'na',   icon: 'phone' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'card-rakuten', amount: 990, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
      procedure: {
        checked: true,
        where: 'Disney+ ＞ アカウント ＞ サブスクリプション',
        steps: ['Disney+にログインする', '「アカウント」を開く', '「サブスクリプション」から解約する'],
        link: 'Disney+ 解約方法ヘルプ',
        point: ''
      },
      memo: '解約済み（2024年6月に手続き完了）。',
      completed: true
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
        { label: 'お客様番号',           value: '1234-5678-90',              state: 'ok', icon: 'doc' },
        { label: '手続き窓口',           value: 'カスタマーセンター 0120-995-113', state: 'ok', icon: 'phone' },
        { label: '検針票・請求書のありか', value: '自宅・リビングの書類ケース',   state: 'ok', icon: 'folder' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'bank-jp-1', paymentLabel: 'ゆうちょ銀行 自動振替', amount: 8500, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
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
        { label: 'お客様番号',           value: '9012-3456-78',               state: 'ok', icon: 'doc' },
        { label: '手続き窓口',           value: 'お客さまセンター 0570-002-211', state: 'ok', icon: 'phone' },
        { label: '検針票・請求書のありか', value: '自宅・リビングの書類ケース',    state: 'ok', icon: 'folder' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'bank-jp-1', paymentLabel: 'ゆうちょ銀行 自動振替', amount: 4200, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
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
        { label: 'お客様番号',           value: '5647-0192',                  state: 'ok',   icon: 'doc' },
        { label: '手続き窓口',           value: 'お客さまセンター 03-5326-1100', state: 'ok',   icon: 'phone' },
        { label: '検針票・請求書のありか', value: '',                            state: 'none', icon: 'folder' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'bank-jp-1', paymentLabel: 'ゆうちょ銀行 自動振替', amount: 3100, cycle: 'monthly', started: '不明', nextBill: '隔月〇日頃' },
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
        { label: '契約番号',      value: 'D-88213456',            state: 'ok',   icon: 'doc' },
        { label: '手続き窓口',    value: 'ドコモショップ（要来店）', state: 'ok',   icon: 'phone' },
        { label: '本人の端末のありか', value: '',                    state: 'none', icon: 'folder' }
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
        { label: 'お客様ID',         value: 'SN-2201987',                state: 'ok', icon: 'doc' },
        { label: '手続き窓口',       value: 'サポートデスク 0120-80-7761', state: 'ok', icon: 'phone' },
        { label: '契約書類のありか', value: '自宅・リビングの書類ケース',  state: 'ok', icon: 'folder' }
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
        { label: 'お客様番号',           value: '',                           state: 'none', icon: 'doc' },
        { label: '手続き窓口',           value: 'ふれあいセンター 0120-151515', state: 'ok',   icon: 'phone' },
        { label: '検針票・請求書のありか', value: '',                           state: 'none', icon: 'folder' }
      ],
      contract: { holder: '父 太郎', paymentCard: 'bank-jp-1', paymentLabel: 'ゆうちょ銀行 自動振替', amount: 1225, cycle: 'monthly', started: '不明', nextBill: '毎月〇日頃' },
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

  /* ── 永続化（本番の構造に寄せる） ───────────────────────
     本番では：
       ・マスタ（契約カタログ・支払い手段マスタ・手続き情報）はサーバの
         DB。フロントは毎回 GET で取得し、コピーを永続化しない。
       ・ユーザーのデータ（登録した契約・入力した対応方針やアカウント
         情報・明細の確認記録）はサーバの DB。POST/PATCH で書く。
       ・フロントの状態はキャッシュ。リロードすればサーバから最新を取る
         ので、マスタの更新（列の追加・文言の変更）は次のリロードで
         自然に反映される。

     プロトタイプでこれを写すと：
       ・seed（上の const items / paymentMethods）＝「サーバのマスタ＋
         工場出荷データ」。**保存しない。** 常にコードから読むので、
         seed を変えればリロードで即反映される（本番と同じ挙動）。
       ・保存するのは「本番でサーバに POST するもの」だけ：
           - ユーザーが追加した契約（items のうち added:true）
           - seed の契約への編集（対応方針・アカウント情報・手続き・
             メモ・名前・カテゴリ・時期）を、id ごとに変更フィールド
             だけ
           - 明細の確認記録（paymentMethod id → { at, from, to }）
           - ユーザーが追加した支払い手段（稀）
       ・置き場は sessionStorage の1キー（本番の DB 相当）。タブを
         閉じたら工場出荷に戻る（検証のたびに resetAll() 不要）。

     この形なら、seed のスキーマを変えても保存とぶつからない（seed は
     常に最新、保存は既知の編集フィールドだけを seed の上に重ねる）。 */
  const STORE_KEY = 'seizen.contract.v2';   /* v1 は seed 丸ごと保存。互換なし。 */

  /* ユーザーが編集できる item のフィールド。保存はこれだけを id ごとに
     持ち、ロード時に seed の item へ重ねる。ここに無いフィールド
     （手続きの steps 本文・カテゴリ既定値など seed 由来のもの）は
     常にコードが正。 */
  const ITEM_EDITABLE = ['name', 'category', 'group', 'policy', 'account', 'procedure', 'contract', 'memo', 'updated'];
  /* 支払い手段側で保存する編集。 */
  const METHOD_EDITABLE = ['statement_checked', 'policy', 'account', 'procedure', 'info', 'memo', 'updated'];

  /* 追加サービスの id を1つ作る。時刻＋乱数で、採番順に依存しない。 */
  function newServiceId() {
    return 'svc-added-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 7);
  }

  /* 通し番号（No.）。人が見る番号で、id とは別。本番ではサーバが登録
     を受け付けた順に1回だけ振る値なので、プロトタイプでも採番は
     commitAdded の中（＝サーバ役）だけで行い、他では生成しない。
     一度振った番号は動かさない（削除で欠番が出るのは正常）。       */
  const NO_START = (function () {
    const max = items.reduce((m, it) => {
      const n = parseInt(it.no, 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return max + 1;
  })();
  let nextNo = NO_START;
  const padNo = n => String(n).padStart(3, '0');

  /* 追加サービス1件のひな形。名前・カテゴリ・時期・id・no を受け取り、
     詳細画面の骨格が壊れないよう残りを未記入で埋める。              */
  function buildAddedItem(rec) {
    const g = rec.group === 'pre' || rec.group === 'post' ? rec.group : 'undecided';
    const day = rec.added || today();
    return {
      id: rec.id || newServiceId(),
      no: rec.no || '—',
      name: String(rec.name).trim(),
      category: rec.category || '未分類',
      group: g,
      added: true,               /* 追加分の目印。索引のハイライト・削除口に使う */
      registered: day, updated: day,
      policy: { intent: 'unknown', reason: '', nextTiming: '' },
      account: [
        { label: 'ログインID / パスワード', value: '', state: 'none', icon: 'user' },
        { label: '登録メールアドレス',      value: '', state: 'none', icon: 'mail' },
        { label: '認証端末（2段階認証）',    value: '', state: 'none', icon: 'phone' }
      ],
      contract: { holder: '', paymentCard: null, amount: null, cycle: 'monthly', started: '', nextBill: '' },
      procedure: { checked: false, where: '', steps: [], link: '', point: '' },
      memo: ''
    };
  }

  /* seed のスナップショット（工場出荷そのまま）。編集の差分計算と、
     ロード時の再構築の土台にする。以後 items / paymentMethods 本体を
     いじってもこちらは動かない。 */
  const SEED_ITEMS = JSON.parse(JSON.stringify(items));
  const SEED_METHODS = JSON.parse(JSON.stringify(paymentMethods));
  const seedItemById = {};   SEED_ITEMS.forEach(it => { seedItemById[it.id] = it; });
  const seedMethodById = {}; SEED_METHODS.forEach(m => { seedMethodById[m.id] = m; });

  const jsonEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* entity の editable フィールドのうち、seed と違うものだけ抜き出す。 */
  function editDiff(entity, seed, fields) {
    if (!seed) return null;
    const d = {};
    let any = false;
    fields.forEach(f => {
      if (!jsonEq(entity[f], seed[f])) { d[f] = entity[f]; any = true; }
    });
    return any ? d : null;
  }

  /* 保存：本番でサーバに POST するものだけ。seed は保存しない。 */
  function save() {
    try {
      const addedItems = items.filter(it => it.added);
      const itemEdits = {};
      items.forEach(it => {
        if (it.added) return;                         /* 追加分は上で丸ごと持つ */
        const d = editDiff(it, seedItemById[it.id], ITEM_EDITABLE);
        if (d) itemEdits[it.id] = d;
      });
      const addedMethods = paymentMethods.filter(m => !seedMethodById[m.id]);
      const methodEdits = {};
      paymentMethods.forEach(m => {
        if (!seedMethodById[m.id]) return;
        const d = editDiff(m, seedMethodById[m.id], METHOD_EDITABLE);
        if (d) methodEdits[m.id] = d;
      });

      sessionStorage.setItem(STORE_KEY, JSON.stringify({
        v: 2, nextNo: nextNo,
        addedItems: addedItems,
        itemEdits: itemEdits,
        addedMethods: addedMethods,
        methodEdits: methodEdits
      }));
    } catch (e) { /* 無視 */ }
  }

  /* 読み込み：items / paymentMethods を seed から作り直し（＝コードが
     常に最新）、保存済みのユーザーデータ（追加分・編集差分）を重ねる。
     配列そのものは作り直さない（外へ渡した参照を保つ）。            */
  (function loadStore() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 無視 */ }
    try { sessionStorage.removeItem('seizen.contract.v1'); } catch (e) { /* v1 掃除 */ }

    let patch = null;
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      const obj = raw ? JSON.parse(raw) : null;
      if (obj && obj.v === 2) patch = obj;
    } catch (e) { patch = null; }

    /* items：seed（fresh）＋ 編集差分 ＋ 追加分 */
    const rebuiltItems = SEED_ITEMS.map(seed => {
      const base = JSON.parse(JSON.stringify(seed));
      const d = patch && patch.itemEdits && patch.itemEdits[seed.id];
      return d ? Object.assign(base, d) : base;
    });
    if (patch && Array.isArray(patch.addedItems)) {
      patch.addedItems.forEach(it => rebuiltItems.push(it));
    }
    items.splice(0, items.length, ...rebuiltItems);

    /* paymentMethods：seed（fresh）＋ 編集差分 ＋ 追加分 */
    const rebuiltMethods = SEED_METHODS.map(seed => {
      const base = JSON.parse(JSON.stringify(seed));
      const d = patch && patch.methodEdits && patch.methodEdits[seed.id];
      return d ? Object.assign(base, d) : base;
    });
    if (patch && Array.isArray(patch.addedMethods)) {
      patch.addedMethods.forEach(m => rebuiltMethods.push(m));
    }
    paymentMethods.splice(0, paymentMethods.length, ...rebuiltMethods);

    const savedNo = patch && parseInt(patch.nextNo, 10);
    nextNo = (savedNo && savedNo >= NO_START) ? savedNo : items.reduce((m, it) => {
      const n = parseInt(it.no, 10);
      return isNaN(n) ? m : Math.max(m, n + 1);
    }, NO_START);

    if (!patch) { save(); return; }

    /* 移行：No. 採番前に追加したサービスは no が '—'。登録日の古い順に
       振り直して1回だけ保存し直す。 */
    const unnumbered = items.filter(it => it.added && (!it.no || it.no === '—'));
    if (unnumbered.length) {
      unnumbered
        .sort((a, b) => String(a.registered).localeCompare(String(b.registered)))
        .forEach(it => { it.no = padNo(nextNo++); });
      save();
    }
  })();

  /* 既に一覧にある名前か。追加画面の「登録済み」判定と、確定時の
     二重登録の歯止めに使う（同一性の基準ではない。あくまで入力の
     うっかりを弾くための名前一致）。                                */
  function hasService(name) {
    const n = String(name).trim().toLowerCase();
    return items.some(it => it.name.trim().toLowerCase() === n);
  }

  /* 確認画面から呼ぶ。records は [{ name, group, category }]。
     名前が既存と重複するものは skipped に回す。追加できたものは
     その場で id を確定し、items へ足して保存する。                  */
  function commitAdded(records) {
    const seen = new Set(items.map(it => it.name.trim().toLowerCase()));
    const added = [], skipped = [];
    records.forEach(rec => {
      const name = String(rec.name).trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) { skipped.push(rec.name); return; }
      seen.add(key);
      /* No. はここ（サーバ役）で1回だけ確定し、以後は動かさない。 */
      items.push(buildAddedItem({
        name: name, group: rec.group, category: rec.category || '未分類',
        added: today(), no: padNo(nextNo++)
      }));
      added.push(name);
    });
    if (added.length) save();
    return { added, skipped };
  }

  /* 「支払い明細から探す」からの登録。records は
       [{ name, group, category, domain, service_id,
          contract: { holder, amount, cycle, amount_is_fixed,
                      first_seen, last_seen, paymentCard } }]
     commitAdded と別口にしているのは、明細由来の契約情報（金額・周期・
     初回/最終出現日・契約者名義・支払いカード）をひな形へ流し込むため
     （§13-1）。id は service_id が来ればそれを使い（既存カタログと
     同一性をそろえる）、無ければ採番する。名前重複は skipped。       */
  function commitFromStatement(records) {
    const seen = new Set(items.map(it => it.name.trim().toLowerCase()));
    const seenId = new Set(items.map(it => it.id));
    const added = [], skipped = [];
    (records || []).forEach(rec => {
      const name = String(rec.name || '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) { skipped.push(rec.name); return; }
      const id = (rec.service_id && !seenId.has(rec.service_id)) ? rec.service_id : newServiceId();
      seen.add(key); seenId.add(id);

      const base = buildAddedItem({
        id: id,
        name: name,
        group: rec.group,
        category: rec.category || '未分類',
        added: today(),
        no: padNo(nextNo++)
      });
      const c = rec.contract || {};
      base.contract = {
        holder: c.holder || '',
        paymentCard: c.paymentCard || null,
        amount: (c.amount == null ? null : c.amount),
        cycle: c.cycle || 'monthly',
        amount_is_fixed: c.amount_is_fixed !== false,
        started: c.first_seen || '不明',
        nextBill: '',
        first_seen: c.first_seen || null,
        last_seen: c.last_seen || null,
        source: 'statement'
      };
      if (rec.domain) base.domain = rec.domain;
      if (rec.plan_id) base.plan_id = rec.plan_id;  /* 判定したプランの記録（表示には使わない） */
      items.push(base);
      added.push(name);
    });
    if (added.length) save();
    return { added, skipped };
  }

  /* 「支払い明細から探す」§13-2：同一サービスが別の支払い手段で
     既登録だったとき、既存エントリの支払い手段を上書きする（履歴は
     作らない）。id または名前一致で既存を引く。更新できたら true。  */
  function applyPaymentMethodChange(rec) {
    const byId = rec.service_id ? items.find(it => it.id === rec.service_id) : null;
    const byName = byId || items.find(it =>
      it.name.trim().toLowerCase() === String(rec.name || '').trim().toLowerCase());
    const it = byId || byName;
    if (!it) return false;
    it.contract = it.contract || {};
    const c = rec.contract || {};
    it.contract.paymentCard = c.paymentCard || null;
    it.contract.paymentLabel = c.paymentCard ? '' : (c.paymentLabel || it.contract.paymentLabel);
    if (c.holder) it.contract.holder = c.holder;
    touch(it);
    return true;
  }

  /* 追加したサービス1件を取り消す。詳細画面の削除ボタンから呼ぶ。
     seed のサービス（it.added が無い）は対象外。                    */
  function removeAdded(id) {
    const idx = items.findIndex(x => x.id === id && x.added);
    if (idx === -1) return false;
    items.splice(idx, 1);
    save();
    return true;
  }

  /* サービスの名前・カテゴリを書き換える。詳細画面のインライン編集
     から呼ぶ。id で引くので、名前が変わっても同じサービスのまま。
     seed のサービスも対象（保存は editDiff が id ごとに差分を持つ）。
     値が変わったときだけ true。                                      */
  function renameService(id, patch) {
    const it = items.find(x => x.id === id);
    if (!it) return false;
    let changed = false;
    if (patch && 'name' in patch) {
      const v = String(patch.name).trim();
      if (v && v !== it.name) { it.name = v; changed = true; }
    }
    if (patch && 'category' in patch) {
      const v = String(patch.category).trim() || '未分類';
      if (v !== it.category) { it.category = v; changed = true; }
    }
    if (changed) touch(it);
    return changed;
  }

  /* 振り分け前のサービスを「いまのうち（pre）」「そのとき（post）」の
     いずれかへ動かす。詳細画面の振り分けカードから呼ぶ。            */
  function setGroup(id, group) {
    if (group !== 'pre' && group !== 'post') return false;
    const it = items.find(x => x.id === id);
    if (!it || it.group === group) return false;
    it.group = group;
    touch(it);
    return true;
  }

  /* デモをまっさらに戻す。コンソールから SeiZen…resetAll() してリロード。
     保存（ユーザーデータ）を消すだけ。次のロードは seed（工場出荷）。 */
  function resetAll() {
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* 無視 */ }
    try { sessionStorage.removeItem('seizen.contract.v1'); } catch (e) { /* 無視 */ }
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 無視 */ }
    /* いま画面に出ている配列も seed に戻す（リロード前でも整合させる）。 */
    items.splice(0, items.length, ...JSON.parse(JSON.stringify(SEED_ITEMS)));
    paymentMethods.splice(0, paymentMethods.length, ...JSON.parse(JSON.stringify(SEED_METHODS)));
  }

  /* テスト・デモ用：明細確認の記録だけ消す。 */
  function clearStatementChecks() {
    paymentMethods.forEach(pm => { pm.statement_checked = null; });
    save();
  }

  /* ── 引き出し ─────────────────────────────────────── */

  const byGroup = g => items.filter(it => it.group === g);
  const preItems  = () => byGroup('pre');
  const postItems = () => byGroup('post');
  const undecidedItems = () => byGroup('undecided');

  const intentOf   = it => INTENTS[it.policy.intent];
  const intentLabel = it => it.policy.intentLabel || intentOf(it).label;
  const markOf = name => {
    const alias = LOGO_ALIAS[name];
    const logo = alias && global.SeiZenCatalog && global.SeiZenCatalog.LOGOS[alias];
    if (logo) return { logo: logo.path, bg: '#eef2f6', fg: '#6b7a89' };
    return MARKS[name] || { ch: name.charAt(0), bg: '#eef2f6', fg: '#6b7a89' };
  };

  /* account 行の状態は3段階。ok＝確認済み、na＝そもそも設定・該当が
     ない（2段階認証を設定していない、など）、none＝未確認。
     na は ok と同じく対応完了として数えるが、バッジの言い回しは
     分けるので、ここでは真偽ではなく値そのものを返す。            */
  const accountState = a => a.state || (a.ok ? 'ok' : 'none');
  const accountDone  = a => accountState(a) !== 'none';

  /* 到達状態。「確認が必要」の残数がそのまま索引のバッジになる。 */
  function openCount(it) {
    return it.account.filter(a => !accountDone(a)).length;
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
     欠けていて、家族側の準備もまだ何ひとつ動いていない状態。

     「準備済み」は必要な情報がそろっただけで、まだ実際に対応した
     わけではない。索引を薄めて沈めるのは、対応が完了した（it.completed）
     ときだけにする。completed は準備済みのときだけ詳細画面から
     手で切り替える、取り消し可能なフラグ（家族側の3値とは別の軸）。 */
  function itemBadge(it) {
    const ui = GROUP_UI[it.group], open = openCount(it);
    const remain = open + (procChecked(it) ? 0 : 1);
    if (it.completed) return { kind: 'done', text: ui.badges.done, tone: 'gy' };
    if (remain === 0) return { kind: 'ready', text: ui.badges.ready, tone: 'gr' };
    return { kind: 'open', text: ui.badges.open, tone: 'or', n: remain };
  }

  function groupSummary(g) {
    let ready = 0, open = 0, done = 0;
    byGroup(g).forEach(it => {
      const b = itemBadge(it);
      if (b.kind === 'ready') ready++;
      else if (b.kind === 'done') done++;
      else open++;
    });
    return { ready, open, done };
  }

  /* 「対応できるか」のまとめ。必要な情報と手順の両方を見る。
     ひとつでも欠けていれば一部確認が必要。                       */
  function accountSummary(it) {
    const ui = GROUP_UI[it.group];
    const missing = it.account.filter(a => !accountDone(a)).map(a => a.label.replace(/（.*）/, ''));
    if (!procChecked(it)) missing.push('手続き方法');
    if (!missing.length) return { ok: true, title: ui.okTitle, note: ui.okNote };
    return { ok: false, title: '一部確認が必要です', note: missing.join('・') + 'の確認が必要です。' };
  }

  function paymentDisplay(it) {
    const c = it.contract || it;
    if (c.paymentCard) {
      const pm = findCard(c.paymentCard);
      if (pm) return pm.name;
      /* 参照先の支払い手段が無い（旧スキーマからの読み込み等）。
         ラベルがあればそれ、無ければ未確認。 */
    }
    return c.paymentLabel || '未確認';
  }

  function amountText(it) {
    const c = it.contract || it;
    if (c.amount == null) return '未確認';
    if (!c.paymentCard && c.amount === 0) return '費用なし';
    return yen(c.amount) + (c.cycle === 'yearly' ? '／年' : '／月');
  }

  function findItem(id) { return items.find(it => it.id === id); }
  /* findCard は名前だけ従来通り。card 以外の支払い手段も引ける。 */
  function findCard(id) { return paymentMethods.find(c => c.id === id); }
  function findPaymentMethod(id) { return paymentMethods.find(c => c.id === id); }

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

  /* ── 明細確認の記録（期間の累積）───────────────────────
     ranges は確認済み期間の配列（ISO 'YYYY-MM-DD'、from 昇順）。取り込む
     たびに新しい期間を addRange で足し、重なる／隙間が1か月（31日）以内
     の区間だけ1本にまとめる。飛んだ期間は複数レンジのまま残す。       */

  const MS_DAY = 86400000;
  function isoToTime(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }

  /* 旧スキーマ { coverage_from, coverage_to } を { ranges: [...] } へ。
     すでに ranges を持つものはそのまま返す。                        */
  function migrateStatementChecked(sc) {
    if (!sc) return null;
    if (Array.isArray(sc.ranges)) return sc;
    const from = sc.coverage_from || null, to = sc.coverage_to || null;
    return {
      at: sc.at || null,
      ranges: (from && to) ? [{ from: from, to: to }] : []
    };
  }

  /* 既存 ranges に1区間を足し、重なり／近接（隙間31日以内）を統合する。 */
  function addRange(ranges, from, to) {
    const list = (ranges || []).slice();
    if (from && to) list.push({ from: from, to: to });
    const valid = list
      .filter(r => isFinite(isoToTime(r.from)) && isFinite(isoToTime(r.to)))
      .sort((a, b) => isoToTime(a.from) - isoToTime(b.from));
    const merged = [];
    valid.forEach(r => {
      const last = merged[merged.length - 1];
      if (last && isoToTime(r.from) <= isoToTime(last.to) + 31 * MS_DAY) {
        if (isoToTime(r.to) > isoToTime(last.to)) last.to = r.to;
      } else {
        merged.push({ from: r.from, to: r.to });
      }
    });
    return merged;
  }

  /* 「支払い明細から探す」で、その支払い手段の明細を確認し終えたときに
     呼ぶ（§13 末尾・§2 の網羅の進捗）。本番は
     POST /payment-methods/:id/statement-check にあたる。
     coverage は今回確認した明細の対象期間（{ from, to }・省略可）。
     既存の確認済み期間へ足し込む（上書きしない）。                   */
  function markStatementChecked(id, coverage) {
    const pm = findPaymentMethod(id);
    if (!pm) return false;
    const prev = migrateStatementChecked(pm.statement_checked);
    const from = (coverage && coverage.from) || null;
    const to   = (coverage && coverage.to)   || null;
    pm.statement_checked = {
      at: today(),
      ranges: addRange(prev ? prev.ranges : [], from, to)
    };
    save();
    return true;
  }

  /* バッジ用の和文表記。確認済みの全区間を並べる。
       1区間・同年 : '2026年 3月〜8月'
       複数区間     : '2026年 3月〜5月・9月〜11月'
       年をまたぐ   : '2025年12月〜2026年2月'
     区間が無ければ空文字。                                          */
  function statementCoverageText(sc) {
    const s = migrateStatementChecked(sc);
    if (!s || !s.ranges.length) return '';
    const parts = [];
    let lastYear = null;
    s.ranges.forEach(r => {
      const a = /^(\d{4})-(\d{2})-/.exec(r.from);
      const b = /^(\d{4})-(\d{2})-/.exec(r.to);
      if (!a || !b) return;
      const y1 = +a[1], m1 = +a[2], y2 = +b[1], m2 = +b[2];
      let seg;
      if (y1 === y2) {
        const head = (y1 === lastYear) ? '' : y1 + '年 ';
        seg = head + m1 + '月' + (m1 === m2 ? '' : '〜' + m2 + '月');
        lastYear = y1;
      } else {
        seg = y1 + '年' + m1 + '月〜' + y2 + '年' + m2 + '月';
        lastYear = y2;
      }
      parts.push(seg);
    });
    return parts.join('・');
  }

  function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }

  /* 詳細画面で値を書き換えたら、その項目の「最終更新日」を今日にそろえる。
     綴じ代（rmeta）の表示は registered / updated をそのまま出しているので、
     seed と同じドット区切りの日付に整える。                          */
  function today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }

  /* 契約・カードのどちらにも updated を持たせ、変更のたびにここを通す。
     カードの seed には updated が無いので、初回の書き換え時に生える。
     詳細画面のどの書き換え（確認状態・対応方針・時期・名前…）も
     ここを通るので、保存もここで一度だけ行う。別ページ（list.html
     など）へ移っても、次のロードで同じ状態から開ける。            */
  function touch(entity) {
    if (!entity) return;
    entity.updated = today();
    save();
  }

  global.SeiZenContract = {
    INTENTS, MARKS3, GROUP_UI, MARKS, LOGO_ALIAS,
    paymentMethods, cards, items,
    byGroup, preItems, postItems, undecidedItems,
    hasService, commitAdded, commitFromStatement, applyPaymentMethodChange, removeAdded, renameService, setGroup, resetAll,
    markStatementChecked, clearStatementChecks, statementCoverageText, migrateStatementChecked,
    intentOf, intentLabel, markOf, openCount, procChecked, accountMark, accountState, accountDone, statusRows,
    itemBadge, groupSummary, accountSummary,
    paymentDisplay, amountText, findItem, findCard, findPaymentMethod, linkedItems, cardFacts,
    yen, today, touch
  };
})(window);
