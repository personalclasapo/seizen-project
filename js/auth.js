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
  } else if (opts.silent === false) {
    // ログイン画面など：サイレント更新せず即ログインを要求
    onRequired();
  } else {
    _silentRefresh(onSuccess, onRequired);
  }
}

function _silentRefresh(onSuccess, onRequired) {
  let settled = false;
  const finish = (fn) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };

  // コールバックが返らない場合の保険（スマホでよく起きる）
  const timer = setTimeout(() => finish(onRequired), 4000);

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
        _onAuthSuccess && _onAuthSuccess();
      }
    });
  }
  _tokenClient.requestAccessToken({ prompt: _getStoredToken() ? '' : 'consent' });
}

function signOut() {
  const token = _getStoredToken();
  if (token) google.accounts.oauth2.revoke(token, () => {});
  localStorage.removeItem('sz_token');
  window.location.href = 'index.html';
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
    exp: Date.now() + 55 * 60 * 1000
  }));
}
