/**
 * 智慧請假計算核心引擎 (Leave Calculation & Validation Engine)
 */
const LeaveEngine = {
  /**
   * 計算請假工時
   * @param {string|Date} startInput 起始時間 (YYYY-MM-DD HH:mm)
   * @param {string|Date} endInput 結束時間 (YYYY-MM-DD HH:mm)
   * @param {Array} holidays 假日清單 [{date: 'YYYY-MM-DD', is_workday: false}]
   * @returns {number} 總請假工時 (小時)
   */
  calculateHours(startInput, endInput, holidays = []) {
    if (!startInput || !endInput) return 0;

    const startDate = new Date(startInput);
    const endDate = new Date(endInput);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return 0;
    if (endDate <= startDate) return 0;

    // 建立公休 Map
    const holidayMap = {};
    const holidayList = (holidays && holidays.length > 0) ? holidays : SYSTEM_CONFIG.DEFAULT_HOLIDAYS;
    holidayList.forEach(h => {
      const dKey = typeof h.date === "string" ? h.date.substring(0, 10) : LeaveEngine.formatDateOnly(new Date(h.date));
      holidayMap[dKey] = (h.is_workday === true || h.is_workday === "true");
    });

    let totalHours = 0;
    let curr = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const lastDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

    while (curr <= lastDay) {
      const dateKey = LeaveEngine.formatDateOnly(curr);
      const dayOfWeek = curr.getDay(); // 0: 週日, 6: 週六

      // 判斷是否為應上班之工作日
      let isWorkDay = (dayOfWeek !== 0 && dayOfWeek !== 6);
      if (holidayMap[dateKey] !== undefined) {
        isWorkDay = holidayMap[dateKey];
      }

      if (isWorkDay) {
        const isStartDay = (LeaveEngine.formatDateOnly(curr) === LeaveEngine.formatDateOnly(startDate));
        const isEndDay = (LeaveEngine.formatDateOnly(curr) === LeaveEngine.formatDateOnly(endDate));

        // 當日標準工作起訖時間 (以小時為單位數值：8.5 代表 08:30，18.0 代表 18:00)
        let dayStartVal = 8.5;
        let dayEndVal = 18.0;

        if (isStartDay) {
          const sHour = startDate.getHours() + startDate.getMinutes() / 60;
          dayStartVal = Math.max(8.5, sHour);
        }
        if (isEndDay) {
          const eHour = endDate.getHours() + endDate.getMinutes() / 60;
          dayEndVal = Math.min(18.0, eHour);
        }

        if (dayEndVal > dayStartVal) {
          let dayWorkTime = 0;

          // 區間一：上午 08:30 ~ 12:00 (最多 3.5 小時)
          const mStart = Math.max(8.5, dayStartVal);
          const mEnd = Math.min(12.0, dayEndVal);
          if (mEnd > mStart) {
            dayWorkTime += (mEnd - mStart);
          }

          // 區間二：下午 13:30 ~ 18:00 (最多 4.5 小時)
          const aStart = Math.max(13.5, dayStartVal);
          const aEnd = Math.min(18.0, dayEndVal);
          if (aEnd > aStart) {
            dayWorkTime += (aEnd - aStart);
          }

          totalHours += dayWorkTime;
        }
      }

      // 移至下一天
      curr.setDate(curr.getDate() + 1);
    }

    // 四捨五入至小數點第一位 (例如 0.5, 3.5, 8.0)
    return Math.round(totalHours * 10) / 10;
  },

  /**
   * 檢查時間是否與已存在的申請單重疊 (Overlapping Check)
   */
  checkOverlapping(startInput, endInput, existingRequests = [], userId, excludeRequestId = null) {
    if (!startInput || !endInput || !userId) return { hasOverlap: false };

    const newStart = new Date(startInput).getTime();
    const newEnd = new Date(endInput).getTime();

    for (const req of existingRequests) {
      if (req.user_id !== userId) continue;
      if (excludeRequestId && req.id === excludeRequestId) continue;
      // 僅檢核 生效中/審核中/銷假中的單據
      if (["PENDING", "APPROVED", "CANCEL_PENDING"].indexOf(req.status) === -1) continue;

      const reqStart = new Date(req.start_time).getTime();
      const reqEnd = new Date(req.end_time).getTime();

      // 重疊條件：Max(StartA, StartB) < Min(EndA, EndB)
      if (Math.max(newStart, reqStart) < Math.min(newEnd, reqEnd)) {
        return {
          hasOverlap: true,
          conflictedRequest: req
        };
      }
    }

    return { hasOverlap: false };
  },

  /**
   * 計算審核鏈路線與審核人
   */
  getApprovalRoute(totalHours, applicantUser, allUsers = []) {
    const isMultiTier = (totalHours > SYSTEM_CONFIG.MULTI_TIER_THRESHOLD_HOURS);
    
    // 直屬主管
    const manager = allUsers.find(u => u.id === (applicantUser ? applicantUser.manager_id : "")) || {
      id: "EMP002",
      name: "部門主管",
      role: "Manager"
    };

    // 人資 (HR)
    const hr = allUsers.find(u => u.role === "HR" || u.department_id === "DEPT_HR" || u.role === "Admin") || {
      id: "EMP003",
      name: "林經理 (人資主管)",
      role: "HR"
    };

    if (isMultiTier) {
      return {
        isMultiTier: true,
        summary: `多階審核：時數 ${totalHours} 小時 (> 3天 / 24h)，需經由【直屬主管】與【人資部門】雙階簽核。`,
        steps: [
          { step: "MANAGER", title: "第一階：部門直屬主管", approver: manager.name, approverId: manager.id },
          { step: "HR", title: "第二階：人力資源部 (HR)", approver: hr.name, approverId: hr.id }
        ]
      };
    } else {
      return {
        isMultiTier: false,
        summary: `單階審核：時數 ${totalHours} 小時 (<= 3天 / 24h)，由【直屬主管】簽核即可生效。`,
        steps: [
          { step: "MANAGER", title: "單一階層：部門直屬主管", approver: manager.name, approverId: manager.id }
        ]
      };
    }
  },

  /**
   * 依照台灣勞動基準法第38條施行細則第24條之1【歷年制】計算特別休假 (每年 1/1 ~ 12/31 重新核算)
   * @param {string|Date} hireDate 到職日 (YYYY-MM-DD)
   * @param {number|Date} asOfYearOrDate 結算年度 (數字如 2026 或 Date)
   * @returns {Object} { year, years, months, totalMonths, days, hours, tierDesc, seniorityText, description }
   */
  calculateStatutoryAnnualLeave(hireDate, asOfYearOrDate = 2026) {
    const targetYear = typeof asOfYearOrDate === "number" ? asOfYearOrDate : (asOfYearOrDate instanceof Date ? asOfYearOrDate.getFullYear() : 2026);
    if (!hireDate) return { year: targetYear, years: 0, months: 0, totalMonths: 0, days: 0, hours: 0, tierDesc: "--", seniorityText: "--", description: "尚未設定到職日" };

    const h = new Date(hireDate);
    if (isNaN(h.getTime())) {
      return { year: targetYear, years: 0, months: 0, totalMonths: 0, days: 0, hours: 0, tierDesc: "--", seniorityText: "--", description: "到職日無效" };
    }

    const yearStart = new Date(targetYear, 0, 1);
    const yearEnd = new Date(targetYear, 11, 31);
    const totalYearDays = Math.round((yearEnd - yearStart) / (1000 * 60 * 60 * 24)) + 1; // 365 或 366 天

    if (h > yearEnd) {
      return {
        year: targetYear,
        years: 0,
        months: 0,
        totalMonths: 0,
        days: 0,
        hours: 0,
        tierDesc: "該年度尚未到職",
        seniorityText: "未到職",
        description: `員工於 ${LeaveEngine.formatDateOnly(h)} 到職，在 ${targetYear} 年度尚未起算年資。`
      };
    }

    // 截至當年度 12/31 之累計年資
    let years = targetYear - h.getFullYear();
    let months = 11 - h.getMonth();
    let daysDiff = 31 - h.getDate();
    if (daysDiff < 0) months -= 1;
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    const totalMonths = Math.max(0, years * 12 + months);

    // 勞基法週年法定基準天數表
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
    let formulaDesc = "";

    // 1. 若為當年度內到職
    if (h.getFullYear() === targetYear) {
      const sixMonthDate = new Date(h);
      sixMonthDate.setMonth(sixMonthDate.getMonth() + 6);
      if (sixMonthDate <= yearEnd) {
        statutoryDays = 3.0;
        formulaDesc = `當年度滿半年取得 3 天 (${LeaveEngine.formatDateOnly(sixMonthDate)} 起可休)`;
      } else {
        statutoryDays = 0.0;
        formulaDesc = "當年度未滿 6 個月：0 天";
      }
    } else {
      // 2. 前一年度或更早到職：以到職週年日切分前後段比例
      const anniversary = new Date(targetYear, h.getMonth(), h.getDate());
      const priorYears = targetYear - h.getFullYear() - 1; // 1/1~週年日前之完整年資
      const nextYears = priorYears + 1; // 週年日後之完整年資

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

      formulaDesc = `歷年制分段：前段(${priorYears}年: ${part1Days.toFixed(1)}天) + 後段(${nextYears}年: ${part2Days.toFixed(1)}天) = ${statutoryDays} 天`;
    }

    const statutoryHours = Math.round(statutoryDays * 8.0 * 10) / 10;

    return {
      year: targetYear,
      years,
      months,
      totalMonths,
      days: statutoryDays,
      hours: statutoryHours,
      tierDesc: formulaDesc,
      seniorityText: `${years} 年 ${months} 個月`,
      description: `${targetYear} 歷年制核算：年資 ${years} 年 ${months} 個月，核發特休 ${statutoryDays} 天 (${statutoryHours} 小時)`
    };
  },

  /**
   * 格式化日期 YYYY-MM-DD
   */
  formatDateOnly(date) {
    if (!date) return "";
    if (typeof date === "string") {
      const match = date.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (match) {
        const y = match[1];
        const m = ("0" + match[2]).slice(-2);
        const d = ("0" + match[3]).slice(-2);
        return `${y}-${m}-${d}`;
      }
    }
    const d = new Date(date);
    if (isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = ("0" + (d.getMonth() + 1)).slice(-2);
    const day = ("0" + d.getDate()).slice(-2);
    return `${year}-${month}-${day}`;
  },

  /**
   * 格式化日期時間 YYYY-MM-DD HH:mm
   */
  formatDateTime(date) {
    if (!date) return "";
    const d = new Date(date);
    const year = d.getFullYear();
    const month = ("0" + (d.getMonth() + 1)).slice(-2);
    const day = ("0" + d.getDate()).slice(-2);
    const hours = ("0" + d.getHours()).slice(-2);
    const minutes = ("0" + d.getMinutes()).slice(-2);
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  },

  /**
   * 格式化時段 HH:mm (自動去除日期前綴)
   */
  formatTimeOnly(timeStr) {
    if (!timeStr) return "";
    let s = String(timeStr).trim();
    if (s.includes("T")) {
      s = s.split("T")[1];
    } else if (s.includes(" ")) {
      const parts = s.split(" ");
      s = parts[parts.length - 1];
    }
    const match = s.match(/(\d{1,2}:\d{2})/);
    return match ? match[1] : s;
  },

  /**
   * 判定使用者是否具備管理者/人資權限 (完全以 role 欄位為準)
   */
  isUserAdmin(user) {
    if (!user) return false;
    const id = (user.id || "").toString().trim().toUpperCase();
    const role = (user.role || "").toString().trim().toLowerCase();

    return (
      id === "EMP001" ||
      role === "admin" ||
      role === "hr" ||
      role === "管理者" ||
      role === "管理員" ||
      role === "人資" ||
      role === "人事" ||
      role === "超級管理員" ||
      role === "超級管理者"
    );
  },

  /**
   * 判定使用者是否具備最高系統管理者權限 (可存取 Google Sheet / GAS 後端串接設定，排除純 HR 權限)
   */
  isSystemAdmin(user) {
    if (!user) return false;
    const id = (user.id || "").toString().trim().toUpperCase();
    const role = (user.role || "").toString().trim().toLowerCase();

    // 純 HR / 人資 / 人事身分不具備後端串接設定權限
    if (role === "hr" || role === "人資" || role === "人事") {
      return false;
    }

    return (
      id === "EMP001" ||
      role === "admin" ||
      role === "管理者" ||
      role === "管理員" ||
      role === "超級管理員" ||
      role === "超級管理者"
    );
  },

  /**
   * 判定使用者是否為 HR / 人資身分
   */
  isHR(user) {
    if (!user) return false;
    const role = (user.role || "").toString().trim().toLowerCase();
    return role === "hr" || role === "人資" || role === "人事";
  },

  /**
   * 判定使用者是否具備主管權限 (純粹以 role 欄位為準)
   */
  isUserManager(user) {
    if (!user) return false;
    const role = (user.role || "").toString().trim().toLowerCase();
    return (
      role === "manager" ||
      role === "主管" ||
      role === "部門主管"
    );
  },

  /**
   * 檢核請假單銷假功能是否已逾期失效 (請假日期後 7 天失效)
   * @param {Object} req 請假單物件 (需包含 end_time 或 start_time)
   * @param {Date} [now=new Date()] 當前比對基準時間 (預設當前時間)
   * @returns {Object} { isExpired: boolean, expiryDate: Date, expiryDateStr: string, daysRemaining: number }
   */
  checkCancelLeaveExpiry(req, now = new Date()) {
    if (!req) return { isExpired: false, expiryDate: null, expiryDateStr: "", daysRemaining: 0 };
    const leaveTime = req.end_time || req.start_time;
    if (!leaveTime) return { isExpired: false, expiryDate: null, expiryDateStr: "", daysRemaining: 0 };

    const datePart = String(leaveTime).split(" ")[0].replace(/\//g, "-");
    const parts = datePart.split("-").map(Number);
    if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
      return { isExpired: false, expiryDate: null, expiryDateStr: "", daysRemaining: 0 };
    }

    // 請假末日當天 23:59:59.999 為起算基準
    const leaveEndDay = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999);
    const limitDays = (typeof SYSTEM_CONFIG !== "undefined" && SYSTEM_CONFIG.CANCEL_LEAVE_EXPIRY_DAYS) ? SYSTEM_CONFIG.CANCEL_LEAVE_EXPIRY_DAYS : 7;
    const expiryTime = leaveEndDay.getTime() + limitDays * 24 * 60 * 60 * 1000;
    const expiryDate = new Date(expiryTime);

    const checkTime = (now instanceof Date) ? now.getTime() : new Date(now).getTime();
    const isExpired = checkTime > expiryTime;
    const diffMs = expiryTime - checkTime;
    const daysRemaining = isExpired ? 0 : Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    const expYear = expiryDate.getFullYear();
    const expMonth = ("0" + (expiryDate.getMonth() + 1)).slice(-2);
    const expDay = ("0" + expiryDate.getDate()).slice(-2);
    const expiryDateStr = expYear + "-" + expMonth + "-" + expDay;

    return {
      isExpired,
      expiryDate,
      expiryDateStr,
      daysRemaining
    };
  }
};
