/* SeiZen プロトタイプ｜支払い明細から探す：請求主体の同定と実行時解決
   ------------------------------------------------------------------
   設計「支払い明細から探す」§6-2 / §15-1 / §15-2 に対応。

   請求主体の同定を2段で行う。

     1. identify(merchantRaw, merchantNorm)
        マスタの merchant_pattern を引く。ヒットすれば merchant_id。
        ヒットしなければ null（＝実行時解決の対象）。

     2. resolveUnknown(unknownSeries)
        マスタに無い請求主体を、外部知識で解決する。
        本番では LLM / 外部 API 呼び出し。このプロトタイプでは固定辞書の
        スタブ。呼び出し側（pipeline.js）はスタブと本番で変えない。

   ── 実行時解決のインターフェース（本番と共通・§15-2）───────
     入力  unknownSeries : [{ merchant_raw, merchant_norm,
                              amount_min, amount_max, cycle, count }]
           ※ 系列化を手元で完了させてから渡す。口座番号・名義・家族の
              識別情報は構造的に含まれない（§15-2「送信範囲」）。
     出力  [{ merchant_raw,           入力と対応づけるためのキー
              merchant_id,            解決できなければ null
              merchant : { name, type, domain },          merchant_id!=null のとき
              pattern  : { pattern, match, priority, merchant_id } | null
                         マスタの MERCHANT_PATTERN へ書き戻す照合キー。
                         これがないと次回も identify で引けず resolveUnknown
                         を再度通る（§15-2）。
              services : [{ service_id, name, category,
                            pricing_type, domain,
                            survivor_can_complete,   §10-1 の判定根拠。
                                                     省略時は false 扱い
                            post_mortem_procedure,   手続きの説明文（任意）
                            plans: [{ plan_id, name, amount }] }],
              writeback : bool }]      true ならマスタへ恒久保存してよい

   ── 呼び出し単位（§15-2）─────────────────────────────
     明細行ごとではなく、系列化後の未解決系列を「まとめて1回」。
     pipeline.js が unknownSeries をまとめて渡す。

   ── 結果の蓄積（§15-2）──────────────────────────────
     writeback:true の結果は pipeline.js が master.addMerchant /
     addService でマスタへ書き戻す。同一請求主体は次回以降 identify で
     解決され、resolveUnknown を通らない。プロトタイプの書き戻し先は
     master.js のメモリ辞書（＝リロードで消える）。本番はマスタ DB。
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const M = global.SeiZenPaymentMaster;

  /* ── 1. パターン照合による同定 ─────────────────────── */
  function identify(merchantRaw, merchantNorm) {
    const norm = merchantNorm || '';
    const hits = [];
    for (const p of M.MERCHANT_PATTERN) {
      let ok = false;
      if (p.match === 'exact')  ok = norm === p.pattern;
      else if (p.match === 'prefix') ok = norm.indexOf(p.pattern) === 0;
      else if (p.match === 'regex') {
        try { ok = new RegExp(p.pattern).test(norm); } catch (e) { ok = false; }
      }
      if (ok) hits.push(p);
    }
    if (hits.length === 0) return null;

    hits.sort((a, b) => (b.priority - a.priority) || (b.pattern.length - a.pattern.length));
    const top = hits[0];
    /* 同 priority で別 merchant が残るなら、確実に言えないので未解決扱い */
    if (hits.some(h => h.priority === top.priority && h.merchant_id !== top.merchant_id)) {
      return null;
    }
    return top.merchant_id;
  }

  /* ── 2. 実行時解決（スタブ）──────────────────────────
     STUB_KNOWLEDGE … 本番の LLM/API が返すであろう「請求主体 →
     merchant + services」を、正規化表記の部分一致で引く固定辞書。
     ここに無い請求主体は { merchant_id: null }（＝ C 経路 or 破棄）。

     この辞書は「SeiZen が外部知識として解決できる請求主体」の代役で
     あって、特定の CSV を通すためのものではない。実際の解決器に
     差し替えたら、この辞書は丸ごと不要になる。                     */
  const STUB_KNOWLEDGE = [
    /* SPOTIFY のランダム接尾辞つき表記（"SPOTIFY P0C8A7" 等）は
       master.js の regex で既に mch-spotify に解決される。ここは
       それでも漏れた場合の保険としては置かない（二重管理を避ける）。 */

    /* マスタ未収録だが外部知識で継続課金と分かる例。
       match は正規化表記（大文字）への部分一致。 */
    {
      match: 'DAZN',
      merchant: { merchant_id: 'mch-dazn', name: 'DAZN', type: 'normal', domain: 'contract_digital' },
      /* マスタへ書き戻す照合パターン（§15-2）。次回以降 identify で引ける。 */
      pattern: { pattern: 'DAZN', match: 'prefix', priority: 90 },
      services: [{
        service_id: 'svc-dazn', name: 'DAZN', category: '動画配信',
        pricing_type: 'monthly', domain: 'contract_digital',
        survivor_can_complete: false,   /* アカウントのログインが前提（§10-2）*/
        post_mortem_procedure: null,
        plans: [{ plan_id: 'pln-dazn-standard', name: 'スタンダード', amount: 4200 }]
      }],
      writeback: true
    },
    {
      match: 'YOUTUBEPREMIUM',
      merchant: { merchant_id: 'mch-youtube', name: 'YouTube', type: 'normal', domain: 'contract_digital' },
      pattern: { pattern: 'YOUTUBEPREMIUM', match: 'prefix', priority: 90 },
      services: [{
        service_id: 'svc-youtube-premium', name: 'YouTube Premium', category: '動画・音楽',
        pricing_type: 'monthly', domain: 'contract_digital',
        survivor_can_complete: false,   /* Google アカウントのログインが前提（§10-2）*/
        post_mortem_procedure: null,
        plans: [{ plan_id: 'pln-youtube-premium-individual', name: '個人', amount: 1280 }]
      }],
      writeback: true
    }
  ];

  function resolveUnknown(unknownSeries) {
    /* 本番はここが1回の外部呼び出し（unknownSeries をまとめて送る）。 */
    return (unknownSeries || []).map(s => {
      const norm = s.merchant_norm || '';
      const hit = STUB_KNOWLEDGE.find(k => norm.indexOf(k.match) !== -1);
      if (!hit) {
        return { merchant_raw: s.merchant_raw, merchant_id: null, merchant: null, pattern: null, services: [], writeback: false };
      }
      return {
        merchant_raw: s.merchant_raw,
        merchant_id: hit.merchant.merchant_id,
        merchant: { name: hit.merchant.name, type: hit.merchant.type, domain: hit.merchant.domain },
        pattern: hit.pattern
          ? Object.assign({ merchant_id: hit.merchant.merchant_id }, hit.pattern)
          : null,
        services: hit.services.slice(),
        writeback: !!hit.writeback
      };
    });
  }

  global.SeiZenPaymentResolver = { identify, resolveUnknown };
})(window);
