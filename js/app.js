/**
 * 智慧請假與補休管理系統 - 主應用程式核心控制器 (Main Application Controller)
 */
const App = {
  state: {
    currentUser: null,
    users: [],
    leaveTypes: [],
    balances: [],
    requests: [],
    overtimes: [],
    logs: [],
    holidays: [],
    config: {},
    currentView: "dashboard",
    approvalTab: "leaves",
    calendarYear: 2026,
    calendarMonth: 8, // 0-indexed, 8 代表 9月
    activeActionItem: null, // 當前正在審核或撤銷的單據
    isSubmitting: false // 防止連點全域狀態鎖
  },

  /**
   * 顯示全域讀取載入畫面 (轉圈圈)
   */
  showLoading(mainText = "系統資料讀取中...", subText = "正在同步差勤資料庫，請稍候") {
    const loadingScreen = document.getElementById("globalLoadingScreen");
    if (!loadingScreen) return;
    const mainEl = document.getElementById("loadingMainText");
    const subEl = document.getElementById("loadingSubText");
    if (mainEl) mainEl.textContent = mainText;
    if (subEl) subEl.textContent = subText;
    loadingScreen.classList.remove("hidden");
  },

  /**
   * 隱藏全域讀取載入畫面
   */
  hideLoading() {
    const loadingScreen = document.getElementById("globalLoadingScreen");
    if (loadingScreen) {
      loadingScreen.classList.add("hidden");
    }
  },

  /**
   * 初始化系統
   */
  async init() {
    this.setupEventListeners();
    // 自動檢測並清理各裝置 LocalStorage 殘留的過期舊 GAS 網址 (確保全裝置連線一致)
    const storedUrl = localStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.GAS_URL);
    const isOverride = localStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.CUSTOM_GAS_OVERRIDE) === "true";
    if (storedUrl && !isOverride && storedUrl !== SYSTEM_CONFIG.DEFAULT_GAS_URL) {
      console.log("偵測到本機殘留舊版資料庫網址，自動校正回全域官方 DEFAULT_GAS_URL！");
      localStorage.removeItem(SYSTEM_CONFIG.STORAGE_KEYS.GAS_URL);
    }
    await this.checkAuth();
  },

  /**
   * 檢查登入狀態並於背景完成資料庫同步
   */
  async checkAuth() {
    const isLoggedIn = localStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.SESSION_LOGGED_IN) === "true";
    const loginOverlay = document.getElementById("loginScreen");

    if (isLoggedIn) {
      if (loginOverlay) loginOverlay.classList.add("hidden");

      // SWR 極速秒開：若本機已有快取，0.0 秒直接渲染進主畫面，完全不需等待全螢幕轉圈！
      const cached = localStorage.getItem("LEAVE_SYS_BOOTSTRAP_CACHE_V2");
      if (cached) {
        try {
          const cachedData = JSON.parse(cached);
          if (cachedData && cachedData.currentUser) {
            this.applyBootstrapData(cachedData);
            this.renderHeader();
            this.navigate(this.state.currentView || "dashboard");
            this.hideLoading();

            // 背景無感靜默向雲端 Google Sheet 取得最新資料
            this.loadData(null, true).then(() => {
              this.renderHeader();
              this.renderCurrentView();
            }).catch(e => console.warn("背景同步暫態延遲:", e));
            return;
          }
        } catch (e) {
          console.warn("解析本機快取失敗，改採標準雲端載入:", e);
        }
      }

      // 初次登入或無快取時，顯示載入遮罩
      this.showLoading("系統身分驗證中...", "正在載入個人差勤額度與差勤紀錄資料庫...");
      try {
        await this.loadData();
        this.renderHeader();
        this.navigate(this.state.currentView || "dashboard");
      } catch (err) {
        console.error("載入資料失敗:", err);
        this.showToast("資料讀取異常，請重新整理或重新登入。", "error");
      } finally {
        setTimeout(() => {
          this.hideLoading();
        }, 150);
      }
    } else {
      this.hideLoading();
      if (loginOverlay) loginOverlay.classList.remove("hidden");
    }
  },

  /**
   * 執行登入程序
   */
  async handleLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const errorBanner = document.getElementById("loginErrorBanner");
    const submitBtn = document.getElementById("btnLoginSubmit");

    if (errorBanner) errorBanner.style.display = "none";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 驗證登入中...`;
    }

    try {
      const res = await ApiService.login(email, password);

      if (res.success && res.user) {
        localStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.SESSION_LOGGED_IN, "true");
        localStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.ACTIVE_USER_ID, res.user.id);
        if (res.token) {
          sessionStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.AUTH_TOKEN, res.token);
          localStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.AUTH_TOKEN, res.token);
        }

        const loginOverlay = document.getElementById("loginScreen");
        if (loginOverlay) loginOverlay.classList.add("hidden");

        this.showLoading(`歡迎回來，${res.user.name}`, "正在同步個人最新差勤額度與紀錄...");
        await this.loadData(res.user.id);
        this.renderHeader();
        this.navigate("dashboard");
        this.hideLoading();
        this.showToast(`歡迎回來，${res.user.name} (${res.user.department_name} ${res.user.role})！`, "success");
      } else {
        if (errorBanner) {
          errorBanner.style.display = "flex";
          document.getElementById("loginErrorMsg").textContent = res.message || "電子信箱或密碼錯誤，請重新確認。";
        }
        this.showToast(res.message || "登入失敗", "error");
      }
    } catch (err) {
      if (errorBanner) {
        errorBanner.style.display = "flex";
        document.getElementById("loginErrorMsg").textContent = "連線異常：" + err.message;
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> 登入系統`;
      }
    }
  },

  /**
   * 快速體驗身分切換登入 (Demo Quick Login)
   */
  async quickLogin(email, password) {
    document.getElementById("loginEmail").value = email;
    document.getElementById("loginPassword").value = password;
    await this.handleLogin();
  },

  /**
   * 一鍵以最高管理者 (李泰叡 / Admin) 直通登入
   */
  async directLoginAdmin() {
    this.showLoading("最高管理者身分授權中...", "正在載入個人差勤額度與雲端資料庫...");
    try {
      localStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.SESSION_LOGGED_IN, "true");
      localStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.ACTIVE_USER_ID, "EMP001");
      const loginOverlay = document.getElementById("loginScreen");
      if (loginOverlay) loginOverlay.classList.add("hidden");

      await this.loadData("EMP001");
      this.renderHeader();
      this.navigate("dashboard");
      this.showToast(`歡迎回來，${this.state.currentUser ? this.state.currentUser.name : "李泰叡"} (系統最高管理者 Admin)！`, "success");
    } catch (err) {
      console.error("管理者直通登入失敗:", err);
      this.showToast("登入授權失敗：" + err.message, "error");
    } finally {
      this.hideLoading();
    }
  },

  /**
   * 快速填入登入帳號密碼
   */
  quickFillLogin(email, password) {
    const emailInput = document.getElementById("loginEmail");
    const passInput = document.getElementById("loginPassword");
    if (emailInput) emailInput.value = email;
    if (passInput) passInput.value = password;
    this.showToast(`已填入帳號 ${email}，點擊「登入系統」即可登入！`, "info");
  },

  /**
   * 切換密碼明文/隱藏
   */
  togglePasswordVisibility(inputId, btnElem) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPassword = (input.type === "password");
    input.type = isPassword ? "text" : "password";

    const icon = btnElem.querySelector("i");
    if (icon) {
      icon.className = isPassword ? "fa-solid fa-eye" : "fa-solid fa-eye-slash";
    }
  },

  /**
   * 登出系統
   */
  handleLogout() {
    localStorage.removeItem(SYSTEM_CONFIG.STORAGE_KEYS.SESSION_LOGGED_IN);
    localStorage.removeItem(SYSTEM_CONFIG.STORAGE_KEYS.ACTIVE_USER_ID);
    sessionStorage.removeItem(SYSTEM_CONFIG.STORAGE_KEYS.AUTH_TOKEN);
    localStorage.removeItem(SYSTEM_CONFIG.STORAGE_KEYS.AUTH_TOKEN);
    localStorage.removeItem("LEAVE_SYS_BOOTSTRAP_CACHE_V2");
    this.state.currentUser = null;

    // 清除 Header 與畫面上的個人資訊
    const userAvatar = document.getElementById("userAvatar");
    const userName = document.getElementById("userName");
    const userRoleTag = document.getElementById("userRoleTag");
    const heroUserName = document.getElementById("heroUserName");
    if (userAvatar) userAvatar.textContent = "--";
    if (userName) userName.textContent = "請登入";
    if (userRoleTag) userRoleTag.textContent = "--";
    if (heroUserName) heroUserName.textContent = "--";

    const loginOverlay = document.getElementById("loginScreen");
    if (loginOverlay) {
      loginOverlay.classList.remove("hidden");
    }
    const errorBanner = document.getElementById("loginErrorBanner");
    if (errorBanner) errorBanner.style.display = "none";
    this.showToast("您已安全登出系統。", "info");
  },

  /**
   * 套用啟動資料狀態 (供 SWR 快取即時套用)
   */
  applyBootstrapData(data) {
    if (!data) return;
    if (data.currentUser) this.state.currentUser = data.currentUser;
    if (data.users) this.state.users = data.users;
    if (data.leaveTypes) this.state.leaveTypes = data.leaveTypes;
    if (data.requests) this.state.requests = data.requests;
    if (data.overtimes) this.state.overtimes = data.overtimes;
    if (data.balances) this.state.balances = data.balances;
    if (data.logs) this.state.logs = data.logs;
    if (data.holidays) this.state.holidays = data.holidays;
    if (data.config) this.state.config = data.config;
    if (data.currentUser && data.currentUser.id) {
      localStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.ACTIVE_USER_ID, data.currentUser.id);
    }
  },

  /**
   * 載入資料 (從 API 或 Local Mock，支援 SWR 背景無感同步)
   */
  async loadData(userId = null, isSilent = false) {
    const activeId = userId || localStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.ACTIVE_USER_ID) || "EMP001";
    const token = sessionStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.AUTH_TOKEN) || localStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.AUTH_TOKEN);
    const res = await ApiService.getBootstrapData(activeId, token);
    
    if (res && res.isOfflineFallback && !isSilent) {
      const reasonText = res.offlineReason ? ` (${res.offlineReason})` : "";
      this.showToast(`⚠️ 雲端資料庫連線失敗${reasonText}，目前顯示本機暫存！`, "warning");
    }
    
    if (res.success && res.data) {
      this.state.currentUser = res.data.currentUser;
      this.state.users = res.data.users;
      this.state.leaveTypes = res.data.leaveTypes;
      // 單號防重保護：若歷史資料存有碰撞重複單號，動態加上後綴標示區分 (如 REQ-20260904-939-2)
      const seenReqIds = {};
      this.state.requests = (res.data.requests || []).map(r => {
        if (!r.id) return r;
        if (!seenReqIds[r.id]) {
          seenReqIds[r.id] = 1;
          return r;
        } else {
          seenReqIds[r.id]++;
          return { ...r, id: `${r.id}-${seenReqIds[r.id]}`, _originalId: r.id };
        }
      });
      const seenOtIds = {};
      this.state.overtimes = (res.data.overtimes || []).map(o => {
        if (!o.id) return o;
        if (!seenOtIds[o.id]) {
          seenOtIds[o.id] = 1;
          return o;
        } else {
          seenOtIds[o.id]++;
          return { ...o, id: `${o.id}-${seenOtIds[o.id]}`, _originalId: o.id };
        }
      });
      // 假別額度載入與中英文/類型正規化相容 (leave_balances)
      this.state.balances = (res.data.balances || []).map(b => {
        return {
          ...b,
          id: b.id || b["額度編號"] || b["編號"] || "",
          user_id: String(b.user_id || b["員工編號"] || b["工號"] || b["申請人"] || "").trim(),
          leave_type_id: String(b.leave_type_id || b["假別代碼"] || b["假別"] || b["假別名稱"] || "").trim(),
          year: parseInt(b.year || b["年度"] || b["年份"] || 0, 10),
          total_hours: parseFloat(b.total_hours || b["總額度"] || b["總時數"] || b["額度"] || 0) || 0,
          used_hours: parseFloat(b.used_hours || b["已休時數"] || b["已用時數"] || b["已使用"] || b["已休"] || 0) || 0,
          pending_hours: parseFloat(b.pending_hours || b["審核中時數"] || b["鎖定時數"] || b["審核鎖定"] || b["待審"] || 0) || 0
        };
      });
      this.state.logs = res.data.logs;
      this.state.holidays = res.data.holidays;
      this.state.config = res.data.config;
      
      localStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.ACTIVE_USER_ID, this.state.currentUser.id);

      // 儲存至本機 SWR 快取，下次開起直接 0.0 秒呈現
      try {
        localStorage.setItem("LEAVE_SYS_BOOTSTRAP_CACHE_V2", JSON.stringify({
          currentUser: this.state.currentUser,
          users: this.state.users,
          leaveTypes: this.state.leaveTypes,
          requests: this.state.requests,
          overtimes: this.state.overtimes,
          balances: this.state.balances,
          logs: this.state.logs,
          holidays: this.state.holidays,
          config: this.state.config
        }));
      } catch (e) {}
    }
  },

  /**
   * 事件監聽綁定
   */
  setupEventListeners() {
    // 側邊欄與底部導航點擊切換
    document.querySelectorAll(".nav-item, .mobile-nav-item").forEach(item => {
      item.addEventListener("click", () => {
        const view = item.getAttribute("data-view");
        if (view) this.navigate(view);
      });
    });

    // 行動端選單展開
    const menuBtn = document.getElementById("mobileMenuBtn");
    const sidebar = document.getElementById("appSidebar");
    if (menuBtn && sidebar) {
      menuBtn.addEventListener("click", () => {
        sidebar.classList.toggle("open");
      });
    }

    // 全域防止按鈕連點 (Capture 階段精準防呆 Debounce 650ms)
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button, .btn, input[type='submit'], .preset-chip, .tab-btn");
      if (!btn) return;

      // 若目前系統處於資料送出中，直接阻擋任何操作
      if (this.state && this.state.isSubmitting) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return false;
      }

      const now = Date.now();
      const lastClick = btn.dataset.lastClick ? parseInt(btn.dataset.lastClick, 10) : 0;
      if (now - lastClick < 650) {
        e.preventDefault();
        e.stopImmediatePropagation();
        console.warn("【防連點機制】偵測到短時間內重複點擊，已自動安全攔截！");
        return false;
      }
      btn.dataset.lastClick = String(now);
    }, true);
  },

  /**
   * 視圖切換
   */
  /**
   * 視圖切換 (嚴格角色職責分離：Admin 專屬後端設定、HR 專屬人事差勤)
   */
  navigate(viewName) {
    const user = this.state.currentUser;
    const isHrOrAdmin = LeaveEngine.isUserAdmin(user);
    const isSysAdmin = LeaveEngine.isSystemAdmin(user);

    // 兼顧舊版 'settings' 請求轉發
    if (viewName === "settings") {
      viewName = isSysAdmin ? "system-settings" : "hr-management";
    }

    // 嚴格權限防護：資料庫後端串接設定僅限最高管理者 (Admin) 存取
    if (viewName === "system-settings" && !isSysAdmin) {
      this.showToast("權限不足：資料庫後端串接設定僅限最高管理者 (Admin) 配置！", "error");
      viewName = "dashboard";
    }

    // 嚴格權限防護：人事差勤維護專區僅限 HR 與最高管理者 (Admin) 存取
    if (viewName === "hr-management" && !isHrOrAdmin) {
      this.showToast("權限不足：人事差勤維護專區僅限人事 (HR) 與管理者存取！", "error");
      viewName = "dashboard";
    }

    this.state.currentView = viewName;

    // 隱藏所有視圖，顯示目標視圖
    document.querySelectorAll(".view-section").forEach(sec => sec.classList.remove("active"));
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) targetView.classList.add("active");

    // 更新導航選單高亮
    document.querySelectorAll(".nav-item, .mobile-nav-item").forEach(item => {
      if (item.getAttribute("data-view") === viewName) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });

    // 關閉行動端側欄
    const sidebar = document.getElementById("appSidebar");
    if (sidebar) sidebar.classList.remove("open");

    // 更新 Header 標題與渲染特定視圖
    const titles = {
      "dashboard": { title: "差勤儀表板", sub: "每日工時 08:30 - 18:00 (午休 12:00 - 13:30 扣 1.5h)" },
      "apply-leave": { title: "線上請假申請單", sub: "自動計算工時、避開假日與午休、防呆檢核與額度鎖定" },
      "overtime": { title: "加班申報與補休存摺", sub: "申報加班工時，核准後自動轉換補休額度入帳" },
      "history": { title: "個人差勤歷史紀錄", sub: "依假別、時間區間自訂多條件查詢，並支援一鍵匯出 CSV / Excel 報表" },
      "approvals": { title: "審核簽核中心", sub: "支援主管與人資進行請假、銷假與加班換補休之審核" },
      "calendar": { title: "團隊差勤行事曆", sub: "檢視部門差勤分佈與 2026 國定假日排程" },
      "hr-management": { title: "人事差勤與特休額度管理", sub: "全員到職日維護、勞基法歷年制特休額度核算與法定特休同步" },
      "system-settings": { title: "系統後端與資料庫串接設定", sub: "管理 Google Apps Script Web App 雲端連線與資料庫路徑" },
      "settings": { title: "系統後端與資料庫串接設定", sub: "管理 Google Apps Script 雲端同步與資料庫路徑" }
    };

    if (titles[viewName]) {
      document.getElementById("pageTitle").textContent = titles[viewName].title;
      document.getElementById("pageSubtitle").textContent = titles[viewName].sub;
    }

    // 依視圖觸發渲染
    switch (viewName) {
      case "dashboard":
        this.renderDashboard();
        break;
      case "apply-leave":
        this.renderLeaveForm();
        break;
      case "overtime":
        this.renderOvertimeView();
        break;
      case "history":
        this.renderHistory();
        break;
      case "approvals":
        this.renderApprovalsView();
        break;
      case "calendar":
        this.renderCalendar();
        break;
      case "hr-management":
        this.renderHrManagement();
        break;
      case "system-settings":
        this.renderSystemSettings();
        break;
      case "settings":
        if (isSysAdmin) this.renderSystemSettings();
        else this.renderHrManagement();
        break;
    }

    this.updatePendingBadges();
  },

  /**
   * 快速切換測試身分
   */
  async switchUser(userId) {
    await this.loadData(userId);
    this.renderHeader();
    this.navigate(this.state.currentView);
    this.showToast(`已切換為：${this.state.currentUser.name} (${this.state.currentUser.role})`, "info");
  },

  /**
   * 渲染頂部 Header 使用者狀態
   */
  renderHeader() {
    const user = this.state.currentUser;
    if (!user) return;

    document.getElementById("userName").textContent = user.name;
    document.getElementById("heroUserName").textContent = user.name;
    document.getElementById("userRoleTag").textContent = `${user.department_name} · ${user.role}`;
    document.getElementById("userAvatar").textContent = user.name.charAt(0);

    const selector = document.getElementById("roleSelector");
    if (selector) selector.value = user.id;

    // Google Sheet 連線狀態指示
    this.updateConnectionIndicator();
  },

  /**
   * Google Sheet 連線狀態真實健康指示器 (消滅假綠燈，反映真實連線健康)
   */
  updateConnectionIndicator() {
    const dot = document.getElementById("sheetStatusDot");
    const text = document.getElementById("sheetStatusText");
    if (!dot || !text) return;

    const conn = ApiService.getConnectionStatus();
    dot.className = "status-dot";

    if (!conn.isRemote) {
      dot.classList.add("offline");
      text.textContent = "本機展示資料庫";
      dot.parentElement.title = "目前處於本機模擬資料庫模式，資料僅儲存於當前瀏覽器";
      return;
    }

    switch (conn.status) {
      case "online":
        if (conn.apiVersion && conn.apiVersion !== "legacy") {
          text.textContent = "Google Sheet 已連線";
          const timeStr = conn.lastSyncTime ? LeaveEngine.formatDateTime(conn.lastSyncTime) : "";
          dot.parentElement.title = `雲端連線正常 (最新後端 ${conn.apiVersion})！\n最後同步時間：${timeStr}\n端點：${conn.url}`;
        } else {
          text.textContent = "Google Sheet (舊版後端)";
          const timeStr = conn.lastSyncTime ? LeaveEngine.formatDateTime(conn.lastSyncTime) : "";
          dot.parentElement.title = `⚠️ 已連線，但雲端 GAS 目前執行舊版！\n請至 Google Apps Script 建立新版本部署即可生效極速模式。\n最後同步：${timeStr}`;
        }
        break;
      case "error":
        dot.classList.add("error");
        text.textContent = "Google Sheet 連線異常";
        dot.parentElement.title = `連線異常：${conn.lastError || "伺服器無回應"}\n請點擊檢查網路或資料庫設定`;
        break;
      case "connecting":
        dot.classList.add("loading");
        text.textContent = "雲端同步中...";
        dot.parentElement.title = "正在連線 Google Apps Script 後端伺服器...";
        break;
      default:
        dot.classList.add("loading");
        text.textContent = "資料庫連線中...";
        dot.parentElement.title = `準備連線雲端：${conn.url}`;
    }
  },

  /**
   * 1. 渲染儀表板 (Dashboard)
   */
  renderDashboard() {
    const user = this.state.currentUser;
    const year = SYSTEM_CONFIG.CURRENT_YEAR;
    
    // 渲染勞基法【歷年制】特休標準提示條 (每年 1/1 重新起算)
    const hireDate = user.hire_date ? LeaveEngine.formatDateOnly(user.hire_date) : "2024-03-01";
    const stat = LeaveEngine.calculateStatutoryAnnualLeave(hireDate, year);
    const hireEl = document.getElementById("dashboardHireDate");
    const statDaysEl = document.getElementById("dashboardStatutoryDays");
    const badgeEl = document.getElementById("seniorityBadge");
    const descEl = document.getElementById("statutoryDescText");

    if (hireEl) hireEl.textContent = hireDate;
    if (badgeEl) badgeEl.textContent = `年資：${stat.seniorityText || "計算中"}`;
    if (descEl) descEl.textContent = `【${year} 歷年制核算】${stat.description} · 年度未休畢特休將於結算時轉發薪資抵銷。`;

    // 假別額度卡片渲染 (相容 user_id / 年度型態與中英文假別代碼)
    const userBalances = this.state.balances.filter(b => 
      String(b.user_id || "").trim().toUpperCase() === String(user.id || "").trim().toUpperCase() && 
      parseInt(b.year, 10) === parseInt(year, 10)
    );
    const balanceGrid = document.getElementById("balanceCardsGrid");
    balanceGrid.innerHTML = "";

    // 同步更新上方橫幅特休法定時數 (若 leave_balances 有實際同步額度則優先對應)
    const annualBal = userBalances.find(b => {
      const bType = String(b.leave_type_id || "").trim().toUpperCase();
      return bType === "ANNUAL" || bType === "特休" || bType === "特休假";
    });
    if (statDaysEl) {
      if (annualBal && annualBal.total_hours > 0) {
        statDaysEl.textContent = `${(annualBal.total_hours / 8).toFixed(1).replace(/\.0$/, "")} 天 (${annualBal.total_hours}h)`;
      } else {
        statDaysEl.textContent = `${stat.days} 天 (${stat.hours}h)`;
      }
    }

    const priorityTypes = ["ANNUAL", "COMP", "PERSONAL", "SICK"];
    priorityTypes.forEach(typeId => {
      const typeDef = SYSTEM_CONFIG.LEAVE_TYPES.find(t => t.id === typeId) || { name: typeId, color: "#4f46e5" };
      let bal = userBalances.find(b => {
        const bType = String(b.leave_type_id || "").trim().toUpperCase();
        return bType === typeId || bType === String(typeDef.name).trim().toUpperCase() ||
          (typeId === "ANNUAL" && (bType === "特休" || bType === "特休假")) ||
          (typeId === "COMP" && (bType === "補休" || bType === "補休假")) ||
          (typeId === "PERSONAL" && (bType === "事假")) ||
          (typeId === "SICK" && (bType === "病假"));
      });
      if (!bal) {
        bal = { total_hours: 0, used_hours: 0, pending_hours: 0 };
      }

      const total = Number(bal.total_hours) || 0;
      const used = Number(bal.used_hours) || 0;
      const pending = Number(bal.pending_hours) || 0;
      // 若 leave_balances 有設定總額度 (例如事假 112h, 病假 240h)，如實對應呈現額度與剩餘；若總額度為 0 則顯示無限制
      const isExempt = (total === 0 && (typeId === "PERSONAL" || typeId === "SICK"));
      const remaining = isExempt ? "不限" : Math.max(0, total - used - pending);
      const usedPercent = (!isExempt && total > 0) ? Math.min(100, Math.round(((used + pending) / total) * 100)) : (total === 0 ? 0 : 100);
      const strokeDash = isExempt ? "100, 100" : `${usedPercent}, 100`;

      const card = document.createElement("div");
      card.className = "balance-card";
      card.innerHTML = `
        <div class="balance-card-header">
          <span class="balance-card-title">
            <span class="type-indicator-pill" style="background-color: ${typeDef.color};"></span>
            ${typeDef.name}
          </span>
          <span class="badge ${typeDef.badgeClass || 'badge-blue'}">${(typeDef.id === 'SICK' || typeDef.isPaid === 'HALF' || typeDef.payRate === 0.5) ? '支半薪' : (typeDef.isPaid ? '有薪假' : '不支薪')}</span>
        </div>
        <div class="balance-ring-wrap">
          <div class="balance-nums">
            <div>
              <span class="balance-rem-big" style="${isExempt ? 'font-size: 1.8rem;' : ''}">${remaining}</span>
              ${!isExempt ? '<span class="balance-unit">小時</span>' : ''}
            </div>
            <span class="balance-rem-label">${isExempt ? '依需求申請 (無上限)' : '剩餘可用額度'}</span>
          </div>
          <svg viewBox="0 0 36 36" class="circular-chart" style="color: ${typeDef.color};">
            <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path class="circle" stroke="${typeDef.color}" stroke-dasharray="${strokeDash}" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          </svg>
        </div>
        <div class="balance-card-breakdown">
          <div class="breakdown-item">${isExempt ? '額度限制: <strong>無限制</strong>' : `總額度: <strong>${total}</strong>h`}</div>
          <div class="breakdown-item">已使用: <strong>${used}</strong>h</div>
          <div class="breakdown-item" style="color: #b45309;">審核鎖定: <strong>${pending}</strong>h</div>
        </div>
      `;
      balanceGrid.appendChild(card);
    });

    // 渲染我的差勤請假紀錄表
    const myRequests = this.state.requests.filter(r => r.user_id === user.id);
    const tableBody = document.getElementById("myRequestsTableBody");
    tableBody.innerHTML = "";

    if (myRequests.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">尚無任何差勤申請紀錄</td></tr>`;
    } else {
      myRequests.forEach(req => {
        const typeDef = SYSTEM_CONFIG.LEAVE_TYPES.find(t => t.id === req.leave_type_id) || { name: req.leave_type_id };
        const statusBadge = this.getStatusBadgeHtml(req.status, req.current_step);

        let actionBtn = "";
        if (req.status === "PENDING") {
          actionBtn = `<button class="btn btn-sm btn-secondary" style="color: var(--danger);" onclick="App.handleCancelClick('${req.id}', 'PENDING')">
            <i class="fa-solid fa-xmark"></i> 撤銷
          </button>`;
        } else if (req.status === "APPROVED") {
          actionBtn = `<button class="btn btn-sm btn-secondary" style="color: var(--purple);" onclick="App.handleCancelClick('${req.id}', 'APPROVED')">
            <i class="fa-solid fa-arrow-rotate-left"></i> 銷假
          </button>`;
        } else {
          actionBtn = `<span style="font-size: 0.8rem; color: var(--text-muted);">-</span>`;
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong style="color: var(--primary); font-family: 'JetBrains Mono';">${req.id}</strong></td>
          <td><span class="badge ${typeDef.badgeClass || 'badge-blue'}">${typeDef.name}</span></td>
          <td>
            <div style="font-weight: 500;">${req.start_time}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">至 ${req.end_time}</div>
          </td>
          <td><strong style="color: var(--text-main);">${req.total_hours}</strong> 小時</td>
          <td>${statusBadge}</td>
          <td>${actionBtn}</td>
        `;
        tableBody.appendChild(tr);
      });
    }

    // 渲染補休存摺摘要
    const compBal = userBalances.find(b => {
      const bType = String(b.leave_type_id || "").trim().toUpperCase();
      return bType === "COMP" || bType === "補休" || bType === "補休假";
    }) || { total_hours: 0, used_hours: 0, pending_hours: 0 };
    const compRemaining = Math.max(0, compBal.total_hours - compBal.used_hours - compBal.pending_hours);
    const compSummaryBox = document.getElementById("compWalletSummaryBox");
    compSummaryBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span style="color: var(--text-muted);">目前可用補休時數：</span>
        <strong style="font-size: 1.35rem; color: var(--success); font-family: 'JetBrains Mono';">${compRemaining} 小時</strong>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.8rem; background: #fafafa; padding: 10px; border-radius: var(--radius-sm);">
        <div>累積取得：<strong>${compBal.total_hours}</strong> h</div>
        <div>已請休：<strong>${compBal.used_hours}</strong> h</div>
      </div>
    `;

    // 檢查主管待審核警示
    this.checkManagerAlert();
  },

  /**
   * 2. 渲染請假表單 (Leave Application Form)
   */
  renderLeaveForm() {
    const leaveTypeSelect = document.getElementById("formLeaveType");
    leaveTypeSelect.innerHTML = "";

    this.state.leaveTypes.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.name} (最小單位: ${t.min_unit}h)`;
      leaveTypeSelect.appendChild(opt);
    });

    // 設定預設時間 (今日 08:30 ~ 今日 18:00)
    const today = new Date();
    const todayStr = LeaveEngine.formatDateOnly(today);
    document.getElementById("formStartTime").value = `${todayStr}T08:30`;
    document.getElementById("formEndTime").value = `${todayStr}T18:00`;

    this.onFormChange();
  },

  /**
   * 表單欄位變更時觸發即時試算與檢核
   */
  onFormChange() {
    this.calcLiveHours();
  },

  /**
   * 即時工時與額度扣抵試算
   */
  calcLiveHours() {
    const user = this.state.currentUser;
    const leaveTypeId = document.getElementById("formLeaveType").value;
    const startTime = document.getElementById("formStartTime").value.replace("T", " ");
    const endTime = document.getElementById("formEndTime").value.replace("T", " ");

    if (!user) return;

    const typeDef = SYSTEM_CONFIG.LEAVE_TYPES.find(t => t.id === leaveTypeId);
    if (typeDef) {
      document.getElementById("formLeaveTypeDesc").textContent = typeDef.description;
      const attReq = document.getElementById("attachmentReqBadge");
      const attInput = document.getElementById("formAttachment");
      const isReq = (leaveTypeId === "SICK") ? false : Boolean(typeDef.requiresAttachment);
      if (isReq) {
        if (attReq) attReq.style.display = "inline";
        if (attInput) attInput.required = true;
      } else {
        if (attReq) attReq.style.display = "none";
        if (attInput) attInput.required = false;
      }
    }

    // 計算可用餘額
    const year = new Date(startTime || new Date()).getFullYear();
    const bal = this.state.balances.find(b => 
      String(b.user_id || "").trim().toUpperCase() === String(user.id || "").trim().toUpperCase() && 
      (b.leave_type_id === leaveTypeId || (typeDef && b.leave_type_id === typeDef.name) ||
        (leaveTypeId === "ANNUAL" && (b.leave_type_id === "特休" || b.leave_type_id === "特休假")) ||
        (leaveTypeId === "COMP" && (b.leave_type_id === "補休" || b.leave_type_id === "補休假")) ||
        (leaveTypeId === "PERSONAL" && (b.leave_type_id === "事假")) ||
        (leaveTypeId === "SICK" && (b.leave_type_id === "病假"))) && 
      parseInt(b.year, 10) === parseInt(year, 10)
    );
    const total = bal ? Number(bal.total_hours) || 0 : 0;
    const used = bal ? Number(bal.used_hours) || 0 : 0;
    const pending = bal ? Number(bal.pending_hours) || 0 : 0;
    const available = Math.max(0, total - used - pending);
    const isQuotaExempt = (total === 0 && (leaveTypeId === "PERSONAL" || leaveTypeId === "SICK"));

    // 試算工時 (08:30-18:00, 午休 12:00-13:30 扣 1.5h, 扣除假日)
    const hours = LeaveEngine.calculateHours(startTime, endTime, this.state.holidays);
    document.getElementById("previewCalculatedHours").textContent = hours.toFixed(1);

    const postRemElem = document.getElementById("previewPostRemaining");

    if (isQuotaExempt) {
      document.getElementById("formAvailableBalance").textContent = `無上限限制（${typeDef ? typeDef.name : leaveTypeId}無預設額度限制，可依需求直接申請，累計已請 ${used}h）`;
      postRemElem.textContent = `不限額度（送出後累計 ${(used + pending + hours).toFixed(1)} 小時）`;
      postRemElem.style.color = "var(--primary)";
    } else {
      document.getElementById("formAvailableBalance").textContent = `${available} 小時 (總額 ${total}h - 已用 ${used}h - 鎖定 ${pending}h)`;
      const postRemaining = available - hours;
      if (postRemaining < 0) {
        postRemElem.textContent = `${postRemaining.toFixed(1)} 小時 (額度不足！)`;
        postRemElem.style.color = "var(--danger)";
      } else {
        postRemElem.textContent = `${postRemaining.toFixed(1)} 小時`;
        postRemElem.style.color = "var(--text-main)";
      }
    }

    // 重疊衝突檢核
    const overlap = LeaveEngine.checkOverlapping(startTime, endTime, this.state.requests, user.id);
    const alertBox = document.getElementById("overlapAlertBox");
    const submitBtn = document.getElementById("btnSubmitLeave");

    if (overlap.hasOverlap) {
      alertBox.style.display = "flex";
      document.getElementById("overlapAlertMsg").textContent = `申請時段與現有請假單 (${overlap.conflictedRequest.id}: ${overlap.conflictedRequest.start_time} ~ ${overlap.conflictedRequest.end_time}) 發生重疊衝突！`;
      submitBtn.disabled = true;
      submitBtn.style.opacity = "0.5";
    } else {
      alertBox.style.display = "none";
      submitBtn.disabled = false;
      submitBtn.style.opacity = "1";
    }

    // 審核路線預覽
    const route = LeaveEngine.getApprovalRoute(hours, user, this.state.users);
    document.getElementById("routeSummaryText").textContent = route.summary;
    const stepper = document.getElementById("routeStepsStepper");
    stepper.innerHTML = "";

    route.steps.forEach((step, idx) => {
      const stepElem = document.createElement("div");
      stepElem.className = "step-node";
      stepElem.innerHTML = `
        <div class="step-circle">${idx + 1}</div>
        <span>${step.title} (<strong>${step.approver}</strong>)</span>
      `;
      stepper.appendChild(stepElem);

      if (idx < route.steps.length - 1) {
        const arrow = document.createElement("div");
        arrow.className = "step-arrow";
        arrow.innerHTML = `<i class="fa-solid fa-arrow-right"></i>`;
        stepper.appendChild(arrow);
      }
    });
  },

  /**
   * 快捷時段填入
   */
  applyPresetTime(preset) {
    const today = new Date();
    const todayStr = LeaveEngine.formatDateOnly(today);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = LeaveEngine.formatDateOnly(tomorrow);

    const startElem = document.getElementById("formStartTime");
    const endElem = document.getElementById("formEndTime");

    // 樣式切換
    document.querySelectorAll(".preset-chip").forEach(c => c.classList.remove("active"));
    if (event && event.target) {
      event.target.closest(".preset-chip")?.classList.add("active");
    }

    switch (preset) {
      case "full":
        startElem.value = `${todayStr}T08:30`;
        endElem.value = `${todayStr}T18:00`;
        break;
      case "morning":
        startElem.value = `${todayStr}T08:30`;
        endElem.value = `${todayStr}T12:00`;
        break;
      case "afternoon":
        startElem.value = `${todayStr}T13:30`;
        endElem.value = `${todayStr}T18:00`;
        break;
      case "tomorrow":
        startElem.value = `${tomorrowStr}T08:30`;
        endElem.value = `${tomorrowStr}T18:00`;
        break;
      case "multidays": {
        // 4 個工作天 (例如今天到 4 天後)
        const multiEnd = new Date(today);
        multiEnd.setDate(multiEnd.getDate() + 5);
        startElem.value = `${todayStr}T08:30`;
        endElem.value = `${LeaveEngine.formatDateOnly(multiEnd)}T18:00`;
        break;
      }
    }

    this.onFormChange();
  },

  /**
   * 送出請假申請 (支援按鍵防連點與單號傳遞)
   */
  async handleLeaveSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (this.state.isSubmitting) return;

    const user = this.state.currentUser;
    const leaveTypeId = document.getElementById("formLeaveType").value;
    const startTime = document.getElementById("formStartTime").value.replace("T", " ");
    const endTime = document.getElementById("formEndTime").value.replace("T", " ");
    const reason = document.getElementById("formReason").value;
    let attachmentUrl = document.getElementById("formAttachment").value.trim();
    // 病假免強制提供證明文件：若為病假且同仁未填附件，主動填入（免附證明）以完全相容各版本雲端資料庫檢核
    if (leaveTypeId === "SICK" && !attachmentUrl) {
      attachmentUrl = "（免附證明）";
    }
    const submitBtn = document.getElementById("btnSubmitLeave");

    // 產生高精度防重申請單號 (年月日-時分秒-4位亂數)
    const now = new Date();
    const dateStr = LeaveEngine.formatDateOnly(now).replace(/-/g, "");
    const timeStr = [
      ("0" + now.getHours()).slice(-2),
      ("0" + now.getMinutes()).slice(-2),
      ("0" + now.getSeconds()).slice(-2)
    ].join("");
    const rand = Math.floor(1000 + Math.random() * 9000);
    const requestId = `REQ-${dateStr}-${timeStr}-${rand}`;

    const payload = {
      requestId,
      userId: user.id,
      leaveTypeId,
      startTime,
      endTime,
      reason,
      attachmentUrl
    };

    this.state.isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add("btn-loading");
      submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 請假申請處理中...`;
    }

    try {
      const res = await ApiService.applyLeave(payload);
      if (res.success) {
        this.showToast(res.message, "success");
        await this.loadData(user.id);
        this.navigate("dashboard");
      } else {
        this.showToast(res.message, "error");
      }
    } catch (err) {
      console.error("送出請假申請發生例外:", err);
      this.showToast("送出請假申請失敗：" + (err.message || "網路異常"), "error");
    } finally {
      this.state.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove("btn-loading");
        submitBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> 確認送出請假申請`;
      }
    }
  },

  /**
   * 3. 渲染加班申報與補休專區 (Overtime View)
   */
  renderOvertimeView() {
    const user = this.state.currentUser;
    const year = SYSTEM_CONFIG.CURRENT_YEAR;

    const compBal = this.state.balances.find(b => 
      String(b.user_id || "").trim().toUpperCase() === String(user.id || "").trim().toUpperCase() && 
      (b.leave_type_id === "COMP" || b.leave_type_id === "補休" || b.leave_type_id === "補休假") && 
      parseInt(b.year, 10) === parseInt(year, 10)
    ) || {
      total_hours: 0, used_hours: 0, pending_hours: 0
    };
    const compRemaining = Math.max(0, compBal.total_hours - compBal.used_hours - compBal.pending_hours);

    document.getElementById("otCompRemainingHours").textContent = compRemaining.toFixed(1);
    document.getElementById("otCompTotalHours").textContent = compBal.total_hours.toFixed(1);
    document.getElementById("otCompUsedHours").textContent = compBal.used_hours.toFixed(1);
    document.getElementById("otCompPendingHours").textContent = compBal.pending_hours.toFixed(1);

    // 渲染個人加班申報紀錄
    const myOts = this.state.overtimes.filter(o => o.user_id === user.id);
    const tableBody = document.getElementById("myOvertimeTableBody");
    tableBody.innerHTML = "";

    if (myOts.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">尚無加班申報紀錄</td></tr>`;
    } else {
      myOts.forEach(ot => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${ot.id}</strong></td>
          <td>${ot.date}</td>
          <td>${LeaveEngine.formatTimeOnly(ot.start_time)} ~ ${LeaveEngine.formatTimeOnly(ot.end_time)}</td>
          <td><strong>${ot.hours}</strong> h</td>
          <td><strong style="color: var(--success); font-family: 'JetBrains Mono';">+${ot.comp_hours}</strong> h (${ot.comp_rate}x)</td>
          <td>${ot.reason}</td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${ot.expiry_date || '--'}</td>
          <td>${this.getStatusBadgeHtml(ot.status, "COMPLETED")}</td>
        `;
        tableBody.appendChild(tr);
      });
    }
  },

  /**
   * 開啟加班申報彈窗
   */
  showOvertimeModal() {
    const todayStr = LeaveEngine.formatDateOnly(new Date());
    document.getElementById("otDate").value = todayStr;
    this.calcOtHours();
    document.getElementById("overtimeModal").classList.add("active");
  },

  /**
   * 計算加班可換算補休時數
   */
  calcOtHours() {
    const hours = parseFloat(document.getElementById("otHours").value) || 0;
    const rate = parseFloat(document.getElementById("otRate").value) || 1.0;
    const compHours = (hours * rate).toFixed(1);
    document.getElementById("otCalculatedCompHours").textContent = `${compHours} 小時`;
  },

  /**
   * 送出加班申報 (支援按鍵防連點)
   */
  async handleOvertimeSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (this.state.isSubmitting) return;

    const user = this.state.currentUser;
    const date = document.getElementById("otDate").value;
    const startTime = document.getElementById("otStart").value;
    const endTime = document.getElementById("otEnd").value;
    const hours = parseFloat(document.getElementById("otHours").value) || 0;
    const compRate = parseFloat(document.getElementById("otRate").value) || 1.0;
    const reason = document.getElementById("otReason").value;
    const submitBtn = document.getElementById("btnSubmitOvertime");

    // 產生高精度防重加班單號 (年月日-時分秒-4位亂數)
    const now = new Date();
    const dateStr = LeaveEngine.formatDateOnly(now).replace(/-/g, "");
    const timeStr = [
      ("0" + now.getHours()).slice(-2),
      ("0" + now.getMinutes()).slice(-2),
      ("0" + now.getSeconds()).slice(-2)
    ].join("");
    const rand = Math.floor(1000 + Math.random() * 9000);
    const overtimeId = `OT-${dateStr}-${timeStr}-${rand}`;

    const payload = {
      overtimeId,
      userId: user.id,
      date,
      startTime,
      endTime,
      hours,
      compRate,
      reason
    };

    this.state.isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add("btn-loading");
      submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 加班申報處理中...`;
    }

    try {
      const res = await ApiService.applyOvertime(payload);
      if (res.success) {
        this.showToast(res.message, "success");
        this.closeModal("overtimeModal");
        await this.loadData(user.id);
        this.renderOvertimeView();
      } else {
        this.showToast(res.message, "error");
      }
    } catch (err) {
      console.error("送出加班申報發生例外:", err);
      this.showToast("送出加班申報失敗：" + (err.message || "網路異常"), "error");
    } finally {
      this.state.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove("btn-loading");
        submitBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> 送出加班申報`;
      }
    }
  },

  /**
   * 4. 渲染審核中心 (Approval Center)
   */
  renderApprovalsView() {
    const user = this.state.currentUser;
    const isManager = LeaveEngine.isUserManager(user);
    const isAdmin = LeaveEngine.isUserAdmin(user);

    // 依權限過濾待審清單
    // 請假單待審
    const pendingLeaves = this.state.requests.filter(r => {
      if (r.status !== "PENDING") return false;
      const applicant = this.state.users.find(u => u.id === r.user_id);
      const isSelf = (r.user_id === user.id);
      const isSelfManager = (applicant && (applicant.manager_id === user.id || !applicant.manager_id));

      // 若為一般同仁本人 (主管另有其人且非 Admin)，則不可自審
      if (isSelf && !isSelfManager && !isAdmin) return false;

      if (r.current_step === "MANAGER") {
        // 直屬主管審核：需為申請人的 manager_id，或是 Admin，或是主管本人自核
        return (applicant && (applicant.manager_id === user.id || (isSelf && isSelfManager))) || isAdmin;
      } else if (r.current_step === "HR") {
        // 第二階 HR 雙簽：需為 Admin / HR 角色
        return isAdmin;
      }
      return false;
    });

    // 銷假單待審
    const pendingCancels = this.state.requests.filter(r => {
      if (r.status !== "CANCEL_PENDING") return false;
      const applicant = this.state.users.find(u => u.id === r.user_id);
      const isSelf = (r.user_id === user.id);
      const isSelfManager = (applicant && (applicant.manager_id === user.id || !applicant.manager_id));

      if (isSelf && !isSelfManager && !isAdmin) return false;
      return (applicant && (applicant.manager_id === user.id || (isSelf && isSelfManager))) || isAdmin;
    });

    // 加班單待審
    const pendingOvertimes = this.state.overtimes.filter(o => {
      if (o.status !== "PENDING") return false;
      const applicant = this.state.users.find(u => u.id === o.user_id);
      const isSelf = (o.user_id === user.id);
      const isSelfManager = (applicant && (applicant.manager_id === user.id || !applicant.manager_id));

      if (isSelf && !isSelfManager && !isAdmin) return false;
      return (applicant && (applicant.manager_id === user.id || (isSelf && isSelfManager))) || isAdmin;
    });

    // 更新各 Tab 數量徽章
    document.getElementById("countPendingLeaves").textContent = pendingLeaves.length;
    document.getElementById("countPendingCancels").textContent = pendingCancels.length;
    document.getElementById("countPendingOvertimes").textContent = pendingOvertimes.length;

    // 渲染當前 Tab 內容
    const thead = document.getElementById("approvalTableHead");
    const tbody = document.getElementById("approvalTableBody");
    tbody.innerHTML = "";

    if (this.state.approvalTab === "leaves") {
      thead.innerHTML = `
        <tr>
          <th>單號</th>
          <th>申請人</th>
          <th>假別</th>
          <th>請假區間</th>
          <th>工時</th>
          <th>事由</th>
          <th>審核階層</th>
          <th>動作</th>
        </tr>
      `;

      if (pendingLeaves.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">目前無任何待審核之請假申請單 🎉</td></tr>`;
      } else {
        pendingLeaves.forEach(req => {
          const applicant = this.state.users.find(u => u.id === req.user_id) || { name: req.user_id, department_name: "" };
          const typeDef = SYSTEM_CONFIG.LEAVE_TYPES.find(t => t.id === req.leave_type_id) || { name: req.leave_type_id };
          const stepBadge = req.current_step === "HR" 
            ? `<span class="badge badge-purple"><i class="fa-solid fa-user-shield"></i> HR 複核 (第2階)</span>` 
            : `<span class="badge badge-blue"><i class="fa-solid fa-user-tie"></i> 主管初審 (第1階)</span>`;

          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td><strong>${req.id}</strong></td>
            <td>
              <strong>${applicant.name}</strong>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${applicant.department_name}</div>
            </td>
            <td><span class="badge ${typeDef.badgeClass || 'badge-blue'}">${typeDef.name}</span></td>
            <td style="font-size: 0.8rem;">
              <div>${req.start_time}</div>
              <div>至 ${req.end_time}</div>
            </td>
            <td><strong style="font-family: 'JetBrains Mono'; color: var(--primary);">${req.total_hours}</strong> h</td>
            <td style="max-width: 180px; font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${req.reason}">${req.reason}</td>
            <td>${stepBadge}</td>
            <td>
              <button class="btn btn-sm btn-primary" onclick="App.openApprovalModal('LEAVE', '${req.id}')">
                <i class="fa-solid fa-pen-to-square"></i> 簽核
              </button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    } else if (this.state.approvalTab === "cancels") {
      thead.innerHTML = `
        <tr>
          <th>單號</th>
          <th>申請人</th>
          <th>假別</th>
          <th>原請假區間</th>
          <th>需退還時數</th>
          <th>銷假事由</th>
          <th>動作</th>
        </tr>
      `;

      if (pendingCancels.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 32px;">目前無任何待審核之銷假申請單</td></tr>`;
      } else {
        pendingCancels.forEach(req => {
          const applicant = this.state.users.find(u => u.id === req.user_id) || { name: req.user_id, department_name: "" };
          const typeDef = SYSTEM_CONFIG.LEAVE_TYPES.find(t => t.id === req.leave_type_id) || { name: req.leave_type_id };

          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td><strong>${req.id}</strong></td>
            <td><strong>${applicant.name}</strong> (${applicant.department_name})</td>
            <td><span class="badge ${typeDef.badgeClass || 'badge-blue'}">${typeDef.name}</span></td>
            <td style="font-size: 0.8rem;">${req.start_time} ~ ${req.end_time}</td>
            <td><strong style="color: var(--success); font-family: 'JetBrains Mono';">${req.total_hours}</strong> h</td>
            <td>${req.reason}</td>
            <td>
              <button class="btn btn-sm btn-primary" onclick="App.openApprovalModal('CANCEL_LEAVE', '${req.id}')">
                <i class="fa-solid fa-rotate-left"></i> 審核銷假
              </button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    } else if (this.state.approvalTab === "overtimes") {
      thead.innerHTML = `
        <tr>
          <th>單號</th>
          <th>申報人</th>
          <th>加班日期</th>
          <th>時段</th>
          <th>工時</th>
          <th>換算補休</th>
          <th>事由</th>
          <th>動作</th>
        </tr>
      `;

      if (pendingOvertimes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">目前無任何待審核之加班申報單</td></tr>`;
      } else {
        pendingOvertimes.forEach(ot => {
          const applicant = this.state.users.find(u => u.id === ot.user_id) || { name: ot.user_id, department_name: "" };

          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td><strong>${ot.id}</strong></td>
            <td><strong>${applicant.name}</strong> (${applicant.department_name})</td>
            <td>${ot.date}</td>
            <td>${LeaveEngine.formatTimeOnly(ot.start_time)} ~ ${LeaveEngine.formatTimeOnly(ot.end_time)}</td>
            <td><strong>${ot.hours}</strong> h</td>
            <td><strong style="color: var(--success); font-family: 'JetBrains Mono';">+${ot.comp_hours}</strong> h</td>
            <td>${ot.reason}</td>
            <td>
              <button class="btn btn-sm btn-primary" onclick="App.openApprovalModal('OVERTIME', '${ot.id}')">
                <i class="fa-solid fa-check"></i> 審核加班
              </button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    } else if (this.state.approvalTab === "history") {
      thead.innerHTML = `
        <tr>
          <th>歷程編號</th>
          <th>關聯單號</th>
          <th>申請人</th>
          <th>類型</th>
          <th>審核人</th>
          <th>審核身分</th>
          <th>決議</th>
          <th>簽核意見 / 退回理由</th>
          <th>簽核時間</th>
        </tr>
      `;

      // 依身分權限過濾歷程：一般員工只能看自己相關的，主管可看自己與下屬的，管理者可看全部
      const visibleLogs = this.state.logs.filter(log => {
        if (isAdmin) return true;

        // 找出關聯申請人 ID
        let applicantId = null;
        if (log.request_type === "OVERTIME") {
          const ot = this.state.overtimes.find(o => o.id === log.request_id);
          if (ot) applicantId = ot.user_id;
        } else {
          const req = this.state.requests.find(r => r.id === log.request_id);
          if (req) applicantId = req.user_id;
        }

        const isApplicantSelf = (applicantId === user.id);
        const isApproverSelf = (log.approver_id === user.id);

        if (isApplicantSelf || isApproverSelf) return true;

        if (user.role === "Manager") {
          const applicant = this.state.users.find(u => u.id === applicantId);
          if (applicant && applicant.manager_id === user.id) return true;
        }

        return false;
      });

      // 簽核歷史歷程排序：由最新的排在最上面 (新到舊降序排列)
      visibleLogs.sort((a, b) => {
        const timeA = new Date(a.acted_at || a.created_at || 0).getTime();
        const timeB = new Date(b.acted_at || b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return String(b.id || "").localeCompare(String(a.id || ""));
      });

      if (visibleLogs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 32px;">目前無符合權限之簽核歷史歷程</td></tr>`;
      } else {
        visibleLogs.forEach(log => {
          let applicant = null;
          if (log.request_type === "OVERTIME") {
            const ot = this.state.overtimes.find(o => o.id === log.request_id);
            if (ot) applicant = this.state.users.find(u => u.id === ot.user_id);
          } else {
            const req = this.state.requests.find(r => r.id === log.request_id);
            if (req) applicant = this.state.users.find(u => u.id === req.user_id);
          }
          const applicantName = applicant ? `${applicant.name} (${applicant.department_name})` : '--';

          const approver = this.state.users.find(u => u.id === log.approver_id) || { name: log.approver_id };
          let approverRoleText = log.approver_role || "--";
          if (log.approver_role === "Applicant" || log.status === "PENDING" || log.status === "APPLIED") {
            approverRoleText = "申請同仁 (本人)";
          }

          let statusBadge = "";
          if (log.status === "APPROVED") {
            statusBadge = `<span class="badge badge-approved">核准 APPROVED</span>`;
          } else if (log.status === "REJECTED") {
            statusBadge = `<span class="badge badge-rejected">退回 REJECTED</span>`;
          } else if (log.status === "PENDING" || log.status === "APPLIED") {
            statusBadge = `<span class="badge badge-pending">申請送出 PENDING</span>`;
          } else if (log.status === "CANCEL_PENDING") {
            statusBadge = `<span class="badge badge-cancel-pending">銷假申請 CANCEL</span>`;
          } else if (log.status === "CANCELLED") {
            statusBadge = `<span class="badge badge-cancelled">已撤銷 CANCELLED</span>`;
          } else {
            statusBadge = `<span class="badge badge-blue">${log.status}</span>`;
          }

          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td><span style="font-size: 0.78rem; color: var(--text-sub); font-family: 'JetBrains Mono', monospace;">${log.id}</span></td>
            <td><strong style="color: var(--primary); font-family: 'JetBrains Mono', monospace;">${log.request_id}</strong></td>
            <td><strong>${applicantName}</strong></td>
            <td><span class="badge badge-blue">${log.request_type}</span></td>
            <td><strong>${approver.name}</strong></td>
            <td><span style="font-size: 0.8rem; color: var(--text-muted);">${approverRoleText}</span></td>
            <td>${statusBadge}</td>
            <td style="font-size: 0.82rem;">${log.comment || '--'}</td>
            <td style="font-size: 0.78rem; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;">${log.acted_at}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    }
  },

  /**
   * 切換審核 Tab
   */
  switchApprovalTab(tabName, btnElem) {
    this.state.approvalTab = tabName;
    document.querySelectorAll(".approval-tabs .tab-btn").forEach(b => b.classList.remove("active"));
    if (btnElem) btnElem.classList.add("active");
    this.renderApprovalsView();
  },

  /**
   * 開啟審核確認彈窗
   */
  openApprovalModal(type, id) {
    this.state.activeActionItem = { type, id };
    const modalBody = document.getElementById("approvalModalBody");
    const modalTitle = document.getElementById("approvalModalTitle");

    if (type === "LEAVE" || type === "CANCEL_LEAVE") {
      const req = this.state.requests.find(r => r.id === id);
      if (!req) return;
      const applicant = this.state.users.find(u => u.id === req.user_id) || { name: req.user_id, department_name: "" };
      const typeDef = SYSTEM_CONFIG.LEAVE_TYPES.find(t => t.id === req.leave_type_id) || { name: req.leave_type_id };

      modalTitle.textContent = type === "LEAVE" ? "請假申請單簽核" : "銷假退還額度審核";
      modalBody.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 14px; font-size: 0.9rem;">
          <div style="padding: 12px; background: #f8fafc; border-radius: var(--radius-md); display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>申請人員：<strong>${applicant.name}</strong> (${applicant.department_name})</div>
            <div>申請假別：<span class="badge ${typeDef.badgeClass || 'badge-blue'}">${typeDef.name}</span></div>
            <div>請假起訖：<strong>${req.start_time}</strong> 至 <strong>${req.end_time}</strong></div>
            <div>扣除工時：<strong style="color: var(--primary); font-family: 'JetBrains Mono';">${req.total_hours} 小時</strong></div>
          </div>
          <div>
            <strong>事由說明：</strong>
            <p style="color: var(--text-muted); margin-top: 4px; background: #fafafa; padding: 8px 12px; border-radius: 6px;">${req.reason || '無'}</p>
          </div>
          ${(req.attachment_url && req.attachment_url.indexOf("http") === 0) ? `
            <div>
              <strong>附件證明：</strong>
              <a href="${req.attachment_url}" target="_blank" style="color: var(--primary); text-decoration: underline; margin-left: 8px;">
                <i class="fa-solid fa-paperclip"></i> 查看證明文件 / 圖片連結
              </a>
            </div>
          ` : (req.attachment_url ? `
            <div>
              <strong>附件證明：</strong>
              <span style="color: var(--text-muted); font-size: 0.85rem; margin-left: 8px;">${req.attachment_url}</span>
            </div>
          ` : '')}
          <div class="form-group">
            <label class="form-label">簽核意見 / 退回原因 <span style="color: var(--danger); font-size: 0.75rem;">(若退回則必填)</span></label>
            <textarea class="form-control" id="approvalModalComment" rows="3" placeholder="請輸入審核意見 (如：准假、同意銷假、或退回之具體理由)..."></textarea>
          </div>
        </div>
      `;
    } else if (type === "OVERTIME") {
      const ot = this.state.overtimes.find(o => o.id === id);
      if (!ot) return;
      const applicant = this.state.users.find(u => u.id === ot.user_id) || { name: ot.user_id, department_name: "" };

      modalTitle.textContent = "加班申報與補休換算審核";
      modalBody.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 14px; font-size: 0.9rem;">
          <div style="padding: 12px; background: #f8fafc; border-radius: var(--radius-md); display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>申報人員：<strong>${applicant.name}</strong> (${applicant.department_name})</div>
            <div>加班日期：<strong>${ot.date}</strong></div>
            <div>加班時段：<strong>${LeaveEngine.formatTimeOnly(ot.start_time)} ~ ${LeaveEngine.formatTimeOnly(ot.end_time)}</strong></div>
            <div>申報工時：<strong>${ot.hours} 小時</strong></div>
            <div>換算倍率：<strong>${ot.comp_rate}x</strong></div>
            <div>發放補休：<strong style="color: var(--success); font-family: 'JetBrains Mono';">+${ot.comp_hours} 小時</strong></div>
          </div>
          <div>
            <strong>加班工作內容：</strong>
            <p style="color: var(--text-muted); margin-top: 4px; background: #fafafa; padding: 8px 12px; border-radius: 6px;">${ot.reason || '無'}</p>
          </div>
          <div class="form-group">
            <label class="form-label">簽核意見 / 退回原因</label>
            <textarea class="form-control" id="approvalModalComment" rows="3" placeholder="請輸入審核意見..."></textarea>
          </div>
        </div>
      `;
    }

    document.getElementById("approvalModal").classList.add("active");
  },

  /**
   * 執行審核動作 (同意 / 退回，支援按鍵防連點)
   */
  async submitApprovalAction(isApprove) {
    if (this.state.isSubmitting) return;
    if (!this.state.activeActionItem) return;
    const { type, id } = this.state.activeActionItem;
    const comment = document.getElementById("approvalModalComment").value.trim();
    const user = this.state.currentUser;

    if (!isApprove && !comment) {
      this.showToast("退回申請時必須填寫退回原因！", "error");
      return;
    }

    const btnApprove = document.getElementById("btnModalApprove");
    const btnReject = document.getElementById("btnModalReject");
    this.state.isSubmitting = true;
    if (btnApprove) btnApprove.disabled = true;
    if (btnReject) btnReject.disabled = true;

    const activeBtn = isApprove ? btnApprove : btnReject;
    const originalHtml = activeBtn ? activeBtn.innerHTML : "";
    if (activeBtn) {
      activeBtn.classList.add("btn-loading");
      activeBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 審核處理中...`;
    }

    try {
      let res = null;
      if (type === "LEAVE" || type === "CANCEL_LEAVE") {
        res = await ApiService.reviewLeave({ requestId: id, approverId: user.id, comment }, isApprove);
      } else if (type === "OVERTIME") {
        res = await ApiService.reviewOvertime({ overtimeId: id, approverId: user.id, comment }, isApprove);
      }

      if (res && res.success) {
        this.showToast(res.message, "success");
        this.closeModal("approvalModal");
        await this.loadData(user.id);
        this.renderApprovalsView();
        this.updatePendingBadges();
      } else {
        this.showToast(res ? res.message : "操作失敗", "error");
      }
    } catch (err) {
      console.error("審核操作發生例外:", err);
      this.showToast("審核處理失敗：" + (err.message || "網路異常"), "error");
    } finally {
      this.state.isSubmitting = false;
      if (btnApprove) {
        btnApprove.disabled = false;
        btnApprove.classList.remove("btn-loading");
      }
      if (btnReject) {
        btnReject.disabled = false;
        btnReject.classList.remove("btn-loading");
      }
      if (activeBtn) {
        activeBtn.innerHTML = originalHtml;
      }
    }
  },

  /**
   * 5. 撤銷 / 銷假彈窗觸發
   */
  handleCancelClick(requestId, currentStatus) {
    this.state.activeActionItem = { requestId, currentStatus };
    const modalPrompt = document.getElementById("cancelModalPrompt");
    const modalTitle = document.getElementById("cancelModalTitle");
    const reasonInput = document.getElementById("cancelReasonInput");
    reasonInput.value = "";

    if (currentStatus === "PENDING") {
      modalTitle.textContent = "撤銷請假申請";
      modalPrompt.innerHTML = `確定要撤銷請假單 <strong>${requestId}</strong> 嗎？<br>撤銷後系統將<strong>立即釋放鎖定之額度</strong>。`;
    } else if (currentStatus === "APPROVED") {
      modalTitle.textContent = "送出銷假申請";
      modalPrompt.innerHTML = `請假單 <strong>${requestId}</strong> 已核准。<br>送出銷假申請後需經主管/人資審核，審核通過將<strong>全數退還已扣除之假別額度</strong>。`;
    }

    document.getElementById("cancelModal").classList.add("active");
  },

  async executeCancelLeave() {
    if (this.state.isSubmitting) return;
    if (!this.state.activeActionItem) return;
    const { requestId } = this.state.activeActionItem;
    const user = this.state.currentUser;
    const reason = document.getElementById("cancelReasonInput").value.trim();

    if (!reason) {
      this.showToast("請填寫撤銷/銷假事由說明！", "error");
      return;
    }

    const btn = document.getElementById("btnConfirmCancel");
    this.state.isSubmitting = true;
    if (btn) {
      btn.disabled = true;
      btn.classList.add("btn-loading");
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 處理中...`;
    }

    try {
      const res = await ApiService.cancelLeave({
        requestId,
        userId: user.id,
        cancelReason: reason
      });

      if (res.success) {
        this.showToast(res.message, "success");
        this.closeModal("cancelModal");
        await this.loadData(user.id);
        this.renderDashboard();
      } else {
        this.showToast(res.message, "error");
      }
    } catch (err) {
      console.error("執行撤銷銷假例外:", err);
      this.showToast("撤銷銷假失敗：" + (err.message || "網路異常"), "error");
    } finally {
      this.state.isSubmitting = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("btn-loading");
        btn.innerHTML = `確認執行`;
      }
    }
  },

  /**
   * 6. 差勤行事曆 (Calendar View)
   */
  renderCalendar() {
    const year = this.state.calendarYear;
    const month = this.state.calendarMonth; // 0-indexed

    const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
    document.getElementById("calendarMonthTitle").textContent = `${year} 年 ${monthNames[month]}`;

    const grid = document.getElementById("calendarDaysGrid");
    grid.innerHTML = "";

    // 取得當月第 1 天是星期幾、當月天數
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 (Sun) - 6 (Sat)
    const totalDays = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    // 建立 2026 國定假日 Map
    const holidayMap = {};
    this.state.holidays.forEach(h => {
      holidayMap[h.date] = h;
    });

    // 建立請假單 Map (依權限嚴格過濾：管理者看全體、直屬主管看部屬與自己、一般員工僅看自己)
    const currentUser = this.state.currentUser;
    const isAdmin = LeaveEngine.isUserAdmin(currentUser);
    const isManager = LeaveEngine.isUserManager(currentUser);

    const activeLeaves = this.state.requests.filter(r => {
      if (r.status !== "APPROVED" && r.status !== "PENDING") return false;
      if (isAdmin) return true;
      if (r.user_id === currentUser.id) return true;
      if (isManager) {
        const applicant = this.state.users.find(u => u.id === r.user_id);
        return applicant && applicant.manager_id === currentUser.id;
      }
      return false;
    });

    // 1. 上個月尾巴天數
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const cell = document.createElement("div");
      cell.className = "calendar-day-cell other-month";
      cell.innerHTML = `<div class="day-number">${prevMonthDays - i}</div>`;
      grid.appendChild(cell);
    }

    // 2. 當月天數
    const todayStr = LeaveEngine.formatDateOnly(new Date());
    for (let day = 1; day <= totalDays; day++) {
      const dateStr = `${year}-${("0" + (month + 1)).slice(-2)}-${("0" + day).slice(-2)}`;
      const dayOfWeek = new Date(year, month, day).getDay();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      const isToday = (dateStr === todayStr);

      const cell = document.createElement("div");
      let cellClasses = "calendar-day-cell";
      if (isWeekend) cellClasses += " weekend";
      if (isToday) cellClasses += " today";
      cell.className = cellClasses;

      // 國定假日標記
      let holidayTag = "";
      if (holidayMap[dateStr]) {
        holidayTag = `<span class="holiday-tag">${holidayMap[dateStr].name}</span>`;
      }

      let eventsHtml = "";
      // 搜尋當天請假的同仁
      activeLeaves.forEach(req => {
        const reqStart = req.start_time.substring(0, 10);
        const reqEnd = req.end_time.substring(0, 10);

        if (dateStr >= reqStart && dateStr <= reqEnd) {
          const emp = this.state.users.find(u => u.id === req.user_id) || { name: req.user_id };
          const typeDef = SYSTEM_CONFIG.LEAVE_TYPES.find(t => t.id === req.leave_type_id) || { name: req.leave_type_id };
          eventsHtml += `
            <div class="calendar-event-pill" title="${emp.name} - ${typeDef.name} (${req.total_hours}h)">
              ${emp.name}: ${typeDef.name}
            </div>
          `;
        }
      });

      cell.innerHTML = `
        <div class="day-number">
          <span>${day}</span>
          ${holidayTag}
        </div>
        <div style="display: flex; flex-direction: column; gap: 2px; overflow-y: auto;">
          ${eventsHtml}
        </div>
      `;
      grid.appendChild(cell);
    }
  },

  changeCalendarMonth(delta) {
    this.state.calendarMonth += delta;
    if (this.state.calendarMonth > 11) {
      this.state.calendarMonth = 0;
      this.state.calendarYear += 1;
    } else if (this.state.calendarMonth < 0) {
      this.state.calendarMonth = 11;
      this.state.calendarYear -= 1;
    }
    this.renderCalendar();
  },

  resetCalendarToday() {
    const now = new Date();
    this.state.calendarYear = now.getFullYear();
    this.state.calendarMonth = now.getMonth();
    this.renderCalendar();
  },

  /**
   * 6. 差勤歷史紀錄與多條件查詢 (History View)
   */
  renderHistory() {
    const user = this.state.currentUser;
    if (!user) return;

    const isHrOrAdmin = LeaveEngine.isUserAdmin(user);
    const isManager = LeaveEngine.isUserManager(user);

    // 1. 設置身分檢視範圍徽章
    const badgeEl = document.getElementById("historyRoleScopeBadge");
    if (badgeEl) {
      if (isHrOrAdmin) {
        badgeEl.innerHTML = `<span class="badge badge-purple" style="font-size: 0.78rem;"><i class="fa-solid fa-shield-halved"></i> 人資部/管理者全域模式 (可檢視全公司所有紀錄)</span>`;
      } else if (isManager) {
        badgeEl.innerHTML = `<span class="badge badge-blue" style="font-size: 0.78rem;"><i class="fa-solid fa-users"></i> 主管模式 (可檢視轄下同仁與個人紀錄)</span>`;
      } else {
        badgeEl.innerHTML = `<span class="badge" style="background:#f1f5f9; color:var(--text-muted); font-size: 0.78rem;"><i class="fa-solid fa-user"></i> 個人模式</span>`;
      }
    }

    // 2. 設置部門篩選選單
    const deptGroup = document.getElementById("historyDeptFilterGroup");
    const deptSelect = document.getElementById("historyFilterDept");
    if (deptGroup && deptSelect) {
      if (isHrOrAdmin) {
        deptGroup.style.display = "block";
        deptSelect.innerHTML = `<option value="ALL">全部部門 (All Departments)</option>`;
        SYSTEM_CONFIG.DEPARTMENTS.forEach(d => {
          deptSelect.innerHTML += `<option value="${d.name}">${d.name}</option>`;
        });
      } else {
        deptGroup.style.display = "none";
      }
    }

    // 3. 設置同仁人員篩選選單
    const userGroup = document.getElementById("historyUserFilterGroup");
    if (userGroup) {
      if (isHrOrAdmin || isManager) {
        userGroup.style.display = "block";
        this.populateHistoryUserSelect();
      } else {
        userGroup.style.display = "none";
      }
    }

    // 4. 動態渲染假別多選勾選盒 (Multi-select Checkboxes)
    const typeBox = document.getElementById("historyLeaveTypeCheckboxes");
    if (typeBox) {
      typeBox.innerHTML = "";
      SYSTEM_CONFIG.LEAVE_TYPES.forEach(t => {
        const label = document.createElement("label");
        label.className = "type-checkbox-chip active";
        label.id = `chip_${t.id}`;
        label.innerHTML = `
          <input type="checkbox" value="${t.id}" checked onchange="App.onTypeCheckboxChange(this)">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${t.color};"></span>
          ${t.name}
        `;
        typeBox.appendChild(label);
      });

      // 加入加班單勾選盒
      const otLabel = document.createElement("label");
      otLabel.className = "type-checkbox-chip active";
      otLabel.id = "chip_OVERTIME";
      otLabel.innerHTML = `
        <input type="checkbox" value="OVERTIME" checked onchange="App.onTypeCheckboxChange(this)">
        <i class="fa-solid fa-clock" style="color: var(--warning); font-size: 0.8rem;"></i>
        加班申報單
      `;
      typeBox.appendChild(otLabel);
    }

    // 5. 執行初次過濾查詢
    this.applyHistoryFilter();
  },

  /**
   * 填充歷史紀錄的人員下拉選單
   */
  populateHistoryUserSelect() {
    const user = this.state.currentUser;
    const userSelect = document.getElementById("historyFilterUser");
    const deptSelect = document.getElementById("historyFilterDept");
    if (!userSelect) return;

    const isHrOrAdmin = LeaveEngine.isUserAdmin(user);
    const isManager = LeaveEngine.isUserManager(user);
    const selectedDept = deptSelect ? deptSelect.value : "ALL";

    userSelect.innerHTML = `<option value="ALL">全部同仁 (All Members)</option>`;

    let candidates = [];
    if (isHrOrAdmin) {
      candidates = this.state.users;
    } else if (isManager) {
      candidates = this.state.users.filter(u => u.id === user.id || u.manager_id === user.id);
    }

    if (selectedDept !== "ALL") {
      candidates = candidates.filter(u => u.department_name === selectedDept);
    }

    candidates.forEach(u => {
      userSelect.innerHTML += `<option value="${u.id}">${u.name} (${u.department_name} - ${u.id})</option>`;
    });
  },

  /**
   * 當部門篩選變更時
   */
  onHistoryDeptChange() {
    this.populateHistoryUserSelect();
    this.applyHistoryFilter();
  },

  /**
   * 假別勾選盒狀態切換
   */
  onTypeCheckboxChange(input) {
    const label = input.closest(".type-checkbox-chip");
    if (label) {
      if (input.checked) {
        label.classList.add("active");
      } else {
        label.classList.remove("active");
      }
    }
    this.applyHistoryFilter();
  },

  /**
   * 全選或清除假別勾選
   */
  toggleAllHistoryTypeCheckboxes(selectAll) {
    const container = document.getElementById("historyLeaveTypeCheckboxes");
    if (!container) return;
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
      cb.checked = !!selectAll;
      const label = cb.closest(".type-checkbox-chip");
      if (label) {
        if (selectAll) label.classList.add("active");
        else label.classList.remove("active");
      }
    });
    this.applyHistoryFilter();
  },

  /**
   * 執行歷史紀錄多條件綜合過濾
   */
  applyHistoryFilter() {
    const user = this.state.currentUser;
    if (!user) return;

    const isHrOrAdmin = LeaveEngine.isUserAdmin(user);
    const isManager = LeaveEngine.isUserManager(user);

    // 1. 取得勾選之假別代碼清單
    const checkedTypes = [];
    const container = document.getElementById("historyLeaveTypeCheckboxes");
    if (container) {
      container.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        checkedTypes.push(cb.value);
      });
    }

    // 2. 取得其他表單篩選條件
    const deptVal = document.getElementById("historyFilterDept") ? document.getElementById("historyFilterDept").value : "ALL";
    const userVal = document.getElementById("historyFilterUser") ? document.getElementById("historyFilterUser").value : "ALL";
    const statusVal = document.getElementById("historyFilterStatus") ? document.getElementById("historyFilterStatus").value : "ALL";
    const startDateVal = document.getElementById("historyFilterStartDate") ? document.getElementById("historyFilterStartDate").value : "";
    const endDateVal = document.getElementById("historyFilterEndDate") ? document.getElementById("historyFilterEndDate").value : "";
    const keyword = document.getElementById("historyFilterKeyword") ? document.getElementById("historyFilterKeyword").value.trim().toLowerCase() : "";

    // 3. 收集所有可視的請假單與加班單
    const allRecords = [];

    // 請假單轉換
    this.state.requests.forEach(req => {
      const applicant = this.state.users.find(u => u.id === req.user_id) || { id: req.user_id, name: req.user_id, department_name: "--" };
      
      // 權限可視性判定
      let isVisible = false;
      if (isHrOrAdmin) {
        isVisible = true; // 人資與超級管理者看全員
      } else if (isManager) {
        isVisible = (req.user_id === user.id || applicant.manager_id === user.id);
      } else {
        isVisible = (req.user_id === user.id);
      }

      if (isVisible) {
        const typeDef = SYSTEM_CONFIG.LEAVE_TYPES.find(t => t.id === req.leave_type_id) || { name: req.leave_type_id, isPaid: false, badgeClass: "badge-blue", color: "#4f46e5" };
        allRecords.push({
          id: req.id,
          type: "LEAVE",
          leave_type_id: req.leave_type_id,
          typeName: typeDef.name,
          badgeClass: typeDef.badgeClass || "badge-blue",
          typeColor: typeDef.color || "#4f46e5",
          user_id: req.user_id,
          userName: applicant.name,
          userDept: applicant.department_name,
          isPaid: typeDef.isPaid,
          isPaidText: (typeDef.id === "SICK" || req.leave_type_id === "SICK" || typeDef.isPaid === "HALF" || typeDef.payRate === 0.5) ? "支半薪" : (typeDef.isPaid ? "有薪假" : "不支薪"),
          startTime: req.start_time,
          endTime: req.end_time,
          hours: Number(req.total_hours) || 0,
          reason: req.reason || "",
          attachment_url: req.attachment_url || "",
          status: req.status,
          createdAt: req.created_at || req.start_time
        });
      }
    });

    // 加班單轉換 (若 OVERTIME 假別被勾選)
    this.state.overtimes.forEach(ot => {
      const applicant = this.state.users.find(u => u.id === ot.user_id) || { id: ot.user_id, name: ot.user_id, department_name: "--" };
      
      // 權限可視性判定
      let isVisible = false;
      if (isHrOrAdmin) {
        isVisible = true; // 人資與超級管理者看全員
      } else if (isManager) {
        isVisible = (ot.user_id === user.id || applicant.manager_id === user.id);
      } else {
        isVisible = (ot.user_id === user.id);
      }

      if (isVisible) {
        const sTime = `${ot.date} ${LeaveEngine.formatTimeOnly(ot.start_time)}`;
        const eTime = `${ot.date} ${LeaveEngine.formatTimeOnly(ot.end_time)}`;
        allRecords.push({
          id: ot.id,
          type: "OVERTIME",
          leave_type_id: "OVERTIME",
          typeName: `加班 (${ot.comp_rate}x換補休)`,
          badgeClass: "badge-amber",
          typeColor: "#f59e0b",
          user_id: ot.user_id,
          userName: applicant.name,
          userDept: applicant.department_name,
          isPaid: true,
          isPaidText: `換發補休 +${ot.comp_hours}h`,
          startTime: sTime,
          endTime: eTime,
          hours: Number(ot.hours) || 0,
          reason: ot.reason || "",
          attachment_url: "",
          status: ot.status,
          createdAt: ot.created_at || ot.date
        });
      }
    });

    // 4. 多條件過濾
    const filtered = allRecords.filter(item => {
      // 假別多選勾選過濾
      if (checkedTypes.length > 0 && !checkedTypes.includes(item.leave_type_id)) {
        return false;
      }
      if (checkedTypes.length === 0) {
        return false;
      }

      // 部門過濾
      if (deptVal !== "ALL" && item.userDept !== deptVal) {
        return false;
      }

      // 人員過濾
      if (userVal !== "ALL" && item.user_id !== userVal) {
        return false;
      }

      // 狀態過濾
      if (statusVal !== "ALL" && item.status !== statusVal) {
        return false;
      }

      // 日期區間過濾
      const itemStartDate = item.startTime.substring(0, 10);
      const itemEndDate = item.endTime.substring(0, 10);
      if (startDateVal && itemEndDate < startDateVal) {
        return false;
      }
      if (endDateVal && itemStartDate > endDateVal) {
        return false;
      }

      // 關鍵字過濾 (單號、申請人、事由、假別名稱)
      if (keyword) {
        const text = `${item.id} ${item.userName} ${item.userDept} ${item.typeName} ${item.reason}`.toLowerCase();
        if (!text.includes(keyword)) {
          return false;
        }
      }

      return true;
    });

    // 依申請時間/開始時間新到舊排序
    filtered.sort((a, b) => new Date(b.createdAt || b.startTime) - new Date(a.createdAt || a.startTime));
    this.state.lastFilteredHistory = filtered;

    // 5. 更新統計摘要卡片
    const totalCount = filtered.length;
    const totalHours = filtered.reduce((sum, r) => sum + r.hours, 0);
    const approvedHours = filtered.filter(r => r.status === "APPROVED").reduce((sum, r) => sum + r.hours, 0);
    const pendingHours = filtered.filter(r => r.status === "PENDING" || r.status === "CANCEL_PENDING").reduce((sum, r) => sum + r.hours, 0);

    const countEl = document.getElementById("historyStatCount");
    const hoursEl = document.getElementById("historyStatHours");
    const appHoursEl = document.getElementById("historyStatApprovedHours");
    const pendHoursEl = document.getElementById("historyStatPendingHours");

    if (countEl) countEl.textContent = `${totalCount} 筆`;
    if (hoursEl) hoursEl.textContent = `${totalHours.toFixed(1)} h`;
    if (appHoursEl) appHoursEl.textContent = `${approvedHours.toFixed(1)} h`;
    if (pendHoursEl) pendHoursEl.textContent = `${pendingHours.toFixed(1)} h`;

    // 6. 渲染明細清單表格
    const tbody = document.getElementById("historyTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 36px;"><i class="fa-solid fa-inbox" style="font-size: 1.5rem; margin-bottom: 8px; display: block;"></i>查無符合篩選條件的差勤紀錄</td></tr>`;
      return;
    }

    filtered.forEach(item => {
      let statusBadge = "";
      switch (item.status) {
        case "APPROVED":
          statusBadge = `<span class="badge badge-approved"><i class="fa-solid fa-check"></i> 已核准</span>`;
          break;
        case "PENDING":
          statusBadge = `<span class="badge badge-pending"><i class="fa-solid fa-clock"></i> 審核中</span>`;
          break;
        case "REJECTED":
          statusBadge = `<span class="badge badge-rejected"><i class="fa-solid fa-xmark"></i> 已駁回</span>`;
          break;
        case "CANCELLED":
          statusBadge = `<span class="badge badge-slate"><i class="fa-solid fa-ban"></i> 已銷假</span>`;
          break;
        case "CANCEL_PENDING":
          statusBadge = `<span class="badge badge-amber"><i class="fa-solid fa-hourglass-half"></i> 銷假審核中</span>`;
          break;
        default:
          statusBadge = `<span class="badge badge-blue">${item.status}</span>`;
      }

      const isSelf = (item.user_id === user.id);
      let actionHtml = "--";
      if (isSelf && item.type === "LEAVE") {
        if (item.status === "PENDING") {
          actionHtml = `<button class="btn btn-sm btn-secondary" style="color: var(--danger); padding: 3px 8px; font-size: 0.78rem;" onclick="App.handleCancelClick('${item.id}', 'PENDING')"><i class="fa-solid fa-ban"></i> 撤銷</button>`;
        } else if (item.status === "APPROVED") {
          actionHtml = `<button class="btn btn-sm btn-secondary" style="color: var(--primary); padding: 3px 8px; font-size: 0.78rem;" onclick="App.handleCancelClick('${item.id}', 'APPROVED')"><i class="fa-solid fa-arrow-rotate-left"></i> 銷假</button>`;
        }
      }

      const isLink = item.attachment_url && item.attachment_url.indexOf("http") === 0;
      const attachHtml = isLink
        ? `<a href="${item.attachment_url}" target="_blank" style="color: var(--primary); font-size: 0.8rem; text-decoration: underline;"><i class="fa-solid fa-paperclip"></i> 檢視附件</a>`
        : (item.attachment_url ? `<span style="color: var(--text-muted); font-size: 0.78rem;">${item.attachment_url}</span>` : `<span style="color: var(--text-muted); font-size: 0.8rem;">--</span>`);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong style="font-family: 'JetBrains Mono'; font-size: 0.84rem; color: var(--primary);">${item.id}</strong></td>
        <td>
          <strong class="name-cell" style="display: inline-block; min-width: 5.5em; font-size: 0.9rem;">${item.userName}</strong>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${item.userDept} · ${item.user_id}</div>
        </td>
        <td>
          <span class="badge" style="background: ${item.typeColor}18; color: ${item.typeColor}; border: 1px solid ${item.typeColor}40; font-weight: 600;">
            ${item.typeName}
          </span>
        </td>
        <td><span style="font-size: 0.8rem; color: ${(item.isPaidText === '支半薪' || item.isPaid === 'HALF' || item.leave_type_id === 'SICK') ? 'var(--warning)' : (item.isPaid ? 'var(--success)' : 'var(--text-muted)')}; font-weight: 600;">${item.isPaidText}</span></td>
        <td style="font-size: 0.82rem; line-height: 1.4;">
          <strong>${item.startTime}</strong><br>
          <span style="color: var(--text-muted);">至 ${item.endTime}</span>
        </td>
        <td><strong style="font-family: 'JetBrains Mono'; font-size: 0.95rem; color: var(--primary);">${item.hours}</strong> h</td>
        <td style="font-size: 0.82rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.reason}">${item.reason || '--'}</td>
        <td>${attachHtml}</td>
        <td>${statusBadge}</td>
        <td style="font-size: 0.78rem; color: var(--text-muted);">${item.createdAt}</td>
        <td>${actionHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  /**
   * 設定快捷時間區間
   */
  setHistoryPresetRange(preset) {
    const now = new Date();
    const startInput = document.getElementById("historyFilterStartDate");
    const endInput = document.getElementById("historyFilterEndDate");
    if (!startInput || !endInput) return;

    if (preset === "this_month") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      startInput.value = LeaveEngine.formatDateOnly(firstDay);
      endInput.value = LeaveEngine.formatDateOnly(lastDay);
    } else if (preset === "this_year") {
      startInput.value = `${now.getFullYear()}-01-01`;
      endInput.value = `${now.getFullYear()}-12-31`;
    } else if (preset === "last_3_months") {
      const past3m = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      startInput.value = LeaveEngine.formatDateOnly(past3m);
      endInput.value = LeaveEngine.formatDateOnly(now);
    } else if (preset === "all") {
      startInput.value = "";
      endInput.value = "";
    }

    this.applyHistoryFilter();
  },

  /**
   * 重設所有歷史紀錄篩選條件
   */
  resetHistoryFilter() {
    const deptSelect = document.getElementById("historyFilterDept");
    const userSelect = document.getElementById("historyFilterUser");
    const statusSelect = document.getElementById("historyFilterStatus");
    const startInput = document.getElementById("historyFilterStartDate");
    const endInput = document.getElementById("historyFilterEndDate");
    const kwInput = document.getElementById("historyFilterKeyword");

    if (deptSelect) deptSelect.value = "ALL";
    if (userSelect) {
      this.populateHistoryUserSelect();
      userSelect.value = "ALL";
    }
    if (statusSelect) statusSelect.value = "ALL";
    if (startInput) startInput.value = "";
    if (endInput) endInput.value = "";
    if (kwInput) kwInput.value = "";

    this.toggleAllHistoryTypeCheckboxes(true);
    this.showToast("已重設所有篩選條件", "info");
  },

  /**
   * 匯出當前篩選之差勤紀錄為 CSV 報表 (支援 Excel UTF-8 BOM)
   */
  exportHistoryCsv() {
    const list = this.state.lastFilteredHistory || [];
    if (list.length === 0) {
      this.showToast("目前查無符合條件之紀錄可供匯出！", "warning");
      return;
    }

    const headers = ["單號", "申請同仁", "員工編號", "所屬部門", "假別/項目", "薪資給付", "起始時間", "結束時間", "工時(小時)", "申請事由", "審核狀態", "申請時間"];
    const rows = list.map(item => [
      `"${item.id}"`,
      `"${item.userName}"`,
      `"${item.user_id}"`,
      `"${item.userDept}"`,
      `"${item.typeName}"`,
      `"${item.isPaidText}"`,
      `"${item.startTime}"`,
      `"${item.endTime}"`,
      item.hours,
      `"${(item.reason || '').replace(/"/g, '""')}"`,
      `"${item.status}"`,
      `"${item.createdAt}"`
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = LeaveEngine.formatDateOnly(new Date()).replace(/-/g, "");
    link.setAttribute("href", url);
    link.setAttribute("download", `差勤紀錄報表_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    this.showToast(`已成功匯出 ${list.length} 筆差勤紀錄報表！`, "success");
  },

  /**
   * 7. 人事差勤與特休管理 (HR Management) - HR 與最高管理者可存取 (純人事，無任何資料庫設定)
   */
  renderHrManagement() {
    const user = this.state.currentUser;
    const isHrOrAdmin = LeaveEngine.isUserAdmin(user);

    if (!isHrOrAdmin) {
      this.showToast("權限不足：人事差勤專區僅限人事 (HR) 與最高管理者存取！", "error");
      this.navigate("dashboard");
      return;
    }

    // 渲染全員到職日與特休列表
    const tbody = document.getElementById("employeeSeniorityTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const year = SYSTEM_CONFIG.CURRENT_YEAR || 2026;
    const isAdmin = LeaveEngine.isUserAdmin(user);

    this.state.users.forEach(u => {
      const hireDate = u.hire_date ? LeaveEngine.formatDateOnly(u.hire_date) : "2024-03-01";
      const stat = LeaveEngine.calculateStatutoryAnnualLeave(hireDate, year);
      const bal = this.state.balances.find(b => 
        String(b.user_id || "").trim().toUpperCase() === String(u.id || "").trim().toUpperCase() && 
        (b.leave_type_id === "ANNUAL" || b.leave_type_id === "特休" || b.leave_type_id === "特休假") && 
        parseInt(b.year, 10) === parseInt(year, 10)
      );
      const currentBalHours = bal ? bal.total_hours : 0;
      const usedHours = bal ? bal.used_hours : 0;
      const pendingHours = bal ? bal.pending_hours : 0;
      const unusedHours = Math.max(0, currentBalHours - usedHours - pendingHours);
      const isSynced = (currentBalHours === stat.hours);

      const encashmentHtml = unusedHours > 0 
        ? `<span class="badge badge-purple" style="font-size: 0.78rem;" title="勞基法第38條第4項：每年度終結未休天數，雇主應發給工資"><i class="fa-solid fa-coins"></i> 結算抵銷 ${unusedHours}h (${(unusedHours/8).toFixed(1)}天)</span>` 
        : `<span style="color: var(--text-muted); font-size: 0.78rem;"><i class="fa-solid fa-check"></i> 全數休畢</span>`;

      const isSelf = (u.id === user.id);
      const actionHtml = isSelf
        ? `<span style="font-size: 0.78rem; color: var(--text-muted); font-style: italic;"><i class="fa-solid fa-user-shield"></i> 當前登入者</span>`
        : `<button class="btn btn-sm btn-secondary" style="color: var(--danger); padding: 3px 8px; font-size: 0.78rem;" onclick="App.confirmDeleteUser('${u.id}', '${u.name}')" title="刪除員工資料與假別額度">
            <i class="fa-solid fa-trash-can"></i> 刪除
          </button>`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong style="color: var(--primary); font-family: 'JetBrains Mono';">${u.id}</strong></td>
        <td><strong class="name-cell" style="display: inline-block; min-width: 5.5em; white-space: nowrap; font-size: 0.92rem;">${u.name}</strong></td>
        <td>${u.department_name || u.department_id} · <span class="badge badge-blue">${u.role}</span></td>
        <td>
          <input type="date" class="form-control" style="width: 145px; padding: 4px 8px; font-size: 0.85rem;" value="${hireDate}" onchange="App.handleUserHireDateChange('${u.id}', this.value)" ${isAdmin ? '' : 'disabled'}>
        </td>
        <td><span class="badge" style="background: #f1f5f9; color: var(--text-main); font-weight: 600;">${stat.seniorityText || "未滿半年"}</span></td>
        <td><strong style="color: #15803d; font-size: 0.95rem;">${stat.days}</strong> 天</td>
        <td>
          <span class="badge ${isSynced ? 'badge-approved' : 'badge-pending'}" title="${isSynced ? '已完成法定特休同步' : '待同步'}">
            <i class="fa-solid ${isSynced ? 'fa-check' : 'fa-triangle-exclamation'}"></i> ${stat.hours}h
          </span>
        </td>
        <td>${encashmentHtml}</td>
        <td>${actionHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  /**
   * 8. 系統後端與資料庫串接設定 (System Settings) - 嚴格限制僅限最高管理者 Admin
   */
  renderSystemSettings() {
    const user = this.state.currentUser;
    const isSysAdmin = LeaveEngine.isSystemAdmin(user);

    if (!isSysAdmin) {
      this.showToast("權限不足：資料庫後端串接設定僅限最高管理者 (Admin) 配置！", "error");
      this.navigate("dashboard");
      return;
    }

    const gasInput = document.getElementById("settingsGasUrl");
    if (gasInput) {
      gasInput.value = ApiService.getGasUrl();
    }
  },

  /**
   * 相容舊版呼叫
   */
  renderSettings() {
    if (LeaveEngine.isSystemAdmin(this.state.currentUser)) {
      this.renderSystemSettings();
    } else {
      this.renderHrManagement();
    }
  },

  /**
   * 一鍵還原官方預設資料庫路徑 (修復被誤改的資料庫路徑)
   */
  async restoreDefaultGasUrl() {
    if (!LeaveEngine.isSystemAdmin(this.state.currentUser)) {
      this.showToast("權限不足：僅限最高管理者 (Admin) 可重設資料庫路徑！", "error");
      return;
    }
    const defaultUrl = ApiService.resetToDefaultGasUrl();
    const gasInput = document.getElementById("settingsGasUrl");
    if (gasInput) gasInput.value = defaultUrl;
    this.showToast("已成功重設為官方預設 Google Sheet 資料庫路徑！正在連線測試...", "info");
    
    const testRes = await ApiService.testGasConnection(defaultUrl);
    if (testRes.success) {
      this.showToast("Google Sheet 雲端連線測試成功！已還原預設資料庫！", "success");
      await this.loadData();
      this.renderHeader();
    } else {
      this.showToast(testRes.message, "error");
    }
  },

  confirmDeleteUser(userId, userName) {
    this.state.activeDeleteUserId = userId;
    const promptEl = document.getElementById("deleteUserPrompt");
    if (promptEl) {
      promptEl.innerHTML = `您確定要將員工 <strong>${userName} (${userId})</strong> 從系統與試算表中刪除嗎？<br>刪除後將一併清除該同仁之所有特休與假別額度紀錄。`;
    }
    const modal = document.getElementById("deleteUserModal");
    if (modal) modal.classList.add("active");
  },

  async executeDeleteUser() {
    if (this.state.isSubmitting) return;
    const userId = this.state.activeDeleteUserId;
    if (!userId) return;

    const btn = document.getElementById("btnConfirmDeleteUser");
    this.state.isSubmitting = true;
    if (btn) {
      btn.disabled = true;
      btn.classList.add("btn-loading");
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 刪除中...`;
    }

    this.showToast(`正在刪除員工 ${userId}...`, "info");
    try {
      const res = await ApiService.callApi("adminDeleteUser", { id: userId });
      if (res.success) {
        this.showToast(res.message, "success");
        this.closeModal("deleteUserModal");
        this.state.activeDeleteUserId = null;
        await this.loadData();
        this.renderSettings();
        this.renderDashboard();
      } else {
        this.showToast(res.message, "error");
      }
    } catch (err) {
      console.error("刪除員工例外:", err);
      this.showToast("刪除員工失敗：" + (err.message || "網路異常"), "error");
    } finally {
      this.state.isSubmitting = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("btn-loading");
        btn.innerHTML = `<i class="fa-solid fa-trash-can"></i> 確認刪除`;
      }
    }
  },

  async handleUserHireDateChange(userId, newHireDate) {
    this.showToast(`正在更新員工 ${userId} 到職日並重算特休...`, "info");
    const res = await ApiService.callApi("adminUpdateUser", { id: userId, hire_date: newHireDate });
    if (res.success) {
      this.showToast(res.message, "success");
      await this.loadData();
      this.renderSettings();
      this.renderDashboard();
    } else {
      this.showToast(res.message, "error");
    }
  },

  openAddUserModal() {
    const modal = document.getElementById("addUserModal");
    if (!modal) return;
    document.getElementById("newUserName").value = "";
    document.getElementById("newUserId").value = "";
    document.getElementById("newUserEmail").value = "";
    document.getElementById("newUserHireDate").value = LeaveEngine.formatDateOnly(new Date());
    document.getElementById("newUserPassword").value = "123456";

    // 動態由 Google Sheet (this.state.users) 載入實際存在之同仁名冊，並 100% 呈現其在 Sheet 中的真實 role 角色
    const mgrSelect = document.getElementById("newUserManager");
    if (mgrSelect) {
      mgrSelect.innerHTML = `<option value="">-- 無直屬主管 (最高主管/自簽) --</option>`;
      if (this.state.users && this.state.users.length > 0) {
        this.state.users.forEach(u => {
          const deptName = u.department_name || u.department_id || "未設部門";
          const rawRole = (u.role || "Employee").toString().trim();
          const lowerRole = rawRole.toLowerCase();
          let roleDisplay = rawRole;
          if (lowerRole === "admin" || lowerRole === "管理者" || lowerRole === "管理員" || lowerRole === "超級管理員") {
            roleDisplay = "最高管理者 (Admin)";
          } else if (lowerRole === "hr" || lowerRole === "人資" || lowerRole === "人事") {
            roleDisplay = "人事管理 (HR)";
          } else if (lowerRole === "manager" || lowerRole === "主管" || lowerRole === "部門主管") {
            roleDisplay = "部門主管 (Manager)";
          } else if (lowerRole === "employee" || lowerRole === "一般同仁" || lowerRole === "員工") {
            roleDisplay = "一般同仁 (Employee)";
          }
          mgrSelect.innerHTML += `<option value="${u.id}">${u.name} (${deptName} · ${u.id}) [${roleDisplay}]</option>`;
        });
      }
    }

    this.previewNewUserAnnualLeave();
    modal.classList.add("active");
  },

  previewNewUserAnnualLeave() {
    const hireDate = document.getElementById("newUserHireDate").value;
    const previewEl = document.getElementById("newUserAnnualPreview");
    if (!hireDate) {
      if (previewEl) previewEl.textContent = "請選擇到職日，系統將依勞基法第38條施行細則第24條之1【歷年制】自動核算特休額度...";
      return;
    }
    const stat = LeaveEngine.calculateStatutoryAnnualLeave(hireDate, SYSTEM_CONFIG.CURRENT_YEAR);
    if (previewEl) {
      previewEl.innerHTML = `<strong>勞基法【歷年制】核算法定特休：</strong>年資 ${stat.seniorityText || "0"}，${stat.tierDesc}，核發 <strong style="color: #15803d;">${stat.days} 天 (${stat.hours} 小時)</strong> 特別休假，將自動建立 ANNUAL 額度。`;
    }
  },

  async handleAddUserSubmit(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (this.state.isSubmitting) return;

    const name = document.getElementById("newUserName").value.trim();
    const id = document.getElementById("newUserId").value.trim();
    const email = document.getElementById("newUserEmail").value.trim();
    const department_name = document.getElementById("newUserDept").value;
    const manager_id = document.getElementById("newUserManager").value;
    const role = document.getElementById("newUserRole").value;
    const hire_date = document.getElementById("newUserHireDate").value;
    const password = document.getElementById("newUserPassword").value.trim() || "123456";
    const btn = document.getElementById("btnSubmitAddUser");

    this.state.isSubmitting = true;
    if (btn) {
      btn.disabled = true;
      btn.classList.add("btn-loading");
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 建立中...`;
    }

    this.showToast(`正在建立員工 ${name} 並初始化假別額度...`, "info");

    try {
      const res = await ApiService.callApi("adminCreateUser", {
        id,
        name,
        email,
        department_name,
        manager_id,
        role,
        hire_date,
        password
      });

      if (res.success) {
        this.showToast(res.message, "success");
        this.closeModal("addUserModal");
        await this.loadData();
        this.renderSettings();
        this.renderDashboard();
      } else {
        this.showToast(res.message, "error");
      }
    } catch (err) {
      console.error("建立員工例外:", err);
      this.showToast("建立員工失敗：" + (err.message || "網路異常"), "error");
    } finally {
      this.state.isSubmitting = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("btn-loading");
        btn.innerHTML = `<i class="fa-solid fa-check"></i> 確認建立員工與額度`;
      }
    }
  },

  async syncAllAnnualLeaves() {
    this.showToast("正在同步全體員工法定特休至 Google Sheet...", "info");
    const res = await ApiService.callApi("syncStatutoryAnnualLeaves");
    if (res.success) {
      this.showToast(res.message || "法定特休額度已全數同步至 leave_balances 表！", "success");
      await this.loadData();
      this.renderSettings();
      this.renderDashboard();
    } else {
      this.showToast(res.message || "同步失敗，請確認連線", "error");
    }
  },

  async syncHolidays() {
    this.showToast("正在同步 2026-2030 國定假日至 Google Sheet / 資料庫...", "info");
    const res = await ApiService.callApi("syncHolidays");
    if (res.success) {
      this.showToast(res.message || "2026-2030 國定假日已全數同步至 holidays 分頁！", "success");
      await this.loadData();
      this.renderCalendar();
    } else {
      this.showToast(res.message || "同步失敗，請確認連線", "error");
    }
  },

  async saveGasSettings() {
    if (!LeaveEngine.isSystemAdmin(this.state.currentUser)) {
      this.showToast("權限不足：Google Sheet 後端串接設定僅限最高管理者 (Admin) 配置！", "error");
      return;
    }

    const url = document.getElementById("settingsGasUrl").value.trim();
    if (!url) {
      this.showToast("請輸入 Google Apps Script 網址！", "error");
      return;
    }
    ApiService.setGasUrl(url);
    ApiService.setUseRemoteGas(true);
    this.showToast("設定已儲存！正在測試連線...", "info");

    const testRes = await ApiService.testGasConnection(url);
    if (testRes.success) {
      this.showToast("Google Sheet 雲端連線成功！", "success");
      await this.loadData();
      this.renderHeader();
      this.navigate("dashboard");
    } else {
      this.showToast(testRes.message, "error");
      ApiService.setUseRemoteGas(false);
      this.renderHeader();
    }
  },

  async testGasConnection() {
    if (!LeaveEngine.isSystemAdmin(this.state.currentUser)) {
      this.showToast("權限不足：Google Sheet 後端串接設定僅限最高管理者 (Admin) 配置！", "error");
      return;
    }

    const url = document.getElementById("settingsGasUrl").value.trim();
    this.showToast("連線測試中...", "info");
    const testRes = await ApiService.testGasConnection(url);
    if (testRes.success) {
      this.showToast("連線成功！Google Apps Script 後端回應正常。", "success");
    } else {
      this.showToast(testRes.message, "error");
    }
  },

  switchToMockMode() {
    if (!LeaveEngine.isSystemAdmin(this.state.currentUser)) {
      this.showToast("權限不足：Google Sheet 後端串接設定僅限最高管理者 (Admin) 配置！", "error");
      return;
    }

    ApiService.setUseRemoteGas(false);
    this.showToast("已切換為【本機展示資料庫模式】", "success");
    this.renderHeader();
    this.navigate("dashboard");
  },

  resetDatabase() {
    if (confirm("確定要重設本機資料庫嗎？所有自訂請假與加班單將還原至初始範例。")) {
      ApiService.resetMockData();
      this.showToast("本機資料庫已成功重設！", "success");
      this.loadData().then(() => this.navigate("dashboard"));
    }
  },

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add("active");
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove("active");
  },

  openChangePasswordModal() {
    const modal = document.getElementById("changePasswordModal");
    if (!modal) return;
    document.getElementById("oldPasswordInput").value = "";
    document.getElementById("newPasswordInput").value = "";
    document.getElementById("confirmPasswordInput").value = "";
    const errEl = document.getElementById("passwordMismatchError");
    if (errEl) errEl.style.display = "none";
    modal.classList.add("active");
  },

  async handleChangePasswordSubmit(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (this.state.isSubmitting) return;

    const user = this.state.currentUser;
    if (!user) {
      this.showToast("請先登入系統！", "error");
      return;
    }

    const oldPassword = document.getElementById("oldPasswordInput").value.trim();
    const newPassword = document.getElementById("newPasswordInput").value.trim();
    const confirmPassword = document.getElementById("confirmPasswordInput").value.trim();
    const errEl = document.getElementById("passwordMismatchError");
    const btn = document.getElementById("btnSubmitChangePassword");

    if (newPassword !== confirmPassword) {
      if (errEl) errEl.style.display = "block";
      return;
    }
    if (errEl) errEl.style.display = "none";

    if (oldPassword === newPassword) {
      this.showToast("新密碼不可與目前密碼相同！", "warning");
      return;
    }

    this.state.isSubmitting = true;
    if (btn) {
      btn.disabled = true;
      btn.classList.add("btn-loading");
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 儲存中...`;
    }

    this.showToast("正在更新個人密碼...", "info");
    try {
      const res = await ApiService.callApi("changePassword", {
        userId: user.id,
        oldPassword,
        newPassword
      });

      if (res.success) {
        this.showToast(res.message || "密碼修改成功！", "success");
        this.closeModal("changePasswordModal");
      } else {
        this.showToast(res.message || "密碼修改失敗", "error");
      }
    } catch (err) {
      console.error("修改密碼例外:", err);
      this.showToast("密碼修改失敗：" + (err.message || "網路異常"), "error");
    } finally {
      this.state.isSubmitting = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("btn-loading");
        btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> 儲存新密碼`;
      }
    }
  },

  /**
   * 工具：狀態標籤 HTML
   */
  getStatusBadgeHtml(status, step) {
    switch (status) {
      case "PENDING":
        return step === "HR" 
          ? `<span class="badge badge-pending"><i class="fa-solid fa-hourglass-half"></i> HR 複核中</span>` 
          : `<span class="badge badge-pending"><i class="fa-solid fa-hourglass-half"></i> 主管審核中</span>`;
      case "APPROVED":
        return `<span class="badge badge-approved"><i class="fa-solid fa-circle-check"></i> 已核准</span>`;
      case "REJECTED":
        return `<span class="badge badge-rejected"><i class="fa-solid fa-circle-xmark"></i> 已退回</span>`;
      case "CANCELLED":
        return `<span class="badge badge-cancelled"><i class="fa-solid fa-ban"></i> 已撤銷</span>`;
      case "CANCEL_PENDING":
        return `<span class="badge badge-cancel-pending"><i class="fa-solid fa-rotate-left"></i> 銷假審核中</span>`;
      case "CANCEL_APPROVED":
        return `<span class="badge badge-slate"><i class="fa-solid fa-check-double"></i> 銷假完成 (已退額)</span>`;
      default:
        return `<span class="badge badge-slate">${status}</span>`;
    }
  },

  /**
   * 工具：主管警示橫幅與導航 Badge 計算
   */
  checkManagerAlert() {
    const user = this.state.currentUser;
    const isManager = LeaveEngine.isUserManager(user);
    const isAdmin = LeaveEngine.isUserAdmin(user);

    let count = 0;
    this.state.requests.forEach(r => {
      const applicant = this.state.users.find(u => u.id === r.user_id);
      const isSelf = (r.user_id === user.id);
      const isSelfManager = (applicant && (applicant.manager_id === user.id || !applicant.manager_id));
      if (isSelf && !isSelfManager && !isAdmin) return;

      if (r.status === "PENDING") {
        if (r.current_step === "MANAGER" && ((applicant && (applicant.manager_id === user.id || (isSelf && isSelfManager))) || isAdmin)) count++;
        if (r.current_step === "HR" && isAdmin) count++;
      } else if (r.status === "CANCEL_PENDING") {
        if ((applicant && (applicant.manager_id === user.id || (isSelf && isSelfManager))) || isAdmin) count++;
      }
    });

    this.state.overtimes.forEach(o => {
      const applicant = this.state.users.find(u => u.id === o.user_id);
      const isSelf = (o.user_id === user.id);
      const isSelfManager = (applicant && (applicant.manager_id === user.id || !applicant.manager_id));
      if (isSelf && !isSelfManager && !isAdmin) return;

      if (o.status === "PENDING") {
        if ((applicant && (applicant.manager_id === user.id || (isSelf && isSelfManager))) || isAdmin) count++;
      }
    });

    const banner = document.getElementById("managerAlertBanner");
    if ((isManager || isAdmin) && count > 0) {
      banner.style.display = "flex";
      document.getElementById("bannerPendingCount").textContent = count;
    } else {
      banner.style.display = "none";
    }
  },

  updatePendingBadges() {
    const user = this.state.currentUser;
    const isManager = LeaveEngine.isUserManager(user);
    const isAdmin = LeaveEngine.isUserAdmin(user);

    let count = 0;
    this.state.requests.forEach(r => {
      const applicant = this.state.users.find(u => u.id === r.user_id);
      const isSelf = (r.user_id === user.id);
      const isSelfManager = (applicant && (applicant.manager_id === user.id || !applicant.manager_id));
      if (isSelf && !isSelfManager && !isAdmin) return;

      if (r.status === "PENDING") {
        if (r.current_step === "MANAGER" && ((applicant && (applicant.manager_id === user.id || (isSelf && isSelfManager))) || isAdmin)) count++;
        if (r.current_step === "HR" && isAdmin) count++;
      } else if (r.status === "CANCEL_PENDING") {
        if ((applicant && (applicant.manager_id === user.id || (isSelf && isSelfManager))) || isAdmin) count++;
      }
    });

    this.state.overtimes.forEach(o => {
      const applicant = this.state.users.find(u => u.id === o.user_id);
      const isSelf = (o.user_id === user.id);
      const isSelfManager = (applicant && (applicant.manager_id === user.id || !applicant.manager_id));
      if (isSelf && !isSelfManager && !isAdmin) return;

      if (o.status === "PENDING") {
        if ((applicant && (applicant.manager_id === user.id || (isSelf && isSelfManager))) || isAdmin) count++;
      }
    });

    const badge = document.getElementById("pendingApprovalBadge");
    if ((isManager || isAdmin) && count > 0) {
      badge.style.display = "inline-block";
      badge.textContent = count;
    } else {
      badge.style.display = "none";
    }

    // 人事差勤維護選單：HR 與最高管理者 (Admin) 顯示
    const navHrManagement = document.getElementById("navHrManagement");
    if (navHrManagement) {
      navHrManagement.style.display = LeaveEngine.isUserAdmin(user) ? "flex" : "none";
    }

    // 資料庫串接設定選單：嚴格僅最高管理者 (Admin) 顯示，HR 完全隱藏
    const navSystemSettings = document.getElementById("navSystemSettings");
    if (navSystemSettings) {
      navSystemSettings.style.display = LeaveEngine.isSystemAdmin(user) ? "flex" : "none";
    }

    // 側欄底部設定按鈕：僅最高管理者 (Admin) 顯示，HR 完全隱藏
    const sidebarSettingsBtn = document.getElementById("sidebarSettingsBtn");
    if (sidebarSettingsBtn) {
      sidebarSettingsBtn.style.display = LeaveEngine.isSystemAdmin(user) ? "inline-flex" : "none";
    }
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove("active");
  },

  /**
   * Toast 輕量提示
   */
  showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    let icon = "fa-circle-info";
    if (type === "success") icon = "fa-circle-check";
    if (type === "error") icon = "fa-circle-exclamation";

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(30px)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  }
};

// 導出至 window 以利主控台除錯與自動化測試
window.App = App;

// 視窗載入完成後啟動
window.addEventListener("DOMContentLoaded", () => {
  App.init();
});
