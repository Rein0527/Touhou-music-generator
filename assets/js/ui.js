import { STATE, rebuildQueue, playCurrent, next, prev } from "./player.js";

const playlistBtn = document.getElementById("playlistBtn");
const playlistPanel = document.getElementById("playlistPanel");
const closePlaylist = document.getElementById("closePlaylist");

const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const closeSettings = document.getElementById("closeSettings");

const muteBtn = document.getElementById("muteBtn");
const volumeSlider = document.getElementById("volume");
const audio = document.getElementById("audio");

const toggleRepeat = document.getElementById("toggleRepeat");
const toggleShuffle = document.getElementById("toggleShuffle");

let lastVolume = 1;

// ===== 播放清單控制 =====
playlistBtn.addEventListener("click", () => playlistPanel.classList.toggle("open"));
closePlaylist.addEventListener("click", () => playlistPanel.classList.remove("open"));

// ===== 設定控制 =====
settingsBtn.addEventListener("click", () => settingsPanel.classList.toggle("open"));
closeSettings.addEventListener("click", () => settingsPanel.classList.remove("open"));

toggleRepeat.addEventListener("change", () => {
  STATE.repeatMode = toggleRepeat.checked ? "all" : "off";
});
toggleShuffle.addEventListener("change", () => {
  STATE.shuffle = toggleShuffle.checked;
  rebuildQueue();
});

// ===== 音量控制 =====
muteBtn.addEventListener("click", () => {
  if (audio.volume > 0) {
    lastVolume = audio.volume;
    audio.volume = 0;
    volumeSlider.value = 0;
    muteBtn.textContent = "🔇";
  } else {
    audio.volume = lastVolume || 1;
    volumeSlider.value = audio.volume;
    muteBtn.textContent = "🔊";
  }
});
volumeSlider.addEventListener("input", () => {
  audio.volume = parseFloat(volumeSlider.value);
  muteBtn.textContent = audio.volume > 0 ? "🔊" : "🔇";
});

// ===== 控制列按鈕 =====
document.getElementById("play").addEventListener("click", playCurrent);
document.getElementById("next").addEventListener("click", next);
document.getElementById("prev").addEventListener("click", prev);
