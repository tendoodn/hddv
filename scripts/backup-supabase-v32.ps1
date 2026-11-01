#requires -Version 5.1
<#
.SYNOPSIS
  READ-ONLY backup of the AutoTax production Supabase Postgres auth + public schemas.
  Never uploads data. Never runs SQL writes. Requires pg_dump and pg_restore in PATH.
  Run on Windows: powershell -ExecutionPolicy Bypass -File .\scripts\backup-supabase-v32.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$projectRef = "ucqqjdsoyvvaxswzbhaw"
$targetDir = Join-Path $env:USERPROFILE "AutoTax-Private-Backups"
$pgDump = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
$pgRestore = Get-Command pg_restore.exe -ErrorAction SilentlyContinue
if (-not $pgDump -or -not $pgRestore) {
  throw "Khong tim thay pg_dump.exe / pg_restore.exe. Cai PostgreSQL command-line tools, them vao PATH, mo lai PowerShell."
}
Write-Host "AutoTax V3.2 - SAO LUU CHI DOC" -ForegroundColor Cyan
Write-Host "Sao luu auth (tai khoan) + public (11 bang addon va cac du lieu khac)."
Write-Host "Tai Supabase Dashboard > Connect, sao chep Host / Port / User (Direct hoac Session pooler)."
Write-Host "KHONG gui mat khau hoac file dump cho bat ky ai; khong dua len GitHub."
$dbHost = (Read-Host "Host (vd db.$projectRef.supabase.co hoac pooler)").Trim()
$dbPort = (Read-Host "Port [5432]").Trim()
if (-not $dbPort) { $dbPort = "5432" }
if ($dbPort -notmatch '^\d{2,5}$') { throw "Port khong hop le" }
$dbUser = (Read-Host "Database user (Direct: postgres, Pooler: postgres.$projectRef)").Trim()
$dbName = (Read-Host "Database [postgres]").Trim()
if (-not $dbName) { $dbName = "postgres" }
if (-not $dbHost -or -not $dbUser) { throw "Host va User khong duoc trong" }
if (($dbHost -notlike "*$projectRef*") -and ($dbUser -notlike "*$projectRef*")) {
  throw "SAI DU AN: Host hoac user phai chua project ref $projectRef. Khong sao luu nham du an."
}
$pass = Read-Host "Database password (duoc an)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pass)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
$env:PGHOST = $dbHost
$env:PGPORT = $dbPort
$env:PGUSER = $dbUser
$env:PGDATABASE = $dbName
$env:PGSSLMODE = "require"
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $targetDir "AutoTax-before-V32-$timestamp.backup"
try {
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  Write-Host "Dang sao luu (auth + public) ..." -ForegroundColor Cyan
  # -Fc contains SQL schema and data; --schema filters include Auth users and add-on tables.
  # No passwords appear in command arguments or in the backup filename.
  & $pgDump.Source --format=custom --schema=auth --schema=public --file=$backupPath --no-password
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump bao loi $LASTEXITCODE. KHONG duoc phep nang cap database."
  }
  if (-not (Test-Path -LiteralPath $backupPath)) { throw "Khong tao duoc file sao luu." }
  $file = Get-Item -LiteralPath $backupPath
  if ($file.Length -lt 1024) { throw "File sao luu bat thuong (nho hon 1 KB)." }

  $toc = & $pgRestore.Source --list $backupPath
  if ($LASTEXITCODE -ne 0) { throw "pg_restore khong doc duoc archive." }
  $text = $toc -join "`n"
  # PostgreSQL custom-format TOC has records: ... TABLE DATA auth users ...
  $required = @(
    'TABLE DATA\s+auth\s+users\b',
    'TABLE DATA\s+public\s+addon_admins\b',
    'TABLE DATA\s+public\s+addon_orders\b',
    'TABLE DATA\s+public\s+addon_profiles\b'
  )
  foreach ($pattern in $required) {
    if ($text -notmatch $pattern) { throw "Archive thieu du lieu quan trong: $pattern" }
  }
  $sha256 = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
  Write-Host ""
  Write-Host "BACKUP DA TAO VA KIEM TRA ARCHIVE" -ForegroundColor Green
  Write-Host "Duong dan: $backupPath"
  Write-Host "Dung luong: $($file.Length) bytes"
  Write-Host "SHA256: $sha256"
  Write-Host "Da co auth.users, addon_admins, addon_orders, addon_profiles trong danh muc archive."
  Write-Host "LUU Y: Day la kiem tra file va noi dung TOC, KHONG phai phep thu khoi phuc hoan chinh."
  Write-Host "Neu can chac chan khôi phuc duoc, thu restore vao database TAM RIENG TRUOC KHI NANG CAP."
  Write-Host "Khong tai file len GitHub, chat, email cong khai hoac repository."
} catch {
  if (Test-Path -LiteralPath $backupPath) {
    $bad = "$backupPath.INCOMPLETE"
    Move-Item -LiteralPath $backupPath -Destination $bad -Force
    Write-Warning "Ban sao luu LOI duoc doi ten: $bad. KHONG SU DUNG FILE NAY."
  }
  throw
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGHOST -ErrorAction SilentlyContinue
  Remove-Item Env:PGPORT -ErrorAction SilentlyContinue
  Remove-Item Env:PGUSER -ErrorAction SilentlyContinue
  Remove-Item Env:PGDATABASE -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
}
