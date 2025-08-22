import {
  STATE, initPlayer, rebuildQueue,
  playCurrent, pause, togglePlay, next, prev,
  setVolume, toggleMute, updateNowPlayingUI, updateMuteIcon,
  audio, setBgEnabled, setBgTag, getBgSettings, updateDanbooruBackground, currentTrack
} from "./player.js";

// 抽屜開關
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

// 設定項
const toggleRepeatOne = document.getElementById("toggleRepeatOne");
const toggleShuffle   = document.getElementById("toggleShuffle");
const toggleBg        = document.getElementById("toggleBg");
const bgTagInput      = document.getElementById("bgTag");
const bgRefreshBtn    = document.getElementById("bgRefresh");
const saveSettingsBtn = document.getElementById("saveSettings");

// 播放清單容器
const listEl = document.getElementById("playlistItems");

// 進度條元素
const progressBar  = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const curTimeEl = document.getElementById("curTime");
const durTimeEl = document.getElementById("durTime");

// 格式化時間
function fmtTime(sec) {
  if (!isFinite(sec)) sec = 0;
  const m = Math.floor(sec/60), s = Math.floor(sec%60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

// 更新進度條視覺
function updateProgressUI() {
  const d = audio.duration || 0;
  const ct = audio.currentTime || 0;
  const p = d > 0 ? (ct/d) : 0;
  progressFill.style.inset = `0 ${Math.max(0, 100 - p*100)}% 0 0`;
  if (curTimeEl) curTimeEl.textContent = fmtTime(ct);
  if (durTimeEl) durTimeEl.textContent = fmtTime(d);
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

// 綁定事件
function wireEvents() {
  // 播放清單抽屜
  playlistBtn.addEventListener("click", () => playlistPanel.classList.toggle("open"));
  closePlaylist.addEventListener("click", () => playlistPanel.classList.remove("open"));

  // 設定浮窗（右下角）
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

  // 鍵盤（空白鍵播放/暫停）
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === "ArrowRight") next();
  });

  // 畫布上滑鼠滾輪控制音量（你之前說 OK，保留）
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

  // 進度條：點擊/拖曳跳轉
  let dragging = false;
  const setFromEvent = (clientX) => {
    const rect = progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (audio.duration > 0) audio.currentTime = ratio * audio.duration;
    updateProgressUI();
  };
  const onPointerDown = (e) => { dragging = true; setFromEvent(e.clientX); e.preventDefault(); };
  const onPointerMove = (e) => { if (!dragging) return; setFromEvent(e.clientX); e.preventDefault(); };
  const onPointerUp   = () => { dragging = false; };

  progressBar.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  // 觸控
  progressBar.addEventListener("touchstart", (e)=>{ if (e.touches[0]) setFromEvent(e.touches[0].clientX); }, {passive:false});
  progressBar.addEventListener("touchmove", (e)=>{ if (e.touches[0]) setFromEvent(e.touches[0].clientX); }, {passive:false});

  // 音訊時間變更時更新 UI
  audio.addEventListener("timeupdate", updateProgressUI);
  audio.addEventListener("durationchange", updateProgressUI);

  // 設定：Repeat One / Shuffle / 背景
  toggleRepeatOne.addEventListener("change", () => {
    STATE.repeatMode = toggleRepeatOne.checked ? "one" : "off";
  });
  toggleShuffle.addEventListener("change", () => {
    STATE.shuffle = toggleShuffle.checked;
    rebuildQueue();
    renderPlaylist();
  });

  const applyBgSettings = () => {
    setBgEnabled(toggleBg.checked);
    setBgTag(bgTagInput.value);
    if (toggleBg.checked) updateDanbooruBackground(currentTrack());
  };
  saveSettingsBtn.addEventListener("click", () => { applyBgSettings(); settingsPanel.classList.remove("open"); });
  bgRefreshBtn.addEventListener("click", () => { if (toggleBg.checked) updateDanbooruBackground(currentTrack()); });

  // 初始把設定面板的控制項套用目前狀態
  const initBg = getBgSettings();
  toggleBg.checked = initBg.enabled;
  bgTagInput.value = initBg.tag;
  toggleRepeatOne.checked = (STATE.repeatMode === "one");
  toggleShuffle.checked   = STATE.shuffle;
}

// 啟動
(async function start() {
  await initPlayer();
  renderPlaylist();
  wireEvents();
  updateProgressUI(); // 初始同步時間/進度
})();
