// Japanese labels + UI control metadata for PalWorldSettings options.
// Labels/behaviour are based on the official server guide (v0.7.2, game 0.7.3):
// https://docs.palworldgame.com/ja/settings-and-operation/configuration/
// Sliders are normalised so higher value = "more of the labelled quantity"
// (no inverted "lower is faster" fields). Strict min/max are not officially
// published (the wiki lists rate ranges as TBD); slider ranges mirror the
// in-game world settings, and out-of-range values are still accepted.

import type { PalOptionValue } from '../shared/types';

export type Group = 'server' | 'balance' | 'feature' | 'perf' | 'other';

export interface FieldMeta {
  label: string;
  group: Group;
  control: 'toggle' | 'slider' | 'number' | 'select' | 'text';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  help?: string;
  example?: string;
  password?: boolean;
}

export const GROUP_ORDER: Group[] = ['server', 'balance', 'feature', 'perf', 'other'];
export const GROUP_LABELS: Record<Group, string> = {
  server: 'サーバー',
  balance: 'ゲームバランス',
  feature: 'ゲーム機能',
  perf: 'パフォーマンス',
  other: 'その他・詳細（手入力）',
};

const rate = (min: number, max: number, help?: string): FieldMeta => ({
  label: '',
  group: 'balance',
  control: 'slider',
  min,
  max,
  step: 0.1,
  help,
});

export const CONFIG_META: Record<string, FieldMeta> = {
  // ---- サーバー ----
  ServerName: { label: 'サーバー名', group: 'server', control: 'text', example: '例: TBH Palworld Server' },
  ServerDescription: { label: 'サーバー説明', group: 'server', control: 'text', example: '一覧に表示される紹介文' },
  ServerPassword: {
    label: '参加パスワード',
    group: 'server',
    control: 'text',
    password: true,
    help: '空欄にすると誰でも参加できます。',
  },
  AdminPassword: {
    label: '管理者パスワード (RCON)',
    group: 'server',
    control: 'text',
    password: true,
    help: 'アプリからの停止・コマンド送信に必要です。例: Abc-311088',
  },
  ServerPlayerMaxNum: { label: '最大参加人数', group: 'server', control: 'slider', min: 1, max: 32, step: 1, help: 'ハード上限は 32。近づくほど負荷が増えます。' },
  PublicPort: { label: '公開ポート', group: 'server', control: 'number', help: '通常は 8211。' },
  PublicIP: {
    label: '公開IP',
    group: 'server',
    control: 'text',
    help: 'コミュニティ掲載時のみ。ポートは含めずIPだけを入力。',
    example: '例: 203.0.113.10',
  },
  CrossplayPlatforms: {
    label: 'クロスプレイ対象',
    group: 'server',
    control: 'text',
    help: '接続を許可するプラットフォーム。',
    example: '例: (Steam,Xbox,PS5,Mac)',
  },
  AllowConnectPlatform: {
    label: '接続プラットフォーム（旧）',
    group: 'other',
    control: 'text',
    help: 'このバージョンでは使いません。CrossplayPlatforms を使用してください。',
  },
  bIsShowJoinLeftMessage: { label: '参加/退出メッセージを表示', group: 'server', control: 'toggle' },
  ChatPostLimitPerMinute: { label: 'チャット投稿制限（1分あたり）', group: 'server', control: 'number' },
  bAllowClientMod: { label: 'Mod使用者の参加を許可', group: 'server', control: 'toggle' },
  bIsUseBackupSaveData: {
    label: 'ワールドバックアップを有効化',
    group: 'server',
    control: 'toggle',
    help: 'ディスク負荷が増えますが、セーブの自動バックアップが作られます。',
  },
  LogFormatType: { label: 'ログ形式', group: 'server', control: 'select', options: ['Text', 'Json'] },
  RCONEnabled: { label: 'RCON を有効化', group: 'server', control: 'toggle', help: 'アプリ制御に必要（保存時に自動でオン）。' },
  RCONPort: { label: 'RCON ポート', group: 'server', control: 'number' },
  RESTAPIEnabled: { label: 'REST API を有効化', group: 'server', control: 'toggle' },
  RESTAPIPort: { label: 'REST API ポート', group: 'server', control: 'number' },

  // ---- ゲームバランス（倍率＝スライダー） ----
  ExpRate: { ...rate(0.1, 20, '経験値の入手倍率。ソロは高めが快適。'), label: '経験値倍率' },
  PalCaptureRate: { ...rate(0.5, 2, '捕獲成功率の倍率。'), label: 'パル捕獲率' },
  PalSpawnNumRate: { ...rate(0.5, 3, '野生パルの出現数。上げると重くなります。'), label: 'パル出現数倍率' },
  DayTimeSpeedRate: { ...rate(0.1, 5, '高いほど昼が速く過ぎ、昼が短くなります。'), label: '昼の経過速度' },
  NightTimeSpeedRate: { ...rate(0.1, 5, '高いほど夜が速く過ぎ、夜が短くなります。'), label: '夜の経過速度' },
  PlayerDamageRateAttack: { ...rate(0.1, 5, 'プレイヤーの与ダメージ。'), label: 'プレイヤー与ダメージ倍率' },
  PlayerDamageRateDefense: { ...rate(0.1, 5, '高いほど受けるダメージが増えます。'), label: 'プレイヤー被ダメージ倍率' },
  PalDamageRateAttack: { ...rate(0.1, 5), label: 'パル与ダメージ倍率' },
  PalDamageRateDefense: { ...rate(0.1, 5, '高いほどパルが受けるダメージが増えます。'), label: 'パル被ダメージ倍率' },
  PlayerStomachDecreaceRate: { ...rate(0.1, 5, '高いほど早く空腹になります。'), label: 'プレイヤー満腹度の減少' },
  PlayerStaminaDecreaceRate: { ...rate(0.1, 5, '高いほど早くスタミナが減ります。'), label: 'プレイヤースタミナの減少' },
  PlayerAutoHPRegeneRate: { ...rate(0.1, 5, '高いほど自然回復が速い。'), label: 'プレイヤーHP自然回復' },
  PlayerAutoHpRegeneRateInSleep: { ...rate(0.1, 5), label: 'プレイヤー睡眠時HP回復' },
  PalStomachDecreaceRate: { ...rate(0.1, 5, '高いほど早く空腹になります。'), label: 'パル満腹度の減少' },
  PalStaminaDecreaceRate: { ...rate(0.1, 5, '高いほど早くスタミナが減ります。'), label: 'パルスタミナの減少' },
  PalAutoHPRegeneRate: { ...rate(0.1, 5), label: 'パルHP自然回復' },
  PalAutoHpRegeneRateInSleep: { ...rate(0.1, 5, 'パルボックス内での回復。'), label: 'パル睡眠時HP回復' },
  BuildObjectDamageRate: { ...rate(0.5, 3), label: '建築物への被ダメージ倍率' },
  BuildObjectDeteriorationDamageRate: { ...rate(0, 3, '高いほど早く劣化します。0で劣化なし。'), label: '建築物の劣化速度' },
  CollectionDropRate: { ...rate(0.5, 3, '採集で入手できる量。'), label: '採集アイテム入手量' },
  CollectionObjectHpRate: { ...rate(0.5, 3, '高いほど採集に必要な手数が増えます。'), label: '採集オブジェクトのHP' },
  CollectionObjectRespawnSpeedRate: { ...rate(0.5, 3, '高いほど再出現までが遅く（間隔が長く）なります。'), label: '採集オブジェクトの再出現間隔' },
  EnemyDropItemRate: { ...rate(0.5, 3), label: '敵ドロップ量倍率' },
  EquipmentDurabilityDamageRate: { ...rate(0, 3, '高いほど早く耐久が減ります。0で減りません。'), label: '装備の耐久消耗' },
  ItemWeightRate: { ...rate(0, 5, '高いほどアイテムが重くなります。'), label: 'アイテム重量倍率' },
  ItemCorruptionMultiplier: { ...rate(0, 5, '高いほど早く腐敗します。0で腐敗しません。'), label: 'アイテム腐敗速度' },
  RespawnPenaltyTimeScale: { ...rate(1, 5, '高いほదリスポーン待ち時間が長くなります。'), label: 'リスポーン時間の倍率' },
  DeathPenalty: {
    label: 'デスペナルティ',
    group: 'balance',
    control: 'select',
    options: ['None', 'Item', 'ItemAndEquipment', 'All'],
    help: 'None:ロスト無し / Item:装備以外 / ItemAndEquipment:装備とアイテム / All:手持ちパルも',
  },
  bPalLost: { label: '死亡時にパルをロスト', group: 'balance', control: 'toggle' },
  BlockRespawnTime: { label: 'リスポーン待機時間（秒）', group: 'balance', control: 'number' },
  RespawnPenaltyDurationThreshold: { label: '連続死亡ペナルティ判定（秒）', group: 'balance', control: 'number' },
  PalEggDefaultHatchingTime: { label: 'キョダイタマゴ孵化時間（時間）', group: 'balance', control: 'number', help: '実時間。既定72は長いので下げる人が多い。0で即時。' },
  SupplyDropSpan: { label: '補給物資の投下間隔（分）', group: 'balance', control: 'number', help: '専用サーバーでは無視される（180のまま）との報告が多い項目です。' },
  GuildPlayerMaxNum: { label: 'ギルド最大人数', group: 'balance', control: 'slider', min: 1, max: 100, step: 1 },
  GuildRejoinCooldownMinutes: { label: 'ギルド再加入クールタイム（分）', group: 'balance', control: 'number' },
  DenyTechnologyList: {
    label: '無効化するテクノロジー',
    group: 'other',
    control: 'text',
    help: '習得を禁止するテクノロジーID。',
    example: '例: ("PALBOX","RepairBench")',
  },
  bAdditionalDropItemWhenPlayerKillingInPvPMode: { label: 'PvPキル時に専用アイテムをドロップ', group: 'balance', control: 'toggle' },
  AdditionalDropItemNumWhenPlayerKillingInPvPMode: { label: 'PvPキル時ドロップ数', group: 'balance', control: 'number' },
  AdditionalDropItemWhenPlayerKillingInPvPMode: {
    label: 'PvPキル時ドロップのアイテムID',
    group: 'other',
    control: 'text',
    example: 'アイテムIDを指定',
  },

  // ---- ゲーム機能（トグル中心） ----
  Difficulty: {
    label: '難易度',
    group: 'feature',
    control: 'select',
    options: ['None', 'Casual', 'Normal', 'Hard'],
    help: '専用サーバーでは現状ほぼ機能しません（None のままで各倍率がそのまま効きます）。',
  },
  bIsPvP: { label: 'PvP を許可', group: 'feature', control: 'toggle', help: 'PvPには本項目＋プレイヤー間ダメージ＋他ギルド攻撃の3つを全てオンにする必要があります。' },
  bEnableDefenseOtherGuildPlayer: { label: '拠点で他ギルドを攻撃（PvP必須）', group: 'feature', control: 'toggle', help: 'PvP有効化に必要な3つ目のトグル。' },
  EnablePredatorBossPal: { label: '徘徊ボス（プレデター）を有効化', group: 'feature', control: 'toggle' },
  bEnableInvaderEnemy: { label: '襲撃（侵入者）を有効化', group: 'feature', control: 'toggle' },
  bEnableFastTravel: { label: 'ファストトラベルを有効化', group: 'feature', control: 'toggle' },
  bEnableFastTravelOnlyBaseCamp: { label: 'ファストトラベルを拠点間のみに制限', group: 'feature', control: 'toggle' },
  bIsStartLocationSelectByMap: { label: '開始地点を選択可能に', group: 'feature', control: 'toggle' },
  bExistPlayerAfterLogout: { label: 'ログアウト後もその場に残る', group: 'feature', control: 'toggle' },
  bShowPlayerList: { label: '参加者一覧を表示（ESC画面）', group: 'feature', control: 'toggle' },
  bBuildAreaLimit: { label: 'ファストトラベル付近の建築を禁止', group: 'feature', control: 'toggle' },
  bInvisibleOtherGuildBaseCampAreaFX: { label: '拠点範囲の表示', group: 'feature', control: 'toggle' },
  bHardcore: { label: 'ハードコア（死亡でリスポーン不可）', group: 'feature', control: 'toggle' },
  bCharacterRecreateInHardcore: { label: 'ハードコア死亡時にキャラ再作成', group: 'feature', control: 'toggle' },
  bAllowEnhanceStat_Attack: { label: 'ステ振り: 攻撃を許可', group: 'feature', control: 'toggle' },
  bAllowEnhanceStat_Health: { label: 'ステ振り: HPを許可', group: 'feature', control: 'toggle' },
  bAllowEnhanceStat_Stamina: { label: 'ステ振り: スタミナを許可', group: 'feature', control: 'toggle' },
  bAllowEnhanceStat_Weight: { label: 'ステ振り: 所持重量を許可', group: 'feature', control: 'toggle' },
  bAllowEnhanceStat_WorkSpeed: { label: 'ステ振り: 作業速度を許可', group: 'feature', control: 'toggle' },
  bAllowGlobalPalboxExport: { label: 'グローバルパルボックスへ保存', group: 'feature', control: 'toggle' },
  bAllowGlobalPalboxImport: { label: 'グローバルパルボックスから読込', group: 'feature', control: 'toggle' },
  bAutoResetGuildNoOnlinePlayers: { label: '無人ギルドを自動削除', group: 'feature', control: 'toggle' },
  AutoResetGuildTimeNoOnlinePlayers: { label: '自動削除までのオフライン時間（秒）', group: 'feature', control: 'number' },
  bDisplayPvPItemNumOnWorldMap_BaseCamp: { label: 'PvP専用アイテム数を拠点に表示', group: 'feature', control: 'toggle' },
  bDisplayPvPItemNumOnWorldMap_Player: { label: 'PvP専用アイテム数を自位置に表示', group: 'feature', control: 'toggle' },
  bIsRandomizerPalLevelRandom: { label: '野生パルのレベルを完全ランダム化', group: 'feature', control: 'toggle' },
  RandomizerType: {
    label: '出現パルのランダム化',
    group: 'feature',
    control: 'select',
    options: ['None', 'Region', 'All'],
    help: 'None:しない / Region:地域ごと / All:完全ランダム',
  },
  RandomizerSeed: { label: 'ランダム化シード', group: 'other', control: 'text', help: 'ランダム化時の再現用の値（空で無効）。' },

  // 既定iniに存在するが公式表に無い一般的なトグル
  bEnablePlayerToPlayerDamage: { label: 'プレイヤー間ダメージ', group: 'feature', control: 'toggle' },
  bEnableFriendlyFire: { label: 'フレンドリーファイア', group: 'feature', control: 'toggle' },
  bEnableNonLoginPenalty: { label: '未ログインペナルティ', group: 'feature', control: 'toggle' },
  bEnableAimAssistPad: { label: 'エイムアシスト（パッド）', group: 'feature', control: 'toggle' },
  bEnableAimAssistKeyboard: { label: 'エイムアシスト（キーボード）', group: 'feature', control: 'toggle' },
  bCanPickupOtherGuildDeathPenaltyDrop: { label: '他ギルドのデスドロップ回収可', group: 'feature', control: 'toggle' },
  bActiveUNKO: { label: '落とし物(UNKO)表現を有効化', group: 'feature', control: 'toggle' },

  // ---- パフォーマンス ----
  BaseCampMaxNumInGuild: { label: 'ギルドあたり最大拠点数', group: 'perf', control: 'slider', min: 1, max: 10, step: 1, help: '大きいほど負荷増。' },
  BaseCampWorkerMaxNum: { label: '拠点あたり最大パル数', group: 'perf', control: 'slider', min: 1, max: 50, step: 1, help: 'ハード上限50。ただし15より上が反映されない不具合報告あり。' },
  MaxBuildingLimitNum: { label: 'プレイヤーごとの建築数上限', group: 'perf', control: 'number', help: '0 で無制限。' },
  ItemContainerForceMarkDirtyInterval: { label: 'コンテナ同期間隔（秒）', group: 'perf', control: 'number' },
  ServerReplicatePawnCullDistance: {
    label: 'パル同期距離（cm）',
    group: 'perf',
    control: 'slider',
    min: 5000,
    max: 15000,
    step: 500,
  },

  // 公式表・実機(v0.7.3)で確認できた追加キー
  WorkSpeedRate: { ...rate(0.1, 5, '拠点パルの作業速度。'), label: '作業速度倍率' },
  AutoSaveSpan: { label: 'オートセーブ間隔（秒）', group: 'server', control: 'number', help: '既定30。大規模拠点では60〜120にするとカクつき軽減。' },
  DropItemMaxNum: { label: '地面アイテムの総数上限', group: 'perf', control: 'number', help: 'ラグ対策に下げる。既定3000。' },
  DropItemMaxNum_UNKO: { label: '落とし物(UNKO)の総数上限', group: 'perf', control: 'number' },
  DropItemAliveMaxHours: { label: '地面アイテムの保持時間（時間）', group: 'balance', control: 'number' },
  BaseCampMaxNum: { label: 'ワールド全体の拠点上限', group: 'perf', control: 'number', help: '全ギルド合計。既定128。' },
  CoopPlayerMaxNum: { label: 'co-op最大人数', group: 'other', control: 'number', help: '招待プレイ用。専用サーバーでは無視されます。' },
  bUseAuth: { label: 'Steam認証を要求', group: 'server', control: 'toggle', help: 'LANテスト以外はオンのままに。' },
  BanListURL: { label: 'BANリストURL', group: 'other', control: 'text', help: '既定は公式のグローバルBANリスト。' },
  Region: { label: 'リージョン表記', group: 'server', control: 'text', help: '一覧に表示される地域ラベル（表示のみ）。' },
  bIsMultiplay: { label: 'co-opフラグ（無視）', group: 'other', control: 'toggle', help: '専用サーバーでは無視されます。' },
};

/** Resolve metadata for a key, falling back to a sensible control by value type. */
export function metaFor(key: string, value: PalOptionValue): FieldMeta {
  const m = CONFIG_META[key];
  if (m) return m;
  if (typeof value === 'boolean') return { label: key, group: 'other', control: 'toggle' };
  if (typeof value === 'number') return { label: key, group: 'other', control: 'number' };
  return { label: key, group: 'other', control: 'text', help: '手入力の項目です。' };
}
