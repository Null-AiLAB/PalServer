import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BackupInfo,
  LogLine,
  PalOptions,
  PlayerInfo,
  PlayitStatus,
  ServerStatus,
  SystemMetrics,
} from '../shared/types';

const api = window.api;

type Tab = 'console' | 'settings' | 'network' | 'backup' | 'players';

const STATUS_LABEL: Record<ServerStatus, string> = {
  'not-installed': '未インストール',
  installing: 'インストール中',
  updating: '更新中',
  stopped: '停止中',
  starting: '起動中',
  running: '稼働中',
  stopping: '停止処理中',
  error: 'エラー',
};

const STATUS_COLOR: Record<ServerStatus, string> = {
  'not-installed': 'bg-neutral-500',
  installing: 'bg-amber-500',
  updating: 'bg-amber-500',
  stopped: 'bg-neutral-500',
  starting: 'bg-amber-500',
  running: 'bg-emerald-500',
  stopping: 'bg-amber-500',
  error: 'bg-red-500',
};

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'bool' | 'enum';
  options?: string[];
}

const CONFIG_FIELDS: FieldDef[] = [
  { key: 'ServerName', label: 'サーバー名', type: 'text' },
  { key: 'ServerDescription', label: '説明', type: 'text' },
  { key: 'ServerPassword', label: '参加パスワード', type: 'password' },
  { key: 'AdminPassword', label: '管理者パスワード (RCON)', type: 'password' },
  { key: 'PublicPort', label: '公開ポート', type: 'number' },
  { key: 'ServerPlayerMaxNum', label: '最大人数', type: 'number' },
  { key: 'Difficulty', label: '難易度', type: 'enum', options: ['None', 'Casual', 'Normal', 'Hard'] },
  {
    key: 'DeathPenalty',
    label: 'デスペナルティ',
    type: 'enum',
    options: ['None', 'Item', 'ItemAndEquipment', 'All'],
  },
  { key: 'bIsPvP', label: 'PvP を許可', type: 'bool' },
  { key: 'ExpRate', label: '経験値倍率', type: 'number' },
  { key: 'PalCaptureRate', label: 'パル捕獲率', type: 'number' },
  { key: 'DayTimeSpeedRate', label: '昼の速さ倍率', type: 'number' },
  { key: 'NightTimeSpeedRate', label: '夜の速さ倍率', type: 'number' },
];

const RCON_PORT_DEFAULT = 25575;

function bytes(n: number): string {
  if (n <= 0) return '0 MB';
  return `${(n / 1024 / 1024).toFixed(0)} MB`;
}
function uptime(ms: number): string {
  if (ms <= 0) return '-';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function App() {
  const [status, setStatus] = useState<ServerStatus>('stopped');
  const [metrics, setMetrics] = useState<SystemMetrics>({ running: false, cpu: 0, memory: 0, uptime: 0 });
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [tab, setTab] = useState<Tab>('console');
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<PalOptions>({});
  const [savedMsg, setSavedMsg] = useState('');

  const [playit, setPlayit] = useState<PlayitStatus>({ state: 'disabled', installed: false, hasSecret: false });
  const [secret, setSecret] = useState('');
  const [lan, setLan] = useState('127.0.0.1');

  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [command, setCommand] = useState('');

  const logEndRef = useRef<HTMLDivElement | null>(null);

  const refreshConfig = useCallback(async () => {
    setDraft(await api.getConfig());
  }, []);
  const refreshBackups = useCallback(async () => {
    setBackups(await api.listBackups());
  }, []);

  useEffect(() => {
    void api.getStatus().then(setStatus);
    void api.getPlayitStatus().then(setPlayit);
    void api.getLanAddress().then(setLan);
    void refreshConfig();
    void refreshBackups();

    const offLog = api.onLog((l) => setLogs((prev) => [...prev.slice(-500), l]));
    const offStatus = api.onStatus(setStatus);
    const offMetrics = api.onMetrics(setMetrics);
    const offPlayit = api.onPlayitStatus(setPlayit);
    return () => {
      offLog();
      offStatus();
      offMetrics();
      offPlayit();
    };
  }, [refreshConfig, refreshBackups]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const installed = status !== 'not-installed';
  const canStart = installed && (status === 'stopped' || status === 'error');
  const canStop = status === 'running' || status === 'starting';

  const withBusy = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = () =>
    withBusy(async () => {
      const patch: PalOptions = {};
      for (const f of CONFIG_FIELDS) {
        if (draft[f.key] !== undefined) patch[f.key] = draft[f.key];
      }
      // Keep RCON in sync so the app can control the server.
      patch['RCONEnabled'] = true;
      patch['RCONPort'] = RCON_PORT_DEFAULT;
      await api.setConfig(patch);
      await api.setSettings({
        rconEnabled: true,
        rconPort: RCON_PORT_DEFAULT,
        adminPassword: String(draft['AdminPassword'] ?? ''),
      });
      setSavedMsg('保存しました。次回の起動から反映されます。');
      setTimeout(() => setSavedMsg(''), 4000);
    });

  const inviteText = useMemo(() => {
    const addr = playit.tunnelAddress;
    const pw = String(draft['ServerPassword'] ?? '');
    if (!addr) return '';
    return `Palworldサーバーに参加してね！\nアドレス: ${addr}${pw ? `\nパスワード: ${pw}` : ''}`;
  }, [playit.tunnelAddress, draft]);

  const copy = (text: string) => void navigator.clipboard.writeText(text);

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="flex items-center gap-4 border-b border-neutral-800 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${STATUS_COLOR[status]}`} />
          <span className="font-semibold">Palworld Server Manager</span>
          <span className="ml-2 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
            {STATUS_LABEL[status]}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-4 text-xs text-neutral-400">
          <span>CPU {metrics.cpu}%</span>
          <span>MEM {bytes(metrics.memory)}</span>
          <span>稼働 {uptime(metrics.uptime)}</span>
        </div>

        <div className="flex gap-2">
          {!installed ? (
            <button
              disabled={busy}
              onClick={() => withBusy(() => api.installOrUpdate())}
              className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
            >
              インストール
            </button>
          ) : (
            <button
              disabled={busy || canStop}
              onClick={() => withBusy(() => api.installOrUpdate())}
              className="rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
            >
              更新
            </button>
          )}
          <button
            disabled={busy || !canStart}
            onClick={() => withBusy(() => api.start())}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
          >
            起動
          </button>
          <button
            disabled={busy || !canStop}
            onClick={() => withBusy(() => api.stop())}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium hover:bg-red-500 disabled:opacity-50"
          >
            停止
          </button>
          <button
            disabled={busy || !canStop}
            onClick={() => withBusy(() => api.restart())}
            className="rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            再起動
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex gap-1 border-b border-neutral-800 px-4">
        {([
          ['console', 'コンソール'],
          ['settings', '設定'],
          ['network', 'ネットワーク'],
          ['backup', 'バックアップ'],
          ['players', 'プレイヤー'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm ${
              tab === id ? 'border-b-2 border-sky-500 text-white' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-auto p-5">
        {tab === 'console' && (
          <div className="flex h-full flex-col">
            <div className="flex-1 overflow-auto rounded bg-black/60 p-3 font-mono text-xs leading-relaxed">
              {logs.length === 0 && <div className="text-neutral-600">ログはまだありません。</div>}
              {logs.map((l) => (
                <div
                  key={l.id}
                  className={
                    l.level === 'error'
                      ? 'text-red-400'
                      : l.level === 'warn'
                        ? 'text-amber-300'
                        : l.source === 'rcon'
                          ? 'text-sky-300'
                          : l.source === 'steamcmd'
                            ? 'text-neutral-400'
                            : 'text-neutral-200'
                  }
                >
                  {l.text}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!command.trim()) return;
                void api.sendCommand(command);
                setCommand('');
              }}
            >
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="RCONコマンド (例: Broadcast Hello / ShowPlayers)"
                className="flex-1 rounded bg-neutral-900 px-3 py-2 text-sm outline-none ring-1 ring-neutral-800 focus:ring-sky-600"
              />
              <button className="rounded bg-sky-600 px-4 py-2 text-sm hover:bg-sky-500">送信</button>
            </form>
          </div>
        )}

        {tab === 'settings' && (
          <div className="max-w-2xl">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {CONFIG_FIELDS.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-400">{f.label}</span>
                  {f.type === 'bool' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(draft[f.key])}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked }))}
                      className="h-5 w-5 accent-sky-600"
                    />
                  ) : f.type === 'enum' ? (
                    <select
                      value={String(draft[f.key] ?? '')}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      className="rounded bg-neutral-900 px-3 py-2 ring-1 ring-neutral-800"
                    >
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                      value={String(draft[f.key] ?? '')}
                      step="any"
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value,
                        }))
                      }
                      className="rounded bg-neutral-900 px-3 py-2 ring-1 ring-neutral-800 focus:ring-sky-600"
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-3">
              <button
                disabled={busy}
                onClick={saveConfig}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
              >
                設定を保存
              </button>
              {savedMsg && <span className="text-sm text-emerald-400">{savedMsg}</span>}
            </div>
          </div>
        )}

        {tab === 'network' && (
          <div className="max-w-2xl space-y-6">
            <section className="rounded border border-neutral-800 p-4">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    playit.state === 'connected' ? 'bg-emerald-500' : 'bg-neutral-500'
                  }`}
                />
                <h2 className="font-medium">playit.gg 外部公開</h2>
              </div>
              <p className="mb-3 text-sm text-neutral-400">
                ポート開放不要で友人が接続できます。playit.gg のダッシュボードで「UDP / 127.0.0.1:8211」の
                トンネルを作成し、シークレットキーをここに貼り付けてください。
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="playit シークレットキー"
                  className="flex-1 rounded bg-neutral-900 px-3 py-2 text-sm ring-1 ring-neutral-800"
                />
                <button
                  onClick={() => void api.setPlayitSecret(secret).then(setPlayit)}
                  className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
                >
                  保存
                </button>
              </div>
              <div className="mt-3 flex items-center gap-3">
                {playit.state === 'connected' ? (
                  <button
                    onClick={() => void api.disablePlayit().then(setPlayit)}
                    className="rounded bg-red-600 px-3 py-2 text-sm hover:bg-red-500"
                  >
                    停止
                  </button>
                ) : (
                  <button
                    onClick={() => void api.enablePlayit().then(setPlayit)}
                    className="rounded bg-sky-600 px-3 py-2 text-sm hover:bg-sky-500"
                  >
                    有効化
                  </button>
                )}
                <button
                  onClick={() => void api.openExternal('https://playit.gg')}
                  className="text-sm text-sky-400 hover:underline"
                >
                  playit.gg を開く
                </button>
                {playit.message && <span className="text-sm text-neutral-400">{playit.message}</span>}
              </div>
              {playit.tunnelAddress && (
                <div className="mt-3 rounded bg-neutral-900 p-3 text-sm">
                  公開アドレス: <span className="font-mono text-emerald-300">{playit.tunnelAddress}</span>
                </div>
              )}
            </section>

            <section className="rounded border border-neutral-800 p-4">
              <h2 className="mb-2 font-medium">友人への案内</h2>
              {inviteText ? (
                <>
                  <pre className="whitespace-pre-wrap rounded bg-neutral-900 p-3 text-sm">{inviteText}</pre>
                  <button
                    onClick={() => copy(inviteText)}
                    className="mt-2 rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
                  >
                    コピー
                  </button>
                </>
              ) : (
                <p className="text-sm text-neutral-500">playit を有効化すると案内文を生成できます。</p>
              )}
              <p className="mt-3 text-xs text-neutral-500">
                同じ家(LAN)からの確認用アドレス: <span className="font-mono">{lan}:8211</span>
              </p>
            </section>
          </div>
        )}

        {tab === 'backup' && (
          <div className="max-w-2xl">
            <div className="mb-4 flex gap-2">
              <button
                disabled={busy}
                onClick={() => withBusy(async () => {
                  await api.createBackup();
                  await refreshBackups();
                })}
                className="rounded bg-emerald-600 px-3 py-2 text-sm hover:bg-emerald-500 disabled:opacity-50"
              >
                今すぐバックアップ
              </button>
              <button
                onClick={() => void api.openBackupsFolder()}
                className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
              >
                フォルダを開く
              </button>
            </div>
            <div className="divide-y divide-neutral-800 rounded border border-neutral-800">
              {backups.length === 0 && (
                <div className="p-4 text-sm text-neutral-500">バックアップはまだありません。</div>
              )}
              {backups.map((b) => (
                <div key={b.id} className="flex items-center gap-3 p-3 text-sm">
                  <div className="flex-1">
                    <div className="font-mono text-neutral-200">{b.name}</div>
                    <div className="text-xs text-neutral-500">
                      {new Date(b.ts).toLocaleString()} ・ {bytes(b.size)}
                    </div>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => withBusy(() => api.restoreBackup(b.id))}
                    className="rounded bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700 disabled:opacity-50"
                  >
                    復元
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'players' && (
          <div className="max-w-2xl">
            <button
              onClick={() => void api.showPlayers().then(setPlayers)}
              className="mb-4 rounded bg-sky-600 px-3 py-2 text-sm hover:bg-sky-500"
            >
              オンラインのプレイヤーを取得
            </button>
            <div className="divide-y divide-neutral-800 rounded border border-neutral-800">
              {players.length === 0 && (
                <div className="p-4 text-sm text-neutral-500">
                  取得したプレイヤーはここに表示されます（RCONが有効な稼働中に取得できます）。
                </div>
              )}
              {players.map((p, i) => (
                <div key={`${p.steamId ?? p.name}-${i}`} className="flex items-center gap-3 p-3 text-sm">
                  <div className="flex-1">
                    <div className="text-neutral-100">{p.name}</div>
                    <div className="font-mono text-xs text-neutral-500">
                      {p.playerId ?? '-'} / {p.steamId ?? '-'}
                    </div>
                  </div>
                  {p.steamId && (
                    <button
                      onClick={() => void api.sendCommand(`KickPlayer ${p.steamId}`)}
                      className="rounded bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700"
                    >
                      キック
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
