/* SeiZen プロトタイプ｜支払い明細から探す：Vpass Source Adapter
   ------------------------------------------------------------------
   基準設計 §7〜§10 / 指示 §4〜§10 に対応。

   Vpass（三井住友カード）形式の CSV を共通 transaction 配列へ変換する。
   Adapter が担当するのは「事実形式の変換」まで（列対応・日付・金額・
   請求月・支払方法・分割・coverage・refund 認識）。サービス特定・
   契約性判定は行わない。

   入力列（指示§5）：
     請求月, ご利用日, ご利用店名, ご利用金額, 支払区分, 今回回数,
     お支払い金額, 備考

   出力 transaction（基準設計§9 の部分集合。第1増分で使う分だけ）：
     transaction_id
     payment_source_id
     usage_date            … ご利用日（YYYY-MM-DD）
     posting_date          … CSV に無ければ null（指示§5）
     billing_period        … 請求月（YYYY-MM）
     description_raw       … ご利用店名（前後空白除去のみ）
     description_normalized… §13 共通正規化後（engine 側で使う照合キー）
     amount               … ご利用金額（お支払い金額ではない・指示§6）
     currency             … 'JPY'
     direction            … 'outflow' | 'inflow'
     transaction_nature   … 'purchase' | 'refund' | 'unknown'
     payment_method       … 'one_time' | 'installment' | 'revolving' | 'unknown'
     installment_number   … 分割時のみ数値、それ以外 null
     installment_total    … 分割時のみ数値、それ以外 null
     source_row_number    … CSV 行番号（1 始まり・ヘッダ除く）
     _billing_amount      … お支払い金額（Adapter 内検証用の一時値・指示§6）

   scan メタ：
     coverage_from / coverage_to … 請求月から導出（指示§10）
     coverage_status             … 'derived' | 'underivable'
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const ADAPTER_ID = 'vpass';
  const ADAPTER_VERSION = '1.0.0';

  const REQUIRED_HEADERS = ['請求月', 'ご利用日', 'ご利用店名', 'ご利用金額', '支払区分'];

  /* ── CSV パース（最小・RFC4180 の必要部分） ───────────── */
  function parseCsv(text) {
    /* BOM 除去 */
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
        /* skip; \n handles the break */
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

  /* ── §13 共通正規化 ───────────────────────────────────
     Unicode正規化 / 全角→半角 / 大文字化 / 前後空白除去 / 連続空白整理。
     乱暴な共通ルール（末尾英数字削除・記号で決済代行判定等）はしない。 */
  function normalizeDescription(raw) {
    let s = String(raw == null ? '' : raw);
    try { s = s.normalize('NFKC'); } catch (e) { /* 古い環境 */ }
    s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    s = s.toUpperCase();
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  /* ご利用日 "2026/04/05" → "2026-04-05"。解析不能なら null。 */
  function parseUsageDate(v) {
    const m = String(v || '').trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
    if (!m) return null;
    const y = m[1], mo = m[2].padStart(2, '0'), d = m[3].padStart(2, '0');
    const dt = new Date(`${y}-${mo}-${d}T00:00:00`);
    if (isNaN(dt.getTime())) return null;
    return `${y}-${mo}-${d}`;
  }

  /* 請求月 "2026-03" / "2026/03" → "2026-03"。解析不能なら null。 */
  function parseBillingPeriod(v) {
    const m = String(v || '').trim().match(/^(\d{4})[-/](\d{1,2})$/);
    if (!m) return null;
    return `${m[1]}-${m[2].padStart(2, '0')}`;
  }

  /* 金額 "66,000" / "-3980" → 数値。解析不能なら null。 */
  function parseAmount(v) {
    const s = String(v == null ? '' : v).replace(/[,\s￥¥]/g, '').trim();
    if (s === '' || !/^-?\d+$/.test(s)) return null;
    return parseInt(s, 10);
  }

  /* 支払区分 → payment_method / installment_total（指示§7）。
       "1"           → one_time
       "2" 以上の数値 → installment（total = その数値）
       "リ"          → revolving
       それ以外       → unknown（Vpass公式仕様で確認できない値は推測しない）
  */
  function classifyPaymentMethod(kubun) {
    const s = String(kubun == null ? '' : kubun).trim();
    if (s === '1' || s === '１') {
      return { payment_method: 'one_time', installment_total: null };
    }
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (n >= 2) return { payment_method: 'installment', installment_total: n };
      return { payment_method: 'unknown', installment_total: null };
    }
    if (s === 'リ' || s === 'ﾘ') {
      return { payment_method: 'revolving', installment_total: null };
    }
    return { payment_method: 'unknown', installment_total: null };
  }

  /* 備考が返品・返金を表すか（指示§9・最小判定）。 */
  function looksLikeRefund(note) {
    const s = String(note || '').trim();
    return /返品|返金|取消|キャンセル/.test(s);
  }

  /* 請求月の連続性から coverage を導出（指示§10）。
     連続していれば coverage_from = 最小月の1日 / coverage_to = 最大月の末日。
     欠損があれば underivable（勝手に補完しない）。 */
  function deriveCoverage(billingPeriods) {
    const uniq = Array.from(new Set(billingPeriods.filter(Boolean))).sort();
    if (uniq.length === 0) return { coverage_from: null, coverage_to: null, coverage_status: 'underivable' };
    const toIndex = p => { const [y, m] = p.split('-').map(Number); return y * 12 + (m - 1); };
    const first = toIndex(uniq[0]);
    const last = toIndex(uniq[uniq.length - 1]);
    const contiguous = (last - first + 1) === uniq.length;
    if (!contiguous) {
      return { coverage_from: null, coverage_to: null, coverage_status: 'underivable' };
    }
    const [fy, fm] = uniq[0].split('-').map(Number);
    const [ly, lm] = uniq[uniq.length - 1].split('-').map(Number);
    const lastDay = new Date(ly, lm, 0).getDate();
    return {
      coverage_from: `${fy}-${String(fm).padStart(2, '0')}-01`,
      coverage_to: `${ly}-${String(lm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      coverage_status: 'derived'
    };
  }

  /* ── メイン ───────────────────────────────────────────
     parse(text, { payment_source_id }) →
       { ok, transactions, coverage, meta } | { ok:false, error }      */
  function parse(text, opts) {
    opts = opts || {};
    const paymentSourceId = opts.payment_source_id || 'unknown-source';

    const table = parseCsv(text);
    if (table.length < 2) {
      return { ok: false, error: 'CSV に行がありません。' };
    }
    const headers = table[0].map(h => h.trim());
    const missing = REQUIRED_HEADERS.filter(h => headers.indexOf(h) === -1);
    if (missing.length) {
      return { ok: false, error: `必須列がありません：${missing.join(' / ')}` };
    }
    const col = name => headers.indexOf(name);
    const ci = {
      billing: col('請求月'),
      usage: col('ご利用日'),
      shop: col('ご利用店名'),
      amount: col('ご利用金額'),
      kubun: col('支払区分'),
      count: col('今回回数'),
      pay: col('お支払い金額'),
      note: col('備考')
    };

    const transactions = [];
    const errors = [];
    const billingPeriods = [];

    for (let r = 1; r < table.length; r++) {
      const cells = table[r];
      const rowNo = r; /* ヘッダを除いた 1 始まり */

      const usage_date = parseUsageDate(cells[ci.usage]);
      const billing_period = parseBillingPeriod(cells[ci.billing]);
      const amount = parseAmount(cells[ci.amount]);
      const description_raw = String(cells[ci.shop] == null ? '' : cells[ci.shop]).trim();

      if (usage_date == null) { errors.push(`行 ${rowNo}: ご利用日を解析できません`); continue; }
      if (amount == null)     { errors.push(`行 ${rowNo}: ご利用金額を解析できません`); continue; }
      if (description_raw === '') { errors.push(`行 ${rowNo}: ご利用店名が空です`); continue; }
      if (billing_period) billingPeriods.push(billing_period);

      const pm = classifyPaymentMethod(cells[ci.kubun]);
      let installment_number = null;
      let installment_total = pm.installment_total;
      if (pm.payment_method === 'installment') {
        const n = parseAmount(cells[ci.count] != null ? cells[ci.count] : '');
        installment_number = (n != null && n > 0) ? n : null;
      } else {
        installment_total = null;
      }

      const note = ci.note >= 0 ? cells[ci.note] : '';
      const isRefund = amount < 0 && looksLikeRefund(note);

      const transaction_nature = isRefund ? 'refund'
        : (amount < 0 ? 'unknown' : 'purchase');
      const direction = isRefund ? 'inflow' : (amount < 0 ? 'inflow' : 'outflow');

      transactions.push({
        transaction_id: `${ADAPTER_ID}:${rowNo}`,
        payment_source_id: paymentSourceId,
        usage_date,
        posting_date: null,
        billing_period,
        description_raw,
        description_normalized: normalizeDescription(description_raw),
        amount,
        currency: 'JPY',
        direction,
        transaction_nature,
        payment_method: pm.payment_method,
        installment_number,
        installment_total,
        source_row_number: rowNo,
        _billing_amount: parseAmount(ci.pay >= 0 ? cells[ci.pay] : '')
      });
    }

    const coverage = deriveCoverage(billingPeriods);

    return {
      ok: true,
      transactions,
      coverage,
      meta: {
        adapter_id: ADAPTER_ID,
        adapter_version: ADAPTER_VERSION,
        row_count: table.length - 1,
        transaction_count: transactions.length,
        parse_errors: errors
      }
    };
  }

  global.SeiZenVpassAdapter = {
    ADAPTER_ID,
    ADAPTER_VERSION,
    parse,
    /* テスト・engine から使う小関数も公開 */
    _internal: { normalizeDescription, parseUsageDate, parseBillingPeriod, parseAmount, classifyPaymentMethod, deriveCoverage }
  };
})(window);
