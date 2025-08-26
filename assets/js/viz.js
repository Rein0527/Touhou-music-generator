// assets/js/viz.js
// 只顯示「圓形播放進度條」的版本（移除等化條與 glow）
// ES Module

const audio = document.getElementById('audio');
const canvas = document.getElementById('viz');
const ctx = canvas.getContext('2d', { alpha: true });

/** 基本設定 */
const CFG = {
  ringWidth: 12,             // 進度圈粗細
  ringBgAlpha: 0.18,         // 背景圈透明度
  ringPadding: 18,           // 與畫面邊界的留白
  dprLimit: 2,               // 最大像素密度，避免過度渲染
  fpsWhenIdle: 24,           // 暫停時的重繪頻率（省電）
};

/** 取得主題色（--accent），若無則給預設值 */
function getAccent() {
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim();
  return val || '#6da8ff';
}

/** resize：依視窗與 DPR 調整畫布 */
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, CFG.dprLimit);
  const w = canvas.clientWidth || 1200;
  const h = canvas.clientHeight || 1200;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', resize);

/** 繪製邏輯（只畫圓形進度） */
function draw() {
  const w = canvas.clientWidth || 1200;
  const h = canvas.clientHeight || 1200;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;

  // 讓圓半徑隨畫布自適應
  const ring = Math.max(
    40,
    Math.min(w, h) / 2 - CFG.ringPadding - CFG.ringWidth
  );

  // 播放進度 (0~1)
  const d = audio?.duration || 0;
  const ct = audio?.currentTime || 0;
  const p = d > 0 ? (ct / d) : 0;

  // 以 12 點方向為起點，順時針
  const start = -Math.PI / 2;
  const end = start + p * Math.PI * 2;

  // 背景圈
  ctx.strokeStyle = `rgba(255,255,255,${CFG.ringBgAlpha})`;
  ctx.lineWidth = CFG.ringWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, ring, 0, Math.PI * 2);
  ctx.stroke();

  // 進度圈（主題色）
  ctx.strokeStyle = getAccent();
  ctx.beginPath();
  ctx.arc(cx, cy, ring, start, end, false);
  ctx.stroke();
}

/** 動畫迴圈：播放中全速；暫停時降 FPS 省資源 */
let rafId = null;
let idleTimer = 0;
function loop(ts) {
  const playing = !!(audio && !audio.paused && !audio.ended);
  if (playing) {
    draw();
    idleTimer = 0;
    rafId = requestAnimationFrame(loop);
  } else {
    // 非播放狀態：降頻重繪
    const interval = 1000 / CFG.fpsWhenIdle;
    if (!idleTimer) idleTimer = ts;
    if (ts - idleTimer >= interval) {
      draw();
      idleTimer = ts;
    }
    rafId = requestAnimationFrame(loop);
  }
}
rafId = requestAnimationFrame(loop);

/** 當來源切換或時間改變時，也能即時刷新一次 */
['timeupdate', 'durationchange', 'loadedmetadata', 'seeked']
  .forEach(evt => audio?.addEventListener(evt, draw));

/** 清理（若你的 router 會卸載頁面時可用） */
export function disposeViz() {
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', resize);
  ['timeupdate','durationchange','loadedmetadata','seeked']
    .forEach(evt => audio?.removeEventListener(evt, draw));
}
