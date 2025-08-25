// assets/js/player.js
// 核心播放器（雙 audio 暖機，切歌秒起；背景圖預載不阻塞）

// ====== DOM ======
const audio    = document.getElementById('audio');
const audioPre = document.getElementById('audioPre');

const elTitle  = document.getElementById('trackTitle');
const elCurT   = document.getElementById('curTime');
const elDurT   = document.getElementById('durTime');
const elProg   = document.getElementById('progressBar');
const elFill   = document.getElementById('progressFill');

const btnPlay  = document.getElementById('play');
const btnPrev  = document.getElementById('prev');
const btnNext  = document.getElementById('next');

const volRange = document.getElementById('volume');
const btnMute  = document.getElementById('muteBtn');

const bgA      = document.getElementById('bg');
const bgB      = document.getElementById('bgNext');

const chkRepeatOne = document.getElementById('toggleRepeatOne');
const chkShuffle   = document.getElementById('toggleShuffle');
const chkBg        = document.getElementById('toggleBg');
const selRating    = document.getElementById('bgRating');
const inpTag       = document.getElementById('bgTag');
const selFit       = document.getElementById('bgFit');
const inpInterval  = document.getElementById('bgInterval');
const btnBgRefresh = document.getElementById('bgRefresh');
const btnSaveSet   = document.getElementById('saveSettings');
const btnDlBg      = document.getElementById('dlBgBtn');

// ====== 狀態 ======
const STATE = {
  tracks: [],
  tagsMap: {},
  queue: [],
  qIndex: 0,

  // 設定
  repeatOne: false,
  shuffle: true,         // 預設開啟隨機播放（你之前的需求）
  bgEnabled: true,
  bgRating: 'safe',
  bgTag: '',
  bgFit: 'cover',
  bgInterval: 0,         // 0=停用自動換圖

  // 背景圖
  bgCurrentUrl: null,
  bgNextUrl: null,
  bgTimer: null,
};

// 預載
let preloadedIndex = -1;

// ====== 工具 ======
function clamp(n, lo, hi){ return Math.min(hi, Math.max(lo, n)); }
function fmtTime(sec){
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2,'0');
  return `${m}:${s}`;
}
function shuffleArray(arr){
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

// ====== 播放清單與初始化 ======
async function loadJSON(url){
  // 不強制 no-store，讓瀏覽器快取 JSON
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} failed`);
  return res.json();
}

async function boot(){
  // 載入 tracks & tags
  STATE.tracks = await loadJSON('assets/data/tracks.json').catch(async ()=>{
    // 兼容舊路徑：根目錄 tracks.json
    try { return await loadJSON('tracks.json'); }
    catch(e){ throw e; }
  });
  STATE.tagsMap = await loadJSON('assets/data/tags.json').catch(async ()=>{
    try { return await loadJSON('tags.json'); }
    catch(e){ return {}; }
  });

  // 組 queue
  STATE.queue = STATE.tracks.map((_, i)=>i);
  if (STATE.shuffle) STATE.queue = shuffleArray(STATE.queue);

  // 還原設定
  try {
    const raw = localStorage.getItem('tm_settings');
    if (raw){
      const cfg = JSON.parse(raw);
      Object.assign(STATE, {
        repeatOne : !!cfg.repeatOne,
        shuffle   : !!cfg.shuffle,
        bgEnabled : !!cfg.bgEnabled,
        bgRating  : cfg.bgRating ?? 'safe',
        bgTag     : cfg.bgTag ?? '',
        bgFit     : cfg.bgFit ?? 'cover',
        bgInterval: Number(cfg.bgInterval ?? 0)
      });
    }
  } catch(e){}

  // 套到 UI
  chkRepeatOne.checked = STATE.repeatOne;
  chkShuffle.checked   = STATE.shuffle;
  chkBg.checked        = STATE.bgEnabled;
  selRating.value      = STATE.bgRating;
  inpTag.value         = STATE.bgTag;
  selFit.value         = STATE.bgFit;
  inpInterval.value    = STATE.bgInterval || '';

  // 音量
  audio.volume = Number(localStorage.getItem('tm_vol') ?? 1);
  volRange.value = audio.volume.toString();

  // 事件
  wireEvents();

  // 播第一首 & 預載下一首
  await playCurrent();
  const nxt = getNextIndex(STATE.queue[STATE.qIndex]);
  preloadNextIfNeeded(nxt);
  startBgAutoTimer();
}

// ====== 事件 ======
function wireEvents(){
  btnPlay.addEventListener('click', togglePlay);
  btnPrev.addEventListener('click', prev);
  btnNext.addEventListener('click', next);

  volRange.addEventListener('input', e=>{
    audio.volume = Number(e.target.value);
    localStorage.setItem('tm_vol', audio.volume);
  });
  btnMute.addEventListener('click', ()=>{
    audio.muted = !audio.muted;
    btnMute.textContent = audio.muted ? '🔇' : '🔊';
  });

  // 時間與進度
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('durationchange', updateProgress);
  elProg.addEventListener('click', onSeek);

  // 播完
  audio.addEventListener('ended', ()=>{
    if (STATE.repeatOne){
      audio.currentTime = 0;
      audio.play().catch(()=>{});
    } else {
      next();
    }
  });

  // 設定
  chkRepeatOne.addEventListener('change', ()=>{
    STATE.repeatOne = chkRepeatOne.checked;
    saveSettings();
  });
  chkShuffle.addEventListener('change', ()=>{
    const turnOn = chkShuffle.checked;
    if (turnOn !== STATE.shuffle){
      STATE.shuffle = turnOn;
      rebuildQueueKeepingCurrent();
      saveSettings();
    }
  });
  chkBg.addEventListener('change', ()=>{
    STATE.bgEnabled = chkBg.checked;
    saveSettings();
  });
  selRating.addEventListener('change', ()=>{ STATE.bgRating = selRating.value; saveSettings(); });
  inpTag.addEventListener('change', ()=>{ STATE.bgTag = inpTag.value.trim(); saveSettings(); });
  selFit.addEventListener('change', ()=>{
    STATE.bgFit = selFit.value; saveSettings(); applyBgFit();
  });
  inpInterval.addEventListener('change', ()=>{
    STATE.bgInterval = Number(inpInterval.value || 0);
    saveSettings(); startBgAutoTimer();
  });
  btnBgRefresh.addEventListener('click', ()=> updateDanbooruBackground(currentTrack(), /*force*/true));
  btnSaveSet.addEventListener('click', saveSettings);

  // 下載背景
  btnDlBg.addEventListener('click', ()=>{
    const url = STATE.bgCurrentUrl || STATE.bgNextUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'background.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

function saveSettings(){
  localStorage.setItem('tm_settings', JSON.stringify({
    repeatOne : STATE.repeatOne,
    shuffle   : STATE.shuffle,
    bgEnabled : STATE.bgEnabled,
    bgRating  : STATE.bgRating,
    bgTag     : STATE.bgTag,
    bgFit     : STATE.bgFit,
    bgInterval: STATE.bgInterval,
  }));
}

// ====== 進度條 ======
function updateProgress(){
  const cur = audio.currentTime || 0;
  const dur = audio.duration || 0;
  elCurT.textContent = fmtTime(cur);
  elDurT.textContent = fmtTime(dur);
  const pct = dur ? (cur / dur) * 100 : 0;
  elProg.setAttribute('aria-valuenow', String(Math.floor(pct)));
  elFill.style.width = `${pct}%`;
}
function onSeek(e){
  const rect = elProg.getBoundingClientRect();
  const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  const dur = audio.duration || 0;
  if (dur > 0){
    audio.currentTime = x * dur;
  }
}

// ====== 播放與預載 ======
function currentTrack(){
  const idx = STATE.queue[STATE.qIndex];
  return STATE.tracks[idx];
}
function getNextIndex(curIndexInTracks){
  if (STATE.repeatOne) return curIndexInTracks;
  // 依 queue 找下一首
  const qi = STATE.qIndex;
  const nextQi = (qi + 1) % STATE.queue.length;
  return STATE.queue[nextQi];
}
function rebuildQueueKeepingCurrent(){
  const curTrackIdx = STATE.queue[STATE.qIndex];
  let newQueue = STATE.tracks.map((_,i)=>i);
  if (STATE.shuffle) newQueue = shuffleArray(newQueue);

  // 把目前曲目移到新 queue 中的對應位置，維持「現在這首」不變
  const pos = newQueue.indexOf(curTrackIdx);
  if (pos !== -1){
    // 旋轉 queue，讓 pos 成為 qIndex
    STATE.qIndex = 0;
    STATE.queue = newQueue.slice(pos).concat(newQueue.slice(0,pos));
  } else {
    STATE.queue = newQueue;
    STATE.qIndex = 0;
  }
}

async function preloadNextIfNeeded(nextIndex){
  if (preloadedIndex === nextIndex) return;
  preloadedIndex = -1;

  const t = STATE.tracks[nextIndex];
  if (!t) return;

  audioPre.crossOrigin = 'anonymous';
  audioPre.src = t.file;   // 相對路徑即可，建議原始 tracks.json 就已 encodeURI
  audioPre.load();

  await new Promise((res)=>{
    let done = false;
    const clean = ()=>{
      audioPre.removeEventListener('canplay', onReady);
      audioPre.removeEventListener('error', onErr);
    };
    const onReady = ()=>{ if (done) return; done = true; clean(); res(); };
    const onErr   = ()=>{ if (done) return; done = true; clean(); res(); };
    audioPre.addEventListener('canplay', onReady, {once:true});
    audioPre.addEventListener('error', onErr, {once:true});
  });

  preloadedIndex = nextIndex;
}

async function switchTo(indexInTracks){
  const t = STATE.tracks[indexInTracks];
  if (!t) return;

  // 如果這首已預載：直接把 src 換成預載那支（保持同一個 <audio>：viz.js 不需重綁）
  if (preloadedIndex === indexInTracks && audioPre.src){
    const vol = audio.volume, muted = audio.muted;
    try { audio.pause(); } catch(e){}

    audio.src = audioPre.src;
    audio.currentTime = 0;
    audio.volume = vol;
    audio.muted  = muted;

    try { await audio.play(); } catch(e){}
    preloadedIndex = -1; // 讓預載器可以去抓再下一首
  } else {
    // 沒預載成功：保守做法
    audio.src = t.file;
    try { await audio.play(); } catch(e){}
  }

  // 非阻塞更新背景圖
  if (STATE.bgEnabled){
    updateDanbooruBackground(t, /*force*/false);
  }

  // UI
  elTitle.textContent = t.title || '—';

  // 下一首預載（背景進行）
  const willPre = getNextIndex(indexInTracks);
  preloadNextIfNeeded(willPre);
}

async function playCurrent(){
  const idxInTracks = STATE.queue[STATE.qIndex];
  await switchTo(idxInTracks);
}

function next(){
  if (!STATE.queue.length) return;
  STATE.qIndex = (STATE.qIndex + 1) % STATE.queue.length;
  playCurrent();
}
function prev(){
  if (!STATE.queue.length) return;
  STATE.qIndex = (STATE.qIndex - 1 + STATE.queue.length) % STATE.queue.length;
  playCurrent();
}

function togglePlay(){
  if (audio.paused){
    audio.play().catch(()=>{});
  } else {
    audio.pause();
  }
}

// ====== 背景圖（Danbooru） ======
function applyBgFit(){
  const fit = STATE.bgFit === 'contain' ? 'contain' : 'cover';
  bgA.style.backgroundSize = fit;
  bgB.style.backgroundSize = fit;
}

function startBgAutoTimer(){
  if (STATE.bgTimer){ clearInterval(STATE.bgTimer); STATE.bgTimer = null; }
  const sec = Number(STATE.bgInterval || 0);
  if (sec > 0){
    STATE.bgTimer = setInterval(()=>{
      if (STATE.bgEnabled) updateDanbooruBackground(currentTrack(), /*force*/false);
    }, sec * 1000);
  }
}

async function fetchDanbooruImageUrl(tag, rating){
  // 取單張結果即可（order:random）
  const qs = new URLSearchParams({
    tags: `${tag} rating:${rating} -comic -4koma`,
    limit: '1',
    random: 'true'
  });
  const url = `https://danbooru.donmai.us/posts.json?${qs.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Danbooru API error');
  const arr = await res.json();
  const post = Array.isArray(arr) && arr[0];
  // 優先原圖 -> 大圖 -> preview
  return post?.file_url || post?.large_file_url || post?.preview_file_url || null;
}

function parseTagFromTrack(track){
  // 優先 tags.json map（key 請使用你 tracks.json 里的 "file" 完整路徑或 encodeURI 版本）
  const key1 = track.file;
  const key2 = encodeURI(track.file);
  const obj = STATE.tagsMap[key1] || STATE.tagsMap[key2];
  if (obj?.bgTag) return obj.bgTag;
  // 其次用使用者設定的通用 tag
  if (STATE.bgTag) return STATE.bgTag;
  // 再不行就 fallback touhou
  return 'touhou';
}

async function updateDanbooruBackground(track, force=false){
  try {
    const tag = parseTagFromTrack(track);
    const rating = STATE.bgRating || 'safe';
    // 若已有「下一張」且不是強制，直接切換即可（避免每次都打 API）
    if (!force && STATE.bgNextUrl){
      swapBgNow();
      return;
    }
    // 下載新圖到 next（非阻塞）
    const url = await fetchDanbooruImageUrl(tag, rating);
    if (!url) return;
    STATE.bgNextUrl = url;
    // 預載圖片，載完才切
    const ok = await preloadImage(url).catch(()=>false);
    if (ok){
      swapBgNow();
    }
  } catch(e){
    // 靜默失敗即可，避免卡流程
  }
}

function preloadImage(url){
  return new Promise((res, rej)=>{
    const img = new Image();
    img.onload = ()=> res(true);
    img.onerror = rej;
    img.src = url;
  });
}

function swapBgNow(){
  if (!STATE.bgNextUrl) return;
  bgB.style.backgroundImage = `url("${STATE.bgNextUrl}")`;
  applyBgFit();

  // cross-fade
  bgB.classList.add('show');
  bgA.classList.remove('show');

  // 交換角色
  const tmpUrl = STATE.bgCurrentUrl;
  STATE.bgCurrentUrl = STATE.bgNextUrl;
  STATE.bgNextUrl = tmpUrl || null;

  // 把舊圖放到底層
  bgA.style.backgroundImage = `url("${STATE.bgCurrentUrl}")`;
}

// ====== 啟動 ======
document.addEventListener('DOMContentLoaded', boot);
export { audio }; // 給 viz.js 使用（若需要）
