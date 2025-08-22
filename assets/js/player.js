export const STATE = {
  tracks: [],
  queue: [],
  qIndex: 0,
  repeatMode: "off",  // "off" | "one" | "all"
  shuffle: false,
};

const audio = document.getElementById("audio");

// ===== 播放邏輯 =====
export function rebuildQueue() {
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

export function playCurrent() {
  const t = currentTrack();
  if (!t) return;
  audio.src = t.file;
  audio.play();
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

// 初始化（假資料）
STATE.tracks = [
  { file: "music/th10/song1.mp3", title: "Song 1" },
  { file: "music/th10/song2.mp3", title: "Song 2" },
  { file: "music/th10/song3.mp3", title: "Song 3" },
];
rebuildQueue();
