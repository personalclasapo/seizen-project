// Google Picker のラッパー。drive.file スコープのまま、選択したファイル/フォルダに
// アクセス権が付与される（Google公式推奨方式）。

let _pickerApiLoaded = false;

function _loadGapiScript() {
  return new Promise((resolve, reject) => {
    if (window.gapi) return resolve();
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Google API スクリプトの読み込みに失敗しました'));
    document.head.appendChild(s);
  });
}

function _loadPickerModule() {
  return new Promise((resolve) => {
    gapi.load('picker', { callback: resolve });
  });
}

async function ensurePicker() {
  if (_pickerApiLoaded) return;
  await _loadGapiScript();
  await _loadPickerModule();
  _pickerApiLoaded = true;
}

// 共通：Picker を開いて選択結果を返す（{id, name} または null）
// buildView は google.picker 読み込み後に呼ばれ、View を返す関数
async function _showPicker(buildView) {
  await ensurePicker();
  const token = getToken();
  if (!token) throw new Error('ログインが必要です');

  return new Promise((resolve) => {
    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(CONFIG.API_KEY)
      .addView(buildView())
      .setCallback((data) => {
        const action = data[google.picker.Response.ACTION];
        if (action === google.picker.Action.PICKED) {
          const doc = data[google.picker.Response.DOCUMENTS][0];
          resolve({ id: doc[google.picker.Document.ID], name: doc[google.picker.Document.NAME] });
        } else if (action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

// スプレッドシートを選択
async function pickSpreadsheet() {
  return _showPicker(() =>
    new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setMode(google.picker.DocsViewMode.LIST)
  );
}

// フォルダを選択
async function pickFolder() {
  return _showPicker(() =>
    new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder')
      .setMode(google.picker.DocsViewMode.LIST)
  );
}
