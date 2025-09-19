param(
  [string]$Source = "assets/zebra-agent.ps1",
  [string]$Output = "assets/zebra-agent.exe",
  [switch]$NoConsole
)

Write-Host "Building Zebra Agent EXE from $Source -> $Output"
if (-not (Test-Path $Source)) { Write-Error "Source script introuvable: $Source"; exit 1 }

try {
  if (-not (Get-Module -ListAvailable -Name ps2exe)) {
    Write-Host "Installation du module ps2exe..." -ForegroundColor Yellow
    Install-Module ps2exe -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop
  }
  Import-Module ps2exe -ErrorAction Stop
} catch {
  Write-Error "Impossible d'installer/charger ps2exe: $($_.Exception.Message)"; exit 1
}

$params = @{
  inputFile  = (Resolve-Path $Source)
  outputFile = (Resolve-Path $Output)
  title      = 'Zebra Local Agent'
  description= 'HTTP listener on localhost:9110 to receive ZPL and send to default printer.'
  product    = 'Zebra Local Agent'
  company    = 'Bibliomanager2'
  trademark  = 'Zebra Local Agent'
}
if ($NoConsole) { $params["noConsole"] = $true }

Write-Host "Compilation en cours..."
Invoke-ps2exe @params
Write-Host "EXE créé: $Output"

