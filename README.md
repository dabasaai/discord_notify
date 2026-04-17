# discord-notify

內部 Discord 通知 API — 呼叫一次 HTTP 端點就把訊息發到指定 Discord 頻道，不用每個服務自己整合 Discord SDK。

## 特色

- 單一 Discord Bot 管理所有頻道（不需每頻道建 webhook）
- `channels.json` 熱重載，新增頻道免重啟（chokidar + parse 失敗保留舊設定）
- Embed 格式，5 種 level：`info` / `success` / `warning` / `error` / `critical`
- Discord API 失敗自動重試（5xx 指數退避、429 遵守 `retry_after`、403/404 不重試）
- Bot 斷線透過 `ALERT_COMMAND`（例如 `tg-notify`）告警
- Docker 容器化，對外只綁 `127.0.0.1:<PORT>`，由 frpc 自行轉發

## 快速開始

```bash
cp .env.example .env
cp channels.example.json channels.json
# 填入 .env 的 DISCORD_BOT_TOKEN 與 API_KEY
# 編輯 channels.json 填入實際的 Discord Channel ID

docker compose up -d --build
curl http://127.0.0.1:3020/health
```

## 環境變數

| 變數 | 必填 | 說明 |
|------|------|------|
| `DISCORD_BOT_TOKEN` | ✅ | Bot Token（需 `Send Messages` + `Embed Links` 權限） |
| `API_KEY` | ✅ | 呼叫方需在 `x-api-key` header 帶入 |
| `PORT` | | 容器內監聽 port，預設 `3020` |
| `CHANNELS_FILE` | | channels.json 路徑，預設 `/app/channels.json` |
| `ALERT_COMMAND` | | Bot 斷線時執行的指令，例如 `tg-notify`。留空則只寫 log |

## API

### `POST /notify`

發送通知。需 `x-api-key` header。

```bash
curl -X POST http://127.0.0.1:3020/notify \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "deploy",
    "title": "部署完成",
    "level": "success",
    "message": "api v1.2.3 已上線",
    "service": "deploy-bot",
    "fields": [{ "name": "Commit", "value": "abc123", "inline": true }],
    "mention": "@here"
  }'
```

| 參數 | 必填 | 說明 |
|------|------|------|
| `channel` | ✅ | `channels.json` 的 key |
| `title` | ✅ | 通知標題 |
| `level` | | `info`（預設）/ `success` / `warning` / `error` / `critical` |
| `message` | | 詳細說明 |
| `service` | | 發送方名稱，顯示於 footer |
| `fields` | | `[{ name, value, inline? }]`，最多 25 個 |
| `mention` | | Discord mention，如 `"@here"` 或 `"<@user_id>"` |

**回應狀態碼**

- `200` 成功，回傳 `{ ok, messageId, channel }`
- `400` 參數錯誤或頻道不存在 / Bot 無權限
- `401` API Key 錯誤
- `502` Discord 呼叫失敗（已重試）
- `503` Bot 尚未就緒

### `GET /channels`

列出所有已登記頻道。需 `x-api-key`。

### `GET /health`

健康檢查，回傳 `{ status, botReady, channelCount }`。**不需**認證。

## 頻道管理

編輯 `channels.json`：

```json
{
  "deploy": { "channelId": "123456789012345678", "label": "部署紀錄" },
  "error":  { "channelId": "987654321098765432", "label": "錯誤警報" }
}
```

存檔後自動重載，不需重啟容器。若 JSON 格式錯誤，服務會保留前一份有效設定並在 log 提示。

**Bot 權限**：邀請 Bot 進伺服器時，只需 `Send Messages` + `Embed Links`。

## frpc 範例

對外暴露由使用者自行在 frpc 設定：

```ini
[discord-notify]
type = tcp
local_ip = 127.0.0.1
local_port = 3020
remote_port = 3020
```

## CLI 腳本

`scripts/dn` 提供命令列快速發送通知，依賴 `curl` + `jq`。

```bash
# 安裝（把腳本連結到 PATH）
ln -s "$(pwd)/scripts/dn" ~/.local/bin/dn

# 使用
dn --health                              # 健康檢查
dn --list                                # 列出頻道
dn deploy "部署完成" "v1.2.3" -l success -s ci
./build.sh && dn deploy "Build OK" -l success || dn error "Build Fail" -l error -m "@here"
tail -100 /var/log/app.log | dn error "錯誤" --stdin -l error
dn deploy "備份完成" -f "筆數=12340:inline" -f "耗時=45s:inline"
```

腳本會自動從當前目錄或專案根的 `.env` 讀取 `DISCORD_NOTIFY_KEY`（或 `API_KEY`）和 `DISCORD_NOTIFY_URL`。詳見 `dn --help`。

## 開發與測試

```bash
npm install
npm test            # 跑單元 + 整合測試
npm run dev         # 本機啟動（需 .env 與 channels.json）
```

## 擴充方向

- Rate limit
- 多 API Key + 來源追蹤
- 通知紀錄入庫
- Discord Slash Command
