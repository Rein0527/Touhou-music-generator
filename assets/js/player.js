// 播放核心 + 資料載入 + queue 管理 + repeat/shuffle
export const STATE = {
  tracks: [],
  queue: [],
  qIndex: 0,
  repeatMode: "off",   // "off" | "one" | "all"
  shuffle: false,
  lastVolume: 1,
};

const audio = document.getElementById("audio");

// 依部署環境推導 base path（個人頁 "/"；專案頁 "/repo/"）
function detectBasePath() {
  // e.g. /Touhou-music-generator/ 或 /
  const p = window.location.pathname;
  // 若是 index.html 結尾，去掉它
  const base = p.replace(/index\.html$/,'');
  // 確保以 / 結尾
  return base.endsWith('/') ? base : base + '/';
}
const PAGE_BASE = detectBasePath();

// 將 tracks.json 的 file 正規化：
// - 以 http(s) 或 // 開頭 → 原樣
// - 以 / 開頭 → 視為絕對（保持）
// - 其它相對路徑（如 music/xxx）→ 加上 PAGE_BASE
function resolveFile(src) {
  if (/^(https?:)?\/\//i.test(src)) return src;
  if (src.startsWith('/')) return src;   // workflow 已經補過 /repo/ 時
  return PAGE_BASE + src.replace(/^\.?\//,'');
}

// 載入 tracks.json（必要）
export async function loadTracks() {
  try {
    const res = await fetch(`${PAGE_BASE}data/tracks.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    const arr = await res.json();
    STATE.tracks = (arr || []).map(t => ({
      ...t,
      file: resolveFile(t.file || t.src || t.url || "")
    }));
  } catch (e) {
    console.warn("load tracks.json failed:", e);
    STATE.tracks = [];
  }
  rebuildQueue();
}

// 建立 queue（支援 shuffle）
export function rebuildQueue() {
  STATE.queue = STATE.tracks.map((_, i) => i);
  if (STATE.shuffle) {
    for (let i = STATE.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [STATE.queue[i], STATE.queue[j]] = [STATE.queue[j], STATE.queue[i]];
    }
  }
  STATE.qIndex = 0;
  updateNowPlayingUI();
}

function currentTrack() {
  const gi = STATE.queue[STATE.qIndex];
  return STATE.tracks[gi];
}

// ---- 播放控制 ----
export async function playCurrent() {
  const t = currentTrack();
  if (!t) return;
  audio.src = t.file;
  try {
    await audio.play();
    updateNowPlayingUI(true);
  } catch (e) {
    console.warn("audio play error:", e);
  }
}
export function pause() {
  audio.pause();
  updateNowPlayingUI(false);
}
export function togglePlay() {
  if (audio.paused) playCurrent(); else pause();
}
export function next() {
  if (STATE.repeatMode === "one") {
    audio.currentTime = 0;
    playCurrent();
    return;
  }
  STATE.qIndex++;
  if (STATE.qIndex >= STATE.queue.length) {
    if (STATE.repeatMode === "all") STATE.qIndex = 0;
    else return;
  }
  playCurrent();
}
export function prev() {
  STATE.qIndex = (STATE.qIndex - 1 + STATE.queue.length) % STATE.queue.length;
  playCurrent();
}
audio.addEventListener("ended", next);

// 音量 / 靜音
export function setVolume(v) {
  audio.volume = Math.max(0, Math.min(1, v));
  if (audio.volume > 0) STATE.lastVolume = audio.volume;
  updateMuteIcon();
}
export function toggleMute() {
  if (audio.volume > 0) {
    STATE.lastVolume = audio.volume;
    setVolume(0);
  } else {
    setVolume(STATE.lastVolume || 1);
  }
}

// UI 更新（播放鍵圖示 / 播放中高亮）
export function updateNowPlayingUI(isPlaying = !audio.paused) {
  const playBtn = document.getElementById("play");
  playBtn.textContent = isPlaying ? "⏸" : "▶";

  const list = document.getElementById("playlistItems");
  if (!list) return;
  const items = list.querySelectorAll("li");
  items.forEach(el => el.classList.remove("active"));
  const gi = STATE.queue[STATE.qIndex];
  const active = list.querySelector(`[data-gi="${gi}"]`);
  if (active) active.classList.add("active");
}
export function updateMuteIcon() {
  const muteBtn = document.getElementById("muteBtn");
  muteBtn.textContent = audio.volume > 0 ? "🔊" : "🔇";
}

// 初始呼叫：由 ui.js 觸發
export async function initPlayer() {
  await loadTracks();
  setVolume(1);
  updateNowPlayingUI(false);
}
