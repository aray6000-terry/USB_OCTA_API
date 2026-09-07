# 智慧請假與補休管理系統 (Leave & Comp-Time Management System)

一套為企業差勤打造的現代化、高可用請假與補休管理系統。後端資料庫原生支援 **Google Sheet** (透過 Google Apps Script REST API)，前端採用現代響應式 Web & Mobile 介面，內建智慧工時試算、衝突防呆、額度鎖定、多階動態審核鏈、銷假退額及加班補休存摺機制。

---

## 🌟 核心功能亮點

1. **標準工時與智慧假日扣除引擎**：
   - 每日標準上班時間：**08:30 - 18:00**（每日標準工時 8.0 小時）。
   - 上半天工時：`08:30 - 12:00` (3.5 小時)。
   - 午休時間：**12:00 - 13:30**（自動扣除 1.5 小時）。
   - 下半天工時：`13:30 - 18:00` (4.5 小時)。
   - 跨日請假自動跳過週六、週日與 **2026 國定假日/公休日**。
2. **防呆檢核與額度鎖定 (Pre-validation & Locking)**：
   - **時段衝突檢查 (Overlapping Check)**：送出前檢核重複申請時段並立即阻擋。
   - **額度鎖定 (Locking)**：送出申請即計入 `pending_hours`，避免重複扣抵。
   - **餘額防呆**：$\text{可用餘額} = \text{總額} - \text{已用} - \text{鎖定中}$，不足時禁止送出。
3. **動態多階審核鏈 (Dynamic Approval Workflow)**：
   - $\le 3$ 天（$\le 24$ 小時）：由**直屬主管**單階簽核即完成。
   - $> 3$ 天（$> 24$ 小時）：由**直屬主管初審** $\to$ 自動轉交**人資 (HR) 進行第二階複核**。
4. **請假撤銷與銷假退額機制 (Cancellation Flow)**：
   - 未審核單據：員工可一鍵直接「撤銷」，立即釋放 `pending_hours`。
   - 已核准單據：發起「銷假申請」，經主管/HR審核通過後自動退還 `used_hours`。
5. **加班申報與補休存摺 (Overtime & Comp-Time)**：
   - 加班申報表（支援平日加班 1.34x、假日加班 1.67x 等換算倍率）。
   - 主管核准後自動轉換補休額度入帳，員工可直接於請假單選擇「補休假」進行扣抵。
6. **Google Sheet 後端一鍵建表**：
   - 提供 `Code.gs`，在 Google Sheet Apps Script 執行 `initDatabase()` 即一鍵建妥所有表格與種子資料。
   - 支援無縫切換【Google Sheet 雲端同步】與【本機展示資料庫】。

---

## 📁 檔案結構

```
d:\#1_GOOGLE_Antigravity\請假系統/
├── index.html                      # 現代化前端單頁應用程式入口 (Web & Mobile)
├── css/
│   └── style.css                   # 設計系統、Glassmorphism、卡片、表單與響應式樣式
├── js/
│   ├── config.js                   # 系統工時常數、假別規則與 2026 國定假日
│   ├── engine.js                   # 智慧工時試算、衝突防呆與審核鏈計算引擎
│   ├── mock-data.js                # 本機展示模擬資料庫與 LocalStorage 持久化
│   ├── api.js                      # 統一 API 服務層 (自動切換 Google Apps Script 或 Mock)
│   └── app.js                      # 前端互動邏輯、身分切換、表單驗證與彈窗控制器
└── google-apps-script/
    ├── Code.gs                     # Google Apps Script 完整後端與資料庫初始化腳本
    └── appsscript.json             # GAS 專案設定檔
```

---

## 📊 Google Sheet 資料庫 Schema 設計

| 工作表名稱 (Sheet) | 核心欄位說明 |
| :--- | :--- |
| **`users`** | `id`, `name`, `email`, `password_hash`, `department_id`, `department_name`, `manager_id`, `role`, `created_at` |
| **`leave_types`** | `id`, `name`, `min_unit`, `requires_attachment`, `is_paid`, `description` |
| **`leave_balances`** | `id`, `user_id`, `leave_type_id`, `year`, `total_hours`, `used_hours`, `pending_hours` |
| **`leave_requests`** | `id`, `user_id`, `leave_type_id`, `start_time`, `end_time`, `total_hours`, `reason`, `attachment_url`, `status`, `current_step`, `applied_at` |
| **`overtime_requests`**| `id`, `user_id`, `date`, `start_time`, `end_time`, `hours`, `comp_rate`, `comp_hours`, `reason`, `status`, `expiry_date`, `applied_at` |
| **`approval_logs`** | `id`, `request_id`, `request_type`, `approver_id`, `approver_role`, `status`, `comment`, `acted_at` |
| **`holidays`** | `date`, `name`, `is_workday` (國定假日與補班日) |

---

## 🚀 快速開始使用

### 1. 本機即時預覽與體驗
直接使用瀏覽器開啟 `index.html`，系統內建預設資料庫：
- **頂部身分切換器**：可切換 **王小明 (員工)**、**陳主管 (主管)**、**林經理 (HR/Admin)** 體驗完整申請、動態審核與銷假退額流程。

### 2. 串接 Google Sheet 線上資料庫

系統支援兩種串接方式，**強烈建議採用方式 A (程式庫 Library 模式)**：

#### 🌟 方式 A：採用 Google Apps Script 程式庫 (Library) 模式 (推薦)
1. 開啟 [Google Sheets](https://sheets.new) 建立新試算表。
2. 點選頂部選單 **擴充功能 (Extensions) > Apps Script**。
3. 在左側側邊欄「**程式庫 (Libraries)**」點擊「**+**」新增：
   - **指令碼 ID**：`1Hg-tTkKWKvQ_W2I-kAbOklCIp-HNjRCkplpj47P2gHZ-VmaT2n18BEqd`
   - **程式庫網址**：`https://script.google.com/macros/library/d/1Hg-tTkKWKvQ_W2I-kAbOklCIp-HNjRCkplpj47P2gHZ-VmaT2n18BEqd/1`
   - 點擊「查詢」，**版本**選擇 `1`，**識別碼 (Identifier)** 輸入 `OCTA_API`，點擊「新增」。
4. 將專案中的 [`google-apps-script/GoogleSheet_Client.gs`](file:///google-apps-script/GoogleSheet_Client.gs) 內容複製貼上至編輯器中儲存。
5. 上方執行函式選擇 `initDatabase` 並點擊「執行」，即可**自動在此試算表建置 7 大工作表與種子資料**。
6. 點擊右上角 **部署 > 新增部署作業**：
   - 類型：**網頁應用程式 (Web app)**
   - 執行身分：**我 (Me)**
   - 誰可以存取：**所有人 (Anyone)**
7. 將產生的 Web App URL 複製，在系統的「系統設定」頁面貼上並儲存即可完成雲端串接！

#### 方式 B：獨立複製腳本模式
1. 開啟 [Google Sheets](https://sheets.new) 建立新試算表。
2. 點選頂部選單 **擴充功能 (Extensions) > Apps Script**。
3. 將 [`google-apps-script/Code.gs`](file:///google-apps-script/Code.gs) 完整複製並貼上到編輯器。
4. 在上方執行函式選擇 `initDatabase` 並點擊「執行」完成建表。
5. 點擊右上角 **部署 > 新增部署作業**，類型選擇 **網路應用程式 (Web app)**，誰可以存取設為 **所有人 (Anyone)**，複製產生的 URL。

### 3. 線上資料庫帳號與權限一覽 (預設密碼皆為 123456)

| 員工編號 | 姓名 | 電子信箱 (Email) | 部門 | 系統角色 | 權限說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **EMP001** | 李泰叡 | `aray6000@hotmail.com` | 管理部 | **Admin** | 系統最高管理者 (可管理資料庫與人事差勤) |
| **EMP004** | 劉彩雲 | `amyliupp@gmail.com` | 人資部 | **HR** | 人資主管 (負責人事差勤、歷年制特休與二階簽核) |
| **EMP002** | 陳勃毅 | `tony6070591135@gmail.com` | 研發部 | Employee | 研發部同仁 |
| **EMP003** | 何貫宇 | `abc35789abc35789@gmail.com` | 業務部 | Employee | 業務部同仁 |
| **EMP005** | 廖國寓 | `taisan648@gmail.com` | 研發部 | Employee | 研發部同仁 |
| **EMP007** | 簡昕儀 | `kitty89092616@gmail.com` | 研發部 | Employee | 研發部同仁 |
| **EMP008** | 江嘉偉 | `ccw891129@gmail.com` | 研發部 | Employee | 研發部同仁 |
| **EMP009** | 徐堉桉 | `yy0937010806@gmail.com` | 研發部 | Employee | 研發部同仁 |
| **EMP010** | 侯凱嚴 | `ken.work345@gmail.com` | 研發部 | Employee | 研發部同仁 |
| **EMP011** | 傅秉和 | `keionmio028@gmail.com` | 研發部 | Employee | 研發部同仁 |

> **提示**：登入畫面下方已提供快捷按鈕，可一鍵直接填入人資主管 (`amyliupp@gmail.com`)、最高管理者 (`aray6000@hotmail.com`) 與同仁帳號！

