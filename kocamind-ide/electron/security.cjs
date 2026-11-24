function isAllowedAppUrl(url, { isDev, devServerUrl = 'http://localhost:5173', appFileUrlPrefix } = {}) {
  if (typeof url !== 'string' || !url.trim()) return false;

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  if (isDev) {
    if (typeof devServerUrl !== 'string' || !devServerUrl.trim()) return false;
    let parsedDev;
    try {
      parsedDev = new URL(devServerUrl);
    } catch {
      return false;
    }
    if (!parsedDev.origin || parsedDev.origin === 'null') return false;
    return parsedUrl.origin === parsedDev.origin;
  }

  if (parsedUrl.protocol !== 'file:') return false;
  if (typeof appFileUrlPrefix !== 'string' || !appFileUrlPrefix.trim()) return false;

  let parsedPrefix;
  try {
    parsedPrefix = new URL(appFileUrlPrefix);
  } catch {
    return false;
  }

  if (parsedPrefix.protocol !== 'file:') return false;
  const normalizedPrefix = parsedPrefix.href.endsWith('/')
    ? parsedPrefix.href
    : `${parsedPrefix.href}/`;

  return parsedUrl.href.startsWith(normalizedPrefix);
}

function isSafeExternalUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol === 'https:') {
    return Boolean(parsed.hostname);
  }
  if (parsed.protocol === 'mailto:') {
    return Boolean(parsed.pathname);
  }
  return false;
}

function hardenWindow(win, { isDev, devServerUrl, appFileUrlPrefix, openExternal } = {}) {
  if (!win || !win.webContents) return;
  const { webContents } = win;

  webContents.setWindowOpenHandler(({ url } = {}) => {
    if (isSafeExternalUrl(url) && typeof openExternal === 'function') {
      openExternal(url);
    }
    return { action: 'deny' };
  });

  const handleNavigation = (event, url) => {
    if (!isAllowedAppUrl(url, { isDev, devServerUrl, appFileUrlPrefix })) {
      event.preventDefault();
      if (isSafeExternalUrl(url) && typeof openExternal === 'function') {
        openExternal(url);
      }
    }
  };

  webContents.on('will-navigate', handleNavigation);
  webContents.on('will-redirect', handleNavigation);
  webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function applySessionPolicies(session) {
  if (!session) return;
  session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.setPermissionCheckHandler(() => false);
}

module.exports = {
  isAllowedAppUrl,
  isSafeExternalUrl,
  hardenWindow,
  applySessionPolicies,
};
