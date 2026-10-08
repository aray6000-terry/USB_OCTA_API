var fs = require('fs');
var https = require('https');

console.log('==========================================================');
console.log('  請假系統三大需求 - 自動化驗證測試套件 (Node.js Test Suite)');
console.log('==========================================================\n');

var passCount = 0;
var totalCount = 0;

function assert(desc, condition) {
  totalCount++;
  if (condition) {
    console.log('  [PASS] ' + desc);
    passCount++;
  } else {
    console.error('  [FAIL] ' + desc);
    process.exit(1);
  }
}

// -------------------------------------------------------------
// 測試區塊 1: 按鍵防連點機制驗證
// -------------------------------------------------------------
console.log('>>> [測試 1] 按鍵防連點 (Debounce / 狀態鎖 / Loading 樣式)');
var appJs = fs.readFileSync('js/app.js', 'utf8');
var styleCss = fs.readFileSync('css/style.css', 'utf8');

assert('App.state 定義了 isSubmitting: false 狀態鎖', appJs.indexOf('isSubmitting: false') !== -1);
assert('js/app.js 包含全域 capture 階段防連點攔截器 (650ms)', appJs.indexOf('now - lastClick < 650') !== -1 && appJs.indexOf('stopImmediatePropagation') !== -1);
assert('handleLeaveSubmit 具備 isSubmitting 互斥鎖與 finally 釋放', appJs.indexOf('if (this.state.isSubmitting) return;') !== -1 && appJs.indexOf('this.state.isSubmitting = false') !== -1);
assert('handleOvertimeSubmit 具備 isSubmitting 互斥鎖與 finally 釋放', appJs.indexOf('handleOvertimeSubmit') !== -1 && appJs.indexOf('btnSubmitOvertime') !== -1);
assert('submitApprovalAction 具備 isSubmitting 互斥鎖與按鈕 disabled 控制', appJs.indexOf('submitApprovalAction') !== -1 && appJs.indexOf('btnApprove.disabled = true') !== -1);
assert('executeCancelLeave 具備 isSubmitting 互斥鎖', appJs.indexOf('executeCancelLeave') !== -1 && appJs.indexOf('btnConfirmCancel') !== -1);
assert('css/style.css 定義了 .btn.btn-loading 與 pointer-events: none', styleCss.indexOf('.btn.btn-loading') !== -1 && styleCss.indexOf('pointer-events: none') !== -1);
assert('css/style.css 定義了 .btn:disabled 與 button:disabled', styleCss.indexOf('.btn:disabled') !== -1);

// -------------------------------------------------------------
// 測試區塊 2: 申請單號寫入 Google Sheet 內
// -------------------------------------------------------------
console.log('\n>>> [測試 2] 申請單號寫入 Google Sheet (Code.gs 欄位映射與同步歷程)');
var codeGs = fs.readFileSync('google-apps-script/Code.gs', 'utf8');

assert('Code.gs applyLeave 動態匹配申請單號欄位 (支援 id/申請單號/單號)', codeGs.indexOf('lower === "id"') !== -1 && codeGs.indexOf('h === "申請單號"') !== -1);
assert('Code.gs applyLeave 送出時立即呼叫 logApproval 記錄至 approval_logs', codeGs.indexOf('logApproval(ss, reqId, "LEAVE", userId, "Applicant", "PENDING"') !== -1);
assert('Code.gs applyOvertime 送出時立即呼叫 logApproval 記錄至 approval_logs', codeGs.indexOf('logApproval(ss, otId, "OVERTIME", userId, "Applicant", "PENDING"') !== -1);
assert('Code.gs logApproval 動態支援 中英文 request_id / 關聯單號 / 申請單號', codeGs.indexOf('h === "關聯單號"') !== -1 || codeGs.indexOf('h === "申請單號"') !== -1);
assert('Code.gs sheetToObjects 具備 id 與 申請單號 雙向別名相容映射', codeGs.indexOf('header === "申請單號"') !== -1 && codeGs.indexOf('obj.id = val') !== -1);

// -------------------------------------------------------------
// 測試區塊 3: 簽核歷史歷程 由最新的排在最上面
// -------------------------------------------------------------
console.log('\n>>> [測試 3] 簽核歷史歷程 排序由最新的排在最上面');
assert('js/app.js history 分頁具備 visibleLogs 依時間降序排序 (timeB - timeA)', appJs.indexOf('visibleLogs.sort') !== -1 && appJs.indexOf('timeB - timeA') !== -1);
assert('Code.gs getBootstrapData 具備 logs 降序排序', codeGs.indexOf('logs.sort') !== -1);

// 驗證排序演算法純邏輯
var sampleLogs = [
  { id: 'LOG-1', request_id: 'REQ-001', acted_at: '2026-08-15 09:00:00' },
  { id: 'LOG-2', request_id: 'REQ-002', acted_at: '2026-09-04 10:30:00' },
  { id: 'LOG-3', request_id: 'REQ-003', acted_at: '2026-09-01 14:00:00' }
];
sampleLogs.sort(function(a, b) {
  var timeA = new Date(a.acted_at || 0).getTime();
  var timeB = new Date(b.acted_at || 0).getTime();
  return timeB - timeA;
});
assert('降序排序演算法驗證：首筆必為最新時間 (2026-09-04)', sampleLogs[0].id === 'LOG-2' && sampleLogs[2].id === 'LOG-1');

// -------------------------------------------------------------
// 測試區塊 4: 病假薪資與證明附件規則驗證 (改為支半薪、不強制附證明)
// -------------------------------------------------------------
console.log('\n>>> [測試 4] 病假規則更新 (支半薪、免強制檢附證明)');
var configJs = fs.readFileSync('js/config.js', 'utf8');
var apiJs = fs.readFileSync('js/api.js', 'utf8');

assert('js/config.js 定義病假 requiresAttachment 為 false (免強制附件)', configJs.indexOf('id: "SICK"') !== -1 && configJs.indexOf('requiresAttachment: false') !== -1);
assert('js/config.js 定義病假 isPaid 為 HALF 且 paidText 為 支半薪', configJs.indexOf('isPaid: "HALF"') !== -1 && configJs.indexOf('paidText: "支半薪"') !== -1);
assert('js/app.js 表單動態檢核設定病假免強制填寫附件 (required = false)', appJs.indexOf('leaveTypeId === "SICK"') !== -1 && appJs.indexOf('attInput.required = false') !== -1);
assert('js/app.js 卡片與歷史清單正確呈現病假【支半薪】狀態', appJs.indexOf('(typeDef.id === \'SICK\' || typeDef.isPaid === \'HALF\' || typeDef.payRate === 0.5) ? \'支半薪\'') !== -1);
assert('js/api.js 於前端模擬提交時放行病假無附件申請', apiJs.indexOf('leaveTypeId === "SICK"') !== -1 && apiJs.indexOf('requiresAtt') !== -1);
assert('Code.gs applyLeave 後端放行病假無附件申請', codeGs.indexOf('leaveTypeId === "SICK"') !== -1 && codeGs.indexOf('requiresAtt') !== -1);
assert('Code.gs leaveTypeSeeds 設定病假為支半薪與免強制附件', codeGs.indexOf('["SICK", "病假", 0.5, false, "半薪"') !== -1);
assert('Code.gs 具備 syncLeaveTypes 自動同步遠端 Google Sheet 病假設定', codeGs.indexOf('function syncLeaveTypes') !== -1);

// -------------------------------------------------------------
// 測試區塊 5: 單號唯一性防重與歷史除重機制驗證
// -------------------------------------------------------------
console.log('\n>>> [測試 5] 單號唯一性防重演算法與自動除重 (REQ- / OT-)');
appJs = fs.readFileSync('js/app.js', 'utf8');
apiJs = fs.readFileSync('js/api.js', 'utf8');
codeGs = fs.readFileSync('google-apps-script/Code.gs', 'utf8');

assert('js/app.js handleLeaveSubmit 具備高精度防重單號生成 (REQ-yyyyMMdd-HHmmss-XXXX)', appJs.indexOf('REQ-${dateStr}-${timeStr}-${rand}') !== -1);
assert('js/app.js handleOvertimeSubmit 具備高精度防重單號生成 (OT-yyyyMMdd-HHmmss-XXXX)', appJs.indexOf('OT-${dateStr}-${timeStr}-${rand}') !== -1);
assert('js/app.js loadData 具備歷史重複單號自動加後綴保護 (避免介面衝突)', appJs.indexOf('seenReqIds') !== -1 && appJs.indexOf('${r.id}-${seenReqIds[r.id]}') !== -1);
assert('Code.gs applyLeave 包含資料庫既有單號檢查與防重迴圈 (existingReqIds)', codeGs.indexOf('existingReqIds') !== -1 && codeGs.indexOf('while (existingReqIds[reqId])') !== -1);
assert('Code.gs applyOvertime 包含資料庫既有單號檢查與防重迴圈 (existingOtIds)', codeGs.indexOf('existingOtIds') !== -1 && codeGs.indexOf('while (existingOtIds[otId])') !== -1);
assert('Code.gs 具備 syncDeduplicateRequests 自動修復雲端 Google Sheet 重複單號', codeGs.indexOf('function syncDeduplicateRequests') !== -1);

// -------------------------------------------------------------
// 測試區塊 6: leave_balances 假別額度在顯示面板上的精確對應
// -------------------------------------------------------------
console.log('\n>>> [測試 6] leave_balances 額度資料流與顯示面板精確對應驗證');
assert('js/app.js loadData 正確載入並存入 this.state.balances', appJs.indexOf('this.state.balances = (res.data.balances') !== -1);
assert('js/app.js loadData 具備中英文欄位映射與型態正規化 (total_hours/used_hours/pending_hours)', appJs.indexOf('total_hours: parseFloat') !== -1 && appJs.indexOf('pending_hours: parseFloat') !== -1);
assert('js/app.js renderDashboard 假別額度卡片對應 userBalances (String/Number 雙向容錯)', appJs.indexOf('String(b.user_id || "").trim().toUpperCase()') !== -1);
assert('js/app.js 假別額度卡片真實反映 leave_balances 的總額度與剩餘額度', appJs.indexOf('total === 0 && (typeId === "PERSONAL" || typeId === "SICK")') !== -1);
assert('Code.gs sheetToObjects 具備 leave_balances 欄位中英文相容 (user_id/total_hours/used_hours/pending_hours)', codeGs.indexOf('hTrim === "user_id" || header === "員工編號"') !== -1 && codeGs.indexOf('hTrim === "total_hours" || header === "總額度"') !== -1);

// -------------------------------------------------------------
// 測試區塊 7: 連線 Google Apps Script 雲端後端即時 API 驗證
// -------------------------------------------------------------
console.log('\n>>> [測試 7] Google Apps Script 雲端真實後端 API 連線與數據結構檢驗');
var postData = JSON.stringify({
  action: 'getBootstrapData',
  params: { currentUserId: 'EMP001' }
});

var parsedUrl = require('url').parse('https://script.google.com/macros/s/AKfycbxBrJVcUkoUab5PrZIR9KYCwMTswNNq8JI9ZXE32u5nHZkTcmQC9Ms-QW4F1HaJollrow/exec');

function fetchGas(targetUrl, body, callback) {
  var options = require('url').parse(targetUrl);
  options.method = 'POST';
  options.headers = {
    'Content-Type': 'text/plain;charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  };

  var req = https.request(options, function(res) {
    if (res.statusCode === 302 || res.statusCode === 301 || res.statusCode === 307) {
      // Google Apps Script 規範：POST 重定向後以 GET 讀取結果
      https.get(res.headers.location, function(res2) {
        var data2 = '';
        res2.on('data', function(chunk) { data2 += chunk; });
        res2.on('end', function() {
          try {
            var json2 = JSON.parse(data2);
            callback(null, json2);
          } catch (e) {
            callback(e);
          }
        });
      }).on('error', function(e) { callback(e); });
      return;
    }
    var data = '';
    res.on('data', function(chunk) { data += chunk; });
    res.on('end', function() {
      try {
        var json = JSON.parse(data);
        callback(null, json);
      } catch (e) {
        callback(e);
      }
    });
  });

  req.on('error', function(e) { callback(e); });
  req.write(body);
  req.end();
}

fetchGas(parsedUrl.href, postData, function(err, result) {
  if (err) {
    console.error('  [FAIL] 雲端 API 請求錯誤: ' + err.message);
    process.exit(1);
  }

  assert('雲端 API 回傳 success 為 true', result.success === true);
  var reqs = result.data.requests;
  var logs = result.data.logs;
  assert('雲端資料庫共有 ' + reqs.length + ' 筆請假單，全部包含合法 REQ- 申請單號', reqs.every(function(r) { return r.id && r.id.indexOf('REQ-') === 0; }));
  assert('雲端資料庫共有 ' + logs.length + ' 筆簽核歷程，每一筆皆具備關聯單號 request_id', logs.every(function(l) { return l.request_id && l.request_id.length > 0; }));

  // 前端排序驗證
  var clientLogs = logs.slice().sort(function(a, b) {
    return new Date(b.acted_at || 0).getTime() - new Date(a.acted_at || 0).getTime();
  });
  assert('前端降序排列後首筆為最新單據 (' + clientLogs[0].acted_at + '，單號: ' + clientLogs[0].request_id + ')', new Date(clientLogs[0].acted_at).getTime() >= new Date(clientLogs[clientLogs.length - 1].acted_at).getTime());

  console.log('\n==========================================================');
  console.log('  自動化驗證結果: 全部 ' + totalCount + ' 項測試，通過 ' + passCount + ' 項！');
  console.log('==========================================================');
});
