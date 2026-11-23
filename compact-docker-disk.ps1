# Compacts the Docker Desktop WSL data disk so it gives its empty space back to D:.
# Nothing is deleted: containers, images and volumes (n8n data) stay as they are.
# Run it by right-clicking > "Run with PowerShell" (it asks for administrator rights itself).

$vhdx = "D:\DockerData\disk\docker_data.vhdx"
$dockerExe = "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"

$isAdmin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Asking for administrator rights..."
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

if (-not (Test-Path $vhdx)) { Write-Host "Not found: $vhdx"; Read-Host "Press Enter to close"; exit 1 }

function Show-Size($label) {
    $gb = [math]::Round((Get-Item $vhdx).Length / 1GB, 2)
    $free = [math]::Round((Get-PSDrive D).Free / 1GB, 2)
    Write-Host ("{0}: vhdx = {1} GB, D: free = {2} GB" -f $label, $gb, $free)
}

Show-Size "Before"

Write-Host "Stopping Docker Desktop and WSL..."
Get-Process "Docker Desktop", "com.docker.backend", "com.docker.build", "docker-agent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
wsl.exe --shutdown
Start-Sleep -Seconds 10

$script = @"
select vdisk file="$vhdx"
attach vdisk readonly
compact vdisk
detach vdisk
exit
"@
$tmp = Join-Path $env:TEMP "compact-docker.txt"
Set-Content -Path $tmp -Value $script -Encoding ASCII

Write-Host "Compacting (this can take 5-20 minutes, do not close the window)..."
diskpart.exe /s $tmp
Remove-Item $tmp -ErrorAction SilentlyContinue

Show-Size "After"

Write-Host "Starting Docker Desktop again..."
Start-Process $dockerExe
Read-Host "Done. Press Enter to close"
