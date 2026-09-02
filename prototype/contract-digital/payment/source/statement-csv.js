/* SeiZen プロトタイプ｜支払い明細から探す：汎用 明細CSVアダプタ
   ------------------------------------------------------------------
   設計「支払い明細から探す」§6-1 / §15-4 に対応。

   カード会社を問わず、明細CSVのバイト列から「取引配列」へ変換する。
   会社別アダプタは持たない（§15-4）。必要な意味は3つだけ：
     利用日 / 利用金額 / 利用店名
   これを CSV の中身から推定する。補助的に「一括払いか否か」も推定し、
   分かれば分割・リボを除外する。

   ── 手順（§15-4）─────────────────────────────────────
     1. 文字コード判定（UTF-8 厳格 → ダメなら Shift-JIS）。BOM 除去。
     2. ヘッダー行の有無を判定（先頭行が日付でも数値でもないセルばかり
        ならヘッダー）。
     3. 各列の役割を、全データ行の値の性質から推定：
          日付列   … 日付として読める値の割合が最大（「YYYY/MM」の
                     締め日列は除く）。ヘッダー名の一致を優先。
          金額列   … 整数の割合が高く、ヘッダー名「利用金額」等に一致、
                     または日付列に隣接し桁が取引額らしい列。「支払総額」
                     「手数料」「残高」相当は避ける。
          店名列   … 日付・金額・区分列を除いた中でユニーク値の割合が
                     最大。ヘッダー名「利用店名」等を優先。
          区分列   … 「1回払い」「一括」「リボ」「分割」等のキーワード、
                     または 1 / 2以上 の小整数を持つ列（任意）。
     4. 日付列が日付として読める行だけを取引とする。カード情報行・
        合計行・補足行・空行は黙ってスキップ。
     5. 推定できない／取引0件 → ok:false（黙って空を返さない）。

   出力 transaction（永続化しない・§3-1）：
     usage_date / amount / merchant_raw / merchant_norm

   parse(input, opts) → { ok, transactions, coverage, meta }（§15-4）
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const ADAPTER_ID = 'statement-csv';

  /* ヘッダー名のキーワード（表記ゆれ込み・部分一致で判定）。 */
  const HINT = {
    date:   ['利用日', 'ご利用日', 'ご利用年月日', '利用年月日', '取引日', '日付', 'date'],
    amount: ['利用金額', 'ご利用金額', '利用額', 'ご利用額', '新規利用額', 'amount'],
    shop:   ['利用店名', 'ご利用店名', '利用店名・商品名', 'ご利用内容', 'ご利用先', '利用内容', '内容', '店名', '摘要', 'description'],
    /* 金額列として避けたい列（総額・手数料・残高・支払月額）。 */
    avoidAmount: ['支払総額', '支払い総額', '今回支払', '今回のお支払', 'お支払い金額', 'お支払金額',
      '支払手数料', '手数料', '利息', '残高', '繰越', '請求額', '請求金額', '割引', 'ポイント'],
    method: ['支払方法', '支払区分', 'お支払区分', '支払区分名称', '支払回数', '今回回数', '種別'],
    /* 区分列として避けたい（利用者名・利用種別など）。 */
    avoidMethod: ['利用者', 'ご利用者', '本人・家族', '利用区分', '利用者区分']
  };

  const LUMP_WORDS = ['1回払い', '１回払い', '一括', '1回', '１回'];
  const INSTALLMENT_WORDS = ['分割', 'リボ', 'ボーナス', '2回', '３回', '分割払い'];

  /* ── 文字コード ─────────────────────────────────────── */
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

  /* ── CSV パース ─────────────────────────────────────── */
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

  /* "2018/2/5" / "2026/03/03" / "2026-03-03" → "YYYY-MM-DD"。
     "2026/03"（締め日・請求月）は日付にしない（→ null）。 */
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

  function hasHint(header, list) {
    const h = normalize(header);
    return list.some(k => h.indexOf(normalize(k)) !== -1);
  }

  /* ヘッダー行っぽいか：セルの過半が「日付でも数値でもない」。 */
  function looksLikeHeader(cells) {
    let nonValue = 0, total = 0;
    for (const c of cells) {
      const s = String(c == null ? '' : c).trim();
      if (s === '') continue;
      total++;
      if (parseUsageDate(s) == null && parseAmount(s) == null) nonValue++;
    }
    return total > 0 && nonValue / total >= 0.7;
  }

  /* 各列を全データ行で集計し、役割を推定する。 */
  function inferColumns(dataRows, headers) {
    const width = dataRows.reduce((m, r) => Math.max(m, r.length), headers ? headers.length : 0);
    const col = [];
    for (let c = 0; c < width; c++) {
      let filled = 0, dateHits = 0, intHits = 0, ymHits = 0;
      const seen = new Set();
      const ints = [];
      for (const r of dataRows) {
        const raw = r[c];
        const s = String(raw == null ? '' : raw).trim();
        if (s === '') continue;
        filled++;
        seen.add(s);
        if (parseUsageDate(s) != null) dateHits++;
        if (/^\d{4}[/\-.]\d{1,2}$/.test(s)) ymHits++;
        const n = parseAmount(s);
        if (n != null) { intHits++; ints.push(Math.abs(n)); }
      }
      const header = headers ? String(headers[c] || '') : '';
      col.push({
        index: c, header, filled,
        dateRatio: filled ? dateHits / filled : 0,
        ymRatio:   filled ? ymHits / filled : 0,
        intRatio:  filled ? intHits / filled : 0,
        uniqRatio: filled ? seen.size / filled : 0,
        medianAbs: median(ints)
      });
    }

    /* 日付列：dateRatio が高く、ym（YYYY/MM の締め日）比率が低い。 */
    let dateCol = null;
    {
      const cands = col.filter(x => x.dateRatio >= 0.6 && x.dateRatio >= x.ymRatio);
      if (cands.length) {
        cands.sort((a, b) =>
          (hasHint(b.header, HINT.date) - hasHint(a.header, HINT.date)) ||
          (b.dateRatio - a.dateRatio));
        dateCol = cands[0].index;
      }
    }
    if (dateCol == null) return { ok: false };

    /* 金額列：整数比率が高い列。ヘッダー名で「利用金額」を優先し、
       「支払総額／手数料／残高」を避ける。ヒントが無ければ日付列に
       近く、桁が取引額らしい（中央値 50〜2,000,000）列。 */
    let amountCol = null;
    {
      const cands = col.filter(x =>
        x.index !== dateCol && x.intRatio >= 0.7 && x.dateRatio < 0.3 &&
        !hasHint(x.header, HINT.avoidAmount));
      const hinted = cands.filter(x => hasHint(x.header, HINT.amount));
      const pool = hinted.length ? hinted : cands.filter(x =>
        x.medianAbs >= 50 && x.medianAbs <= 2000000);
      pool.sort((a, b) =>
        Math.abs(a.index - dateCol) - Math.abs(b.index - dateCol) ||
        b.intRatio - a.intRatio);
      if (pool.length) amountCol = pool[0].index;
    }
    if (amountCol == null) return { ok: false };

    /* 区分列（任意）：キーワードを持つ列、または小整数（1/2/3…）の列。 */
    let methodCol = null;
    {
      const cands = col.filter(x =>
        x.index !== dateCol && x.index !== amountCol &&
        !hasHint(x.header, HINT.avoidMethod));
      const byHint = cands.filter(x => hasHint(x.header, HINT.method));
      const byWord = cands.filter(x => {
        let hit = 0, n = 0;
        for (const r of dataRows) {
          const s = normalize(r[x.index]);
          if (s === '') continue;
          n++;
          if (LUMP_WORDS.concat(INSTALLMENT_WORDS).some(w => s.indexOf(normalize(w)) !== -1)) hit++;
        }
        return n > 0 && hit / n >= 0.5;
      });
      const bySmallInt = cands.filter(x => x.intRatio >= 0.8 && x.medianAbs >= 1 && x.medianAbs <= 36 && x.index !== amountCol);
      methodCol = (byHint[0] || byWord[0] || bySmallInt[0] || {}).index;
      if (methodCol === undefined) methodCol = null;
    }

    /* 店名列：日付・金額・区分を除き、ユニーク値比率が最大の列。
       ヘッダー名「利用店名」等を優先。 */
    let shopCol = null;
    {
      const cands = col.filter(x =>
        x.index !== dateCol && x.index !== amountCol && x.index !== methodCol &&
        x.filled >= dataRows.length * 0.5 && x.dateRatio < 0.3 && x.intRatio < 0.5);
      const hinted = cands.filter(x => hasHint(x.header, HINT.shop));
      const pool = hinted.length ? hinted : cands.slice();
      pool.sort((a, b) => b.uniqRatio - a.uniqRatio);
      if (pool.length) shopCol = pool[0].index;
    }
    if (shopCol == null) {
      /* 最低限、日付・金額以外で最もバリエーションのある列。 */
      const rest = col.filter(x => x.index !== dateCol && x.index !== amountCol && x.filled > 0);
      rest.sort((a, b) => b.uniqRatio - a.uniqRatio);
      shopCol = rest.length ? rest[0].index : null;
    }
    if (shopCol == null) return { ok: false };

    return { ok: true, dateCol, amountCol, shopCol, methodCol };
  }

  function isLumpSum(v, hasMethodCol) {
    if (!hasMethodCol) return true;   /* 区分列が無ければ全部一括扱い */
    const s = normalize(v);
    if (s === '') return true;
    if (INSTALLMENT_WORDS.some(w => s.indexOf(normalize(w)) !== -1)) return false;
    if (LUMP_WORDS.some(w => s.indexOf(normalize(w)) !== -1)) return true;
    /* 小整数の区分：1 / １ が一括、2以上が分割。 */
    if (s === '1' || s === '１') return true;
    if (/^\d+$/.test(s) && parseInt(s, 10) >= 2) return false;
    return true;   /* 判別できないものは落とさない（§7-1） */
  }

  function median(nums) {
    if (!nums.length) return 0;
    const s = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  function deriveCoverage(usageDates) {
    const ds = usageDates.filter(Boolean).sort();
    if (ds.length === 0) return { coverage_from: null, coverage_to: null, coverage_status: 'underivable' };
    return { coverage_from: ds[0], coverage_to: ds[ds.length - 1], coverage_status: 'derived' };
  }

  /* ── メイン ─────────────────────────────────────────── */
  function parse(input, opts) {
    opts = opts || {};
    const decoded = decodeInput(input);
    const table = parseCsv(decoded.text).filter(r => r.some(c => String(c).trim() !== ''));
    if (table.length === 0) return { ok: false, error: 'CSV に行がありません。' };

    const hasHeader = looksLikeHeader(table[0]);
    const headers = hasHeader ? table[0].map(h => String(h || '').trim()) : null;
    const body = hasHeader ? table.slice(1) : table.slice();

    /* まず日付として読める行だけを「データ行候補」にして列を推定する。
       （カード情報行・合計行が混じっていても、日付列の推定は
       それらを無視して行える程度に頑健。）*/
    const inferInput = body;
    const guess = inferColumns(inferInput, headers);
    if (!guess.ok) {
      return { ok: false, error: 'この CSV から明細の日付・金額・店名の列を特定できませんでした。カード会社のご利用明細（CSV）か、ご確認ください。' };
    }

    const { dateCol, amountCol, shopCol, methodCol } = guess;
    const transactions = [];
    const usageDates = [];
    const stats = {
      rows: body.length, data_rows: 0, skipped_nondata: 0,
      excluded_installment: 0, excluded_nonpositive: 0, parse_errors: 0,
      columns: { date: dateCol, amount: amountCol, shop: shopCol, method: methodCol },
      header: hasHeader
    };

    for (const cells of body) {
      const usage_date = parseUsageDate(cells[dateCol]);
      if (usage_date == null) { stats.skipped_nondata++; continue; }

      stats.data_rows++;
      usageDates.push(usage_date);

      const amount = parseAmount(cells[amountCol]);
      const merchant_raw = String(cells[shopCol] == null ? '' : cells[shopCol]).trim();
      if (amount == null || merchant_raw === '') { stats.parse_errors++; continue; }

      if (!isLumpSum(cells[methodCol], methodCol != null)) { stats.excluded_installment++; continue; }
      if (amount <= 0)                                       { stats.excluded_nonpositive++; continue; }

      transactions.push({ usage_date, amount, merchant_raw, merchant_norm: normalize(merchant_raw) });
    }

    if (stats.data_rows === 0) {
      return { ok: false, error: 'この CSV から取引を1件も読み取れませんでした。カード会社のご利用明細（CSV）か、ご確認ください。' };
    }
    if (transactions.length === 0 && stats.parse_errors >= stats.data_rows) {
      return { ok: false, error: 'この CSV の列の並びを読み取れませんでした。カード会社のご利用明細（CSV）をそのままアップロードしてください。' };
    }

    return {
      ok: true,
      transactions,
      coverage: deriveCoverage(usageDates),
      meta: { adapter_id: ADAPTER_ID, encoding: decoded.encoding, stats }
    };
  }

  global.SeiZenSourceStatementCsv = {
    ADAPTER_ID,
    parse,
    _internal: { decodeInput, parseCsv, normalize, parseUsageDate, parseAmount, looksLikeHeader, inferColumns, isLumpSum, deriveCoverage }
  };
})(window);
