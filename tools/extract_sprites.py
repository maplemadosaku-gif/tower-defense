"""キャラクター設定画像からスプライトを切り出し、背景を透過して www/assets/sprites/ に書き出す。

使い方（Pillow と numpy が必要）:
    python3 tools/extract_sprites.py art/characters_source.webp

出力: <属性>.png … 横 4 列（下・左・上・右向き）× 縦 3 行（待機・詠唱・発動）、1 コマ CELL_W x CELL_H
元画像のレイアウトが変わったら COLS / ROWS を調整する。
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

# 各キャラのセル境界 x 座標（左端〜右端の 5 本）
COLS = {
    'fire': [28, 89, 152, 214, 277],
    'wind': [310, 371, 433, 495, 558],
    'ice': [591, 652, 714, 776, 839],
    'thunder': [872, 933, 995, 1057, 1120],
}
# 待機・詠唱・発動 行の境界 y 座標
ROWS = [416, 515, 614, 736]
CELL_W, CELL_H = 64, 122
INSET = 2  # 罫線を避けるために内側へ削る px

BG_TOL = 34        # 背景とみなす色差
EDGE_TOL = 90      # 輪郭のにじみを半透明化する色差
SHADOW_SAT = 0.07  # 足元の影（低彩度のグレー）とみなす彩度


def color_to_alpha(px, bg):
    """背景色 bg を透過に変換（GIMP の color-to-alpha と同じ考え方）"""
    px = px.astype(float)
    bg = bg.astype(float)
    up = np.where(px > bg, (px - bg) / np.maximum(255 - bg, 1), 0)
    down = np.where(px < bg, (bg - px) / np.maximum(bg, 1), 0)
    alpha = np.clip(np.max(np.maximum(up, down), axis=-1), 0, 1)
    a = np.maximum(alpha, 1e-6)[..., None]
    fg = np.clip((px - (1 - a) * bg) / a, 0, 255)
    return fg, alpha


def cut_cell(img, x0, y0, x1, y1):
    cell = img[y0 + INSET:y1 - INSET, x0 + INSET:x1 - INSET, :3].astype(float)
    h, w, _ = cell.shape
    border = np.concatenate([cell[0], cell[-1], cell[:, 0], cell[:, -1]])
    bg = np.median(border, axis=0)
    diff = np.abs(cell - bg).max(axis=-1)
    mx, mn = cell.max(axis=-1), cell.min(axis=-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    lum = cell.mean(axis=-1)
    bg_like = (diff < BG_TOL) | ((sat < SHADOW_SAT) & (lum > 140) & (lum < bg.mean()))

    # 外周から背景らしい画素を塗りつぶして背景領域を求める
    region = np.zeros((h, w), bool)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if bg_like[y, x]:
                region[y, x] = True
                q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if bg_like[y, x] and not region[y, x]:
                region[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and not region[ny, nx] and bg_like[ny, nx]:
                region[ny, nx] = True
                q.append((ny, nx))

    # 背景領域に接する輪郭のにじみも半透明化の対象にする
    near = np.zeros_like(region)
    near[1:] |= region[:-1]
    near[:-1] |= region[1:]
    near[:, 1:] |= region[:, :-1]
    near[:, :-1] |= region[:, 1:]
    soft = region | (near & (diff < EDGE_TOL))

    fg, alpha = color_to_alpha(cell, bg)
    out_rgb = np.where(soft[..., None], fg, cell)
    out_a = np.where(soft, alpha, 1.0)
    out_a[region & (diff < BG_TOL * 0.5)] = 0  # ほぼ背景色は完全透過
    rgba = np.dstack([out_rgb, out_a * 255]).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else 'art/characters_source.webp')
    out_dir = Path(__file__).resolve().parent.parent / 'www' / 'assets' / 'sprites'
    out_dir.mkdir(parents=True, exist_ok=True)
    img = np.asarray(Image.open(src).convert('RGBA'))
    for name, xs in COLS.items():
        sheet = Image.new('RGBA', (CELL_W * 4, CELL_H * 3), (0, 0, 0, 0))
        for r in range(3):
            for c in range(4):
                frame = cut_cell(img, xs[c], ROWS[r], xs[c + 1], ROWS[r + 1])
                # 上揃え・左右中央で 1 コマに配置
                sheet.paste(frame, (c * CELL_W + (CELL_W - frame.width) // 2, r * CELL_H), frame)
        sheet.save(out_dir / f'{name}.png', optimize=True)
        print('wrote', out_dir / f'{name}.png')


if __name__ == '__main__':
    main()
