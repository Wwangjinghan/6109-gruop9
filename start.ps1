# AgentIntent Protocol - One-click startup
$env:PATH = "$env:USERPROFILE\.foundry\bin;$env:PATH"
$Root = $PSScriptRoot

Write-Host "Starting AgentIntent Protocol..." -ForegroundColor Cyan

# Kill anything already on these ports
foreach ($port in @(8545, 3001, 3000)) {
    $pids = netstat -ano | Select-String ":$port\s" | ForEach-Object {
        ($_ -split '\s+')[-1]
    } | Sort-Object -Unique
    foreach ($p in $pids) {
        if ($p -match '^\d+$' -and $p -ne '0') {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    }
}
Start-Sleep -Seconds 1

# Window 1: Anvil
Write-Host "[1/4] Starting Anvil (local blockchain)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "`$env:PATH='$env:USERPROFILE\.foundry\bin;`$env:PATH'; anvil --block-time 1 --chain-id 31337" `
    -WindowStyle Normal

# Wait for Anvil
Write-Host "      Waiting for Anvil..." -ForegroundColor Gray
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:8545" -Method POST `
            -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' `
            -ContentType "application/json" -TimeoutSec 2 -ErrorAction Stop
        if ($r.result) { $ready = $true; break }
    } catch {}
}
if (-not $ready) { Write-Host "Anvil failed to start!" -ForegroundColor Red; exit 1 }
Write-Host "      Anvil ready." -ForegroundColor Green

# Deploy contracts and capture output to parse addresses
Write-Host "[2/4] Deploying contracts..." -ForegroundColor Yellow
$env:PRIVATE_KEY     = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
$env:BUNDLER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
Push-Location "$Root\contracts"
$deployOut = forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast 2>&1
Pop-Location

# Parse deployed addresses from forge output
$epLine            = $deployOut | Select-String "ENTRY_POINT_ADDRESS="    | Select-Object -Last 1
$accountLine       = $deployOut | Select-String "ACCOUNT_ADDRESS="         | Select-Object -Last 1
$registryLine      = $deployOut | Select-String "REGISTRY_ADDRESS="        | Select-Object -Last 1
$agentRegistryLine = $deployOut | Select-String "AGENT_REGISTRY_ADDRESS="  | Select-Object -Last 1

if (-not $epLine -or -not $accountLine -or -not $registryLine -or -not $agentRegistryLine) {
    Write-Host "Deploy failed! Output:" -ForegroundColor Red
    $deployOut | Select-Object -Last 20
    exit 1
}

$ENTRY_POINT    = ($epLine            -split "ENTRY_POINT_ADDRESS=\s*")[1].Trim()
$ACCOUNT        = ($accountLine       -split "ACCOUNT_ADDRESS=\s*")[1].Trim()
$REGISTRY       = ($registryLine      -split "REGISTRY_ADDRESS=\s*")[1].Trim()
$AGENT_REGISTRY = ($agentRegistryLine -split "AGENT_REGISTRY_ADDRESS=\s*")[1].Trim()
Write-Host "      EntryPoint:    $ENTRY_POINT"    -ForegroundColor Gray
Write-Host "      Account:       $ACCOUNT"        -ForegroundColor Gray
Write-Host "      Registry:      $REGISTRY"       -ForegroundColor Gray
Write-Host "      AgentRegistry: $AGENT_REGISTRY" -ForegroundColor Gray

# Fund EntryPoint deposit
Write-Host "      Funding gas deposit..." -ForegroundColor Gray
cast send --value 1ether `
    --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 `
    --rpc-url http://127.0.0.1:8545 `
    $ENTRY_POINT "depositTo(address)" $ACCOUNT 2>&1 | Out-Null
Write-Host "      Contracts deployed." -ForegroundColor Green

# Write relayer .env with dynamic addresses
$envContent = @"
PORT=3001
CHAIN=foundry
RPC_URL=http://127.0.0.1:8545
RELAYER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
ENTRY_POINT_ADDRESS=$ENTRY_POINT
ACCOUNT_ADDRESS=$ACCOUNT
REGISTRY_ADDRESS=$REGISTRY
AGENT_REGISTRY_ADDRESS=$AGENT_REGISTRY
SWAP_ROUTER_ADDRESS=0x0000000000000000000000000000000000000001
BATCH_SIZE=5
BATCH_WINDOW_MS=5000
MAX_CONCURRENT=3
LOG_LEVEL=info
SIMULATOR_AGENT_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
SIMULATOR_RELAYER_URL=http://localhost:3001
SIMULATOR_USER_ID=agent-sim-user-1
SIMULATOR_TOKEN_IN=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
SIMULATOR_TOKEN_OUT=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
SIMULATOR_AMOUNT_PER_INTERVAL=1000000
SIMULATOR_INTERVAL_SECONDS=86400
SIMULATOR_TOTAL_INTERVALS=7
SIMULATOR_CONDITION_TYPE=BELOW
SIMULATOR_THRESHOLD_USD=2000
SIMULATOR_PERCENT=5
SIMULATOR_PRICE_FEED=mock
SIMULATOR_MOCK_INITIAL_PRICE=2500
SIMULATOR_MOCK_DRIFT_PERCENT=-1
SIMULATOR_POLL_INTERVAL_MS=5000
SIMULATOR_COOLDOWN_MS=10000
"@
Set-Content -Path "$Root\relayer\.env" -Value $envContent -Encoding utf8

# Build relayer if dist is missing or stale
if (-not (Test-Path "$Root\relayer\dist\index.js")) {
    Write-Host "      Building relayer..." -ForegroundColor Gray
    Push-Location "$Root\relayer"; npm run build 2>&1 | Out-Null; Pop-Location
}

# Window 2: Relayer
Write-Host "[3/4] Starting Relayer..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "Set-Location '$Root\relayer'; node dist/index.js" `
    -WindowStyle Normal

for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    try {
        Invoke-RestMethod -Uri "http://localhost:3001/health" -TimeoutSec 2 -ErrorAction Stop | Out-Null
        break
    } catch {}
}
Write-Host "      Relayer ready." -ForegroundColor Green

# Window 3: Frontend
Write-Host "[4/4] Starting Frontend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "Set-Location '$Root\frontend'; npx next dev --port 3000" `
    -WindowStyle Normal

Write-Host "      Waiting for frontend..." -ForegroundColor Gray
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 2 -ErrorAction Stop | Out-Null
        break
    } catch {}
}

Write-Host ""
Write-Host "All services running!" -ForegroundColor Green
Write-Host "  http://localhost:3000           <- Intent form" -ForegroundColor Cyan
Write-Host "  http://localhost:3000/dashboard <- Dashboard"   -ForegroundColor Cyan
Write-Host ""
Start-Process "http://localhost:3000"
