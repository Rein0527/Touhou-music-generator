import {
  STATE, initPlayer, rebuildQueue,
  playCurrent, pause, togglePlay, next, prev,
  setVolume, toggleMute, updateNowPlayingUI, updateMuteIcon
} from "./player.js";

// 抽屜開關
const playlistBtn = document.getElementById("playlistBtn");
const playlistPanel = document.getElementById("playlistPanel");
const closePlaylist = document.getElementById("closePlaylist");

const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const closeSettings = document.getElementById("closeSettings");

// 控制列
const elPlay = document.getElementById("play");
const elPrev = document.getElementById("prev");
const elNext = document.getElementById("next");
const muteBtn = document.getElementById("muteBtn");
const volumeSlider = document.getElementById("volume");

// 設定
const toggleRepeat = document.getElementById("toggleRepeat");
const toggleShuffle = document.getElementById("toggleShuffle");

// 播放清單容器
const listEl = document.getElementById("playlistItems");

// 生成播放清單
function renderPlaylist() {
  listEl.innerHTML = "";
  STATE.tracks.forEach((t, gi) => {
    const li = document.createElement("li");
    li.textContent = t.title || (t.file.split("/").pop() || "");
    li.dataset.gi = String(gi);
    li.addEventListener("click", () => {
      // 找到此 gi 在目前 queue 的索引
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
  settingsBtn.addEventListener("click", () => settingsPanel.classList.toggle("open"));
  closeSettings.addEventListener("click", () => settingsPanel.classList.remove("open"));

  // 控制列
  elPlay.addEventListener("click", togglePlay);
  elPrev.addEventListener("click", prev);
  elNext.addEventListener("click", next);

  // 音量 / 靜音
  muteBtn.addEventListener("click", () => { toggleMute(); volumeSlider.value = String(STATE.lastVolume || (document.getElementById("audio").volume)); updateMuteIcon(); });
  volumeSlider.addEventListener("input", () => { setVolume(parseFloat(volumeSlider.value)); updateMuteIcon(); });

  // 設定
  toggleRepeat.addEventListener("change", () => {
    STATE.repeatMode = toggleRepeat.checked ? "all" : "off";
  });
  toggleShuffle.addEventListener("change", () => {
    STATE.shuffle = toggleShuffle.checked;
    rebuildQueue();
    renderPlaylist(); // queue 變動 → 重新標示 active
  });

  // 鍵盤（空白鍵播放/暫停）
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === "ArrowRight") next();
  });
}

// 啟動
(async function start() {
  await initPlayer();
  renderPlaylist();
  wireEvents();
})();
