import {
  STATE, initPlayer, rebuildQueue,
  playCurrent, pause, togglePlay, next, prev,
  setVolume, toggleMute, updateNowPlayingUI, updateMuteIcon,
  audio, setBgEnabled, setBgTag, getBgSettings,
  updateDanbooruBackground, currentTrack,
  setBgRating, setBgFit, setBgInterval,
  downloadCurrentBg
} from "./player.js";

// 抽屜
const playlistBtn = document.getElementById("playlistBtn");
const playlistPanel = document.getElementById("playlistPanel");
const closePlaylist = document.getElementById("closePlaylist");

// 設定浮窗
const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const closeSettings = document.getElementById("closeSettings");

// 控制列
const elPlay = document.getElementById("play");
const elPrev = document.getElementById("prev");
const elNext = document.getElementById("next");
const muteBtn = document.getElementById("muteBtn");
const volumeSlider = document.getElementById("volume");

// ✅ 新增：下載目前背景圖按鈕
const dlBgBtn = document.getElementById("dlBgBtn");

// 設定項
const toggleRepeatOne = document.getElementById("toggleRepeatOne");
const toggleShuffle   = document.getElementById("toggleShuffle");
const toggleBg        = document.getElementById("toggleBg");
const bgTagInput      = document.getElementById("bgTag");
const bgRatingSelect  = document.getElementById("bgRating");
const bgFitSelect     = document.getElementById("bgFit");
const bgIntervalInput = document.getElementById("bgInterval");
const bgRefreshBtn    = document.getElementById("bgRefresh");
const saveSettingsBtn = document.getElementById("saveSettings");

// 播放清單
const listEl = document.getElementById("playlistItems");

// 進度條
const progressBar  = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const curTimeEl = document.getElementById("curTime");
const durTimeEl = document.getElementById("durTime");

// 時間格式
function fmtTime(sec) {
  if (!isFinite(sec)) sec = 0;
  const m = Math.floor(sec/60), s = Math.floor(sec%60);
  return `${m}:${String(s).padStart(2,'0')}`;
}
function updateProgressUI() {
  const d = audio.duration || 0;
  const ct = audio.currentTime || 0;
  const p = d > 0 ? (ct/d) : 0;
  progressFill.style.inset = `0 ${Math.max(0, 100 - p*100)}% 0 0`;
  curTimeEl.textContent = fmtTime(ct);
  durTimeEl.textContent = fmtTime(d);
}

// 生成播放清單
function renderPlaylist() {
  listEl.innerHTML = "";
  STATE.tracks.forEach((t, gi) => {
    const li = document.createElement("li");
    li.textContent = t.title || (t.file.split("/").pop() || "");
    li.dataset.gi = String(gi);
    li.addEventListener("click", () => {
      const idxInQueue = STATE.queue.indexOf(gi);
      if (idxInQueue >= 0) {
        STATE.qIndex = idxInQueue;
        playCurrent();
      }
    });
    listEl.appendChild(li);
  });
  updateNowPlayingUI();
}

function wireEvents() {
  // 抽屜
  playlistBtn.addEventListener("click", () => playlistPanel.classList.toggle("open"));
  closePlaylist.addEventListener("click", () => playlistPanel.classList.remove("open"));

  // 設定浮窗
  settingsBtn.addEventListener("click", () => settingsPanel.classList.toggle("open"));
  closeSettings.addEventListener("click", () => settingsPanel.classList.remove("open"));

  // 控制列
  elPlay.addEventListener("click", togglePlay);
  elPrev.addEventListener("click", prev);
  elNext.addEventListener("click", next);

  // 音量 / 靜音
  muteBtn.addEventListener("click", () => {
    toggleMute();
    volumeSlider.value = String(STATE.lastVolume || audio.volume || 1);
    updateMuteIcon();
  });
  volumeSlider.addEventListener("input", () => {
    setVolume(parseFloat(volumeSlider.value));
    updateMuteIcon();
  });

  // ✅ 下載目前背景圖
  dlBgBtn.addEventListener("click", () => { downloadCurrentBg(); });

  // 鍵盤
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === "ArrowRight") next();
  });

  // 畫布上滾輪調音量
  const canvas = document.getElementById("viz");
  canvas.addEventListener("wheel", (e) => {
    const step = 0.05;
    const dir = (e.deltaY < 0) ? +1 : -1;
    const nv = Math.max(0, Math.min(1, (audio.volume ?? 1) + dir*step));
    setVolume(nv);
    volumeSlider.value = String(nv);
    updateMuteIcon();
    e.preventDefault();
  }, { passive:false });

  // 進度條拖曳
  let dragging = false;
  const setFromEvent = (clientX) => {
    const rect = progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (audio.duration > 0) audio.currentTime = ratio * audio.duration;
    updateProgressUI();
  };
  progressBar.addEventListener("pointerdown", (e)=>{ dragging=true; setFromEvent(e.clientX); e.preventDefault(); });
  window.addEventListener("pointermove", (e)=>{ if(dragging) setFromEvent(e.clientX); });
  window.addEventListener("pointerup",   ()=>{ dragging=false; });
  progressBar.addEventListener("touchstart", (e)=>{ if (e.touches[0]) setFromEvent(e.touches[0].clientX); }, {passive:false});
  progressBar.addEventListener("touchmove", (e)=>{ if (e.touches[0]) setFromEvent(e.touches[0].clientX); }, {passive:false});

  // 時間 UI
  audio.addEventListener("timeupdate", updateProgressUI);
  audio.addEventListener("durationchange", updateProgressUI);

  // 設定：Repeat One / Shuffle
  toggleRepeatOne.addEventListener("change", () => {
    STATE.repeatMode = toggleRepeatOne.checked ? "one" : "off";
  });
  toggleShuffle.addEventListener("change", () => {
    STATE.shuffle = toggleShuffle.checked;
    rebuildQueue();
    renderPlaylist();
  });

  // 設定：背景圖
  const applyBgSettings = () => {
    setBgEnabled(toggleBg.checked);
    setBgTag(bgTagInput.value);
    setBgRating(bgRatingSelect.value);
    setBgFit(bgFitSelect.value);
    setBgInterval(bgIntervalInput.value);
    if (toggleBg.checked) updateDanbooruBackground(currentTrack(), /*force*/ true);
  };
  saveSettingsBtn.addEventListener("click", () => { applyBgSettings(); settingsPanel.classList.remove("open"); });
  bgRefreshBtn.addEventListener("click", () => { if (toggleBg.checked) updateDanbooruBackground(currentTrack(), /*force*/ true); });

  // 初始化設定值（預設 fit=contain）
  const init = getBgSettings();
  toggleBg.checked = init.enabled;
  bgTagInput.value = init.tag;
  bgRatingSelect.value = init.rating || "safe";
  bgFitSelect.value = init.fit || "contain";
  bgIntervalInput.value = String(init.interval ?? 10);
  toggleRepeatOne.checked = (STATE.repeatMode === "one");
  toggleShuffle.checked   = STATE.shuffle;

  // 初始化進度 UI
  updateProgressUI();
}

// 啟動
(async function start() {
  await initPlayer();
  renderPlaylist();
  wireEvents();
})();
