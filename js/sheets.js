function _apiBase() {
  return `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values`;
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

// シート全体を取得してオブジェクト配列で返す
async function getSheet(name) {
  const data = await _req('GET', `${_apiBase()}/${encodeURIComponent(name)}`);
  return _toObjects(data);
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
    `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}?fields=sheets.properties`
  );
  const sheet = meta.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) throw new Error('シートが見つかりません');
  await _req('POST',
    `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}:batchUpdate`,
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
