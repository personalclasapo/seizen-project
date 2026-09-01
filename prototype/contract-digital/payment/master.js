/* SeiZen プロトタイプ｜支払い明細から探す：マスタ
   ------------------------------------------------------------------
   設計「支払い明細から探す」§2-4 / §15 に対応。

   このファイルが持つのは3種の実体（merchant / service / plan）と、
   請求主体の同定に使う merchant_pattern。

     merchant … 請求主体。type で扱いが決まる（§3-2）
                  normal          … 判定木へ進む
                  payment_method  … アップロード誘導（§3-4）
                  out_of_scope    … 破棄・通知しない（§8-2）
     service  … 継続課金サービス。pricing_type が「形の照合」のキー、
                domain が提示対象かの判定、post_mortem_procedure が
                対応時期の導出根拠（§10-2）
     plan     … サービスの下位実体。amount が「金額でプランを絞る」の
                キー（§7-1）。pricing_type ∈ {metered, subscription_box}
                の service は plan を持たない（§7-1）

   ── 置き場所（§15-1）───────────────────────────────
   domain・type・対象外指定は「SeiZen の判断」なのでデータで固定する。
   料金型・プラン金額・死後手続きは「変化する事実」なので、本番では
   実行時解決＋保存になる。このプロトタイプでは resolver.js のスタブが
   固定値を返し、その結果がここへ書き戻される（addService 等）。

   ── service_id（catalog.js / state.js と共有）──────────
   「サービスから探す」のカタログ（catalog.js SERVICE_ID）と同じ
   svc-* を使う。別 ID 体系を作らない。ここに無い pricing_type /
   plan / post_mortem_procedure は、この機能で新しく足す属性。

   ── 収録範囲について ──────────────────────────────────
   ここに収録された merchant / service が「判定できるもの」のすべて。
   特定のサンプル CSV を通すためのデータではなく、SeiZen が知識として
   持っている継続課金サービスの一覧である。未収録の請求主体は
   resolver.resolveUnknown() に回り、そこで解決できれば addMerchant /
   addService でここへ育つ（§15-2）。
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  /* 形の照合表（§3-2）。series.cycle に対して一致する pricing_type。
     weekly は持たない。定期宅配（subscription_box）は cycle ではなく
     series.is_frequent（短間隔の反復）で照合する（judge.js）。      */
  const CYCLE_TO_PRICING = {
    monthly:   ['monthly', 'metered'],
    bimonthly: ['bimonthly', 'metered'],
    single:    ['annual']
  };

  /* 金額でプランを絞るか（§7-1）。metered / subscription_box はしない。 */
  const AMOUNT_MATCHED_PRICING = new Set(['monthly', 'annual', 'bimonthly']);

  /* ── merchant（請求主体）──────────────────────────────
     domain は out_of_scope 判定にのみ使う（type=out_of_scope なら
     それ自体で提示対象外）。normal の merchant の domain は、配下
     service 側の domain を正とするため、ここでは参考値。            */
  const MERCHANTS = {
    /* --- 継続課金サービスの直接請求 --- */
    'mch-netflix':  { name: 'Netflix',              type: 'normal', domain: 'contract_digital' },
    'mch-spotify':  { name: 'Spotify',              type: 'normal', domain: 'contract_digital' },
    'mch-unext':    { name: 'U-NEXT',               type: 'normal', domain: 'contract_digital' },
    'mch-anytime':  { name: 'エニタイムフィットネス', type: 'normal', domain: 'contract_digital' },
    'mch-nikkei':   { name: '日本経済新聞',          type: 'normal', domain: 'contract_digital' },
    'mch-oisix':    { name: 'Oisix',                type: 'normal', domain: 'contract_digital' },

    /* --- 決済プラットフォーム（配下に複数サービス）--- */
    'mch-apple':     { name: 'Apple',               type: 'normal', domain: 'contract_digital' },
    'mch-microsoft': { name: 'Microsoft',           type: 'normal', domain: 'contract_digital' },
    'mch-gmo-onamae':{ name: 'GMO お名前.com',       type: 'normal', domain: 'contract_digital' },

    /* --- 通信・インフラ（従量）--- */
    'mch-ntt-east':   { name: 'NTT東日本',          type: 'normal', domain: 'contract_digital' },
    'mch-ntt-docomo': { name: 'NTTドコモ',          type: 'normal', domain: 'contract_digital' },
    'mch-tepco':      { name: '東京電力エナジーパートナー', type: 'normal', domain: 'contract_digital' },
    'mch-tokyo-gas':  { name: '東京ガス',           type: 'normal', domain: 'contract_digital' },
    'mch-water-yokohama': { name: '横浜市水道局',    type: 'normal', domain: 'contract_digital' },

    /* --- 支払い手段（§3-4：アップロード誘導）--- */
    'mch-card-generic': { name: 'クレジットカード（他社）', type: 'payment_method', domain: null },

    /* --- 他領域（§8-2：保持するが提示しない）--- */
    'mch-sompo-jp':  { name: '損保ジャパン',         type: 'out_of_scope', domain: 'insurance' }
  };

  /* ── service ──────────────────────────────────────────
     merchant_id … どの請求主体から到達するか
     pricing_type … monthly | annual | bimonthly | metered | subscription_box
     domain … 提示対象かの判定（§8-2）

     ── 対応時期の判定根拠（§10-1）──────────────────────
     survivor_can_complete … 本人の生前の行為（ID/パスワードの共有、
       故人アカウント連絡先の指定など）なしに、遺族が事後に手続きを
       完了できるか。
         true  → 対応時期「そのとき」
         false → 対応時期「いまのうち」（既定値。§10-2：制度の不存在は
                 確認できないので、遺族単独で完了できると確認できた
                 ものだけ「そのとき」）
       「死後の解約導線が存在するか」ではない。導線があっても本人の
       アカウントにログインしないと進められないもの（動画配信・
       クラウド・お名前.com 等）は false（§10-2 が明記）。
     post_mortem_procedure … 手続きの実際の窓口・必要書類の説明文。
       確認項目の導出には使うが、対応時期の判定には使わない
       （§15-1：食い違う状態を構造的に作らないため判定根拠を分離）。
       この文面自体はプロトタイプの暫定値で、公式導線の裏取りは未了。 */
  const SERVICES = {
    /* 動画・音楽・クラウド：解約は本人アカウントへのログインが前提。
       故人アカウント管理連絡先を生前指定していなければ遺族単独では
       完了できない（§10-2）→ survivor_can_complete: false */
    'svc-netflix':  { name: 'Netflix',   merchant_id: 'mch-netflix',  category: '動画配信',
                      pricing_type: 'monthly', domain: 'contract_digital',
                      survivor_can_complete: false,
                      post_mortem_procedure: null },
    'svc-spotify':  { name: 'Spotify',   merchant_id: 'mch-spotify',  category: '音楽配信',
                      pricing_type: 'monthly', domain: 'contract_digital',
                      survivor_can_complete: false,
                      post_mortem_procedure: null },
    'svc-unext':    { name: 'U-NEXT',    merchant_id: 'mch-unext',    category: '動画配信',
                      pricing_type: 'monthly', domain: 'contract_digital',
                      survivor_can_complete: false,
                      post_mortem_procedure: null },
    'svc-anytime':  { name: 'エニタイムフィットネス', merchant_id: 'mch-anytime', category: 'フィットネス',
                      pricing_type: 'monthly', domain: 'contract_digital',
                      /* 会員カード＋死亡を証する書類で店舗退会。ログイン不要 */
                      survivor_can_complete: true,
                      post_mortem_procedure: '所属店舗またはコールセンターで退会手続き。会員カードと死亡を証する書類が必要。' },
    'svc-nikkei':   { name: '日本経済新聞', merchant_id: 'mch-nikkei', category: '新聞',
                      pricing_type: 'monthly', domain: 'contract_digital',
                      /* 解約は日経IDが主体。電話窓口はあるがアカウント照会で
                         詰まりやすいため安全側で false */
                      survivor_can_complete: false,
                      post_mortem_procedure: '日経IDのカスタマーセンターへ連絡し購読解約。契約者名・登録住所で照会。' },

    /* Apple 配下：いずれも Apple ID へのログインが前提。故人アカウント
       管理連絡先の生前指定がなければ遺族単独では完了できない（§10-2）*/
    'svc-icloud':      { name: 'iCloud+',     merchant_id: 'mch-apple', category: 'クラウド保存',
                        pricing_type: 'monthly', domain: 'contract_digital',
                        survivor_can_complete: false,
                        post_mortem_procedure: null },
    'svc-apple-music': { name: 'Apple Music', merchant_id: 'mch-apple', category: '音楽配信',
                        pricing_type: 'monthly', domain: 'contract_digital',
                        survivor_can_complete: false,
                        post_mortem_procedure: null },
    'svc-apple-one':   { name: 'Apple One',   merchant_id: 'mch-apple', category: 'サブスク',
                        pricing_type: 'monthly', domain: 'contract_digital',
                        survivor_can_complete: false,
                        post_mortem_procedure: null },
    'svc-apple-tv':    { name: 'Apple TV+',   merchant_id: 'mch-apple', category: '動画配信',
                        pricing_type: 'monthly', domain: 'contract_digital',
                        survivor_can_complete: false,
                        post_mortem_procedure: null },

    /* Microsoft 配下：Microsoft アカウントへのログインが前提 */
    'svc-ms365': { name: 'Microsoft 365', merchant_id: 'mch-microsoft', category: 'ソフト・クラウド',
                   pricing_type: 'annual', domain: 'contract_digital',
                   survivor_can_complete: false,
                   post_mortem_procedure: null },

    /* GMO お名前.com：会員情報（ID/パスワード）必須。Auth コードも
       ログインしないと取得できない → 遺族単独では完了できない */
    'svc-onamae-domain': { name: 'お名前.com ドメイン', merchant_id: 'mch-gmo-onamae', category: 'Web・ドメイン',
                           pricing_type: 'annual', domain: 'contract_digital',
                           survivor_can_complete: false,
                           post_mortem_procedure: 'お名前.com の会員情報で承継・解約を申請。ドメイン移管には Auth コードが必要。' },

    /* NTT東日本（固定回線）：116・窓口で CAF番号（請求書に記載）と
       死亡書類で解約。ログイン不要 */
    'svc-flets':       { name: 'フレッツ光', merchant_id: 'mch-ntt-east', category: '通信（固定回線）',
                         pricing_type: 'monthly', domain: 'contract_digital',
                         survivor_can_complete: true,
                         post_mortem_procedure: '116 または NTT東日本の窓口で承継・解約。お客さまID（CAF番号）を伝える。' },
    'svc-hikari-denwa':{ name: 'ひかり電話', merchant_id: 'mch-ntt-east', category: '電話',
                         pricing_type: 'monthly', domain: 'contract_digital',
                         survivor_can_complete: true,
                         post_mortem_procedure: '116 で承継・解約。番号ポータビリティの要否を確認。' },

    /* NTTドコモ：ドコモショップで死亡確認書類を提示すれば承継・解約。
       回線契約は書面手続きでログイン不要 */
    'svc-docomo':        { name: 'NTTドコモ（携帯電話）', merchant_id: 'mch-ntt-docomo', category: '携帯',
                           pricing_type: 'metered', domain: 'contract_digital',
                           survivor_can_complete: true,
                           post_mortem_procedure: 'ドコモショップで承継（同一名義人以外への引継ぎ）または解約。死亡の事実確認書類が必要。' },
    'svc-docomo-hikari': { name: 'ドコモ光', merchant_id: 'mch-ntt-docomo', category: '通信（固定回線）',
                           pricing_type: 'metered', domain: 'contract_digital',
                           survivor_can_complete: true,
                           post_mortem_procedure: 'ドコモの窓口で承継・解約。' },

    /* インフラ（従量）：お客さま番号（郵便物に記載）と電話で廃止。
       ログイン不要 */
    'svc-tepco':          { name: '東京電力エナジーパートナー', merchant_id: 'mch-tepco', category: '電気',
                            pricing_type: 'metered', domain: 'contract_digital',
                            survivor_can_complete: true,
                            post_mortem_procedure: 'カスタマーセンターで名義変更または廃止。お客さま番号を伝える。' },
    'svc-gas':      { name: '東京ガス', merchant_id: 'mch-tokyo-gas', category: 'ガス',
                            pricing_type: 'metered', domain: 'contract_digital',
                            survivor_can_complete: true,
                            post_mortem_procedure: 'お客さまセンターで名義変更または廃止。お客さま番号を伝える。' },
    'svc-water-yokohama': { name: '横浜市水道局', merchant_id: 'mch-water-yokohama', category: '水道',
                            pricing_type: 'metered', domain: 'contract_digital',
                            survivor_can_complete: true,
                            post_mortem_procedure: 'お客さまサービスセンターで使用者変更または中止。' },

    /* Oisix（定期宅配）：解約はマイページ（ログイン）が主。登録メール・
       電話での照会も本人確認が壁になりやすいため安全側で false */
    'svc-oisix': { name: 'Oisix', merchant_id: 'mch-oisix', category: '食材宅配',
                   pricing_type: 'subscription_box', domain: 'contract_digital',
                   survivor_can_complete: false,
                   post_mortem_procedure: 'マイページまたは電話で定期ボックスを解約。登録メール・電話で照会。' },

    /* 保険（domain 分離の確認用・§8-2）*/
    'svc-sompo-jp': { name: '損保ジャパンの保険', merchant_id: 'mch-sompo-jp', category: '保険',
                      pricing_type: 'monthly', domain: 'insurance',
                      survivor_can_complete: false,
                      post_mortem_procedure: null }
  };

  /* ── plan（サービスの下位実体）────────────────────────
     amount … 「金額でプランを絞る」のキー（§7-1）。
     metered / subscription_box の service には作らない。            */
  const PLANS = {
    'svc-netflix': [
      { plan_id: 'pln-netflix-ad',       name: '広告つきスタンダード', amount: 890 },
      { plan_id: 'pln-netflix-standard', name: 'スタンダード',        amount: 1590 },
      { plan_id: 'pln-netflix-premium',  name: 'プレミアム',          amount: 1980 }
    ],
    'svc-spotify': [
      { plan_id: 'pln-spotify-individual', name: 'Premium 個人', amount: 1080 }
    ],
    'svc-unext': [
      { plan_id: 'pln-unext-plan', name: '月額プラン', amount: 2189 }
    ],
    'svc-anytime': [
      { plan_id: 'pln-anytime-regular', name: '通常会員', amount: 8140 }
    ],
    'svc-nikkei': [
      { plan_id: 'pln-nikkei-paper-digital', name: '朝夕刊＋電子版', amount: 4800 }
    ],
    'svc-icloud': [
      { plan_id: 'pln-icloud-50',  name: '50GB',  amount: 150 },
      { plan_id: 'pln-icloud-200', name: '200GB', amount: 450 },
      { plan_id: 'pln-icloud-2t',  name: '2TB',   amount: 1500 }
    ],
    'svc-apple-music': [
      { plan_id: 'pln-apple-music-individual', name: '個人', amount: 1080 }
    ],
    'svc-apple-one': [
      { plan_id: 'pln-apple-one-individual', name: '個人', amount: 1200 }
    ],
    'svc-apple-tv': [
      { plan_id: 'pln-apple-tv-plus', name: 'Apple TV+', amount: 900 }
    ],
    'svc-ms365': [
      { plan_id: 'pln-ms365-personal', name: 'Personal（年額）', amount: 21300 }
    ],
    'svc-onamae-domain': [
      { plan_id: 'pln-onamae-com', name: '.com 更新（年額）', amount: 1408 }
    ],
    'svc-flets': [
      { plan_id: 'pln-flets-mansion', name: 'マンションタイプ', amount: 4950 }
    ]
  };

  /* ── merchant_pattern（§6-2）──────────────────────────
     明細表記（正規化後・大文字）から merchant_id を引く。表記揺れは
     列挙不能なので、確実に言えるものだけを載せる。ここで引けなければ
     resolver.resolveUnknown() へ。
     match: 'exact' | 'prefix' | 'regex'
     priority が大きいほど優先。同点なら pattern が長い方（具体的な方）。 */
  const MERCHANT_PATTERN = [
    { pattern: 'NETFLIX.COM',          match: 'exact',  merchant_id: 'mch-netflix',  priority: 100 },
    { pattern: 'NETFLIX',              match: 'prefix', merchant_id: 'mch-netflix',  priority: 60 },
    { pattern: '^SPOTIFY(\\s|$)',      match: 'regex',  merchant_id: 'mch-spotify',  priority: 100 },
    { pattern: 'U-NEXT',               match: 'prefix', merchant_id: 'mch-unext',    priority: 100 },
    { pattern: 'UNEXT',                match: 'prefix', merchant_id: 'mch-unext',    priority: 90 },
    { pattern: 'ANYTIME FITNESS',      match: 'prefix', merchant_id: 'mch-anytime',  priority: 100 },
    { pattern: 'NIHON KEIZAI SHIMBUN', match: 'prefix', merchant_id: 'mch-nikkei',   priority: 100 },
    { pattern: 'NIKKEI',              match: 'prefix', merchant_id: 'mch-nikkei',   priority: 70 },
    { pattern: 'OISIX',               match: 'prefix', merchant_id: 'mch-oisix',    priority: 100 },

    { pattern: '^APPLE\\.COM',         match: 'regex',  merchant_id: 'mch-apple',    priority: 100 },
    { pattern: '^APPLE(\\s|$)',        match: 'regex',  merchant_id: 'mch-apple',    priority: 60 },
    { pattern: '^MICROSOFT\\*',        match: 'regex',  merchant_id: 'mch-microsoft', priority: 100 },
    { pattern: '^MICROSOFT(\\s|$)',    match: 'regex',  merchant_id: 'mch-microsoft', priority: 60 },
    { pattern: '^GMO\\*ONAMAE',        match: 'regex',  merchant_id: 'mch-gmo-onamae', priority: 100 },
    { pattern: 'ONAMAE.COM',          match: 'prefix', merchant_id: 'mch-gmo-onamae', priority: 80 },

    { pattern: 'NTT EAST',            match: 'prefix', merchant_id: 'mch-ntt-east',  priority: 100 },
    { pattern: 'NTT DOCOMO',          match: 'prefix', merchant_id: 'mch-ntt-docomo', priority: 100 },
    { pattern: 'TEPCO',              match: 'prefix', merchant_id: 'mch-tepco',     priority: 100 },
    { pattern: 'TOKYO GAS',          match: 'prefix', merchant_id: 'mch-tokyo-gas', priority: 100 },
    { pattern: 'YOKOHAMA WATERWORKS', match: 'prefix', merchant_id: 'mch-water-yokohama', priority: 100 },

    { pattern: 'SOMPO JAPAN',        match: 'prefix', merchant_id: 'mch-sompo-jp',  priority: 100 },

    /* 他社カード・キャリア決済への引き落とし（§8-1）。配下の契約は
       この明細からは判別できないので、候補から除く（type=payment_method
       として judge が弾く）。§12-2 に従い、検出した旨は画面に出さない。
       表記は列挙できる範囲で。ここに無い他社カードは resolver で解決
       できなければ C に回るが、それは想定内。 */
    { pattern: '(RAKUTEN|楽天)\\s*CARD',      match: 'regex',  merchant_id: 'mch-card-generic', priority: 90 },
    { pattern: 'AEON\\s*CARD',                match: 'regex',  merchant_id: 'mch-card-generic', priority: 90 },
    { pattern: 'EPOS\\s*CARD',                match: 'regex',  merchant_id: 'mch-card-generic', priority: 90 },
    { pattern: 'JCB\\b',                      match: 'regex',  merchant_id: 'mch-card-generic', priority: 80 },
    { pattern: 'SAISON',                      match: 'prefix', merchant_id: 'mch-card-generic', priority: 80 },
    { pattern: 'DOCOMO\\s*BARAI|D BARAI|ﾄﾞｺﾓﾊﾞﾗｲ', match: 'regex', merchant_id: 'mch-card-generic', priority: 80 },
    { pattern: 'AU\\s*KANTAN|AUかんたんKESSAI',      match: 'regex', merchant_id: 'mch-card-generic', priority: 80 }
  ];

  /* ── 引き出し ─────────────────────────────────────── */

  function merchant(id) { return id ? MERCHANTS[id] || null : null; }
  function service(id)  { return id ? SERVICES[id] || null : null; }

  /* 請求主体 → 配下 service_id[]。 */
  function servicesOf(merchantId) {
    if (!merchantId) return [];
    return Object.keys(SERVICES).filter(sid => SERVICES[sid].merchant_id === merchantId);
  }

  /* service_id → plan[]（無ければ空配列）。 */
  function plansOf(serviceId) {
    return (PLANS[serviceId] || []).slice();
  }

  /* pricing_type が「金額でプランを絞る」対象か（§7-1）。 */
  function isAmountMatched(pricingType) {
    return AMOUNT_MATCHED_PRICING.has(pricingType);
  }

  /* series と service.pricing_type が「形として一致」するか（§3-2）。
     subscription_box は series.is_frequent（短間隔の反復）で照合し、
     それ以外は cycle 帯で照合する。                                 */
  function shapeMatches(series, pricingType) {
    if (pricingType === 'subscription_box') return !!series.is_frequent;
    return (CYCLE_TO_PRICING[series.cycle] || []).indexOf(pricingType) !== -1;
  }

  /* ── 実行時解決からの書き戻し（§15-2）────────────────
     resolver がマスタ未収録の請求主体を解決したとき、事実側の列だけ
     ここへ足す。プロトタイプではメモリ上の辞書へ追加するだけ。本番は
     マスタ DB への UPSERT。家族の情報は構造的に渡ってこない。      */
  function addMerchant(id, rec) {
    if (!id || MERCHANTS[id]) return;
    MERCHANTS[id] = {
      name: rec.name || id,
      type: rec.type || 'normal',
      domain: rec.domain || 'contract_digital'
    };
  }

  /* 解決した請求主体の照合パターンをマスタへ足す。これがないと
     addMerchant / addService でサービスは増えても identify が引けず、
     再系列化しても merchant_id が付かない（§15-2「次回以降は問い合わせ
     不要」が成立しない）。resolver は解決結果に pattern / match を添える。 */
  function addMerchantPattern(rec) {
    if (!rec || !rec.pattern || !rec.merchant_id) return;
    const match = rec.match || 'prefix';
    /* 同一 pattern+match+merchant_id は同じエントリ。priority だけ違う
       解決結果が来たら上書き（2本に増やさない）。 */
    const existing = MERCHANT_PATTERN.find(p =>
      p.pattern === rec.pattern && p.match === match && p.merchant_id === rec.merchant_id);
    if (existing) {
      if (rec.priority != null) existing.priority = rec.priority;
      return;
    }
    MERCHANT_PATTERN.push({
      pattern: rec.pattern,
      match: match,
      merchant_id: rec.merchant_id,
      priority: rec.priority || 90
    });
  }

  function addService(id, rec) {
    if (!id || SERVICES[id]) return;
    SERVICES[id] = {
      name: rec.name || id,
      merchant_id: rec.merchant_id,
      category: rec.category || '未分類',
      pricing_type: rec.pricing_type || 'monthly',
      domain: rec.domain || 'contract_digital',
      /* 実行時解決が判定根拠を返さなければ、既定値「いまのうち」に
         倒す（§10-2：確認できないものは false）*/
      survivor_can_complete: rec.survivor_can_complete === true,
      post_mortem_procedure: rec.post_mortem_procedure || null
    };
    if (Array.isArray(rec.plans) && rec.plans.length) {
      PLANS[id] = rec.plans.map((p, i) => ({
        plan_id: p.plan_id || (id + '-pln-' + i),
        name: p.name || '',
        amount: p.amount
      }));
    }
  }

  global.SeiZenPaymentMaster = {
    CYCLE_TO_PRICING,
    merchant, service, servicesOf, plansOf,
    isAmountMatched, shapeMatches,
    MERCHANT_PATTERN,
    addMerchant, addService, addMerchantPattern,
    /* テスト用に生辞書も見せる */
    _raw: { MERCHANTS, SERVICES, PLANS }
  };
})(window);
