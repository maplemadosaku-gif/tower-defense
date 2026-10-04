// ゲーム全体の定数・バランス調整値

// 論理解像度（縦持ち 9:16）。実際の画面サイズには main.js でスケールする。
export const TILE = 40;
export const COLS = 9;
export const ROWS = 12;
export const VIEW_W = COLS * TILE; // 360
export const VIEW_H = 640;
export const HUD_H = 48;
export const MAP_Y = HUD_H;
export const PANEL_Y = MAP_Y + ROWS * TILE; // 528

export const START_GOLD = 150;
export const START_LIVES = 20;
export const MAX_WAVE = 20;
export const SELL_RATE = 0.7;
export const MAX_LEVEL = 3;
export const REVIVE_LIVES = 10;

// 敵の通り道（グリッド座標 [col, row]）。始点・終点は画面外。
export const PATH_WAYPOINTS = [
  [1, -1], [1, 2], [7, 2], [7, 5], [1, 5], [1, 8], [7, 8], [7, 10], [4, 10], [4, 12],
];

// range はタイル数、cooldown は秒。traits[0] が基本特性、traits[1..] が Lv2/Lv3 で解放される特性。
export const TOWERS = {
  wind: {
    name: 'ウィンド', element: '風', cost: 50, color: '#66bb6a', range: 2.5, damage: 10, cooldown: 0.45, projSpeed: 480,
    traits: ['速射・単体攻撃', '2体を同時に攻撃', '3体同時攻撃＋20%でノックバック'],
  },
  fire: {
    name: 'ファイア', element: '火', cost: 100, color: '#ef5350', range: 2.2, damage: 45, cooldown: 1.8, projSpeed: 260, splash: 0.9,
    traits: ['高威力の範囲攻撃（クールタイム長め）', '燃焼：3秒間の持続ダメージ', '燃焼強化（4秒）＋爆発範囲拡大'],
  },
  ice: {
    name: 'アイス', element: '氷', cost: 80, color: '#4fc3f7', range: 2.0, damage: 5, cooldown: 0.9, projSpeed: 340, splash: 0.7,
    traits: ['範囲の敵を減速（50%）', '減速強化（60%）', '15%で1秒凍結（ボス無効）'],
  },
  thunder: {
    name: 'サンダー', element: '雷', cost: 150, color: '#ba68c8', range: 4.5, damage: 70, cooldown: 2.0, hitscan: true,
    traits: ['長射程・即着弾の高威力', '連鎖：近くの敵2体に伝播', '連鎖3体＋感電で0.4秒停止（ボス無効）'],
  },
};

export function towerStats(type, level) {
  const b = TOWERS[type];
  const m = level - 1;
  const s = {
    ...b,
    damage: b.damage * Math.pow(1.6, m),
    range: b.range * (1 + 0.12 * m),
    cooldown: b.cooldown * Math.pow(0.88, m),
  };
  if (type === 'wind') {
    s.multishot = level;
    if (level >= 2) s.damage *= 0.7; // 同時攻撃になる分、1発あたりは弱める
    if (level >= 3) { s.knockChance = 0.2; s.knockDist = 30; }
  } else if (type === 'fire') {
    if (level >= 2) { s.burnDps = s.damage * (level >= 3 ? 0.5 : 0.3); s.burnTime = level >= 3 ? 4 : 3; }
    if (level >= 3) s.splash = b.splash * 1.3;
  } else if (type === 'ice') {
    s.slow = [0.5, 0.4, 0.4][m];
    s.slowTime = 1.6;
    if (level >= 3) { s.freezeChance = 0.15; s.freezeTime = 1.0; }
  } else if (type === 'thunder') {
    s.chain = [0, 2, 3][m];
    s.chainRange = 1.6;
    if (level >= 3) s.stunTime = 0.4;
  }
  return s;
}

export const upgradeCost = (type, level) => Math.round(TOWERS[type].cost * 0.75 * level);

// speed は px/秒、lives は到達時に減るライフ
export const ENEMIES = {
  grunt: { hp: 38, speed: 42, reward: 5, radius: 10, color: '#e53935', lives: 1 },
  runner: { hp: 22, speed: 80, reward: 4, radius: 8, color: '#fdd835', lives: 1 },
  tank: { hp: 150, speed: 27, reward: 12, radius: 13, color: '#8d6e63', lives: 2 },
  boss: { hp: 1000, speed: 22, reward: 60, radius: 17, color: '#424242', lives: 5, boss: true }, // ボスは凍結・感電・ノックバック無効
};

// ウェーブ n の出現リストを生成（gap は次の敵までの秒数）
export function buildWave(n) {
  const hpMul = Math.pow(1.23, n - 1);
  const rewardMul = 1 + 0.02 * (n - 1);
  const gap = Math.max(0.4, 0.95 - n * 0.025);
  const rush = n % 7 === 0;
  const count = 6 + n * 2;
  const types = [];
  for (let i = 0; i < count; i++) {
    if (rush) types.push('runner');
    else if (n >= 4 && i % 5 === 4) types.push('tank');
    else if (n >= 2 && i % 3 === 2) types.push('runner');
    else types.push('grunt');
  }
  if (n % 5 === 0) for (let i = 0; i < n / 5; i++) types.push('boss');
  return types.map((type) => ({
    type, hpMul, rewardMul,
    gap: type === 'boss' ? 2.0 : rush ? gap * 0.6 : gap,
  }));
}

export const waveBonus = (n) => 15 + n * 3;
