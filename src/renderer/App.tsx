import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SetupWizard from './SetupWizard';
import { CONFIG_META, GROUP_LABELS, GROUP_ORDER, metaFor, type Group } from './config-meta';
import type {
  BackupInfo,
  LogLine,
  PalOptions,
  PalOptionValue,
  PlayerInfo,
  PlayitStatus,
  ScheduleAction,
  ScheduleEntry,
  ServerStatus,
  SystemMetrics,
} from '../shared/types';

const api = window.api;

type Tab = 'console' | 'server' | 'manager' | 'network' | 'backup' | 'schedule';

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const ACTION_OPTIONS: { value: ScheduleAction; label: string }[] = [
  { value: 'start', label: '起動' },
  { value: 'stop', label: '停止' },
  { value: 'restart', label: '再起動' },
  { value: 'backup', label: 'バックアップ' },
];

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
  const originalRef = useRef<PalOptions>({});
  const [savedMsg, setSavedMsg] = useState('');
  const [filter, setFilter] = useState('');

  const [playit, setPlayit] = useState<PlayitStatus>({ state: 'disabled', installed: false, hasSecret: false });
  const [secret, setSecret] = useState('');
  const [lan, setLan] = useState('127.0.0.1');
  const [playitAuto, setPlayitAuto] = useState(false);

  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [command, setCommand] = useState('');
  const [broadcast, setBroadcast] = useState('');
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [showWizard, setShowWizard] = useState(false);

  // manager (app) settings
  const [launchArgs, setLaunchArgs] = useState('');
  const [autoRestart, setAutoRestart] = useState(false);
  const [rconPort, setRconPort] = useState(RCON_PORT_DEFAULT);
  const [managerMsg, setManagerMsg] = useState('');

  const logEndRef = useRef<HTMLDivElement | null>(null);

  const refreshConfig = useCallback(async () => {
    const c = await api.getConfig();
    originalRef.current = c;
    setDraft(c);
  }, []);
  const refreshBackups = useCallback(async () => {
    setBackups(await api.listBackups());
  }, []);
  const refreshPlayers = useCallback(() => {
    void api.showPlayers().then(setPlayers);
  }, []);

  useEffect(() => {
    void api.getStatus().then(setStatus);
    void api.getPlayitStatus().then(setPlayit);
    void api.getLanAddress().then(setLan);
    void api.getSchedule().then(setSchedule);
    void api.getSettings().then((s) => {
      if (!s.setupComplete) setShowWizard(true);
      setPlayitAuto(!!s.playitAutoStart);
      setLaunchArgs(s.launchArgs ?? '');
      setAutoRestart(!!s.autoRestart);
      setRconPort(s.rconPort ?? RCON_PORT_DEFAULT);
    });
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

  // Poll the joined players while the server is running.
  useEffect(() => {
    if (status !== 'running') {
      setPlayers([]);
      return;
    }
    let alive = true;
    const load = () => void api.showPlayers().then((p) => alive && setPlayers(p));
    load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [status]);

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

  const setField = (key: string, value: PalOptionValue) => setDraft((d) => ({ ...d, [key]: value }));

  const saveServerConfig = () =>
    withBusy(async () => {
      const patch: PalOptions = {};
      for (const [k, v] of Object.entries(draft)) {
        if (originalRef.current[k] !== v) patch[k] = v;
      }
      patch['RCONEnabled'] = true;
      patch['RCONPort'] = rconPort;
      await api.setConfig(patch);
      if ('AdminPassword' in draft) {
        await api.setSettings({
          rconEnabled: true,
          rconPort,
          adminPassword: String(draft['AdminPassword'] ?? ''),
        });
      }
      originalRef.current = { ...draft, RCONEnabled: true, RCONPort: rconPort };
      setSavedMsg('保存しました。次回の起動から反映されます。');
      setTimeout(() => setSavedMsg(''), 4000);
    });

  const saveManager = () =>
    withBusy(async () => {
      await api.setSettings({ launchArgs, autoRestart, rconPort });
      setManagerMsg('保存しました。');
      setTimeout(() => setManagerMsg(''), 3000);
    });

  const togglePlayitAuto = (v: boolean) => {
    setPlayitAuto(v);
    void api.setSettings({ playitAutoStart: v });
  };

  const uninstallServer = () =>
    withBusy(async () => {
      if (!window.confirm('サーバーのインストール済みファイルを削除します。セーブデータも消えます。よろしいですか？')) {
        return;
      }
      const res = await api.uninstallServer();
      if (!res.ok) window.alert(`アンインストールに失敗しました: ${res.error ?? ''}`);
      await api.getStatus().then(setStatus);
      await refreshBackups();
    });

  const inviteText = useMemo(() => {
    const addr = playit.tunnelAddress;
    const pw = String(draft['ServerPassword'] ?? '');
    if (!addr) return '';
    return `Palworldサーバーに参加してね！\nアドレス: ${addr}${pw ? `\nパスワード: ${pw}` : ''}`;
  }, [playit.tunnelAddress, draft]);

  const copy = (text: string) => void navigator.clipboard.writeText(text);

  const persistSchedule = (next: ScheduleEntry[]) => {
    setSchedule(next);
    void api.setSchedule(next);
  };
  const addScheduleEntry = () => {
    const entry: ScheduleEntry = {
      id: `sch_${Date.now()}`,
      enabled: true,
      days: [0, 1, 2, 3, 4, 5, 6],
      time: '05:00',
      action: 'restart',
    };
    persistSchedule([...schedule, entry]);
  };
  const updateScheduleEntry = (id: string, patch: Partial<ScheduleEntry>) => {
    persistSchedule(schedule.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };
  const toggleScheduleDay = (id: string, day: number) => {
    const e = schedule.find((x) => x.id === id);
    if (!e) return;
    const days = e.days.includes(day) ? e.days.filter((d) => d !== day) : [...e.days, day].sort();
    updateScheduleEntry(id, { days });
  };
  const removeScheduleEntry = (id: string) => {
    persistSchedule(schedule.filter((e) => e.id !== id));
  };

  // Group the config keys (filter matches key or Japanese label).
  const groupedKeys = useMemo(() => {
    const q = filter.toLowerCase();
    const groups: Record<Group, string[]> = { server: [], balance: [], feature: [], perf: [], other: [] };
    for (const key of Object.keys(draft)) {
      const meta = metaFor(key, draft[key]);
      if (q && !key.toLowerCase().includes(q) && !meta.label.toLowerCase().includes(q)) continue;
      groups[meta.group].push(key);
    }
    for (const g of GROUP_ORDER) {
      groups[g].sort((a, b) => (CONFIG_META[a]?.label ?? a).localeCompare(CONFIG_META[b]?.label ?? b, 'ja'));
    }
    return groups;
  }, [draft, filter]);
  const hasAnyKey = Object.keys(draft).length > 0;

  const renderField = (key: string) => {
    const v = draft[key];
    const meta = metaFor(key, v);
    if (meta.control === 'toggle') {
      return (
        <label key={key} className="flex items-center justify-between gap-3 rounded border border-neutral-800 px-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="block truncate text-neutral-200" title={key}>{meta.label}</span>
            {meta.help && <span className="block text-xs text-neutral-500">{meta.help}</span>}
          </span>
          <input
            type="checkbox"
            checked={Boolean(v)}
            onChange={(e) => setField(key, e.target.checked)}
            className="h-5 w-9 shrink-0 accent-sky-600"
          />
        </label>
      );
    }
    if (meta.control === 'select') {
      return (
        <label key={key} className="flex flex-col gap-1 rounded border border-neutral-800 px-3 py-2 text-sm">
          <span className="truncate text-neutral-200" title={key}>{meta.label}</span>
          <select
            value={String(v)}
            onChange={(e) => setField(key, e.target.value)}
            className="rounded bg-neutral-900 px-3 py-2 ring-1 ring-neutral-800"
          >
            {(meta.options ?? []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {meta.help && <span className="text-xs text-neutral-500">{meta.help}</span>}
        </label>
      );
    }
    if (meta.control === 'slider') {
      const num = typeof v === 'number' ? v : Number(v) || 0;
      const min = Math.min(meta.min ?? 0, num);
      const max = Math.max(meta.max ?? 5, num);
      return (
        <div key={key} className="flex flex-col gap-1 rounded border border-neutral-800 px-3 py-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="truncate text-neutral-200" title={key}>{meta.label}</span>
            <span className="ml-2 shrink-0 font-mono text-xs text-sky-300">{num}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={min}
              max={max}
              step={meta.step ?? 0.1}
              value={num}
              onChange={(e) => setField(key, Number(e.target.value))}
              className="flex-1 accent-sky-600"
            />
            <input
              type="number"
              step={meta.step ?? 0.1}
              value={num}
              onChange={(e) => setField(key, Number(e.target.value))}
              className="w-20 rounded bg-neutral-900 px-2 py-1 text-xs ring-1 ring-neutral-800"
            />
          </div>
          {meta.help && <span className="text-xs text-neutral-500">{meta.help}</span>}
        </div>
      );
    }
    if (meta.control === 'number') {
      return (
        <label key={key} className="flex flex-col gap-1 rounded border border-neutral-800 px-3 py-2 text-sm">
          <span className="truncate text-neutral-200" title={key}>{meta.label}</span>
          <input
            type="number"
            step="any"
            value={typeof v === 'number' ? v : Number(v) || 0}
            onChange={(e) => setField(key, Number(e.target.value))}
            className="w-40 rounded bg-neutral-900 px-3 py-2 ring-1 ring-neutral-800 focus:ring-sky-600"
          />
          {meta.help && <span className="text-xs text-neutral-500">{meta.help}</span>}
        </label>
      );
    }
    // text
    return (
      <label key={key} className="flex flex-col gap-1 rounded border border-neutral-800 px-3 py-2 text-sm">
        <span className="truncate text-neutral-200" title={key}>{meta.label}</span>
        <input
          type={meta.password ? 'password' : 'text'}
          value={String(v ?? '')}
          onChange={(e) => setField(key, e.target.value)}
          className="rounded bg-neutral-900 px-3 py-2 ring-1 ring-neutral-800 focus:ring-sky-600"
        />
        {(meta.help || meta.example) && (
          <span className="text-xs text-neutral-500">
            {meta.help}
            {meta.help && meta.example ? ' ' : ''}
            {meta.example && <span className="font-mono text-neutral-400">{meta.example}</span>}
          </span>
        )}
      </label>
    );
  };

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      {showWizard && (
        <SetupWizard
          onDone={() => {
            setShowWizard(false);
            void api.getStatus().then(setStatus);
            void refreshConfig();
          }}
        />
      )}
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
          ['server', 'サーバー設定'],
          ['manager', 'マネージャー設定'],
          ['network', 'ネットワーク'],
          ['backup', 'バックアップ'],
          ['schedule', 'スケジュール'],
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
          <div className="flex h-full gap-4">
            {/* Player list (left) */}
            <aside className="flex w-64 shrink-0 flex-col rounded border border-neutral-800">
              <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
                <span className="text-sm font-medium">参加プレイヤー ({players.length})</span>
                <button
                  onClick={refreshPlayers}
                  disabled={!canStop}
                  className="rounded bg-neutral-800 px-2 py-0.5 text-xs hover:bg-neutral-700 disabled:opacity-40"
                >
                  更新
                </button>
              </div>
              <div className="flex-1 overflow-auto p-2 text-sm">
                {players.length === 0 ? (
                  <div className="p-2 text-xs text-neutral-600">
                    {status === 'running' ? 'プレイヤーはいません。' : '稼働中に表示されます。'}
                  </div>
                ) : (
                  players.map((p, i) => (
                    <div key={`${p.steamId ?? p.name}-${i}`} className="group rounded px-2 py-1.5 hover:bg-neutral-900">
                      <div className="truncate text-neutral-100">{p.name}</div>
                      <div className="flex items-center gap-1">
                        <span className="truncate font-mono text-xs text-neutral-500">{p.steamId ?? '-'}</span>
                        {p.steamId && (
                          <button
                            onClick={() => void api.sendCommand(`KickPlayer ${p.steamId}`)}
                            className="ml-auto hidden rounded bg-neutral-800 px-2 text-xs hover:bg-red-600 group-hover:block"
                          >
                            Kick
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>

            {/* Console (right) */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button
                  disabled={!canStop}
                  onClick={() => void api.sendCommand('Save')}
                  className="rounded bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700 disabled:opacity-40"
                >
                  セーブ
                </button>
                <button
                  onClick={() => void api.openLogsFolder()}
                  className="rounded bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700"
                >
                  ログフォルダ
                </button>
              </div>
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

              {/* Server message (Broadcast) box */}
              <div className="mt-3 rounded border border-neutral-800 p-2">
                <div className="mb-1 text-xs font-medium text-neutral-300">
                  サーバーメッセージ送信（参加者全員に表示）
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const msg = broadcast.trim().replace(/\s+/g, '_');
                    if (!msg) return;
                    void api.sendCommand(`Broadcast ${msg}`);
                    setBroadcast('');
                  }}
                >
                  <input
                    value={broadcast}
                    onChange={(e) => setBroadcast(e.target.value)}
                    placeholder="メッセージを入力（Palworldの仕様で空白は _ に置換されます）"
                    className="flex-1 rounded bg-neutral-900 px-3 py-2 text-sm ring-1 ring-neutral-800 focus:ring-sky-600"
                  />
                  <button
                    disabled={!canStop}
                    className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
                  >
                    送信
                  </button>
                </form>
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
                  placeholder="RCONコマンド (例: Info / ShowPlayers)"
                  className="flex-1 rounded bg-neutral-900 px-3 py-2 text-sm outline-none ring-1 ring-neutral-800 focus:ring-sky-600"
                />
                <button className="rounded bg-sky-600 px-4 py-2 text-sm hover:bg-sky-500">送信</button>
              </form>
            </div>
          </div>
        )}

        {tab === 'server' && (
          <div className="max-w-4xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-neutral-500">
                公式ガイド準拠の項目です。スライダーはすべて「右（高い値）ほど項目名の効果が強くなる」向きに統一しています。
              </span>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="項目を検索（日本語・英名どちらでも）..."
                className="ml-auto w-64 rounded bg-neutral-900 px-3 py-1.5 text-xs ring-1 ring-neutral-800 focus:ring-sky-600"
              />
            </div>

            {!hasAnyKey ? (
              <p className="text-sm text-neutral-500">
                設定項目がありません。先にサーバーをインストールしてください。
              </p>
            ) : (
              <div className="space-y-6">
                {GROUP_ORDER.map((g) =>
                  groupedKeys[g].length === 0 ? null : (
                    <section key={g}>
                      <h3 className="mb-2 border-b border-neutral-800 pb-1 text-sm font-medium text-neutral-300">
                        {GROUP_LABELS[g]}
                      </h3>
                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                        {groupedKeys[g].map((key) => renderField(key))}
                      </div>
                    </section>
                  ),
                )}
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              <button
                disabled={busy}
                onClick={saveServerConfig}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
              >
                サーバー設定を保存
              </button>
              {savedMsg && <span className="text-sm text-emerald-400">{savedMsg}</span>}
            </div>
          </div>
        )}

        {tab === 'manager' && (
          <div className="max-w-2xl space-y-6">
            <section className="rounded border border-neutral-800 p-4">
              <h2 className="mb-3 font-medium">フォルダ</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => void api.openServerFolder()}
                  className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
                >
                  サーバーフォルダを開く
                </button>
                <button
                  onClick={() => void api.openLogsFolder()}
                  className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
                >
                  ログフォルダを開く
                </button>
                <button
                  onClick={() => void api.openBackupsFolder()}
                  className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
                >
                  バックアップフォルダを開く
                </button>
              </div>
            </section>

            <section className="rounded border border-neutral-800 p-4">
              <h2 className="mb-3 font-medium">アプリの動作</h2>
              <div className="space-y-4">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-400">起動オプション（PalServer.exe に渡す引数）</span>
                  <input
                    value={launchArgs}
                    onChange={(e) => setLaunchArgs(e.target.value)}
                    placeholder="例: -useperfthreads -NoAsyncLoadingThread"
                    className="rounded bg-neutral-900 px-3 py-2 ring-1 ring-neutral-800 focus:ring-sky-600"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    checked={autoRestart}
                    onChange={(e) => setAutoRestart(e.target.checked)}
                    className="h-4 w-4 accent-sky-600"
                  />
                  クラッシュ時に自動で再起動する
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-400">RCON ポート</span>
                  <input
                    type="number"
                    value={rconPort}
                    onChange={(e) => setRconPort(Number(e.target.value))}
                    className="w-40 rounded bg-neutral-900 px-3 py-2 ring-1 ring-neutral-800 focus:ring-sky-600"
                  />
                </label>
                <div className="flex items-center gap-3">
                  <button
                    disabled={busy}
                    onClick={saveManager}
                    className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
                  >
                    保存
                  </button>
                  {managerMsg && <span className="text-sm text-emerald-400">{managerMsg}</span>}
                </div>
              </div>
            </section>

            <section className="rounded border border-red-900/60 p-4">
              <h2 className="mb-1 text-sm font-medium text-red-400">危険な操作</h2>
              <p className="mb-3 text-xs text-neutral-500">
                インストール済みのサーバーファイル（数GB）とセーブデータを削除します。必要なら先にバックアップしてください。
              </p>
              <button
                disabled={busy || canStop}
                onClick={uninstallServer}
                className="rounded bg-red-700 px-3 py-2 text-sm hover:bg-red-600 disabled:opacity-40"
              >
                サーバーをアンインストール
              </button>
            </section>
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
                <div className="mt-3 flex items-center gap-2 rounded bg-neutral-900 p-3 text-sm">
                  <span>
                    公開アドレス: <span className="font-mono text-emerald-300">{playit.tunnelAddress}</span>
                  </span>
                  <button
                    onClick={() => copy(playit.tunnelAddress ?? '')}
                    className="ml-auto rounded bg-neutral-800 px-3 py-1 text-xs hover:bg-neutral-700"
                  >
                    コピー
                  </button>
                </div>
              )}
              <label className="mt-3 flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={playitAuto}
                  onChange={(e) => togglePlayitAuto(e.target.checked)}
                  className="h-4 w-4 accent-sky-600"
                />
                サーバーの起動/停止に合わせて playit を自動で開始/停止する
              </label>
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

        {tab === 'schedule' && (
          <div className="max-w-2xl">
            <div className="mb-4 flex items-center gap-3">
              <button
                onClick={addScheduleEntry}
                className="rounded bg-sky-600 px-3 py-2 text-sm hover:bg-sky-500"
              >
                スケジュールを追加
              </button>
              <span className="text-xs text-neutral-500">
                指定した曜日・時刻に自動で実行します（アプリ常駐中に動作）。
              </span>
            </div>
            <div className="space-y-3">
              {schedule.length === 0 && (
                <div className="rounded border border-neutral-800 p-4 text-sm text-neutral-500">
                  まだスケジュールはありません。例: 毎日 5:00 に再起動。
                </div>
              )}
              {schedule.map((e) => (
                <div key={e.id} className="rounded border border-neutral-800 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="checkbox"
                      checked={e.enabled}
                      onChange={(ev) => updateScheduleEntry(e.id, { enabled: ev.target.checked })}
                      className="h-5 w-5 accent-sky-600"
                      title="有効/無効"
                    />
                    <input
                      type="time"
                      value={e.time}
                      onChange={(ev) => updateScheduleEntry(e.id, { time: ev.target.value })}
                      className="rounded bg-neutral-900 px-2 py-1 text-sm ring-1 ring-neutral-800"
                    />
                    <select
                      value={e.action}
                      onChange={(ev) =>
                        updateScheduleEntry(e.id, { action: ev.target.value as ScheduleAction })
                      }
                      className="rounded bg-neutral-900 px-2 py-1 text-sm ring-1 ring-neutral-800"
                    >
                      {ACTION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeScheduleEntry(e.id)}
                      className="ml-auto rounded bg-neutral-800 px-3 py-1.5 text-xs hover:bg-red-600"
                    >
                      削除
                    </button>
                  </div>
                  <div className="mt-3 flex gap-1">
                    {DAY_LABELS.map((d, idx) => (
                      <button
                        key={d}
                        onClick={() => toggleScheduleDay(e.id, idx)}
                        className={`h-8 w-8 rounded text-xs ${
                          e.days.includes(idx)
                            ? 'bg-sky-600 text-white'
                            : 'bg-neutral-900 text-neutral-500 ring-1 ring-neutral-800'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
