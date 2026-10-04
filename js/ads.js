// 広告サービス（プロトタイプ用ダミー）
// リリース時はこのファイルだけを Capacitor + @capacitor-community/admob の実装に差し替える。
// ゲーム側は Ads.showRewarded() / Ads.showInterstitial() だけを呼ぶ。

const INTERSTITIAL_INTERVAL_MS = 90_000; // インタースティシャルの最短表示間隔
let lastInterstitial = 0;

function showDummy(kind, seconds) {
  return new Promise((resolve) => {
    const el = document.getElementById('ad-overlay');
    const label = el.querySelector('.ad-label');
    const btn = el.querySelector('.ad-close');
    label.textContent = kind === 'rewarded' ? 'リワード広告（ダミー）' : 'インタースティシャル広告（ダミー）';
    let left = seconds;
    btn.disabled = true;
    btn.textContent = `${left}`;
    el.classList.remove('hidden');
    const timer = setInterval(() => {
      left--;
      if (left > 0) {
        btn.textContent = `${left}`;
      } else {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = kind === 'rewarded' ? '報酬を受け取る' : '閉じる';
      }
    }, 1000);
    btn.onclick = () => {
      if (btn.disabled) return;
      el.classList.add('hidden');
      resolve(true);
    };
  });
}

export const Ads = {
  async init() {},

  // 最後まで視聴されたら true
  async showRewarded() {
    return showDummy('rewarded', 3);
  },

  async showInterstitial() {
    const now = Date.now();
    if (now - lastInterstitial < INTERSTITIAL_INTERVAL_MS) return;
    lastInterstitial = now;
    await showDummy('interstitial', 2);
  },
};
