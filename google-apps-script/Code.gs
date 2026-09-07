/**
 * =========================================================================
 * 企業級智慧請假與補休管理系統 (Leave & Comp-Time Management System)
 * Google Apps Script 後端 API 與 Google Sheet 資料庫引擎
 * =========================================================================
 * 
 * 核心功能：
 * 1. 一鍵自動建立全套資料庫工作表與預設種子資料 (initDatabase)
 * 2. 智慧工時計算引擎 (標準 08:30-18:00，午休 12:00-13:30 扣 1.5h，跳過週末與國定假日)
 * 3. 假別額度防呆與鎖定機制 (Locking: pending_hours / used_hours)
 * 4. 時間重疊衝突檢核 (Overlapping check)
 * 5. 動態審核鏈 (<= 3天直屬主管單簽，> 3天主管+HR雙階簽核)
 * 6. 撤銷與銷假流程 (未審核直撤，已核准送銷假申請並退還額度)
 * 7. 加班申報與補休存摺換算 (加班核准自動注入補休額度)
 */

// ======================== 系統常數設定 ========================
const CONFIG = {
  WORK_START: "08:30",
  WORK_END: "18:00",
  LUNCH_START: "12:00",
  LUNCH_END: "13:30",
  DAILY_WORK_HOURS: 8.0,
  MULTI_TIER_THRESHOLD_HOURS: 24.0, // 超過 24 小時 (3天) 需 HR 雙簽
  SHEETS: {
    USERS: "users",
    LEAVE_TYPES: "leave_types",
    LEAVE_BALANCES: "leave_balances",
    LEAVE_REQUESTS: "leave_requests",
    OVERTIME_REQUESTS: "overtime_requests",
    APPROVAL_LOGS: "approval_logs",
    HOLIDAYS: "holidays"
  }
};

const AUTH_SECRET = "LEAVE_SYS_SECRET_KEY_2026";

function createAuthToken(userId, role) {
  const expireAt = Date.now() + 12 * 60 * 60 * 1000; // 12 小時
  const payload = `${userId}:${role}:${expireAt}`;
  const signature = Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(payload, AUTH_SECRET)
  );
  return `${Utilities.base64Encode(payload)}.${signature}`;
}

function verifyAuthToken(token) {
  if (!token || token.indexOf(".") === -1) return null;
  try {
    const [b64Payload, sig] = token.split(".");
    const payload = Utilities.newBlob(Utilities.base64Decode(b64Payload)).getDataAsString();
    const expectedSig = Utilities.base64Encode(
      Utilities.computeHmacSha256Signature(payload, AUTH_SECRET)
    );
    if (sig !== expectedSig) return null;
    const [userId, role, expireAt] = payload.split(":");
    if (Date.now() > parseInt(expireAt, 10)) return null;
    return { userId, role };
  } catch (e) {
    return null;
  }
}

// ======================== 試算表存取核心 (支援 Google Sheet 容器綁定與 Library 程式庫模式) ========================

function getSpreadsheet() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    try {
      const sheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
      if (sheetId) {
        ss = SpreadsheetApp.openById(sheetId);
      }
    } catch (e) {
      Logger.log("getSpreadsheet openById fallback failed: " + e.message);
    }
  }
  return ss;
}

// ======================== Web App 請求入口 ========================

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  // 處理跨來源資源共享 (CORS)
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    let params = {};
    if (e && e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      params = e.parameter;
    }

    const action = params.action || "ping";
    let result = { success: false, message: "Unknown action" };

    // 依據 action 進行路由分派
    switch (action) {
      case "ping":
        result = { success: true, message: "Leave System API is online.", timestamp: new Date().toISOString() };
        break;

      case "initDatabase":
        result = initDatabase(params.forceReset);
        break;

      case "getBootstrapData":
        result = getBootstrapData(params.userId, params.token);
        break;

      case "login":
        result = loginUser(params.email, params.password);
        break;

      case "calculateHours":
        result = {
          success: true,
          data: calculateLeaveHours(params.startTime, params.endTime)
        };
        break;

      case "login":
        result = loginUser(params.email, params.password);
        break;

      case "applyLeave":
        result = applyLeave(params);
        break;

      case "cancelLeave":
        result = cancelLeave(params);
        break;

      case "approveLeave":
        result = reviewLeave(params, "APPROVED");
        break;

      case "rejectLeave":
        result = reviewLeave(params, "REJECTED");
        break;

      case "applyOvertime":
        result = applyOvertime(params);
        break;

      case "approveOvertime":
        result = reviewOvertime(params, "APPROVED");
        break;

      case "rejectOvertime":
        result = reviewOvertime(params, "REJECTED");
        break;

      case "adminUpdateBalance":
        result = adminUpdateBalance(params);
        break;

      case "adminUpdateUser":
        result = adminUpdateUser(params);
        break;

      case "adminCreateUser":
        result = adminCreateUser(params);
        break;

      case "adminDeleteUser":
        result = adminDeleteUser(params);
        break;

      case "syncStatutoryAnnualLeaves":
        result = syncStatutoryAnnualLeaves();
        break;

      case "syncHolidays":
        result = syncHolidays();
        break;

      case "changePassword":
        result = changePassword(params);
        break;

      default:
        result = { success: false, message: "Action not supported: " + action };
    }

    output.setContent(JSON.stringify(result));
    return output;
  } catch (err) {
    const errorRes = {
      success: false,
      message: err.message || "Internal Server Error",
      stack: err.stack
    };
    output.setContent(JSON.stringify(errorRes));
    return output;
  }
}

// ======================== 資料庫初始化 (一鍵建表與種子資料) ========================

function initDatabase(forceReset) {
  const ss = getSpreadsheet();
  const sheets = CONFIG.SHEETS;
  const isForce = forceReset === true || forceReset === "true";

  // 1. users 表 (新增 hire_date 到職日欄位，涵蓋 8 大部門)
  const userHeaders = ["id", "name", "email", "password_hash", "department_id", "department_name", "manager_id", "role", "hire_date", "created_at"];
  const userSeeds = [
    ["EMP001", "李泰叡", "aray6000@hotmail.com", "123456", "DEPT_MGMT", "管理部", "EMP001", "Admin", "2018-04-16", "2026-01-01 09:00:00"],
    ["EMP002", "陳勃毅", "tony6070591135@gmail.com", "123456", "DEPT_RD", "研發部", "EMP001", "Employee", "2023-08-07", "2026-01-01 09:00:00"],
    ["EMP003", "何貫宇", "abc35789abc35789@gmail.com", "123456", "DEPT_SALES", "業務部", "EMP001", "Employee", "2024-02-26", "2026-01-01 09:00:00"],
    ["EMP004", "劉彩雲", "amyliupp@gmail.com", "123456", "DEPT_HR", "人資部", "EMP001", "HR", "2024-03-18", "2026-01-01 09:00:00"],
    ["EMP005", "廖國寓", "taisan648@gmail.com", "123456", "DEPT_RD", "研發部", "EMP001", "Employee", "2024-10-21", "2026-01-01 09:00:00"],
    ["EMP006", "何瑋恩", "hew183273@gmail.com", "123456", "DEPT_RD", "研發部", "EMP001", "Employee", "2025-03-04", "2026-01-01 09:00:00"],
    ["EMP007", "簡昕儀", "kitty89092616@gmail.com", "123456", "DEPT_RD", "研發部", "EMP001", "Employee", "2025-05-05", "2026-01-01 09:00:00"],
    ["EMP008", "江嘉偉", "ccw891129@gmail.com", "123456", "DEPT_RD", "研發部", "EMP001", "Employee", "2025-07-23", "2026-01-01 09:00:00"],
    ["EMP009", "徐堉桉", "yy0937010806@gmail.com", "123456", "DEPT_RD", "研發部", "EMP001", "Employee", "2025-08-01", "2026-01-01 09:00:00"],
    ["EMP010", "侯凱嚴", "ken.work345@gmail.com", "123456", "DEPT_RD", "研發部", "EMP001", "Employee", "2026-01-12", "2026-01-01 09:00:00"],
    ["EMP011", "傅秉和", "keionmio028@gmail.com", "123456", "DEPT_RD", "研發部", "EMP001", "Employee", "2026-01-12", "2026-01-01 09:00:00"],
    ["EMP012", "蔡倢羚", "a0977001617@gmail.com", "123456", "DEPT_MGMT", "管理部", "EMP001", "Employee", "2026-03-16", "2026-01-01 09:00:00"]
  ];
  setupSheet(ss, sheets.USERS, userHeaders, userSeeds, isForce);

  // 2. leave_types 表
  const leaveTypeHeaders = ["id", "name", "min_unit", "requires_attachment", "is_paid", "description"];
  const leaveTypeSeeds = [
    ["ANNUAL", "特休假", 0.5, false, true, "年度法定特休假，半小時為最小單位，全薪"],
    ["COMP", "補休假", 0.5, false, true, "加班核准後所轉換之補休額度，全薪"],
    ["PERSONAL", "事假", 0.5, false, false, "因個人事務申請，不支薪"],
    ["SICK", "病假", 0.5, false, "半薪", "因病就醫休養，一年內三十日以內半薪，不強制檢附證明"],
    ["MARRIAGE", "婚假", 8.0, true, true, "結婚法定婚假，以天(8h)為單位，全薪，需附結婚證明"],
    ["BEREAVEMENT", "喪假", 8.0, true, true, "親屬喪葬事宜，以天(8h)為單位，全薪，需附證明"],
    ["MENSTRUAL", "生理假", 4.0, false, false, "女性同仁每月一天生理假，以半天(4h)為單位"]
  ];
  setupSheet(ss, sheets.LEAVE_TYPES, leaveTypeHeaders, leaveTypeSeeds, isForce);

  // 3. leave_balances 表
  const balanceHeaders = ["id", "user_id", "leave_type_id", "year", "total_hours", "used_hours", "pending_hours"];
  const balanceSeeds = [
    // 王小明 EMP001 (到職 2024-03-01，滿 2 年法定特休 10天=80h)
    ["BAL_EMP001_ANNUAL_2026", "EMP001", "ANNUAL", 2026, 80.0, 8.0, 0.0],
    ["BAL_EMP001_COMP_2026", "EMP001", "COMP", 2026, 16.0, 0.0, 0.0],
    ["BAL_EMP001_PERSONAL_2026", "EMP001", "PERSONAL", 2026, 112.0, 0.0, 0.0],
    ["BAL_EMP001_SICK_2026", "EMP001", "SICK", 2026, 240.0, 4.0, 0.0],
    // 陳主管 EMP002 (到職 2023-01-15，滿 3 年法定特休 14天=112h)
    ["BAL_EMP002_ANNUAL_2026", "EMP002", "ANNUAL", 2026, 112.0, 16.0, 0.0],
    ["BAL_EMP002_COMP_2026", "EMP002", "COMP", 2026, 24.0, 8.0, 0.0],
    ["BAL_EMP002_PERSONAL_2026", "EMP002", "PERSONAL", 2026, 112.0, 0.0, 0.0],
    ["BAL_EMP002_SICK_2026", "EMP002", "SICK", 2026, 240.0, 0.0, 0.0],
    // 林經理 EMP003 (到職 2020-07-01，滿 5 年法定特休 15天=120h)
    ["BAL_EMP003_ANNUAL_2026", "EMP003", "ANNUAL", 2026, 120.0, 0.0, 0.0],
    ["BAL_EMP003_COMP_2026", "EMP003", "COMP", 2026, 0.0, 0.0, 0.0],
    ["BAL_EMP003_PERSONAL_2026", "EMP003", "PERSONAL", 2026, 112.0, 0.0, 0.0],
    ["BAL_EMP003_SICK_2026", "EMP003", "SICK", 2026, 240.0, 0.0, 0.0],
    // 張大春 EMP004 (到職 2025-10-01，滿 6 個月法定特休 3天=24h)
    ["BAL_EMP004_ANNUAL_2026", "EMP004", "ANNUAL", 2026, 24.0, 0.0, 0.0],
    ["BAL_EMP004_COMP_2026", "EMP004", "COMP", 2026, 0.0, 0.0, 0.0],
    ["BAL_EMP004_PERSONAL_2026", "EMP004", "PERSONAL", 2026, 112.0, 0.0, 0.0],
    ["BAL_EMP004_SICK_2026", "EMP004", "SICK", 2026, 240.0, 0.0, 0.0],
    // 李美麗 EMP005 (到職 2024-08-01，滿 1 年法定特休 7天=56h)
    ["BAL_EMP005_ANNUAL_2026", "EMP005", "ANNUAL", 2026, 56.0, 0.0, 0.0],
    ["BAL_EMP005_COMP_2026", "EMP005", "COMP", 2026, 0.0, 0.0, 0.0],
    ["BAL_EMP005_PERSONAL_2026", "EMP005", "PERSONAL", 2026, 112.0, 0.0, 0.0],
    ["BAL_EMP005_SICK_2026", "EMP005", "SICK", 2026, 240.0, 0.0, 0.0]
  ];
  setupSheet(ss, sheets.LEAVE_BALANCES, balanceHeaders, balanceSeeds, isForce);

  // 同步法定特休額度
  syncStatutoryAnnualLeaves(ss);

  // 4. leave_requests 表
  const requestHeaders = ["id", "user_id", "leave_type_id", "start_time", "end_time", "total_hours", "reason", "attachment_url", "status", "current_step", "applied_at"];
  const requestSeeds = [
    ["REQ-20260815-001", "EMP001", "ANNUAL", "2026-08-15 08:30", "2026-08-15 18:00", 8.0, "家庭旅遊", "", "APPROVED", "COMPLETED", "2026-08-10 10:00:00"],
    ["REQ-20260820-002", "EMP001", "SICK", "2026-08-20 08:30", "2026-08-20 12:00", 3.5, "感冒就醫", "https://picsum.photos/400/300", "APPROVED", "COMPLETED", "2026-08-19 18:00:00"]
  ];
  setupSheet(ss, sheets.LEAVE_REQUESTS, requestHeaders, requestSeeds, isForce);

  // 5. overtime_requests 表
  const otHeaders = ["id", "user_id", "date", "start_time", "end_time", "hours", "comp_rate", "comp_hours", "reason", "status", "expiry_date", "applied_at"];
  const otSeeds = [
    ["OT-20260810-001", "EMP001", "2026-08-10", "18:30", "21:30", 3.0, 1.34, 4.0, "Q3 專案上線緊急支援", "APPROVED", "2027-08-10", "2026-08-10 21:30:00"]
  ];
  setupSheet(ss, sheets.OVERTIME_REQUESTS, otHeaders, otSeeds, isForce);

  // 6. approval_logs 表
  const logHeaders = ["id", "request_id", "request_type", "approver_id", "approver_role", "status", "comment", "acted_at"];
  const logSeeds = [
    ["LOG-001", "REQ-20260815-001", "LEAVE", "EMP002", "Direct Manager", "APPROVED", "准假，請交接好事項", "2026-08-10 11:30:00"],
    ["LOG-002", "OT-20260810-001", "OVERTIME", "EMP002", "Direct Manager", "APPROVED", "專案表現優良，核准加班補休", "2026-08-11 09:00:00"]
  ];
  setupSheet(ss, sheets.APPROVAL_LOGS, logHeaders, logSeeds, isForce);

  // 7. holidays 表 (2026 - 2030 國定假日與連假完整種子清單)
  const holidayHeaders = ["date", "name", "is_workday"];
  setupSheet(ss, sheets.HOLIDAYS, holidayHeaders, get2026To2030HolidaySeeds(), isForce);

  return {
    success: true,
    message: isForce ? "Google Sheet 資料庫已強制重置為初始種子資料！" : "Google Sheet 資料庫結構檢查完成（已保留原有資料，未覆蓋）。"
  };
}

function setupSheet(ss, sheetName, headers, seedData, forceReset) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    // 【防呆保護】：若非強制重置且工作表已存在資料列，則絕對不 clear，保護真實資料！
    if (!forceReset && sheet.getLastRow() > 1) {
      return;
    }
    sheet.clear();
  }

  // 寫入標題
  sheet.appendRow(headers);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#2563eb");
  headerRange.setFontColor("#ffffff");
  headerRange.setHorizontalAlignment("center");

  // 寫入初始資料
  if (seedData && seedData.length > 0) {
    sheet.getRange(2, 1, seedData.length, headers.length).setValues(seedData);
  }

  // 自動調整欄寬
  for (let col = 1; col <= headers.length; col++) {
    sheet.autoResizeColumn(col);
  }
}

// ======================== 勞動基準法第38條特休假試算與同步 ========================

/**
 * 依據勞基法第38條計算特別休假日數
 * @param {string|Date} hireDate 到職日
 * @param {string|Date} asOfDate 計算基準日 (預設為當前日期)
 * @returns {number} 法定特假日數
 */
function calculateStatutoryAnnualLeaveDays(hireDate, asOfDate) {
  if (!hireDate) return 0;
  const h = new Date(hireDate);
  const now = asOfDate ? new Date(asOfDate) : new Date();
  if (isNaN(h.getTime()) || h > now) return 0;

  let years = now.getFullYear() - h.getFullYear();
  let months = now.getMonth() - h.getMonth();
  let daysDiff = now.getDate() - h.getDate();

  if (daysDiff < 0) {
    months -= 1;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const totalMonths = years * 12 + months;

  if (totalMonths < 6) {
    return 0; // 未滿 6 個月：0 天
  } else if (totalMonths >= 6 && totalMonths < 12) {
    return 3; // 滿 6 個月以上未滿 1 年：3 天
  } else if (years === 1) {
    return 7; // 滿 1 年以上未滿 2 年：7 天
  } else if (years === 2) {
    return 10; // 滿 2 年以上未滿 3 年：10 天
  } else if (years >= 3 && years < 5) {
    return 14; // 滿 3 年以上未滿 5 年：每年 14 天
  } else if (years >= 5 && years < 10) {
    return 15; // 滿 5 年以上未滿 10 年：每年 15 天
  } else if (years >= 10) {
    const calculated = 15 + (years - 9); // 滿 10 年 16 天, 滿 11 年 17 天...
    return Math.min(30, calculated);
  }
  return 0;
}

/**
 * 依據勞基法第38條計算特別休假小時數 (1 天 = 8 小時)
 */
function calculateStatutoryAnnualLeaveHours(hireDate, asOfDate) {
  const days = calculateStatutoryAnnualLeaveDays(hireDate, asOfDate);
  return days * 8.0;
}

/**
 * 讀取 users 表的到職日 (hire_date)，自動計算並同步更新 leave_balances 的 ANNUAL 額度
 */
function syncStatutoryAnnualLeaves(ss) {
  if (!ss) ss = getSpreadsheet();
  const userSheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
  const balSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_BALANCES);
  if (!userSheet || !balSheet) return { success: false, message: "資料表不存在" };

  const userData = userSheet.getDataRange().getValues();
  if (userData.length <= 1) return { success: true, message: "無使用者資料" };

  let userHeaders = userData[0];
  let hireDateIdx = userHeaders.indexOf("hire_date");

  // 若使用者表缺少 hire_date 欄位，自動擴充標題欄
  if (hireDateIdx === -1) {
    userSheet.getRange(1, userHeaders.length + 1).setValue("hire_date");
    userHeaders.push("hire_date");
    hireDateIdx = userHeaders.length - 1;
  }

  const idIdx = userHeaders.indexOf("id");
  const currentYear = CONFIG.CURRENT_YEAR || 2026;

  const balData = balSheet.getDataRange().getValues();
  const balHeaders = balData[0];
  const balUserIdx = balHeaders.indexOf("user_id");
  const balTypeIdx = balHeaders.indexOf("leave_type_id");
  const balYearIdx = balHeaders.indexOf("year");
  const balTotalIdx = balHeaders.indexOf("total_hours");

  let updatedCount = 0;

  for (let i = 1; i < userData.length; i++) {
    const uRow = userData[i];
    const userId = uRow[idIdx];
    let hireDate = uRow[hireDateIdx];
    if (!userId) continue;

    if (hireDate instanceof Date) {
      hireDate = Utilities.formatDate(hireDate, "Asia/Taipei", "yyyy-MM-dd");
    } else if (typeof hireDate === "string") {
      hireDate = hireDate.substring(0, 10);
    }

    if (!hireDate) continue;

    const statutoryHours = calculateStatutoryAnnualLeaveHours(hireDate);

    // 尋找對應的 ANNUAL 額度列
    let foundRow = -1;
    for (let b = 1; b < balData.length; b++) {
      if (String(balData[b][balUserIdx]) === String(userId) &&
          String(balData[b][balTypeIdx]) === "ANNUAL" &&
          String(balData[b][balYearIdx]) === String(currentYear)) {
        foundRow = b + 1;
        break;
      }
    }

    if (foundRow > 0) {
      balSheet.getRange(foundRow, balTotalIdx + 1).setValue(statutoryHours);
      updatedCount++;
    } else {
      const newBalId = "BAL_" + userId + "_ANNUAL_" + currentYear;
      balSheet.appendRow([newBalId, userId, "ANNUAL", currentYear, statutoryHours, 0.0, 0.0]);
      updatedCount++;
    }
  }

  return {
    success: true,
    message: `已依勞基法第38條施行細則第24條之1【歷年制】同步 ${updatedCount} 位員工之特別休假額度 (ANNUAL)。`
  };
}

/**
 * 勞基法第38條施行細則第24條之1【歷年制】特休時數核算 (每年 1/1 ~ 12/31 重新核算)
 */
function calculateStatutoryAnnualLeaveHours(hireDate, targetYear) {
  const year = targetYear || CONFIG.CURRENT_YEAR || 2026;
  if (!hireDate) return 0.0;

  let h = hireDate;
  if (typeof h === "string") {
    h = new Date(h.replace(/-/g, "/"));
  }
  if (!(h instanceof Date) || isNaN(h.getTime())) return 0.0;

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const totalYearDays = Math.round((yearEnd - yearStart) / (1000 * 60 * 60 * 24)) + 1; // 365 或 366

  if (h > yearEnd) return 0.0;

  function getAnniversaryDays(n) {
    if (n < 0.5) return 0;
    if (n >= 0.5 && n < 1) return 3;
    if (n === 1) return 7;
    if (n === 2) return 10;
    if (n === 3 || n === 4) return 14;
    if (n >= 5 && n < 10) return 15;
    if (n >= 10) return Math.min(30, 15 + (n - 9));
    return 0;
  }

  let statutoryDays = 0;

  // 1. 若為當年度到職
  if (h.getFullYear() === year) {
    const sixMonthDate = new Date(h);
    sixMonthDate.setMonth(sixMonthDate.getMonth() + 6);
    if (sixMonthDate <= yearEnd) {
      statutoryDays = 3.0;
    } else {
      statutoryDays = 0.0;
    }
  } else {
    // 2. 前一年度或更早到職：以週年日切分前後段
    const anniversary = new Date(year, h.getMonth(), h.getDate());
    const priorYears = year - h.getFullYear() - 1;
    const nextYears = priorYears + 1;

    const d1 = Math.max(0, Math.floor((anniversary - yearStart) / (1000 * 60 * 60 * 24)));
    const d2 = totalYearDays - d1;

    let part1Days = 0;
    if (priorYears === 0) {
      const sixMonthDate = new Date(h);
      sixMonthDate.setMonth(sixMonthDate.getMonth() + 6);
      part1Days = (sixMonthDate <= yearStart) ? 3.0 : 0.0;
    } else {
      part1Days = getAnniversaryDays(priorYears) * (d1 / totalYearDays);
    }

    const part2Days = getAnniversaryDays(nextYears) * (d2 / totalYearDays);
    const totalRaw = part1Days + part2Days;
    statutoryDays = Math.round(totalRaw * 10) / 10;
  }

  return Math.round(statutoryDays * 8.0 * 10) / 10;
}

/**
 * 自動檢查並為 Google Sheet 的 holidays 分頁補齊 2026-2030 年國定假日與連假補假
 */
function syncHolidays(ss) {
  if (!ss) ss = getSpreadsheet();
  let hSheet = ss.getSheetByName(CONFIG.SHEETS.HOLIDAYS);
  const holidayHeaders = ["date", "name", "is_workday"];
  const allHolidaySeeds = get2026To2030HolidaySeeds();

  if (!hSheet) {
    setupSheet(ss, CONFIG.SHEETS.HOLIDAYS, holidayHeaders, allHolidaySeeds);
    return {
      success: true,
      message: `已成功建立 holidays 分頁並匯入 2026-2030 年共 ${allHolidaySeeds.length} 筆國定假日！`
    };
  }

  const existingData = hSheet.getDataRange().getValues();
  const existingMap = {};
  if (existingData.length > 1) {
    const dateIdx = existingData[0].indexOf("date");
    for (let i = 1; i < existingData.length; i++) {
      let d = existingData[i][dateIdx];
      if (d instanceof Date) {
        d = Utilities.formatDate(d, "Asia/Taipei", "yyyy-MM-dd");
      } else if (typeof d === "string") {
        d = d.substring(0, 10);
      }
      if (d) existingMap[d] = true;
    }
  }

  const missingSeeds = allHolidaySeeds.filter(seed => !existingMap[seed[0]]);
  if (missingSeeds.length > 0) {
    missingSeeds.forEach(seed => {
      hSheet.appendRow(seed);
    });
    return {
      success: true,
      message: `已為 Google Sheet holidays 分頁成功同步補齊 2026-2030 年新增之 ${missingSeeds.length} 筆假日資料！`
    };
  }

  return {
    success: true,
    message: "Google Sheet holidays 分頁已包含 2026-2030 年全數國定假日，資料均為最新！"
  };
}

function get2026To2030HolidaySeeds() {
  return [
    // 2026
    ["2026-01-01", "中華民國開國紀念日", false],
    ["2026-02-16", "農曆除夕", false],
    ["2026-02-17", "春節初一", false],
    ["2026-02-18", "春節初二", false],
    ["2026-02-19", "春節初三", false],
    ["2026-02-20", "春節初四 (補假)", false],
    ["2026-02-27", "和平紀念日 (補假)", false],
    ["2026-02-28", "和平紀念日", false],
    ["2026-04-03", "兒童節 (補假)", false],
    ["2026-04-04", "兒童節", false],
    ["2026-04-05", "民族掃墓節(清明)", false],
    ["2026-04-06", "清明節 (補假)", false],
    ["2026-05-01", "勞動節", false],
    ["2026-06-19", "端午節", false],
    ["2026-09-25", "中秋節", false],
    ["2026-10-09", "國慶日 (補假)", false],
    ["2026-10-10", "國慶日", false],

    // 2027
    ["2027-01-01", "中華民國開國紀念日", false],
    ["2027-02-05", "小年夜 (彈性放假)", false],
    ["2027-02-06", "農曆除夕", false],
    ["2027-02-07", "春節初一", false],
    ["2027-02-08", "春節初二", false],
    ["2027-02-09", "春節初三", false],
    ["2027-02-10", "春節初四 (補假)", false],
    ["2027-02-11", "春節初五 (補假)", false],
    ["2027-02-28", "和平紀念日", false],
    ["2027-03-01", "和平紀念日 (補假)", false],
    ["2027-04-04", "兒童節", false],
    ["2027-04-05", "清明節", false],
    ["2027-04-06", "清明節 (補假)", false],
    ["2027-04-30", "勞動節 (補假)", false],
    ["2027-05-01", "勞動節", false],
    ["2027-06-09", "端午節", false],
    ["2027-09-15", "中秋節", false],
    ["2027-10-10", "國慶日", false],
    ["2027-10-11", "國慶日 (補假)", false],

    // 2028
    ["2028-01-01", "中華民國開國紀念日", false],
    ["2028-01-03", "元旦 (補假)", false],
    ["2028-01-25", "小年夜 (彈性放假)", false],
    ["2028-01-26", "農曆除夕", false],
    ["2028-01-27", "春節初一", false],
    ["2028-01-28", "春節初二", false],
    ["2028-01-29", "春節初三", false],
    ["2028-01-30", "春節初四 (補假)", false],
    ["2028-01-31", "春節初五 (補假)", false],
    ["2028-02-28", "和平紀念日", false],
    ["2028-04-04", "兒童節 / 清明節", false],
    ["2028-04-05", "清明節 (補假)", false],
    ["2028-05-01", "勞動節", false],
    ["2028-05-28", "端午節", false],
    ["2028-05-29", "端午節 (補假)", false],
    ["2028-10-03", "中秋節", false],
    ["2028-10-10", "國慶日", false],

    // 2029
    ["2029-01-01", "中華民國開國紀念日", false],
    ["2029-02-12", "小年夜 (彈性放假)", false],
    ["2029-02-13", "農曆除夕", false],
    ["2029-02-14", "春節初一", false],
    ["2029-02-15", "春節初二", false],
    ["2029-02-16", "春節初三", false],
    ["2029-02-28", "和平紀念日", false],
    ["2029-04-04", "兒童節", false],
    ["2029-04-05", "清明節", false],
    ["2029-04-06", "清明節 (補假)", false],
    ["2029-05-01", "勞動節", false],
    ["2029-06-16", "端午節", false],
    ["2029-09-22", "中秋節", false],
    ["2029-10-10", "國慶日", false],

    // 2030
    ["2030-01-01", "中華民國開國紀念日", false],
    ["2030-02-01", "小年夜 (彈性放假)", false],
    ["2030-02-02", "農曆除夕", false],
    ["2030-02-03", "春節初一", false],
    ["2030-02-04", "春節初二", false],
    ["2030-02-05", "春節初三", false],
    ["2030-02-06", "春節初四 (補假)", false],
    ["2030-02-07", "春節初五 (補假)", false],
    ["2030-02-28", "和平紀念日", false],
    ["2030-04-04", "兒童節", false],
    ["2030-04-05", "清明節", false],
    ["2030-05-01", "勞動節", false],
    ["2030-06-05", "端午節", false],
    ["2030-09-12", "中秋節", false],
    ["2030-10-10", "國慶日", false]
  ];
}

/**
 * 自動同步 leave_types 最新設定 (病假改為支半薪、不強制附件)
 */
function syncLeaveTypes(ss) {
  if (!ss) ss = getSpreadsheet();
  const ltSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_TYPES);
  if (!ltSheet) return;

  const data = ltSheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const headers = data[0];
  const idIdx = headers.indexOf("id");
  const reqAttIdx = headers.indexOf("requires_attachment");
  const isPaidIdx = headers.indexOf("is_paid");
  const descIdx = headers.indexOf("description");

  if (idIdx === -1) return;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[idIdx]).trim() === "SICK") {
      if (reqAttIdx !== -1 && (row[reqAttIdx] === true || String(row[reqAttIdx]).toLowerCase() === "true")) {
        ltSheet.getRange(i + 1, reqAttIdx + 1).setValue(false);
      }
      if (isPaidIdx !== -1 && (row[isPaidIdx] === false || String(row[isPaidIdx]).toLowerCase() === "false")) {
        ltSheet.getRange(i + 1, isPaidIdx + 1).setValue("半薪");
      }
      if (descIdx !== -1 && String(row[descIdx]).indexOf("不支薪") !== -1) {
        ltSheet.getRange(i + 1, descIdx + 1).setValue("因病就醫休養，一年內三十日以內半薪，不強制檢附證明");
      }
    }
  }
}

/**
 * 自動檢查並修復雲端 Google Sheet 歷史重複單號 (Deduplication & Self-Healing)
 */
function syncDeduplicateRequests(ss) {
  if (!ss) ss = getSpreadsheet();
  
  // 1. 處理請假單 leave_requests
  const reqSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_REQUESTS);
  if (reqSheet) {
    const data = reqSheet.getDataRange().getValues();
    if (data.length > 2) {
      const headers = data[0];
      const idIdx = headers.findIndex(h => {
        const lower = String(h).trim().toLowerCase();
        return lower === "id" || h === "申請單號" || h === "單號";
      });
      if (idIdx !== -1) {
        const seen = {};
        for (let i = 1; i < data.length; i++) {
          const rawId = String(data[i][idIdx] || "").trim();
          if (!rawId) continue;
          if (!seen[rawId]) {
            seen[rawId] = 1;
          } else {
            seen[rawId]++;
            const disambiguatedId = `${rawId}-${seen[rawId]}`;
            reqSheet.getRange(i + 1, idIdx + 1).setValue(disambiguatedId);
          }
        }
      }
    }
  }

  // 2. 處理加班單 overtime_requests
  const otSheet = ss.getSheetByName(CONFIG.SHEETS.OVERTIME_REQUESTS);
  if (otSheet) {
    const data = otSheet.getDataRange().getValues();
    if (data.length > 2) {
      const headers = data[0];
      const idIdx = headers.findIndex(h => {
        const lower = String(h).trim().toLowerCase();
        return lower === "id" || h === "申請單號" || h === "單號";
      });
      if (idIdx !== -1) {
        const seen = {};
        for (let i = 1; i < data.length; i++) {
          const rawId = String(data[i][idIdx] || "").trim();
          if (!rawId) continue;
          if (!seen[rawId]) {
            seen[rawId] = 1;
          } else {
            seen[rawId]++;
            const disambiguatedId = `${rawId}-${seen[rawId]}`;
            otSheet.getRange(i + 1, idIdx + 1).setValue(disambiguatedId);
          }
        }
      }
    }
  }
}

// ======================== 資料讀取與 Bootstrap ========================

function getBootstrapData(currentUserId, authToken) {
  const ss = getSpreadsheet();
  
  // 自動同步最新法定特休額度至 leave_balances 表
  syncStatutoryAnnualLeaves(ss);

  // 自動為 Google Sheet 的 holidays 分頁同步補齊 2026-2030 年假日資料
  syncHolidays(ss);

  // 自動同步假別最新設定 (病假改為支半薪、免強制檢附證明)
  syncLeaveTypes(ss);

  // 自動防呆除重現存重複單號 (Self-Healing)
  syncDeduplicateRequests(ss);

  const users = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.USERS));
  const leaveTypes = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.LEAVE_TYPES));
  leaveTypes.forEach(t => {
    if (t.id === "SICK") {
      t.requires_attachment = false;
      t.is_paid = "半薪";
      t.isPaid = "HALF";
      t.paidText = "支半薪";
      t.description = "因病就醫休養，一年內三十日以內半薪，不強制檢附證明";
    }
  });
  const balances = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.LEAVE_BALANCES));
  const requests = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.LEAVE_REQUESTS));
  const overtimes = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.OVERTIME_REQUESTS));
  const logs = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.APPROVAL_LOGS));
  // 簽核歷史歷程：最新時間排在最上面 (新到舊降序排列)
  logs.sort((a, b) => new Date(b.acted_at || 0) - new Date(a.acted_at || 0));
  const holidays = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.HOLIDAYS));

  // 驗證 Token 提取身分；若無 Token 則以傳入之 currentUserId 為準
  const tokenPayload = verifyAuthToken(authToken);
  const activeUserId = tokenPayload ? tokenPayload.userId : (currentUserId || (users[0] ? users[0].id : null));

  let currentUser = null;
  if (activeUserId) {
    currentUser = users.find(u => u.id === activeUserId);
  }
  if (!currentUser && users.length > 0) {
    currentUser = users[0]; // 預設第一位員工
  }

  // 1. 嚴格過濾：currentUser 物件徹底清除敏感密碼欄位
  const safeCurrentUser = currentUser ? Object.assign({}, currentUser, { password_hash: undefined }) : null;

  // 2. 通訊錄過濾：移除 password_hash、hire_date 等隱私欄位，保留選單必要屬性
  const safeUsers = users.map(u => ({
    id: u.id,
    name: u.name,
    department_id: u.department_id,
    department_name: u.department_name,
    manager_id: u.manager_id,
    role: u.role
  }));

  // 3. 依角色範圍過濾 (RBAC Scoping)，防止一般員工透過 API 或 DevTools 窺探全公司差勤隱私
  const userRole = currentUser ? currentUser.role : "Employee";
  let scopedBalances = [];
  let scopedRequests = [];
  let scopedOvertimes = [];
  let scopedLogs = [];

  if (userRole === "Admin" || userRole === "HR") {
    // HR 與最高管理員：可查全公司差勤紀錄
    scopedBalances = balances;
    scopedRequests = requests;
    scopedOvertimes = overtimes;
    scopedLogs = logs;
  } else if (userRole === "Manager") {
    // 直屬主管：可查自己與直屬下屬的審核資料
    const subIds = new Set(users.filter(u => u.manager_id === currentUser.id).map(u => u.id));
    subIds.add(currentUser.id);

    scopedBalances = balances.filter(b => subIds.has(b.user_id));
    scopedOvertimes = overtimes.filter(o => subIds.has(o.user_id));
    scopedLogs = logs.filter(l => {
      const isSubReq = requests.some(r => r.id === l.request_id && subIds.has(r.user_id));
      const isSubOt = overtimes.some(o => o.id === l.request_id && subIds.has(o.user_id));
      return isSubReq || isSubOt || l.approver_id === currentUser.id;
    });
    // 請假單：下屬與自己的單據保留事由；其他同仁單據用於行事曆排班，事由脫敏
    scopedRequests = requests.map(r => {
      if (subIds.has(r.user_id)) return r;
      return Object.assign({}, r, { reason: "公出/休假", attachment_url: "" });
    });
  } else {
    // 一般同仁：只能查詢本人之額度、加班與簽核歷程
    scopedBalances = balances.filter(b => b.user_id === currentUser.id);
    scopedOvertimes = overtimes.filter(o => o.user_id === currentUser.id);
    scopedLogs = logs.filter(l => {
      const isMyReq = requests.some(r => r.id === l.request_id && r.user_id === currentUser.id);
      const isMyOt = overtimes.some(o => o.id === l.request_id && o.user_id === currentUser.id);
      return isMyReq || isMyOt;
    });
    // 請假單：本人保留事由與證明附件；其他同仁僅保留日期供行事曆檢視排班，事由與附件徹底移除
    scopedRequests = requests.map(r => {
      if (r.user_id === currentUser.id) return r;
      return Object.assign({}, r, { reason: "請假", attachment_url: "" });
    });
  }

  return {
    success: true,
    data: {
      currentUser: safeCurrentUser,
      users: safeUsers,
      leaveTypes: leaveTypes,
      balances: scopedBalances,
      requests: scopedRequests,
      overtimes: scopedOvertimes,
      logs: scopedLogs,
      holidays: holidays,
      config: {
        workStart: CONFIG.WORK_START,
        workEnd: CONFIG.WORK_END,
        lunchStart: CONFIG.LUNCH_START,
        lunchEnd: CONFIG.LUNCH_END,
        dailyHours: CONFIG.DAILY_WORK_HOURS,
        multiTierThresholdHours: CONFIG.MULTI_TIER_THRESHOLD_HOURS
      }
    }
  };
}

function loginUser(email, password) {
  const ss = getSpreadsheet();
  const users = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.USERS));
  
  const inputEmail = String(email || "").trim().toLowerCase();
  const inputPass = String(password !== undefined ? password : "").trim();

  const user = users.find(u => {
    const uEmail = String(u.email || "").trim().toLowerCase();
    const uPass = String(u.password_hash !== undefined ? u.password_hash : "").trim();
    return uEmail === inputEmail && uPass === inputPass;
  });

  if (!user) {
    return { success: false, message: "帳號或密碼錯誤，請重新確認輸入。" };
  }

  // 複製使用者物件並移除敏感密碼欄位
  const userSafe = {
    id: user.id,
    name: user.name,
    email: user.email,
    department_id: user.department_id,
    department_name: user.department_name,
    manager_id: user.manager_id,
    role: user.role,
    created_at: user.created_at
  };

  const token = createAuthToken(user.id, user.role);

  return {
    success: true,
    message: "登入成功",
    token: token,
    user: userSafe
  };
}

function changePassword(params) {
  const { userId, oldPassword, newPassword } = params;
  if (!userId || !oldPassword || !newPassword) {
    return { success: false, message: "請完整填寫原密碼與新密碼！" };
  }

  if (String(newPassword).length < 4) {
    return { success: false, message: "新密碼長度至少需 4 碼以上！" };
  }

  const ss = getSpreadsheet();
  const userSheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
  if (!userSheet) return { success: false, message: "使用者資料表不存在" };

  const userData = userSheet.getDataRange().getValues();
  const headers = userData[0];
  const idIdx = headers.indexOf("id");
  const passIdx = headers.indexOf("password_hash");

  if (idIdx === -1 || passIdx === -1) {
    return { success: false, message: "使用者表結構欄位遺失" };
  }

  for (let i = 1; i < userData.length; i++) {
    if (String(userData[i][idIdx]).trim() === String(userId).trim()) {
      const currentPass = String(userData[i][passIdx] !== undefined ? userData[i][passIdx] : "").trim();
      if (currentPass !== String(oldPassword).trim()) {
        return { success: false, message: "目前密碼輸入錯誤，請重新確認！" };
      }

      // 更新密碼至 users 表
      userSheet.getRange(i + 1, passIdx + 1).setValue(String(newPassword).trim());
      return {
        success: true,
        message: "密碼修改成功！下次登入請使用新密碼。"
      };
    }
  }

  return { success: false, message: `找不到員工編號: ${userId}` };
}

// ======================== 智慧工時計算引擎 ========================
/**
 * 每日標準時間：08:30 - 18:00 (共 8.0 小時工時)
 * 午休時間：12:00 - 13:30 (扣除 1.5 小時)
 * 上半天：08:30 - 12:00 (3.5 小時)
 * 下半天：13:30 - 18:00 (4.5 小時)
 * 自動排除週六日與國定假日
 */
function calculateLeaveHours(startStr, endStr) {
  if (!startStr || !endStr) return 0;
  
  const ss = getSpreadsheet();
  const holidaysSheet = ss.getSheetByName(CONFIG.SHEETS.HOLIDAYS);
  const holidayList = holidaysSheet ? sheetToObjects(holidaysSheet) : [];
  
  const holidayMap = {};
  holidayList.forEach(h => {
    holidayMap[formatDateOnly(new Date(h.date))] = h.is_workday === true || h.is_workday === "true";
  });

  const startDate = new Date(startStr);
  const endDate = new Date(endStr);
  if (endDate <= startDate) return 0;

  let totalHours = 0;
  let curr = new Date(startDate.getTime());
  
  // 逐日計算
  while (curr <= endDate) {
    const dateKey = formatDateOnly(curr);
    const dayOfWeek = curr.getDay(); // 0: 日, 6: 六
    
    // 檢查是否為工作日 (不是週末，或者有補班；且不是國定假日)
    let isWork = (dayOfWeek !== 0 && dayOfWeek !== 6);
    if (holidayMap[dateKey] !== undefined) {
      isWork = holidayMap[dateKey];
    }

    if (isWork) {
      const isStartDay = formatDateOnly(curr) === formatDateOnly(startDate);
      const isEndDay = formatDateOnly(curr) === formatDateOnly(endDate);

      let dayStartHour = 8.5;  // 08:30
      let dayEndHour = 18.0;   // 18:00

      if (isStartDay) {
        const sH = startDate.getHours() + startDate.getMinutes() / 60;
        dayStartHour = Math.max(8.5, sH);
      }
      if (isEndDay) {
        const eH = endDate.getHours() + endDate.getMinutes() / 60;
        dayEndHour = Math.min(18.0, eH);
      }

      if (dayEndHour > dayStartHour) {
        // 計算當日工時並扣除午休 12:00 ~ 13:30
        let dayWorkTime = 0;
        
        // 區間一：08:30 - 12:00
        const mStart = Math.max(8.5, dayStartHour);
        const mEnd = Math.min(12.0, dayEndHour);
        if (mEnd > mStart) {
          dayWorkTime += (mEnd - mStart);
        }

        // 區間二：13:30 - 18:00
        const aStart = Math.max(13.5, dayStartHour);
        const aEnd = Math.min(18.0, dayEndHour);
        if (aEnd > aStart) {
          dayWorkTime += (aEnd - aStart);
        }

        totalHours += dayWorkTime;
      }
    }

    // 推進至隔日 00:00
    curr.setDate(curr.getDate() + 1);
    curr.setHours(0, 0, 0, 0);
  }

  // 四捨五入至小數點一位 (如 0.5)
  return Math.round(totalHours * 10) / 10;
}

// ======================== 請假申請與防呆邏輯 ========================

function applyLeave(params) {
  const { userId, leaveTypeId, startTime, endTime, reason, attachmentUrl } = params;
  const ss = getSpreadsheet();

  // 1. 基本檢核
  if (!userId || !leaveTypeId || !startTime || !endTime) {
    return { success: false, message: "請填寫所有必填欄位。" };
  }

  // 2. 工時計算
  const totalHours = calculateLeaveHours(startTime, endTime);
  if (totalHours <= 0) {
    return { success: false, message: "請假區間內無工作時數（可能全為假日或非上班時段）。" };
  }

  // 3. 檢查假別最小單位
  const leaveTypesSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_TYPES);
  const leaveTypes = sheetToObjects(leaveTypesSheet);
  const leaveType = leaveTypes.find(t => t.id === leaveTypeId);
  if (!leaveType) {
    return { success: false, message: "找不到指定的假別。" };
  }

  const minUnit = parseFloat(leaveType.min_unit) || 0.5;
  if ((totalHours % minUnit) > 0.01 && (minUnit - (totalHours % minUnit)) > 0.01) {
    return { success: false, message: `此假別最小申請單位為 ${minUnit} 小時。` };
  }

  // 病假依最新規定不強制檢附證明文件 / 圖片連結
  const requiresAtt = (leaveTypeId === "SICK") ? false : Boolean(leaveType.requires_attachment);
  if (requiresAtt && !attachmentUrl) {
    return { success: false, message: `申請「${leaveType.name}」必須檢附證明文件。` };
  }

  // 4. 重疊請假檢查 (Overlapping Check)
  const reqSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_REQUESTS);
  const allRequests = sheetToObjects(reqSheet);
  const newStart = new Date(startTime).getTime();
  const newEnd = new Date(endTime).getTime();

  const isOverlapped = allRequests.some(r => {
    if (r.user_id !== userId) return false;
    if (r.status !== "PENDING" && r.status !== "APPROVED" && r.status !== "CANCEL_PENDING") return false;
    const rStart = new Date(r.start_time).getTime();
    const rEnd = new Date(r.end_time).getTime();
    return Math.max(newStart, rStart) < Math.min(newEnd, rEnd);
  });

  if (isOverlapped) {
    return { success: false, message: "所選請假時間與您已存在的申請單時段重疊，請確認！" };
  }

  // 5. 額度檢核與鎖定 (Locking: pending_hours)
  const currentYear = new Date(startTime).getFullYear();
  const balSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_BALANCES);
  const balData = balSheet.getDataRange().getValues();
  const balHeaders = balData[0];
  const userIdx = balHeaders.indexOf("user_id");
  const typeIdx = balHeaders.indexOf("leave_type_id");
  const yearIdx = balHeaders.indexOf("year");
  const totalIdx = balHeaders.indexOf("total_hours");
  const usedIdx = balHeaders.indexOf("used_hours");
  const pendingIdx = balHeaders.indexOf("pending_hours");

  let balanceRowIndex = -1;
  let totalHoursQuota = 0;
  let usedHours = 0;
  let pendingHours = 0;

  for (let i = 1; i < balData.length; i++) {
    if (balData[i][userIdx] === userId && balData[i][typeIdx] === leaveTypeId && parseInt(balData[i][yearIdx]) === currentYear) {
      balanceRowIndex = i + 1; // 1-based row index in sheet
      totalHoursQuota = parseFloat(balData[i][totalIdx]) || 0;
      usedHours = parseFloat(balData[i][usedIdx]) || 0;
      pendingHours = parseFloat(balData[i][pendingIdx]) || 0;
      break;
    }
  }

  const isQuotaExempt = (leaveTypeId === "PERSONAL" || leaveTypeId === "SICK");

  if (balanceRowIndex === -1) {
    if (!isQuotaExempt) {
      return { success: false, message: `您在 ${currentYear} 年度尚未有「${leaveType.name}」額度，無法申請。` };
    } else {
      // 事假與病假：無額度限制，自動補建額度紀錄以追蹤累計請假工時
      const newBalId = `BAL_${userId}_${leaveTypeId}_${currentYear}`;
      balSheet.appendRow([newBalId, userId, leaveTypeId, currentYear, 0.0, 0.0, 0.0]);
      balanceRowIndex = balSheet.getLastRow();
      totalHoursQuota = 0;
      usedHours = 0;
      pendingHours = 0;
    }
  }

  // 僅針對特休、補休等有額度限制之假別進行剩餘時數檢核 (事假、病假無額度亦可申請)
  if (!isQuotaExempt) {
    const remainingHours = totalHoursQuota - usedHours - pendingHours;
    if (totalHours > remainingHours) {
      return {
        success: false,
        message: `額度不足！「${leaveType.name}」可用額度剩餘 ${remainingHours} 小時，本次申請需要 ${totalHours} 小時。`
      };
    }
  }

  // 鎖定額度: pending_hours += totalHours
  balSheet.getRange(balanceRowIndex, pendingIdx + 1).setValue(pendingHours + totalHours);

  // 6. 產生單號並決定初始審核階層 (採用高精度時戳 + 4位亂數 + 碰撞防重檢核迴圈)
  const reqData = reqSheet.getDataRange().getValues();
  const reqHeaders = reqData[0] || [];
  const existingReqIds = {};
  if (reqData.length > 1) {
    const idIdx = reqHeaders.findIndex(h => {
      const lower = String(h).trim().toLowerCase();
      return lower === "id" || h === "申請單號" || h === "單號";
    });
    if (idIdx !== -1) {
      for (let i = 1; i < reqData.length; i++) {
        const val = String(reqData[i][idIdx] || "").trim();
        if (val) existingReqIds[val] = true;
      }
    }
  }

  let reqId = params.requestId;
  if (!reqId || existingReqIds[reqId]) {
    const datePrefix = "REQ-" + Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd-HHmmss");
    let counter = 0;
    do {
      const rand = Math.floor(1000 + Math.random() * 9000);
      reqId = `${datePrefix}-${rand}${counter > 0 ? '-' + counter : ''}`;
      counter++;
    } while (existingReqIds[reqId]);
  }
  const currentStep = "MANAGER"; // 初始階層皆為直屬主管
  const appliedAt = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");

  // 動態依標題欄位將申請單號寫入 leave_requests 工作表 (相容 id / 申請單號 / 單號)
  if (reqHeaders.length > 0) {
    const row = new Array(reqHeaders.length).fill("");
    reqHeaders.forEach((h, idx) => {
      const lower = String(h).trim().toLowerCase();
      if (lower === "id" || h === "申請單號" || h === "單號") row[idx] = reqId;
      else if (lower === "user_id" || h === "員工編號" || h === "申請人") row[idx] = userId;
      else if (lower === "leave_type_id" || h === "假別代碼" || h === "假別") row[idx] = leaveTypeId;
      else if (lower === "start_time" || h === "起始時間") row[idx] = startTime;
      else if (lower === "end_time" || h === "結束時間") row[idx] = endTime;
      else if (lower === "total_hours" || h === "請假時數" || h === "工時") row[idx] = totalHours;
      else if (lower === "reason" || h === "事由" || h === "請假事由") row[idx] = reason || "";
      else if (lower === "attachment_url" || h === "附件" || h === "證明文件") row[idx] = attachmentUrl || "";
      else if (lower === "status" || h === "狀態" || h === "審核狀態") row[idx] = "PENDING";
      else if (lower === "current_step" || h === "審核階層") row[idx] = currentStep;
      else if (lower === "applied_at" || h === "申請時間") row[idx] = appliedAt;
    });
    reqSheet.appendRow(row);
  } else {
    reqSheet.appendRow([
      reqId,
      userId,
      leaveTypeId,
      startTime,
      endTime,
      totalHours,
      reason || "",
      attachmentUrl || "",
      "PENDING",
      currentStep,
      appliedAt
    ]);
  }

  // 同步將申請單號寫入簽核歷史歷程 (approval_logs 表)
  logApproval(ss, reqId, "LEAVE", userId, "Applicant", "PENDING", reason || "送出請假申請");

  return {
    success: true,
    message: `請假申請已成功送出！單號：${reqId}，已鎖定額度 ${totalHours} 小時，等待主管審核。`,
    requestId: reqId
  };
}

// ======================== 請假撤銷與銷假流程 ========================

function cancelLeave(params) {
  const { requestId, userId, cancelReason } = params;
  const ss = getSpreadsheet();
  const reqSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_REQUESTS);
  const reqData = reqSheet.getDataRange().getValues();
  const reqHeaders = reqData[0];

  const idIdx = reqHeaders.indexOf("id");
  const userIdx = reqHeaders.indexOf("user_id");
  const typeIdx = reqHeaders.indexOf("leave_type_id");
  const hoursIdx = reqHeaders.indexOf("total_hours");
  const statusIdx = reqHeaders.indexOf("status");
  const stepIdx = reqHeaders.indexOf("current_step");
  const startIdx = reqHeaders.indexOf("start_time");

  let targetRow = -1;
  let requestObj = null;

  for (let i = 1; i < reqData.length; i++) {
    if (reqData[i][idIdx] === requestId && reqData[i][userIdx] === userId) {
      targetRow = i + 1;
      requestObj = {
        id: reqData[i][idIdx],
        userId: reqData[i][userIdx],
        leaveTypeId: reqData[i][typeIdx],
        totalHours: parseFloat(reqData[i][hoursIdx]) || 0,
        status: reqData[i][statusIdx],
        startTime: reqData[i][startIdx]
      };
      break;
    }
  }

  if (!requestObj) {
    return { success: false, message: "找不到該筆請假申請單或無權限操作。" };
  }

  const currentYear = new Date(requestObj.startTime).getFullYear();

  // 情況一：未審核 (PENDING) -> 直接取消並釋放 pending_hours
  if (requestObj.status === "PENDING") {
    reqSheet.getRange(targetRow, statusIdx + 1).setValue("CANCELLED");
    reqSheet.getRange(targetRow, stepIdx + 1).setValue("COMPLETED");

    // 釋放 pending_hours
    updateBalanceQuota(ss, requestObj.userId, requestObj.leaveTypeId, currentYear, 0, -requestObj.totalHours);

    // 寫入日誌
    logApproval(ss, requestId, "LEAVE", userId, "Employee", "CANCELLED", cancelReason || "員工自行撤銷申請");

    return { success: true, message: "申請單已成功撤銷，鎖定額度已全數釋放！" };
  }

  // 情況二：已核准 (APPROVED) -> 進入銷假申請流程 (CANCEL_PENDING)
  if (requestObj.status === "APPROVED") {
    reqSheet.getRange(targetRow, statusIdx + 1).setValue("CANCEL_PENDING");
    reqSheet.getRange(targetRow, stepIdx + 1).setValue("MANAGER");

    logApproval(ss, requestId, "CANCEL_LEAVE", userId, "Employee", "CANCEL_PENDING", cancelReason || "員工送出銷假申請");

    return { success: true, message: "已送出銷假申請，待主管審核通過後將退還已扣除之假別額度。" };
  }

  return { success: false, message: `目前狀態 (${requestObj.status}) 無法進行撤銷或銷假。` };
}

// ======================== 主管與 HR 審核機制 ========================

function reviewLeave(params, action) {
  const { requestId, approverId, comment } = params;
  const ss = getSpreadsheet();

  const reqSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_REQUESTS);
  const reqData = reqSheet.getDataRange().getValues();
  const reqHeaders = reqData[0];

  const idIdx = reqHeaders.indexOf("id");
  const userIdx = reqHeaders.indexOf("user_id");
  const typeIdx = reqHeaders.indexOf("leave_type_id");
  const hoursIdx = reqHeaders.indexOf("total_hours");
  const statusIdx = reqHeaders.indexOf("status");
  const stepIdx = reqHeaders.indexOf("current_step");
  const startIdx = reqHeaders.indexOf("start_time");

  let targetRow = -1;
  let req = null;

  for (let i = 1; i < reqData.length; i++) {
    if (reqData[i][idIdx] === requestId) {
      targetRow = i + 1;
      req = {
        id: reqData[i][idIdx],
        userId: reqData[i][userIdx],
        leaveTypeId: reqData[i][typeIdx],
        totalHours: parseFloat(reqData[i][hoursIdx]) || 0,
        status: reqData[i][statusIdx],
        currentStep: reqData[i][stepIdx],
        startTime: reqData[i][startIdx]
      };
      break;
    }
  }

  if (!req) {
    return { success: false, message: "找不到該筆請假申請單。" };
  }

  const users = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.USERS));
  const approver = users.find(u => u.id === approverId);
  const currentYear = new Date(req.startTime).getFullYear();

  // 1. 處理「銷假審核 (CANCEL_PENDING)」
  if (req.status === "CANCEL_PENDING") {
    if (action === "APPROVED") {
      reqSheet.getRange(targetRow, statusIdx + 1).setValue("CANCEL_APPROVED");
      reqSheet.getRange(targetRow, stepIdx + 1).setValue("COMPLETED");

      // 退還 used_hours (used_hours -= req.totalHours)
      updateBalanceQuota(ss, req.userId, req.leaveTypeId, currentYear, -req.totalHours, 0);

      logApproval(ss, requestId, "CANCEL_LEAVE", approverId, approver ? approver.role : "Manager", "APPROVED", comment || "銷假核准，時數已退回");
      return { success: true, message: `銷假審核已核准，已成功將 ${req.totalHours} 小時退還給員工！` };
    } else {
      reqSheet.getRange(targetRow, statusIdx + 1).setValue("APPROVED"); // 恢復為原先核准狀態
      reqSheet.getRange(targetRow, stepIdx + 1).setValue("COMPLETED");

      logApproval(ss, requestId, "CANCEL_LEAVE", approverId, approver ? approver.role : "Manager", "REJECTED", comment || "銷假申請駁回");
      return { success: true, message: "銷假申請已退回，維持原假單核准狀態。" };
    }
  }

  // 2. 處理標準請假審核 (PENDING)
  if (req.status !== "PENDING") {
    return { success: false, message: `此假單目前狀態為 ${req.status}，無需再審核。` };
  }

  if (action === "REJECTED") {
    // 退回：狀態改 REJECTED，釋放 pending_hours
    reqSheet.getRange(targetRow, statusIdx + 1).setValue("REJECTED");
    reqSheet.getRange(targetRow, stepIdx + 1).setValue("COMPLETED");

    // 釋放 pending_hours
    updateBalanceQuota(ss, req.userId, req.leaveTypeId, currentYear, 0, -req.totalHours);

    logApproval(ss, requestId, "LEAVE", approverId, approver ? approver.role : "Manager", "REJECTED", comment || "審核退回");
    return { success: true, message: "已退回該請假申請，鎖定時數已釋放。" };
  }

  if (action === "APPROVED") {
    // 檢查是否超過 3 天 (> 24 小時) 需多階 HR 審核
    const isMultiTier = req.totalHours > CONFIG.MULTI_TIER_THRESHOLD_HOURS;

    if (req.currentStep === "MANAGER") {
      if (isMultiTier) {
        // 第一階通過，轉給 HR 簽核
        reqSheet.getRange(targetRow, stepIdx + 1).setValue("HR");
        logApproval(ss, requestId, "LEAVE", approverId, "Direct Manager", "APPROVED", (comment || "主管初審通過") + " (轉交人資簽核)");
        return { success: true, message: `主管初審已通過！因請假時數超過 3 天 (${req.totalHours} 小時)，已自動轉交人資/管理員進行第二階複核。` };
      } else {
        // 單階通過，直接結案
        reqSheet.getRange(targetRow, statusIdx + 1).setValue("APPROVED");
        reqSheet.getRange(targetRow, stepIdx + 1).setValue("COMPLETED");

        // 轉化 pending_hours -> used_hours
        transferPendingToUsed(ss, req.userId, req.leaveTypeId, currentYear, req.totalHours);

        logApproval(ss, requestId, "LEAVE", approverId, "Direct Manager", "APPROVED", comment || "主管審核通過");
        return { success: true, message: "請假申請已核准！" };
      }
    } else if (req.currentStep === "HR") {
      // 第二階 HR 通過，正式結案
      reqSheet.getRange(targetRow, statusIdx + 1).setValue("APPROVED");
      reqSheet.getRange(targetRow, stepIdx + 1).setValue("COMPLETED");

      // 轉化 pending_hours -> used_hours
      transferPendingToUsed(ss, req.userId, req.leaveTypeId, currentYear, req.totalHours);

      logApproval(ss, requestId, "LEAVE", approverId, "HR / Admin", "APPROVED", comment || "HR 複核通過");
      return { success: true, message: "人資複核已通過，請假單正式生效！" };
    }
  }

  return { success: false, message: "無效的操作指令。" };
}

// ======================== 加班申報與補休機制 ========================

function applyOvertime(params) {
  const { userId, date, startTime, endTime, hours, compRate, reason } = params;
  const ss = getSpreadsheet();

  if (!userId || !date || !startTime || !endTime || !hours) {
    return { success: false, message: "請完整填寫加班資料。" };
  }

  const rate = parseFloat(compRate) || 1.0;
  const otHours = parseFloat(hours) || 0;
  const compHours = Math.round(otHours * rate * 10) / 10;

  const otSheet = ss.getSheetByName(CONFIG.SHEETS.OVERTIME_REQUESTS);
  
  // 產生加班單號 (高精度時戳 + 4位亂數 + 碰撞防重檢核迴圈)
  const otData = otSheet.getDataRange().getValues();
  const otHeaders = otData[0] || [];
  const existingOtIds = {};
  if (otData.length > 1) {
    const idIdx = otHeaders.findIndex(h => {
      const lower = String(h).trim().toLowerCase();
      return lower === "id" || h === "申請單號" || h === "單號";
    });
    if (idIdx !== -1) {
      for (let i = 1; i < otData.length; i++) {
        const val = String(otData[i][idIdx] || "").trim();
        if (val) existingOtIds[val] = true;
      }
    }
  }

  let otId = params.overtimeId;
  if (!otId || existingOtIds[otId]) {
    const datePrefix = "OT-" + Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd-HHmmss");
    let counter = 0;
    do {
      const rand = Math.floor(1000 + Math.random() * 9000);
      otId = `${datePrefix}-${rand}${counter > 0 ? '-' + counter : ''}`;
      counter++;
    } while (existingOtIds[otId]);
  }
  
  // 補休有效期限預設 1 年
  const expiryDate = new Date(date);
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);
  const expiryStr = Utilities.formatDate(expiryDate, "Asia/Taipei", "yyyy-MM-dd");
  const appliedAt = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");

  // 動態依標題欄位將加班申請單號寫入 overtime_requests 工作表 (相容 id / 申請單號 / 單號)
  if (otHeaders.length > 0) {
    const row = new Array(otHeaders.length).fill("");
    otHeaders.forEach((h, idx) => {
      const lower = String(h).trim().toLowerCase();
      if (lower === "id" || h === "申請單號" || h === "單號") row[idx] = otId;
      else if (lower === "user_id" || h === "員工編號" || h === "申請人") row[idx] = userId;
      else if (lower === "date" || h === "加班日期") row[idx] = date;
      else if (lower === "start_time" || h === "開始時間") row[idx] = startTime;
      else if (lower === "end_time" || h === "結束時間") row[idx] = endTime;
      else if (lower === "hours" || h === "加班工時") row[idx] = otHours;
      else if (lower === "comp_rate" || h === "補休倍率") row[idx] = rate;
      else if (lower === "comp_hours" || h === "補休時數") row[idx] = compHours;
      else if (lower === "reason" || h === "加班事由") row[idx] = reason || "";
      else if (lower === "status" || h === "審核狀態") row[idx] = "PENDING";
      else if (lower === "expiry_date" || h === "到期日") row[idx] = expiryStr;
      else if (lower === "applied_at" || h === "申請時間") row[idx] = appliedAt;
    });
    otSheet.appendRow(row);
  } else {
    otSheet.appendRow([
      otId,
      userId,
      date,
      startTime,
      endTime,
      otHours,
      rate,
      compHours,
      reason || "",
      "PENDING",
      expiryStr,
      appliedAt
    ]);
  }

  // 同步將加班申請單號寫入簽核歷史歷程 (approval_logs 表)
  logApproval(ss, otId, "OVERTIME", userId, "Applicant", "PENDING", reason || "送出加班申報");

  return {
    success: true,
    message: `加班申報已送出！單號：${otId}，核准後可換算 ${compHours} 小時補休額度。`,
    overtimeId: otId
  };
}

function reviewOvertime(params, action) {
  const { overtimeId, approverId, comment } = params;
  const ss = getSpreadsheet();

  const otSheet = ss.getSheetByName(CONFIG.SHEETS.OVERTIME_REQUESTS);
  const otData = otSheet.getDataRange().getValues();
  const otHeaders = otData[0];

  const idIdx = otHeaders.indexOf("id");
  const userIdx = otHeaders.indexOf("user_id");
  const dateIdx = otHeaders.indexOf("date");
  const compHoursIdx = otHeaders.indexOf("comp_hours");
  const statusIdx = otHeaders.indexOf("status");

  let targetRow = -1;
  let ot = null;

  for (let i = 1; i < otData.length; i++) {
    if (otData[i][idIdx] === overtimeId) {
      targetRow = i + 1;
      ot = {
        id: otData[i][idIdx],
        userId: otData[i][userIdx],
        date: otData[i][dateIdx],
        compHours: parseFloat(otData[i][compHoursIdx]) || 0,
        status: otData[i][statusIdx]
      };
      break;
    }
  }

  if (!ot) {
    return { success: false, message: "找不到該筆加班申報單。" };
  }

  if (ot.status !== "PENDING") {
    return { success: false, message: `此加班單狀態為 ${ot.status}，無法再審核。` };
  }

  const users = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.USERS));
  const approver = users.find(u => u.id === approverId);

  if (action === "REJECTED") {
    otSheet.getRange(targetRow, statusIdx + 1).setValue("REJECTED");
    logApproval(ss, overtimeId, "OVERTIME", approverId, approver ? approver.role : "Manager", "REJECTED", comment || "加班申報退回");
    return { success: true, message: "加班申報已退回。" };
  }

  if (action === "APPROVED") {
    otSheet.getRange(targetRow, statusIdx + 1).setValue("APPROVED");

    // 增加該員工的 COMP (補休) 額度
    const currentYear = new Date(ot.date).getFullYear();
    addCompLeaveQuota(ss, ot.userId, currentYear, ot.compHours);

    logApproval(ss, overtimeId, "OVERTIME", approverId, approver ? approver.role : "Manager", "APPROVED", comment || "加班申報核准，已發放補休額度");
    return { success: true, message: `加班申報已核准！已成功發放 ${ot.compHours} 小時補休額度至員工存摺。` };
  }

  return { success: false, message: "無效的操作指令。" };
}

// ======================== 額度調整輔助函式 ========================

function updateBalanceQuota(ss, userId, leaveTypeId, year, usedDelta, pendingDelta) {
  const balSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_BALANCES);
  const balData = balSheet.getDataRange().getValues();
  const balHeaders = balData[0];
  const userIdx = balHeaders.indexOf("user_id");
  const typeIdx = balHeaders.indexOf("leave_type_id");
  const yearIdx = balHeaders.indexOf("year");
  const usedIdx = balHeaders.indexOf("used_hours");
  const pendingIdx = balHeaders.indexOf("pending_hours");

  for (let i = 1; i < balData.length; i++) {
    if (balData[i][userIdx] === userId && balData[i][typeIdx] === leaveTypeId && parseInt(balData[i][yearIdx]) === year) {
      const currentUsed = parseFloat(balData[i][usedIdx]) || 0;
      const currentPending = parseFloat(balData[i][pendingIdx]) || 0;

      if (usedDelta !== 0) {
        balSheet.getRange(i + 1, usedIdx + 1).setValue(Math.max(0, currentUsed + usedDelta));
      }
      if (pendingDelta !== 0) {
        balSheet.getRange(i + 1, pendingIdx + 1).setValue(Math.max(0, currentPending + pendingDelta));
      }
      break;
    }
  }
}

function transferPendingToUsed(ss, userId, leaveTypeId, year, hours) {
  const balSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_BALANCES);
  const balData = balSheet.getDataRange().getValues();
  const balHeaders = balData[0];
  const userIdx = balHeaders.indexOf("user_id");
  const typeIdx = balHeaders.indexOf("leave_type_id");
  const yearIdx = balHeaders.indexOf("year");
  const usedIdx = balHeaders.indexOf("used_hours");
  const pendingIdx = balHeaders.indexOf("pending_hours");

  for (let i = 1; i < balData.length; i++) {
    if (balData[i][userIdx] === userId && balData[i][typeIdx] === leaveTypeId && parseInt(balData[i][yearIdx]) === year) {
      const currentUsed = parseFloat(balData[i][usedIdx]) || 0;
      const currentPending = parseFloat(balData[i][pendingIdx]) || 0;

      balSheet.getRange(i + 1, pendingIdx + 1).setValue(Math.max(0, currentPending - hours));
      balSheet.getRange(i + 1, usedIdx + 1).setValue(currentUsed + hours);
      break;
    }
  }
}

function addCompLeaveQuota(ss, userId, year, hours) {
  const balSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_BALANCES);
  const balData = balSheet.getDataRange().getValues();
  const balHeaders = balData[0];
  const userIdx = balHeaders.indexOf("user_id");
  const typeIdx = balHeaders.indexOf("leave_type_id");
  const yearIdx = balHeaders.indexOf("year");
  const totalIdx = balHeaders.indexOf("total_hours");

  let found = false;
  for (let i = 1; i < balData.length; i++) {
    if (balData[i][userIdx] === userId && balData[i][typeIdx] === "COMP" && parseInt(balData[i][yearIdx]) === year) {
      const currentTotal = parseFloat(balData[i][totalIdx]) || 0;
      balSheet.getRange(i + 1, totalIdx + 1).setValue(currentTotal + hours);
      found = true;
      break;
    }
  }

  if (!found) {
    const newId = `BAL_${userId}_COMP_${year}`;
    balSheet.appendRow([newId, userId, "COMP", year, hours, 0, 0]);
  }
}

function logApproval(ss, requestId, requestType, approverId, approverRole, status, comment) {
  const logSheet = ss.getSheetByName(CONFIG.SHEETS.APPROVAL_LOGS);
  if (!logSheet) return;
  const logId = "LOG-" + Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMddHHmmss") + "-" + Math.floor(10 + Math.random() * 90);
  const actedAt = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");

  // 動態依標題欄位將申請單號寫入 approval_logs 工作表 (相容 request_id / 申請單號 / 關聯單號)
  const logData = logSheet.getDataRange().getValues();
  const logHeaders = logData[0] || [];
  if (logHeaders.length > 0) {
    const row = new Array(logHeaders.length).fill("");
    logHeaders.forEach((h, idx) => {
      const lower = String(h).trim().toLowerCase();
      if (lower === "id" || h === "歷程編號") row[idx] = logId;
      else if (lower === "request_id" || h === "申請單號" || h === "關聯單號" || h === "單號") row[idx] = requestId;
      else if (lower === "request_type" || h === "項目類型" || h === "類型") row[idx] = requestType;
      else if (lower === "approver_id" || h === "簽核人員" || h === "操作人員") row[idx] = approverId;
      else if (lower === "approver_role" || h === "簽核身分" || h === "身分") row[idx] = approverRole;
      else if (lower === "status" || h === "簽核決策" || h === "狀態") row[idx] = status;
      else if (lower === "comment" || h === "簽核意見" || h === "意見") row[idx] = comment || "";
      else if (lower === "acted_at" || h === "操作時間" || h === "簽核時間") row[idx] = actedAt;
    });
    logSheet.appendRow(row);
  } else {
    logSheet.appendRow([
      logId,
      requestId,
      requestType,
      approverId,
      approverRole,
      status,
      comment || "",
      actedAt
    ]);
  }
}

// ======================== 後台管理功能 ========================

function adminUpdateBalance(params) {
  const { balanceId, totalHours } = params;
  const ss = getSpreadsheet();
  const balSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_BALANCES);
  const balData = balSheet.getDataRange().getValues();
  const idIdx = balData[0].indexOf("id");
  const totalIdx = balData[0].indexOf("total_hours");

  for (let i = 1; i < balData.length; i++) {
    if (balData[i][idIdx] === balanceId) {
      balSheet.getRange(i + 1, totalIdx + 1).setValue(parseFloat(totalHours) || 0);
      return { success: true, message: "額度已成功更新。" };
    }
  }
  return { success: false, message: "找不到該額度紀錄。" };
}

function adminUpdateUser(params) {
  const { id, name, department_name, manager_id, role, hire_date } = params;
  const ss = getSpreadsheet();
  const userSheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
  const userData = userSheet.getDataRange().getValues();
  const headers = userData[0];

  const idIdx = headers.indexOf("id");
  const nameIdx = headers.indexOf("name");
  const deptIdx = headers.indexOf("department_name");
  const mgrIdx = headers.indexOf("manager_id");
  const roleIdx = headers.indexOf("role");
  let hireIdx = headers.indexOf("hire_date");

  if (hireIdx === -1) {
    userSheet.getRange(1, headers.length + 1).setValue("hire_date");
    hireIdx = headers.length;
  }

  for (let i = 1; i < userData.length; i++) {
    if (userData[i][idIdx] === id) {
      if (name) userSheet.getRange(i + 1, nameIdx + 1).setValue(name);
      if (department_name) userSheet.getRange(i + 1, deptIdx + 1).setValue(department_name);
      if (manager_id !== undefined) userSheet.getRange(i + 1, mgrIdx + 1).setValue(manager_id);
      if (role) userSheet.getRange(i + 1, roleIdx + 1).setValue(role);
      if (hire_date) userSheet.getRange(i + 1, hireIdx + 1).setValue(hire_date);

      // 自動依到職日重新同步全體特休額度
      syncStatutoryAnnualLeaves(ss);

      return { success: true, message: "使用者資料已更新，且已依到職日自動重新計算勞基法特休額度！" };
    }
  }
  return { success: false, message: "找不到該使用者。" };
}

// ======================== 工具函式 ========================

function adminCreateUser(params) {
  const { id, name, email, password, department_id, department_name, manager_id, role, hire_date } = params;
  if (!name || !email) {
    return { success: false, message: "請務必填寫員工姓名與電子信箱！" };
  }

  const ss = getSpreadsheet();
  const userSheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
  const balSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_BALANCES);
  const userData = userSheet.getDataRange().getValues();
  const userHeaders = userData[0];

  // 自動編號 ID (若未指定，則自動遞增 EMPxxx)
  let newId = id;
  if (!newId) {
    const maxNum = userData.slice(1).reduce((max, r) => {
      const match = String(r[0]).match(/\d+/);
      return match ? Math.max(max, parseInt(match[0], 10)) : max;
    }, 0);
    newId = "EMP" + ("00" + (maxNum + 1)).slice(-3);
  }

  // 檢查 Email 是否重複
  const emailIdx = userHeaders.indexOf("email");
  const duplicate = userData.slice(1).find(r => String(r[emailIdx]).trim().toLowerCase() === String(email).trim().toLowerCase());
  if (duplicate) {
    return { success: false, message: `Email: ${email} 已存在於系統中，請勿重複新增！` };
  }

  const passwordHash = password || "123456";
  const deptMap = {
    "研發部": "DEPT_RD",
    "設計部": "DEPT_DESIGN",
    "管理部": "DEPT_MGMT",
    "業務部": "DEPT_SALES",
    "工程部": "DEPT_ENG",
    "財務部": "DEPT_FIN",
    "維修部": "DEPT_MAINT",
    "人資部": "DEPT_HR",
    "人力資源部": "DEPT_HR"
  };
  const deptName = department_name || "研發部";
  const deptId = department_id || deptMap[deptName] || "DEPT_RD";
  const mgrId = manager_id || "EMP002";
  const userRole = role || "Employee";
  const hireDateVal = hire_date || Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
  const createdAt = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");

  // 確保標題列有 hire_date
  let hireIdx = userHeaders.indexOf("hire_date");
  if (hireIdx === -1) {
    userSheet.getRange(1, userHeaders.length + 1).setValue("hire_date");
    userHeaders.push("hire_date");
  }

  // 動態依標題欄位名稱組裝資料列，100% 避免欄位順序相反或錯位
  const newRow = new Array(userHeaders.length);
  userHeaders.forEach((col, idx) => {
    switch (col) {
      case "id": newRow[idx] = newId; break;
      case "name": newRow[idx] = name; break;
      case "email": newRow[idx] = email; break;
      case "password_hash": newRow[idx] = passwordHash; break;
      case "department_id": newRow[idx] = deptId; break;
      case "department_name": newRow[idx] = deptName; break;
      case "manager_id": newRow[idx] = mgrId; break;
      case "role": newRow[idx] = userRole; break;
      case "hire_date": newRow[idx] = hireDateVal; break;
      case "created_at": newRow[idx] = createdAt; break;
      default: newRow[idx] = "";
    }
  });

  // 新增使用者至 users 表
  userSheet.appendRow(newRow);

  // 計算並初始化該員工之額度 (leave_balances)
  const currentYear = CONFIG.CURRENT_YEAR || 2026;
  const annualHours = calculateStatutoryAnnualLeaveHours(hireDateVal);

  const initialBalances = [
    ["BAL_" + newId + "_ANNUAL_" + currentYear, newId, "ANNUAL", currentYear, annualHours, 0.0, 0.0],
    ["BAL_" + newId + "_COMP_" + currentYear, newId, "COMP", currentYear, 0.0, 0.0, 0.0],
    ["BAL_" + newId + "_PERSONAL_" + currentYear, newId, "PERSONAL", currentYear, 112.0, 0.0, 0.0],
    ["BAL_" + newId + "_SICK_" + currentYear, newId, "SICK", currentYear, 240.0, 0.0, 0.0]
  ];

  initialBalances.forEach(row => {
    balSheet.appendRow(row);
  });

  return {
    success: true,
    message: `員工 ${name} (${newId}) 已成功新增！系統已自動依勞基法核發特休 ${annualHours} 小時並初始化事病假額度。`,
    user: {
      id: newId,
      name,
      email,
      department_id: deptId,
      department_name: deptName,
      manager_id: mgrId,
      role: userRole,
      hire_date: hireDateVal
    }
  };
}

function adminDeleteUser(params) {
  const { id } = params;
  if (!id) {
    return { success: false, message: "請指定要刪除的員工 ID！" };
  }

  const ss = getSpreadsheet();
  const userSheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
  const balSheet = ss.getSheetByName(CONFIG.SHEETS.LEAVE_BALANCES);
  const userData = userSheet.getDataRange().getValues();
  const idIdx = userData[0].indexOf("id");
  const nameIdx = userData[0].indexOf("name");

  let deletedUserName = "";
  let userDeleted = false;

  // 1. 從 users 表刪除該列 (從後往前找)
  for (let i = userData.length - 1; i >= 1; i--) {
    if (String(userData[i][idIdx]).trim() === String(id).trim()) {
      deletedUserName = userData[i][nameIdx] || id;
      userSheet.deleteRow(i + 1);
      userDeleted = true;
      break;
    }
  }

  if (!userDeleted) {
    return { success: false, message: `找不到員工編號: ${id}` };
  }

  // 2. 從 leave_balances 表一併清除該員工之額度紀錄
  if (balSheet) {
    const balData = balSheet.getDataRange().getValues();
    const balUserIdx = balData[0].indexOf("user_id");
    if (balUserIdx !== -1) {
      for (let j = balData.length - 1; j >= 1; j--) {
        if (String(balData[j][balUserIdx]).trim() === String(id).trim()) {
          balSheet.deleteRow(j + 1);
        }
      }
    }
  }

  return {
    success: true,
    message: `員工 ${deletedUserName} (${id}) 已成功刪除，相關假別額度紀錄亦已一併清除！`
  };
}

function sheetToObjects(sheet) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const results = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      let val = row[j];
      if (val instanceof Date) {
        if (header === "hire_date" || header === "date") {
          val = Utilities.formatDate(val, "Asia/Taipei", "yyyy-MM-dd");
        } else {
          val = Utilities.formatDate(val, "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");
        }
      } else if (typeof val === "string" && (header === "hire_date" || header === "date")) {
        val = val.substring(0, 10);
      }
      obj[header] = val;
      // 雙向相容中英文單號與歷程欄位名稱
      const hTrim = String(header).trim().toLowerCase();
      if (hTrim === "id" || header === "申請單號" || header === "單號" || header === "歷程編號") {
        if (!obj.id) obj.id = val;
        if (!obj["申請單號"]) obj["申請單號"] = val;
      }
      if (hTrim === "request_id" || header === "關聯單號" || header === "申請單號") {
        if (!obj.request_id) obj.request_id = val;
        if (!obj["關聯單號"]) obj["關聯單號"] = val;
        if (!obj["申請單號"]) obj["申請單號"] = val;
      }
      // 雙向相容 leave_balances 假別額度欄位名稱
      if (hTrim === "user_id" || header === "員工編號" || header === "工號" || header === "申請人") {
        if (!obj.user_id) obj.user_id = val;
      }
      if (hTrim === "leave_type_id" || header === "假別代碼" || header === "假別" || header === "請假類別") {
        if (!obj.leave_type_id) obj.leave_type_id = val;
      }
      if (hTrim === "year" || header === "年度" || header === "年份") {
        if (!obj.year) obj.year = val;
      }
      if (hTrim === "total_hours" || header === "總額度" || header === "總時數" || header === "額度" || header === "特休時數") {
        if (!obj.total_hours) obj.total_hours = val;
      }
      if (hTrim === "used_hours" || header === "已使用" || header === "已休時數" || header === "已用時數" || header === "已休") {
        if (!obj.used_hours) obj.used_hours = val;
      }
      if (hTrim === "pending_hours" || header === "審核鎖定" || header === "審核中時數" || header === "鎖定時數" || header === "待審") {
        if (!obj.pending_hours) obj.pending_hours = val;
      }
    }
    results.push(obj);
  }
  return results;
}

function formatDateOnly(d) {
  if (!d) return "";
  if (typeof d === "string") return d.substring(0, 10);
  const year = d.getFullYear();
  const month = ("0" + (d.getMonth() + 1)).slice(-2);
  const day = ("0" + d.getDate()).slice(-2);
  return `${year}-${month}-${day}`;
}
