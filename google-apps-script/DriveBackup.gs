/**
 * 程式版本備份到 Google Drive (GitHub → Drive 版本控管)
 * -------------------------------------------------------------
 * GitHub 是正式的版本控管 (每次修改都是一個 commit，可隨時還原)；
 * 本程式把每一個版本的完整程式碼，另外快照備份到 Google Drive：
 *
 *   請假系統/
 *   ├── 版本紀錄 (試算表：每個版本一列，含日期、說明、資料夾與 GitHub 連結)
 *   ├── 2026-11-03_1254_cd6a419/   ← 每個版本一個資料夾，保留原本的目錄結構
 *   │     ├── 原始碼_cd6a419.zip     ← 整包下載用
 *   │     ├── index.html, css/, js/, google-apps-script/ ...
 *   └── ...
 *
 * 使用方式 (在 Apps Script 編輯器)：
 *   1. 新增指令碼檔案 DriveBackup，貼上本檔，存檔。
 *   2. 執行 backupHistoryToDrive  → 一次備份 BACKUP_CONFIG.INITIAL_COMMITS 列出的歷史版本。
 *   3. 執行 installBackupTrigger  → 之後每天自動檢查 GitHub，有新版本就備份。
 *   隨時也可手動執行 backupLatestToDrive 立即備份最新版。
 */

const BACKUP_CONFIG = {
  OWNER: "aray6000-terry",
  REPO: "USB_OCTA_API",
  BRANCH: "main",
  FOLDER_ID: "1WOS5oFhmpWN7fHUySonmUDNgVlYzjDeb",   // Google Drive「請假系統」資料夾
  LOG_NAME: "版本紀錄",
  // 第一次執行 backupHistoryToDrive 時要補備份的歷史版本 (舊 → 新)
  INITIAL_COMMITS: ["759d612", "46d3686", "cd6a419"],
  // 若之後把 GitHub repo 改成 Private：在「專案設定 > 指令碼屬性」新增 GITHUB_TOKEN (唯讀權限即可)
  TOKEN_PROPERTY: "GITHUB_TOKEN"
};

/** 每天自動備份 (台北時間凌晨 2 點左右) */
function installBackupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "backupLatestToDrive")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("backupLatestToDrive").timeBased().everyDays(1).atHour(2).inTimezone("Asia/Taipei").create();
  return "已設定：每天凌晨自動把 GitHub 最新版本備份到 Google Drive";
}

/** 備份歷史版本 (已備份過的會自動略過) */
function backupHistoryToDrive() {
  const results = BACKUP_CONFIG.INITIAL_COMMITS.map(sha => backupCommitToDrive_(sha));
  Logger.log(results.join("\n"));
  return results;
}

/** 備份 main 分支最新版本 (已備份過就略過) */
function backupLatestToDrive() {
  const msg = backupCommitToDrive_(BACKUP_CONFIG.BRANCH);
  Logger.log(msg);
  return msg;
}

// ---------------------------------------------------------------

function backupCommitToDrive_(ref) {
  const commit = githubJson_(`/repos/${BACKUP_CONFIG.OWNER}/${BACKUP_CONFIG.REPO}/commits/${encodeURIComponent(ref)}`);
  const sha = commit.sha;
  const short = sha.substring(0, 7);
  const log = getOrCreateLog_();

  // 已備份過就略過
  const done = log.getDataRange().getValues().some(r => String(r[2]) === short);
  if (done) return `略過 ${short}：已經備份過`;

  const when = new Date(commit.commit.committer.date);
  const folderName = Utilities.formatDate(when, "Asia/Taipei", "yyyy-MM-dd_HHmm") + "_" + short;
  const root = DriveApp.getFolderById(BACKUP_CONFIG.FOLDER_ID);
  const versionFolder = root.createFolder(folderName);

  // 取得該版本所有檔案清單
  const tree = githubJson_(`/repos/${BACKUP_CONFIG.OWNER}/${BACKUP_CONFIG.REPO}/git/trees/${sha}?recursive=1`);
  const blobsForZip = [];
  const folderCache = { "": versionFolder };
  let count = 0;

  tree.tree.filter(n => n.type === "blob").forEach(n => {
    const parts = n.path.split("/");
    const fileName = parts.pop();
    const dir = getSubFolder_(versionFolder, folderCache, parts);
    const blob = fetchRaw_(sha, n.path).setName(fileName);
    dir.createFile(blob);
    blobsForZip.push(blob.copyBlob().setName(n.path));
    count++;
  });

  // 整包 zip 方便下載
  versionFolder.createFile(Utilities.zip(blobsForZip, `原始碼_${short}.zip`));

  const title = String(commit.commit.message || "").split("\n")[0];
  const version = "v" + (log.getLastRow()); // 第 1 列是標題，所以第一個版本為 v1
  log.appendRow([
    version,
    Utilities.formatDate(when, "Asia/Taipei", "yyyy-MM-dd HH:mm"),
    short,
    title,
    count,
    versionFolder.getUrl(),
    `https://github.com/${BACKUP_CONFIG.OWNER}/${BACKUP_CONFIG.REPO}/commit/${sha}`,
    Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm")
  ]);

  return `已備份 ${version} ${short}「${title}」共 ${count} 個檔案 → ${folderName}`;
}

function getSubFolder_(base, cache, parts) {
  let path = "", cur = base;
  parts.forEach(p => {
    path = path ? path + "/" + p : p;
    if (!cache[path]) cache[path] = cur.createFolder(p);
    cur = cache[path];
  });
  return cur;
}

function getOrCreateLog_() {
  const root = DriveApp.getFolderById(BACKUP_CONFIG.FOLDER_ID);
  const it = root.getFilesByName(BACKUP_CONFIG.LOG_NAME);
  let ss;
  if (it.hasNext()) {
    ss = SpreadsheetApp.open(it.next());
  } else {
    ss = SpreadsheetApp.create(BACKUP_CONFIG.LOG_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(root);
  }
  const sh = ss.getSheets()[0];
  if (sh.getLastRow() === 0) {
    sh.appendRow(["版本", "版本日期", "Commit", "修改說明", "檔案數", "Drive 資料夾", "GitHub", "備份時間"]);
    sh.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#2563eb").setFontColor("#ffffff");
    sh.setFrozenRows(1);
  }
  return sh;
}

function githubHeaders_() {
  const token = PropertiesService.getScriptProperties().getProperty(BACKUP_CONFIG.TOKEN_PROPERTY);
  const h = { "Accept": "application/vnd.github+json", "User-Agent": "leave-system-drive-backup" };
  if (token) h.Authorization = "Bearer " + token;
  return h;
}

function githubJson_(path) {
  const res = UrlFetchApp.fetch("https://api.github.com" + path, { headers: githubHeaders_(), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error(`GitHub API ${res.getResponseCode()}：${res.getContentText().substring(0, 200)}`);
  }
  return JSON.parse(res.getContentText());
}

function fetchRaw_(sha, path) {
  const url = `https://raw.githubusercontent.com/${BACKUP_CONFIG.OWNER}/${BACKUP_CONFIG.REPO}/${sha}/` +
    path.split("/").map(encodeURIComponent).join("/");
  const res = UrlFetchApp.fetch(url, { headers: githubHeaders_(), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error(`下載失敗 ${path}：HTTP ${res.getResponseCode()}`);
  return res.getBlob();
}
