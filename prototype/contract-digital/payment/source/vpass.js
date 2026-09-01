/* SeiZen プロトタイプ｜支払い明細から探す：Vpass ソースアダプタ
   ------------------------------------------------------------------
   設計「支払い明細から探す」§6-1 に対応。

   Vpass（三井住友カード）形式の CSV を、共通の「取引」配列へ変換する。
   アダプタが担うのは形式の変換だけ。サービス特定・契約性判定はしない。

   ── 使用する列（§6-1）───────────────────────────────
     利用日   → usage_date
     利用金額 → amount
     ご利用店名 → merchant_raw
   「請求月」「お支払い金額」は使わない（分割払いが定額サブスクと
   同型になるのを避ける）。請求月は coverage（対象期間）の導出にだけ使う。

   ── 除外（§6-1）────────────────────────────────────
     支払区分 ≠ 1（分割・リボ）… 系列化の前に落とす
     amount ≤ 0（返金・調整）  … 同上
     ※ 銀行明細形式では入金行も落とすが、Vpass は全行が出金

   出力 transaction（永続化しない・§3-1）：
     usage_date    : "YYYY-MM-DD"
     amount        : int（正の円）
     merchant_raw  : string（trim のみ）
     merchant_norm : string（NFKC・全角半角・大文字・空白整理）

   他アダプタ（rakuten.js 等）も parse(text, opts) → { ok, transactions,
   coverage, meta } の同一シグネチャで実装する（§15-4）。
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const ADAPTER_ID = 'vpass';
  const REQUIRED_HEADERS = ['請求月', 'ご利用日', 'ご利用店名', 'ご利用金額', '支払区分'];

  /* ── CSV パース（RFC4180 の必要部分）─────────────────── */
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        /* skip */
      } else if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
  }

  /* ── 明細表記の正規化 ─────────────────────────────────
     NFKC / 全角→半角 / 大文字化 / 前後空白除去 / 連続空白整理。
     「末尾英数字を消す」「記号で決済代行を判定」等の乱暴な共通ルールは
     しない（SPOTIFY P0C8A7 のような接尾辞は resolver 側の担当）。   */
  function normalize(raw) {
    let s = String(raw == null ? '' : raw);
    try { s = s.normalize('NFKC'); } catch (e) { /* 古い環境 */ }
    s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    s = s.toUpperCase();
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function parseUsageDate(v) {
    const m = String(v || '').trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
    if (!m) return null;
    const y = m[1], mo = m[2].padStart(2, '0'), d = m[3].padStart(2, '0');
    if (isNaN(new Date(`${y}-${mo}-${d}T00:00:00`).getTime())) return null;
    return `${y}-${mo}-${d}`;
  }

  function parseBillingPeriod(v) {
    const m = String(v || '').trim().match(/^(\d{4})[-/](\d{1,2})$/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
  }

  function parseAmount(v) {
    const s = String(v == null ? '' : v).replace(/[,\s￥¥]/g, '').trim();
    return (s === '' || !/^-?\d+$/.test(s)) ? null : parseInt(s, 10);
  }

  /* 支払区分。"1" 以外（分割・リボ・不明）は除外対象。 */
  function isLumpSum(kubun) {
    const s = String(kubun == null ? '' : kubun).trim();
    return s === '1' || s === '１';
  }

  /* 請求月の連続性から coverage を導出。欠損があれば underivable
     （勝手に補完しない）。判定には使わず、画面表示のみ。            */
  function deriveCoverage(billingPeriods) {
    const uniq = Array.from(new Set(billingPeriods.filter(Boolean))).sort();
    if (uniq.length === 0) return { coverage_from: null, coverage_to: null, coverage_status: 'underivable' };
    const toIndex = p => { const [y, m] = p.split('-').map(Number); return y * 12 + (m - 1); };
    const contiguous = (toIndex(uniq[uniq.length - 1]) - toIndex(uniq[0]) + 1) === uniq.length;
    if (!contiguous) return { coverage_from: null, coverage_to: null, coverage_status: 'underivable' };
    const [fy, fm] = uniq[0].split('-').map(Number);
    const [ly, lm] = uniq[uniq.length - 1].split('-').map(Number);
    const lastDay = new Date(ly, lm, 0).getDate();
    return {
      coverage_from: `${fy}-${String(fm).padStart(2, '0')}-01`,
      coverage_to: `${ly}-${String(lm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      coverage_status: 'derived'
    };
  }

  /* ── メイン ─────────────────────────────────────────── */
  function parse(text, opts) {
    opts = opts || {};

    const table = parseCsv(text);
    if (table.length < 2) return { ok: false, error: 'CSV に行がありません。' };

    const headers = table[0].map(h => h.trim());
    const missing = REQUIRED_HEADERS.filter(h => headers.indexOf(h) === -1);
    if (missing.length) return { ok: false, error: `必須列がありません：${missing.join(' / ')}` };

    const ci = {
      billing: headers.indexOf('請求月'),
      usage:   headers.indexOf('ご利用日'),
      shop:    headers.indexOf('ご利用店名'),
      amount:  headers.indexOf('ご利用金額'),
      kubun:   headers.indexOf('支払区分')
    };

    const transactions = [];
    const billingPeriods = [];
    const stats = { rows: 0, excluded_installment: 0, excluded_nonpositive: 0, parse_errors: 0 };

    for (let r = 1; r < table.length; r++) {
      const cells = table[r];
      stats.rows++;

      const usage_date = parseUsageDate(cells[ci.usage]);
      const amount = parseAmount(cells[ci.amount]);
      const merchant_raw = String(cells[ci.shop] == null ? '' : cells[ci.shop]).trim();
      const billing_period = parseBillingPeriod(cells[ci.billing]);

      if (usage_date == null || amount == null || merchant_raw === '') {
        stats.parse_errors++;
        continue;
      }
      /* coverage は除外前の請求月から取る（対象期間はカードの明細範囲） */
      if (billing_period) billingPeriods.push(billing_period);

      if (!isLumpSum(cells[ci.kubun])) { stats.excluded_installment++; continue; }
      if (amount <= 0)                 { stats.excluded_nonpositive++; continue; }

      transactions.push({
        usage_date,
        amount,
        merchant_raw,
        merchant_norm: normalize(merchant_raw)
      });
    }

    return {
      ok: true,
      transactions,
      coverage: deriveCoverage(billingPeriods),
      meta: { adapter_id: ADAPTER_ID, stats }
    };
  }

  global.SeiZenSourceVpass = {
    ADAPTER_ID,
    parse,
    _internal: { normalize, parseUsageDate, parseBillingPeriod, parseAmount, isLumpSum, deriveCoverage }
  };
})(window);
