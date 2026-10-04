// ゲームロジック（描画・DOM に依存しない）
import {
  TILE, COLS, ROWS, MAP_Y, PANEL_Y, START_GOLD, START_LIVES, MAX_WAVE, SELL_RATE, MAX_LEVEL,
  REVIVE_LIVES, PATH_WAYPOINTS, TOWERS, ENEMIES, towerStats, upgradeCost, buildWave, waveBonus,
} from './config.js';

export const tileCenter = (c, r) => ({ x: c * TILE + TILE / 2, y: MAP_Y + r * TILE + TILE / 2 });

export class Game {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.buildPath();
    this.reset();
  }

  buildPath() {
    this.pathTiles = new Set();
    for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
      const [c0, r0] = PATH_WAYPOINTS[i];
      const [c1, r1] = PATH_WAYPOINTS[i + 1];
      const dc = Math.sign(c1 - c0);
      const dr = Math.sign(r1 - r0);
      let c = c0, r = r0;
      this.pathTiles.add(`${c},${r}`);
      while (c !== c1 || r !== r1) {
        c += dc; r += dr;
        this.pathTiles.add(`${c},${r}`);
      }
    }
    this.pathPts = PATH_WAYPOINTS.map(([c, r]) => tileCenter(c, r));
    this.segLens = [];
    this.totalLen = 0;
    for (let i = 0; i < this.pathPts.length - 1; i++) {
      const a = this.pathPts[i], b = this.pathPts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      this.segLens.push(len);
      this.totalLen += len;
    }
  }

  posAt(d) {
    for (let i = 0; i < this.segLens.length; i++) {
      const len = this.segLens[i];
      if (d <= len) {
        const a = this.pathPts[i], b = this.pathPts[i + 1], t = d / len;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      d -= len;
    }
    return { ...this.pathPts[this.pathPts.length - 1] };
  }

  reset() {
    this.gold = START_GOLD;
    this.lives = START_LIVES;
    this.wave = 0;
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.effects = [];
    this.floaters = [];
    this.state = 'build'; // build | wave | gameover | victory
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.selectedBuild = null;
    this.selectedTower = null;
    this.hover = null;
    this.drag = null; // { type, x, y, sx, sy, touch, moved, tile }
    this.speed = 1;
    this.paused = false;
    this.reviveUsed = false;
    this.kills = 0;
    this.nextId = 1;
  }

  // ---- クエリ ----

  towerAt(c, r) {
    return this.towers.find((t) => t.c === c && t.r === r);
  }

  isBuildable(c, r) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS && !this.pathTiles.has(`${c},${r}`) && !this.towerAt(c, r);
  }

  sellValue(t) {
    return Math.floor(t.spent * SELL_RATE);
  }

  // ---- 進行 ----

  startWave() {
    if (this.state !== 'build') return;
    this.wave++;
    this.spawnQueue = buildWave(this.wave);
    this.spawnTimer = 0.3;
    this.state = 'wave';
    this.hooks.onWaveStart?.(this.wave);
  }

  revive() {
    this.lives = REVIVE_LIVES;
    this.reviveUsed = true;
    this.state = 'wave';
  }

  update(dt) {
    if (this.paused || this.state === 'gameover' || this.state === 'victory') return;
    if (this.state === 'wave') this.updateSpawns(dt);
    this.updateEnemies(dt);
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.updateFx(dt);
    this.enemies = this.enemies.filter((e) => !e.dead && !e.leaked);

    if (this.lives <= 0) {
      this.lives = 0;
      this.state = 'gameover';
      this.selectedBuild = null;
      this.hooks.onGameOver?.();
      return;
    }
    if (this.state === 'wave' && this.spawnQueue.length === 0 && this.enemies.length === 0) {
      const bonus = waveBonus(this.wave);
      this.gold += bonus;
      this.projectiles = [];
      if (this.wave >= MAX_WAVE) {
        this.state = 'victory';
        this.hooks.onVictory?.();
      } else {
        this.state = 'build';
        this.hooks.onWaveCleared?.(this.wave, bonus);
      }
    }
  }

  updateSpawns(dt) {
    this.spawnTimer -= dt;
    while (this.spawnQueue.length && this.spawnTimer <= 0) {
      const s = this.spawnQueue.shift();
      this.spawnEnemy(s);
      this.spawnTimer += s.gap;
    }
  }

  spawnEnemy({ type, hpMul, rewardMul }) {
    const d = ENEMIES[type];
    const p = this.posAt(0);
    this.enemies.push({
      id: this.nextId++, type, x: p.x, y: p.y, dist: 0,
      hp: d.hp * hpMul, maxHp: d.hp * hpMul, speed: d.speed,
      reward: Math.round(d.reward * rewardMul), radius: d.radius, color: d.color, lives: d.lives,
      boss: !!d.boss, slowMul: 1, slowTimer: 0, burnDps: 0, burnTimer: 0, stunTimer: 0, stunKind: null,
      dead: false, leaked: false,
    });
  }

  updateEnemies(dt) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.burnTimer > 0) {
        e.burnTimer -= dt;
        this.damage(e, e.burnDps * dt);
        if (e.burnTimer <= 0) e.burnDps = 0;
        if (e.dead) continue;
      }
      if (e.slowTimer > 0) {
        e.slowTimer -= dt;
        if (e.slowTimer <= 0) e.slowMul = 1;
      }
      let mul = e.slowMul;
      if (e.stunTimer > 0) {
        e.stunTimer -= dt;
        mul = 0;
      }
      e.dist += e.speed * mul * dt;
      if (e.dist >= this.totalLen) {
        e.leaked = true;
        this.lives -= e.lives;
        this.hooks.onLeak?.();
        continue;
      }
      const p = this.posAt(e.dist);
      e.x = p.x; e.y = p.y;
    }
  }

  updateTowers(dt) {
    for (const t of this.towers) {
      t.cd = Math.max(0, t.cd - dt);
      const s = towerStats(t.type, t.level);
      const range = s.range * TILE;
      // 射程内の敵をゴールに近い順に
      const targets = this.enemies
        .filter((e) => !e.dead && !e.leaked && Math.hypot(e.x - t.x, e.y - t.y) <= range + e.radius)
        .sort((a, b) => b.dist - a.dist);
      t.hasTarget = targets.length > 0;
      if (!targets.length) continue;
      const target = targets[0];
      t.angle = Math.atan2(target.y - t.y, target.x - t.x);
      if (t.cd > 0) continue;
      t.cd = s.cooldown;
      if (s.hitscan) {
        this.fireChain(t, target, s);
        continue;
      }
      for (const tg of targets.slice(0, s.multishot || 1)) {
        const a = Math.atan2(tg.y - t.y, tg.x - t.x);
        this.projectiles.push({
          x: t.x + Math.cos(a) * 14, y: t.y + Math.sin(a) * 14,
          target: tg, tx: tg.x, ty: tg.y, speed: s.projSpeed, damage: s.damage,
          splash: s.splash ? s.splash * TILE : 0, color: s.color, kind: t.type, level: t.level, angle: a,
          slow: s.slow, slowTime: s.slowTime, burnDps: s.burnDps, burnTime: s.burnTime,
          freezeChance: s.freezeChance, freezeTime: s.freezeTime, knockChance: s.knockChance, knockDist: s.knockDist,
        });
      }
    }
  }

  // 雷：即着弾＋近くの敵へ連鎖（1段ごとに威力60%）
  fireChain(t, target, s) {
    const hitSet = new Set([target]);
    let prev = target;
    let dmg = s.damage;
    this.effects.push({ kind: 'beam', level: t.level, x1: t.x, y1: t.y, x2: target.x, y2: target.y, color: s.color, life: 0.18, max: 0.18 });
    if (s.stunTime) this.applyStun(target, s.stunTime, 'stun');
    this.damage(target, dmg);
    for (let k = 0; k < (s.chain || 0); k++) {
      dmg *= 0.6;
      let next = null, best = s.chainRange * TILE;
      for (const e of this.enemies) {
        if (e.dead || e.leaked || hitSet.has(e)) continue;
        const d = Math.hypot(e.x - prev.x, e.y - prev.y);
        if (d <= best) { best = d; next = e; }
      }
      if (!next) break;
      this.effects.push({ kind: 'beam', level: t.level, x1: prev.x, y1: prev.y, x2: next.x, y2: next.y, color: '#e1bee7', life: 0.18, max: 0.18 });
      if (s.stunTime) this.applyStun(next, s.stunTime, 'stun');
      this.damage(next, dmg);
      hitSet.add(next);
      prev = next;
    }
  }

  applyStun(e, time, kind) {
    if (e.boss || e.dead) return;
    if (time >= e.stunTimer) {
      e.stunTimer = time;
      e.stunKind = kind;
    }
  }

  updateProjectiles(dt) {
    const next = [];
    for (const p of this.projectiles) {
      if (p.target && !p.target.dead && !p.target.leaked) {
        p.tx = p.target.x; p.ty = p.target.y;
      } else {
        p.target = null;
      }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step + 2) {
        this.hit(p);
        continue;
      }
      p.angle = Math.atan2(dy, dx);
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
      next.push(p);
    }
    this.projectiles = next;
  }

  hit(p) {
    if (p.splash) {
      for (const e of this.enemies) {
        if (!e.dead && !e.leaked && Math.hypot(e.x - p.tx, e.y - p.ty) <= p.splash + e.radius) this.applyHit(e, p);
      }
      this.effects.push({ kind: 'ring', element: p.kind, level: p.level, x: p.tx, y: p.ty, r: p.splash, color: p.color, life: 0.3, max: 0.3 });
    } else if (p.target) {
      this.applyHit(p.target, p);
    }
  }

  applyHit(e, p) {
    if (p.slow) {
      e.slowMul = Math.min(e.slowMul, p.slow);
      e.slowTimer = Math.max(e.slowTimer, p.slowTime);
    }
    if (p.burnDps) {
      e.burnDps = Math.max(e.burnDps, p.burnDps);
      e.burnTimer = Math.max(e.burnTimer, p.burnTime);
    }
    if (p.freezeChance && Math.random() < p.freezeChance) this.applyStun(e, p.freezeTime, 'freeze');
    if (p.knockChance && !e.boss && Math.random() < p.knockChance) e.dist = Math.max(0, e.dist - p.knockDist);
    this.damage(e, p.damage);
  }

  damage(e, amount) {
    if (e.dead) return;
    e.hp -= amount;
    if (e.hp <= 0) {
      e.dead = true;
      this.gold += e.reward;
      this.kills++;
      this.floater(e.x, e.y - 10, `+${e.reward}`, '#ffd54f');
    }
  }

  updateFx(dt) {
    for (const f of this.effects) f.life -= dt;
    this.effects = this.effects.filter((f) => f.life > 0);
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= 24 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
  }

  floater(x, y, text, color) {
    this.floaters.push({ x, y, text, color, life: 0.9, max: 0.9 });
  }

  // ---- タワー操作 ----

  placeTower(type, c, r) {
    const cost = TOWERS[type].cost;
    if (!this.isBuildable(c, r)) return false;
    const { x, y } = tileCenter(c, r);
    if (this.gold < cost) {
      this.floater(x, y, 'ゴールド不足', '#ef5350');
      return false;
    }
    this.gold -= cost;
    this.towers.push({ type, c, r, x, y, level: 1, cd: 0, angle: Math.PI / 2, spent: cost, hasTarget: false });
    return true;
  }

  upgradeTower(t) {
    if (t.level >= MAX_LEVEL) return;
    const cost = upgradeCost(t.type, t.level);
    if (this.gold < cost) return;
    this.gold -= cost;
    t.level++;
    t.spent += cost;
    this.floater(t.x, t.y - 16, `Lv${t.level}`, '#ffffff');
  }

  sellTower(t) {
    const refund = this.sellValue(t);
    this.gold += refund;
    this.towers = this.towers.filter((x) => x !== t);
    if (this.selectedTower === t) this.selectedTower = null;
    this.floater(t.x, t.y, `+${refund}`, '#ffd54f');
  }

  // ---- 入力 ----

  getButtons() {
    const buttons = [
      { id: 'speed', x: 252, y: 8, w: 48, h: 32, label: `x${this.speed}` },
      { id: 'pause', x: 306, y: 8, w: 46, h: 32, label: this.paused ? '▶' : 'II' },
    ];
    const rowY = PANEL_Y + 8, rowH = 58;
    const t = this.selectedTower;
    if (t) {
      const maxed = t.level >= MAX_LEVEL;
      const cost = maxed ? 0 : upgradeCost(t.type, t.level);
      buttons.push({
        id: 'upgrade', x: 8, y: rowY, w: 136, h: rowH,
        label: maxed ? '最大レベル' : `強化 ${cost}G`,
        sub: maxed ? `${TOWERS[t.type].name} Lv${t.level}` : `Lv${t.level} → ${t.level + 1}`,
        disabled: maxed || this.gold < cost,
      });
      buttons.push({ id: 'sell', x: 152, y: rowY, w: 112, h: rowH, label: `売却 +${this.sellValue(t)}G`, sub: TOWERS[t.type].name });
      buttons.push({ id: 'close', x: 272, y: rowY, w: 80, h: rowH, label: '閉じる' });
    } else {
      Object.keys(TOWERS).forEach((type, i) => {
        buttons.push({
          id: `tower:${type}`, x: 8 + i * 88, y: rowY, w: 80, h: rowH, tower: type,
          selected: this.selectedBuild === type || this.drag?.type === type, disabled: this.gold < TOWERS[type].cost,
        });
      });
    }
    const remaining = this.spawnQueue.length + this.enemies.length;
    buttons.push({
      id: 'wave', x: 8, y: PANEL_Y + 74, w: 344, h: 32, primary: true,
      label: this.state === 'build' ? `▶ ウェーブ ${this.wave + 1} 開始` : `ウェーブ ${this.wave} 進行中（残り ${remaining}）`,
      disabled: this.state !== 'build',
    });
    return buttons;
  }

  buttonAt(x, y) {
    return this.getButtons().find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  }

  // ---- ドラッグ＆ドロップ設置 ----
  // タッチ時は指で隠れないよう、指より少し上のマスを置き先にする
  static TOUCH_OFFSET = 36;

  pointerDown(x, y, touch) {
    if (this.state === 'gameover' || this.state === 'victory') return;
    const b = this.buttonAt(x, y);
    if (b && b.tower && !b.disabled && !this.paused) {
      this.drag = { type: b.tower, x, y, sx: x, sy: y, touch, moved: false, tile: null };
      this.selectedTower = null;
      return;
    }
    this.tap(x, y);
  }

  pointerMove(x, y) {
    const d = this.drag;
    if (!d) {
      this.setHover(x, y);
      return;
    }
    d.x = x;
    d.y = y;
    if (Math.hypot(x - d.sx, y - d.sy) > 8) d.moved = true;
    const ty = d.touch ? y - Game.TOUCH_OFFSET : y;
    d.tile = ty >= MAP_Y && ty < PANEL_Y && x >= 0 && x < COLS * TILE
      ? { c: Math.floor(x / TILE), r: Math.floor((ty - MAP_Y) / TILE) }
      : null;
  }

  pointerUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (!d.moved) {
      // ドラッグせずに離した＝タップ：従来どおり選択 → マスをタップで設置
      this.press({ tower: d.type });
      return;
    }
    if (d.tile && !this.paused && this.state !== 'gameover' && this.state !== 'victory') {
      if (this.placeTower(d.type, d.tile.c, d.tile.r)) this.selectedBuild = null;
    }
  }

  cancelDrag() {
    this.drag = null;
  }

  tap(x, y) {
    if (this.state === 'gameover' || this.state === 'victory') return;
    for (const b of this.getButtons()) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        if (!b.disabled && (!this.paused || b.id === 'pause' || b.id === 'speed')) this.press(b);
        return;
      }
    }
    if (this.paused) return;
    if (y >= MAP_Y && y < PANEL_Y) {
      const c = Math.floor(x / TILE), r = Math.floor((y - MAP_Y) / TILE);
      this.hover = { c, r };
      this.tapTile(c, r);
    }
  }

  tapTile(c, r) {
    const t = this.towerAt(c, r);
    if (t) {
      this.selectedTower = this.selectedTower === t ? null : t;
      this.selectedBuild = null;
      return;
    }
    if (this.selectedBuild) {
      this.placeTower(this.selectedBuild, c, r);
      return;
    }
    this.selectedTower = null;
  }

  press(b) {
    if (b.id === 'speed') this.speed = this.speed === 1 ? 2 : 1;
    else if (b.id === 'pause') this.paused = !this.paused;
    else if (b.id === 'wave') this.startWave();
    else if (b.id === 'upgrade') this.upgradeTower(this.selectedTower);
    else if (b.id === 'sell') this.sellTower(this.selectedTower);
    else if (b.id === 'close') this.selectedTower = null;
    else if (b.tower) {
      this.selectedBuild = this.selectedBuild === b.tower ? null : b.tower;
      this.selectedTower = null;
    }
  }

  setHover(x, y) {
    if (x == null || y < MAP_Y || y >= PANEL_Y) {
      this.hover = null;
      return;
    }
    this.hover = { c: Math.floor(x / TILE), r: Math.floor((y - MAP_Y) / TILE) };
  }
}
