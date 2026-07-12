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
  UpdateStatus,
} from '../shared/types';

const api = window.api;

type Tab = 'console' | 'server' | 'manager' | 'network' | 'backup' | 'schedule';

const WORLD_DELETE_KEYWORD = 'ワールドデータを削除';

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

const REST_PORT_DEFAULT = 8212;

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
  const [broadcast, setBroadcast] = useState('');
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [showWizard, setShowWizard] = useState(false);

  // manager (app) settings
  const [launchArgs, setLaunchArgs] = useState('');
  const [autoRestart, setAutoRestart] = useState(false);
  const [perfFlags, setPerfFlags] = useState(true);
  const [publicLobby, setPublicLobby] = useState(false);
  const [restApiPort, setRestApiPort] = useState(REST_PORT_DEFAULT);
  const [managerMsg, setManagerMsg] = useState('');

  // server-config accordion: which groups are expanded
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // in-app update
  const [appVersion, setAppVersion] = useState('');
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' });

  // per-entry "add warning minute" input
  const [warnInput, setWarnInput] = useState<Record<string, string>>({});

  // danger zone: world-data delete confirmation
  const [worldConfirm, setWorldConfirm] = useState('');

  const logEndRef = useRef<HTMLDivElement | null>(null);
  // Buffer incoming log lines and flush on an interval so a chatty server
  // doesn't trigger a React re-render (and smooth scroll) on every single line.
  const logBufferRef = useRef<LogLine[]>([]);

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
      setPerfFlags(s.perfFlags !== false);
      setPublicLobby(!!s.publicLobby);
      setRestApiPort(s.restApiPort ?? REST_PORT_DEFAULT);
      setSecret(s.playitSecret ?? '');
    });
    void refreshConfig();
    void refreshBackups();
    void api.getAppVersion().then(setAppVersion);

    const offLog = api.onLog((l) => {
      logBufferRef.current.push(l);
    });
    const flushId = setInterval(() => {
      if (logBufferRef.current.length === 0) return;
      const incoming = logBufferRef.current;
      logBufferRef.current = [];
      setLogs((prev) => [...prev, ...incoming].slice(-300));
    }, 200);
    const offStatus = api.onStatus(setStatus);
    const offMetrics = api.onMetrics(setMetrics);
    const offPlayit = api.onPlayitStatus(setPlayit);
    const offUpdate = api.onUpdateStatus(setUpdate);
    return () => {
      offLog();
      clearInterval(flushId);
      offStatus();
      offMetrics();
      offPlayit();
      offUpdate();
    };
  }, [refreshConfig, refreshBackups]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [logs]);

  // Clear the roster when the server isn't running. The list is fetched only
  // on demand via the "更新" button (REST /players), never polled on a timer.
  useEffect(() => {
    if (status !== 'running') setPlayers([]);
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
      patch['RESTAPIEnabled'] = true;
      patch['RESTAPIPort'] = restApiPort;
      await api.setConfig(patch);
      if ('AdminPassword' in draft) {
        await api.setSettings({
          restApiEnabled: true,
          restApiPort,
          adminPassword: String(draft['AdminPassword'] ?? ''),
        });
      }
      originalRef.current = { ...draft, RESTAPIEnabled: true, RESTAPIPort: restApiPort };
      setSavedMsg('保存しました。次回の起動から反映されます。');
      setTimeout(() => setSavedMsg(''), 4000);
    });

  const saveManager = () =>
    withBusy(async () => {
      await api.setSettings({ launchArgs, autoRestart, perfFlags, publicLobby, restApiPort });
      setManagerMsg('保存しました。次回の起動から反映されます。');
      setTimeout(() => setManagerMsg(''), 3000);
    });

  const togglePlayitAuto = (v: boolean) => {
    setPlayitAuto(v);
    void api.setSettings({ playitAutoStart: v });
  };

  // Persist whatever is in the secret field before enabling, so a freshly typed
  // (but not yet "saved") key still works — and stays saved for next time.
  const enablePlayitWithSecret = () =>
    void (async () => {
      const s = secret.trim();
      if (s) await api.setPlayitSecret(s);
      setPlayit(await api.enablePlayit());
    })();

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
  const addWarnMinute = (id: string) => {
    const min = Math.floor(Number(warnInput[id] ?? ''));
    if (!min || min <= 0) return;
    const e = schedule.find((x) => x.id === id);
    if (!e) return;
    const set = new Set([...(e.warnMinutes ?? []), min]);
    updateScheduleEntry(id, { warnMinutes: [...set].sort((a, b) => b - a) });
    setWarnInput((w) => ({ ...w, [id]: '' }));
  };
  const removeWarnMinute = (id: string, min: number) => {
    const e = schedule.find((x) => x.id === id);
    if (!e) return;
    updateScheduleEntry(id, { warnMinutes: (e.warnMinutes ?? []).filter((m) => m !== min) });
  };
  const actionNoun = (a: ScheduleAction) =>
    a === 'stop' ? 'シャットダウン' : a === 'backup' ? 'バックアップ' : a === 'start' ? '起動' : '再起動';

  const deleteWorld = () =>
    withBusy(async () => {
      if (worldConfirm !== WORLD_DELETE_KEYWORD) return;
      if (
        !window.confirm(
          'ワールドデータ（セーブ）を完全に削除します。元に戻せません。よろしいですか？',
        )
      ) {
        return;
      }
      const res = await api.deleteWorldData();
      if (res.ok) {
        setWorldConfirm('');
        window.alert('ワールドデータを削除しました。次回の起動で新しいワールドが作成されます。');
      } else {
        window.alert(`削除に失敗しました: ${res.error ?? ''}`);
      }
    });

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
          {metrics.serverFps != null && <span>FPS {metrics.serverFps}</span>}
          {metrics.players != null && (
            <span>
              人数 {metrics.players}
              {metrics.maxPlayers != null ? `/${metrics.maxPlayers}` : ''}
            </span>
          )}
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
                    {status === 'running' ? '「更新」で参加者を取得します。' : '稼働中に「更新」で取得します。'}
                  </div>
                ) : (
                  players.map((p, i) => (
                    <div key={`${p.userId ?? p.steamId ?? p.name}-${i}`} className="group rounded px-2 py-1.5 hover:bg-neutral-900">
                      <div className="truncate text-neutral-100">{p.name}</div>
                      <div className="flex items-center gap-1">
                        <span className="truncate font-mono text-xs text-neutral-500">{p.userId ?? p.steamId ?? '-'}</span>
                        {p.userId && (
                          <button
                            onClick={() => p.userId && void api.kickPlayer(p.userId)}
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
                  onClick={() => void api.saveWorld()}
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
                    const msg = broadcast.trim();
                    if (!msg) return;
                    void api.announce(msg);
                    setBroadcast('');
                  }}
                >
                  <input
                    value={broadcast}
                    onChange={(e) => setBroadcast(e.target.value)}
                    placeholder="メッセージを入力（日本語・スペースもそのまま送れます）"
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
              <div className="space-y-3">
                {GROUP_ORDER.map((g) => {
                  const keys = groupedKeys[g];
                  if (keys.length === 0) return null;
                  // Auto-expand while searching; otherwise honor the toggle.
                  const expanded = filter.trim() !== '' || !!openGroups[g];
                  return (
                    <section key={g} className="overflow-hidden rounded border border-neutral-800">
                      <button
                        type="button"
                        onClick={() => setOpenGroups((o) => ({ ...o, [g]: !o[g] }))}
                        className="flex w-full items-center gap-2 bg-neutral-900/60 px-3 py-2 text-left text-sm font-medium text-neutral-200 hover:bg-neutral-900"
                      >
                        <span className={`text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
                        <span>{GROUP_LABELS[g]}</span>
                        <span className="ml-auto rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                          {keys.length}
                        </span>
                      </button>
                      {expanded && (
                        <div className="grid grid-cols-1 gap-2 p-3 lg:grid-cols-2">
                          {keys.map((key) => renderField(key))}
                        </div>
                      )}
                    </section>
                  );
                })}
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
              <h2 className="mb-3 font-medium">アップデート</h2>
              <div className="flex items-center gap-3">
                <span className="text-sm text-neutral-400">
                  現在のバージョン: <span className="font-mono text-neutral-200">v{appVersion || '—'}</span>
                </span>
                <button
                  disabled={update.state === 'checking' || update.state === 'downloading'}
                  onClick={() => void api.checkForUpdates().then(setUpdate)}
                  className="rounded bg-sky-600 px-3 py-1.5 text-sm hover:bg-sky-500 disabled:opacity-50"
                >
                  更新を確認
                </button>
                {update.state === 'available' && (
                  <button
                    onClick={() => void api.downloadUpdate().then(setUpdate)}
                    className="rounded bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500"
                  >
                    ダウンロード
                  </button>
                )}
                {update.state === 'downloaded' && (
                  <button
                    onClick={() => void api.quitAndInstall()}
                    className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500"
                  >
                    再起動して更新
                  </button>
                )}
              </div>
              <div className="mt-2 text-xs">
                {update.state === 'checking' && <span className="text-neutral-400">確認中...</span>}
                {update.state === 'not-available' && (
                  <span className="text-emerald-400">最新版を使用しています。</span>
                )}
                {update.state === 'available' && (
                  <span className="text-sky-300">新しいバージョン v{update.version} が利用可能です。</span>
                )}
                {update.state === 'downloading' && (
                  <span className="text-neutral-300">ダウンロード中... {update.percent ?? 0}%</span>
                )}
                {update.state === 'downloaded' && (
                  <span className="text-emerald-400">
                    v{update.version} のダウンロードが完了しました。再起動すると適用されます。
                  </span>
                )}
                {update.state === 'error' && <span className="text-red-400">{update.message}</span>}
              </div>
              <button
                onClick={() => void api.openExternal('https://github.com/Null-AiLAB/PalServer/releases')}
                className="mt-2 text-xs text-sky-400 hover:underline"
              >
                リリースページを開く
              </button>
            </section>

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
                <label className="flex flex-col gap-1 text-sm text-neutral-300">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={perfFlags}
                      onChange={(e) => setPerfFlags(e.target.checked)}
                      className="h-4 w-4 accent-sky-600"
                    />
                    パフォーマンス最適化フラグを付与する（推奨）
                  </span>
                  <span className="ml-6 text-xs text-neutral-500">
                    -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS を起動時に自動付与します。
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-sm text-neutral-300">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={publicLobby}
                      onChange={(e) => setPublicLobby(e.target.checked)}
                      className="h-4 w-4 accent-sky-600"
                    />
                    コミュニティ一覧に載せる（-publiclobby）
                  </span>
                  <span className="ml-6 text-xs text-neutral-500">
                    ゲーム内のコミュニティサーバー一覧に表示されます。
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-400">REST API ポート</span>
                  <input
                    type="number"
                    value={restApiPort}
                    onChange={(e) => setRestApiPort(Number(e.target.value))}
                    className="w-40 rounded bg-neutral-900 px-3 py-2 ring-1 ring-neutral-800 focus:ring-sky-600"
                  />
                  <span className="text-xs text-neutral-500">
                    既定 8212。アプリはこのポートでサーバーを制御します（RCONは非推奨のため不使用）。
                  </span>
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

              <div className="mt-5 border-t border-red-900/40 pt-4">
                <h3 className="mb-1 text-sm font-medium text-red-400">ワールドデータの削除</h3>
                <p className="mb-2 text-xs text-neutral-500">
                  現在のワールド（セーブデータ）を完全に削除します。<span className="text-red-400">元に戻せません。</span>
                  サーバーは停止してから実行してください。サーバー本体は残るため、次回起動時に新しいワールドが作成されます。
                </p>
                <p className="mb-2 text-xs text-neutral-400">
                  実行するには、下の入力欄に「<span className="font-mono text-red-300">{WORLD_DELETE_KEYWORD}</span>」と入力してください。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={worldConfirm}
                    onChange={(e) => setWorldConfirm(e.target.value)}
                    placeholder={WORLD_DELETE_KEYWORD}
                    className="w-56 rounded bg-neutral-900 px-3 py-2 text-sm ring-1 ring-neutral-800 focus:ring-red-600"
                  />
                  <button
                    disabled={busy || canStop || worldConfirm !== WORLD_DELETE_KEYWORD}
                    onClick={deleteWorld}
                    className="rounded bg-red-700 px-3 py-2 text-sm hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ワールドデータを削除
                  </button>
                </div>
                {canStop && (
                  <p className="mt-2 text-xs text-amber-300/90">
                    サーバーが稼働中のため削除できません。先に停止してください。
                  </p>
                )}
              </div>
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
              <p className="mt-1 text-xs text-neutral-500">
                一度保存すればアプリを更新しても保持されます（次回以降の再入力は不要）。
              </p>
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
                    onClick={enablePlayitWithSecret}
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

                  {e.action === 'start' ? (
                    <p className="mt-3 border-t border-neutral-800 pt-3 text-xs text-neutral-600">
                      「起動」ではサーバーが停止中のため、事前告知は送信されません。
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2 border-t border-neutral-800 pt-3">
                      <div className="text-xs text-neutral-400">
                        事前告知（サーバー稼働中に参加者全員へ自動送信）
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-neutral-500">分前告知:</span>
                        {(e.warnMinutes ?? []).length === 0 && (
                          <span className="text-xs text-neutral-600">なし</span>
                        )}
                        {(e.warnMinutes ?? []).map((m) => (
                          <button
                            key={m}
                            onClick={() => removeWarnMinute(e.id, m)}
                            className="rounded bg-neutral-800 px-2 py-0.5 text-xs hover:bg-red-600"
                            title="クリックで削除"
                          >
                            {m}分前 ×
                          </button>
                        ))}
                        <input
                          type="number"
                          min={1}
                          value={warnInput[e.id] ?? ''}
                          onChange={(ev) => setWarnInput((w) => ({ ...w, [e.id]: ev.target.value }))}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter') addWarnMinute(e.id);
                          }}
                          placeholder="分"
                          className="w-16 rounded bg-neutral-900 px-2 py-1 text-xs ring-1 ring-neutral-800 focus:ring-sky-600"
                        />
                        <button
                          onClick={() => addWarnMinute(e.id)}
                          className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
                        >
                          追加
                        </button>
                      </div>

                      <label className="flex items-center gap-2 text-xs text-neutral-500">
                        カウントダウン開始:
                        <input
                          type="number"
                          min={0}
                          max={60}
                          value={e.countdownSec ?? 0}
                          onChange={(ev) =>
                            updateScheduleEntry(e.id, {
                              countdownSec: Math.min(60, Math.max(0, Math.floor(Number(ev.target.value)))),
                            })
                          }
                          className="w-20 rounded bg-neutral-900 px-2 py-1 text-xs ring-1 ring-neutral-800 focus:ring-sky-600"
                        />
                        秒前から（0でオフ・最大60）
                      </label>

                      <p className="text-[11px] leading-relaxed text-neutral-600">
                        例: 分前告知「サーバーは5分後に自動で{actionNoun(e.action)}されます。」／
                        カウントダウン「サーバー{actionNoun(e.action)}まであと10秒」→「9…」→「8…」…
                      </p>
                    </div>
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
