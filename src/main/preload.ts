import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppApi, LogLine, PlayitStatus, ServerStatus, SystemMetrics, UpdateStatus } from '../shared/types';

function subscribe<T>(channel: string, cb: (p: T) => void): () => void {
  const l = (_e: IpcRendererEvent, p: T) => cb(p);
  ipcRenderer.on(channel, l);
  return () => ipcRenderer.removeListener(channel, l);
}

const api: AppApi = {
  getStatus: () => ipcRenderer.invoke('server:status'),
  start: () => ipcRenderer.invoke('server:start'),
  stop: () => ipcRenderer.invoke('server:stop'),
  restart: () => ipcRenderer.invoke('server:restart'),
  sendCommand: (c) => ipcRenderer.invoke('server:command', c),

  installOrUpdate: () => ipcRenderer.invoke('setup:installOrUpdate'),
  getInstallState: () => ipcRenderer.invoke('setup:getInstallState'),
  uninstallServer: () => ipcRenderer.invoke('setup:uninstall'),
  deleteWorldData: () => ipcRenderer.invoke('server:deleteWorld'),

  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (p) => ipcRenderer.invoke('config:set', p),
  getConfigRaw: () => ipcRenderer.invoke('config:getRaw'),
  setConfigRaw: (text) => ipcRenderer.invoke('config:setRaw', text),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (p) => ipcRenderer.invoke('settings:set', p),

  listBackups: () => ipcRenderer.invoke('backup:list'),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: (id) => ipcRenderer.invoke('backup:restore', id),
  openBackupsFolder: () => ipcRenderer.invoke('backup:openFolder'),

  showPlayers: () => ipcRenderer.invoke('player:show'),

  getPlayitStatus: () => ipcRenderer.invoke('playit:status'),
  enablePlayit: () => ipcRenderer.invoke('playit:enable'),
  disablePlayit: () => ipcRenderer.invoke('playit:disable'),
  setPlayitSecret: (s) => ipcRenderer.invoke('playit:setSecret', s),
  setPlayitAddress: (a) => ipcRenderer.invoke('playit:setAddress', a),

  getSchedule: () => ipcRenderer.invoke('schedule:get'),
  setSchedule: (entries) => ipcRenderer.invoke('schedule:set', entries),

  openLogsFolder: () => ipcRenderer.invoke('log:openFolder'),
  openServerFolder: () => ipcRenderer.invoke('system:openServerFolder'),

  getLanAddress: () => ipcRenderer.invoke('system:lanAddress'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  quitAndInstall: () => ipcRenderer.invoke('update:install'),

  onLog: (cb) => subscribe<LogLine>('server:log', cb),
  onStatus: (cb) => subscribe<ServerStatus>('server:status', cb),
  onMetrics: (cb) => subscribe<SystemMetrics>('system:metrics', cb),
  onPlayitStatus: (cb) => subscribe<PlayitStatus>('playit:status', cb),
  onUpdateStatus: (cb) => subscribe<UpdateStatus>('update:status', cb),
};

contextBridge.exposeInMainWorld('api', api);
