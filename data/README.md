# Data 資料夾說明

此資料夾存放由 GitHub Actions 自動產生的檔案：

- `tracks.json`  
  - 由 `/music/` 資料夾內的音樂檔自動掃描生成  
  - 格式範例：
    ```json
    [
      {
        "file": "music/th10/Artist - Title.mp3",
        "title": "Title",
        "artist": "Artist",
        "tags": ["touhou", "th10", "artist", "title"]
      }
    ]
    ```

- `images.json`  
  - 依照 `tracks.json` 的 tags 從 Danbooru API 擷取「rating:safe」圖片生成  
  - 格式範例：
    ```json
    {
      "touhou": [
        { "url": "https://danbooru.donmai.us/data/__xxx.jpg", "source": "post:123456" }
      ],
      "th10": [...]
    }
    ```

---

⚠️ **請不要手動修改這裡的檔案**  
- 每次 push 到 `main`，GitHub Actions 都會自動覆蓋這些檔案。  
- 如果要新增歌曲，請把音樂檔放到 `/music/` 或其子資料夾，然後 push；Actions 會重新生成 `tracks.json` 和 `images.json`。  
- 如果要影響圖片結果，請在檔名或資料夾名稱裡加入合適的 tag。  

---
