// 播放核心 + 資料載入 + queue 管理 + repeat/shuffle + Danbooru 背景（預載）+ 自動換圖 + 清晰背景
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

  // 目前已載入的背景圖（供下載）
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
    // 首次播放時，若啟用背景 → 確保有預載，並在預載完成後「按排程」切換
    if (STATE.bgEnabled) {
      await ensurePreload(); // 不阻塞切換計時；只是確保 pipeline 在跑
    }
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

  if (STATE.bgEnabled) {
    // 一開始就預載第一張，載好後立刻顯示（不等計時，避免空白）
    await preloadNext(true);
    await swapToNext(/*immediate*/true);
  }
}

/* ===================== 背景（Danbooru，含預載/按時切換） ===================== */

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

// ---------- 預載管線 ----------
let preloading = null;          // Promise<{src, img}> | null
let nextReady = null;           // {src, img} | null
let bgSwapping = false;         // 正在做淡入淡出
let bgTimer = null;             // setInterval handler
let lastSwapAt = 0;             // 上次實際切換時間戳

async function preloadNext(forceNew = false) {
  if (!STATE.bgEnabled) return null;
  if (!forceNew && (nextReady || preloading)) return preloading || Promise.resolve(nextReady);

  const tags = buildTags();
  preloading = (async () => {
    let src = await fetchDanbooruUrl(tags);
    if (!src) src = await fetchDanbooruUrl(buildTags()); // 備援：同一組條件再試一次
    if (!src) return null;

    const img = new Image();
    img.decoding = "async";
    // 為了之後可能需要下載 blob，先帶 CORS；失敗也不影響背景顯示
    try { img.crossOrigin = "anonymous"; } catch {}

    const loaded = await new Promise((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
    if (!loaded) return null;

    return { src, img };
  })();

  const result = await preloading.catch(() => null);
  nextReady = result || null;
  preloading = null;
  return nextReady;
}

async function ensurePreload() {
  if (!nextReady && !preloading) await preloadNext(false);
}

async function swapToNext(immediate = false) {
  if (!STATE.bgEnabled) return;
  if (bgSwapping) return;
  if (!nextReady) await ensurePreload();
  if (!nextReady) return; // 還是沒有就先放著，下個 tick 再試

  const { src } = nextReady;

  // 寫到 bgNext，等它完全 ready（事實上已 onload）→ 做 600ms 淡入
  bgSwapping = true;
  STATE.bgSrc = src;
  bgNext.style.backgroundImage = `url("${src}")`;
  // 如果是初始化第一張或手動「換一張」，允許立刻切（immediate=true）
  if (immediate) {
    bgNext.style.opacity = "1";
    bg.style.opacity = "0";
  } else {
    // 照 CSS 600ms 動畫做切換
    bgNext.style.opacity = "1";
    bg.style.opacity = "0";
  }

  // 對齊 CSS 過場 600ms，多留 50ms buffer
  setTimeout(() => {
    bg.style.backgroundImage = `url("${src}")`;
    bg.style.opacity = "1";
    bgNext.style.opacity = "0";
    bgSwapping = false;
    lastSwapAt = Date.now();
  }, 650);

  // 立刻預載下一張，讓下一次到點可以秒切
  nextReady = null;
  ensurePreload();
}

// 供 UI 調用：
// - force=true：立刻抓新圖並在載好後「立即」切換（忽略排程時間）
// - force=false（預設）：只確保 pipeline 在跑，到點再切
export async function updateDanbooruBackground(track, force = false) {
  if (!STATE.bgEnabled) return;
  if (force) {
    await preloadNext(true);
    await swapToNext(/*immediate*/true);
  } else {
    ensurePreload();
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

/* ---- 自動換圖排程（頁面在前景 + 正在播放時才輪換；到點才切） ---- */
function clearBgTimer(){ if(bgTimer){ clearInterval(bgTimer); bgTimer = null; } }

// ✅ 只有在播放中才會跑自動換圖
function isPlaying() { return !audio.paused && !audio.ended; }

function maybeKickRotate() {
  clearBgTimer();
  const sec = Number(STATE.bgIntervalSec) || 0;
  if (STATE.bgEnabled && sec > 0 && !document.hidden && isPlaying()) {
    ensurePreload(); // 確保下一張在下載
    // 以固定間隔觸發「嘗試切換」。如果圖片尚未載好，會延後到載好後的下一個 tick。
    bgTimer = setInterval(async () => {
      if (!nextReady) {
        // 還沒載好 → 補啟預載，這次先略過，等下個 tick
        ensurePreload();
        return;
      }
      await swapToNext(/*immediate*/false);
    }, sec * 1000);
  }
}

function setupBgAutoRotate() {
  maybeKickRotate();

  // 分頁前後景切換：回到前景「不強制切」，只重啟排程與預載
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && STATE.bgEnabled && isPlaying()) {
      ensurePreload();
    }
    maybeKickRotate();
  });

  // 播放狀態變化 → 控制輪播
  audio.addEventListener('play',  () => { ensurePreload(); maybeKickRotate(); });
  audio.addEventListener('pause', () => { maybeKickRotate(); });
  audio.addEventListener('ended', () => { maybeKickRotate(); });
}

/* ---- 設定存取（給 ui.js 用） ---- */
export function setBgEnabled(v){
  STATE.bgEnabled = !!v;
  applyBgGlass();
  if (v) {
    // 開啟時：預載並立刻顯示一張，避免空白
    (async () => { await preloadNext(true); await swapToNext(true); maybeKickRotate(); })();
  } else {
    clearBgTimer();
  }
}
export function setBgTag(tag){ STATE.bgTag = String(tag || "").trim() || "touhou"; nextReady=null; preloading=null; ensurePreload(); }
export function setBgRating(r){ STATE.bgRating = (["safe","sensitive","questionable"].includes(r)) ? r : "safe"; nextReady=null; preloading=null; ensurePreload(); }
export function setBgFit(v){ STATE.bgFit = (v === "contain") ? "contain" : "cover"; applyBgFit(); }
export function setBgInterval(sec){
  STATE.bgIntervalSec = Math.max(0, Number(sec) || 0);
  maybeKickRotate();
}
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

export { audio, PAGE_BASE };
