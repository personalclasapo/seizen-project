function _apiBase() {
  return `https://sheets.googleapis.com/v4/spreadsheets/${getSpreadsheetId()}/values`;
}

async function _req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) { signOut(); return null; }
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  return res.json();
}

// 実シートのヘッダー順をキャッシュする（書き込み列ずれを防ぐため）
const _headerCache = {};

// --- sessionStorage キャッシュ（2分TTL） ---
const _CACHE_TTL = 2 * 60 * 1000;

function _cacheKey(name) {
  return `sz_sheet_${getSpreadsheetId()}_${name}`;
}
function _getCached(name) {
  try {
    const raw = sessionStorage.getItem(_cacheKey(name));
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return Date.now() - ts < _CACHE_TTL ? data : null;
  } catch { return null; }
}
function _setCache(name, data) {
  try {
    sessionStorage.setItem(_cacheKey(name), JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}
function _clearCache(name) {
  try { sessionStorage.removeItem(_cacheKey(name)); } catch {}
}

// シート全体を取得してオブジェクト配列で返す
async function getSheet(name) {
  const cached = _getCached(name);
  if (cached) return cached;
  const data = await _req('GET', `${_apiBase()}/${encodeURIComponent(name)}`);
  if (data?.values?.[0]) _headerCache[name] = data.values[0];
  const result = _toObjects(data);
  _setCache(name, result);
  return result;
}

async function _getHeaders(sheetName) {
  if (_headerCache[sheetName]) return _headerCache[sheetName];
  const data = await _req('GET', `${_apiBase()}/${encodeURIComponent(sheetName + '!1:1')}`);
  const headers = data?.values?.[0] || [];
  _headerCache[sheetName] = headers;
  return headers;
}

// 楽観的ロックのガード用メッセージ
const STALE_ROW_MESSAGE = '他の家族がデータを編集したため、この操作を中止しました。お手数ですが画面を再読み込みしてください。';

// 0始まりの列インデックスを A1 形式の列名（A, B, ..., Z, AA, ...）に変換
function _colLetter(index) {
  let s = '';
  let n = index;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

// 楽観的ロック：書き込み/削除の直前に、対象の物理行の id 列を1セルだけ読み、
// 期待する id と一致するか照合する。家族の別端末が間に行を挿入・削除して
// _row がずれていた場合、隣の項目を巻き込まないようにここで操作を中止する。
async function _verifyRowId(sheetName, rowIndex, expectedId) {
  if (!expectedId) return; // id を持たない行は照合をスキップ
  const headers = await _getHeaders(sheetName);
  const idCol = headers.indexOf('id');
  if (idCol === -1) return; // id 列を持たないシートは対象外
  const cell = `${sheetName}!${_colLetter(idCol)}${rowIndex}`;
  const data = await _req('GET', `${_apiBase()}/${encodeURIComponent(cell)}`);
  const actual = data?.values?.[0]?.[0] ?? '';
  if (String(actual) !== String(expectedId)) {
    throw new Error(STALE_ROW_MESSAGE);
  }
}

// オブジェクトを「実シートのヘッダー順」で1行更新する。
// schema 側の列順とシートの実列順がずれていても破損しない。
// 不足列は ensureHeader で末尾に補完してから書く。
async function saveRow(sheetName, rowIndex, obj, schemaCols) {
  const headers = await ensureHeader(sheetName, schemaCols);
  await updateRow(sheetName, rowIndex, toRow(obj, headers), obj.id);
  _clearCache(sheetName);
}

// オブジェクトを「実シートのヘッダー順」で1行追加する。
async function appendObj(sheetName, obj, schemaCols) {
  const headers = await ensureHeader(sheetName, schemaCols);
  await appendRow(sheetName, toRow(obj, headers));
  _clearCache(sheetName);
}

// 行を追加
async function appendRow(sheetName, values) {
  const range = `${sheetName}!A1`;
  const url = `${_apiBase()}/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  return _req('POST', url, { values: [values] });
}

// 行を更新（rowIndex は 1始まり）
// expectedId を渡すと、書き込み前に対象行の id を照合し、ずれていれば中止する。
async function updateRow(sheetName, rowIndex, values, expectedId) {
  await _verifyRowId(sheetName, rowIndex, expectedId);
  const range = `${sheetName}!A${rowIndex}`;
  const url = `${_apiBase()}/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  return _req('PUT', url, { values: [values] });
}

// ヘッダー行を書き込み（シート初期化用）
async function writeHeaders(sheetName, columns) {
  const range = `${sheetName}!A1`;
  const url = `${_apiBase()}/${encodeURIComponent(range)}?valueInputOption=RAW`;
  return _req('PUT', url, { values: [columns] });
}

// ヘッダー行に不足している列を末尾に補完する（既存列の順序は維持）。
// 旧バージョンで作成され color 等の列が無いシートを自己修復するために使う。
async function ensureHeader(sheetName, columns) {
  const current = await _getHeaders(sheetName);
  const missing = columns.filter(c => !current.includes(c));
  if (missing.length === 0) return current;
  const updated = [...current, ...missing];
  await writeHeaders(sheetName, updated);
  _headerCache[sheetName] = updated;
  return updated;
}

function _toObjects(data) {
  if (!data?.values || data.values.length < 2) return [];
  const [headers, ...rows] = data.values;
  return rows.map((row, i) => {
    const obj = { _row: i + 2 };
    headers.forEach((h, j) => { obj[h] = row[j] ?? ''; });
    return obj;
  });
}

// 行を削除（rowIndex は 1始まり）
// expectedId を渡すと、削除前に対象行の id を照合し、ずれていれば中止する。
async function deleteRow(sheetName, rowIndex, expectedId) {
  await _verifyRowId(sheetName, rowIndex, expectedId);
  const meta = await _req('GET',
    `https://sheets.googleapis.com/v4/spreadsheets/${getSpreadsheetId()}?fields=sheets.properties`
  );
  const sheet = meta.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) throw new Error('シートが見つかりません');
  await _req('POST',
    `https://sheets.googleapis.com/v4/spreadsheets/${getSpreadsheetId()}:batchUpdate`,
    { requests: [{ deleteDimension: {
      range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS',
               startIndex: rowIndex - 1, endIndex: rowIndex }
    }}]}
  );
  _clearCache(sheetName);
}

// 複数行を一括削除（異なるシートにまたがっても可）
// items: [{ sheetName: string, rowIndex: number }, ...]
async function bulkDeleteRowsMultiSheet(items) {
  if (items.length === 0) return;
  const meta = await _req('GET',
    `https://sheets.googleapis.com/v4/spreadsheets/${getSpreadsheetId()}?fields=sheets.properties`
  );
  const sheetIdMap = {};
  for (const s of meta.sheets) sheetIdMap[s.properties.title] = s.properties.sheetId;
  const sorted = [...items].sort((a, b) => b.rowIndex - a.rowIndex);
  const requests = sorted.map(({ sheetName, rowIndex }) => ({
    deleteDimension: {
      range: { sheetId: sheetIdMap[sheetName], dimension: 'ROWS',
               startIndex: rowIndex - 1, endIndex: rowIndex }
    }
  }));
  await _req('POST',
    `https://sheets.googleapis.com/v4/spreadsheets/${getSpreadsheetId()}:batchUpdate`,
    { requests }
  );
  [...new Set(items.map(i => i.sheetName))].forEach(n => _clearCache(n));
}

// カラム配列からオブジェクトを行配列に変換
function toRow(obj, columns) {
  return columns.map(col => {
    const v = obj[col] ?? '';
    // Sheets API (USER_ENTERED) converts leading-zero strings (e.g. "090...") to numbers.
    // Prefix with apostrophe to force text storage.
    if (typeof v === 'string' && /^0\d/.test(v)) return "'" + v;
    return v;
  });
}
