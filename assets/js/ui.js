const elPlaylist = document.getElementById("playlist");
const elSettings = document.getElementById("settings");

document.getElementById("toggleList").onclick=()=>{
  elPlaylist.classList.add("show"); renderList();
};
document.getElementById("closeList").onclick=()=>elPlaylist.classList.remove("show");

document.getElementById("toggleSettings").onclick=()=>elSettings.classList.add("show");
document.getElementById("closeSettings").onclick=()=>elSettings.classList.remove("show");

document.getElementById("toggleShuffle").onclick=()=>{
  shuffle=!shuffle; alert("隨機播放："+shuffle);
};
document.getElementById("toggleRepeat").onclick=()=>{
  repeat=!repeat; alert("重複播放："+repeat);
};
