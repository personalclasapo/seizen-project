/* SeiZen プロトタイプ｜支払い明細から探す：パイプライン
   ------------------------------------------------------------------
   設計「支払い明細から探す」§5 に対応。各モジュールを結線する。

     明細を読む（ソースアダプタ）
     ↓ ① 正規化
     ↓ ② 請求主体の同定（resolver.identify）
     ↓ ③ 系列化（series.build）
     ↓    未解決系列をまとめて resolver.resolveUnknown（§15-2）
     ↓    writeback:true をマスタへ書き戻し、再度系列化
     ↓ ④ 判定（judge.judge）
     ↓ ⑤ 既登録との照合（reconcile.reconcile）
     ↓ ⑥ ユーザー確認（画面：extraction.js）
     ↓ ⑦ 契約・デジタルへ登録（register.write）
     この支払い手段は確認済み

   ── 入口 ─────────────────────────────────────────────
     analyze(csvText, { adapter, paymentMethodId })
       → { ok, candidates, payment_method_hits, coverage, report }
       candidates は status ∈ {A,B,C,registered}。payment_method /
       drop は candidates に載せず、payment_method_hits と report へ。

     commit(selections, { paymentMethodId, holderName })
       → { added, skipped }   （register.write の結果）
     resolveChoice(candidate, serviceId)
       → judge.resolveChoice の委譲（B の選択確定）
     reconcileOne(candidate, paymentMethodId)
       → B 選択後の再照合（§11）

   ── report（§6 報告事項・開発ログ用）───────────────────
     画面には出さない。各系列がどの分岐で確定/破棄されたかを持つ。
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const Series = global.SeiZenPaymentSeries;
  const Judge = global.SeiZenPaymentJudge;
  const Reconcile = global.SeiZenPaymentReconcile;
  const Register = global.SeiZenPaymentRegister;
  const Resolver = global.SeiZenPaymentResolver;
  const Master = global.SeiZenPaymentMaster;

  const ADAPTERS = {
    vpass: global.SeiZenSourceVpass
  };

  function analyze(csvText, opts) {
    opts = opts || {};
    const adapter = ADAPTERS[opts.adapter || 'vpass'];
    const paymentMethodId = opts.paymentMethodId || null;
    if (!adapter) return { ok: false, error: '未対応の明細形式です。' };

    /* ① 正規化 */
    const parsed = adapter.parse(csvText, {});
    if (!parsed.ok) return { ok: false, error: parsed.error };

    /* ②③ 系列化（identify を内包） */
    let built = Series.build(parsed.transactions);

    /* 未解決系列をまとめて実行時解決（§15-2：呼び出しは1回） */
    let resolution = [];
    if (built.unresolved.length) {
      const payload = built.unresolved.map(s => ({
        merchant_raw: s.merchant_raw,
        merchant_norm: s.merchant_norm,
        amount_min: s.amount_min,
        amount_max: s.amount_max,
        cycle: s.cycle,
        count: s.count
      }));
      resolution = Resolver.resolveUnknown(payload);

      /* writeback:true をマスタへ恒久化 → 再系列化で merchant_id が付く */
      let wroteBack = false;
      resolution.forEach(r => {
        if (r.merchant_id && r.writeback) {
          Master.addMerchant(r.merchant_id, r.merchant);
          (r.services || []).forEach(svc => {
            Master.addService(svc.service_id, Object.assign({}, svc, { merchant_id: r.merchant_id }));
          });
          wroteBack = true;
        }
      });
      if (wroteBack) built = Series.build(parsed.transactions);
    }

    /* ④ 判定 */
    const judged = built.series.map(Judge.judge);

    /* ⑤ 既登録照合（A のみ）。candidates は A/B/C/registered のみ */
    const candidates = Reconcile.reconcile(
      judged.filter(j => j.status === 'A' || j.status === 'B' || j.status === 'C'),
      paymentMethodId
    );

    const paymentMethodHits = judged
      .filter(j => j.status === 'payment_method')
      .map(j => ({ merchant_name: j.merchant_name, merchant_id: j.merchant_id }));

    /* 並び：金額（amount_max）降順（§12-2） */
    candidates.sort((a, b) => b.series.amount_max - a.series.amount_max);

    return {
      ok: true,
      candidates,
      payment_method_hits: paymentMethodHits,
      coverage: parsed.coverage,
      report: buildReport(judged, resolution, parsed.meta)
    };
  }

  function buildReport(judged, resolution, adapterMeta) {
    return {
      adapter: adapterMeta,
      resolution: resolution.map(r => ({
        merchant_raw: r.merchant_raw,
        resolved: !!r.merchant_id,
        merchant_id: r.merchant_id,
        writeback: r.writeback
      })),
      series: judged.map(j => ({
        merchant_raw: j.series.merchant_raw,
        merchant_id: j.series.merchant_id,
        cycle: j.series.cycle,
        amount_min: j.series.amount_min,
        amount_max: j.series.amount_max,
        count: j.series.count,
        status: j.status,
        service_id: j.service_id || null,
        plan_id: j.plan_id || null,
        options: (j.options || []).map(o => o.service_id),
        response_timing: j.response_timing || null,
        drop_reason: j.drop_reason || null,
        payment_method_change: !!j.payment_method_change
      }))
    };
  }

  global.SeiZenPaymentPipeline = {
    analyze,
    commit: (selections, ctx) => Register.write(selections, ctx),
    resolveChoice: (cand, sid) => Judge.resolveChoice(cand, sid),
    reconcileOne: (cand, pmId) => Reconcile.reconcileOne(cand, pmId)
  };
})(window);
