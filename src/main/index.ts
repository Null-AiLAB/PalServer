import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { serverManager } from './server-manager';
import { playitManager } from './playit-manager';
import { ensureDirs } from './paths';
import { startScheduler } from './scheduler';
import { initUpdater } from './updater';
import { TRAY_ICON_DATA_URL } from './tray-icon';

// vite-plugin-electron compiles this file to CommonJS, so __dirname is available.
const DIST_RENDERER = path.join(__dirname, '../../dist');
const PRELOAD = path.join(__dirname, '../preload/preload.js');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Single instance: focus the existing window instead of opening a second one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => showWindow());

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Closing the window hides it to the tray instead of quitting.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(DIST_RENDERER, 'index.html'));
  }
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  tray = new Tray(icon);
  tray.setToolTip('Palworld Server Manager');
  const menu = Menu.buildFromTemplate([
    { label: 'ウィンドウを表示', click: () => showWindow() },
    { type: 'separator' },
    {
      label: '完全に終了',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

void app.whenReady().then(() => {
  ensureDirs();
  registerIpc(() => mainWindow);
  startScheduler();
  initUpdater(() => mainWindow);
  createTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

// Keep running in the tray even when all windows are closed.
app.on('window-all-closed', () => {
  // Intentionally do nothing: the app lives in the tray until "完全に終了".
});

app.on('before-quit', () => {
  isQuitting = true;
  serverManager.forceStop();
  playitManager.forceStop();
});
