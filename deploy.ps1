# ChemCanvas AI ? Oracle Server Deploy Script
# Usage: .\deploy.ps1
# Builds on the server ? no local Node.js required.
param([string]$ApiKey = "")

$KEY    = "C:\Users\acer\Desktop\capstone_gala\ssh-key-2026-05-20 (1).key"
$REMOTE = "ubuntu@168.107.10.156"
$sshExe = (Get-Command ssh -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$scpExe = (Get-Command scp -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source

function RemoteSsh([string]$cmd) {
    & $sshExe -i $KEY -o StrictHostKeyChecking=no $REMOTE $cmd
}
function RemoteScp([string]$src, [string]$dst) {
    & $scpExe -i $KEY -o StrictHostKeyChecking=no -r $src "${REMOTE}:${dst}"
}

Write-Host "=== ChemCanvas AI Deploy ===" -ForegroundColor Cyan

# ?? 1. Upload source files ???????????????????????????????????
Write-Host "[1/5] Uploading source files..." -ForegroundColor Yellow

RemoteSsh "mkdir -p /tmp/chemcanvas/frontend/src/scene /tmp/chemcanvas/frontend/src/chat /tmp/chemcanvas/frontend/src/api /tmp/chemcanvas/server/mocks /tmp/chemcanvas/server/prompts"

# Frontend
RemoteScp "$PSScriptRoot\frontend\index.html"           "/tmp/chemcanvas/frontend/"
RemoteScp "$PSScriptRoot\frontend\package.json"         "/tmp/chemcanvas/frontend/"
RemoteScp "$PSScriptRoot\frontend\vite.config.js"       "/tmp/chemcanvas/frontend/"
RemoteScp "$PSScriptRoot\frontend\src\App.js"           "/tmp/chemcanvas/frontend/src/"
RemoteScp "$PSScriptRoot\frontend\src\api\client.js"    "/tmp/chemcanvas/frontend/src/api/"
RemoteScp "$PSScriptRoot\frontend\src\scene\SceneManager.js"  "/tmp/chemcanvas/frontend/src/scene/"
RemoteScp "$PSScriptRoot\frontend\src\scene\AtomFactory.js"   "/tmp/chemcanvas/frontend/src/scene/"
RemoteScp "$PSScriptRoot\frontend\src\scene\BondFactory.js"   "/tmp/chemcanvas/frontend/src/scene/"
RemoteScp "$PSScriptRoot\frontend\src\chat\ChatPanel.js"      "/tmp/chemcanvas/frontend/src/chat/"

# Server
RemoteScp "$PSScriptRoot\server\index.js"               "/tmp/chemcanvas/server/"
RemoteScp "$PSScriptRoot\server\orchestrator.js"        "/tmp/chemcanvas/server/"
RemoteScp "$PSScriptRoot\server\package.json"           "/tmp/chemcanvas/server/"
RemoteScp "$PSScriptRoot\server\mocks\pubchem.js"       "/tmp/chemcanvas/server/mocks/"
RemoteScp "$PSScriptRoot\server\prompts\system.txt"     "/tmp/chemcanvas/server/prompts/"

Write-Host "   Files uploaded." -ForegroundColor Green

# ?? 2. Install Node.js + PM2 on server (if needed) ??????????
Write-Host "[2/5] Checking Node.js + PM2 on server..." -ForegroundColor Yellow
RemoteSsh 'if ! command -v node &>/dev/null; then curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs; fi && node -v'
RemoteSsh 'sudo npm install -g pm2 --quiet 2>/dev/null; pm2 -v'

# ?? 3. Build frontend on server ??????????????????????????????
Write-Host "[3/5] Building frontend on server..." -ForegroundColor Yellow
RemoteSsh 'cd /tmp/chemcanvas/frontend && npm install --quiet && npm run build'
RemoteSsh 'sudo cp -r /tmp/chemcanvas/frontend/dist/. /var/www/html/ && sudo chown -R www-data:www-data /var/www/html && echo "Frontend copied to /var/www/html"'

# ?? 4. Deploy server app ?????????????????????????????????????
Write-Host "[4/5] Deploying server app..." -ForegroundColor Yellow
RemoteSsh 'sudo mkdir -p /var/www/chemcanvas && sudo cp -r /tmp/chemcanvas/server/. /var/www/chemcanvas/ && cd /var/www/chemcanvas && sudo npm install --omit=dev --quiet && echo "Server deps installed"'

# .env ?? (?? ??? ???? ?? ???? ??)
RemoteSsh 'test -f /var/www/chemcanvas/.env && echo ".env already exists, keeping it." || (sudo cp /var/www/chemcanvas/.env.example /var/www/chemcanvas/.env && echo ".env created from example ? add GEMINI_API_KEY")'

# ?? 5. Configure nginx + PM2 ?????????????????????????????????
Write-Host "[5/5] Configuring nginx and PM2..." -ForegroundColor Yellow

$nginxConf = @'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    root /var/www/html;
    index index.html;
    server_name _;

    location /api/ {
        proxy_pass http://localhost:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
'@
$tmpNginx = [System.IO.Path]::GetTempFileName()
# BOM ?? ?? (nginx? BOM ???)
[System.IO.File]::WriteAllText($tmpNginx, $nginxConf, [System.Text.UTF8Encoding]::new($false))
& $scpExe -i $KEY -o StrictHostKeyChecking=no $tmpNginx "${REMOTE}:/tmp/chemcanvas_nginx.conf"
Remove-Item $tmpNginx

RemoteSsh 'sudo cp /tmp/chemcanvas_nginx.conf /etc/nginx/sites-available/default && sudo nginx -t && sudo systemctl reload nginx && echo "nginx reloaded"'

# PM2
RemoteSsh 'cd /var/www/chemcanvas && (pm2 describe chemcanvas-server > /dev/null 2>&1 && pm2 restart chemcanvas-server --update-env || pm2 start index.js --name chemcanvas-server) && pm2 save && echo "PM2 started"'
RemoteSsh 'sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null | grep sudo | bash 2>/dev/null; echo done'

# Cleanup
RemoteSsh 'rm -rf /tmp/chemcanvas /tmp/chemcanvas_nginx.conf'

Write-Host ""
Write-Host "=== Deploy Complete ===" -ForegroundColor Green
Write-Host "Frontend : http://168.107.10.156" -ForegroundColor Cyan
Write-Host "Health   : http://168.107.10.156/api/health" -ForegroundColor Cyan

# Quick health check
Start-Sleep -Seconds 3
try {
    $r = Invoke-WebRequest -Uri "http://168.107.10.156/api/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "Health OK: $($r.Content)" -ForegroundColor Green
} catch {
    Write-Host "Health check failed (server may still be starting)" -ForegroundColor Yellow
}
