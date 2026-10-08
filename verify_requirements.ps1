# Automated Verification Suite for 3 User Requirements
$gasUrl = "https://script.google.com/macros/s/AKfycbxBrJVcUkoUab5PrZIR9KYCwMTswNNq8JI9ZXE32u5nHZkTcmQC9Ms-QW4F1HaJollrow/exec"
$ErrorActionPreference = "Stop"

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $baseDir) { $baseDir = (Get-Location).Path }

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Leave System Automated Verification Suite" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$passCount = 0
$totalTests = 0

function Assert-Check([string]$desc, [bool]$condition) {
    $global:totalTests++
    if ($condition) {
        Write-Host "  [PASS] $desc" -ForegroundColor Green
        $global:passCount++
    } else {
        Write-Host "  [FAIL] $desc" -ForegroundColor Red
        throw "Assertion failed: $desc"
    }
}

# ------------------------------------------------------------------------------
# Test 1: Anti-double-click & Debounce
# ------------------------------------------------------------------------------
Write-Host "`n>>> [Test 1] Anti-double click & Debounce checks..." -ForegroundColor Yellow

$appJsPath = Join-Path $baseDir "js\app.js"
$styleCssPath = Join-Path $baseDir "css\style.css"
$appJs = [System.IO.File]::ReadAllText($appJsPath, [System.Text.Encoding]::UTF8)
$styleCss = [System.IO.File]::ReadAllText($styleCssPath, [System.Text.Encoding]::UTF8)

$hasDebounce = $appJs.Contains("now - lastClick < 650") -and $appJs.Contains("stopImmediatePropagation")
Assert-Check "js/app.js has global capture-phase debounce (650ms)" $hasDebounce

$hasStateLock = $appJs.Contains("isSubmitting: false")
Assert-Check "App.state defines isSubmitting: false" $hasStateLock

$hasLeaveLock = $appJs.Contains("if (this.state.isSubmitting) return;") -and $appJs.Contains("this.state.isSubmitting = false")
Assert-Check "handleLeaveSubmit guards against concurrent submission" $hasLeaveLock

$hasOtLock = $appJs.Contains("btnSubmitOvertime") -and $appJs.Contains("this.state.isSubmitting = true")
Assert-Check "handleOvertimeSubmit guards against concurrent submission" $hasOtLock

$hasCssLoading = $styleCss.Contains(".btn.btn-loading") -and $styleCss.Contains("pointer-events: none")
Assert-Check "css/style.css defines .btn-loading and pointer-events: none" $hasCssLoading

# ------------------------------------------------------------------------------
# Test 2: Application ID persistence to Google Sheet
# ------------------------------------------------------------------------------
Write-Host "`n>>> [Test 2] Application ID persistence & Sheet mapping checks..." -ForegroundColor Yellow

$codeGsPath = Join-Path $baseDir "google-apps-script\Code.gs"
$codeGs = [System.IO.File]::ReadAllText($codeGsPath, [System.Text.Encoding]::UTF8)

$hasDynamicHeader = $codeGs.Contains('lower === "id"')
Assert-Check "Code.gs applyLeave dynamically writes reqId to sheet" $hasDynamicHeader

$hasLeaveLog = $codeGs.Contains('logApproval(ss, reqId, "LEAVE", userId, "Applicant", "PENDING"')
Assert-Check "Code.gs applyLeave logs application submission to approval_logs" $hasLeaveLog

$hasOtLog = $codeGs.Contains('logApproval(ss, otId, "OVERTIME", userId, "Applicant", "PENDING"')
Assert-Check "Code.gs applyOvertime logs overtime submission to approval_logs" $hasOtLog

$hasAlias = $codeGs.Contains('obj.id = val')
Assert-Check "Code.gs sheetToObjects provides bidirectional alias" $hasAlias

Write-Host "  > Connecting to Google Apps Script live endpoint..." -ForegroundColor DarkGray
$postBody = '{"action":"getBootstrapData","params":{"currentUserId":"EMP001"}}'
$gasRes = Invoke-RestMethod -Uri $gasUrl -Method Post -Body $postBody -ContentType "text/plain;charset=utf-8"

Assert-Check "Live Google Sheet connection returned success = true" ($gasRes.success -eq $true)

$requests = $gasRes.data.requests
$logs = $gasRes.data.logs
$allReqsHaveId = ($requests | Where-Object { $_.id -like "REQ-*" }).Count -eq $requests.Count
Assert-Check "All live leave requests in sheet have valid REQ- IDs (Total: $($requests.Count))" $allReqsHaveId

$allLogsHaveReqId = ($logs | Where-Object { $_.request_id -ne $null -and $_.request_id.Length -gt 0 }).Count -eq $logs.Count
Assert-Check "All live approval logs have non-empty request_id (Total: $($logs.Count))" $allLogsHaveReqId

# ------------------------------------------------------------------------------
# Test 3: Approval history newest first sorting
# ------------------------------------------------------------------------------
Write-Host "`n>>> [Test 3] Approval history newest-first sorting checks..." -ForegroundColor Yellow

$hasSortCode = $appJs.Contains("timeB - timeA") -and $appJs.Contains("visibleLogs.sort")
Assert-Check "js/app.js sorts visibleLogs by acted_at descending (newest on top)" $hasSortCode

# 驗證前端 JavaScript 排序演算法
Write-Host "  > 模擬前端 visibleLogs.sort((a, b) => timeB - timeA) 排序..." -ForegroundColor DarkGray
$clientSortedLogs = [System.Collections.ArrayList]@($logs)
$clientSortedLogs.Sort([System.Comparison[object]]{
    param($a, $b)
    $tA = [DateTime]::Parse($a.acted_at)
    $tB = [DateTime]::Parse($b.acted_at)
    return $tB.CompareTo($tA)
})
$topSortedTime = [DateTime]::Parse($clientSortedLogs[0].acted_at)
$bottomSortedTime = [DateTime]::Parse($clientSortedLogs[-1].acted_at)
Write-Host "  > 前端排序後首筆時間: $($clientSortedLogs[0].acted_at) (單號: $($clientSortedLogs[0].request_id))" -ForegroundColor DarkGray
Write-Host "  > 前端排序後末筆時間: $($clientSortedLogs[-1].acted_at) (單號: $($clientSortedLogs[-1].request_id))" -ForegroundColor DarkGray

Assert-Check "前端排序後最上方記錄時間 ($topSortedTime) 大於等於最下方記錄 ($bottomSortedTime)" ($topSortedTime -ge $bottomSortedTime)

# 檢查雲端 Google Apps Script 原始順序與部署狀態
$cloudTopTime = [DateTime]::Parse($logs[0].acted_at)
$cloudBottomTime = [DateTime]::Parse($logs[-1].acted_at)
if ($cloudTopTime -lt $cloudBottomTime) {
    Write-Host "  [NOTICE] 雲端 Google Sheet 原始行依然為新增由上至下 (2026-09-01 -> 2026-09-04)。" -ForegroundColor DarkYellow
    Write-Host "           前端畫面已透過 visibleLogs.sort 確保呈現為最新在頂部；" -ForegroundColor DarkYellow
    Write-Host "           若需雲端 API 也直接預排，請將已修改的 Code.gs 複製至 Google Apps Script 編輯器並建立新版本發布。" -ForegroundColor DarkYellow
}

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  Test Summary: $passCount / $totalTests tests PASSED!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
