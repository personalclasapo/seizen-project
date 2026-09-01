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
     3. 各請求主体グループ内を、配下サービスの金額帯で系列に分割
        （splitByAmount。マスタを参照）
     4. 各系列の間隔の中央値で cycle を判定（§6-3。平均は使わない）

   ── 系列分割（§3-1・§4・§7-1）──────────────────────
     系列を作る単位は請求主体ではなくサービス／プランの金額帯。
     §7-1「①形 → ②金額」の②が系列を作る段階から効く。§3-1 に反しない：
     ここでマスタに問うのは「この請求主体の配下サービスはどんな金額を
     取るか」という事実だけで、契約性や domain の判定はしない。

     手順（請求主体ごと）：
       A. マスタから配下サービスの「照合に使う金額」を集める。
          - 定額（monthly / annual / bimonthly）… プランの amount
          - 従量・定期宅配（metered / subscription_box）… 金額帯を
            持たない（§7-1：金額照合しない）
       B. 金額帯を持つ請求主体
          - 取引を「一致する金額帯」ごとにまとめる → それぞれ系列
          - どの金額帯にも当たらない取引は、まとめて 1グループにし、
            それ自体が規則的なら 1系列（judge が「プラン未確定のまま
            A」で扱う・§7-1。Netflix ¥1,490 旧価格）。規則的でなければ
            1件ずつの系列にして judge で破棄（§4 の ¥650 / ¥1,200）
       C. 金額帯を持たない請求主体（従量・定期宅配・マスタ未収録）
          - 分割しない。全取引を 1系列。額が動いてもよい（§6-3）

     APPLE.COM/BILL … iCloud+ 50GB(¥150) / 200GB(¥450) / Apple One(¥1,200)
       ¥150×6 → iCloud+ 50GB の帯 → 系列
       ¥450×6 → iCloud+ 200GB の帯 → 別系列
       ¥1,200×1 → Apple One の帯だが単発 → judge で形が一致せず破棄
       ¥650×1 → どの帯にも当たらず、規則性も無い → 1件系列 → 破棄
     NETFLIX.COM ¥1,490×6 … 帯（890/1,590/1,980）に当たらないが規則的
       → 1系列。judge が「プラン未確定のまま A」（§7-1）
     TEPCO 6,294〜10,836 / OISIX 4,430〜7,840 … 金額帯を持たない
       → 割らず1系列

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
  const Master = global.SeiZenPaymentMaster;

  /* 取引額がマスタの金額帯（プラン amount）に一致するとみなす相対許容。
     定額プランは実質固定額なので、値上げ端数程度のズレだけ許す
     （judge.js の金額照合と同じ考え方）。 */
  const PLAN_AMOUNT_REL_TOLERANCE = 0.05;

  const CYCLE_BANDS = [
    ['monthly', 25, 36],
    ['bimonthly', 50, 70]
  ];

  /* 短間隔の反復（定期宅配）の判定 */
  const FREQUENT_MAX_GAP = 20;
  const FREQUENT_MIN_COUNT = 4;

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
       - 日常消費（同一店の不規則な来店）は gap が飛ぶ（13,61,72 / 42,2,26,34）
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

  /* 請求主体の配下サービスが「金額でプランを絞る」料金型のとき、その
     プラン金額の一覧を返す（重複除去・昇順）。従量・定期宅配・マスタに
     ない請求主体は空配列。実行時解決の書き戻し後にも増える（pipeline が
     再度 build を呼ぶ）。                                            */
  function planAmountsOf(merchantId) {
    if (!merchantId || !Master) return [];
    const seen = new Set();
    for (const sid of Master.servicesOf(merchantId)) {
      const svc = Master.service(sid);
      if (!svc || !Master.isAmountMatched(svc.pricing_type)) continue;
      for (const p of Master.plansOf(sid)) {
        if (p.amount != null) seen.add(p.amount);
      }
    }
    return Array.from(seen).sort((a, b) => a - b);
  }

  /* 取引額がプラン金額のどれかに一致するなら、その金額帯のキー
     （プラン金額）を返す。しなければ null。                          */
  function bandOf(amount, planAmounts) {
    for (const pa of planAmounts) {
      if (amount === pa) return pa;
      if (pa > 0 && Math.abs(amount - pa) / pa <= PLAN_AMOUNT_REL_TOLERANCE) return pa;
    }
    return null;
  }

  /* 請求主体グループ内を系列へ分割する（§3-1・§4・§7-1）。
     分割の単位は請求主体ではなく、配下サービス／プランの金額帯。

       - 金額帯を持たない請求主体（従量・定期宅配・マスタ未収録）
           分割しない。全取引を1系列（額が動いてよい・§6-3）。
       - 金額帯を持つ請求主体
           取引を一致する金額帯ごとに系列化。どの帯にも当たらない
           取引はまとめて1グループにし、それ自体が規則的なら1系列
           （judge が「プラン未確定のまま A」・§7-1）。規則的でなければ
           1件ずつの系列（judge で shape / continuity 落ち・§4）。   */
  function splitByAmount(txs, merchantId) {
    if (txs.length <= 1) return [txs.slice()];

    const planAmounts = planAmountsOf(merchantId);
    if (planAmounts.length === 0) return [txs.slice()];

    const byBand = new Map();   /* 金額帯キー -> txs[] */
    const rest = [];            /* どの帯にも当たらない取引 */
    for (const tx of txs) {
      const b = bandOf(tx.amount, planAmounts);
      if (b == null) { rest.push(tx); continue; }
      if (!byBand.has(b)) byBand.set(b, []);
      byBand.get(b).push(tx);
    }

    const out = Array.from(byBand.values());

    if (rest.length === 1) {
      out.push(rest);
    } else if (rest.length > 1) {
      /* 帯に当たらない取引群。まとめて規則的なら1系列（旧価格の
         サブスク）。そうでなければ 1件ずつ（単発の寄せ集め）。 */
      const g = gapsOf(rest.map(t => t.usage_date));
      if (classifyCycle(g) !== 'single' || isFrequent(g)) out.push(rest);
      else rest.forEach(tx => out.push([tx]));
    }

    return out.length ? out : [txs.slice()];
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

    /* 3) 請求主体ごとに、配下サービスの金額帯で系列分割 → series 生成 */
    const series = [];
    for (const { merchant_id, merchant_raw, txs } of byEntity.values()) {
      for (const group of splitByAmount(txs, merchant_id)) {
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
    _internal: { classifyCycle, isFrequent, splitByAmount, gapsOf, median }
  };
})(window);
