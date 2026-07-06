// In-app auto-update via electron-updater against GitHub Releases.
// The renderer drives this: check -> (available) download -> (downloaded) install.

import { app, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '../shared/types';

const { autoUpdater } = electronUpdater;

type GetWindow = () => BrowserWindow | null;

let lastStatus: UpdateStatus = { state: 'idle', currentVersion: app.getVersion() };

export function initUpdater(getWindow: GetWindow): void {
  // We download only when the user asks, and install on quit.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (s: Partial<UpdateStatus>) => {
    lastStatus = { currentVersion: app.getVersion(), ...s } as UpdateStatus;
    getWindow()?.webContents.send('update:status', lastStatus);
  };

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: err?.message ?? String(err) }));
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }));
}

function devGuard(): UpdateStatus | null {
  if (!app.isPackaged) {
    return {
      state: 'error',
      message: '開発モードでは更新できません。インストーラ版でご利用ください。',
      currentVersion: app.getVersion(),
    };
  }
  return null;
}

export function getStatus(): UpdateStatus {
  return lastStatus;
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const dev = devGuard();
  if (dev) return (lastStatus = dev);
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    lastStatus = { state: 'error', message: (e as Error).message, currentVersion: app.getVersion() };
  }
  return lastStatus;
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  const dev = devGuard();
  if (dev) return (lastStatus = dev);
  try {
    await autoUpdater.downloadUpdate();
  } catch (e) {
    lastStatus = { state: 'error', message: (e as Error).message, currentVersion: app.getVersion() };
  }
  return lastStatus;
}

export function quitAndInstall(): void {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall();
}
