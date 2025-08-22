const elAudio = document.getElementById("audio");
const elPlay = document.getElementById("play");
const elPrev = document.getElementById("prev");
const elNext = document.getElementById("next");
const elVol = document.getElementById("volume");
const elTrackList = document.getElementById("trackList");

let shuffle = false, repeat = false;
let tracks = [];   // 會由 tracks.json 載入
let qIndex=0;

async function loadTracks(){
  try{
    const res = await fetch("data/tracks.json");
    tracks = await res.json();
  }catch{
    tracks = [];
  }
  if(tracks.length>0) loadTrack(0);
}

function loadTrack(i){
  qIndex=i; 
  elAudio.src=tracks[i].file; 
  elAudio.play();
  renderList();
}
function renderList(){
  elTrackList.innerHTML="";
  tracks.forEach((t,i)=>{
    const li=document.createElement("li");
    li.textContent=t.title || t.file;
    if(i===qIndex) li.style.color="var(--accent)";
    li.onclick=()=>loadTrack(i);
    elTrackList.appendChild(li);
  });
}
function togglePlay(){ if(elAudio.paused) elAudio.play(); else elAudio.pause(); }

elPlay.onclick=togglePlay;
elPrev.onclick=()=>loadTrack((qIndex-1+tracks.length)%tracks.length);
elNext.onclick=()=>loadTrack((qIndex+1)%tracks.length);
elAudio.onplay=()=>elPlay.textContent="⏸";
elAudio.onpause=()=>elPlay.textContent="▶";
elVol.oninput=()=>elAudio.volume=parseFloat(elVol.value);

elAudio.onended=()=>{
  if(repeat){ elAudio.currentTime=0; elAudio.play(); return; }
  if(shuffle){ qIndex=Math.floor(Math.random()*tracks.length); loadTrack(qIndex); }
  else elNext.onclick();
};

loadTracks();
