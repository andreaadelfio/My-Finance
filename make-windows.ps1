# Equivalente Windows del Makefile: .\make dev | .\make stop | .\make git
param(
  [ValidateSet("all", "dev", "stop", "git")]
  [string]$Target = "all",
  [int]$Port = 8002,
  [string]$HostName = "127.0.0.1",
  [string]$SiteDir = $PSScriptRoot
)

$url = "http://${HostName}:${Port}/index.html"

function Get-ServerPid {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
}

function Invoke-Dev {
  if (Get-ServerPid) {
    Write-Host "Server già attivo sulla porta $Port"
  } else {
    Write-Host "Avvio server su $url"
    Start-Process python -ArgumentList "-m", "http.server", $Port, "--bind", $HostName, "--directory", "`"$SiteDir`"" -WindowStyle Hidden
    Start-Sleep -Milliseconds 700
  }
  Start-Process $url
}

function Invoke-Stop {
  $ids = Get-ServerPid
  if ($ids) {
    $ids | ForEach-Object { Stop-Process -Id $_ -Force }
    Write-Host "Server fermato sulla porta $Port"
  } else {
    Write-Host "Nessun server trovato sulla porta $Port"
  }
}

function Invoke-Git {
  Push-Location $PSScriptRoot
  try {
    git add --all
    git commit -m "Updated website at $(Get-Date -Format 'ddd MMM d HH:mm:ss yyyy')"
    git push
  } finally {
    Pop-Location
  }
}

switch ($Target) {
  "dev"  { Invoke-Dev }
  "stop" { Invoke-Stop }
  default { Invoke-Git }
}
