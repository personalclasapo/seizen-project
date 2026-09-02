/* SeiZen プロトタイプ｜支払い明細から探す：Vpass ソースアダプタ
   ------------------------------------------------------------------
   設計「支払い明細から探す」§6-1 / §15-4 に対応。

   三井住友カード（Vpass）の「ご利用明細（CSV）」を、共通の「取引」
   配列へ変換する。アダプタが担うのは形式の変換だけ。サービス特定・
   契約性判定はしない。

   ── 実際のフォーマット（実物で確認）───────────────────
     ・ヘッダー行は無い。列は位置で決まる。
     ・文字コードは Shift-JIS(CP932)、改行 CRLF。
     ・1枚目のカード情報行から始まり、明細行が続く。カードが複数
       あると「カード情報行＋明細」のブロックが空行を挟んで繰り返す。
     ・最終行は合計（利用日・店名が空で、金額欄だけ入る）。

       A ご利用日        2018/2/5 （ゼロ埋めなし）
       B ご利用店名
       C ご利用金額       総額。分割・リボもここは総額
       D 支払区分         1=一括 / それ以外=分割・リボ等
       E 分割回数
       F お支払い金額     今回の請求額（分割だと総額と違う）
       G 現地通貨額
       H 略称
       I 換算レート
       J 換算日
       K 備考             「返品」「2月分」等

     カード情報行  … "VPASSガイド 様", "4980-****-****-****", "", "SMBCCARDクラシック☆", …
                      → A が日付でないので明細行と区別できる
     合計行        … "", "", "", "", "", "38560", …
                      → A が空 → スキップ

   ── 使う項目（§6-1）───────────────────────────────
     A ご利用日   → usage_date（"YYYY-MM-DD"）
     C ご利用金額 → amount（正の円。負数・0は除外）
     B ご利用店名 → merchant_raw / merchant_norm
   締め日・請求月・お支払い金額(F)は使わない（分割払いが定額サブスクと
   同型になるのを避ける・§6-1）。対象期間は取引の利用日の最小〜最大から
   導く（§6-1「明細に無い項目」。請求月という列は実在しない）。

   ── 除外（§6-1）────────────────────────────────────
     支払区分 ≠ 1（分割・リボ）… 系列化の前に落とす
     amount ≤ 0（返金・調整）  … 同上

   ── 文字コード（§15-4）─────────────────────────────
     三井住友カードの明細は Shift-JIS。ユーザーに UTF-8 変換させない。
     parse() は「バイト列（ArrayBuffer / Uint8Array / Buffer）」と
     「デコード済み文字列（?debug 復元・テスト用）」の両方を受ける。

   出力 transaction（永続化しない・§3-1）：
     usage_date    : "YYYY-MM-DD"
     amount        : int（正の円）
     merchant_raw  : string（trim のみ）
     merchant_norm : string（NFKC・全角半角・大文字・空白整理）

   他アダプタ（rakuten.js 等）も parse(input, opts) → { ok, transactions,
   coverage, meta } の同一シグネチャで実装する（§15-4）。
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const ADAPTER_ID = 'vpass';

  /* ── 文字コード ───────────────────────────────────────
     バイト列なら UTF-8 として厳格デコードを試し、不正バイトがあれば
     Shift-JIS(CP932) とみなす。文字列ならそのまま返す。            */
  function decodeInput(input) {
    if (typeof input === 'string') return { text: input, encoding: 'string' };

    /* バイト列判定は instanceof に頼らない（別 realm の ArrayBuffer /
       Buffer / TypedArray を取りこぼさないため）。 */
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
      /* TextDecoder が無い環境。Latin-1 相当で文字列化。日本語は化けるが
         列判定で弾ける。実ブラウザには標準であるのでまず通らない。 */
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
    return rows;
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

  /* "2018/2/5" / "2026/03/03" / "2026-03-03" → "YYYY-MM-DD"。
     ゼロ埋めの有無どちらも受ける。日付でなければ null。 */
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

  /* 支払区分。"1" 以外（分割・リボ・不明・空）は除外対象。 */
  function isLumpSum(kubun) {
    const s = String(kubun == null ? '' : kubun).trim();
    return s === '1' || s === '１';
  }

  /* 取引の利用日の最小〜最大から対象期間を導く（§6-1）。
     取引が無ければ underivable。 */
  function deriveCoverage(usageDates) {
    const ds = usageDates.filter(Boolean).sort();
    if (ds.length === 0) return { coverage_from: null, coverage_to: null, coverage_status: 'underivable' };
    return { coverage_from: ds[0], coverage_to: ds[ds.length - 1], coverage_status: 'derived' };
  }

  /* ── メイン ─────────────────────────────────────────── */
  function parse(input, opts) {
    opts = opts || {};

    const decoded = decodeInput(input);
    const table = parseCsv(decoded.text);

    const transactions = [];
    const usageDates = [];
    const stats = {
      rows: 0, data_rows: 0,
      skipped_nondata: 0,          /* カード情報行・合計行・空行 */
      excluded_installment: 0,     /* 支払区分 ≠ 1 */
      excluded_nonpositive: 0,     /* 金額 ≤ 0（返品等） */
      parse_errors: 0             /* 日付/金額の書式不正 */
    };

    for (const cells of table) {
      stats.rows++;

      /* A（利用日）が日付でない行は明細行ではない：
         カード情報行（"VPASSガイド 様" 等）・合計行（A が空）・空行。
         これらは黙って飛ばす（三井住友の実CSVはこの構造）。 */
      const usage_date = parseUsageDate(cells[0]);
      if (usage_date == null) { stats.skipped_nondata++; continue; }

      stats.data_rows++;
      usageDates.push(usage_date);   /* coverage は除外前の全データ行から */

      const amount = parseAmount(cells[2]);
      const merchant_raw = String(cells[1] == null ? '' : cells[1]).trim();
      if (amount == null || merchant_raw === '') { stats.parse_errors++; continue; }

      if (!isLumpSum(cells[3])) { stats.excluded_installment++; continue; }
      if (amount <= 0)          { stats.excluded_nonpositive++; continue; }

      transactions.push({
        usage_date,
        amount,
        merchant_raw,
        merchant_norm: normalize(merchant_raw)
      });
    }

    if (stats.data_rows === 0) {
      return { ok: false, error: 'この明細から取引を1件も読み取れませんでした。三井住友カードのご利用明細（CSV）か、ご確認ください。' };
    }

    return {
      ok: true,
      transactions,
      coverage: deriveCoverage(usageDates),
      meta: { adapter_id: ADAPTER_ID, encoding: decoded.encoding, stats }
    };
  }

  global.SeiZenSourceVpass = {
    ADAPTER_ID,
    parse,
    _internal: { decodeInput, normalize, parseUsageDate, parseAmount, isLumpSum, deriveCoverage, parseCsv }
  };
})(window);
