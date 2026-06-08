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

// シート全体を取得してオブジェクト配列で返す
async function getSheet(name) {
  const data = await _req('GET', `${_apiBase()}/${encodeURIComponent(name)}`);
  if (data?.values?.[0]) _headerCache[name] = data.values[0];
  return _toObjects(data);
}

async function _getHeaders(sheetName) {
  if (_headerCache[sheetName]) return _headerCache[sheetName];
  const data = await _req('GET', `${_apiBase()}/${encodeURIComponent(sheetName + '!1:1')}`);
  const headers = data?.values?.[0] || [];
  _headerCache[sheetName] = headers;
  return headers;
}

// オブジェクトを「実シートのヘッダー順」で1行更新する。
// schema 側の列順とシートの実列順がずれていても破損しない。
// 不足列は ensureHeader で末尾に補完してから書く。
async function saveRow(sheetName, rowIndex, obj, schemaCols) {
  const headers = await ensureHeader(sheetName, schemaCols);
  await updateRow(sheetName, rowIndex, toRow(obj, headers));
}

// オブジェクトを「実シートのヘッダー順」で1行追加する。
async function appendObj(sheetName, obj, schemaCols) {
  const headers = await ensureHeader(sheetName, schemaCols);
  await appendRow(sheetName, toRow(obj, headers));
}

// 行を追加
async function appendRow(sheetName, values) {
  const range = `${sheetName}!A1`;
  const url = `${_apiBase()}/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  return _req('POST', url, { values: [values] });
}

// 行を更新（rowIndex は 1始まり）
async function updateRow(sheetName, rowIndex, values) {
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
async function deleteRow(sheetName, rowIndex) {
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
}

// カラム配列からオブジェクトを行配列に変換
function toRow(obj, columns) {
  return columns.map(col => obj[col] ?? '');
}
