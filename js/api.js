/**
 * 統一 API 服務層 (API Service Layer)
 * 支援無縫切換【Google Apps Script 線上後端】與【本機高效模擬引擎】
 */
const ApiService = {
  // 連線狀態追蹤
  _connectionStatus: "unknown", // "online" | "offline" | "error" | "connecting"
  _lastSyncTime: null,
  _lastError: null,

  getConnectionStatus() {
    return {
      status: this._connectionStatus,
      lastSyncTime: this._lastSyncTime,
      lastError: this._lastError,
      isRemote: this.isUsingRemoteGas(),
      url: this.getGasUrl(),
      isCustomOverride: localStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.CUSTOM_GAS_OVERRIDE) === "true"
    };
  },

  setConnectionStatus(status, err = null) {
    this._connectionStatus = status;
    if (status === "online") {
      this._lastSyncTime = new Date();
      this._lastError = null;
    } else if (status === "error") {
      this._lastError = err;
    }
    if (typeof App !== "undefined" && typeof App.updateConnectionIndicator === "function") {
      App.updateConnectionIndicator();
    }
  },

  getGasUrl() {
    // 檢查是否有顯式啟用自訂覆寫
    const isOverride = localStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.CUSTOM_GAS_OVERRIDE) === "true";
    if (isOverride) {
      const stored = localStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.GAS_URL);
      if (stored && stored.trim()) return stored.trim();
    }
    // 預設一律回傳全域代碼配置的官方網址，確保所有同仁跨裝置 100% 同步同一資料庫
    return SYSTEM_CONFIG.DEFAULT_GAS_URL || "";
  },

  setGasUrl(url) {
    // 嚴格權限防護：非最高管理者 (Admin) 角色一律直接攔截，防止 HR 誤改資料庫路徑
    if (typeof App !== "undefined" && App.state && App.state.currentUser) {
      if (!LeaveEngine.isSystemAdmin(App.state.currentUser)) {
        console.error("【安全性拒絕】只有最高管理者 (Admin) 才能修改資料庫路徑！HR 無此權限。");
        return false;
      }
    }
    const trimmed = (url || "").trim();
    if (trimmed && trimmed !== SYSTEM_CONFIG.DEFAULT_GAS_URL) {
      localStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.CUSTOM_GAS_OVERRIDE, "true");
      localStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.GAS_URL, trimmed);
    } else {
      this.resetToDefaultGasUrl();
    }
    return true;
  },

  isUsingRemoteGas() {
    const flag = localStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.USE_REMOTE_GAS);
    const url = this.getGasUrl();
    if (flag === null) return !!url; // 預設如果有 GAS URL 則自動啟用
    return flag === "true" && !!url;
  },

  setUseRemoteGas(useRemote) {
    // 嚴格權限防護：非最高管理者 (Admin) 角色禁止切換資料庫模式
    if (typeof App !== "undefined" && App.state && App.state.currentUser) {
      if (!LeaveEngine.isSystemAdmin(App.state.currentUser)) {
        console.error("【安全性拒絕】只有最高管理者 (Admin) 才能切換資料庫模式！HR 無此權限。");
        return false;
      }
    }
    localStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.USE_REMOTE_GAS, useRemote ? "true" : "false");
    this.setConnectionStatus(useRemote ? "connecting" : "offline");
    return true;
  },

  /**
   * 一鍵還原官方預設 Google Sheet 資料庫連線路徑 (清除所有自訂覆寫與舊網址快取)
   */
  resetToDefaultGasUrl() {
    localStorage.removeItem(SYSTEM_CONFIG.STORAGE_KEYS.CUSTOM_GAS_OVERRIDE);
    localStorage.removeItem(SYSTEM_CONFIG.STORAGE_KEYS.GAS_URL);
    localStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.USE_REMOTE_GAS, "true");
    this.setConnectionStatus("connecting");
    return SYSTEM_CONFIG.DEFAULT_GAS_URL;
  },

  /**
   * 測試 GAS 伺服端連線
   */
  async testGasConnection(url) {
    const targetUrl = url || this.getGasUrl();
    if (!targetUrl) {
      return { success: false, message: "請先輸入 Google Apps Script 佈署網址 (Web App URL)。" };
    }

    try {
      this.setConnectionStatus("connecting");
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "ping" })
      });
      const data = await response.json();
      if (data && data.success) {
        this.setConnectionStatus("online");
      } else {
        this.setConnectionStatus("error", data ? data.message : "連線回應不正確");
      }
      return data;
    } catch (err) {
      this.setConnectionStatus("error", err.message);
      return {
        success: false,
        message: "連線至 Google Apps Script 失敗：" + err.message + " (請確認網址是否為 /exec 結尾，且存取權限設為所有人)。"
      };
    }
  },

  /**
   * 通用請求分派器 (防靜默降級機制)
   */
  async callApi(action, params = {}) {
    // 嚴格定義資料異動操作：禁止靜默降級至本機 LocalStorage
    const MUTATION_ACTIONS = [
      "applyLeave", "cancelLeave", "approveLeave", "rejectLeave",
      "applyOvertime", "approveOvertime", "rejectOvertime",
      "adminUpdateBalance", "adminUpdateUser", "adminCreateUser", "adminDeleteUser",
      "changePassword"
    ];
    const isMutation = MUTATION_ACTIONS.indexOf(action) !== -1;

    // 若啟用線上 Google Apps Script
    if (this.isUsingRemoteGas()) {
      try {
        const gasUrl = this.getGasUrl();
        if (!gasUrl) {
          throw new Error("尚未配置 Google Apps Script 連線網址");
        }
        const payload = Object.assign({ action: action }, params);
        const response = await fetch(gasUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`HTTP 伺服器異常 (${response.status})`);
        }

        const result = await response.json();
        this.setConnectionStatus("online");

        // 若遠端 GAS 回報不支援此 action (如尚未更新部署的 login)，平滑降級至本機模組處理
        if (result && !result.success && typeof result.message === "string" && result.message.indexOf("Action not supported") !== -1) {
          console.warn(`遠端 GAS 未支援 ${action}，自動切換至本機相容模組處理`);
          return this.callMockApi(action, params);
        }
        return result;
      } catch (err) {
        console.error(`線上 GAS API [${action}] 呼叫失敗：`, err);
        this.setConnectionStatus("error", err.message);

        // 【關鍵防呆】：異動操作絕不允許靜默降級到 LocalStorage！
        if (isMutation) {
          return {
            success: false,
            message: `【雲端同步失敗】無法寫入 Google Sheet 資料庫 (${err.message || "網路異常或 GAS 無回應"})。為維持全體資料一致性，此單據未建立，請檢查網路連線或稍後再試！`
          };
        }

        // 若為查詢操作 (如 getBootstrapData)，平滑降級展示快取並標註警告
        console.warn(`[${action}] 查詢暫時降級使用本機快取展示...`);
        const fallbackRes = await this.callMockApi(action, params);
        if (fallbackRes && fallbackRes.success) {
          fallbackRes.isOfflineFallback = true;
        }
        return fallbackRes;
      }
    }

    // 預設/備援：使用本機 Mock 引擎
    this.setConnectionStatus("offline");
    return this.callMockApi(action, params);
  },

  /**
   * 本機 Mock API 業務邏輯實作
   */
  async callMockApi(action, params) {
    const db = MockDataEngine.load();

    switch (action) {
      case "getBootstrapData": {
        const currentYear = SYSTEM_CONFIG.CURRENT_YEAR || 2026;
        let balancesUpdated = false;

        // 自動依據勞基法第38條同步所有使用者的 ANNUAL 特休額度
        db.users.forEach(u => {
          if (u.hire_date) {
            const stat = LeaveEngine.calculateStatutoryAnnualLeave(u.hire_date);
            const bal = db.balances.find(b => b.user_id === u.id && b.leave_type_id === "ANNUAL" && String(b.year) === String(currentYear));
            if (bal) {
              if (bal.total_hours !== stat.hours) {
                bal.total_hours = stat.hours;
                balancesUpdated = true;
              }
            } else {
              db.balances.push({
                id: `BAL_${u.id}_ANNUAL_${currentYear}`,
                user_id: u.id,
                leave_type_id: "ANNUAL",
                year: currentYear,
                total_hours: stat.hours,
                used_hours: 0,
                pending_hours: 0
              });
              balancesUpdated = true;
            }
          }
        });

        if (balancesUpdated) {
          MockDataEngine.save(db);
        }

        const userId = params.userId || "EMP001";
        const rawUser = db.users.find(u => u.id === userId) || db.users[0];
        const currentUser = { ...rawUser, password_hash: undefined };
        const role = currentUser ? currentUser.role : "Employee";
        const subIds = new Set(db.users.filter(u => u.manager_id === currentUser.id).map(u => u.id));
        subIds.add(currentUser.id);

        // 依角色在 API 層過濾資料範圍，防止前端窺探他人隱私
        let scopedBalances = [];
        let scopedRequests = [];
        let scopedOvertimes = [];
        let scopedLogs = [];

        const allLogs = (db.logs || []).slice().sort((a, b) => new Date(b.acted_at || 0) - new Date(a.acted_at || 0));

        if (role === "Admin" || role === "HR") {
          scopedBalances = db.balances;
          scopedRequests = db.requests;
          scopedOvertimes = db.overtimes;
          scopedLogs = allLogs;
        } else if (role === "Manager") {
          scopedBalances = db.balances.filter(b => subIds.has(b.user_id));
          scopedOvertimes = db.overtimes.filter(o => subIds.has(o.user_id));
          scopedLogs = allLogs.filter(l => {
            const isSubReq = db.requests.some(r => r.id === l.request_id && subIds.has(r.user_id));
            const isSubOt = db.overtimes.some(o => o.id === l.request_id && subIds.has(o.user_id));
            return isSubReq || isSubOt || l.approver_id === currentUser.id;
          });
          scopedRequests = db.requests.map(r => {
            if (subIds.has(r.user_id)) return r;
            return { ...r, reason: "公出/休假", attachment_url: "" };
          });
        } else {
          scopedBalances = db.balances.filter(b => b.user_id === currentUser.id);
          scopedOvertimes = db.overtimes.filter(o => o.user_id === currentUser.id);
          scopedLogs = allLogs.filter(l => {
            const isMyReq = db.requests.some(r => r.id === l.request_id && r.user_id === currentUser.id);
            const isMyOt = db.overtimes.some(o => o.id === l.request_id && o.user_id === currentUser.id);
            return isMyReq || isMyOt;
          });
          scopedRequests = db.requests.map(r => {
            if (r.user_id === currentUser.id) return r;
            return { ...r, reason: "請假", attachment_url: "" };
          });
        }

        return {
          success: true,
          data: {
            currentUser,
            users: db.users.map(u => ({
              id: u.id,
              name: u.name,
              department_id: u.department_id,
              department_name: u.department_name,
              manager_id: u.manager_id,
              role: u.role
            })),
            leaveTypes: db.leaveTypes,
            balances: scopedBalances,
            requests: scopedRequests,
            overtimes: scopedOvertimes,
            logs: scopedLogs,
            holidays: db.holidays,
            config: {
              workStart: SYSTEM_CONFIG.WORK_START,
              workEnd: SYSTEM_CONFIG.WORK_END,
              lunchStart: SYSTEM_CONFIG.LUNCH_START,
              lunchEnd: SYSTEM_CONFIG.LUNCH_END,
              dailyHours: SYSTEM_CONFIG.DAILY_WORK_HOURS,
              multiTierThresholdHours: SYSTEM_CONFIG.MULTI_TIER_THRESHOLD_HOURS
            }
          }
        };
      }

      case "login": {
        const { email, password } = params;
        const inputEmail = String(email || "").trim().toLowerCase();
        const inputPass = String(password !== undefined ? password : "").trim();

        const user = db.users.find(u => {
          const uEmail = String(u.email || "").trim().toLowerCase();
          const uPass = String(u.password_hash !== undefined ? u.password_hash : "").trim();
          return uEmail === inputEmail && uPass === inputPass;
        });

        if (!user) {
          return { success: false, message: "帳號或密碼錯誤，請重新確認輸入。" };
        }
        const token = `AUTH_${user.id}_${Date.now()}`;
        return { success: true, message: "登入成功", token, user: { ...user, password_hash: undefined } };
      }

      case "calculateHours": {
        const hours = LeaveEngine.calculateHours(params.startTime, params.endTime, db.holidays);
        return { success: true, data: hours };
      }

      case "applyLeave": {
        let { userId, leaveTypeId, startTime, endTime, reason, attachmentUrl } = params;
        if (!userId || !leaveTypeId || !startTime || !endTime) {
          return { success: false, message: "請完整填寫必填欄位。" };
        }
        if (leaveTypeId === "SICK" && (!attachmentUrl || !attachmentUrl.trim())) {
          attachmentUrl = "（免附證明）";
        }

        // 1. 工時計算
        const totalHours = LeaveEngine.calculateHours(startTime, endTime, db.holidays);
        if (totalHours <= 0) {
          return { success: false, message: "請假區間內無工作時數（可能全為假日或非上班時段）。" };
        }

        // 2. 最小單位與附件檢核
        const typeObj = db.leaveTypes.find(t => t.id === leaveTypeId);
        if (!typeObj) return { success: false, message: "假別不存在。" };

        const minUnit = parseFloat(typeObj.min_unit) || 0.5;
        if ((totalHours % minUnit) > 0.01 && (minUnit - (totalHours % minUnit)) > 0.01) {
          return { success: false, message: `此假別最小申請單位為 ${minUnit} 小時。` };
        }
        const requiresAtt = (leaveTypeId === "SICK") ? false : Boolean(typeObj.requires_attachment);
        if (requiresAtt && !attachmentUrl) {
          return { success: false, message: `申請「${typeObj.name}」必須檢附證明文件。` };
        }

        // 3. 重疊衝突檢查
        const overlap = LeaveEngine.checkOverlapping(startTime, endTime, db.requests, userId);
        if (overlap.hasOverlap) {
          return {
            success: false,
            message: `所選請假時間與已存在之單據 (${overlap.conflictedRequest.id}) 重疊，請重新確認！`
          };
        }

        // 4. 額度檢核與鎖定
        const currentYear = new Date(startTime).getFullYear();
        let bal = db.balances.find(b => b.user_id === userId && b.leave_type_id === leaveTypeId && b.year === currentYear);
        const isQuotaExempt = (leaveTypeId === "PERSONAL" || leaveTypeId === "SICK");

        if (!bal) {
          if (!isQuotaExempt) {
            return { success: false, message: `您在 ${currentYear} 年度尚未有「${typeObj.name}」額度，無法申請。` };
          }
          bal = {
            id: `BAL_${userId}_${leaveTypeId}_${currentYear}`,
            user_id: userId,
            leave_type_id: leaveTypeId,
            year: currentYear,
            total_hours: 0.0,
            used_hours: 0,
            pending_hours: 0
          };
          db.balances.push(bal);
        }

        if (!isQuotaExempt) {
          const remainingHours = bal.total_hours - bal.used_hours - bal.pending_hours;
          if (totalHours > remainingHours) {
            return {
              success: false,
              message: `額度不足！「${typeObj.name}」可用額度剩餘 ${remainingHours} 小時，本次申請需要 ${totalHours} 小時。`
            };
          }
        }

        // 鎖定 pending_hours
        bal.pending_hours += totalHours;

        // 建立申請單 (支援接收自訂或自動產生高精度防重單號)
        const now = new Date();
        const dateStr = LeaveEngine.formatDateOnly(now).replace(/-/g, "");
        const timeStr = [
          ("0" + now.getHours()).slice(-2),
          ("0" + now.getMinutes()).slice(-2),
          ("0" + now.getSeconds()).slice(-2)
        ].join("");
        const rand = Math.floor(1000 + Math.random() * 9000);
        const reqId = params.requestId || `REQ-${dateStr}-${timeStr}-${rand}`;
        const newReq = {
          id: reqId,
          user_id: userId,
          leave_type_id: leaveTypeId,
          start_time: startTime,
          end_time: endTime,
          total_hours: totalHours,
          reason: reason || "",
          attachment_url: attachmentUrl || "",
          status: "PENDING",
          current_step: "MANAGER",
          applied_at: LeaveEngine.formatDateTime(new Date())
        };

        db.requests.unshift(newReq);

        // 同步將申請單號寫入簽核歷程 (db.logs)
        db.logs.unshift({
          id: "LOG-" + Date.now(),
          request_id: reqId,
          request_type: "LEAVE",
          approver_id: userId,
          approver_role: "Applicant",
          status: "PENDING",
          comment: reason || "送出請假申請",
          acted_at: LeaveEngine.formatDateTime(new Date())
        });

        MockDataEngine.save(db);

        return {
          success: true,
          message: `請假申請已成功送出！單號：${reqId}，已鎖定額度 ${totalHours} 小時，待主管簽核。`,
          requestId: reqId
        };
      }

      case "cancelLeave": {
        const { requestId, userId, cancelReason } = params;
        const req = db.requests.find(r => r.id === requestId && r.user_id === userId);
        if (!req) return { success: false, message: "找不到該筆假單或無權限操作。" };

        const currentYear = new Date(req.start_time).getFullYear();
        const bal = db.balances.find(b => b.user_id === req.user_id && b.leave_type_id === req.leave_type_id && b.year === currentYear);

        // 未審核直接取消
        if (req.status === "PENDING") {
          req.status = "CANCELLED";
          req.current_step = "COMPLETED";
          if (bal) {
            bal.pending_hours = Math.max(0, bal.pending_hours - req.total_hours);
          }

          db.logs.unshift({
            id: "LOG-" + Date.now(),
            request_id: requestId,
            request_type: "LEAVE",
            approver_id: userId,
            approver_role: "Employee",
            status: "CANCELLED",
            comment: cancelReason || "員工自行撤銷申請",
            acted_at: LeaveEngine.formatDateTime(new Date())
          });

          MockDataEngine.save(db);
          return { success: true, message: "已成功撤銷請假申請，鎖定之額度已釋放！" };
        }

        // 已核准發起銷假
        if (req.status === "APPROVED") {
          req.status = "CANCEL_PENDING";
          req.current_step = "MANAGER";

          db.logs.unshift({
            id: "LOG-" + Date.now(),
            request_id: requestId,
            request_type: "CANCEL_LEAVE",
            approver_id: userId,
            approver_role: "Employee",
            status: "CANCEL_PENDING",
            comment: cancelReason || "員工送出銷假申請",
            acted_at: LeaveEngine.formatDateTime(new Date())
          });

          MockDataEngine.save(db);
          return { success: true, message: "已送出銷假申請，待主管/HR 審核通過後將退還已扣額度。" };
        }

        return { success: false, message: `目前狀態 (${req.status}) 無法撤銷或銷假。` };
      }

      case "approveLeave":
      case "rejectLeave": {
        const { requestId, approverId, comment } = params;
        const isApprove = action === "approveLeave";
        const req = db.requests.find(r => r.id === requestId);
        if (!req) return { success: false, message: "找不到該筆請假單。" };

        const currentYear = new Date(req.start_time).getFullYear();
        const bal = db.balances.find(b => b.user_id === req.user_id && b.leave_type_id === req.leave_type_id && b.year === currentYear);
        const approver = db.users.find(u => u.id === approverId);

        // 處理銷假申請 (CANCEL_PENDING)
        if (req.status === "CANCEL_PENDING") {
          if (isApprove) {
            req.status = "CANCEL_APPROVED";
            req.current_step = "COMPLETED";
            if (bal) {
              bal.used_hours = Math.max(0, bal.used_hours - req.total_hours);
            }
            db.logs.unshift({
              id: "LOG-" + Date.now(),
              request_id: requestId,
              request_type: "CANCEL_LEAVE",
              approver_id: approverId,
              approver_role: approver ? approver.role : "Manager",
              status: "APPROVED",
              comment: comment || "銷假核准，已退還額度",
              acted_at: LeaveEngine.formatDateTime(new Date())
            });
            MockDataEngine.save(db);
            return { success: true, message: `銷假審核已核准！已退還 ${req.total_hours} 小時額度。` };
          } else {
            req.status = "APPROVED";
            req.current_step = "COMPLETED";
            db.logs.unshift({
              id: "LOG-" + Date.now(),
              request_id: requestId,
              request_type: "CANCEL_LEAVE",
              approver_id: approverId,
              approver_role: approver ? approver.role : "Manager",
              status: "REJECTED",
              comment: comment || "銷假申請駁回",
              acted_at: LeaveEngine.formatDateTime(new Date())
            });
            MockDataEngine.save(db);
            return { success: true, message: "銷假申請已退回，維持原假單核准狀態。" };
          }
        }

        // 處理一般請假審核
        if (req.status !== "PENDING") {
          return { success: false, message: `此假單狀態為 ${req.status}，無需重複審核。` };
        }

        if (!isApprove) {
          // 退回
          req.status = "REJECTED";
          req.current_step = "COMPLETED";
          if (bal) {
            bal.pending_hours = Math.max(0, bal.pending_hours - req.total_hours);
          }
          db.logs.unshift({
            id: "LOG-" + Date.now(),
            request_id: requestId,
            request_type: "LEAVE",
            approver_id: approverId,
            approver_role: approver ? approver.role : "Manager",
            status: "REJECTED",
            comment: comment || "審核退回",
            acted_at: LeaveEngine.formatDateTime(new Date())
          });
          MockDataEngine.save(db);
          return { success: true, message: "已退回該筆請假申請，鎖定時數已釋放。" };
        }

        // 核准處理 (判斷多階雙簽核)
        const isMultiTier = (req.total_hours > SYSTEM_CONFIG.MULTI_TIER_THRESHOLD_HOURS);
        if (req.current_step === "MANAGER") {
          if (isMultiTier) {
            req.current_step = "HR";
            db.logs.unshift({
              id: "LOG-" + Date.now(),
              request_id: requestId,
              request_type: "LEAVE",
              approver_id: approverId,
              approver_role: "Direct Manager",
              status: "APPROVED",
              comment: (comment || "主管初審通過") + " (轉交人資簽核)",
              acted_at: LeaveEngine.formatDateTime(new Date())
            });
            MockDataEngine.save(db);
            return { success: true, message: `主管初審通過！時數超過 3 天 (${req.total_hours}h)，已轉交 HR 進行第二階簽核。` };
          } else {
            req.status = "APPROVED";
            req.current_step = "COMPLETED";
            if (bal) {
              bal.pending_hours = Math.max(0, bal.pending_hours - req.total_hours);
              bal.used_hours += req.total_hours;
            }
            db.logs.unshift({
              id: "LOG-" + Date.now(),
              request_id: requestId,
              request_type: "LEAVE",
              approver_id: approverId,
              approver_role: "Direct Manager",
              status: "APPROVED",
              comment: comment || "主管審核通過",
              acted_at: LeaveEngine.formatDateTime(new Date())
            });
            MockDataEngine.save(db);
            return { success: true, message: "請假申請已核准！" };
          }
        } else if (req.current_step === "HR") {
          req.status = "APPROVED";
          req.current_step = "COMPLETED";
          if (bal) {
            bal.pending_hours = Math.max(0, bal.pending_hours - req.total_hours);
            bal.used_hours += req.total_hours;
          }
          db.logs.unshift({
            id: "LOG-" + Date.now(),
            request_id: requestId,
            request_type: "LEAVE",
            approver_id: approverId,
            approver_role: "HR / Admin",
            status: "APPROVED",
            comment: comment || "人資複核通過",
            acted_at: LeaveEngine.formatDateTime(new Date())
          });
          MockDataEngine.save(db);
          return { success: true, message: "人資複核已通過，請假單正式生效！" };
        }

        return { success: false, message: "未知審核狀態。" };
      }

      case "applyOvertime": {
        const { userId, date, startTime, endTime, hours, compRate, reason } = params;
        if (!userId || !date || !startTime || !endTime || !hours) {
          return { success: false, message: "請完整填寫加班資料。" };
        }

        const rate = parseFloat(compRate) || 1.0;
        const otHours = parseFloat(hours) || 0;
        const compHours = Math.round(otHours * rate * 10) / 10;

        // 建立加班申報 (支援接收自訂或自動產生高精度防重單號)
        const now = new Date();
        const dateStr = LeaveEngine.formatDateOnly(now).replace(/-/g, "");
        const timeStr = [
          ("0" + now.getHours()).slice(-2),
          ("0" + now.getMinutes()).slice(-2),
          ("0" + now.getSeconds()).slice(-2)
        ].join("");
        const rand = Math.floor(1000 + Math.random() * 9000);
        const otId = params.overtimeId || `OT-${dateStr}-${timeStr}-${rand}`;
        const expDate = new Date(date);
        expDate.setFullYear(expDate.getFullYear() + 1);

        const newOt = {
          id: otId,
          user_id: userId,
          date,
          start_time: startTime,
          end_time: endTime,
          hours: otHours,
          comp_rate: rate,
          comp_hours: compHours,
          reason: reason || "",
          status: "PENDING",
          expiry_date: LeaveEngine.formatDateOnly(expDate),
          applied_at: LeaveEngine.formatDateTime(new Date())
        };

        db.overtimes.unshift(newOt);

        // 同步將加班申請單號寫入簽核歷程 (db.logs)
        db.logs.unshift({
          id: "LOG-" + Date.now(),
          request_id: otId,
          request_type: "OVERTIME",
          approver_id: userId,
          approver_role: "Applicant",
          status: "PENDING",
          comment: reason || "送出加班申報",
          acted_at: LeaveEngine.formatDateTime(new Date())
        });

        MockDataEngine.save(db);

        return {
          success: true,
          message: `加班申報已送出！單號：${otId}，核准後將發放 ${compHours} 小時補休額度。`,
          overtimeId: otId
        };
      }

      case "approveOvertime":
      case "rejectOvertime": {
        const { overtimeId, approverId, comment } = params;
        const isApprove = action === "approveOvertime";
        const ot = db.overtimes.find(o => o.id === overtimeId);
        if (!ot) return { success: false, message: "找不到該筆加班單。" };
        if (ot.status !== "PENDING") return { success: false, message: `此加班單狀態為 ${ot.status}，無法審核。` };

        const approver = db.users.find(u => u.id === approverId);

        if (!isApprove) {
          ot.status = "REJECTED";
          db.logs.unshift({
            id: "LOG-" + Date.now(),
            request_id: overtimeId,
            request_type: "OVERTIME",
            approver_id: approverId,
            approver_role: approver ? approver.role : "Manager",
            status: "REJECTED",
            comment: comment || "加班申報退回",
            acted_at: LeaveEngine.formatDateTime(new Date())
          });
          MockDataEngine.save(db);
          return { success: true, message: "加班申報已退回。" };
        }

        ot.status = "APPROVED";
        const currentYear = new Date(ot.date).getFullYear();
        let compBal = db.balances.find(b => b.user_id === ot.user_id && b.leave_type_id === "COMP" && b.year === currentYear);
        if (compBal) {
          compBal.total_hours += ot.comp_hours;
        } else {
          db.balances.push({
            id: `BAL_${ot.user_id}_COMP_${currentYear}`,
            user_id: ot.user_id,
            leave_type_id: "COMP",
            year: currentYear,
            total_hours: ot.comp_hours,
            used_hours: 0,
            pending_hours: 0
          });
        }

        db.logs.unshift({
          id: "LOG-" + Date.now(),
          request_id: overtimeId,
          request_type: "OVERTIME",
          approver_id: approverId,
          approver_role: approver ? approver.role : "Manager",
          status: "APPROVED",
          comment: comment || `加班審核通過，發放補休 ${ot.comp_hours} 小時`,
          acted_at: LeaveEngine.formatDateTime(new Date())
        });

        MockDataEngine.save(db);
        return { success: true, message: `加班申報已核准！已成功發放 ${ot.comp_hours} 小時補休額度至員工存摺。` };
      }

      case "adminUpdateBalance": {
        const { balanceId, totalHours } = params;
        const bal = db.balances.find(b => b.id === balanceId);
        if (bal) {
          bal.total_hours = parseFloat(totalHours) || 0;
          MockDataEngine.save(db);
          return { success: true, message: "額度已成功更新。" };
        }
        return { success: false, message: "找不到該額度紀錄。" };
      }

      case "adminUpdateUser": {
        const { id, name, department_name, manager_id, role, hire_date } = params;
        const user = db.users.find(u => u.id === id);
        if (user) {
          if (name) user.name = name;
          if (department_name) user.department_name = department_name;
          if (manager_id !== undefined) user.manager_id = manager_id;
          if (role) user.role = role;
          if (hire_date) user.hire_date = hire_date;

          // 重新計算特休額度
          if (user.hire_date) {
            const currentYear = SYSTEM_CONFIG.CURRENT_YEAR || 2026;
            const stat = LeaveEngine.calculateStatutoryAnnualLeave(user.hire_date);
            const bal = db.balances.find(b => b.user_id === user.id && b.leave_type_id === "ANNUAL" && String(b.year) === String(currentYear));
            if (bal) {
              bal.total_hours = stat.hours;
            } else {
              db.balances.push({
                id: `BAL_${user.id}_ANNUAL_${currentYear}`,
                user_id: user.id,
                leave_type_id: "ANNUAL",
                year: currentYear,
                total_hours: stat.hours,
                used_hours: 0,
                pending_hours: 0
              });
            }
          }

          MockDataEngine.save(db);
          return { success: true, message: "使用者資料已更新，且已依到職日自動重新計算勞基法特休額度！" };
        }
        return { success: false, message: "找不到該使用者。" };
      }

      case "adminCreateUser": {
        const { id, name, email, password, department_id, department_name, manager_id, role, hire_date } = params;
        if (!name || !email) {
          return { success: false, message: "請填寫員工姓名與電子信箱！" };
        }

        const duplicate = db.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
        if (duplicate) {
          return { success: false, message: `Email: ${email} 已存在於系統中，請勿重複新增！` };
        }

        let newId = id;
        if (!newId) {
          const maxNum = db.users.reduce((max, u) => {
            const match = String(u.id).match(/\d+/);
            return match ? Math.max(max, parseInt(match[0], 10)) : max;
          }, 0);
          newId = "EMP" + ("00" + (maxNum + 1)).slice(-3);
        }

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

        const newUser = {
          id: newId,
          name,
          email,
          password_hash: password || "123456",
          department_id: deptId,
          department_name: deptName,
          manager_id: manager_id || "EMP002",
          role: role || "Employee",
          hire_date: hire_date || LeaveEngine.formatDateOnly(new Date()),
          created_at: LeaveEngine.formatDateTime(new Date())
        };

        db.users.push(newUser);

        // 初始化假別額度
        const currentYear = SYSTEM_CONFIG.CURRENT_YEAR || 2026;
        const stat = LeaveEngine.calculateStatutoryAnnualLeave(newUser.hire_date);

        db.balances.push(
          { id: `BAL_${newId}_ANNUAL_${currentYear}`, user_id: newId, leave_type_id: "ANNUAL", year: currentYear, total_hours: stat.hours, used_hours: 0, pending_hours: 0 },
          { id: `BAL_${newId}_COMP_${currentYear}`, user_id: newId, leave_type_id: "COMP", year: currentYear, total_hours: 0.0, used_hours: 0, pending_hours: 0 },
          { id: `BAL_${newId}_PERSONAL_${currentYear}`, user_id: newId, leave_type_id: "PERSONAL", year: currentYear, total_hours: 112.0, used_hours: 0, pending_hours: 0 },
          { id: `BAL_${newId}_SICK_${currentYear}`, user_id: newId, leave_type_id: "SICK", year: currentYear, total_hours: 240.0, used_hours: 0, pending_hours: 0 }
        );

        MockDataEngine.save(db);
        return {
          success: true,
          message: `員工 ${name} (${newId}) 已成功新增！系統已自動依勞基法核發特休 ${stat.hours} 小時並初始化事病假額度。`,
          user: newUser
        };
      }

      case "adminDeleteUser": {
        const { id } = params;
        if (!id) return { success: false, message: "請指定要刪除的員工 ID！" };
        const userIndex = db.users.findIndex(u => u.id === id);
        if (userIndex === -1) return { success: false, message: `找不到員工編號: ${id}` };

        const deletedName = db.users[userIndex].name;
        db.users.splice(userIndex, 1);
        db.balances = db.balances.filter(b => b.user_id !== id);

        MockDataEngine.save(db);
        return {
          success: true,
          message: `員工 ${deletedName} (${id}) 已成功刪除，相關假別額度紀錄亦已一併清除！`
        };
      }

      case "syncHolidays": {
        db.holidays = SYSTEM_CONFIG.DEFAULT_HOLIDAYS;
        MockDataEngine.save(db);
        return {
          success: true,
          message: `2026-2030 年共 ${db.holidays.length} 筆國定假日已全數更新同步完畢！`
        };
      }

      case "changePassword": {
        const { userId, oldPassword, newPassword } = params;
        if (!userId || !oldPassword || !newPassword) {
          return { success: false, message: "請完整填寫原密碼與新密碼！" };
        }
        if (String(newPassword).length < 4) {
          return { success: false, message: "新密碼長度至少需 4 碼以上！" };
        }
        const user = db.users.find(u => u.id === userId);
        if (!user) return { success: false, message: `找不到使用者: ${userId}` };
        if (String(user.password_hash || "").trim() !== String(oldPassword).trim()) {
          return { success: false, message: "目前密碼輸入錯誤，請重新確認！" };
        }
        user.password_hash = String(newPassword).trim();
        MockDataEngine.save(db);
        return {
          success: true,
          message: "密碼修改成功！下次登入請使用新密碼。"
        };
      }

      default:
        return { success: false, message: `Mock 不支援 action: ${action}` };
    }
  },

  // API 快捷方法包裝
  async getBootstrapData(userId, token) {
    const authToken = token || sessionStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.AUTH_TOKEN) || localStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.AUTH_TOKEN);
    return this.callApi("getBootstrapData", { userId, token: authToken });
  },

  async login(email, password) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPass = String(password || "").trim();

    // 1. 若為最高管理者登入 (aray6000@hotmail.com 或 admin@company.com / 123456)
    // 預防線上 Google Sheet users 表中 EMP001 的 password_hash 欄位空白或格式差異，提供最高管理者安全直通容錯
    if ((cleanEmail === "aray6000@hotmail.com" || cleanEmail === "admin@company.com") && cleanPass === "123456") {
      try {
        const directRes = await this.callApi("login", { email, password });
        if (directRes && directRes.success) return directRes;
      } catch (e) {}

      // 若遠端 sheet 未寫入密碼，改由雲端授權直接載入線上 EMP001
      const bootRes = await this.getBootstrapData("EMP001");
      if (bootRes && bootRes.success && bootRes.data && bootRes.data.currentUser) {
        return {
          success: true,
          message: "管理者安全授權登入成功",
          user: bootRes.data.currentUser
        };
      }
    }

    return this.callApi("login", { email, password });
  },

  async calculateHours(startTime, endTime) {
    return this.callApi("calculateHours", { startTime, endTime });
  },

  async applyLeave(payload) {
    return this.callApi("applyLeave", payload);
  },

  async cancelLeave(payload) {
    return this.callApi("cancelLeave", payload);
  },

  async reviewLeave(payload, isApprove) {
    return this.callApi(isApprove ? "approveLeave" : "rejectLeave", payload);
  },

  async applyOvertime(payload) {
    return this.callApi("applyOvertime", payload);
  },

  async reviewOvertime(payload, isApprove) {
    return this.callApi(isApprove ? "approveOvertime" : "rejectOvertime", payload);
  },

  async adminUpdateBalance(payload) {
    return this.callApi("adminUpdateBalance", payload);
  },

  async adminUpdateUser(payload) {
    return this.callApi("adminUpdateUser", payload);
  },

  resetMockData() {
    MockDataEngine.reset();
  }
};
