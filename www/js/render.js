// Canvas 描画（論理解像度 360x640 で描く）
import { TILE, COLS, ROWS, MAP_Y, VIEW_W, VIEW_H, HUD_H, PANEL_Y, TOWERS, MAX_WAVE, towerStats } from './config.js';
import { tileCenter } from './game.js';

const FONT = 'system-ui, -apple-system, "Hiragino Sans", sans-serif';

export function render(ctx, g) {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  drawMap(ctx, g);
  drawSelection(ctx, g);
  for (const t of [...g.towers].sort((a, b) => a.y - b.y)) drawTower(ctx, t, g.selectedTower === t);
  for (const e of g.enemies) drawEnemy(ctx, e);
  drawProjectiles(ctx, g);
  drawEffects(ctx, g);
  drawFloaters(ctx, g);
  drawHud(ctx, g);
  drawPanel(ctx, g);
  drawInfo(ctx, g);
  if (g.paused) drawPaused(ctx);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function text(ctx, str, x, y, { size = 14, color = '#fff', align = 'center', weight = 'bold' } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

// ---- マップ ----

function strokePath(ctx, pts, color, width) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'miter';
  ctx.stroke();
}

function drawMap(ctx, g) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#5f9e4a' : '#67a852';
      ctx.fillRect(c * TILE, MAP_Y + r * TILE, TILE, TILE);
      // 草の模様（座標から決まる擬似乱数）
      const h = (c * 73 + r * 151) % 7;
      if (h < 2) {
        ctx.fillStyle = '#4e8a3c';
        ctx.fillRect(c * TILE + 8 + h * 14, MAP_Y + r * TILE + 10 + h * 9, 3, 6);
        ctx.fillRect(c * TILE + 13 + h * 14, MAP_Y + r * TILE + 12 + h * 9, 3, 5);
      }
    }
  }
  strokePath(ctx, g.pathPts, '#9c7b4f', TILE);
  strokePath(ctx, g.pathPts, '#d8b98a', TILE - 8);

  // ゴール表示
  const goal = tileCenter(4, 11);
  ctx.fillStyle = 'rgba(183, 28, 28, 0.85)';
  ctx.fillRect(goal.x - 20, goal.y + 8, 40, 12);
  text(ctx, 'GOAL', goal.x, goal.y + 14, { size: 10 });
}

function rangeCircle(ctx, x, y, r, color) {
  circle(ctx, x, y, r);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawSelection(ctx, g) {
  if (g.selectedTower) {
    const t = g.selectedTower;
    rangeCircle(ctx, t.x, t.y, towerStats(t.type, t.level).range * TILE, '#ffffff');
  }
  if (!g.selectedBuild) return;
  // 設置可能マスを薄く示す（タッチ端末向け）
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (g.isBuildable(c, r)) ctx.strokeRect(c * TILE + 3.5, MAP_Y + r * TILE + 3.5, TILE - 7, TILE - 7);
    }
  }
  if (g.hover) {
    const { c, r } = g.hover;
    const def = TOWERS[g.selectedBuild];
    const ok = g.isBuildable(c, r) && g.gold >= def.cost;
    ctx.fillStyle = ok ? 'rgba(255,255,255,0.3)' : 'rgba(229,57,53,0.45)';
    ctx.fillRect(c * TILE, MAP_Y + r * TILE, TILE, TILE);
    if (ok) {
      const p = tileCenter(c, r);
      rangeCircle(ctx, p.x, p.y, def.range * TILE, def.color);
    }
  }
}

// ---- ユニット ----

// ---- キャラクタースプライト ----
// assets/sprites/<type>.png：横 4 列（下・左・上・右）× 縦 3 行（待機・詠唱・発動）、1 コマ 64x122
const SPRITE_W = 64, SPRITE_H = 122;
const SPRITE_FEET_Y = 72; // コマ内の足元の y
const SPRITE_SCALE = 0.75;
const ROW_IDLE = 0, ROW_CAST = 1, ROW_ACT = 2;
const SPRITES = {};
for (const type of Object.keys(TOWERS)) {
  const img = new Image();
  img.src = `assets/sprites/${type}.png`;
  SPRITES[type] = img;
}
const spriteReady = (type) => SPRITES[type]?.complete && SPRITES[type].naturalWidth > 0;

// 角度 → 向きの列（0:下 1:左 2:上 3:右）
function facingCol(angle) {
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (a < Math.PI / 4 || a >= (Math.PI * 7) / 4) return 3;
  if (a < (Math.PI * 3) / 4) return 0;
  if (a < (Math.PI * 5) / 4) return 1;
  return 2;
}

function towerRow(t) {
  const s = towerStats(t.type, t.level);
  const sinceFire = s.cooldown - t.cd;
  if (t.cd > 0 && sinceFire < Math.min(0.3, s.cooldown * 0.5)) return ROW_ACT;
  return t.hasTarget ? ROW_CAST : ROW_IDLE;
}

function drawTower(ctx, t, selected) {
  const def = TOWERS[t.type];
  const feetY = t.y + 12;
  // 足元：影＋属性色のリング（レベルで太く）
  ctx.beginPath();
  ctx.ellipse(t.x, feetY, 15, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  ctx.strokeStyle = selected ? '#ffd54f' : def.color;
  ctx.lineWidth = selected ? 2.5 : t.level;
  ctx.stroke();

  if (spriteReady(t.type)) {
    const col = facingCol(t.angle);
    const row = towerRow(t);
    const w = SPRITE_W * SPRITE_SCALE, h = SPRITE_H * SPRITE_SCALE;
    const bob = row === ROW_IDLE ? Math.sin(performance.now() / 400 + t.c * 1.3 + t.r) * 0.8 : 0;
    ctx.drawImage(SPRITES[t.type], col * SPRITE_W, row * SPRITE_H, SPRITE_W, SPRITE_H,
      t.x - w / 2, feetY - SPRITE_FEET_Y * SPRITE_SCALE + bob, w, h);
  } else {
    circle(ctx, t.x, t.y, 10);
    ctx.fillStyle = def.color;
    ctx.fill();
  }

  for (let i = 0; i < t.level; i++) {
    circle(ctx, t.x - (t.level - 1) * 4 + i * 8, feetY + 7, 2.5);
    ctx.fillStyle = '#ffd54f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// パネル用の顔アイコン（待機・下向きコマの頭部を丸く切り抜く）
function drawFace(ctx, type, cx, cy, r) {
  const def = TOWERS[type];
  circle(ctx, cx, cy, r);
  ctx.fillStyle = '#10161a';
  ctx.fill();
  if (spriteReady(type)) {
    ctx.save();
    circle(ctx, cx, cy, r);
    ctx.clip();
    ctx.drawImage(SPRITES[type], 10, 6, 44, 44, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }
  circle(ctx, cx, cy, r);
  ctx.strokeStyle = def.color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawEnemy(ctx, e) {
  circle(ctx, e.x, e.y, e.radius);
  ctx.fillStyle = e.color;
  ctx.fill();
  ctx.lineWidth = e.slowMul < 1 ? 3 : 1.5;
  ctx.strokeStyle = e.slowMul < 1 ? '#81d4fa' : 'rgba(0,0,0,0.5)';
  ctx.stroke();
  if (e.type === 'boss') text(ctx, '★', e.x, e.y + 1, { size: 14, color: '#ffd54f' });

  // 状態異常
  if (e.burnTimer > 0) {
    const flicker = 1.5 + Math.sin(performance.now() / 60 + e.id) * 1.5;
    circle(ctx, e.x, e.y, e.radius + 2 + flicker);
    ctx.strokeStyle = 'rgba(255,152,0,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (e.stunTimer > 0) {
    circle(ctx, e.x, e.y, e.radius);
    ctx.fillStyle = e.stunKind === 'freeze' ? 'rgba(225,245,254,0.7)' : 'rgba(255,241,118,0.55)';
    ctx.fill();
    if (e.stunKind === 'stun') text(ctx, '⚡', e.x + e.radius, e.y - e.radius, { size: 11 });
  }

  const w = e.radius * 2 + 4;
  const ratio = Math.max(0, e.hp / e.maxHp);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(e.x - w / 2, e.y - e.radius - 8, w, 4);
  ctx.fillStyle = ratio > 0.5 ? '#76ff03' : ratio > 0.25 ? '#ffca28' : '#ff5252';
  ctx.fillRect(e.x - w / 2, e.y - e.radius - 8, w * ratio, 4);
}

// ---- 弾（属性 × レベルで見た目が変わる。ローカル座標は +x が進行方向） ----

function drawProjectiles(ctx, g) {
  const now = performance.now() / 1000;
  for (const p of g.projectiles) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle || 0);
    if (p.kind === 'wind') drawWindShot(ctx, p.level, now);
    else if (p.kind === 'fire') drawFireShot(ctx, p.level, now);
    else if (p.kind === 'ice') drawIceShot(ctx, p.level, now);
    ctx.restore();
  }
}

function fadeTrail(ctx, len, width, rgb) {
  const grad = ctx.createLinearGradient(-len, 0, 0, 0);
  grad.addColorStop(0, `rgba(${rgb},0)`);
  grad.addColorStop(1, `rgba(${rgb},0.85)`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-len, 0);
  ctx.lineTo(0, 0);
  ctx.stroke();
}

// 風：Lv1 矢 → Lv2 光る矢＋軌跡 → Lv3 回転する風の刃
function drawWindShot(ctx, level, t) {
  ctx.scale(1.3, 1.3);
  if (level >= 2) fadeTrail(ctx, level >= 3 ? 22 : 18, level >= 3 ? 6 : 4, level >= 3 ? '200,230,201' : '255,255,255');
  if (level === 2) {
    const grad = ctx.createRadialGradient(2, 0, 0, 2, 0, 8);
    grad.addColorStop(0, 'rgba(200,255,200,0.9)');
    grad.addColorStop(1, 'rgba(105,240,174,0)');
    circle(ctx, 2, 0, 8);
    ctx.fillStyle = grad;
    ctx.fill();
  }
  if (level >= 3) {
    ctx.rotate(t * 25);
    ctx.beginPath();
    ctx.arc(0, 0, 9, -Math.PI * 0.8, Math.PI * 0.8);
    ctx.arc(-4, 0, 7, Math.PI * 0.7, -Math.PI * 0.7, true);
    ctx.closePath();
    ctx.fillStyle = '#e8f5e9';
    ctx.fill();
    ctx.strokeStyle = '#2e7d32';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return;
  }
  ctx.strokeStyle = '#5d4037';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-11, 0);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-2, -3.5);
  ctx.lineTo(0, 0);
  ctx.lineTo(-2, 3.5);
  ctx.closePath();
  ctx.fillStyle = level >= 2 ? '#c8e6c9' : '#66bb6a';
  ctx.fill();
  ctx.strokeStyle = '#1b5e20';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// 火：レベルが上がるほど火球が大きく、尾が長く、Lv3 は白熱した芯
function drawFireShot(ctx, level, t) {
  const r = [4, 5.5, 7][level - 1];
  const tails = level * 3;
  for (let i = tails; i > 0; i--) {
    const k = i / tails;
    const x = -k * r * 3.2 - 2;
    const y = Math.sin(t * 30 + i * 1.7) * r * 0.45 * k;
    circle(ctx, x, y, r * (1 - k * 0.65));
    ctx.fillStyle = `rgba(255,${Math.round(90 + 110 * (1 - k))},0,${0.55 * (1 - k * 0.8)})`;
    ctx.fill();
  }
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2);
  grad.addColorStop(0, level >= 3 ? '#ffffff' : '#fff59d');
  grad.addColorStop(0.35, '#ffb300');
  grad.addColorStop(0.7, 'rgba(255,87,34,0.6)');
  grad.addColorStop(1, 'rgba(255,87,34,0)');
  circle(ctx, 0, 0, r * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  if (level >= 3) {
    circle(ctx, 0, 0, r * 0.45);
    ctx.fillStyle = '#e3f2fd';
    ctx.fill();
  }
}

// 氷：Lv1 氷の破片 → Lv2 回転する雪の結晶 → Lv3 大きな結晶＋きらめき
function drawIceShot(ctx, level, t) {
  if (level === 1) {
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(0, -3.5);
    ctx.lineTo(-7, 0);
    ctx.lineTo(0, 3.5);
    ctx.closePath();
    ctx.fillStyle = '#b3e5fc';
    ctx.fill();
    ctx.strokeStyle = '#0277bd';
    ctx.lineWidth = 1;
    ctx.stroke();
    return;
  }
  const R = level >= 3 ? 9 : 6.5;
  if (level >= 3) {
    for (let i = 1; i <= 4; i++) {
      const tw = 0.5 + 0.5 * Math.sin(t * 20 + i * 2);
      circle(ctx, -i * 5 - 4, Math.sin(i * 2.3) * 4, 1.4);
      ctx.fillStyle = `rgba(225,245,254,${tw})`;
      ctx.fill();
    }
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.6);
    grad.addColorStop(0, 'rgba(179,229,252,0.7)');
    grad.addColorStop(1, 'rgba(179,229,252,0)');
    circle(ctx, 0, 0, R * 1.6);
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.rotate(t * 6);
  for (const [color, width] of [['#0288d1', 3.5], ['#e1f5fe', 1.6]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const cx = Math.cos(a), cy = Math.sin(a);
      ctx.moveTo(0, 0);
      ctx.lineTo(cx * R, cy * R);
      // 枝
      const bx = cx * R * 0.6, by = cy * R * 0.6;
      for (const s of [-1, 1]) {
        const ba = a + s * 0.7;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(ba) * R * 0.35, by + Math.sin(ba) * R * 0.35);
      }
    }
    ctx.stroke();
  }
}

// 雷：ジグザグの稲妻（毎フレーム形が変わってバチバチする）。Lv が上がると太く、分岐が増える
function boltPoints(x1, y1, x2, y2, jitter) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const segs = Math.max(3, Math.floor(len / 12));
  const pts = [[x1, y1]];
  for (let i = 1; i < segs; i++) {
    const k = i / segs;
    const off = (Math.random() * 2 - 1) * jitter;
    pts.push([x1 + dx * k + nx * off, y1 + dy * k + ny * off]);
  }
  pts.push([x2, y2]);
  return pts;
}

function strokePoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function drawBolt(ctx, f) {
  const level = f.level || 1;
  const pts = boltPoints(f.x1, f.y1, f.x2, f.y2, [4, 6, 8][level - 1]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = f.color;
  ctx.lineWidth = [3, 5, 7][level - 1];
  ctx.globalAlpha *= 0.55;
  strokePoly(ctx, pts);
  ctx.globalAlpha /= 0.55;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = [1, 1.5, 2.5][level - 1];
  strokePoly(ctx, pts);
  if (level >= 3) {
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 1.2;
    strokePoly(ctx, boltPoints(f.x1, f.y1, f.x2, f.y2, 10));
  }
  // 分岐
  for (let b = 0; b < level - 1; b++) {
    const [sx, sy] = pts[1 + Math.floor(Math.random() * (pts.length - 2))];
    const a = Math.random() * Math.PI * 2;
    const l = 8 + Math.random() * 10;
    ctx.strokeStyle = '#f3e5f5';
    ctx.lineWidth = 1;
    strokePoly(ctx, boltPoints(sx, sy, sx + Math.cos(a) * l, sy + Math.sin(a) * l, 3));
  }
}

function drawRing(ctx, f, a) {
  const r = f.r * (1.2 - a * 0.5);
  if (f.element === 'fire') {
    const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
    grad.addColorStop(0, f.level >= 3 ? 'rgba(255,255,255,0.9)' : 'rgba(255,241,118,0.9)');
    grad.addColorStop(0.5, 'rgba(255,145,0,0.7)');
    grad.addColorStop(1, 'rgba(213,0,0,0)');
    circle(ctx, f.x, f.y, r);
    ctx.fillStyle = grad;
    ctx.fill();
    // Lv2 以上は火の粉が飛び散る
    if (f.level >= 2) {
      const n = f.level * 4;
      ctx.strokeStyle = '#ffcc80';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + f.x;
        ctx.moveTo(f.x + Math.cos(ang) * r * 0.7, f.y + Math.sin(ang) * r * 0.7);
        ctx.lineTo(f.x + Math.cos(ang) * r * 1.15, f.y + Math.sin(ang) * r * 1.15);
      }
      ctx.stroke();
    }
    return;
  }
  // 氷：白い霜の輪＋Lv3 は氷の欠片
  circle(ctx, f.x, f.y, r);
  ctx.fillStyle = 'rgba(179,229,252,0.3)';
  ctx.fill();
  ctx.strokeStyle = '#e1f5fe';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (f.level >= 3) {
    ctx.fillStyle = '#e1f5fe';
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const px = f.x + Math.cos(ang) * r, py = f.y + Math.sin(ang) * r;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(ang) * 4, py + Math.sin(ang) * 4);
      ctx.lineTo(px + Math.cos(ang + 1.6) * 2, py + Math.sin(ang + 1.6) * 2);
      ctx.lineTo(px - Math.cos(ang) * 2, py - Math.sin(ang) * 2);
      ctx.lineTo(px + Math.cos(ang - 1.6) * 2, py + Math.sin(ang - 1.6) * 2);
      ctx.fill();
    }
  }
}

function drawEffects(ctx, g) {
  for (const f of g.effects) {
    const a = f.life / f.max;
    ctx.globalAlpha = a;
    if (f.kind === 'ring') drawRing(ctx, f, a);
    else if (f.kind === 'beam') drawBolt(ctx, f);
  }
  ctx.globalAlpha = 1;
}

function drawFloaters(ctx, g) {
  for (const f of g.floaters) {
    ctx.globalAlpha = Math.min(1, f.life / f.max * 2);
    ctx.font = `bold 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

// ---- UI ----

function drawButton(ctx, b) {
  let bg = '#2f3d45';
  if (b.primary) bg = b.disabled ? '#37474f' : '#43a047';
  else if (b.selected) bg = '#546e7a';
  else if (b.id === 'sell') bg = '#6d4c41';
  else if (b.id === 'upgrade' && !b.disabled) bg = '#1565c0';
  roundRect(ctx, b.x, b.y, b.w, b.h, 8);
  ctx.fillStyle = bg;
  ctx.fill();
  if (b.selected) {
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const cx = b.x + b.w / 2;
  ctx.globalAlpha = b.disabled && !b.primary ? 0.45 : 1;
  if (b.tower) {
    const def = TOWERS[b.tower];
    drawFace(ctx, b.tower, cx, b.y + 17, 14);
    text(ctx, def.name, cx, b.y + 38, { size: 12 });
    text(ctx, `${def.cost}G`, cx, b.y + 51, { size: 11, color: '#ffd54f' });
  } else if (b.sub) {
    text(ctx, b.label, cx, b.y + b.h / 2 - 9, { size: 14 });
    text(ctx, b.sub, cx, b.y + b.h / 2 + 11, { size: 11, color: '#cfd8dc', weight: 'normal' });
  } else {
    text(ctx, b.label, cx, b.y + b.h / 2, { size: b.primary ? 15 : 14, color: b.primary && b.disabled ? '#b0bec5' : '#fff' });
  }
  ctx.globalAlpha = 1;
}

function drawHud(ctx, g) {
  ctx.fillStyle = '#1e272e';
  ctx.fillRect(0, 0, VIEW_W, HUD_H);
  text(ctx, '♥', 14, 24, { size: 18, color: '#ef5350' });
  text(ctx, `${g.lives}`, 28, 24, { size: 16, align: 'left' });
  circle(ctx, 84, 24, 7);
  ctx.fillStyle = '#ffd54f';
  ctx.fill();
  text(ctx, `${g.gold}`, 96, 24, { size: 16, align: 'left' });
  text(ctx, `WAVE ${g.wave}/${MAX_WAVE}`, 160, 24, { size: 15, align: 'left', color: '#b0bec5' });
  for (const b of g.getButtons()) if (b.y < HUD_H) drawButton(ctx, b);
}

function drawPanel(ctx, g) {
  ctx.fillStyle = '#1e272e';
  ctx.fillRect(0, PANEL_Y, VIEW_W, VIEW_H - PANEL_Y);
  for (const b of g.getButtons()) if (b.y >= PANEL_Y) drawButton(ctx, b);
}

function drawPaused(ctx) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, MAP_Y, VIEW_W, PANEL_Y - MAP_Y);
  text(ctx, '一時停止中', VIEW_W / 2, MAP_Y + (PANEL_Y - MAP_Y) / 2, { size: 24 });
}

// 選択中タワーの属性・特性を表示（未解放の特性はグレー）
function drawInfo(ctx, g) {
  const type = g.selectedTower ? g.selectedTower.type : g.selectedBuild;
  if (!type) return;
  const def = TOWERS[type];
  const level = g.selectedTower ? g.selectedTower.level : 0;
  const y = PANEL_Y - 58;
  ctx.fillStyle = 'rgba(16,22,26,0.82)';
  ctx.fillRect(0, y, VIEW_W, 58);
  text(ctx, `【${def.element}】${def.name}`, 10, y + 11, { size: 12, align: 'left', color: def.color });
  text(ctx, def.traits[0], 110, y + 11, { size: 12, align: 'left', weight: 'normal' });
  for (let i = 1; i < def.traits.length; i++) {
    const unlocked = level > i;
    text(ctx, `Lv${i + 1}`, 10, y + 11 + i * 17, { size: 11, align: 'left', color: unlocked ? '#ffd54f' : '#78909c' });
    text(ctx, def.traits[i], 40, y + 11 + i * 17, { size: 12, align: 'left', weight: 'normal', color: unlocked ? '#ffffff' : '#78909c' });
  }
}
