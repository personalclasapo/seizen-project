/* SeiZen プロトタイプ｜支払い明細から探す：楽天カード ソースアダプタ
   ------------------------------------------------------------------
   設計「支払い明細から探す」§6-1 / §15-4 に対応。

   楽天カード（楽天 e-NAVI）の「ご利用明細（CSV）」を、共通の「取引」
   配列へ変換する。アダプタが担うのは形式の変換だけ。

   ── 実際のフォーマット（実CSVで確認）─────────────────
     ・文字コードは UTF-8（BOM 付き）。全項目がダブルクオート。
     ・ヘッダー行あり。10列。

       "利用日","利用店名・商品名","利用者","支払方法","利用金額",
       "支払手数料","支払総額","N月支払金額","M月繰越残高","新規サイン"

       "2024/12/24","ＮＴＴ東日本光コラボ回収　１２月分","本人","1回払い",
       "5643","0","5643","5643","0","*"

     ・日付は YYYY/MM/DD（ゼロ埋め）。
     ・合計行は無い（最後の取引で終わる）。
     ・「現地利用額…変換レート…」の補足行は、利用日が空・支払方法が空
       なので明細行と区別できる → スキップ。

   ── 使う項目（§6-1）───────────────────────────────
     利用日     → usage_date
     利用金額   → amount（正の円。負数・0は除外）
     利用店名・商品名 → merchant_raw / merchant_norm
   支払総額・N月支払金額は使わない（分割払いが定額サブスクと同型に
   なるのを避ける）。対象期間は取引の利用日の最小〜最大から導く（§6-1）。

   ── 除外（§6-1）────────────────────────────────────
     支払方法が「1回払い」以外（分割・リボ・ボーナス）… 除外
     amount ≤ 0（返金・調整）… 除外

   parse(input, opts) → { ok, transactions, coverage, meta }（§15-4）
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const ADAPTER_ID = 'rakuten';
  const HEADER_KEY = ['利用日', '利用店名・商品名', '利用金額', '支払方法'];

  /* 楽天カードの CSV は UTF-8(BOM)。将来 Shift-JIS 版が来ても読めるよう、
     vpass と同じ方針でバイト列を判定・デコードする。 */
  function decodeInput(input) {
    if (typeof input === 'string') return { text: input, encoding: 'string' };
    let bytes = null;
    if (input && typeof input === 'object') {
      if (ArrayBuffer.isView(input)) {
        bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      } else if (typeof input.byteLength === 'number' && input.constructor &&
                 /ArrayBuffer/.test(input.constructor.name)) {
        bytes = new Uint8Array(input);
      } else if (input.buffer && typeof input.buffer.byteLength === 'number') {
        bytes = new Uint8Array(input.buffer);
      }
    }
    if (!bytes) return { text: String(input == null ? '' : input), encoding: 'string' };
    if (typeof TextDecoder === 'undefined') {
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return { text: s, encoding: 'no-textdecoder' };
    }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
    } catch (e) {
      try {
        return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' };
      } catch (e2) {
        return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8-lossy' };
      }
    }
  }

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
    return rows;
  }

  function normalize(raw) {
    let s = String(raw == null ? '' : raw);
    try { s = s.normalize('NFKC'); } catch (e) { /* 古い環境 */ }
    s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    s = s.toUpperCase();
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function parseUsageDate(v) {
    const m = String(v == null ? '' : v).trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
    if (!m) return null;
    const y = m[1], mo = m[2].padStart(2, '0'), d = m[3].padStart(2, '0');
    if (isNaN(new Date(`${y}-${mo}-${d}T00:00:00`).getTime())) return null;
    return `${y}-${mo}-${d}`;
  }

  function parseAmount(v) {
    const s = String(v == null ? '' : v).replace(/[,\s￥¥"]/g, '').trim();
    return (s === '' || !/^-?\d+$/.test(s)) ? null : parseInt(s, 10);
  }

  /* 支払方法。「1回払い」だけを一括扱いにする（分割・リボ・ボーナスは除外）。 */
  function isLumpSum(method) {
    return String(method == null ? '' : method).trim().replace(/\s+/g, '') === '1回払い';
  }

  function deriveCoverage(usageDates) {
    const ds = usageDates.filter(Boolean).sort();
    if (ds.length === 0) return { coverage_from: null, coverage_to: null, coverage_status: 'underivable' };
    return { coverage_from: ds[0], coverage_to: ds[ds.length - 1], coverage_status: 'derived' };
  }

  function parse(input, opts) {
    opts = opts || {};
    const decoded = decodeInput(input);
    const table = parseCsv(decoded.text);
    if (table.length < 2) return { ok: false, error: 'CSV に行がありません。' };

    const headers = table[0].map(h => h.trim());
    const missing = HEADER_KEY.filter(h => headers.indexOf(h) === -1);
    if (missing.length) {
      return { ok: false, error: '楽天カードのご利用明細（CSV）の形式ではないようです：' + missing.join(' / ') + ' が見つかりません。' };
    }
    const ci = {
      usage:  headers.indexOf('利用日'),
      shop:   headers.indexOf('利用店名・商品名'),
      amount: headers.indexOf('利用金額'),
      method: headers.indexOf('支払方法')
    };

    const transactions = [];
    const usageDates = [];
    const stats = {
      rows: 0, data_rows: 0, skipped_nondata: 0,
      excluded_installment: 0, excluded_nonpositive: 0, parse_errors: 0
    };

    for (let r = 1; r < table.length; r++) {
      const cells = table[r];
      stats.rows++;

      /* 利用日が空の行は明細ではない（「現地利用額…変換レート…」の
         補足行、空行）。飛ばす。 */
      const usage_date = parseUsageDate(cells[ci.usage]);
      if (usage_date == null) { stats.skipped_nondata++; continue; }

      stats.data_rows++;
      usageDates.push(usage_date);

      const amount = parseAmount(cells[ci.amount]);
      const merchant_raw = String(cells[ci.shop] == null ? '' : cells[ci.shop]).trim();
      if (amount == null || merchant_raw === '') { stats.parse_errors++; continue; }

      if (!isLumpSum(cells[ci.method])) { stats.excluded_installment++; continue; }
      if (amount <= 0)                  { stats.excluded_nonpositive++; continue; }

      transactions.push({
        usage_date,
        amount,
        merchant_raw,
        merchant_norm: normalize(merchant_raw)
      });
    }

    if (stats.data_rows === 0) {
      return { ok: false, error: 'この明細から取引を1件も読み取れませんでした。楽天カードのご利用明細（CSV）か、ご確認ください。' };
    }

    return {
      ok: true,
      transactions,
      coverage: deriveCoverage(usageDates),
      meta: { adapter_id: ADAPTER_ID, encoding: decoded.encoding, stats }
    };
  }

  global.SeiZenSourceRakuten = {
    ADAPTER_ID,
    parse,
    _internal: { decodeInput, normalize, parseUsageDate, parseAmount, isLumpSum, deriveCoverage, parseCsv }
  };
})(window);
