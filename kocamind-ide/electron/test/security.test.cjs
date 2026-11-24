const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedAppUrl,
  isSafeExternalUrl,
  hardenWindow,
  applySessionPolicies,
} = require('../security.cjs');

function createFakeWindow() {
  const listeners = new Map();
  let windowOpenHandler = null;

  const webContents = {
    setWindowOpenHandler(fn) {
      windowOpenHandler = fn;
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
  };

  return {
    win: { webContents },
    getWindowOpenHandler: () => windowOpenHandler,
    emit(event, eventObj, ...args) {
      const handlers = listeners.get(event) || [];
      for (const h of handlers) {
        h(eventObj, ...args);
      }
    },
  };
}

function createFakeSession() {
  let requestHandler = null;
  let checkHandler = null;
  return {
    session: {
      setPermissionRequestHandler(fn) {
        requestHandler = fn;
      },
      setPermissionCheckHandler(fn) {
        checkHandler = fn;
      },
    },
    getRequestHandler: () => requestHandler,
    getCheckHandler: () => checkHandler,
  };
}

describe('electron/security.cjs', () => {
  describe('isAllowedAppUrl', () => {
    const appFileUrlPrefix = 'file:///C:/app/kocamind-ide/dist/';

    it('1. geliştirme modunda yalnızca devServerUrl ile aynı origin izinli', () => {
      const opts = { isDev: true, devServerUrl: 'http://localhost:5173', appFileUrlPrefix };
      assert.equal(isAllowedAppUrl('http://localhost:5173', opts), true);
      assert.equal(isAllowedAppUrl('http://localhost:5173/index.html?x=1#hash', opts), true);
      assert.equal(isAllowedAppUrl('http://localhost:3000/index.html', opts), false);
      assert.equal(isAllowedAppUrl('https://localhost:5173/index.html', opts), false);
      assert.equal(isAllowedAppUrl('https://kocamind.com', opts), false);
      assert.equal(isAllowedAppUrl('file:///C:/app/kocamind-ide/dist/index.html', opts), false);
      assert.equal(isAllowedAppUrl('not-a-valid-url', opts), false);
    });

    it('2. üretim modunda yalnızca appFileUrlPrefix ile başlayan file: adresi izinli', () => {
      const opts = { isDev: false, devServerUrl: 'http://localhost:5173', appFileUrlPrefix };
      assert.equal(isAllowedAppUrl('file:///C:/app/kocamind-ide/dist/index.html', opts), true);
      assert.equal(isAllowedAppUrl('file:///C:/app/kocamind-ide/dist/assets/app.js', opts), true);
      assert.equal(isAllowedAppUrl('http://localhost:5173', opts), false);
      assert.equal(isAllowedAppUrl('https://kocamind.com', opts), false);
      assert.equal(isAllowedAppUrl('file:///C:/app/kocamind-ide/electron/main.cjs', opts), false);
      assert.equal(isAllowedAppUrl('file:///C:/app/kocamind-ide/dist/../electron/main.cjs', opts), false);
      assert.equal(isAllowedAppUrl('file:///C:/app/kocamind-ide/dist-other/index.html', opts), false);
      assert.equal(isAllowedAppUrl('', opts), false);
    });
  });

  describe('isSafeExternalUrl', () => {
    it('3. yalnızca https: ve mailto: adreslerini kabul eder; diğer protokolleri ve bozuk URL\'leri reddeder', () => {
      assert.equal(isSafeExternalUrl('https://kocamind.com/docs'), true);
      assert.equal(isSafeExternalUrl('mailto:destek@kocamind.com'), true);

      assert.equal(isSafeExternalUrl('http://kocamind.com'), false);
      assert.equal(isSafeExternalUrl('file:///etc/passwd'), false);
      assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
      assert.equal(isSafeExternalUrl('data:text/html,<h1>hi</h1>'), false);
      assert.equal(isSafeExternalUrl('vscode://file/path'), false);
      assert.equal(isSafeExternalUrl('://bozuk-url'), false);
      assert.equal(isSafeExternalUrl(''), false);
      assert.equal(isSafeExternalUrl(null), false);
    });
  });

  describe('hardenWindow', () => {
    const appFileUrlPrefix = 'file:///C:/app/kocamind-ide/dist/';

    it('4. yeni pencere her zaman deny döner; güvenli adreste openExternal çağrılır, güvensizde çağrılmaz', () => {
      const fake = createFakeWindow();
      const opened = [];
      hardenWindow(fake.win, {
        isDev: false,
        appFileUrlPrefix,
        openExternal: (u) => opened.push(u),
      });

      const handler = fake.getWindowOpenHandler();
      assert.equal(typeof handler, 'function');

      const resSafe = handler({ url: 'https://kocamind.com/help' });
      assert.deepEqual(resSafe, { action: 'deny' });
      assert.deepEqual(opened, ['https://kocamind.com/help']);

      const resMail = handler({ url: 'mailto:info@kocamind.com' });
      assert.deepEqual(resMail, { action: 'deny' });
      assert.deepEqual(opened, ['https://kocamind.com/help', 'mailto:info@kocamind.com']);

      const resUnsafe = handler({ url: 'http://evil.example.com' });
      assert.deepEqual(resUnsafe, { action: 'deny' });
      assert.equal(opened.length, 2);

      const resJs = handler({ url: 'javascript:alert(1)' });
      assert.deepEqual(resJs, { action: 'deny' });
      assert.equal(opened.length, 2);
    });

    it('5. will-navigate ve will-redirect olaylarında izinsiz gezinme preventDefault ile durdurulur ve güvenli dış adres openExternal ile açılır', () => {
      const fake = createFakeWindow();
      const opened = [];
      hardenWindow(fake.win, {
        isDev: false,
        appFileUrlPrefix,
        openExternal: (u) => opened.push(u),
      });

      // İzinli uygulama içi gezinme
      let prevented = false;
      fake.emit(
        'will-navigate',
        { preventDefault: () => { prevented = true; } },
        'file:///C:/app/kocamind-ide/dist/index.html'
      );
      assert.equal(prevented, false);
      assert.equal(opened.length, 0);

      // İzinsiz ama güvenli dış adres (will-navigate)
      prevented = false;
      fake.emit(
        'will-navigate',
        { preventDefault: () => { prevented = true; } },
        'https://kocamind.com/pricing'
      );
      assert.equal(prevented, true);
      assert.deepEqual(opened, ['https://kocamind.com/pricing']);

      // İzinsiz ve güvensiz dış adres (will-redirect)
      prevented = false;
      fake.emit(
        'will-redirect',
        { preventDefault: () => { prevented = true; } },
        'http://insecure.example.com'
      );
      assert.equal(prevented, true);
      assert.equal(opened.length, 1);

      // will-attach-webview her zaman engellenir
      prevented = false;
      fake.emit('will-attach-webview', { preventDefault: () => { prevented = true; } });
      assert.equal(prevented, true);
    });
  });

  describe('applySessionPolicies', () => {
    it('6. izin isteyicisi ve izin kontrolcüsü her zaman false döner', () => {
      const fake = createFakeSession();
      applySessionPolicies(fake.session);

      const reqHandler = fake.getRequestHandler();
      const checkHandler = fake.getCheckHandler();
      assert.equal(typeof reqHandler, 'function');
      assert.equal(typeof checkHandler, 'function');

      let callbackResult = null;
      reqHandler({}, 'media', (granted) => {
        callbackResult = granted;
      });
      assert.equal(callbackResult, false);
      assert.equal(checkHandler({}, 'geolocation'), false);
    });
  });
});
