import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { serverManager } from './server-manager';
import { playitManager } from './playit-manager';
import { ensureDirs } from './paths';

// vite-plugin-electron compiles this file to CommonJS, so __dirname is available.
const DIST_RENDERER = path.join(__dirname, '../../dist');
const PRELOAD = path.join(__dirname, '../preload/preload.js');

let mainWindow: BrowserWindow | null = null;

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

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(DIST_RENDERER, 'index.html'));
  }
}

void app.whenReady().then(() => {
  ensureDirs();
  registerIpc(() => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  serverManager.forceStop();
  playitManager.forceStop();
});
