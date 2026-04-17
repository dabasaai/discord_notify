## Discord Notify API — 設計說明

### 目標

提供公司內部開發者一個統一的 HTTP API，在開發過程中遇到需要通知或紀錄的情境時，呼叫一次就能將訊息發送到指定的 Discord 頻道，不需要每個服務自己整合 Discord SDK。

---

### 技術選型

| 項目 | 選擇 | 原因 |
|------|------|------|
| 執行環境 | Docker 容器化 | 符合 CLAUDE.md 規範，環境一致、易部署 |
| Node 版本 | Node 22 LTS（由 Dockerfile 固定） | 最新 LTS，生命週期長 |
| 框架 | Node.js + Express | 輕量、易維護 |
| Discord 整合 | discord.js Bot | 單一 token 管理所有頻道，不需每頻道各建 webhook |
| 頻道設定 | `channels.json` + `chokidar` 熱重載 | 新增頻道不需改程式碼、不需重啟服務；`chokidar` 比原生 `fs.watch` 穩定 |
| 認證 | API Key（`x-api-key` Header） | 內部服務使用，簡單夠用 |
| 對外暴露 | 只綁 localhost port，由 frpc 轉發 | 不動 Caddy 設定檔，新增服務零成本 |
| 部署 | Oracle ARM（Dabasa）現有機器 | 沿用既有基礎設施 |

---

### API 端點

**`POST /notify`** — 發送通知

| 參數 | 必填 | 說明 |
|------|------|------|
| `channel` | ✅ | 頻道別名，對應 `channels.json` 的 key |
| `title` | ✅ | 通知標題 |
| `level` | | `info` / `success` / `warning` / `error` / `critical`（預設 `info`）|
| `message` | | 詳細說明 |
| `service` | | 發送方服務名稱，顯示於 embed footer |
| `fields` | | 額外欄位陣列 `[{ name, value, inline? }]` |
| `mention` | | Discord mention，如 `"@here"` |

**`GET /channels`** — 列出目前所有可用頻道與對應 Channel ID

**`GET /health`** — 健康檢查，同時回傳 Bot 是否在線

---

### 頻道管理

頻道設定集中維護於 `channels.json`，格式為**頻道別名 → Discord Channel ID 與顯示名稱**的對照表：

```json
{
  "deploy": { "channelId": "123456789012345678", "label": "部署紀錄" },
  "error":  { "channelId": "987654321098765432", "label": "錯誤警報" }
}
```

`channelLoader.js` 負責在服務啟動時讀入此檔案，並以 `chokidar` 持續監聽。檔案有變動時自動重新載入，**新增或修改頻道不需重啟服務**，改完存檔下一次請求即生效。

**容錯處理**：

- `chokidar` 內建 debounce，避免編輯器以 rename 方式覆寫檔案造成漏事件或重複觸發
- `channels.json` 若解析失敗（JSON 格式錯誤），**保留前一份有效設定**並 log 警告，不讓服務崩潰
- 檔案被掛載在容器外（volume mount），修改主機檔案即可熱更新

Bot 需被邀請進 Discord 伺服器，僅需 `Send Messages` 與 `Embed Links` 兩個權限。

---

### 通知格式

訊息以 Discord **Embed** 呈現：

| level | 顏色 | Emoji | 適用情境 |
|-------|------|-------|---------|
| `info` | 藍 | ℹ️ | 一般紀錄 |
| `success` | 綠 | ✅ | 部署成功、任務完成 |
| `warning` | 黃 | ⚠️ | 需注意但未中斷 |
| `error` | 紅 | 🚨 | 發生錯誤 |
| `critical` | 深紅 | 🔥 | 嚴重事故 |

Embed 包含標題、說明文字、可選的額外欄位、時間戳記，以及顯示服務名稱的 footer。`mention` 參數可附加於訊息內容前，觸發相關人員通知。

---

### Discord API 失敗處理

- 遇到暫時性錯誤（5xx、網路超時）**自動重試 2 次**，指數退避（500ms、1500ms）
- 重試仍失敗則回傳 `502 Bad Gateway`，錯誤內容 log 完整堆疊
- Rate limit（429）遵守 Discord 回傳的 `retry_after`，不盲目重試
- 頻道不存在或 Bot 無權限（403/404）直接回傳 `400`，不重試

---

### 認證機制

- 所有請求需在 HTTP Header 帶 `x-api-key`，與 `.env` 中的 `API_KEY` 比對
- 初版採**單一 API Key**，簡單夠用
- 未來若要做 rate limit 或來源追蹤，再改為**多把 Key + 服務別名對照表**（格式預留：`API_KEYS={"deploy-bot": "xxx", "error-reporter": "yyy"}`）
- Bot Token 與 API Key 均存於 `.env`，不進版本控制

---

### Bot 連線狀態監控

- `/health` 端點回傳 `bot.isReady()` 狀態，方便外部監控
- Bot 斷線事件（`disconnect` / `shardError`）觸發 `tg-notify` 告警
- Discord Token 失效時服務仍可接受請求但會回傳 `503`，同時持續嘗試重連

---

### 部署方式

- **Dockerfile**：基於 `node:22-alpine`，multi-stage build，最終映像不含 dev 依賴
- **docker-compose.yml**：管理容器生命週期，掛載 `channels.json` 與 `.env`
- **Port**：容器內 `3000`，對主機只綁 `127.0.0.1:<PORT>`（PORT 啟動前查 `~/.local/state/port-registry.yaml` 選未佔用者）
- **對外**：使用者自行在 frpc 設定轉發該 port，**Caddy 設定完全不動**
- 服務啟動成功後執行：
  - 寫入 `~/.local/state/port-registry.yaml`
  - `tg-notify "✅ Dabasa 新服務登記：discord-notify → port [XXXX]"`

---

### 擴充方向（未來）

- 加入 rate limit，防止誤用大量發送
- 支援 slash command，讓開發者直接在 Discord 觸發操作
- 通知記錄寫入資料庫，方便事後查詢與統計
- 多 API Key 分服務追蹤來源

---

設計已補完，可以開始實作。
