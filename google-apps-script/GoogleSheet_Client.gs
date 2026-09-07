/**
 * =========================================================================
 * Google Sheet 差勤系統 - 程式庫橋接端 (Library Client Bridge)
 * 引用 Apps Script 程式庫 (Library):
 * 程式庫網址: https://script.google.com/macros/library/d/1Hg-tTkKWKvQ_W2I-kAbOklCIp-HNjRCkplpj47P2gHZ-VmaT2n18BEqd/1
 * 程式庫 ID: 1Hg-tTkKWKvQ_W2I-kAbOklCIp-HNjRCkplpj47P2gHZ-VmaT2n18BEqd
 * 程式庫版本: 1
 * 識別碼 (Identifier): OCTA_API
 * =========================================================================
 * 
 * 【使用步驟】：
 * 1. 在您的 Google Sheet 頂部選單點選「擴充功能 (Extensions)」>「Apps Script」。
 * 2. 於左側側邊欄「程式庫 (Libraries)」點擊「+」新增程式庫。
 * 3. 貼上指令碼 ID：1Hg-tTkKWKvQ_W2I-kAbOklCIp-HNjRCkplpj47P2gHZ-VmaT2n18BEqd
 * 4. 點擊「查詢」，版本選擇「1」，識別碼輸入「OCTA_API」，點擊「新增」。
 * 5. 將本檔案程式碼複製貼入 Google Sheet 的 Apps Script 編輯器中儲存。
 * 6. 首次設定：上方函式選取「initDatabase」並點擊「執行」，自動為此 Google Sheet 建置 7 大工作表與種子資料！
 * 7. 部署 Web API：點選右上角「部署」>「新增部署作業」
 *    - 類型：網頁應用程式 (Web app)
 *    - 執行身分：我 (Me)
 *    - 誰可以存取：所有人 (Anyone)
 * 8. 複製產生的網頁應用程式網址 (Web App URL)，貼入差勤系統前端的「系統設定」即完成連線！
 */

function doGet(e) {
  return OCTA_API.doGet(e);
}

function doPost(e) {
  return OCTA_API.doPost(e);
}

/**
 * 一鍵資料庫初始化與建表 (包含 users, leave_types, leave_balances, leave_requests 等)
 * @param {boolean} forceReset 是否強制清空並重置回初始種子資料 (預設 false 保留現存資料)
 */
function initDatabase(forceReset) {
  return OCTA_API.initDatabase(forceReset || false);
}

/**
 * 手動同步法定特休額度 (依據 users 表之到職日自動計算歷年特休並更新 leave_balances)
 */
function syncStatutoryAnnualLeaves() {
  return OCTA_API.syncStatutoryAnnualLeaves();
}

/**
 * 手動同步國定假日表 (補齊 2026-2030 年假日與補班日)
 */
function syncHolidays() {
  return OCTA_API.syncHolidays();
}
