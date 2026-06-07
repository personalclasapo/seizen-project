const CONFIG = {
  CLIENT_ID: '1074813068152-8iablhbtg9ful7iir2c8d2j614mm5mue.apps.googleusercontent.com',
  API_KEY: 'AIzaSyA4kOpmmZKguqYwAzAjh27ORVYuE2MR3ys',
  // 旧来のフォールバック（Picker未設定時に使用）。Picker選択後は localStorage が優先。
  SPREADSHEET_ID: '15vFaStY7OOcMtq1YmKBIcjyTGg3_vVla2NfdYL7WtOg',
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file'
};

// ── 設定の保持（localStorage、端末ごと）──
function getSpreadsheetId() {
  return localStorage.getItem('sz_spreadsheet_id') || CONFIG.SPREADSHEET_ID || '';
}
function setSpreadsheetId(id) {
  if (id) localStorage.setItem('sz_spreadsheet_id', id);
}
function getDriveFolderId() {
  return localStorage.getItem('sz_drive_folder') || '';
}
function setDriveFolderId(id) {
  if (id) localStorage.setItem('sz_drive_folder', id);
}
function getDriveFolderName() {
  return localStorage.getItem('sz_drive_folder_name') || '';
}
function setDriveFolderName(name) {
  if (name) localStorage.setItem('sz_drive_folder_name', name);
}
function getSpreadsheetName() {
  return localStorage.getItem('sz_spreadsheet_name') || '';
}
function setSpreadsheetName(name) {
  if (name) localStorage.setItem('sz_spreadsheet_name', name);
}
