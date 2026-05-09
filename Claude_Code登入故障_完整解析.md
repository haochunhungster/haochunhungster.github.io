# Claude Code 登入故障：完整解析

> Windows 11 + Claude Code 2.1.138 上遇到的一個棘手登入卡死問題，
> 從症狀、時間線、根因到修法的完整 post-mortem，分享給可能遇到同樣狀況的人。

**故障日期**：2026-05-09
**Claude Code 版本**：2.1.138（Windows 11）
**結案狀態**：已修復 ✅

---

## 一句話講發生什麼事

> 後台一直在下載大模型的時候，Claude Code 突然跳 `EEXIST` 錯誤，登出後再也登不回來。最後刪掉整個 `.claude\` 資料夾才救活。

---

## 第一部分：症狀（你會看到的東西）

### 故障當下
```
API Error: EEXIST: file already exists, mkdir 'C:\Users\<user>\.claude'
```

### 想救回來時看到的
- `claude auth login --claudeai` → 顯示 ✅ Login successful
- `claude auth status` → ❌ Not logged in
- `claude -p "say ok"` → ❌ Not logged in · Please run /login

> 兩個訊息互相打架，所以一直找不到問題出在哪。

---

## 第二部分：時間線（從備份的檔案還原出來的事實）

| 時間（台北） | 發生了什麼 | 證據 |
|---|---|---|
| 16:09 | 一個 task 起動，建立 `.lock` 鎖檔 | `tasks\<uuid-1>\.lock` 存在但未釋放 |
| 17:16 | 另一個 task 起動 | `tasks\<uuid-2>\.lock` |
| 17:35 | task 寫到第 7 步後 process 異常結束，**第一次 crash 但沒注意** | `.lock` 沒被刪、`7.json` 後沒繼續 |
| 17:35 ~ 23:18 | Claude Code 帶著 stale lock 又跑了 5+ 小時 | mtime 持續更新但 lock 檔不變 |
| 23:18:39 | 發覺有狀況，按 `/logout` | `history.jsonl` 第 N 行 |
| 23:18 ~ 23:23 | logout **成功清掉了** `.credentials.json`，但 `.claude.json` 裡的 oauthAccount metadata 沒清乾淨 | 備份的 `.claude\` 裡找不到 `.credentials.json` |
| 23:23:58 | 按 `/login` | `history.jsonl` 最後一行 |
| 23:23 ~ 23:27 | login 試著建立子目錄 + 寫新 token，**踩到 stale lock + AV/IO race** → 噴 EEXIST | `settings.json` mtime 卡在 23:27 不再更新 |

---

## 第三部分：根本原因（為什麼會炸）

### 直接原因
**Node.js 在 Windows 上做 `mkdir` 時，遇到「目錄已經存在但 metadata 不一致」就會丟 EEXIST。**

> 「目錄不一致」常見的成因：
> - 防毒軟體（Windows Defender / 預載 AV）瞬間鎖住目錄做掃描
> - 後台大量 IO（當時 5+ 個 PowerShell 同時下大模型）
> - 殘留的 stale lock 檔讓 Claude Code 內部 state 混亂

### 為什麼錯誤訊息誤導
訊息寫 `file already exists`，看起來像是「`.claude` 變成檔案不是資料夾」。

但實際查證：故障當下 `.claude` 還是正常資料夾（沒有變成檔案、沒有變成 symlink）。

> 「file」在 Node 的訊息裡是「file system entity」通稱，不一定指真的檔案。

### 為什麼登出後登不回來
登出 / 登入流程其實會動到**兩個檔**：

| 檔案路徑 | 存什麼 |
|---|---|
| `C:\Users\<user>\.claude.json` | 帳號 metadata（email、會員類型、權限旗標） |
| `C:\Users\<user>\.claude\.credentials.json` | 真正的 OAuth token |

```
logout 動作只清了 .credentials.json
.claude.json 的 oauthAccount 殘留 stale 狀態
        ↓
  login 重新寫入時遇到殘留資料 + stale lock 檔
        ↓
        EEXIST mkdir 失敗
        ↓
本機 token 從來沒寫成功
（OAuth server 端有回 OK，所以你看到 "Login successful"）
        ↓
auth status 永遠是 Not logged in
```

---

## 第四部分：為什麼那些直覺修法都沒用

| 試了什麼 | 為什麼沒用 |
|---|---|
| 再 `claude auth logout` | credentials 已經被清過，這次是空轉 |
| 關掉所有 claude.exe | 殺得掉 process，殺不掉檔案系統裡的 stale `.lock` |
| 移走 `C:\Users\<user>\.claude.json` | 沒動到 `.claude\tasks\` 裡兩個 stale `.lock` 檔 |
| **刪掉整個 `.claude\` 資料夾** | ✅ 兩個 stale lock + 所有殘留 state 一次清光 |

---

## 第五部分：給未來自己的修法 SOP

### 平時：把 Claude Code 從防毒掃描裡排除（治本）

以**系統管理員**身份開 PowerShell，跑：

```powershell
Add-MpPreference -ExclusionPath "C:\Users\<your-username>\.claude"
Add-MpPreference -ExclusionPath "C:\Users\<your-username>\.claude.json"
Add-MpPreference -ExclusionProcess "claude.exe"
Add-MpPreference -ExclusionProcess "node.exe"
```

> 這個只設一次就好，從此 Defender 不會在 mkdir 時搶走目錄 handle。

### 大量下載時：別用 Invoke-WebRequest 並行

`Invoke-WebRequest` 沒有頻寬限流、沒有斷點續傳，多個並行會把網卡 IO 吃滿，影響 Claude 的 streaming 連線。

下次大下載改用：

```powershell
aria2c -x 4 -s 4 --max-overall-download-limit=20M --continue=true -d 目的資料夾 URL
```

### 真的又跳 EEXIST 時：精準清理（不用大砲）

```powershell
# 1. 清掉所有 stale lock
Get-ChildItem "C:\Users\<your-username>\.claude\tasks" -Recurse -Filter ".lock" `
  | Remove-Item -Force
Get-ChildItem "C:\Users\<your-username>\.claude\sessions" -Recurse -Filter ".lock" `
  -ErrorAction SilentlyContinue | Remove-Item -Force

# 2. 清 auth state 的兩個檔
Remove-Item "C:\Users\<your-username>\.claude\.credentials.json" -Force `
  -ErrorAction SilentlyContinue
Remove-Item "C:\Users\<your-username>\.claude.json" -Force

# 3. 重新登入
claude auth login --claudeai
```

> 這個方式可以**保住** `agents\`、`skills\`、`plugins\`、`projects\`（含記憶）、`history.jsonl`，不必整個資料夾砍掉。

---

## 一頁總結

```
故障：Windows 上後台大下載 + AV 掃描 race → mkdir EEXIST
連鎖：stale .lock + .claude.json 殘留 oauthAccount → logout/login 卡死
誤導：「Login successful」是 server 回應，不代表本機檔寫成功
修復：刪整個 .claude\ 為什麼有效 = 一次清光 stale lock + 殘留 state
預防：把 .claude\ 加進 Defender 排除清單 + 大下載用 aria2c 別用 IWR
```

---

## 補充：能還原這個時間線的關鍵

故障當下若有意識把整個 `.claude\` 資料夾整個複製出來備份，後續的根因分析才有實證；
否則只看 stdout 的 EEXIST 訊息，會永遠停在「應該是 race condition 吧」這種推測。

任何 CLI 工具突然行為錯亂時，**先複製整個 config 目錄出來再做任何修復動作**是最便宜的保險。

---

*本文是真實故障的事後分析。如果你也遇到 Claude Code 在 Windows 上跳 EEXIST、或是 Login successful 但 auth status 是 Not logged in，希望這份紀錄能省你幾小時。*
