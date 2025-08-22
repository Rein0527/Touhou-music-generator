// 播放核心 + 資料載入 + queue 管理 + repeat/shuffle + Danbooru 背景 + 自動換圖 + 清晰背景 + Media Session
export const STATE = {
  tracks: [],
  queue: [],
  qIndex: 0,
  repeatMode: "off",   // "off" | "one" | "all"
  shuffle: false,
  lastVolume: 1,

  // 背景圖設定（供設定面板讀寫）
  bgEnabled: true,
  bgTag: "touhou",      // 預設主標籤（使用者可改）
  bgRating: "safe",     // safe | sensitive | questionable（safe 會映射到 rating:general）
  bgFit: "contain",     // 預設 contain
  bgIntervalSec: 10,    // 預設 10 秒自動換圖（0=停用）

  // 目前已載入的背景圖（供下載 / Media Session 封面）
  bgSrc: "",
};

const audio = document.getElementById("audio");

// 依部署環境推導 base path（個人頁 "/"；專案頁 "/repo/"）
function detectBasePath() {
  const p = window.location.pathname;
  const base = p.replace(/index\.html$/,'');
  return base.endsWith('/') ? base : base + '/';
}
const PAGE_BASE = detectBasePath();

// 正規化檔案路徑
function resolveFile(src) {
  if (/^(https?:)?\/\//i.test(src)) return src;
  if (src.startsWith('/')) return src;
  return PAGE_BASE + src.replace(/^\.?\//,'');
}

// 目前曲目
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
    if (STATE.bgEnabled) updateDanbooruBackground(t, /*force*/ false);

    // Media Session：更新系統卡片
    updateMediaMetadata();
    updatePlaybackState();
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
  if (audio.volume > 0) { STATE.lastVolume = audio.volume; setVolume(0); }
  else { setVolume(STATE.lastVolume || 1); }
}

// ---- UI 狀態（按鈕圖示、播放清單高亮、標題）----
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

  const titleEl = document.getElementById("trackTitle");
  const t = currentTrack();
  if (titleEl) titleEl.textContent = t ? (t.title || (t.file.split("/").pop() || "—")) : "—";
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

  // 預設背景參數
  applyBgFit();    // contain
  applyBgGlass();  // 顯示圖片時關閉模糊
  setupBgAutoRotate();
  if (STATE.bgEnabled) updateDanbooruBackground();

  // Media Session：註冊一次 action handlers
  registerMediaActionsOnce();
}

/* ===================== 背景（Danbooru） ===================== */

const bg = document.getElementById("bg");
const bgNext = document.getElementById("bgNext");

// rating 對應（safe → general）
function ratingToken(v){
  const map = { safe: "general", sensitive: "sensitive", questionable: "questionable" };
  return map[v] || "general";
}

// ✅ 只產生「<單一主 tag> + rating」，主 tag 由使用者輸入，預設 touhou
function buildTags() {
  const baseRaw = (STATE.bgTag || "touhou").trim();
  // 把空白轉底線，確保只是一個 Danbooru tag（避免多個 tag 觸發 422）
  const base = baseRaw.replace(/\s+/g, "_") || "touhou";
  const rating = `rating:${ratingToken(STATE.bgRating)}`;
  // 僅兩個 tag，並移除任何 random:* 殘留
  return `${base} ${rating}`.replace(/\brandom:\S+\b/gi, "").trim();
}

// ✅ 使用 random=true 當查詢參數（不要用 random:1 當成 tag）
async function fetchDanbooruUrl(tags) {
  const qs = `https://danbooru.donmai.us/posts.json?limit=1&random=true&tags=${encodeURIComponent(tags)}`;
  const res = await fetch(qs, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const arr = await res.json();
  const p = arr && arr[0];
  const candidate = p?.large_file_url || p?.file_url || p?.preview_file_url || p?.source;
  const src = candidate ? (String(candidate).startsWith("http") ? candidate : `https://danbooru.donmai.us${candidate}`) : "";
  return src;
}

let bgSwapping = false;
// force=true 可強制立即換（按鈕「換一張」）
export async function updateDanbooruBackground(track, force = false) {
  if (!STATE.bgEnabled) return;
  if (bgSwapping && !force) return;

  bgSwapping = true;
  try {
    const tags = buildTags(); // 依目前設定產生（預設 touhou + rating；使用者可改 base）
    let src = await fetchDanbooruUrl(tags);

    // 備援：仍然用同一組 <base + rating> 再試一次
    if (!src) src = await fetchDanbooruUrl(buildTags());

    if (src) {
      STATE.bgSrc = src; // ✅ 記住目前背景圖（供下載 / Media Session 封面）
      bgNext.style.backgroundImage = `url("${src}")`;
      bgNext.style.opacity = "1";
      bg.style.opacity = "0";
      setTimeout(() => {
        bg.style.backgroundImage = `url("${src}")`;
        bg.style.opacity = "1";
        bgNext.style.opacity = "0";
        bgSwapping = false;

        // Media Session：封面同步
        updateMediaMetadata();
      }, 850);
    } else {
      bgSwapping = false;
    }
  } catch (e) {
    console.warn("Danbooru 取圖失敗：", e);
    bgSwapping = false;
  }
}

/* ---- 背景填充/玻璃化控制 ---- */
function applyBgFit() {
  document.documentElement.style.setProperty('--bg-fit', STATE.bgFit === 'contain' ? 'contain' : 'cover');
}
function applyBgGlass() {
  // 顯示圖片：遮罩透明、blur=0；不顯示：遮罩恢復、blur=8px
  document.documentElement.style.setProperty('--bg-dim', STATE.bgEnabled ? '0' : '1');
  document.documentElement.style.setProperty('--bg-blur', STATE.bgEnabled ? '0px' : '8px');
}

/* ---- 自動換圖排程（頁面在前景時才輪換） ---- */
let bgTimer = null;
function clearBgTimer(){ if(bgTimer){ clearInterval(bgTimer); bgTimer = null; } }

// ✅ 只有在播放中才會跑自動換圖
function isPlaying() { return !audio.paused && !audio.ended; }

function maybeKickRotate() {
  clearBgTimer();
  const sec = Number(STATE.bgIntervalSec) || 0;
  if (STATE.bgEnabled && sec > 0 && !document.hidden && isPlaying()) {
    bgTimer = setInterval(() => updateDanbooruBackground(currentTrack()), sec * 1000);
  }
}
function setupBgAutoRotate() {
  maybeKickRotate();

  // 分頁前後景切換
  document.addEventListener('visibilitychange', () => {
    // 回到前景且啟用背景且「正在播放」時，強制刷新一次
    if (!document.hidden && STATE.bgEnabled && isPlaying()) {
      updateDanbooruBackground(currentTrack(), /*force*/ true);
    }
    maybeKickRotate();
  });

  // 播放狀態變化 → 控制輪播
  audio.addEventListener('play',  () => { maybeKickRotate(); });
  audio.addEventListener('pause', () => { maybeKickRotate(); });
  audio.addEventListener('ended', () => { maybeKickRotate(); });
}

/* ---- 設定存取（給 ui.js 用） ---- */
export function setBgEnabled(v){ STATE.bgEnabled = !!v; applyBgGlass(); if (v) updateDanbooruBackground(currentTrack(), true); }
export function setBgTag(tag){ STATE.bgTag = String(tag || "").trim() || "touhou"; } // 使用者可改；buildTags 會處理成單一 tag
export function setBgRating(r){ STATE.bgRating = (["safe","sensitive","questionable"].includes(r)) ? r : "safe"; }
export function setBgFit(v){ STATE.bgFit = (v === "contain") ? "contain" : "cover"; applyBgFit(); }
export function setBgInterval(sec){ STATE.bgIntervalSec = Math.max(0, Number(sec) || 0); maybeKickRotate(); }
export function getBgSettings(){
  return {
    enabled: STATE.bgEnabled,
    tag: STATE.bgTag,
    rating: STATE.bgRating,
    fit: STATE.bgFit,
    interval: STATE.bgIntervalSec,
  };
}

// ✅ 下載目前背景圖
export async function downloadCurrentBg() {
  try {
    const src = STATE.bgSrc;
    if (!src) throw new Error("目前沒有背景圖可以下載");

    // 產生檔名
    const url = new URL(src, window.location.href);
    const nameGuess = url.pathname.split("/").pop() || "danbooru.jpg";
    const fileName = nameGuess.split("?")[0] || "danbooru.jpg";

    // 優先以 blob 下載（跨網域更穩）
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) throw new Error(`下載失敗：${res.status} ${res.statusText}`);
    const blob = await res.blob();

    const a = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.warn(err);
    // CORS 報錯時退而求其次：直接開新視窗，讓使用者另存
    if (STATE.bgSrc) window.open(STATE.bgSrc, "_blank");
  }
}

/* ===================== Media Session（系統層控制） ===================== */

function mediaSessionSupported(){
  return 'mediaSession' in navigator;
}

function updateMediaMetadata(){
  if (!mediaSessionSupported()) return;
  try{
    const t = currentTrack() || {};
    const title  = t.title || (t.file ? t.file.split('/').pop() : '—');
    const artist = t.artist || 'Touhou Player';
    const artSrc = STATE.bgSrc || '';
    const artwork = artSrc ? [
      { src: artSrc, sizes: '256x256', type: 'image/jpeg' },
      { src: artSrc, sizes: '512x512', type: 'image/jpeg' },
    ] : [];
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: '', artwork });
  }catch{}
}

function updatePlaybackState(){
  if (!mediaSessionSupported()) return;
  try{
    navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
    const duration = isFinite(audio.duration) ? audio.duration : 0;
    const position = isFinite(audio.currentTime) ? audio.currentTime : 0;
    const rate = audio.playbackRate || 1;
    if (navigator.mediaSession.setPositionState) {
      navigator.mediaSession.setPositionState({ duration, position, playbackRate: rate });
    }
  }catch{}
}

function registerMediaActionsOnce(){
  if (!mediaSessionSupported() || registerMediaActionsOnce._done) return;
  registerMediaActionsOnce._done = true;

  try{
    navigator.mediaSession.setActionHandler('play',  async ()=>{ try{ await audio.play(); }catch{} });
    navigator.mediaSession.setActionHandler('pause',       ()=>{ audio.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack',()=>{ prev(); });
    navigator.mediaSession.setActionHandler('nexttrack',    ()=>{ next(); });

    navigator.mediaSession.setActionHandler('seekto', (d)=>{
      if (d?.seekTime != null) {
        audio.currentTime = Math.max(0, Math.min(audio.duration||0, d.seekTime));
      }
      updatePlaybackState();
    });
    navigator.mediaSession.setActionHandler('seekbackward', (d)=>{
      const s = d?.seekOffset || 5; audio.currentTime = Math.max(0, audio.currentTime - s); updatePlaybackState();
    });
    navigator.mediaSession.setActionHandler('seekforward',  (d)=>{
      const s = d?.seekOffset || 5; audio.currentTime = Math.min(audio.duration||0, audio.currentTime + s); updatePlaybackState();
    });
  }catch{}
}

// 與播放器事件同步系統卡片狀態
audio.addEventListener('play',           ()=>{ updatePlaybackState(); });
audio.addEventListener('pause',          ()=>{ updatePlaybackState(); });
audio.addEventListener('timeupdate',     ()=>{ updatePlaybackState(); });
audio.addEventListener('durationchange', ()=>{ updatePlaybackState(); });

export { audio, PAGE_BASE };
