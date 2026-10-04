# ロード・ガード（仮） — タワーディフェンス プロトタイプ

HTML5 Canvas + 素の JavaScript（ビルド不要）。後で Capacitor でラップして Android / iOS アプリ化し、AdMob を組み込む想定。

## 動かし方

```bash
python3 -m http.server 8765 --directory www
```

ブラウザで http://localhost:8765 を開く（スマホ実機は同じ Wi-Fi で `http://<MacのIP>:8765`）。

## 公開（GitHub Pages）

- 公開URL: https://maplemadosaku-gif.github.io/tower-defense/
- ソースは `develop` ブランチ、公開されるのは `www/` の中身だけを置いた `gh-pages` ブランチ（main は使わない）
- 更新するときは develop にコミットしてから:

```bash
./tools/deploy.sh
```

## 構成

| ファイル | 役割 |
| --- | --- |
| `www/js/config.js` | 定数・タワー/敵の性能・ウェーブ生成（**バランス調整はここ**） |
| `www/js/game.js` | ゲームロジック（描画・DOM 非依存） |
| `www/js/render.js` | Canvas 描画 |
| `www/js/main.js` | 起動・画面スケーリング・入力・ループ・タイトル/結果画面 |
| `www/js/ads.js` | 広告のダミー実装（リリース時に AdMob 実装へ差し替え） |
| `www/assets/sprites/*.png` | キャラクタースプライト（横：下・左・上・右向き／縦：待機・詠唱・発動、1コマ 64×122） |
| `art/characters_source.webp` | スプライトの元画像（キャラ設定シート） |
| `tools/extract_sprites.py` | 元画像からスプライトを切り出して背景透過する |

元画像を差し替えたときのスプライト再生成（Pillow と numpy が必要）：

```bash
python3 tools/extract_sprites.py art/characters_source.webp
```

論理解像度は 360×640（縦持ち）で、画面サイズに合わせて拡大縮小。

## 現在の仕様

- タワー 4 種（属性ごとに Lv2 / Lv3 で特性が解放される）

  | 属性 | タワー | 基本 | Lv2 | Lv3 |
  | --- | --- | --- | --- | --- |
  | 風 | ウィンド | 速射・単体 | 2体同時攻撃 | 3体同時＋20%ノックバック |
  | 火 | ファイア | 高威力の範囲（CT長め） | 燃焼（3秒の持続ダメージ） | 燃焼強化（4秒）＋爆発範囲拡大 |
  | 氷 | アイス | 範囲減速 50% | 減速 60% | 15%で1秒凍結 |
  | 雷 | サンダー | 長射程・即着弾 | 近くの敵2体へ連鎖 | 連鎖3体＋0.4秒感電 |

  ボスは凍結・感電・ノックバック無効。単一属性だと後半で押し切られ、組み合わせると突破できるバランス。
- 強化 Lv3 まで、売却は投資額の 70% 返却
- 敵 4 種：通常／高速／重装／ボス（5 ウェーブ毎）、7 ウェーブ毎に高速ラッシュ
- 全 20 ウェーブ、x2 倍速、一時停止、ベスト記録（localStorage）
- 広告ポイント（ダミー）
  - リワード：ウェーブクリアボーナス 2 倍
  - リワード：ゲームオーバー時に 1 回だけ復活（ライフ +10）
  - インタースティシャル：リトライ時（90 秒に 1 回まで）

## リリースまでのロードマップ

1. **ゲーム性を詰める**：マップ複数化・ステージ選択、タワー/敵の追加、効果音・BGM、グラフィック差し替え
2. **Node.js 導入 → Capacitor 化**
   ```bash
   npm init -y
   npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
   npx cap init "ロード・ガード" com.example.roadguard --web-dir www
   npx cap add android && npx cap add ios
   ```
3. **AdMob 組み込み**：`@capacitor-community/admob` を入れて `ads.js` の中身を差し替える（ゲーム側のコードは変更不要）
   - 開発中は必ず Google 公式の**テスト広告ユニット ID** を使う（本番 ID で自分でタップすると BAN リスク）
   - 本番の App ID / 広告ユニット ID はソースに直書きせず設定ファイルで管理
   - EU 向けには UMP（同意管理）、iOS は ATT（トラッキング許可ダイアログ）対応が必要
4. **ストア申請**：Google Play Console（登録 $25）/ Apple Developer Program（年 $99）、プライバシーポリシー URL、広告ありの申告
