let _tokenClient = null;
let _onAuthSuccess = null;
let _onAuthRequired = null;

window.onGsiLoad = function () {
  window.gsiReady = true;
  window.dispatchEvent(new CustomEvent('gsi-ready'));
};

function waitForGsi() {
  if (window.gsiReady) return Promise.resolve();
  return new Promise(resolve => window.addEventListener('gsi-ready', resolve, { once: true }));
}

function initAuth(onSuccess, onRequired, opts = {}) {
  _onAuthSuccess = onSuccess;
  _onAuthRequired = onRequired;
  const token = _getStoredToken();
  if (token) {
    onSuccess();
    // 期限が近づいていれば裏で先にトークンを更新しておく（画面はブロックしない）
    if (_isTokenExpiringSoon()) _backgroundRefresh();
  } else if (opts.silent === false) {
    onRequired();
  } else {
    _silentRefresh(onSuccess, onRequired);
  }
}

// 期限まで残り10分を切ったら「もうすぐ切れる」とみなす
function _isTokenExpiringSoon() {
  try {
    const d = JSON.parse(localStorage.getItem('sz_token'));
    return d && (d.exp - Date.now() < 10 * 60 * 1000);
  } catch { return false; }
}

// 画面を止めずに裏でトークンだけ更新する。失敗しても従来動作にフォールバック
let _bgRefreshing = false;
function _backgroundRefresh() {
  if (_bgRefreshing) return;
  if (localStorage.getItem('sz_switch_account') === '1') return;
  _bgRefreshing = true;
  try {
    if (!_tokenClient) {
      _tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: CONFIG.SCOPES,
        callback: (response) => {
          _bgRefreshing = false;
          if (response.error) return;
          _storeToken(response.access_token);
          localStorage.setItem('sz_consented', '1');
          localStorage.removeItem('sz_user_email');
        }
      });
    }
    _tokenClient.requestAccessToken({ prompt: '' });
  } catch (e) {
    _bgRefreshing = false;
  }
}

function _silentRefresh(onSuccess, onRequired) {
  // ログアウト直後は自動再ログインせず、ログイン画面に誘導する
  if (localStorage.getItem('sz_switch_account') === '1') {
    onRequired();
    return;
  }
  let settled = false;
  const finish = (fn) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };

  // スマホでGSIの応答が遅れるケースに備えて余裕を持たせる
  const timer = setTimeout(() => finish(onRequired), 12000);

  if (!_tokenClient) {
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: CONFIG.SCOPES,
      callback: (response) => {
        if (response.error) {
          finish(onRequired);
          return;
        }
        _storeToken(response.access_token);
        localStorage.setItem('sz_consented', '1');
        // 別アカウントで再発行される可能性があるためメールキャッシュは破棄
        localStorage.removeItem('sz_user_email');
        finish(onSuccess);
      }
    });
  }
  try {
    _tokenClient.requestAccessToken({ prompt: '' });
  } catch (e) {
    finish(onRequired);
  }
}

function signIn() {
  if (!_tokenClient) {
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: CONFIG.SCOPES,
      callback: (response) => {
        if (response.error) {
          _onAuthRequired && _onAuthRequired();
          return;
        }
        _storeToken(response.access_token);
        localStorage.setItem('sz_consented', '1');
        localStorage.removeItem('sz_switch_account');
        localStorage.removeItem('sz_user_email');
        _onAuthSuccess && _onAuthSuccess();
      }
    });
  }
  // ログアウト直後はアカウント選択を表示。それ以外は一度同意済みなら consent をスキップ
  const switchAccount = localStorage.getItem('sz_switch_account') === '1';
  const hasConsented = localStorage.getItem('sz_consented') === '1';
  _tokenClient.requestAccessToken({
    prompt: switchAccount ? 'select_account' : (hasConsented ? '' : 'consent')
  });
}

function signOut() {
  const token = _getStoredToken();
  if (token) google.accounts.oauth2.revoke(token, () => {});
  localStorage.removeItem('sz_token');
  localStorage.removeItem('sz_consented');
  localStorage.removeItem('sz_user_email');
  // 次回ログイン時にアカウント選択を出し、自動再ログインを防ぐ
  localStorage.setItem('sz_switch_account', '1');
  window.location.href = 'index.html';
}

// ── ログイン中アカウントの確認（Drive API の about を利用）──
async function fetchUserEmail() {
  const token = _getStoredToken();
  if (!token) return '';
  const cached = localStorage.getItem('sz_user_email');
  if (cached) return cached;
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return '';
    const d = await res.json();
    const email = d.user?.emailAddress || '';
    if (email) localStorage.setItem('sz_user_email', email);
    return email;
  } catch {
    return '';
  }
}

function getToken() {
  return _getStoredToken();
}

function _getStoredToken() {
  try {
    const d = JSON.parse(localStorage.getItem('sz_token'));
    if (!d || Date.now() > d.exp) {
      localStorage.removeItem('sz_token');
      return null;
    }
    return d.token;
  } catch {
    return null;
  }
}

function _storeToken(token) {
  localStorage.setItem('sz_token', JSON.stringify({
    token,
    exp: Date.now() + 58 * 60 * 1000
  }));
}
