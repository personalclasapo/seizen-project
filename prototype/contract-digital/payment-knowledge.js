/* SeiZen プロトタイプ｜支払い明細から探す：解析用知識DB
   ------------------------------------------------------------------
   基準設計「支払い明細から探す — β版システム設計【確定版・custom対応
   修正版】」§14〜§18・§44 に対応する、アプリ内静的データ。

   ここが持つのは4種の解析用知識と service_master：

     service_master              … §16。「サービスから探す」カタログの
                                    正本と同じ service_id を使う。
                                    ここでは明細解析で到達し得る
                                    サービスにだけ最小の属性を持つ。
     billing_entity_master       … §16。請求主体（billing_entity）。
     merchant_pattern            … §14。明細表記 → billing_entity。
     billing_entity_service_map  … §17。請求主体 → reachable_service_ids。
     price_hint                  … §18。補助証拠としての料金。

   Google Sheets や外部DBには置かない（§27・§44・指示§15）。

   ── service_id について ──────────────────────────────
   「サービスから探す」（catalog.js / state.js seed）と同じ ID 体系を使う。
   既存カタログ側の文字列項目に stable な service_id を後付けする作業は
   catalog.js / state.js 側で行う（このファイルには複製カタログを作らない）。
   ここで参照する service_id は、その付与済み ID と一致させる。

   ── response_class（A/B/C）について ──────────────────
   基準設計 §16「response_class は既存A/B/C分類」。既存プロトタイプには
   A/B/C の明示定義が無く、詳細画面は pre（いまのうち）/ post（そのとき）
   の2区分で扱っている。ここでは pre/post から A/B/C を逆算せず、
   service_master 側で各サービスの A/B/C を明示定義し、そこから
   response_timing を導出する（合意事項②）。

   意味づけ（このβ版での定義）：
     A … 本人にしかできない準備が要る。家族が引き継ぐには事前の
          情報整備が必須。→ response_timing = pre（いまのうち）
     B … 事前準備があると望ましいが、事後でも家族が窓口で対応できる。
          β版では pre 側に寄せる（取りこぼしを避ける）。→ pre
     C … 事業者側に手続き窓口があり、必要になってから対応で足りる。
          → response_timing = post（そのとき）

   candidates で候補の response_timing が割れる場合は「分からない」
   （§27・§33）。
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  /* ── service_master（§16） ─────────────────────────────
     明細解析で candidate_service_ids に載り得るサービスだけを持つ。
     seizen_domain: 'contract_digital' | 'insurance' | ...（§26）
     response_class: 'A' | 'B' | 'C'（上記の意味づけ）              */
  const SERVICE_MASTER = {
    'svc-netflix':        { service_name: 'Netflix',            category: '動画配信',       seizen_domain: 'contract_digital', response_class: 'A' },
    'svc-spotify':        { service_name: 'Spotify',            category: '音楽配信',       seizen_domain: 'contract_digital', response_class: 'A' },
    'svc-unext':          { service_name: 'U-NEXT',             category: '動画配信',       seizen_domain: 'contract_digital', response_class: 'A' },
    'svc-anytime':        { service_name: 'エニタイムフィットネス', category: 'フィットネス',   seizen_domain: 'contract_digital', response_class: 'A' },
    'svc-nikkei':         { service_name: '日本経済新聞',        category: '新聞',           seizen_domain: 'contract_digital', response_class: 'A' },

    /* Apple 系（APPLE.COM/BILL から到達し得る） */
    'svc-icloud':         { service_name: 'iCloud+',            category: 'クラウド保存',   seizen_domain: 'contract_digital', response_class: 'A' },
    'svc-apple-music':    { service_name: 'Apple Music',        category: '音楽配信',       seizen_domain: 'contract_digital', response_class: 'A' },
    'svc-apple-tv':       { service_name: 'Apple TV+',          category: '動画配信',       seizen_domain: 'contract_digital', response_class: 'A' },
    'svc-apple-one':      { service_name: 'Apple One',          category: 'サブスク',       seizen_domain: 'contract_digital', response_class: 'A' },
    'svc-apple-arcade':   { service_name: 'Apple Arcade',       category: 'ゲーム',         seizen_domain: 'contract_digital', response_class: 'A' },
    'svc-apple-app':      { service_name: 'App Store のアプリ内課金', category: 'アプリ',    seizen_domain: 'contract_digital', response_class: 'A' },

    /* Microsoft */
    'svc-ms365':          { service_name: 'Microsoft 365',      category: 'ソフト・クラウド', seizen_domain: 'contract_digital', response_class: 'A' },

    /* NTT東日本（フレッツ光 / ひかり電話 …） */
    'svc-flets':          { service_name: 'フレッツ光',          category: '通信（固定回線）', seizen_domain: 'contract_digital', response_class: 'C' },
    'svc-hikari-denwa':   { service_name: 'ひかり電話',          category: '電話',           seizen_domain: 'contract_digital', response_class: 'C' },

    /* NTTドコモ（携帯 / ドコモ光 …） */
    'svc-docomo':         { service_name: 'NTTドコモ（携帯電話）', category: '携帯',         seizen_domain: 'contract_digital', response_class: 'C' },
    'svc-docomo-hikari':  { service_name: 'ドコモ光',            category: '通信（固定回線）', seizen_domain: 'contract_digital', response_class: 'C' },

    /* インフラ */
    'svc-tepco':          { service_name: '東京電力エナジーパートナー', category: '電気',    seizen_domain: 'contract_digital', response_class: 'C' },
    'svc-tokyo-gas':      { service_name: '東京ガス',            category: 'ガス',           seizen_domain: 'contract_digital', response_class: 'C' },
    'svc-water-yokohama': { service_name: '横浜市水道局',        category: '水道',           seizen_domain: 'contract_digital', response_class: 'C' },

    /* 注文型継続契約 */
    'svc-oisix':          { service_name: 'Oisix',              category: '食材宅配',       seizen_domain: 'contract_digital', response_class: 'C' },

    /* 保険（domain 分離の確認用・§20） */
    'svc-sompo-jp':       { service_name: '損保ジャパンの保険',  category: '保険',           seizen_domain: 'insurance',        response_class: 'C' }
  };

  /* A/B/C → response_timing（合意事項②の意味づけ）。 */
  const RESPONSE_TIMING_BY_CLASS = { A: 'pre', B: 'pre', C: 'post' };

  function responseTimingForClass(cls) {
    return RESPONSE_TIMING_BY_CLASS[cls] || null;
  }

  /* ── billing_entity_master（§16） ─────────────────────
     merchant_type: §16 の列挙
     contract_capability          … 継続契約請求が発生し得るか
     one_time_purchase_capability … 単発購買・利用も存在し得るか
     billing_pattern              … fixed_recurring / variable_recurring /
        order_based_recurring / usage_based_recurring /
        annual_or_long_cycle / mixed / unknown                      */
  const BILLING_ENTITY_MASTER = {
    'be-netflix':   { billing_entity_name: 'Netflix',        merchant_type: 'subscription_provider', contract_capability: true,  one_time_purchase_capability: false, billing_pattern: 'fixed_recurring' },
    'be-spotify':   { billing_entity_name: 'Spotify',        merchant_type: 'subscription_provider', contract_capability: true,  one_time_purchase_capability: false, billing_pattern: 'fixed_recurring' },
    'be-unext':     { billing_entity_name: 'U-NEXT',         merchant_type: 'subscription_provider', contract_capability: true,  one_time_purchase_capability: false, billing_pattern: 'fixed_recurring' },
    'be-anytime':   { billing_entity_name: 'エニタイムフィットネス', merchant_type: 'membership',    contract_capability: true,  one_time_purchase_capability: false, billing_pattern: 'fixed_recurring' },
    'be-nikkei':    { billing_entity_name: '日本経済新聞',    merchant_type: 'subscription_provider', contract_capability: true,  one_time_purchase_capability: false, billing_pattern: 'fixed_recurring' },

    'be-apple':     { billing_entity_name: 'Apple',          merchant_type: 'billing_platform',      contract_capability: true,  one_time_purchase_capability: true,  billing_pattern: 'mixed' },
    'be-microsoft': { billing_entity_name: 'Microsoft',      merchant_type: 'billing_platform',      contract_capability: true,  one_time_purchase_capability: true,  billing_pattern: 'mixed' },

    'be-ntt-east':  { billing_entity_name: 'NTT東日本',      merchant_type: 'telecom',               contract_capability: true,  one_time_purchase_capability: false, billing_pattern: 'fixed_recurring' },
    'be-ntt-docomo':{ billing_entity_name: 'NTTドコモ',      merchant_type: 'telecom',               contract_capability: true,  one_time_purchase_capability: false, billing_pattern: 'variable_recurring' },

    'be-tepco':     { billing_entity_name: '東京電力エナジーパートナー', merchant_type: 'utility',    contract_capability: true,  one_time_purchase_capability: false, billing_pattern: 'variable_recurring' },
    'be-tokyo-gas': { billing_entity_name: '東京ガス',       merchant_type: 'utility',               contract_capability: true,  one_time_purchase_capability: false, billing_pattern: 'variable_recurring' },
    'be-water-yokohama': { billing_entity_name: '横浜市水道局', merchant_type: 'utility',             contract_capability: true,  one_time_purchase_capability: false, billing_pattern: 'variable_recurring' },

    'be-oisix':     { billing_entity_name: 'Oisix',          merchant_type: 'delivery_service',      contract_capability: true,  one_time_purchase_capability: true,  billing_pattern: 'order_based_recurring' },

    'be-sompo-jp':  { billing_entity_name: '損保ジャパン',    merchant_type: 'other',                 contract_capability: true,  one_time_purchase_capability: false, billing_pattern: 'fixed_recurring' },

    'be-amazon':    { billing_entity_name: 'Amazon',         merchant_type: 'mixed_commerce',        contract_capability: true,  one_time_purchase_capability: true,  billing_pattern: 'mixed' },
    'be-mobile-suica': { billing_entity_name: 'Mobile Suica', merchant_type: 'other',                contract_capability: false, one_time_purchase_capability: true,  billing_pattern: 'unknown' },
    'be-bic-camera': { billing_entity_name: 'ビックカメラ',   merchant_type: 'normal_retail',         contract_capability: false, one_time_purchase_capability: true,  billing_pattern: 'unknown' },
    'be-times-parking': { billing_entity_name: 'タイムズ パーキング', merchant_type: 'normal_retail', contract_capability: false, one_time_purchase_capability: true, billing_pattern: 'usage_based_recurring' }
  };

  /* ── merchant_pattern（§14） ─────────────────────────
     match_type: 'exact' | 'prefix' | 'regex'
     priority が大きいほど優先。同点ならより具体的な pattern を優先。
     pattern は description_normalized（§13 正規化後・大文字）に対して照合。 */
  const MERCHANT_PATTERN = [
    { pattern: 'NETFLIX.COM',           match_type: 'exact',  billing_entity_id: 'be-netflix',   priority: 100 },
    { pattern: 'NETFLIX',               match_type: 'prefix', billing_entity_id: 'be-netflix',   priority: 60 },

    /* Spotify のランダム suffix は専用 pattern で処理（§13・指示§13） */
    { pattern: '^SPOTIFY(\\s|$)',       match_type: 'regex',  billing_entity_id: 'be-spotify',   priority: 100 },

    { pattern: 'U-NEXT',                match_type: 'prefix', billing_entity_id: 'be-unext',     priority: 100 },
    { pattern: 'UNEXT',                 match_type: 'prefix', billing_entity_id: 'be-unext',     priority: 90 },

    { pattern: 'ANYTIME FITNESS',       match_type: 'prefix', billing_entity_id: 'be-anytime',   priority: 100 },

    { pattern: 'NIHON KEIZAI SHIMBUN',  match_type: 'prefix', billing_entity_id: 'be-nikkei',    priority: 100 },
    { pattern: 'NIKKEI',               match_type: 'prefix', billing_entity_id: 'be-nikkei',    priority: 70 },

    /* Apple：APPLE.COM/BILL 等。請求主体までは特定できる（§16 例） */
    { pattern: '^APPLE\\.COM',          match_type: 'regex',  billing_entity_id: 'be-apple',     priority: 100 },
    { pattern: '^APPLE(\\s|$)',         match_type: 'regex',  billing_entity_id: 'be-apple',     priority: 60 },

    /* Microsoft：MICROSOFT*MICROSOFT 365 は Microsoft 側請求 pattern（§15） */
    { pattern: '^MICROSOFT\\*',         match_type: 'regex',  billing_entity_id: 'be-microsoft', priority: 100 },
    { pattern: '^MICROSOFT(\\s|$)',     match_type: 'regex',  billing_entity_id: 'be-microsoft', priority: 60 },

    { pattern: 'NTT EAST',              match_type: 'prefix', billing_entity_id: 'be-ntt-east',  priority: 100 },
    { pattern: 'NTT DOCOMO',            match_type: 'prefix', billing_entity_id: 'be-ntt-docomo', priority: 100 },

    { pattern: 'TEPCO',                 match_type: 'prefix', billing_entity_id: 'be-tepco',     priority: 100 },
    { pattern: 'TOKYO GAS',             match_type: 'prefix', billing_entity_id: 'be-tokyo-gas', priority: 100 },
    { pattern: 'YOKOHAMA WATERWORKS',   match_type: 'prefix', billing_entity_id: 'be-water-yokohama', priority: 100 },

    { pattern: 'OISIX',                 match_type: 'prefix', billing_entity_id: 'be-oisix',     priority: 100 },

    { pattern: 'SOMPO JAPAN',           match_type: 'prefix', billing_entity_id: 'be-sompo-jp',  priority: 100 },

    { pattern: 'AMAZON.CO.JP',          match_type: 'prefix', billing_entity_id: 'be-amazon',    priority: 100 },
    { pattern: 'AMAZON',                match_type: 'prefix', billing_entity_id: 'be-amazon',    priority: 60 },

    /* MOBILE SUICA：billing_entity までは持つが generic（指示§12）。
       payment_path とも contract とも、これ「だけ」で断定しない。 */
    { pattern: 'MOBILE SUICA',          match_type: 'prefix', billing_entity_id: 'be-mobile-suica', priority: 100 },

    { pattern: 'BIC CAMERA',            match_type: 'prefix', billing_entity_id: 'be-bic-camera', priority: 100 },

    /* TIMES PARKING：TIMES の単純部分一致でタイムズカーへ寄せない（§14）。
       駐車場（パーキング）としての billing_entity にとどめる。 */
    { pattern: 'TIMES PARKING',         match_type: 'prefix', billing_entity_id: 'be-times-parking', priority: 100 }
  ];

  /* ── billing_entity_service_map（§17） ────────────────
     billing_entity_id → [service_id, ...]（reachable_service_ids）。
     Apple・NTT 等は複数登録（指示§15：複数サービス性はデータで表現）。 */
  const BILLING_ENTITY_SERVICE_MAP = {
    'be-netflix':   ['svc-netflix'],
    'be-spotify':   ['svc-spotify'],
    'be-unext':     ['svc-unext'],
    'be-anytime':   ['svc-anytime'],
    'be-nikkei':    ['svc-nikkei'],

    'be-apple':     ['svc-icloud', 'svc-apple-music', 'svc-apple-tv', 'svc-apple-one', 'svc-apple-arcade', 'svc-apple-app'],
    'be-microsoft': ['svc-ms365'],

    'be-ntt-east':  ['svc-flets', 'svc-hikari-denwa'],
    'be-ntt-docomo':['svc-docomo', 'svc-docomo-hikari'],

    'be-tepco':     ['svc-tepco'],
    'be-tokyo-gas': ['svc-tokyo-gas'],
    'be-water-yokohama': ['svc-water-yokohama'],

    'be-oisix':     ['svc-oisix'],

    'be-sompo-jp':  ['svc-sompo-jp'],

    /* Amazon：mixed_commerce。reachable_service_ids は意図的に空にする。
       明細に Prime を識別する証拠が無い限り candidate 化せず、
       Prime 等の想起は「サービスから探す」側の役割（§25・指示§19）。 */
    'be-amazon':    [],

    'be-mobile-suica': [],
    'be-bic-camera':   [],
    'be-times-parking':[]
  };

  /* ── price_hint（§18） ───────────────────────────────
     補助証拠。一致で判定を強められるが、不一致だけで候補から外さない。
     cycle: 'monthly' | 'annual' | ...  tolerance: 金額許容（円）      */
  const PRICE_HINT = [
    { service_id: 'svc-netflix',     amount: 1590, cycle: 'monthly', tolerance: 100 },
    { service_id: 'svc-spotify',     amount: 1080, cycle: 'monthly', tolerance: 100 },
    { service_id: 'svc-unext',       amount: 2189, cycle: 'monthly', tolerance: 50 },
    { service_id: 'svc-anytime',     amount: 8140, cycle: 'monthly', tolerance: 300 },
    { service_id: 'svc-nikkei',      amount: 4800, cycle: 'monthly', tolerance: 200 },

    { service_id: 'svc-icloud',      amount: 150,  cycle: 'monthly', tolerance: 50 },
    { service_id: 'svc-apple-music', amount: 1080, cycle: 'monthly', tolerance: 120 },
    { service_id: 'svc-apple-one',   amount: 1200, cycle: 'monthly', tolerance: 200 },
    { service_id: 'svc-apple-tv',    amount: 900,  cycle: 'monthly', tolerance: 200 },

    { service_id: 'svc-ms365',       amount: 21300, cycle: 'annual',  tolerance: 3000 },

    { service_id: 'svc-oisix',       amount: 5000, cycle: 'irregular', tolerance: 4000 }
  ];

  global.SeiZenPaymentKnowledge = {
    SERVICE_MASTER,
    BILLING_ENTITY_MASTER,
    MERCHANT_PATTERN,
    BILLING_ENTITY_SERVICE_MAP,
    PRICE_HINT,
    responseTimingForClass
  };
})(window);
