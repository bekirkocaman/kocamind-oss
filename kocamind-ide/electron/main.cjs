const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { registerWorkspaceIpc } = require('./workspaceIpc.cjs');
const { registerAgentIpc } = require('./agentIpc.cjs');
const { registerTerminalIpc, killAll: killAllTerminals } = require('./terminalIpc.cjs');
const { createBackendModel } = require('./agent/modelAdapter.cjs');
const { createAuth } = require('./auth.cjs');
const { hardenWindow, applySessionPolicies } = require('./security.cjs');
const isDev = !app.isPackaged && process.env.KOCAMIND_DEV !== '0';
const appFileUrlPrefix = pathToFileURL(path.join(__dirname, '../dist/')).href;

const DEFAULT_API_BASE_URL = 'https://api.kocamind.com';
const DEFAULT_WEB_BASE_URL = 'https://kocamind.com';
const DEFAULT_FIREBASE_API_KEY = 'AIzaSyCXZA4rixnuuus280X8yzh339e-mln6X8M';

let mainWindow;

const apiBaseUrl = process.env.KOCAMIND_API_URL || DEFAULT_API_BASE_URL;
const auth = createAuth({
  apiBaseUrl,
  webBaseUrl: process.env.KOCAMIND_WEB_URL || DEFAULT_WEB_BASE_URL,
  firebaseApiKey: process.env.KOCAMIND_FIREBASE_API_KEY || DEFAULT_FIREBASE_API_KEY,
  storagePath: path.join(app.getPath('userData'), 'auth.bin'),
  safeStorage,
  openExternal: (url) => shell.openExternal(url),
});

ipcMain.handle('auth:login', async () => {
  try {
    return await auth.login();
  } catch {
    return { error: 'Giriş tamamlanamadı.' };
  }
});

ipcMain.handle('auth:logout', async () => {
  try {
    auth.logout();
    return { ok: true };
  } catch {
    return { error: 'Çıkış yapılamadı.' };
  }
});

ipcMain.handle('auth:state', async () => {
  try {
    const user = auth.getUser();
    return {
      loggedIn: auth.isLoggedIn(),
      email: user?.email || null,
      persisted: Boolean(user?.persisted),
    };
  } catch {
    return { error: 'Oturum durumu alınamadı.' };
  }
});

registerWorkspaceIpc({ ipcMain, dialog, getWindow: () => mainWindow });

registerAgentIpc({
  ipcMain,
  getWindow: () => mainWindow,
  getWorkspaceRoot: () => require('./workspaceIpc.cjs')._getCurrentRoot(),
  sessionDir: path.join(app.getPath('userData'), 'sessions'),
  createModel: () => createBackendModel({
    baseUrl: apiBaseUrl,
    getToken: () => auth.getIdToken(),
  }),
});

registerTerminalIpc({
  ipcMain,
  getWindow: () => mainWindow,
  getWorkspaceRoot: () => require('./workspaceIpc.cjs')._getCurrentRoot(),
});

app.on('web-contents-created', (_e, contents) => contents.setWindowOpenHandler(() => ({ action: 'deny' })));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hidden',
    backgroundColor: '#09090B',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  hardenWindow(mainWindow, {
    isDev,
    devServerUrl: 'http://localhost:5173',
    appFileUrlPrefix,
    openExternal: (url) => shell.openExternal(url),
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  applySessionPolicies(session.defaultSession);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', killAllTerminals);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('window-controls', (event, action) => {
  const window = BrowserWindow.getFocusedWindow();
  if (!window) return;
  if (action === 'close') window.close();
  if (action === 'minimize') window.minimize();
  if (action === 'maximize') {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }
});
