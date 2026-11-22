<#
  Reproducible local startup for the Campus Navigation System.
  - Persists PostgreSQL data under %LOCALAPPDATA%\campus-nav\pgdata (survives reboots).
  - Creates campus_nav and campus_nav_test if missing, enables PostGIS.
  - Runs backend migrations + SMVITM seed.
  - Opens backend (port 4000) and frontend (port 5173) in separate windows.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1
    powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -Reset   # wipes local DB data first
#>
param(
  [switch]$Reset,
  [int]$PgPort = 55432,
  [int]$BackendPort = 4000
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path (Join-Path $pgBin 'pg_ctl.exe'))) {
  $found = Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter pg_ctl.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $found) { throw 'PostgreSQL installation not found. Install PostgreSQL 14+ with PostGIS first.' }
  $pgBin = Split-Path $found.FullName
}

$dataDir = Join-Path $env:LOCALAPPDATA 'campus-nav\pgdata'
$logFile = Join-Path $env:LOCALAPPDATA 'campus-nav\pg.log'
New-Item -ItemType Directory -Force -Path (Split-Path $dataDir) | Out-Null

if ($Reset -and (Test-Path $dataDir)) {
  Write-Host 'Resetting local PostgreSQL data directory...' -ForegroundColor Yellow
  & "$pgBin\pg_ctl.exe" -D $dataDir -m fast stop 2>$null | Out-Null
  Remove-Item -Recurse -Force $dataDir
}

if (-not (Test-Path (Join-Path $dataDir 'PG_VERSION'))) {
  Write-Host 'Initializing local PostgreSQL cluster...' -ForegroundColor Cyan
  & "$pgBin\initdb.exe" -D $dataDir -U postgres -E UTF8 --locale=C | Out-Null
  $hba = Join-Path $dataDir 'pg_hba.conf'
  (Get-Content $hba) -replace 'scram-sha-256', 'trust' -replace 'md5', 'trust' | Set-Content $hba
}

$status = & "$pgBin\pg_ctl.exe" -D $dataDir status 2>&1
if ($status -notmatch 'server is running') {
  Write-Host "Starting PostgreSQL on port $PgPort..." -ForegroundColor Cyan
  & "$pgBin\pg_ctl.exe" -D $dataDir -o "-p $PgPort" -l $logFile start | Out-Null
  Start-Sleep -Seconds 3
}

function Invoke-Psql {
  param([string]$Database, [string]$Sql)
  & "$pgBin\psql.exe" -h localhost -p $PgPort -U postgres -d $Database -v ON_ERROR_STOP=1 -c $Sql
}

$exists = (& "$pgBin\psql.exe" -h localhost -p $PgPort -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='campus_nav'" 2>$null).Trim()
if ($exists -ne '1') {
  Write-Host 'Creating campus_nav database...' -ForegroundColor Cyan
  Invoke-Psql -Database postgres -Sql 'CREATE DATABASE campus_nav;'
}

$existsTest = (& "$pgBin\psql.exe" -h localhost -p $PgPort -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='campus_nav_test'" 2>$null).Trim()
if ($existsTest -ne '1') {
  Write-Host 'Creating campus_nav_test database...' -ForegroundColor Cyan
  Invoke-Psql -Database postgres -Sql 'CREATE DATABASE campus_nav_test;'
}

Write-Host 'Enabling PostGIS extensions...' -ForegroundColor Cyan
Invoke-Psql -Database campus_nav -Sql 'CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm;' | Out-Null
Invoke-Psql -Database campus_nav_test -Sql 'CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm;' | Out-Null

$env:DATABASE_URL = "postgresql://postgres@localhost:$PgPort/campus_nav"
Push-Location (Join-Path $repoRoot 'backend')
Write-Host 'Running migrations...' -ForegroundColor Cyan
npm run migrate
Write-Host 'Seeding SMVITM data...' -ForegroundColor Cyan
npm run seed:smvitm
Pop-Location

Write-Host 'Starting backend and frontend...' -ForegroundColor Green
$backendCmd = "cd '$(Join-Path $repoRoot 'backend')'; `$env:DATABASE_URL='postgresql://postgres@localhost:$PgPort/campus_nav'; npm run dev"
$frontendCmd = "cd '$(Join-Path $repoRoot 'frontend')'; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', $backendCmd
Start-Process powershell -ArgumentList '-NoExit', '-Command', $frontendCmd

Write-Host ''
Write-Host "PostgreSQL: localhost:$PgPort  (data: $dataDir)" -ForegroundColor Green
Write-Host 'Backend:    http://localhost:4000/api/health' -ForegroundColor Green
Write-Host 'Frontend:   http://localhost:5173' -ForegroundColor Green
Write-Host ''
Write-Host 'Admin login: admin@smvitm.ac.in / SMVITMAdmin@2024 (forced password change may apply)' -ForegroundColor Yellow