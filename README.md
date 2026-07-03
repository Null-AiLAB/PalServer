# Palworld Server Manager

Windows向けの Palworld専用サーバー 管理デスクトップアプリ（Electron + React + TypeScript）。
`yuzum` 氏の [bedrock-server-manager](https://github.com/yuzum00nnight-wq/bedrock-server-manager)（MIT）を
**Palworld用に作り替えた**ものです（原作者表記は LICENSE に保持）。

## 主な機能
- **SteamCMD** による専用サーバーの導入 / 更新（App ID 2394010）
- 起動 / 停止 / 再起動（停止は **RCON** で安全に）とライブコンソール
- `PalWorldSettings.ini` の GUI 編集（サーバー名・パスワード・ポート・難易度・各種倍率 など）
- **playit.gg** 連携でポート開放不要の外部公開＋友人への案内文コピー
- セーブデータ（SaveGames）のバックアップ / 復元
- RCON によるオンラインプレイヤー一覧 / キック
- CPU / メモリ / 稼働時間の表示

## 開発
```bash
npm install
npm run dev      # 開発起動（Electron + Vite）
npm run build    # 型チェック + ビルド
npm run dist     # Windowsインストーラ(.exe)を release/ に生成
```

## Bedrock版からの主な変更点
| 領域 | Bedrock | Palworld |
|---|---|---|
| 導入 | 公式ZIP直DL | SteamCMD `app_update 2394010` |
| 設定 | server.properties | PalWorldSettings.ini (`OptionSettings=(...)`) |
| 停止/コマンド | 標準入力 | RCON |
| ポート | 19132 | 8211 |
| ワールド/アドオン | あり | Palworldは非対応のため廃止（セーブのバックアップに置換） |

## 免責
本アプリは非公式であり、Pocketpair, Inc. とは関係ありません。SteamCMD /
Palworld Dedicated Server / playit-agent は実行時に各配布元から取得され、
それぞれのライセンスに従います。
