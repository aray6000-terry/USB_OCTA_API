/**
 * 每日早上待簽核 Email 通知 (Daily Pending-Approval Digest)
 * -------------------------------------------------------------
 * 安裝方式：
 *   1. 把本檔加到與 Code.gs 同一個 Apps Script 專案 (新增檔案 > 指令碼，命名 Notifier)。
 *   2. 在編輯器上方函式選單選 installDailyDigestTrigger，按「執行」一次，
 *      依提示授權「以您的身分傳送電子郵件」。
 *   3. 想先試寄一封：選 sendDailyPendingDigest 按執行。
 *
 * 行為：
 *   - 每天早上 08:00~09:00 (Asia/Taipei) 執行一次。
 *   - 依 current_step 找出每張待簽單的簽核人：
 *       MANAGER → 申請人的 manager_id
 *       HR      → 所有 role 為 HR 或 Admin 的人
 *   - 每位簽核人收到一封信，列出「上次通知後新增」與「仍在等待」的請假 / 銷假 / 加班單。
 *   - 沒有待簽單的人不寄信。
 *   - 一般同仁不會被要求簽自己的單；最高主管 (Admin 且無上層主管) 自己的單會通知本人自核。
 */

const DIGEST_CONFIG = {
  HOUR: 8,                                   // 每天幾點寄 (台北時間)
  SYSTEM_URL: "https://aray6000-terry.github.io/USB_OCTA_API/",
  LAST_RUN_KEY: "DIGEST_LAST_RUN_AT",
  ALWAYS_CC: ""                              // 選填：每封都副本給誰，例如 "hr@company.com"
};

function installDailyDigestTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "sendDailyPendingDigest")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("sendDailyPendingDigest")
    .timeBased()
    .everyDays(1)
    .atHour(DIGEST_CONFIG.HOUR)
    .inTimezone("Asia/Taipei")
    .create();
  return "已設定：每天 " + DIGEST_CONFIG.HOUR + ":00 左右寄出待簽核通知";
}

function sendDailyPendingDigest() {
  const ss = getSpreadsheet();

  // 每日維護：補齊假別、建立今年 / 明年額度、跨年補休結轉
  try {
    syncLeaveTypes(ss);
    syncStatutoryAnnualLeaves(ss);
  } catch (e) {
    console.error("每日維護失敗：" + (e && e.stack ? e.stack : e));
  }

  const props = PropertiesService.getScriptProperties();
  const lastRun = props.getProperty(DIGEST_CONFIG.LAST_RUN_KEY) || "1970-01-01 00:00:00";
  const nowStr = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");

  const users = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.USERS));
  const userById = {};
  users.forEach(u => { userById[u.id] = u; });
  const hrAdmins = users.filter(u => u.role === "HR" || u.role === "Admin");

  const typeNames = {};
  sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.LEAVE_TYPES)).forEach(t => { typeNames[t.id] = t.name; });

  // 收集待簽單
  const items = [];
  sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.LEAVE_REQUESTS)).forEach(r => {
    if (r.status !== "PENDING" && r.status !== "CANCEL_PENDING") return;
    items.push({
      id: r.id,
      kind: r.status === "CANCEL_PENDING" ? "銷假" : "請假",
      applicantId: r.user_id,
      step: r.current_step || "MANAGER",
      detail: (typeNames[r.leave_type_id] || r.leave_type_id) + "　" + r.start_time + " ~ " + r.end_time + "（" + r.total_hours + " 小時）",
      reason: r.reason || "",
      appliedAt: String(r.applied_at || "")
    });
  });
  sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.OVERTIME_REQUESTS)).forEach(o => {
    if (o.status !== "PENDING") return;
    items.push({
      id: o.id,
      kind: "加班",
      applicantId: o.user_id,
      step: "MANAGER",
      detail: o.date + " " + o.start_time + "~" + o.end_time + "（" + o.hours + " 小時，換補休 " + o.comp_hours + " 小時）",
      reason: o.reason || "",
      appliedAt: String(o.applied_at || "")
    });
  });

  // 依簽核人分組
  const byApprover = {};
  const addTo = (approverId, item) => {
    if (!approverId || !userById[approverId]) return;
    (byApprover[approverId] = byApprover[approverId] || []).push(item);
  };
  items.forEach(item => {
    const applicant = userById[item.applicantId] || {};
    if (item.step === "HR") {
      hrAdmins.filter(h => h.id !== item.applicantId || h.role === "Admin").forEach(h => addTo(h.id, item));
    } else {
      const mgr = applicant.manager_id;
      if (mgr && mgr !== item.applicantId) {
        addTo(mgr, item);
      } else if (applicant.role === "Admin") {
        // 最高主管 (老闆) 自己的單：通知本人自行核准
        addTo(item.applicantId, item);
      } else {
        // 沒有設定主管的同仁：交給 HR/Admin
        hrAdmins.filter(h => h.id !== item.applicantId).forEach(h => addTo(h.id, item));
      }
    }
  });

  let sent = 0;
  Object.keys(byApprover).forEach(approverId => {
    const approver = userById[approverId];
    if (!approver.email) return;
    const list = byApprover[approverId];
    const fresh = list.filter(i => i.appliedAt > lastRun);
    const older = list.filter(i => i.appliedAt <= lastRun);

    const subject = "【請假系統】您有 " + list.length + " 張待簽核單" + (fresh.length ? "（新增 " + fresh.length + " 張）" : "");
    const html =
      "<p>" + esc_(approver.name) + " 您好，以下單據等待您簽核：</p>" +
      section_("🆕 上次通知後新增", fresh, userById) +
      section_("⏳ 仍在等待", older, userById) +
      '<p><a href="' + DIGEST_CONFIG.SYSTEM_URL + '">前往請假系統簽核</a></p>' +
      '<p style="color:#888;font-size:12px">此信由系統於每日早上自動寄出。</p>';

    const opts = { htmlBody: html, name: "請假系統" };
    if (DIGEST_CONFIG.ALWAYS_CC) opts.cc = DIGEST_CONFIG.ALWAYS_CC;
    MailApp.sendEmail(approver.email, subject, "請以 HTML 檢視此信", opts);
    sent++;
  });

  props.setProperty(DIGEST_CONFIG.LAST_RUN_KEY, nowStr);
  Logger.log("待簽單 " + items.length + " 張，寄出 " + sent + " 封通知");
  return { pending: items.length, emailsSent: sent };
}

function section_(title, list, userById) {
  if (!list.length) return "";
  const rows = list.map(i =>
    "<tr><td>" + esc_(i.kind) + "</td><td>" + esc_((userById[i.applicantId] || {}).name || i.applicantId) +
    "</td><td>" + esc_(i.detail) + "</td><td>" + esc_(i.reason) + "</td><td>" + esc_(i.appliedAt) +
    "</td><td>" + esc_(i.id) + "</td></tr>").join("");
  return "<h3>" + title + "（" + list.length + "）</h3>" +
    '<table border="1" cellpadding="6" style="border-collapse:collapse;font-size:13px">' +
    "<tr><th>類型</th><th>申請人</th><th>內容</th><th>事由</th><th>申請時間</th><th>單號</th></tr>" + rows + "</table>";
}

function esc_(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
