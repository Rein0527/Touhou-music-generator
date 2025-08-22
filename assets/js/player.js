// 播放核心 + 資料載入 + queue 管理 + repeat/shuffle + 背景圖管理
export const STATE = {
  tracks: [],
  queue: [],
  qIndex: 0,
  repeatMode: "off",   // "off" | "one" | "all"
  shuffle: false,
  lastVolume: 1,

  // 背景圖
  bgEnabled: true,
  bgTag: "touhou rating:safe",
};

const audio = document.getElementById("audio");

// 依部署環境推導 base path（個人頁 "/"；專案頁 "/repo/"）
function detectBasePath() {
  const p = window.location.pathname;
  const base = p.replace(/index\.html$/,'');
  return base.endsWith('/') ? base : base + '/';
}
const PAGE_BASE = detectBasePath();

// 將 tracks.json 的 file 正規化
function resolveFile(src) {
  if (/^(https?:)?\/\//i.test(src)) return src;
  if (src.startsWith('/')) return src;   // 如果 workflow 已補過 /repo/
  return PAGE_BASE + src.replace(/^\.?\//,'');
}

// 取得目前曲目
export function currentTrack() {
  const gi = STATE.queue[STATE.qIndex];
  return STATE.tracks[gi];
}

// 載入 tracks.json（必要）
export async function loadTracks() {
  try {
    const res = await fetch(`${PAGE_BASE}data/tracks.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    const arr = await res.json();
    STATE.tracks = (arr || []).map(t => ({
      ...t,
      title: t.title || t.name || (t.file || t.src || "").split("/").pop(),
      artist: t.artist || "",
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

// ---- 播放控制 ----
export async function playCurrent() {
  const t = currentTrack();
  if (!t) return;
  audio.src = t.file;
  try {
    await audio.play();
    updateNowPlayingUI(true);
    if (STATE.bgEnabled) updateDanbooruBackground(t);
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
  const nv = Math.max(0, Math.min(1, v));
  audio.volume = nv;
  if (nv > 0) STATE.lastVolume = nv;
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

// ---- UI 更新（播放鍵 / 播放中高亮 / 時間） ----
export function updateNowPlayingUI(isPlaying = !audio.paused) {
  const playBtn = document.getElementById("play");
  if (playBtn) playBtn.textContent = isPlaying ? "⏸" : "▶";

  const list = document.getElementById("playlistItems");
  const gi = STATE.queue[STATE.qIndex];
  if (list) {
    const items = list.querySelectorAll("li");
    items.forEach(el => el.classList.remove("active"));
    const active = list.querySelector(`[data-gi="${gi}"]`);
    if (active) active.classList.add("active");
  }

  // 時間 / 進度（由 ui.js 讀 audio 做顯示與拖曳，此處不處理）
}
export function updateMuteIcon() {
  const muteBtn = document.getElementById("muteBtn");
  if (muteBtn) muteBtn.textContent = (audio.volume > 0) ? "🔊" : "🔇";
}

// 初始呼叫：由 ui.js 觸發
export async function initPlayer() {
  await loadTracks();
  setVolume(1);
  updateNowPlayingUI(false);
  if (STATE.bgEnabled) updateDanbooruBackground();
}

/* ---------------- Danbooru 背景 ---------------- */
const bg = document.getElementById("bg");
const bgNext = document.getElementById("bgNext");

async function fetchDanbooruUrl(tags) {
  const qs = `https://danbooru.donmai.us/posts.json?limit=1&random=true&tags=${encodeURIComponent(tags)}`;
  const res = await fetch(qs, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const arr = await res.json();
  const p = arr && arr[0];
  // 優先使用大圖，其次原圖，再次預覽
  const src = p?.large_file_url || p?.file_url || p?.preview_file_url || p?.source;
  return src ? (src.startsWith("http") ? src : `https://danbooru.donmai.us${src}`) : "";
}

let bgSwapping = false;
export async function updateDanbooruBackground(track) {
  if (!STATE.bgEnabled || bgSwapping) return;
  bgSwapping = true;
  try {
    // 以 tag 為主；如果有曲名，嘗試加上關鍵字以提高關聯度
    let tag = STATE.bgTag || "touhou rating:safe";
    if (track?.title) tag = `${track.title.replace(/\s+/g,"_")} ${tag}`;
    let src = await fetchDanbooruUrl(tag);
    if (!src) src = await fetchDanbooruUrl(STATE.bgTag || "touhou rating:safe");

    if (src) {
      bgNext.style.backgroundImage = `url("${src}")`;
      bgNext.style.opacity = "1";
      bg.style.opacity = "0";
      setTimeout(() => {
        bg.style.backgroundImage = `url("${src}")`;
        bg.style.opacity = "1";
        bgNext.style.opacity = "0";
        bgSwapping = false;
      }, 850);
    } else {
      bgSwapping = false; // 沒有取到就略過
    }
  } catch (e) {
    console.warn("Danbooru 取圖失敗：", e);
    bgSwapping = false;
  }
}

// 提供 UI 存取設定
export function setBgEnabled(v){ STATE.bgEnabled = !!v; }
export function setBgTag(tag){ STATE.bgTag = String(tag || "").trim() || "touhou rating:safe"; }
export function getBgSettings(){ return { enabled: STATE.bgEnabled, tag: STATE.bgTag }; }

// 匯出 audio 供 ui.js 使用
export { audio, PAGE_BASE };
