# discord-notify API 使用說明

內部服務用的 Discord 通知 API。呼叫一次 HTTP 端點就能把訊息發到指定頻道。

---

## 基本資訊

| 項目 | 值 |
|------|------|
| Base URL（對外） | `https://d_notify.contree.app` |
| Base URL（內網） | `https://d_notify.contree.app` |
| 認證方式 | HTTP Header `x-api-key`（`/health` 除外） |
| Content-Type | `application/json` |
| 字元限制 | title ≤ 256、message ≤ 4000、fields ≤ 25 個、每個 field value ≤ 1024 |

> API Key 由管理員分配。請**不要**把 Key 寫在前端、commit 到 git，或貼在聊天室。

---

## 環境準備（呼叫端）

建議把 Key 放在呼叫方自己的 `.env`：

```bash
# ~/your-service/.env
DISCORD_NOTIFY_URL=https://d_notify.contree.app
DISCORD_NOTIFY_KEY=<向管理員索取>
```

---

## 端點總覽

| Method | Path | 用途 | 需要 API Key |
|--------|------|------|--------------|
| `POST` | `/notify` | 發送一則通知 | ✅ |
| `GET`  | `/channels` | 列出所有可用頻道 | ✅ |
| `GET`  | `/health` | 健康檢查 | ❌ |

---

## `POST /notify` — 發送通知

### 請求參數

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `channel` | string | ✅ | 頻道別名，必須是 `/channels` 清單中的 key（**不分大小寫**） |
| `title` | string | ✅ | 通知標題（會加上等級 emoji） |
| `level` | string |  | `info`（預設）/ `success` / `warning` / `error` / `critical` |
| `message` | string |  | 詳細內容，支援 Markdown |
| `service` | string |  | 發送方名稱，顯示於 embed footer（推薦填） |
| `fields` | array |  | 額外欄位，格式 `[{ name, value, inline? }]` |
| `mention` | string |  | Discord mention，如 `"@here"`、`"<@USER_ID>"`、`"<@&ROLE_ID>"` |

### 回應

**成功 `200`**
```json
{ "ok": true, "messageId": "1494595458084114533", "channel": "deploy" }
```

**失敗**

| 狀態碼 | 情境 | 回應範例 |
|--------|------|----------|
| `400` | 參數錯誤 / 未知頻道 / Bot 無該頻道權限 | `{"error":"unknown channel: xxx"}` |
| `401` | API Key 錯誤或缺失 | `{"error":"unauthorized"}` |
| `502` | Discord API 呼叫失敗（已重試 2 次） | `{"error":"discord send failed","detail":"..."}` |
| `503` | Discord Bot 尚未就緒 | `{"error":"discord bot not ready"}` |

---

## `GET /channels` — 列出頻道

用來確認目前有哪些 alias 可用。

```bash
curl https://d_notify.contree.app/channels -H "x-api-key: $DISCORD_NOTIFY_KEY"
```

**回應**
```json
{
  "channels": [
    { "alias": "deploy", "channelId": "1494595000401399849", "label": "部署紀錄" },
    { "alias": "error",  "channelId": "1494594901357363362", "label": "錯誤警報" }
  ]
}
```

---

## `GET /health` — 健康檢查

不需認證，適合給 oncall / 監控系統用。

```bash
curl https://d_notify.contree.app/health
```

```json
{ "status": "ok", "botReady": true, "channelCount": 2 }
```

`botReady: false` 代表 Bot 斷線 — 此時 `/notify` 會回 `503`。

---

## 使用範例

### curl

```bash
curl -X POST https://d_notify.contree.app/notify \
  -H "x-api-key: $DISCORD_NOTIFY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "deploy",
    "title": "api v1.2.3 部署完成",
    "level": "success",
    "message": "生產環境已更新，健康檢查通過",
    "service": "ci-runner",
    "fields": [
      { "name": "Commit", "value": "`abc1234`", "inline": true },
      { "name": "耗時",    "value": "3m12s",     "inline": true }
    ]
  }'
```

### Node.js（fetch）

```js
async function notify(body) {
  const res = await fetch(`${process.env.DISCORD_NOTIFY_URL}/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.DISCORD_NOTIFY_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`notify failed: ${res.status} ${await res.text()}`);
  return res.json();
}

await notify({
  channel: 'error',
  title: 'API 回應異常',
  level: 'error',
  message: `DB 連線 timeout: ${err.message}`,
  service: 'order-api',
  mention: '@here',
});
```

### Python（requests）

```python
import os, requests

def notify(payload):
    r = requests.post(
        f"{os.environ['DISCORD_NOTIFY_URL']}/notify",
        headers={"x-api-key": os.environ["DISCORD_NOTIFY_KEY"]},
        json=payload,
        timeout=5,
    )
    r.raise_for_status()
    return r.json()

notify({
    "channel": "deploy",
    "title": "批次任務完成",
    "level": "success",
    "service": "daily-report",
    "fields": [{"name": "筆數", "value": "12,340", "inline": True}],
})
```

### Bash（shell script 中嵌入）

```bash
notify() {
  curl -s -X POST "$DISCORD_NOTIFY_URL/notify" \
    -H "x-api-key: $DISCORD_NOTIFY_KEY" \
    -H "Content-Type: application/json" \
    -d "$1" >/dev/null
}

if ./deploy.sh; then
  notify '{"channel":"deploy","title":"部署完成","level":"success","service":"'"$HOSTNAME"'"}'
else
  notify '{"channel":"error","title":"部署失敗","level":"error","service":"'"$HOSTNAME"'","mention":"@here"}'
fi
```

---

## Level 使用慣例

| level | 顏色 | Emoji | 什麼時候用 |
|-------|------|-------|-----------|
| `info` | 藍 | ℹ️ | 一般資訊、流程進度、紀錄 |
| `success` | 綠 | ✅ | 部署成功、任務完成、檢查通過 |
| `warning` | 黃 | ⚠️ | 需注意但未中斷服務（接近配額、降級處理） |
| `error` | 紅 | 🚨 | 明確錯誤，需要人員查看 |
| `critical` | 深紅 | 🔥 | 生產事故、資料遺失風險、立刻介入 |

> 建議：`critical` 務必搭配 `mention: "@here"` 或特定 role。

---

## Mention 語法

| 目標 | 寫法 |
|------|------|
| 線上的人 | `"@here"` |
| 整個伺服器 | `"@everyone"` |
| 特定使用者 | `"<@使用者 ID>"` |
| 特定 role | `"<@&role ID>"` |

> 使用者 ID / role ID 取得方式：Discord 設定 → 進階 → 開啟開發者模式，對人/role 按右鍵複製 ID。

---

## 錯誤處理建議

- **不要讓通知失敗擋住主流程**：發通知最多重試 1 次，失敗就吞掉並寫自己的 log，不要 throw 打斷業務邏輯
- **回應逾時設 3~5 秒**：服務內部已有重試，呼叫方不需再長時間等待
- **429 / 502 / 503** 可短暫重試；**400 / 401** 不要重試，代表設定或程式有錯

範例（Node.js）：

```js
async function safeNotify(body) {
  try {
    const ctrl = AbortSignal.timeout(5000);
    await fetch(`${process.env.DISCORD_NOTIFY_URL}/notify`, {
      method: 'POST',
      signal: ctrl,
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.DISCORD_NOTIFY_KEY },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn('notify failed, skipped:', err.message);
  }
}
```

---

## 新增 / 修改頻道

1. 請管理員編輯伺服器上的 `config/channels.json`
2. 存檔後**自動熱重載**，不需重啟服務
3. 呼叫 `GET /channels` 確認新 alias 已出現

---

## 常見問題

**Q: 回傳 `unknown channel`？**
A: `channels.json` 還沒加該 alias，或是拼錯。先打 `/channels` 確認。

**Q: 回傳 `400` 且 `code: "FORBIDDEN_OR_MISSING"`？**
A: Bot 還沒被邀請進該頻道所在伺服器，或該頻道的權限設定沒給 Bot 發訊息。到 Discord 伺服器設定 → 頻道權限，把 Bot（或 Bot 的 role）加進去並勾「傳送訊息」+「嵌入連結」。

**Q: 回傳 `503`？**
A: Bot 暫時斷線，服務會自動重連。稍候再試，或看 `/health` 狀態。

**Q: 怎麼知道訊息真的送出了？**
A: `200` 回應會帶 `messageId`，可以到 Discord 對照。沒 `200` 就當失敗。

---

## 支援與回報

問題請在內部 issue tracker 回報，並附上：

- 呼叫的 request body（遮掉 API Key）
- 回應的 status code 與 body
- 發生時間（含時區）
