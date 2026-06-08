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
    onRequired();
  } else {
    _silentRefresh(onSuccess, onRequired);
  }
}

function _silentRefresh(onSuccess, onRequired) {
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
        _onAuthSuccess && _onAuthSuccess();
      }
    });
  }
  // 一度でも同意済みなら consent 画面をスキップ。初回のみ同意を求める
  const hasConsented = localStorage.getItem('sz_consented') === '1';
  _tokenClient.requestAccessToken({ prompt: hasConsented ? '' : 'consent' });
}

function signOut() {
  const token = _getStoredToken();
  if (token) google.accounts.oauth2.revoke(token, () => {});
  localStorage.removeItem('sz_token');
  localStorage.removeItem('sz_consented');
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
    exp: Date.now() + 58 * 60 * 1000
  }));
}
