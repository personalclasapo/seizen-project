/* SeiZen プロトタイプ｜支払い明細から探す：判定
   ------------------------------------------------------------------
   設計「支払い明細から探す」§7 / §9 / §10 に対応。

   系列を1つ受け取り、判定木（§7）をそのまま辿って candidate を返す。
   周期・金額を単独のゲートとして先に置かない（§7 冒頭）。

   ── 判定木（§7）─────────────────────────────────────
     系列
     └ 請求主体をマスタ照合
         ├ マスタにない
         │   └ 継続性の判定（§7-4：C経路にのみ適用）
         │        ├ 継続性なし        → 破棄
         │        └ 継続性あり        → C（名前と対応時期を入力させる）
         └ マスタにある
             ├ type == payment_method → payment_method（§3-4 誘導。候補外）
             ├ type == out_of_scope   → 破棄（通知もしない・§8-2）
             └ type == normal
                 └ 配下 service を「形」で照合
                      （定額/従量 … cycle 帯 × pricing_type、
                       定期宅配 … series.is_frequent × subscription_box）
                     ├ 0 件残る       → 破棄
                     ├ 1 件残る       → A（下でプラン照合）
                     └ 複数残る
                         └ 金額でプランを絞る（定額型のみ）
                             ├ 1 service に絞れる → A
                             ├ 2 service 以上が同額で並ぶ → B（options = 絞れた集合）
                             └ どれも金額が当たらない    → B（options = 形一致の全 service）

   ── プラン照合（§7-1）──────────────────────────────
     pricing_type ∈ {metered, subscription_box} … 金額照合しない。plan_id=null
     それ以外 … plan.amount と系列の金額を照合
       一致   → plan_id 確定
       不一致 → plan_id=null（候補からは落とさない。旧価格のケース）

   ── 金額照合の許容（実装判断・§5 報告事項）────────────
     全体一律の許容幅は持たない（§7-1 明記）。プラン amount が
       系列の [amount_min, amount_max] に入る、または
       |plan.amount - amount_repr| / plan.amount <= 0.05
     のいずれかで「一致」とする。定額型は実質固定額なのでこれで足りる。

   ── 継続性の判定（§7-4：マスタにない請求主体のみ）──────
     マスタにない請求主体は料金型と照合できず、判定材料が反復しか
     ない。判定材料は「間隔が契約の周期としてあり得る長さで規則的に
     並んでいるか」＝ series.cycle が monthly / bimonthly のいずれかに
     判定できたか、とする（cycle 判定に規則性チェックが内包される）。
     加えて n >= CONTINUITY_MIN_COUNT。マスタにある請求主体には
     適用しない（OISIX の短間隔反復は is_frequent で拾う）。
     §7-4 の実データ：
       日経新聞（契約）  gaps 32,28,33,28,32  → monthly     → C
       SEIYU（消費）     gaps 6,7,34,1,40...  → single       → 破棄
       TIMES（都度駐車） gaps 4,60,19,24...   → single       → 破棄
       ENEOS（給油）     gaps 39,45,47        → 中央42・帯外 → 破棄
     「毎月同じ金額でコンビニ」のような偶然の一致はほぼ起きないが、
     残った場合は画面で外せる（§7-4「誤って候補に出す方がマシ」）。

   ── 対応時期（§10-1）───────────────────────────────
     service 確定時（A / B選択後）… svc.survivor_can_complete が
       true → 'post'（そのとき） / それ以外 → 'pre'（いまのうち）
       ＝「遺族が本人の生前準備なしに手続きを完了できるか」で決まる。
       死後の解約導線が存在するか（post_mortem_procedure の有無）では
       ない（§10-2）。
     C … response_timing はユーザー入力（'pre' | 'post' | 'unknown'）

   出力 candidate（設計 §2-2 + 表示に要る派生）：
     status            : 'A' | 'B' | 'C' | 'payment_method' | (registered は reconcile で付与)
     series            : 元の series
     merchant_id, merchant_name
     service_id        : A のとき確定 / B は選択後 / C は null
     plan_id           : 確定できないとき null
     options           : B のときの候補 service 群 [{ service_id, name, category }]
     domain            : 'contract_digital' 固定（C）または service の domain
     response_timing   : 'pre' | 'post' | null（C は選択待ち）
     drop_reason       : 破棄のとき理由（ログ用・画面には出さない）
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const M = global.SeiZenPaymentMaster;

  const AMOUNT_REL_TOLERANCE = 0.05;

  /* §7-4：マスタにない請求主体の継続性判定 */
  const CONTINUITY_MIN_COUNT = 3;

  function hasContinuity(series) {
    if (series.count < CONTINUITY_MIN_COUNT) return false;
    return series.cycle === 'monthly' || series.cycle === 'bimonthly';
  }

  function amountMatchesPlan(series, plan) {
    if (plan.amount == null) return false;
    if (plan.amount >= series.amount_min && plan.amount <= series.amount_max) return true;
    return Math.abs(plan.amount - series.amount_repr) / plan.amount <= AMOUNT_REL_TOLERANCE;
  }

  /* service 確定後のプラン照合。plan_id（or null）を返す。 */
  function matchPlan(serviceId, series) {
    const svc = M.service(serviceId);
    if (!svc || !M.isAmountMatched(svc.pricing_type)) return null; /* 従量・宅配は金額照合しない */
    const plans = M.plansOf(serviceId);
    const hit = plans.find(p => amountMatchesPlan(series, p));
    return hit ? hit.plan_id : null; /* 不一致でも落とさない（§7-1） */
  }

  /* 対応時期（§10-1）。判定根拠は「遺族が本人の生前準備なしに手続きを
     完了できるか」（survivor_can_complete）であって、死後の解約導線が
     存在するか（post_mortem_procedure の有無）ではない（§10-2）。 */
  function timingFor(serviceId) {
    const svc = M.service(serviceId);
    if (!svc) return null;
    return svc.survivor_can_complete === true ? 'post' : 'pre';
  }

  function drop(series, reason) {
    return { status: 'drop', series, drop_reason: reason };
  }

  function judge(series) {
    const m = M.merchant(series.merchant_id);

    /* ── マスタにない ── */
    if (!series.merchant_id || !m) {
      if (!hasContinuity(series)) return drop(series, 'unknown_merchant_no_continuity');
      return {
        status: 'C',
        series,
        merchant_id: null,
        merchant_name: series.merchant_raw,
        service_id: null,
        plan_id: null,
        options: [],
        domain: 'contract_digital',
        response_timing: null /* ユーザー入力待ち */
      };
    }

    /* ── マスタにある ── */
    if (m.type === 'payment_method') {
      return { status: 'payment_method', series, merchant_id: series.merchant_id, merchant_name: m.name };
    }
    if (m.type === 'out_of_scope') {
      return drop(series, 'out_of_scope');
    }

    /* type === normal：配下 service を「形」で照合 */
    const reachable = M.servicesOf(series.merchant_id);
    let shaped = reachable.filter(sid => {
      const svc = M.service(sid);
      return svc && M.shapeMatches(series, svc.pricing_type);
    });

    if (shaped.length === 0) return drop(series, 'no_service_matches_shape');

    /* 複数残るなら金額でプランを絞る（定額型のみが絞り込みに寄与）。
       1件に絞れれば A。2件以上が同額で並ぶなら、その絞れた集合だけを
       B の選択肢にする（§12-2 のモック：Apple ¥1,480 →「iCloud+ 200GB」
       「Apple Music」の2択。形が一致するだけの他サービスは出さない）。
       どれも金額が当たらなければ絞り込めないので shaped のまま。 */
    if (shaped.length > 1) {
      const narrowed = shaped.filter(sid => {
        const svc = M.service(sid);
        if (!M.isAmountMatched(svc.pricing_type)) return false;
        return M.plansOf(sid).some(p => amountMatchesPlan(series, p));
      });
      if (narrowed.length >= 1) shaped = narrowed;
    }

    if (shaped.length === 1) {
      const sid = shaped[0];
      const svc = M.service(sid);
      return {
        status: 'A',
        series,
        merchant_id: series.merchant_id,
        merchant_name: m.name,
        service_id: sid,
        plan_id: matchPlan(sid, series),
        options: [],
        domain: svc.domain,
        response_timing: timingFor(sid)
      };
    }

    /* 複数残る → B。options = 残 service 群 */
    return {
      status: 'B',
      series,
      merchant_id: series.merchant_id,
      merchant_name: m.name,
      service_id: null,
      plan_id: null,
      options: shaped.map(sid => {
        const svc = M.service(sid);
        return { service_id: sid, name: svc.name, category: svc.category };
      }),
      domain: 'contract_digital',
      response_timing: null /* B は選択後にマスタから確定（§12-1） */
    };
  }

  /* B でユーザーが service を選んだ後に呼ぶ。A 相当へ昇格した candidate を返す。
     'other'（その他）が選ばれたら C と同じ扱い（§9 末尾）。 */
  function resolveChoice(candidate, serviceId) {
    if (serviceId === 'other') {
      return Object.assign({}, candidate, {
        status: 'C', service_id: null, plan_id: null, options: [],
        merchant_name: candidate.series.merchant_raw,
        response_timing: null
      });
    }
    const svc = M.service(serviceId);
    return Object.assign({}, candidate, {
      status: 'A',
      service_id: serviceId,
      plan_id: matchPlan(serviceId, candidate.series),
      options: [],
      domain: svc ? svc.domain : 'contract_digital',
      response_timing: timingFor(serviceId)
    });
  }

  global.SeiZenPaymentJudge = { judge, resolveChoice, _internal: { amountMatchesPlan, matchPlan, hasContinuity } };
})(window);
