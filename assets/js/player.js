// 播放器核心：載入清單 / 控制播放 / 空白鍵 / 下壓動畫
const elAudio = document.getElementById("audio");
const elPlay  = document.getElementById("play");
const elPrev  = document.getElementById("prev");
const elNext  = document.getElementById("next");
const elVol   = document.getElementById("volume");
const elTrackList = document.getElementById("trackList");

let tracks = [];
let qIndex = 0;

// 播放模式 state（由設定面板控制）
let shuffle = false, repeat = false;
window.playerState = {
  get shuffle(){ return shuffle; }, set shuffle(v){ shuffle = !!v; },
  get repeat(){  return repeat;  }, set repeat(v){  repeat  = !!v; }
};

// 載入偏好
(function loadPref(){
  try{
    const pref = JSON.parse(localStorage.getItem("touhou_player_pref")||"{}");
    if (typeof pref.shuffle === "boolean") shuffle = pref.shuffle;
    if (typeof pref.repeat  === "boolean") repeat  = pref.repeat;
  }catch{}
})();

async function loadTracks(){
  try{
    const res = await fetch("data/tracks.json", { cache:"no-store" });
    if (!res.ok) throw 0;
    tracks = await res.json();
  }catch{ tracks = []; }
  renderList();
  if(tracks.length>0) loadTrack(0);
}

function enc(u){ try { return encodeURI(u); } catch { return u; } }

function loadTrack(i){
  if (!tracks.length) return;
  qIndex = (i + tracks.length) % tracks.length;
  const t = tracks[qIndex];
  elAudio.src = enc(t.file);
  window.__viz?.bindAudio(elAudio);
  elAudio.play().catch(()=>{});
  renderList();
}

function renderList(){
  if (!elTrackList) return;
  elTrackList.innerHTML = "";
  tracks.forEach((t,i)=>{
    const li = document.createElement("li");
    li.textContent = t.title || t.file.split("/").pop();
    if (i === qIndex) li.style.color = "var(--accent)";
    li.onclick = async () => { await window.__viz?.resumeOnGesture(); loadTrack(i); };
    elTrackList.appendChild(li);
  });
}
// 讓 ui.js 可手動觸發重繪
window.renderList = renderList;

function togglePlay(){
  // 播放鍵短促「下壓」動畫
  elPlay.classList.add("tapping");
  setTimeout(()=> elPlay.classList.remove("tapping"), 120);

  if (elAudio.paused) elAudio.play().catch(()=>{});
  else elAudio.pause();
}

elPlay.onclick = async () => { await window.__viz?.resumeOnGesture(); togglePlay(); };
elPrev.onclick = async () => { await window.__viz?.resumeOnGesture(); loadTrack(qIndex-1); };
elNext.onclick = async () => { await window.__viz?.resumeOnGesture(); loadTrack(qIndex+1); };

elAudio.onplay  = () => { elPlay.textContent = "⏸"; elPlay.setAttribute("aria-pressed","true"); };
elAudio.onpause = () => { elPlay.textContent = "▶";  elPlay.setAttribute("aria-pressed","false"); };

elVol.oninput = () => { elAudio.volume = parseFloat(elVol.value); };

elAudio.onended = () => {
  if (repeat) { elAudio.currentTime = 0; elAudio.play(); return; }
  if (shuffle && tracks.length > 1) {
    let ni = Math.floor(Math.random() * tracks.length);
    if (ni === qIndex) ni = (ni + 1) % tracks.length;
    loadTrack(ni);
  } else {
    loadTrack(qIndex + 1);
  }
};

// 空白鍵 = 播放/暫停（避免輸入框衝突）
window.addEventListener("keydown", async (e)=>{
  const tag = (e.target && (e.target.tagName||"")).toLowerCase();
  const editable = e.target && (e.target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select");
  if (editable) return;

  if (e.code === "Space") {
    e.preventDefault();
    await window.__viz?.resumeOnGesture();
    togglePlay();
  } else if (e.key === "a" || e.key === "A") {
    await window.__viz?.resumeOnGesture(); loadTrack(qIndex-1);
  } else if (e.key === "d" || e.key === "D") {
    await window.__viz?.resumeOnGesture(); loadTrack(qIndex+1);
  } else if (e.key === "ArrowLeft") {
    elAudio.currentTime = Math.max(0, elAudio.currentTime - (e.ctrlKey ? 15 : 5));
  } else if (e.key === "ArrowRight") {
    elAudio.currentTime = Math.min(elAudio.duration || 1e9, elAudio.currentTime + (e.ctrlKey ? 15 : 5));
  }
});

// 啟動
loadTracks();
