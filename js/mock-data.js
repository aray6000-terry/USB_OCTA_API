/**
 * 本機模擬資料庫引擎 (Mock Database Engine)
 * 當未連接線上 Google Sheet 或離線展示時提供完整零延遲的資料庫運作與持久化
 */
// 本機展示模式專用之假密碼 (非真實帳密，僅供離線 Demo 登入)
const DEMO_PASSWORD_PLACEHOLDER = "demo-only-not-a-real-password";
// 種子資料版本：變更種子內容 (例如移除個資) 時遞增，舊版 localStorage 資料會自動重置
const MOCK_SEED_VERSION = 2;

const MockDataEngine = {
  getInitialState() {
    return {
      _seedVersion: MOCK_SEED_VERSION,
      users: [
        {
          id: "EMP001",
          name: "李泰叡",
          email: "emp001@example.com",
          password_hash: DEMO_PASSWORD_PLACEHOLDER,
          department_id: "DEPT_MGMT",
          department_name: "管理部",
          manager_id: "EMP001",
          role: "Admin",
          hire_date: "2018-04-16",
          created_at: "2026-01-01 09:00:00"
        },
        {
          id: "EMP002",
          name: "陳勃毅",
          email: "emp002@example.com",
          password_hash: DEMO_PASSWORD_PLACEHOLDER,
          department_id: "DEPT_RD",
          department_name: "研發部",
          manager_id: "EMP001",
          role: "Employee",
          hire_date: "2023-08-07",
          created_at: "2026-01-01 09:00:00"
        },
        {
          id: "EMP003",
          name: "何貫宇",
          email: "emp003@example.com",
          password_hash: DEMO_PASSWORD_PLACEHOLDER,
          department_id: "DEPT_SALES",
          department_name: "業務部",
          manager_id: "EMP001",
          role: "Employee",
          hire_date: "2024-02-26",
          created_at: "2026-01-01 09:00:00"
        },
        {
          id: "EMP004",
          name: "劉彩雲",
          email: "emp004@example.com",
          password_hash: DEMO_PASSWORD_PLACEHOLDER,
          department_id: "DEPT_HR",
          department_name: "人資部",
          manager_id: "EMP001",
          role: "HR",
          hire_date: "2024-03-18",
          created_at: "2026-01-01 09:00:00"
        },
        {
          id: "EMP005",
          name: "廖國寓",
          email: "emp005@example.com",
          password_hash: DEMO_PASSWORD_PLACEHOLDER,
          department_id: "DEPT_RD",
          department_name: "研發部",
          manager_id: "EMP001",
          role: "Employee",
          hire_date: "2024-10-21",
          created_at: "2026-01-01 09:00:00"
        },
        {
          id: "EMP006",
          name: "何瑋恩",
          email: "emp006@example.com",
          password_hash: DEMO_PASSWORD_PLACEHOLDER,
          department_id: "DEPT_RD",
          department_name: "研發部",
          manager_id: "EMP001",
          role: "Employee",
          hire_date: "2025-03-04",
          created_at: "2026-01-01 09:00:00"
        },
        {
          id: "EMP007",
          name: "簡昕儀",
          email: "emp007@example.com",
          password_hash: DEMO_PASSWORD_PLACEHOLDER,
          department_id: "DEPT_RD",
          department_name: "研發部",
          manager_id: "EMP001",
          role: "Employee",
          hire_date: "2025-05-05",
          created_at: "2026-01-01 09:00:00"
        },
        {
          id: "EMP008",
          name: "江嘉偉",
          email: "emp008@example.com",
          password_hash: DEMO_PASSWORD_PLACEHOLDER,
          department_id: "DEPT_RD",
          department_name: "研發部",
          manager_id: "EMP001",
          role: "Employee",
          hire_date: "2025-07-23",
          created_at: "2026-01-01 09:00:00"
        },
        {
          id: "EMP009",
          name: "徐堉桉",
          email: "emp009@example.com",
          password_hash: DEMO_PASSWORD_PLACEHOLDER,
          department_id: "DEPT_RD",
          department_name: "研發部",
          manager_id: "EMP001",
          role: "Employee",
          hire_date: "2025-08-01",
          created_at: "2026-01-01 09:00:00"
        },
        {
          id: "EMP010",
          name: "侯凱嚴",
          email: "emp010@example.com",
          password_hash: DEMO_PASSWORD_PLACEHOLDER,
          department_id: "DEPT_RD",
          department_name: "研發部",
          manager_id: "EMP001",
          role: "Employee",
          hire_date: "2026-01-12",
          created_at: "2026-01-01 09:00:00"
        },
        {
          id: "EMP011",
          name: "傅秉和",
          email: "emp011@example.com",
          password_hash: DEMO_PASSWORD_PLACEHOLDER,
          department_id: "DEPT_RD",
          department_name: "研發部",
          manager_id: "EMP001",
          role: "Employee",
          hire_date: "2026-01-12",
          created_at: "2026-01-01 09:00:00"
        },
        {
          id: "EMP012",
          name: "蔡倢羚",
          email: "emp012@example.com",
          password_hash: DEMO_PASSWORD_PLACEHOLDER,
          department_id: "DEPT_MGMT",
          department_name: "管理部",
          manager_id: "EMP001",
          role: "Employee",
          hire_date: "2026-03-16",
          created_at: "2026-01-01 09:00:00"
        }
      ],

      leaveTypes: SYSTEM_CONFIG.LEAVE_TYPES.map(t => ({
        id: t.id,
        name: t.name,
        min_unit: t.minUnit,
        requires_attachment: t.requiresAttachment,
        is_paid: t.isPaid,
        description: t.description
      })),

      balances: [
        // 王小明 EMP001 (預設登入員工)
        { id: "BAL_EMP001_ANNUAL_2026", user_id: "EMP001", leave_type_id: "ANNUAL", year: 2026, total_hours: 56.0, used_hours: 8.0, pending_hours: 0.0 },
        { id: "BAL_EMP001_COMP_2026", user_id: "EMP001", leave_type_id: "COMP", year: 2026, total_hours: 16.0, used_hours: 0.0, pending_hours: 0.0 },
        { id: "BAL_EMP001_PERSONAL_2026", user_id: "EMP001", leave_type_id: "PERSONAL", year: 2026, total_hours: 112.0, used_hours: 0.0, pending_hours: 0.0 },
        { id: "BAL_EMP001_SICK_2026", user_id: "EMP001", leave_type_id: "SICK", year: 2026, total_hours: 240.0, used_hours: 3.5, pending_hours: 0.0 },
        { id: "BAL_EMP001_MARRIAGE_2026", user_id: "EMP001", leave_type_id: "MARRIAGE", year: 2026, total_hours: 64.0, used_hours: 0.0, pending_hours: 0.0 },
        { id: "BAL_EMP001_MENSTRUAL_2026", user_id: "EMP001", leave_type_id: "MENSTRUAL", year: 2026, total_hours: 48.0, used_hours: 0.0, pending_hours: 0.0 },
        
        // 陳主管 EMP002
        { id: "BAL_EMP002_ANNUAL_2026", user_id: "EMP002", leave_type_id: "ANNUAL", year: 2026, total_hours: 80.0, used_hours: 16.0, pending_hours: 0.0 },
        { id: "BAL_EMP002_COMP_2026", user_id: "EMP002", leave_type_id: "COMP", year: 2026, total_hours: 24.0, used_hours: 8.0, pending_hours: 0.0 },
        { id: "BAL_EMP002_PERSONAL_2026", user_id: "EMP002", leave_type_id: "PERSONAL", year: 2026, total_hours: 112.0, used_hours: 0.0, pending_hours: 0.0 },
        { id: "BAL_EMP002_SICK_2026", user_id: "EMP002", leave_type_id: "SICK", year: 2026, total_hours: 240.0, used_hours: 0.0, pending_hours: 0.0 },

        // 林經理 EMP003
        { id: "BAL_EMP003_ANNUAL_2026", user_id: "EMP003", leave_type_id: "ANNUAL", year: 2026, total_hours: 120.0, used_hours: 0.0, pending_hours: 0.0 },
        { id: "BAL_EMP003_COMP_2026", user_id: "EMP003", leave_type_id: "COMP", year: 2026, total_hours: 8.0, used_hours: 0.0, pending_hours: 0.0 },
        { id: "BAL_EMP003_PERSONAL_2026", user_id: "EMP003", leave_type_id: "PERSONAL", year: 2026, total_hours: 112.0, used_hours: 0.0, pending_hours: 0.0 },
        { id: "BAL_EMP003_SICK_2026", user_id: "EMP003", leave_type_id: "SICK", year: 2026, total_hours: 240.0, used_hours: 0.0, pending_hours: 0.0 }
      ],

      requests: [
        {
          id: "REQ-20260815-001",
          user_id: "EMP001",
          leave_type_id: "ANNUAL",
          start_time: "2026-08-15 08:30",
          end_time: "2026-08-15 18:00",
          total_hours: 8.0,
          reason: "家庭旅遊休假",
          attachment_url: "",
          status: "APPROVED",
          current_step: "COMPLETED",
          applied_at: "2026-08-10 10:00:00"
        },
        {
          id: "REQ-20260820-002",
          user_id: "EMP001",
          leave_type_id: "SICK",
          start_time: "2026-08-20 08:30",
          end_time: "2026-08-20 12:00",
          total_hours: 3.5,
          reason: "急性腸胃炎就醫休養",
          attachment_url: "https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=500&auto=format&fit=crop&q=60",
          status: "APPROVED",
          current_step: "COMPLETED",
          applied_at: "2026-08-19 18:00:00"
        },
        {
          id: "REQ-20260905-003",
          user_id: "EMP004",
          leave_type_id: "ANNUAL",
          start_time: "2026-09-08 08:30",
          end_time: "2026-09-11 18:00",
          total_hours: 32.0, // 4 天 (> 3天，觸發主管+HR雙階簽核範例)
          reason: "個人出國旅遊規劃",
          attachment_url: "",
          status: "PENDING",
          current_step: "MANAGER",
          applied_at: "2026-09-01 09:15:00"
        },
        {
          id: "REQ-20260910-004",
          user_id: "EMP005",
          leave_type_id: "PERSONAL",
          start_time: "2026-09-10 13:30",
          end_time: "2026-09-10 18:00",
          total_hours: 4.5,
          reason: "辦理戶政個人事宜",
          attachment_url: "",
          status: "PENDING",
          current_step: "MANAGER",
          applied_at: "2026-09-01 10:30:00"
        }
      ],

      overtimes: [
        {
          id: "OT-20260810-001",
          user_id: "EMP001",
          date: "2026-08-10",
          start_time: "18:30",
          end_time: "21:30",
          hours: 3.0,
          comp_rate: 1.34,
          comp_hours: 4.0,
          reason: "Q3 核心模組上線緊急支援",
          status: "APPROVED",
          expiry_date: "2027-08-10",
          applied_at: "2026-08-10 21:30:00"
        },
        {
          id: "OT-20260828-002",
          user_id: "EMP001",
          date: "2026-08-28",
          start_time: "18:30",
          end_time: "22:30",
          hours: 4.0,
          comp_rate: 1.34,
          comp_hours: 5.4,
          reason: "系統年度資安滲透演練測試",
          status: "PENDING",
          expiry_date: "2027-08-28",
          applied_at: "2026-08-28 22:30:00"
        }
      ],

      logs: [
        {
          id: "LOG-001",
          request_id: "REQ-20260815-001",
          request_type: "LEAVE",
          approver_id: "EMP002",
          approver_role: "Direct Manager",
          status: "APPROVED",
          comment: "准假，請交接好事項",
          acted_at: "2026-08-10 11:30:00"
        },
        {
          id: "LOG-002",
          request_id: "REQ-20260820-002",
          request_type: "LEAVE",
          approver_id: "EMP002",
          approver_role: "Direct Manager",
          status: "APPROVED",
          comment: "多加休息，早日康復",
          acted_at: "2026-08-19 18:30:00"
        },
        {
          id: "LOG-003",
          request_id: "OT-20260810-001",
          request_type: "OVERTIME",
          approver_id: "EMP002",
          approver_role: "Direct Manager",
          status: "APPROVED",
          comment: "專案表現優異，核發補休額度 4.0 小時",
          acted_at: "2026-08-11 09:00:00"
        }
      ],

      holidays: SYSTEM_CONFIG.DEFAULT_HOLIDAYS
    };
  },

  load() {
    try {
      const stored = localStorage.getItem(SYSTEM_CONFIG.STORAGE_KEYS.APP_STATE);
      if (stored) {
        const parsed = JSON.parse(stored);
        // 舊版本機資料曾含真實員工信箱與明文預設密碼：版本不符即整份重置為去識別化之展示資料
        if (parsed._seedVersion !== MOCK_SEED_VERSION) {
          const initial = this.getInitialState();
          this.save(initial);
          return initial;
        }
        // 自動同步最新 2026-2030 國定假日清單
        if (!parsed.holidays || parsed.holidays.length < SYSTEM_CONFIG.DEFAULT_HOLIDAYS.length) {
          parsed.holidays = SYSTEM_CONFIG.DEFAULT_HOLIDAYS;
          this.save(parsed);
        }
        return parsed;
      }
    } catch (e) {
      console.warn("無法讀取 LocalStorage 狀態，使用預設資料庫：", e);
    }
    const initial = this.getInitialState();
    this.save(initial);
    return initial;
  },

  save(state) {
    try {
      localStorage.setItem(SYSTEM_CONFIG.STORAGE_KEYS.APP_STATE, JSON.stringify(state));
    } catch (e) {
      console.error("儲存 LocalStorage 失敗：", e);
    }
  },

  reset() {
    const initial = this.getInitialState();
    this.save(initial);
    return initial;
  }
};
