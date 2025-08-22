# Data 資料夾說明
此資料夾的檔案由 GitHub Actions 自動產生，請勿手動編輯。
- `tracks.json`：由 `/music/**` 自動掃描音檔生成。
- `images.json`：依 `tracks.json` 的 tags 從 Danbooru 擷取 rating:safe 圖片生成。
新增歌曲：把檔案放到 `/music/` 或子資料夾並 push，Actions 會自動重建這些檔案。
