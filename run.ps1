# ChemCanvas AI - Local Dev Runner
# Usage: .\run.ps1

$ROOT   = $PSScriptRoot
$SERVER = Join-Path $ROOT "server"
$FRONT  = Join-Path $ROOT "frontend"

# 0. Node.js check
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    pause; exit 1
}

# 1. Kill existing processes on ports 3001 and 5173
function Kill-Port([int]$port) {
    $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        Write-Host "  Killed PID $p on port $port" -ForegroundColor Yellow
    }
}

Write-Host "Releasing ports..." -ForegroundColor Yellow
Kill-Port 3001
Kill-Port 5173
Start-Sleep -Seconds 1

# 2. server/.env setup (UTF-8 without BOM)
$envFile    = Join-Path $SERVER ".env"
$envExample = Join-Path $SERVER ".env.example"
if (-not (Test-Path $envFile)) {
    $content = Get-Content $envExample -Raw
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($envFile, $content, $utf8NoBom)
    Write-Host "Created server/.env from .env.example (UTF-8 no BOM)" -ForegroundColor Yellow
}

# 3. Install deps if needed
if (-not (Test-Path (Join-Path $SERVER "node_modules"))) {
    Write-Host "Installing server packages..." -ForegroundColor Yellow
    Push-Location $SERVER; npm install --quiet; Pop-Location
}
if (-not (Test-Path (Join-Path $FRONT "node_modules"))) {
    Write-Host "Installing frontend packages..." -ForegroundColor Yellow
    Push-Location $FRONT; npm install --quiet; Pop-Location
}

# 4. Start backend in new window
Write-Host "Starting backend (port 3001)..." -ForegroundColor Green
$serverCmd = "Set-Location '$SERVER'; Write-Host '[ChemCanvas] Backend http://localhost:3001' -ForegroundColor Cyan; node index.js"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $serverCmd

# 5. Wait until port 3001 is actually listening (max 10s)
Write-Host "Waiting for backend..." -ForegroundColor Yellow
$ready = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    $conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
    if ($conn) { $ready = $true; break }
}
if ($ready) {
    Write-Host "  Backend ready." -ForegroundColor Green
} else {
    Write-Host "  WARNING: Backend did not start in time. Check the backend window for errors." -ForegroundColor Red
}

# 6. Start Vite in new window
Write-Host "Starting frontend (port 5173)..." -ForegroundColor Green
$frontCmd = "Set-Location '$FRONT'; Write-Host '[ChemCanvas] Frontend http://localhost:5173' -ForegroundColor Cyan; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontCmd

Start-Sleep -Seconds 3

# 7. Open in Chrome
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (Test-Path $chrome) {
    Start-Process $chrome "http://localhost:5173"
} else {
    Start-Process "http://localhost:5173"
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  ChemCanvas AI - Local Dev Running" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Frontend : http://localhost:5173" -ForegroundColor White
Write-Host "  API      : http://localhost:3001/api/health" -ForegroundColor White
Write-Host "  Stop     : Close the two PowerShell windows" -ForegroundColor Gray
