// assets/js/ui.js
// 控制「播放清單抽屜」與「設定浮窗」的開闔，以及清單渲染

const playlistBtn   = document.getElementById('playlistBtn');
const playlistPanel = document.getElementById('playlistPanel');
const closePlaylist = document.getElementById('closePlaylist');

const settingsBtn   = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');

const listEl        = document.getElementById('playlistItems');

playlistBtn?.addEventListener('click', ()=> playlistPanel?.classList.add('open'));
closePlaylist?.addEventListener('click', ()=> playlistPanel?.classList.remove('open'));

settingsBtn?.addEventListener('click', ()=> settingsPanel?.classList.add('open'));
closeSettings?.addEventListener('click', ()=> settingsPanel?.classList.remove('open'));

// 這裡示範從 window 取得 tracks（player.js 啟動後會把 tracks 掛在 window 以利 UI）
window.renderPlaylist = function renderPlaylist(tracks = [], queue = [], qIndex = 0){
  if (!listEl) return;
  listEl.innerHTML = '';
  queue.forEach((trackIndex, i)=>{
    const t = tracks[trackIndex];
    const li = document.createElement('li');
    li.className = 'pl-item' + (i===qIndex ? ' active' : '');
    li.innerHTML = `
      <button class="pl-btn" data-i="${i}" title="${t.title || ''}">
        <span class="pl-title">${t.title || '—'}</span>
        <span class="pl-artist">${t.artist || ''}</span>
      </button>
    `;
    listEl.appendChild(li);
  });
};

// 讓 player.js 可以更新清單（如果你要用）
window.updatePlaylistActive = function(i){
  document.querySelectorAll('.pl-item').forEach((el, idx)=>{
    el.classList.toggle('active', idx === i);
  });
};
