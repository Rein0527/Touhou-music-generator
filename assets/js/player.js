document.addEventListener("DOMContentLoaded", () => {
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

  // 狀態
  const STATE = {
    tracks: [],         // 全部曲目
    queue: [],          // 播放序列
    qIndex: 0,          // 當前位置
    repeatMode: "off",  // "off" | "one" | "all"
    shuffle: false,
  };

  // ===== 播放清單控制 =====
  playlistBtn.addEventListener("click", () => {
    playlistPanel.classList.toggle("open");
  });
  closePlaylist.addEventListener("click", () => {
    playlistPanel.classList.remove("open");
  });

  // ===== 設定控制 =====
  settingsBtn.addEventListener("click", () => {
    settingsPanel.classList.toggle("open");
  });
  closeSettings.addEventListener("click", () => {
    settingsPanel.classList.remove("open");
  });

  // 循環模式
  toggleRepeat.addEventListener("change", () => {
    STATE.repeatMode = toggleRepeat.checked ? "all" : "off";
    console.log("Repeat mode:", STATE.repeatMode);
  });

  // 隨機模式
  toggleShuffle.addEventListener("change", () => {
    STATE.shuffle = toggleShuffle.checked;
    rebuildQueue();
    console.log("Shuffle:", STATE.shuffle);
  });

  // ===== 音量靜音切換 =====
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

  // ===== 播放邏輯 =====
  function rebuildQueue() {
    STATE.queue = STATE.tracks.map((_, i) => i);
    if (STATE.shuffle) {
      for (let i = STATE.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [STATE.queue[i], STATE.queue[j]] = [STATE.queue[j], STATE.queue[i]];
      }
    }
    STATE.qIndex = 0;
  }

  function currentTrack() {
    const gi = STATE.queue[STATE.qIndex];
    return STATE.tracks[gi];
  }

  function playCurrent() {
    const t = currentTrack();
    if (!t) return;
    audio.src = t.file;
    audio.play();
  }

  function next() {
    if (STATE.repeatMode === "one") {
      // 單曲重播
      audio.currentTime = 0;
      playCurrent();
      return;
    }
    STATE.qIndex++;
    if (STATE.qIndex >= STATE.queue.length) {
      if (STATE.repeatMode === "all") {
        STATE.qIndex = 0;
      } else {
        console.log("播放結束");
        return;
      }
    }
    playCurrent();
  }

  function prev() {
    STATE.qIndex = (STATE.qIndex - 1 + STATE.queue.length) % STATE.queue.length;
    playCurrent();
  }

  // 綁定事件
  document.getElementById("play").addEventListener("click", playCurrent);
  document.getElementById("next").addEventListener("click", next);
  document.getElementById("prev").addEventListener("click", prev);

  audio.addEventListener("ended", next);

  // ===== 初始化（假資料） =====
  STATE.tracks = [
    { file: "music/th10/song1.mp3", title: "Song 1" },
    { file: "music/th10/song2.mp3", title: "Song 2" },
    { file: "music/th10/song3.mp3", title: "Song 3" },
  ];
  rebuildQueue();
});
