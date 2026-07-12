// Shared types for Palworld Server Manager (main <-> renderer).
// Adapted from bedrock-server-manager (MIT, Copyright (c) 2026 yuzum).

export type ServerStatus =
  | 'not-installed'
  | 'installing'
  | 'updating'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

export type LogSource = 'stdout' | 'stderr' | 'system' | 'steamcmd' | 'rcon';
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogLine {
  id: number;
  ts: number;
  level: LogLevel;
  source: LogSource;
  text: string;
}

export interface StartResult {
  ok: boolean;
  error?: string;
}

export type PalOptionValue = string | number | boolean;
export type PalOptions = Record<string, PalOptionValue>;

export interface PlayerInfo {
  name: string;
  playerId?: string;
  steamId?: string;
  userId?: string; // REST API id used for kick/ban (e.g. "steam_0123...")
}

export interface BackupInfo {
  id: string;
  name: string;
  ts: number;
  size: number;
}

export interface SystemMetrics {
  running: boolean;
  cpu: number; // percent (host process, via pidusage)
  memory: number; // bytes (host process)
  uptime: number; // ms since started
  // Server-reported metrics (REST /metrics), present only while running.
  serverFps?: number;
  players?: number;
  maxPlayers?: number;
  days?: number;
}

export interface InstallState {
  installed: boolean;
}

// ---- in-app updates (electron-updater) ----
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion?: string;
  version?: string; // available / downloaded version
  percent?: number; // download progress (0-100)
  message?: string; // error message
}

// ---- scheduler ----
export type ScheduleAction = 'start' | 'stop' | 'restart' | 'backup';

export interface ScheduleEntry {
  id: string;
  enabled: boolean;
  days: number[]; // 0=Sun .. 6=Sat
  time: string; // "HH:MM" (local)
  action: ScheduleAction;
  warnMinutes?: number[]; // e.g. [5,1] -> "N分後に…" を各タイミングで送信
  countdownSec?: number; // 例: 10 -> 実行N秒前から秒読み。0/未設定でオフ
}

// ---- playit.gg ----
export type PlayitState =
  | 'disabled'
  | 'needs-secret'
  | 'installing'
  | 'starting'
  | 'connected'
  | 'error';

export interface PlayitStatus {
  state: PlayitState;
  installed: boolean;
  hasSecret: boolean;
  tunnelAddress?: string;
  message?: string;
}

// ---- persisted app settings ----
export interface AppSettings {
  serverDir?: string;
  steamCmdDir?: string;
  launchArgs?: string;
  autoRestart?: boolean;
  perfFlags?: boolean;
  publicLobby?: boolean; // append -publiclobby (list on the community browser)
  restApiEnabled?: boolean;
  restApiPort?: number;
  rconEnabled?: boolean; // legacy (RCON deprecated); kept for older settings
  rconPort?: number; // legacy
  adminPassword?: string;
  playitSecret?: string;
  playitTunnelAddress?: string;
  playitAutoStart?: boolean;
  schedule?: ScheduleEntry[];
  setupComplete?: boolean;
}

// ---- preload API surface (window.api) ----
export interface AppApi {
  getStatus(): Promise<ServerStatus>;
  start(): Promise<StartResult>;
  stop(): Promise<StartResult>;
  restart(): Promise<StartResult>;
  announce(message: string): Promise<StartResult>;
  kickPlayer(userId: string): Promise<StartResult>;
  banPlayer(userId: string): Promise<StartResult>;
  unbanPlayer(userId: string): Promise<StartResult>;
  saveWorld(): Promise<StartResult>;

  installOrUpdate(): Promise<StartResult>;
  getInstallState(): Promise<InstallState>;
  uninstallServer(): Promise<StartResult>;
  deleteWorldData(): Promise<StartResult>;

  getConfig(): Promise<PalOptions>;
  setConfig(patch: PalOptions): Promise<StartResult>;
  getConfigRaw(): Promise<string>;
  setConfigRaw(text: string): Promise<StartResult>;

  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  listBackups(): Promise<BackupInfo[]>;
  createBackup(): Promise<StartResult>;
  restoreBackup(id: string): Promise<StartResult>;
  openBackupsFolder(): Promise<void>;

  showPlayers(): Promise<PlayerInfo[]>;

  getPlayitStatus(): Promise<PlayitStatus>;
  enablePlayit(): Promise<PlayitStatus>;
  disablePlayit(): Promise<PlayitStatus>;
  setPlayitSecret(secret: string): Promise<PlayitStatus>;
  setPlayitAddress(address: string): Promise<PlayitStatus>;

  getSchedule(): Promise<ScheduleEntry[]>;
  setSchedule(entries: ScheduleEntry[]): Promise<ScheduleEntry[]>;

  openLogsFolder(): Promise<void>;
  openServerFolder(): Promise<string>;

  getLanAddress(): Promise<string>;
  openExternal(url: string): Promise<void>;

  getAppVersion(): Promise<string>;
  checkForUpdates(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  quitAndInstall(): Promise<void>;

  onLog(cb: (l: LogLine) => void): () => void;
  onStatus(cb: (s: ServerStatus) => void): () => void;
  onMetrics(cb: (m: SystemMetrics) => void): () => void;
  onPlayers(cb: (players: PlayerInfo[]) => void): () => void;
  onPlayitStatus(cb: (s: PlayitStatus) => void): () => void;
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
}
