// エントリポイント：Canvas のスケーリング、入力、ゲームループ、DOM オーバーレイ
import { Game } from './game.js';
import { render } from './render.js';
import { VIEW_W, VIEW_H, MAX_WAVE, REVIVE_LIVES } from './config.js';
import { Ads } from './ads.js';

const BEST_KEY = 'td.bestWave';

const stage = document.getElementById('stage');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const screenEl = document.getElementById('screen');
const toastEl = document.getElementById('toast');

let running = false;
let toastTimer = null;

const game = new Game({
  onWaveStart: hideToast,
  onWaveCleared: (wave, bonus) => {
    saveBest(wave);
    showToast(`ウェーブ ${wave} クリア！ +${bonus}G`, {
      label: '📺 広告でボーナス2倍',
      onClick: async () => {
        hideToast();
        if (await Ads.showRewarded()) {
          game.gold += bonus;
          game.floater(VIEW_W / 2, 300, `ボーナス +${bonus}G`, '#ffd54f');
        }
      },
    });
  },
  onGameOver: () => {
    hideToast();
    saveBest(game.wave - 1);
    const buttons = [];
    if (!game.reviveUsed) {
      buttons.push({
        label: `📺 広告を見て復活（ライフ+${REVIVE_LIVES}）`, cls: 'ad',
        onClick: async () => {
          hideScreen();
          if (await Ads.showRewarded()) game.revive();
          else game.hooks.onGameOver();
        },
      });
    }
    buttons.push({ label: 'もう一度', cls: buttons.length ? 'sub' : '', onClick: restart });
    showScreen('ゲームオーバー', `ウェーブ ${game.wave} で突破されました<br>撃破数 ${game.kills}`, buttons);
  },
  onVictory: () => {
    hideToast();
    saveBest(MAX_WAVE);
    showScreen('クリア！', `全 ${MAX_WAVE} ウェーブを守り抜きました<br>残りライフ ${game.lives} / 撃破数 ${game.kills}`, [
      { label: 'もう一度', onClick: restart },
    ]);
  },
});

// ---- 画面サイズ ----

function resize() {
  const scale = Math.min(stage.clientWidth / VIEW_W, stage.clientHeight / VIEW_H);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${VIEW_W * scale}px`;
  canvas.style.height = `${VIEW_H * scale}px`;
  canvas.width = Math.round(VIEW_W * scale * dpr);
  canvas.height = Math.round(VIEW_H * scale * dpr);
  ctx.setTransform(canvas.width / VIEW_W, 0, 0, canvas.height / VIEW_H, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ---- 入力 ----

function toLocal(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * VIEW_W, y: ((e.clientY - r.top) / r.height) * VIEW_H };
}
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!running) return;
  canvas.setPointerCapture(e.pointerId); // ドラッグ中に指が canvas 外へ出ても追従する
  const p = toLocal(e);
  game.pointerDown(p.x, p.y, e.pointerType !== 'mouse');
});
canvas.addEventListener('pointermove', (e) => {
  if (!running || (e.pointerType !== 'mouse' && !game.drag)) return;
  const p = toLocal(e);
  game.pointerMove(p.x, p.y);
});
canvas.addEventListener('pointerup', () => game.pointerUp());
canvas.addEventListener('pointercancel', () => game.cancelDrag());
canvas.addEventListener('pointerleave', () => {
  if (!game.drag) game.setHover(null);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running && game.state === 'wave') game.paused = true;
});

// ---- ループ ----

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (running) for (let i = 0; i < game.speed; i++) game.update(dt);
  render(ctx, game);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- DOM オーバーレイ ----

function showScreen(title, html, buttons) {
  screenEl.querySelector('h1').textContent = title;
  screenEl.querySelector('p').innerHTML = html;
  const box = screenEl.querySelector('.buttons');
  box.replaceChildren();
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = `btn ${b.cls || ''}`;
    el.textContent = b.label;
    el.onclick = b.onClick;
    box.appendChild(el);
  }
  screenEl.classList.remove('hidden');
}

function hideScreen() {
  screenEl.classList.add('hidden');
}

function showToast(message, action) {
  clearTimeout(toastTimer);
  toastEl.replaceChildren();
  const span = document.createElement('span');
  span.textContent = message;
  toastEl.appendChild(span);
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.onclick = action.onClick;
    toastEl.appendChild(btn);
  }
  toastEl.classList.remove('hidden');
  toastTimer = setTimeout(hideToast, 8000);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastEl.classList.add('hidden');
}

function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(wave) {
  try {
    if (wave > loadBest()) localStorage.setItem(BEST_KEY, String(wave));
  } catch {
    // ストレージが使えない環境では記録しない
  }
}

function start() {
  hideScreen();
  game.reset();
  running = true;
}

async function restart() {
  hideScreen();
  await Ads.showInterstitial();
  start();
}

function showTitle() {
  const best = loadBest();
  showScreen(
    'ロード・ガード',
    `敵の侵攻から ${MAX_WAVE} ウェーブ守り抜け！<br>下のキャラを草地へドラッグして設置。<br>タワーをタップで強化・売却。${best ? `<br><br>ベスト：ウェーブ ${best}` : ''}`,
    [{ label: 'スタート', onClick: start }],
  );
}

// ローカル開発時のみデバッグ用に公開
if (location.hostname === 'localhost') window.__game = game;

Ads.init();
showTitle();
