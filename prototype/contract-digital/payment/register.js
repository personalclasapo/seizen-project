/* SeiZen プロトタイプ｜支払い明細から探す：登録
   ------------------------------------------------------------------
   設計「支払い明細から探す」§13 / §3-5 に対応。

   画面2で選択された候補を、契約・デジタルのエントリとして書き込む。

   ── エントリが持つもの（§13-1）──────────────────────
     merchant_name / service_name（確定した場合）
     payment_method_id / holder_name（支払い手段の登録情報から・§3-2）
     amount（明細由来の実額。マスタのプラン金額で上書きしない・§9）
     amount_is_fixed（false なら「目安」表記）
     cycle / first_seen / last_seen
     domain / response_timing
     source = 'statement'
   確認項目・手続き方法・参考リンクはマスタから表示時に引く（複製しない）。

   ── holder_name ─────────────────────────────────────
     選択中の支払い手段（カード・口座）の登録情報から取る。明細からは
     取らない。プロトタイプでは呼び出し側が holder を渡す。

   ── 対応時期 ─────────────────────────────────────────
     A / B確定 … candidate.response_timing（マスタ由来 pre/post）
     C / Bその他 … ユーザーが画面で選んだ値（pre/post/unknown）
                    unknown は group='undecided'（振り分け前）へ

   ── 完了（§13 末尾）────────────────────────────────
     登録後、その支払い手段を「確認済み」にする。プロトタイプでは
     呼び出し側（extraction.js）が完了フラグを持つ。
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const Contract = global.SeiZenContract;
  const M = global.SeiZenPaymentMaster;

  /* response_timing → state.js の group。 */
  function groupFor(timing) {
    if (timing === 'post') return 'post';
    if (timing === 'pre')  return 'pre';
    return 'undecided'; /* unknown / null */
  }

  /* candidate → state.js contract.cycle（'monthly' | 'yearly' | ...）。
     state.js 側は monthly/yearly しか特別扱いしない。年額型（pricing_type
     が annual / cycle が single）は yearly、それ以外は monthly。       */
  function cycleForContract(c) {
    const svc = c.service_id ? M.service(c.service_id) : null;
    if (svc && svc.pricing_type === 'annual') return 'yearly';
    if (!svc && c.series.cycle === 'single') return 'yearly';
    return 'monthly';
  }

  /* 1つの選択済み candidate を state.js へ渡す record に変換。
     selection = { candidate, chosenTiming?, editedName? }
     ctx = { paymentMethodId, holderName }                          */
  function toRecord(selection, ctx) {
    const c = selection.candidate;
    const svc = c.service_id ? M.service(c.service_id) : null;

    const timing = c.service_id
      ? c.response_timing                    /* A / B確定：マスタ由来 */
      : (selection.chosenTiming || 'unknown'); /* C / Bその他：ユーザー入力 */

    const name = svc ? svc.name
      : (selection.editedName || c.merchant_name || c.series.merchant_raw);

    const category = svc ? svc.category
      : (global.SeiZenCatalog && global.SeiZenCatalog.categoryFor(name)) || '未分類';

    return {
      name: name,
      group: groupFor(timing),
      category: category,
      domain: c.domain || 'contract_digital',
      service_id: c.service_id || null,
      /* 判定で確定したプラン（旧価格・従量・定期宅配・C は null）。
         表示には使わない（メイン表示はサービス名のみ・過剰表示を避ける）。
         金額はマスタのプラン金額で上書きせず明細の実額を使う（§9）ので、
         plan_id は「どのプランと判定したか」の記録として持つに留める。 */
      plan_id: c.plan_id || null,
      contract: {
        holder: ctx.holderName || '',
        paymentCard: ctx.paymentMethodId || null,
        amount: c.series.amount_repr,
        cycle: cycleForContract(c),
        amount_is_fixed: c.series.amount_is_fixed,
        first_seen: c.series.first_seen,
        last_seen: c.series.last_seen
      }
    };
  }

  /* selections（選択済み candidate の配列）を一括登録。
     registered / payment_method / drop は呼び出し側で除外済みの前提。

     candidate.payment_method_change が立っているものは新規追加ではなく
     既存エントリの支払い手段の上書き（§13-2）。それ以外は新規追加。   */
  function write(selections, ctx) {
    const changes = [], adds = [];
    selections.forEach(s => {
      const rec = toRecord(s, ctx);
      if (s.candidate.payment_method_change) changes.push(rec);
      else adds.push(rec);
    });
    const updated = changes.filter(r => Contract.applyPaymentMethodChange(r)).map(r => r.name);
    const res = adds.length ? Contract.commitFromStatement(adds) : { added: [], skipped: [] };
    return { added: res.added, skipped: res.skipped, updated };
  }

  global.SeiZenPaymentRegister = { write, toRecord, _internal: { groupFor, cycleForContract } };
})(window);
