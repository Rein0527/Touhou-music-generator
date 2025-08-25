<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Touhou music generator</title>
  <link rel="stylesheet" href="assets/css/style.css" />
  <meta name="theme-color" content="#0b0d12" />
</head>
<body>
  <div class="app" id="app">
    <!-- 背景 -->
    <div class="bg" id="bg"></div>
    <div class="bg-next" id="bgNext"></div>
    <div class="bg-dim"></div>

    <!-- 舞台 -->
    <div class="stage" id="stage">
      <canvas id="viz" width="1200" height="1200" aria-label="視覺化畫布"></canvas>

      <!-- 下方曲目 + 進度條 -->
      <div class="nowplaying">
        <div id="trackTitle" class="title">—</div>
        <div class="scrub">
          <div class="time t-left"><span id="curTime">0:00</span></div>
          <div id="progressBar" class="bar-outer" role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="播放進度">
            <div id="progressFill" class="bar-inner"></div>
          </div>
          <div class="time t-right"><span id="durTime">0:00</span></div>
        </div>
      </div>
    </div>

    <!-- 播放清單（左側抽屜） -->
    <div id="playlistPanel" class="playlist-panel">
      <div class="playlist-header">
        <h2>播放清單</h2>
        <button id="closePlaylist" class="btn icon" aria-label="關閉">✕</button>
      </div>
      <ul id="playlistItems"></ul>
    </div>

    <!-- 設定（右下角小浮窗） -->
    <div id="settingsPanel" class="settings-flyout">
      <div class="settings-header">
        <h2>設定</h2>
        <button id="closeSettings" class="btn icon sm" aria-label="關閉">✕</button>
      </div>
      <div class="settings-body">
        <label class="row">
          <span>同一首循環</span>
          <label class="switch">
            <input type="checkbox" id="toggleRepeatOne">
            <span class="slider"></span>
          </label>
        </label>

        <label class="row">
          <span>隨機播放</span>
          <label class="switch">
            <input type="checkbox" id="toggleShuffle">
            <span class="slider"></span>
          </label>
        </label>

        <div class="sep"></div>

        <label class="row">
          <span>背景圖片（Danbooru）</span>
          <label class="switch">
            <input type="checkbox" id="toggleBg">
            <span class="slider"></span>
          </label>
        </label>

        <label class="row">
          <span class="sub">Rating</span>
          <select id="bgRating" class="input">
            <option value="safe">safe</option>
            <option value="sensitive">sensitive</option>
            <option value="questionable">questionable</option>
          </select>
        </label>

        <label class="row">
          <span class="sub">搜尋標籤</span>
          <input id="bgTag" class="input" type="text" placeholder="例如：touhou" />
        </label>

        <label class="row">
          <span class="sub">填充模式</span>
          <select id="bgFit" class="input">
            <option value="cover">cover（鋪滿，可能裁切）</option>
            <option value="contain">contain（完整顯示，可能留邊）</option>
          </select>
        </label>

        <label class="row">
          <span class="sub">自動換圖（秒）</span>
          <input id="bgInterval" class="input" type="number" min="0" step="1" placeholder="0=停用" />
        </label>

        <div class="actions">
          <button id="bgRefresh" class="btn">換一張</button>
          <button id="saveSettings" class="btn ghost">套用</button>
        </div>
      </div>
    </div>

    <!-- 底部控制列 -->
    <div class="bar">
      <div class="bar-left">
        <button class="btn icon" id="playlistBtn" title="播放清單">☰</button>
      </div>
      <div class="bar-center">
        <button class="btn icon" id="prev" title="上一首">⏮</button>
        <button class="btn icon" id="play" title="播放/暫停">▶</button>
        <button class="btn icon" id="next" title="下一首">⏭</button>
      </div>
      <div class="bar-right">
        <!-- 下載目前背景圖 -->
        <button class="btn icon" id="dlBgBtn" title="下載背景圖片" aria-label="下載背景圖片">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-download" fill="white" aria-hidden="true">
            <path d="M5 20h14v-2H5v2zM12 2v12l4-4h-3V2h-2v8H8l4 4z"/>
          </svg>
        </button>
        <!-- 設定按鈕 -->
        <button class="btn icon" id="settingsBtn" title="設定">⚙</button>
        <div class="vol">
          <button id="muteBtn" class="btn icon" title="靜音/恢復">🔊</button>
          <input id="volume" type="range" min="0" max="1" step="0.01" value="1" />
        </div>
      </div>
    </div>
  </div>

  <!-- 兩個 audio：一支播放，一支預載 -->
  <audio id="audio" preload="auto" crossorigin="anonymous"></audio>
  <audio id="audioPre" preload="auto" crossorigin="anonymous" style="display:none"></audio>

  <!-- 必須是 ES modules -->
  <script type="module" src="assets/js/player.js"></script>
  <script type="module" src="assets/js/ui.js"></script>
  <script type="module" src="assets/js/viz.js"></script>
</body>
</html>
