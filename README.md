# Touhou Music Player

一個基於 **GitHub Pages** 的東方音樂播放器。  
支援 **隨機播放、重複播放、背景圖片自動抓取（Danbooru）、視覺化效果**。  
不需要伺服器，直接部署在 GitHub Pages 即可使用。

---

## 📂 專案結構

├── index.html # 主入口 (HTML 最小化，掛 CSS/JS)
├── assets/
│ ├── css/
│ │ └── style.css # 全部樣式
│ ├── js/
│ │ ├── player.js # 播放器主控制 (播放/暫停/切歌/隨機/重複)
│ │ ├── ui.js # UI 控制 (清單/設定面板/按鈕事件)
│ │ └── viz.js # 視覺化 (等化器/進度環)
│ └── img/ # 靜態圖標、預設封面
├── music/ # 音樂檔案 (支援子資料夾)
│ ├── th01/
│ ├── ...
│ └── th18/
├── data/ # JSON 檔（GitHub Actions 自動生成）
│ ├── tracks.json
│ └── images.json
└── .github/
└── workflows/
└── deploy.yml # Actions 腳本，自動生成 JSON + 部署