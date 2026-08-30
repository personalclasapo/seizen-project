/* SeiZen プロトタイプ｜支払い明細から探す：Detection Engine
   ------------------------------------------------------------------
   基準設計 §11〜§34 / 指示 §3・§11〜§25 に対応。

   共通 transaction[] を入力に、payment_candidate[] を生成する。
   ブラウザ内で完結（指示§27）。

   パイプライン（指示§3）：
     transaction
     ↓ discovery_role 付与（§11）
     ↓ Merchant Pattern 照合 → billing_entity（§14）
     ↓ 分割・リボ・refund の周期除外（§12・§22・指示§8§9）
     ↓ Grouping（§19）
     ↓ 周期・金額特徴（§21）
     ↓ service_identification（§24）
     ↓ contract_assessment（§25）
     ↓ domain_status（§26）
     ↓ response_class / response_timing 導出（§27）
     ↓ payment_candidate + reason_codes（§33）

   第1増分で実装しない（指示§26）：既存契約照合の実処理、現在性の厳密判定、
   scan 間状態、永続化。observation_continuity は算出のみ・受入条件にしない。
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const K = global.SeiZenPaymentKnowledge;

  /* ── Merchant Pattern 照合（§14） ─────────────────────
     description_normalized に対し、priority → 具体度 の順で一意に決める。
     決められなければ billing_entity_id = null。 */
  function matchBillingEntity(descNorm) {
    const hits = [];
    for (const p of K.MERCHANT_PATTERN) {
      let matched = false;
      if (p.match_type === 'exact') matched = descNorm === p.pattern;
      else if (p.match_type === 'prefix') matched = descNorm.indexOf(p.pattern) === 0;
      else if (p.match_type === 'regex') {
        try { matched = new RegExp(p.pattern).test(descNorm); } catch (e) { matched = false; }
      }
      if (matched) hits.push(p);
    }
    if (hits.length === 0) return { billing_entity_id: null, matched_pattern: null };

    hits.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.pattern.length - a.pattern.length; /* 具体度の代理 */
    });
    /* トップと同 priority の別 billing_entity が残るなら unknown 扱い */
    const top = hits[0];
    const rivals = hits.filter(h => h.priority === top.priority &&
      h.billing_entity_id !== top.billing_entity_id);
    if (rivals.length > 0) return { billing_entity_id: null, matched_pattern: null };
    return { billing_entity_id: top.billing_entity_id, matched_pattern: top.pattern };
  }

  /* ── discovery_role（§11） ────────────────────────────
     第1増分の対象 CSV はカード明細のみ。カード利用代金・チャージ等の
     payment_path は今回の CSV には出てこない。曖昧なものは
     contract_candidate に残し後段で落とす（§11 末尾）。
     refund は候補証拠から除外（指示§9）。 */
  function assignDiscoveryRole(tx) {
    if (tx.transaction_nature === 'refund') return 'ignore_evidence';
    return 'contract_candidate';
  }

  /* ── Grouping（§19） ─────────────────────────────────
     基本キー: payment_source + billing_entity。
     一つの請求主体から複数系列が出る場合は金額帯で補助分離。
     billing_entity 不明のものは merchant_signature（正規化表記）でまとめる。 */
  function amountBand(amount) {
    /* 対数的なざっくり帯。Apple 150 / 650 / 1200 を分離できる粒度。 */
    const a = Math.abs(amount);
    if (a < 300) return 'b0';
    if (a < 800) return 'b1';
    if (a < 2000) return 'b2';
    if (a < 6000) return 'b3';
    if (a < 15000) return 'b4';
    return 'b5';
  }

  function groupKey(tx, beId, splitByAmount) {
    const base = beId
      ? `${tx.payment_source_id}|be:${beId}`
      : `${tx.payment_source_id}|ms:${tx.description_normalized}`;
    return splitByAmount ? `${base}|${amountBand(tx.amount)}` : base;
  }

  /* ── 周期特徴（§21） ─────────────────────────────────── */
  const CYCLE_BANDS = [
    ['WEEKLY', 5, 9],
    ['MONTHLY', 25, 35],
    ['BIMONTHLY', 50, 70],
    ['QUARTERLY', 80, 100],
    ['SEMIANNUAL', 160, 200],
    ['ANNUAL', 330, 400]
  ];

  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }

  function observedCycle(dates) {
    const uniq = Array.from(new Set(dates)).sort();
    if (uniq.length < 2) return 'INSUFFICIENT_DATA';
    const gaps = [];
    for (let i = 1; i < uniq.length; i++) gaps.push(daysBetween(uniq[i - 1], uniq[i]));
    const median = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    for (const [name, lo, hi] of CYCLE_BANDS) {
      if (median >= lo && median <= hi) {
        /* ばらつきが大きすぎれば IRREGULAR */
        const within = gaps.filter(g => g >= lo * 0.6 && g <= hi * 1.6).length;
        if (within / gaps.length >= 0.6) return name;
      }
    }
    return 'IRREGULAR';
  }

  function amountBehavior(amounts) {
    if (amounts.length < 2) return 'STABLE';
    const min = Math.min(...amounts), max = Math.max(...amounts);
    if (min === max) return 'STABLE';
    const ratio = (max - min) / max;
    if (ratio <= 0.1) return 'STABLE';
    if (ratio <= 0.5) return 'MODERATE';
    return 'VARIABLE';
  }

  function median(nums) {
    const s = nums.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /* ── price_hint 照合（§18・補助証拠） ─────────────────── */
  function priceHintsFor(serviceId, repAmount) {
    return K.PRICE_HINT.filter(h => h.service_id === serviceId)
      .map(h => ({ ...h, match: Math.abs(h.amount - repAmount) <= h.tolerance }));
  }

  /* ── service_identification（§24） ───────────────────── */
  function identifyService(beId, series) {
    const reachable = (K.BILLING_ENTITY_SERVICE_MAP[beId] || []).slice();
    const reasons = [];

    if (!beId) {
      return { service_identification: 'unknown', identified_service_id: null,
        candidate_service_ids: [], reachable_service_ids: [], reasons: ['merchant_unknown'] };
    }
    if (reachable.length === 0) {
      return { service_identification: 'unknown', identified_service_id: null,
        candidate_service_ids: [], reachable_service_ids: [], reasons: ['no_reachable_service'] };
    }

    /* 明細証拠（Merchant Pattern 一致）は前提として満たされている。
       reachable が 1 かつ 矛盾証拠なし → identified（§24）。
       単に map に1件しかない「だけ」では identified にしない、という条件は
       「Merchant Pattern 一致という明細証拠」が別途あることで満たす。 */
    if (reachable.length === 1) {
      reasons.push('merchant_pattern_match', 'single_reachable_service');
      const hints = priceHintsFor(reachable[0], series.representative_amount);
      if (hints.some(h => h.match)) reasons.push('price_hint_match');
      return { service_identification: 'identified', identified_service_id: reachable[0],
        candidate_service_ids: reachable, reachable_service_ids: reachable, reasons };
    }

    /* 複数 reachable → candidates。
       price_hint は候補を「除外」せず「並べ替え」に使う（指示§17）。
       reachable 候補は全件残し、price_hint 一致を先頭へ寄せる。 */
    reasons.push('merchant_pattern_match', 'multiple_reachable_services');
    const matched = [], rest = [];
    for (const sid of reachable) {
      (priceHintsFor(sid, series.representative_amount).some(h => h.match) ? matched : rest).push(sid);
    }
    if (matched.length > 0 && matched.length < reachable.length) reasons.push('price_hint_reordered');
    return { service_identification: 'candidates', identified_service_id: null,
      candidate_service_ids: matched.concat(rest), reachable_service_ids: reachable, reasons };
  }

  /* ── contract_assessment（§25） ──────────────────────── */
  function assessContract(beId, series, ident) {
    const be = K.BILLING_ENTITY_MASTER[beId];
    const reasons = [];
    const cyc = series.observed_cycle;
    const n = series.occurrence_count;

    if (series.has_refund_only) return { contract_assessment: 'not_contract', reasons: ['refund_only'] };

    /* installment / revolving の繰り返しは契約周期証拠にしない（§12・§22） */
    if (series.dominant_payment_method === 'installment' || series.dominant_payment_method === 'revolving') {
      return { contract_assessment: 'not_contract',
        reasons: [series.dominant_payment_method === 'installment' ? 'installment_series' : 'revolving_series'] };
    }
    /* usage_date/amount 同一で billing_period だけ違う系列も月額契約にしない（§12） */
    if (series.installment_like_split) {
      return { contract_assessment: 'not_contract', reasons: ['installment_like_billing_split'] };
    }

    if (!be) {
      /* 未知加盟店（§25 末尾・指示§25）：サービス未特定でも「明確な周期」が
         あれば候補として残す。ただし通常購買（金額バラバラ・不規則）を
         周期契約と誤検出しないよう、規則的周期に加えて金額が概ね一定で
         あることを要求する。1回だけ・他証拠なしは not_contract。 */
      const regularCycle = ['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'ANNUAL', 'SEMIANNUAL'].indexOf(cyc) !== -1;
      if (regularCycle && series.amount_behavior === 'STABLE') {
        return { contract_assessment: 'possible', reasons: ['unknown_merchant_regular_cycle', 'stable_amount'] };
      }
      return { contract_assessment: 'not_contract', reasons: ['unknown_merchant_no_contract_evidence'] };
    }

    /* 継続契約専用の請求主体（one_time 不可）＝強い証拠（§25 Netflix 等） */
    if (be.contract_capability && !be.one_time_purchase_capability) {
      if (['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'].indexOf(cyc) !== -1) {
        reasons.push('subscription_only_entity', 'regular_cycle');
        return { contract_assessment: 'likely', reasons };
      }
      if (n === 1 && be.billing_pattern === 'annual_or_long_cycle') {
        reasons.push('subscription_only_entity', 'single_annual_charge');
        return { contract_assessment: 'likely', reasons };
      }
      /* utility 等は金額変動を許容し請求主体＋周期を主証拠に（§25） */
      if (be.merchant_type === 'utility' || be.merchant_type === 'telecom') {
        reasons.push('utility_or_telecom_entity');
        if (cyc !== 'INSUFFICIENT_DATA' && cyc !== 'IRREGULAR') { reasons.push('regular_cycle'); return { contract_assessment: 'likely', reasons }; }
        return { contract_assessment: 'possible', reasons };
      }
      reasons.push('subscription_only_entity');
      return { contract_assessment: cyc === 'INSUFFICIENT_DATA' ? 'possible' : 'likely', reasons };
    }

    /* billing_platform（Apple / Microsoft）：mixed */
    if (be.merchant_type === 'billing_platform') {
      if (['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'].indexOf(cyc) !== -1) {
        reasons.push('billing_platform', 'regular_cycle');
        return { contract_assessment: 'likely', reasons };
      }
      /* 年額料金との一致がある単発（§25 年額1回・指示§25 Microsoft 365） */
      const annualMatch = series.candidate_service_ids.some(sid =>
        priceHintsFor(sid, series.representative_amount).some(h => h.match && h.cycle === 'annual'));
      if (n === 1 && annualMatch) {
        reasons.push('billing_platform', 'single_charge_matches_annual_price');
        return { contract_assessment: 'likely', reasons };
      }
      /* 単発・周期不明 → possible（§46 Apple単発） */
      reasons.push('billing_platform', 'single_or_irregular_charge');
      return { contract_assessment: 'possible', reasons };
    }

    /* 注文型継続契約（§25）：周期・金額が不安定でも not_contract にしない */
    if (be.billing_pattern === 'order_based_recurring') {
      reasons.push('order_based_recurring_entity');
      if (n >= 3) { reasons.push('repeated_orders'); return { contract_assessment: 'likely', reasons }; }
      return { contract_assessment: 'possible', reasons };
    }

    /* mixed_commerce（Amazon 等）：頻繁利用だけでは契約にしない（§25） */
    if (be.merchant_type === 'mixed_commerce') {
      const hasContractEvidence =
        ['MONTHLY', 'ANNUAL', 'QUARTERLY', 'SEMIANNUAL'].indexOf(cyc) !== -1 &&
        series.amount_behavior === 'STABLE';
      if (hasContractEvidence) { reasons.push('mixed_commerce_regular_stable'); return { contract_assessment: 'possible', reasons }; }
      reasons.push('mixed_commerce_normal_purchase_explains_series');
      return { contract_assessment: 'not_contract', reasons };
    }

    /* normal_retail / その他 one_time 可能：通常購買で説明でき、
       追加の契約証拠が無ければ not_contract（§25） */
    if (be.one_time_purchase_capability && !be.contract_capability) {
      reasons.push('one_time_capable_entity_no_contract_evidence');
      return { contract_assessment: 'not_contract', reasons };
    }

    /* usage_based_recurring（TIMES PARKING 等）：不規則・契約固有証拠なし */
    if (be.billing_pattern === 'usage_based_recurring') {
      reasons.push('usage_based_no_contract_specific_evidence');
      return { contract_assessment: 'not_contract', reasons };
    }

    reasons.push('insufficient_contract_evidence');
    return { contract_assessment: cyc === 'MONTHLY' ? 'possible' : 'not_contract', reasons };
  }

  /* ── domain_status（§26） ────────────────────────────── */
  function assessDomain(candidateServiceIds, identification) {
    if (!candidateServiceIds.length) return 'unknown';
    const domains = candidateServiceIds.map(sid => {
      const s = K.SERVICE_MASTER[sid];
      return s ? s.seizen_domain : null;
    });
    if (domains.some(d => d == null)) return 'unknown';
    const uniq = Array.from(new Set(domains));
    if (uniq.length === 1) return uniq[0] === 'contract_digital' ? 'in_scope' : 'out_of_scope';
    if (uniq.indexOf('contract_digital') !== -1) return 'unknown';
    return 'out_of_scope';
  }

  /* ── response_class / timing 導出（§27・§33） ─────────── */
  function deriveResponse(identification, identifiedServiceId, candidateServiceIds) {
    if (identification === 'identified' && identifiedServiceId) {
      const s = K.SERVICE_MASTER[identifiedServiceId];
      const cls = s ? s.response_class : null;
      return { derived_response_class: cls, derived_response_timing: K.responseTimingForClass(cls) };
    }
    if (identification === 'candidates' && candidateServiceIds.length) {
      const classes = Array.from(new Set(candidateServiceIds.map(sid => {
        const s = K.SERVICE_MASTER[sid]; return s ? s.response_class : null;
      })));
      const timings = Array.from(new Set(candidateServiceIds.map(sid => {
        const s = K.SERVICE_MASTER[sid];
        return s ? K.responseTimingForClass(s.response_class) : null;
      })));
      return {
        derived_response_class: classes.length === 1 ? classes[0] : null,
        derived_response_timing: (timings.length === 1 && timings[0]) ? timings[0] : null
      };
    }
    return { derived_response_class: null, derived_response_timing: null };
  }

  /* ── 現在性（§34・算出のみ／受入条件にしない） ──────── */
  function observationContinuity(lastDate, cycle, coverageTo) {
    if (!coverageTo || cycle === 'INSUFFICIENT_DATA' || cycle === 'IRREGULAR') return 'INSUFFICIENT_DATA';
    const cycleDays = { WEEKLY: 7, MONTHLY: 31, BIMONTHLY: 62, QUARTERLY: 93, SEMIANNUAL: 186, ANNUAL: 372 }[cycle];
    if (!cycleDays) return 'INSUFFICIENT_DATA';
    const gap = daysBetween(lastDate, coverageTo);
    if (gap <= cycleDays * 1.5) return 'THROUGH_PERIOD_END';
    return 'STOPPED_WITHIN_PERIOD';
  }

  /* ── メイン ───────────────────────────────────────────
     run(transactions, { coverage, scan_id, target_person_id }) → { candidates } */
  function run(transactions, opts) {
    opts = opts || {};
    const coverage = opts.coverage || {};
    const scanId = opts.scan_id || 'scan-local';
    const targetPersonId = opts.target_person_id || 'target-local';

    /* 1) discovery_role + billing_entity 付与 */
    const enriched = transactions.map(tx => {
      const role = assignDiscoveryRole(tx);
      const m = matchBillingEntity(tx.description_normalized);
      return { ...tx, discovery_role: role, billing_entity_id: m.billing_entity_id, matched_pattern: m.matched_pattern };
    });

    /* 2) Grouping。まず billing_entity 単位、複数系列が疑われる請求主体
          （billing_platform / order_based は金額帯で分割）だけ splitByAmount。 */
    const splitEntities = new Set();
    Object.keys(K.BILLING_ENTITY_MASTER).forEach(id => {
      const be = K.BILLING_ENTITY_MASTER[id];
      if (be.merchant_type === 'billing_platform') splitEntities.add(id);
    });

    const groups = new Map();
    for (const tx of enriched) {
      if (tx.discovery_role === 'ignore_evidence') {
        /* refund は所属グループに参照だけ残し、証拠計算からは除外 */
      }
      const split = tx.billing_entity_id && splitEntities.has(tx.billing_entity_id);
      const key = groupKey(tx, tx.billing_entity_id, split);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tx);
    }

    /* 3) 系列ごとに特徴 → 判定 → candidate 生成 */
    const candidates = [];
    let idx = 0;
    for (const [key, txs] of groups) {
      idx++;
      const beId = txs[0].billing_entity_id;
      const evidenceTxs = txs.filter(t => t.discovery_role === 'contract_candidate' &&
        t.transaction_nature !== 'refund');
      const refundTxs = txs.filter(t => t.transaction_nature === 'refund');

      const hasRefundOnly = evidenceTxs.length === 0 && refundTxs.length > 0;

      const dates = evidenceTxs.map(t => t.usage_date);
      const amounts = evidenceTxs.map(t => t.amount);

      /* installment 判定 */
      const pmCounts = {};
      evidenceTxs.forEach(t => { pmCounts[t.payment_method] = (pmCounts[t.payment_method] || 0) + 1; });
      const dominantPm = Object.keys(pmCounts).sort((a, b) => pmCounts[b] - pmCounts[a])[0] || 'unknown';

      /* usage_date+amount 同一で billing_period だけ違う → 分割相当（§12） */
      const byUsageAmount = {};
      evidenceTxs.forEach(t => {
        const k = `${t.usage_date}|${t.amount}`;
        byUsageAmount[k] = byUsageAmount[k] || new Set();
        if (t.billing_period) byUsageAmount[k].add(t.billing_period);
      });
      const installmentLikeSplit =
        dominantPm !== 'installment' &&
        Object.values(byUsageAmount).some(set => set.size >= 2) &&
        Object.keys(byUsageAmount).length <= 2;

      const repAmount = amounts.length ? median(amounts) : (refundTxs.length ? Math.abs(refundTxs[0].amount) : 0);
      const cycle = observedCycle(dates);
      const behavior = amountBehavior(amounts);

      const series = {
        representative_amount: repAmount,
        occurrence_count: evidenceTxs.length,
        observed_cycle: cycle,
        amount_behavior: behavior,
        dominant_payment_method: dominantPm,
        installment_like_split: installmentLikeSplit,
        has_refund_only: hasRefundOnly,
        candidate_service_ids: (K.BILLING_ENTITY_SERVICE_MAP[beId] || []).slice()
      };

      const ident = identifyService(beId, series);
      series.candidate_service_ids = ident.candidate_service_ids;

      const assess = assessContract(beId, series, ident);
      const domain = assessDomain(ident.candidate_service_ids, ident.service_identification);
      const resp = deriveResponse(ident.service_identification, ident.identified_service_id, ident.candidate_service_ids);

      const sortedDates = Array.from(new Set(dates)).sort();
      const firstObserved = sortedDates[0] || null;
      const lastObserved = sortedDates[sortedDates.length - 1] || null;

      const reason_codes = []
        .concat(ident.reasons.map(r => `id:${r}`))
        .concat(assess.reasons.map(r => `ca:${r}`))
        .concat([`domain:${domain}`]);
      if (dominantPm === 'installment') reason_codes.push('meta:installment_total_' + (evidenceTxs.find(t => t.installment_total) || {}).installment_total);

      candidates.push({
        candidate_id: `${scanId}:cand:${idx}`,
        scan_id: scanId,
        target_person_id: targetPersonId,
        payment_source_id: txs[0].payment_source_id,
        group_key: key,

        billing_entity_id: beId,
        billing_entity_name: beId && K.BILLING_ENTITY_MASTER[beId] ? K.BILLING_ENTITY_MASTER[beId].billing_entity_name : null,
        merchant_signature: beId ? null : txs[0].description_normalized,
        display_descriptor: txs[0].description_raw,

        identified_service_id: ident.identified_service_id,
        candidate_service_ids: ident.candidate_service_ids,
        reachable_service_ids: ident.reachable_service_ids,

        service_identification: ident.service_identification,
        contract_assessment: assess.contract_assessment,
        domain_status: domain,

        observed_cycle: cycle,
        amount_behavior: behavior,
        representative_amount: repAmount,
        occurrence_count: evidenceTxs.length,

        first_observed_at: firstObserved,
        last_observed_at: lastObserved,

        observation_continuity: observationContinuity(lastObserved, cycle, coverage.coverage_to),
        data_age_days: null, /* §10：今回決めない */

        derived_response_class: resp.derived_response_class,
        derived_response_timing: resp.derived_response_timing,

        payment_method: dominantPm,
        installment_number_seen: evidenceTxs.map(t => t.installment_number).filter(x => x != null),
        installment_total: (evidenceTxs.find(t => t.installment_total) || {}).installment_total || null,

        has_refund: refundTxs.length > 0,

        reason_codes
      });
    }

    return {
      scan: {
        scan_id: scanId,
        target_person_id: targetPersonId,
        coverage_from: coverage.coverage_from || null,
        coverage_to: coverage.coverage_to || null,
        coverage_status: coverage.coverage_status || 'unknown',
        transaction_count: transactions.length,
        candidate_count: candidates.length
      },
      candidates
    };
  }

  /* ── Step3 表示判定（§21・§25・合意事項③） ────────────
     service_identification 単独では決めない。
     identification × contract_assessment × domain_status を組み合わせる。 */
  function step3View(cand) {
    const { service_identification: si, contract_assessment: ca, domain_status: ds } = cand;

    if (ca === 'not_contract') return { show: false, reason: 'not_contract' };
    if (ds === 'out_of_scope') return { show: false, reason: 'out_of_scope' };
    if (cand.has_refund && cand.occurrence_count === 0) return { show: false, reason: 'refund_only' };

    /* 未知加盟店1回・他証拠なしは assessContract 側で not_contract 済み */

    if (ds === 'unknown') {
      return { show: true, state: 'domain_unknown',
        label: '内容の確認が必要な発見', tone: 'warn' };
    }

    /* ここから domain in_scope */
    if (si === 'identified') {
      if (ca === 'likely') return { show: true, state: 'found', label: '継続利用として見つかりました', tone: 'ok' };
      return { show: true, state: 'confirm_contract', label: '継続して利用しているか確認', tone: 'warn' };
    }
    if (si === 'candidates') {
      return { show: true, state: 'confirm_service', label: 'どのサービスか確認が必要', tone: 'warn' };
    }
    /* si unknown だが in_scope（ユーザーが把握していれば custom）＝表示 */
    return { show: true, state: 'confirm_unknown', label: '内容の確認が必要', tone: 'warn' };
  }

  global.SeiZenPaymentEngine = { run, step3View, _internal: { matchBillingEntity, observedCycle, amountBehavior } };
})(window);
