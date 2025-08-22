// UI：清單/設定面板與開關
const elPlaylist = document.getElementById("playlist");
const elSettings = document.getElementById("settings");
const elTrackList = document.getElementById("trackList");

document.getElementById("toggleList").onclick = () => {
  elPlaylist.classList.add("show"); window.renderList?.();
};
document.getElementById("closeList").onclick  = () => { elPlaylist.classList.remove("show"); };
// 點遮罩關閉（點到面板本體不關）
elPlaylist.addEventListener('click', (e)=>{
  if (e.target === elPlaylist) elPlaylist.classList.remove('show');
});

document.getElementById("toggleSettings").onclick = () => {
  // 初始化 switch 狀態
  const st = window.playerState || {};
  document.getElementById("toggleShuffleSwitch").checked = !!st.shuffle;
  document.getElementById("toggleRepeatSwitch").checked  = !!st.repeat;

  // 讀回偏好
  try{
    const pref = JSON.parse(localStorage.getItem("touhou_player_pref")||"{}");
    if (typeof pref.shuffle === "boolean") document.getElementById("toggleShuffleSwitch").checked = pref.shuffle;
    if (typeof pref.repeat  === "boolean") document.getElementById("toggleRepeatSwitch").checked  = pref.repeat;
    if (typeof pref.bgTag === "string") document.getElementById("bgTag").value = pref.bgTag;
    if (typeof pref.bgInterval === "number") document.getElementById("bgInterval").value = pref.bgInterval;
  }catch{}
  elSettings.classList.add("show");
};
document.getElementById("closeSettings").onclick = () => { elSettings.classList.remove("show"); };
// 點遮罩關閉
elSettings.addEventListener('click', (e)=>{
  if (e.target === elSettings) elSettings.classList.remove('show');
});

// 設定面板：寫回 playerState + 儲存偏好
function savePref(){
  const pref = {
    shuffle: !!document.getElementById("toggleShuffleSwitch").checked,
    repeat:  !!document.getElementById("toggleRepeatSwitch").checked,
    bgTag: document.getElementById("bgTag").value || "",
    bgInterval: Math.max(5, parseInt(document.getElementById("bgInterval").value||"15",10))
  };
  try{ localStorage.setItem("touhou_player_pref", JSON.stringify(pref)); }catch{}
  const st = window.playerState;
  if (st){
    st.shuffle = pref.shuffle;
    st.repeat  = pref.repeat;
  }
  // TODO：如需即時影響背景輪播，可在這裡呼叫對應 hook
}

["toggleShuffleSwitch","toggleRepeatSwitch","bgTag","bgInterval"].forEach(id=>{
  const el = document.getElementById(id);
  el.addEventListener(el.tagName === "INPUT" && el.type === "checkbox" ? "change" : "input", savePref);
});
