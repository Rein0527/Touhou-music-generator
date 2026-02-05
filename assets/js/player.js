// 播放核心 + 資料載入 + queue 管理 + repeat/shuffle + Danbooru 背景（預載）+ 自動換圖 + 清晰背景
export const STATE = {
  tracks: [],
  queue: [],
  qIndex: 0,
  repeatMode: "off",   // "off" | "one" | "all"
  shuffle: true,       // 預設開啟隨機播放
  lastVolume: 1,

  // ✅ 視覺化特效（等化器）開關：預設關閉，由右下設定控制
  vizEnabled: false,

  // 背景圖設定（供設定面板讀寫）
  bgEnabled: true,
  bgTag: "touhou",      // 全域預設主標籤（可被單曲覆寫）
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
  return base.endsWith('/') ? base : base + বিব '/';
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

// 載入 tracks.json（必要） + 併入 data/tags.json（可選）
export async function loadTracks() {
  try {
    const res = await fetch(`${PAGE_BASE}data/tracks.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    const arr = await res.json();

    let tracks = (arr || []).map(t => ({
      ...t,
      title: t.title || t.name || (t.file || t.src || "").split("/").pop(),
      artist: t.artist || "",
      file: resolveFile(t.file || t.src || t.url || "")
    }));

    // 讀取覆寫表 data/tags.json（若不存在就跳過）
    try {
      const tagRes = await fetch(`${PAGE_BASE}data/tags.json`, { cache: "no-store" });
      if (tagRes.ok) {
        const tagMap = await tagRes.json();
        tracks = tracks.map(tr => {
          const f = tr.file || "";
          // 先完整鍵匹配
          let ov = tagMap[f];
          if (!ov) {
            // 完整鍵不在 → 嘗試片段包含匹配（允許你只寫檔名或資料夾關鍵字）
            for (const k of Object.keys(tagMap)) {
              if (k && f.includes(k)) { ov = tagMap[k]; break; }
            }
          }
          return ov ? { ...tr, ...ov } : tr; // 例如 { bgTag: "flandre_scarlet" }
        });
      }
    } catch (e) {
      console.warn("load tags.json failed:", e);
    }

    STATE.tracks = tracks;
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

  // 只有在曲目真的改變時才指定 src，避免續播時從 0 秒開始
  const cur = audio.src || "";
  const want = new URL(t.file, window.location.href).href;
  const changed = (cur !== want);
  if (changed) audio.src = t.file;

  try {
    await audio.play();
    updateNowPlayingUI(true);

    // 只有換歌時才重置背景預載並以該曲的 tag 強制刷新
    if (STATE.bgEnabled && changed) {
      nextReady = null; preloading = null;
      await updateDanbooruBackground(t, /*force*/ true);
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
  if (!audio.src) { playCurrent(); return; }
  if (audio.paused) { audio.play(); updateNowPlayingUI(true); }
  else { pause(); }
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
  if (playBtn) {
    // ✅ SVG 版：用 class 控制顯示 play/pause
    playBtn.classList.toggle("playing", !!isPlaying);
  }

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
  if (muteBtn) {
    // ✅ SVG 版：用 class 控制顯示喇叭/靜音
    muteBtn.classList.toggle("muted", !(audio.volume > 0));
  }
}

// 初始呼叫：由 ui.js 觸發
export async function initPlayer() {
  await loadTracks();
  setVolume(1);
  updateNowPlayingUI(false);

  applyBgFit();
  applyBgGlass();
  setupBgAutoRotate();

  if (STATE.bgEnabled) {
    await preloadNext(true, currentTrack() ?? null);
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

// 產生查詢字串：優先使用「曲目覆寫的 bgTag」，否則退回全域 STATE.bgTag；並加上 rating
function buildTags(track) {
  const tagRaw = (track?.bgTag ?? STATE.bgTag ?? "touhou").trim();
  const base = tagRaw.replace(/\s+/g, " ").replace(/\brandom:\S+\b/gi, "").trim() || "touhou";
  const ratingRaw = (STATE.bgRating ?? "safe");
  const rating = `rating:${ratingToken(ratingRaw)}`;
  return `${base} ${rating}`.trim();
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
let preloading = null;
let nextReady = null;
let bgSwapping = false;
let bgTimer = null;
let lastSwapAt = 0;

async function preloadNext(forceNew = false, track = null) {
  if (!STATE.bgEnabled) return null;
  if (!forceNew && (nextReady || preloading)) return preloading || Promise.resolve(nextReady);

  const t = track ?? currentTrack() ?? null;
  const tags = buildTags(t);

  preloading = (async () => {
    let src = await fetchDanbooruUrl(tags);
    if (!src) src = await fetchDanbooruUrl(tags);
    if (!src) return null;

    const img = new Image();
    img.decoding = "async";
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

async function ensurePreload(track = null) {
  if (!nextReady && !preloading) await preloadNext(false, track ?? currentTrack() ?? null);
}

async function swapToNext(immediate = false) {
  if (!STATE.bgEnabled) return;
  if (bgSwapping) return;
  if (!nextReady) await ensurePreload();
  if (!nextReady) return;

  const { src } = nextReady;

  bgSwapping = true;
  STATE.bgSrc = src;
  bgNext.style.backgroundImage = `url("${src}")`;

  bgNext.style.opacity = "1";
  bg.style.opacity = "0";

  setTimeout(() => {
    bg.style.backgroundImage = `url("${src}")`;
    bg.style.opacity = "1";
    bgNext.style.opacity = "0";
    bgSwapping = false;
    lastSwapAt = Date.now();
  }, 650);

  nextReady = null;
  ensurePreload();
}

export async function updateDanbooruBackground(track, force = false) {
  if (!STATE.bgEnabled) return;
  if (force) {
    await preloadNext(true, track ?? currentTrack() ?? null);
    await swapToNext(/*immediate*/true);
  } else {
    ensurePreload(track ?? currentTrack() ?? null);
  }
}

/* ---- 背景填充/玻璃化控制 ---- */
function applyBgFit() {
  document.documentElement.style.setProperty('--bg-fit', STATE.bgFit === 'contain' ? 'contain' : 'cover');
}
function applyBgGlass() {
  document.documentElement.style.setProperty('--bg-dim', STATE.bgEnabled ? '0' : '1');
  document.documentElement.style.setProperty('--bg-blur', STATE.bgEnabled ? '0px' : '8px');
}

/* ---- 自動換圖排程（頁面在前景 + 正在播放時才輪換；到點才切） ---- */
function clearBgTimer(){ if(bgTimer){ clearInterval(bgTimer); bgTimer = null; } }
function isPlaying() { return !audio.paused && !audio.ended; }

function maybeKickRotate() {
  clearBgTimer();
  const sec = Number(STATE.bgIntervalSec) || 0;
  if (STATE.bgEnabled && sec > 0 && !document.hidden && isPlaying()) {
    ensurePreload(currentTrack() ?? null);
    bgTimer = setInterval(async () => {
      if (!nextReady) {
        ensurePreload(currentTrack() ?? null);
        return;
      }
      await swapToNext(/*immediate*/false);
    }, sec * 1000);
  }
}

function setupBgAutoRotate() {
  maybeKickRotate();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && STATE.bgEnabled && isPlaying()) {
      ensurePreload(currentTrack() ?? null);
    }
    maybeKickRotate();
  });

  audio.addEventListener('play',  () => { ensurePreload(currentTrack() ?? null); maybeKickRotate(); });
  audio.addEventListener('pause', () => { maybeKickRotate(); });
  audio.addEventListener('ended', () => { maybeKickRotate(); });
}

/* ---- 設定存取（給 ui.js 用） ---- */
export function setBgEnabled(v){
  STATE.bgEnabled = !!v;
  applyBgGlass();
  if (v) {
    (async () => { await preloadNext(true, currentTrack() ?? null); await swapToNext(true); maybeKickRotate(); })();
  } else {
    clearBgTimer();
  }
}
export function setBgTag(tag){
  STATE.bgTag = String(tag || "").trim() || "touhou";
  nextReady = null; preloading = null;
  ensurePreload(currentTrack() ?? null);
}
export function setBgRating(r){
  STATE.bgRating = (["safe","sensitive","questionable"].includes(r)) ? r : "safe";
  nextReady = null; preloading = null;
  ensurePreload(currentTrack() ?? null);
}
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

    const url = new URL(src, window.location.href);
    const nameGuess = url.pathname.split("/").pop() || "danbooru.jpg";
    const fileName = nameGuess.split("?")[0] || "danbooru.jpg";

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
    if (STATE.bgSrc) window.open(STATE.bgSrc, "_blank");
  }
}

export { audio, PAGE_BASE };
