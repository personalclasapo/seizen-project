/* SeiZen プロトタイプ｜支払い明細から探す：系列化
   ------------------------------------------------------------------
   設計「支払い明細から探す」§4 / §6-2 / §6-3 に対応。

   正規化済みの取引配列を「支払い系列」に畳む。

     系列 = 同一請求主体のうち、周期と金額帯が揃うまとまり（§4）。
     1つの請求主体が複数の系列に分かれる（APPLE.COM/BILL の ¥150×6 /
     ¥1,200×1 / ¥650×1 → 3系列）。

   ── 手順 ─────────────────────────────────────────────
     1. merchant_norm でグルーピング
     2. 各グループを resolver.identify で merchant_id へ（null あり）。
        同一 merchant_id に別 merchant_norm が寄ることがあるので、
        merchant_id（無ければ merchant_norm）で再グルーピング
     3. 各請求主体グループ内を利用日順に並べ、金額の飛びで系列に分割
     4. 各系列の間隔の中央値で cycle を判定（§6-3。平均は使わない）

   ── 系列分割の金額しきい値（実装判断・§5 報告事項）──────
     同一請求主体内の取引を「金額バンド」で分ける。バンド境は
     AMOUNT_BAND_EDGES。異なるバンドの取引は別系列にする。
     §4-3 の APPLE.COM/BILL（¥150 / ¥650 / ¥1,200 → 3系列）で
     追い込んだ境界。¥150→bandA / ¥650→bandB / ¥1,200→bandC。
     一方、従量請求の窓（TEPCO 6,294〜10,836 / ドコモ 5,764〜6,425 /
     東京ガス 3,552〜5,124 / OISIX 4,430〜7,840）はいずれも単一バンドに
     収まるよう境界を選び、変動系列を割らない。

   ── cycle 帯（§6-3・weekly は持たない）─────────────────
     monthly   : 25–36 日
     bimonthly : 50–70 日
     single    : 上記外、または n=1

     設計 §6-3 は weekly（7日前後）を挙げているが、実際に「毎週定額で
     課金される契約」はほぼ存在しない。毎週ペースの反復は「定期宅配の
     注文の集積」（OISIX 等）であって契約の周期ではない。これは cycle
     ではなく is_frequent（下記）で扱い、マスタにある請求主体に限って
     継続契約と見なす。マスタにない短間隔反復は日常消費として破棄する。

   ── is_frequent（短間隔の反復）──────────────────────
     間隔の中央値 < FREQUENT_MAX_GAP 日 かつ n >= FREQUENT_MIN_COUNT。
     定期宅配（pricing_type = subscription_box）の形の照合に使う（§7-1）。

   出力 series（設計 §2-1）：
     merchant_raw, merchant_id,
     cycle, is_frequent, amount_min, amount_max, amount_is_fixed,
     amount_repr,           金額でプランを絞るときの代表額（= amount_min）
     first_seen, last_seen, count
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const Resolver = global.SeiZenPaymentResolver;

  /* 金額バンドの境（円）。同一バンド内は同系列、跨ぐと別系列。 */
  const AMOUNT_BAND_EDGES = [400, 1000, 3000, 20000];

  const CYCLE_BANDS = [
    ['monthly', 25, 36],
    ['bimonthly', 50, 70]
  ];

  /* 短間隔の反復（定期宅配）の判定 */
  const FREQUENT_MAX_GAP = 20;
  const FREQUENT_MIN_COUNT = 4;

  function amountBand(amount) {
    let b = 0;
    for (const e of AMOUNT_BAND_EDGES) { if (amount >= e) b++; else break; }
    return b;
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }

  function median(nums) {
    if (!nums.length) return 0;
    const s = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  /* 系列の周期。隣接間隔の中央値を帯に当てる。
     契約の周期は「毎回ほぼその間隔で来る」ものなので、中央値が帯に
     入るだけでなく、ほぼ全ての間隔が帯に収まっていることを要求する。
       - 実データ：本物の契約は全 gap が帯内（30,31,30… / 61,61）
       - 日常消費の金額バンド分割片は gap が飛ぶ（13,61,72 / 42,2,26,34）
     許容は「帯外の gap が1本まで、かつ帯外の gap も帯を大きく超えない」。
     weekly 帯は持たない（毎週定額の契約はほぼ存在しない）。         */
  function classifyCycle(gaps) {
    if (gaps.length < 1) return 'single';
    const med = median(gaps);
    /* 帯外の gap を許す本数：長い系列（gap 5本以上）でだけ1本まで。
       短い系列は全 gap が帯内であることを要求する。 */
    const allowOut = gaps.length >= 5 ? 1 : 0;
    for (const [name, lo, hi] of CYCLE_BANDS) {
      if (med < lo || med > hi) continue;
      const outOfBand = gaps.filter(g => g < lo || g > hi).length;
      if (outOfBand <= allowOut) return name;
    }
    return 'single';
  }

  /* 短間隔の反復か（定期宅配の形の照合に使う・§7-1）。 */
  function isFrequent(gaps) {
    return gaps.length + 1 >= FREQUENT_MIN_COUNT &&
      median(gaps) > 0 && median(gaps) < FREQUENT_MAX_GAP;
  }

  /* 請求主体グループ内を金額バンドで系列へ分割。バンドが同じ取引を
     まとめる。バンド跨ぎは別系列（APPLE ¥150 / ¥650 / ¥1,200）。   */
  function splitByAmount(txs) {
    const buckets = new Map(); /* band -> txs[] */
    for (const tx of txs) {
      const b = amountBand(tx.amount);
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b).push(tx);
    }
    return Array.from(buckets.values());
  }

  /* 隣接する利用日の間隔（日）の配列。 */
  function gapsOf(dates) {
    const uniq = Array.from(new Set(dates)).sort();
    const gaps = [];
    for (let i = 1; i < uniq.length; i++) gaps.push(daysBetween(uniq[i - 1], uniq[i]));
    return gaps;
  }

  function buildSeries(merchantRaw, merchantId, txs) {
    const dates = txs.map(t => t.usage_date).sort();
    const amounts = txs.map(t => t.amount);
    const amount_min = Math.min(...amounts);
    const amount_max = Math.max(...amounts);
    const gaps = gapsOf(dates);
    return {
      merchant_raw: merchantRaw,
      merchant_norm: txs[0].merchant_norm,
      merchant_id: merchantId,
      cycle: classifyCycle(gaps),
      is_frequent: isFrequent(gaps),
      amount_min,
      amount_max,
      amount_is_fixed: amount_min === amount_max,
      amount_repr: amount_min,
      first_seen: dates[0],
      last_seen: dates[dates.length - 1],
      count: txs.length,
      gaps: gaps
    };
  }

  /* transactions → { series: series[], unresolved: series[] }
     unresolved は merchant_id === null の系列（resolveUnknown へ渡す分）。 */
  function build(transactions) {
    /* 1) merchant_norm でまとめ、identify で merchant_id を引く */
    const byNorm = new Map();
    for (const tx of transactions) {
      if (!byNorm.has(tx.merchant_norm)) byNorm.set(tx.merchant_norm, []);
      byNorm.get(tx.merchant_norm).push(tx);
    }

    /* 2) merchant_id（無ければ norm）で再グルーピング */
    const byEntity = new Map(); /* key -> { merchant_id, merchant_raw, txs: [] } */
    for (const [norm, txs] of byNorm) {
      const merchantId = Resolver.identify(txs[0].merchant_raw, norm);
      const key = merchantId || ('norm:' + norm);
      if (!byEntity.has(key)) {
        byEntity.set(key, { merchant_id: merchantId, merchant_raw: txs[0].merchant_raw, txs: [] });
      }
      const bucket = byEntity.get(key);
      bucket.txs.push(...txs);
      /* 表示用 merchant_raw は最頻の生表記にしたいが、簡便に最初のものを使う */
    }

    /* 3) 請求主体ごとに金額で系列分割 → series 生成 */
    const series = [];
    for (const { merchant_id, merchant_raw, txs } of byEntity.values()) {
      for (const group of splitByAmount(txs)) {
        series.push(buildSeries(merchant_raw, merchant_id, group));
      }
    }

    return {
      series,
      unresolved: series.filter(s => s.merchant_id == null)
    };
  }

  global.SeiZenPaymentSeries = {
    build,
    _internal: { classifyCycle, isFrequent, splitByAmount, amountBand, gapsOf, median, AMOUNT_BAND_EDGES }
  };
})(window);
