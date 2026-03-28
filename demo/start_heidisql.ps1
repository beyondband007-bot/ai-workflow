$exe = "C:\Users\Administrator\tools\heidisql\app\heidisql.exe"

if (-not (Test-Path $exe)) {
    Write-Error "HeidiSQL executable was not found: $exe"
    exit 1
}

$process = Start-Process -FilePath $exe -PassThru
Write-Output "HeidiSQL started. PID: $($process.Id)"
