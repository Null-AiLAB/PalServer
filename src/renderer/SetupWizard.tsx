import { useEffect, useState } from 'react';
import type { LogLine, ServerStatus } from '../shared/types';

const api = window.api;
const RCON_PORT_DEFAULT = 25575;

export default function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [serverName, setServerName] = useState('My Palworld Server');
  const [password, setPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [status, setStatus] = useState<ServerStatus>('not-installed');
  const [lastLog, setLastLog] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const offStatus = api.onStatus(setStatus);
    const offLog = api.onLog((l: LogLine) => setLastLog(l.text));
    void api.getStatus().then(setStatus);
    return () => {
      offStatus();
      offLog();
    };
  }, []);

  const installed = status === 'stopped' || status === 'running';
  const installing = status === 'installing' || status === 'updating';

  const finish = async () => {
    await api.setSettings({ setupComplete: true });
    onDone();
  };
  const skip = () => void finish();

  const runInstall = () => {
    setBusy(true);
    void api.installOrUpdate().finally(() => setBusy(false));
  };

  const applyConfigAndNext = async () => {
    setBusy(true);
    try {
      await api.setConfig({
        ServerName: serverName,
        ServerPassword: password,
        AdminPassword: adminPassword,
        RCONEnabled: true,
        RCONPort: RCON_PORT_DEFAULT,
      });
      await api.setSettings({ rconEnabled: true, rconPort: RCON_PORT_DEFAULT, adminPassword });
    } finally {
      setBusy(false);
    }
    setStep(2);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6">
      <div className="w-full max-w-lg rounded-lg border border-neutral-800 bg-neutral-950 p-6 text-neutral-100 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">初回セットアップ</h1>
          <button onClick={skip} className="text-xs text-neutral-500 hover:text-neutral-300">
            スキップ
          </button>
        </div>

        <div className="mb-5 flex gap-2">
          {['基本設定', 'インストール', '完了'].map((label, i) => (
            <div
              key={label}
              className={`flex-1 rounded px-2 py-1 text-center text-xs ${
                i === step ? 'bg-sky-600 text-white' : i < step ? 'bg-emerald-700 text-white' : 'bg-neutral-800 text-neutral-400'
              }`}
            >
              {i + 1}. {label}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-400">
              サーバーの基本情報を設定します。あとから「設定」タブでいつでも変更できます。
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-400">サーバー名</span>
              <input
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                className="rounded bg-neutral-900 px-3 py-2 ring-1 ring-neutral-800 focus:ring-sky-600"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-400">参加パスワード（空欄で誰でも参加可）</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded bg-neutral-900 px-3 py-2 ring-1 ring-neutral-800 focus:ring-sky-600"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-400">管理者パスワード（RCON制御に必要・推奨）</span>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="例: Kx7-3pR9mq"
                className="rounded bg-neutral-900 px-3 py-2 ring-1 ring-neutral-800 focus:ring-sky-600"
              />
            </label>
            <div className="flex justify-end">
              <button
                onClick={() => setStep(1)}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
              >
                次へ
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-400">
              SteamCMD を使って Palworld専用サーバーを導入します。初回は数GBのダウンロードがあり、数分かかります。
            </p>
            <div className="rounded bg-black/60 p-3 font-mono text-xs text-neutral-300">
              {installed ? '✓ インストール済み' : installing ? '導入中...' : '未インストール'}
              {lastLog && <div className="mt-1 truncate text-neutral-500">{lastLog}</div>}
            </div>
            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep(0)}
                className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
              >
                戻る
              </button>
              <div className="flex gap-2">
                <button
                  disabled={busy || installing}
                  onClick={runInstall}
                  className="rounded bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
                >
                  {installed ? '再インストール' : 'インストール開始'}
                </button>
                <button
                  disabled={!installed || busy}
                  onClick={applyConfigAndNext}
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
                >
                  次へ
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-300">セットアップが完了しました 🎉</p>
            <ul className="list-inside list-disc space-y-1 text-sm text-neutral-400">
              <li>「起動」ボタンでサーバーを開始できます。</li>
              <li>友人を招くには「ネットワーク」タブで playit.gg を設定してください（ポート開放不要）。</li>
              <li>詳細な設定は「設定」タブ、または「INI編集」タブで調整できます。</li>
            </ul>
            <div className="flex justify-end">
              <button
                onClick={() => void finish()}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500"
              >
                完了
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
