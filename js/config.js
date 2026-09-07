/**
 * 系統全域設定與假別規則 (System Configuration)
 */
const SYSTEM_CONFIG = {
  // 標準工時設定 (08:30 - 18:00，午休 12:00 - 13:30 扣 1.5h，每日標準工時 8h)
  WORK_START: "08:30",
  WORK_END: "18:00",
  LUNCH_START: "12:00",
  LUNCH_END: "13:30",
  DAILY_WORK_HOURS: 8.0,
  MORNING_WORK_HOURS: 3.5, // 08:30 ~ 12:00
  AFTERNOON_WORK_HOURS: 4.5, // 13:30 ~ 18:00
  
  // 多階審核門檻：申請時數超過 24 小時 (3 天) 需進入 HR 雙簽
  MULTI_TIER_THRESHOLD_HOURS: 24.0,

  // 預設年份
  CURRENT_YEAR: 2026,

  // 預設 Google Apps Script 佈署網址
  DEFAULT_GAS_URL: "https://script.google.com/macros/s/AKfycbxBrJVcUkoUab5PrZIR9KYCwMTswNNq8JI9ZXE32u5nHZkTcmQC9Ms-QW4F1HaJollrow/exec",

  // LocalStorage Keys
  STORAGE_KEYS: {
    APP_STATE: "LEAVE_SYS_STATE_V1",
    GAS_URL: "LEAVE_SYS_GAS_URL_V1",
    ACTIVE_USER_ID: "LEAVE_SYS_ACTIVE_USER_ID_V1",
    USE_REMOTE_GAS: "LEAVE_SYS_USE_REMOTE_GAS_V1",
    SESSION_LOGGED_IN: "LEAVE_SYS_LOGGED_IN_V1",
    AUTH_TOKEN: "LEAVE_SYS_AUTH_TOKEN_V1"
  },

  // 公司標準 8 大部門清單
  DEPARTMENTS: [
    { id: "DEPT_RD", name: "研發部" },
    { id: "DEPT_DESIGN", name: "設計部" },
    { id: "DEPT_MGMT", name: "管理部" },
    { id: "DEPT_SALES", name: "業務部" },
    { id: "DEPT_ENG", name: "工程部" },
    { id: "DEPT_FIN", name: "財務部" },
    { id: "DEPT_MAINT", name: "維修部" },
    { id: "DEPT_HR", name: "人資部" }
  ],

  // 假別定義與屬性設定
  LEAVE_TYPES: [
    {
      id: "ANNUAL",
      name: "特休假",
      minUnit: 0.5,
      requiresAttachment: false,
      isPaid: true,
      color: "#2563eb",
      badgeClass: "badge-blue",
      description: "法定有薪特別休假，以 0.5 小時為最小單位"
    },
    {
      id: "COMP",
      name: "補休假",
      minUnit: 0.5,
      requiresAttachment: false,
      isPaid: true,
      color: "#059669",
      badgeClass: "badge-emerald",
      description: "加班申報核准後換算之補休時數，以 0.5 小時為單位"
    },
    {
      id: "PERSONAL",
      name: "事假",
      minUnit: 0.5,
      requiresAttachment: false,
      isPaid: false,
      color: "#d97706",
      badgeClass: "badge-amber",
      description: "因個人私事請假，不支薪，以 0.5 小時為單位"
    },
    {
      id: "SICK",
      name: "病假",
      minUnit: 0.5,
      requiresAttachment: false,
      isPaid: "HALF",
      payRate: 0.5,
      paidText: "支半薪",
      color: "#e11d48",
      badgeClass: "badge-rose",
      description: "普通傷病假，一年內未超過三十日部分，工資折半發給 (支半薪)，不強制檢附證明文件"
    },
    {
      id: "MARRIAGE",
      name: "婚假",
      minUnit: 8.0,
      requiresAttachment: true,
      isPaid: true,
      color: "#db2777",
      badgeClass: "badge-pink",
      description: "結婚給予婚假8日，工資照給，以全天(8h)為單位，需附結婚證明"
    },
    {
      id: "BEREAVEMENT",
      name: "喪假",
      minUnit: 8.0,
      requiresAttachment: true,
      isPaid: true,
      color: "#475569",
      badgeClass: "badge-slate",
      description: "親屬喪葬依勞基法規定給予，工資照給，以全天(8h)為單位"
    },
    {
      id: "MENSTRUAL",
      name: "生理假",
      minUnit: 4.0,
      requiresAttachment: false,
      isPaid: false,
      color: "#9333ea",
      badgeClass: "badge-purple",
      description: "女性同仁每月得請生理假一日，不支薪，以半天(4h)為單位"
    },
    {
      id: "MATERNITY",
      name: "產假",
      minUnit: 8.0,
      requiresAttachment: true,
      isPaid: true,
      color: "#ec4899",
      badgeClass: "badge-pink",
      description: "女性員工分娩給予產假8星期，工資照給，需附出生證明"
    },
    {
      id: "PATERNITY",
      name: "陪產假",
      minUnit: 4.0,
      requiresAttachment: true,
      isPaid: true,
      color: "#0284c7",
      badgeClass: "badge-blue",
      description: "陪伴配偶分娩給予7日陪產檢及陪產假，工資照給"
    }
  ],

  // 2026 - 2030 國定假日與連假補休完整清單 (Taiwan Public Holidays 2026-2030)
  DEFAULT_HOLIDAYS: [
    // ==================== 2026 年國定假日 ====================
    { date: "2026-01-01", name: "中華民國開國紀念日", is_workday: false },
    { date: "2026-02-16", name: "農曆除夕", is_workday: false },
    { date: "2026-02-17", name: "春節初一", is_workday: false },
    { date: "2026-02-18", name: "春節初二", is_workday: false },
    { date: "2026-02-19", name: "春節初三", is_workday: false },
    { date: "2026-02-20", name: "春節初四 (補假)", is_workday: false },
    { date: "2026-02-27", name: "和平紀念日 (補假)", is_workday: false },
    { date: "2026-02-28", name: "和平紀念日", is_workday: false },
    { date: "2026-04-03", name: "兒童節 (補假)", is_workday: false },
    { date: "2026-04-04", name: "兒童節", is_workday: false },
    { date: "2026-04-05", name: "民族掃墓節(清明)", is_workday: false },
    { date: "2026-04-06", name: "清明節 (補假)", is_workday: false },
    { date: "2026-05-01", name: "勞動節", is_workday: false },
    { date: "2026-06-19", name: "端午節", is_workday: false },
    { date: "2026-09-25", name: "中秋節", is_workday: false },
    { date: "2026-10-09", name: "國慶日 (補假)", is_workday: false },
    { date: "2026-10-10", name: "國慶日", is_workday: false },

    // ==================== 2027 年國定假日 ====================
    { date: "2027-01-01", name: "中華民國開國紀念日", is_workday: false },
    { date: "2027-02-05", name: "小年夜 (彈性放假)", is_workday: false },
    { date: "2027-02-06", name: "農曆除夕", is_workday: false },
    { date: "2027-02-07", name: "春節初一", is_workday: false },
    { date: "2027-02-08", name: "春節初二", is_workday: false },
    { date: "2027-02-09", name: "春節初三", is_workday: false },
    { date: "2027-02-10", name: "春節初四 (補假)", is_workday: false },
    { date: "2027-02-11", name: "春節初五 (補假)", is_workday: false },
    { date: "2027-02-28", name: "和平紀念日", is_workday: false },
    { date: "2027-03-01", name: "和平紀念日 (補假)", is_workday: false },
    { date: "2027-04-04", name: "兒童節", is_workday: false },
    { date: "2027-04-05", name: "清明節", is_workday: false },
    { date: "2027-04-06", name: "清明節 (補假)", is_workday: false },
    { date: "2027-04-30", name: "勞動節 (補假)", is_workday: false },
    { date: "2027-05-01", name: "勞動節", is_workday: false },
    { date: "2027-06-09", name: "端午節", is_workday: false },
    { date: "2027-09-15", name: "中秋節", is_workday: false },
    { date: "2027-10-10", name: "國慶日", is_workday: false },
    { date: "2027-10-11", name: "國慶日 (補假)", is_workday: false },

    // ==================== 2028 年國定假日 ====================
    { date: "2028-01-01", name: "中華民國開國紀念日", is_workday: false },
    { date: "2028-01-03", name: "元旦 (補假)", is_workday: false },
    { date: "2028-01-25", name: "小年夜 (彈性放假)", is_workday: false },
    { date: "2028-01-26", name: "農曆除夕", is_workday: false },
    { date: "2028-01-27", name: "春節初一", is_workday: false },
    { date: "2028-01-28", name: "春節初二", is_workday: false },
    { date: "2028-01-29", name: "春節初三", is_workday: false },
    { date: "2028-01-30", name: "春節初四 (補假)", is_workday: false },
    { date: "2028-01-31", name: "春節初五 (補假)", is_workday: false },
    { date: "2028-02-28", name: "和平紀念日", is_workday: false },
    { date: "2028-04-04", name: "兒童節 / 清明節", is_workday: false },
    { date: "2028-04-05", name: "清明節 (補假)", is_workday: false },
    { date: "2028-05-01", name: "勞動節", is_workday: false },
    { date: "2028-05-28", name: "端午節", is_workday: false },
    { date: "2028-05-29", name: "端午節 (補假)", is_workday: false },
    { date: "2028-10-03", name: "中秋節", is_workday: false },
    { date: "2028-10-10", name: "國慶日", is_workday: false },

    // ==================== 2029 年國定假日 ====================
    { date: "2029-01-01", name: "中華民國開國紀念日", is_workday: false },
    { date: "2029-02-12", name: "小年夜 (彈性放假)", is_workday: false },
    { date: "2029-02-13", name: "農曆除夕", is_workday: false },
    { date: "2029-02-14", name: "春節初一", is_workday: false },
    { date: "2029-02-15", name: "春節初二", is_workday: false },
    { date: "2029-02-16", name: "春節初三", is_workday: false },
    { date: "2029-02-28", name: "和平紀念日", is_workday: false },
    { date: "2029-04-04", name: "兒童節", is_workday: false },
    { date: "2029-04-05", name: "清明節", is_workday: false },
    { date: "2029-04-06", name: "清明節 (補假)", is_workday: false },
    { date: "2029-05-01", name: "勞動節", is_workday: false },
    { date: "2029-06-16", name: "端午節", is_workday: false },
    { date: "2029-09-22", name: "中秋節", is_workday: false },
    { date: "2029-10-10", name: "國慶日", is_workday: false },

    // ==================== 2030 年國定假日 ====================
    { date: "2030-01-01", name: "中華民國開國紀念日", is_workday: false },
    { date: "2030-02-01", name: "小年夜 (彈性放假)", is_workday: false },
    { date: "2030-02-02", name: "農曆除夕", is_workday: false },
    { date: "2030-02-03", name: "春節初一", is_workday: false },
    { date: "2030-02-04", name: "春節初二", is_workday: false },
    { date: "2030-02-05", name: "春節初三", is_workday: false },
    { date: "2030-02-06", name: "春節初四 (補假)", is_workday: false },
    { date: "2030-02-07", name: "春節初五 (補假)", is_workday: false },
    { date: "2030-02-28", name: "和平紀念日", is_workday: false },
    { date: "2030-04-04", name: "兒童節", is_workday: false },
    { date: "2030-04-05", name: "清明節", is_workday: false },
    { date: "2030-05-01", name: "勞動節", is_workday: false },
    { date: "2030-06-05", name: "端午節", is_workday: false },
    { date: "2030-09-12", name: "中秋節", is_workday: false },
    { date: "2030-10-10", name: "國慶日", is_workday: false }
  ]
};
