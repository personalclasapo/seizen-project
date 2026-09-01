/* SeiZen プロトタイプ｜支払い明細から探す：既登録との照合
   ------------------------------------------------------------------
   設計「支払い明細から探す」§11 / §13-2 に対応。

   判定でサービスが確定した候補を、契約・デジタルの既登録エントリと
   照合する。照合キーは service_id + payment_method_id。

     A … 提示前に照合（この関数を pipeline から呼ぶ）
     B … ユーザーが選択した時点で照合（画面イベントから reconcileOne）
     C … マスタにないため照合しない

   ── 結果（§11）─────────────────────────────────────
     同一 service・同一 payment_method で既登録
       → status = 'registered'（表示するがチェック不可）
     同一 service・異なる payment_method
       → payment_method_change フラグ（既存エントリの支払い手段を
         上書き予約。履歴は作らない・§13-2）
     既登録なし
       → そのまま

   既登録を候補から除外して非表示にはしない（§11 末尾）。明細に
   出ているものが画面に現れないと網羅を判断できない。

   ── 既登録の取得元 ──────────────────────────────────
     契約・デジタルの state.js（SeiZenContract.items）。各 item は
     id（= service_id 相当）と contract.paymentCard を持つ。
     このプロトタイプでは item.id を service_id、contract.paymentCard を
     payment_method_id として扱う。
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const Contract = global.SeiZenContract;

  /* 既登録エントリを { service_id, payment_method_id } の配列で返す。 */
  function existingEntries() {
    if (!Contract || !Array.isArray(Contract.items)) return [];
    return Contract.items.map(it => ({
      service_id: it.id,
      payment_method_id: (it.contract && it.contract.paymentCard) || null,
      name: it.name
    }));
  }

  /* 1件の candidate（service 確定済み）を既登録と突き合わせる。
     paymentMethodId は今回の明細をアップロードした支払い手段。      */
  function reconcileOne(candidate, paymentMethodId) {
    if (!candidate.service_id) return candidate;
    const entries = existingEntries();
    const sameService = entries.filter(e => e.service_id === candidate.service_id);
    if (sameService.length === 0) return candidate;

    const sameBoth = sameService.find(e => e.payment_method_id === paymentMethodId);
    if (sameBoth) {
      return Object.assign({}, candidate, { status: 'registered' });
    }
    /* service は一致・支払い手段が違う → 変更として扱う（§13-2） */
    return Object.assign({}, candidate, {
      payment_method_change: true,
      previous_payment_method_id: sameService[0].payment_method_id
    });
  }

  /* candidate 配列を一括照合（A のみ対象。B/C はそのまま通す）。 */
  function reconcile(candidates, paymentMethodId) {
    return candidates.map(c =>
      c.status === 'A' ? reconcileOne(c, paymentMethodId) : c);
  }

  global.SeiZenPaymentReconcile = { reconcile, reconcileOne, existingEntries };
})(window);
