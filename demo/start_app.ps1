$python = Join-Path $PSScriptRoot ".venv312\Scripts\python.exe"

$alreadyRunning = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq "python.exe" -and $_.CommandLine -like "*uvicorn main:app*" }

if ($alreadyRunning) {
    Write-Output "FastAPI app is already running on http://127.0.0.1:8000"
    exit 0
}

$process = Start-Process -FilePath $python `
    -ArgumentList "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory $PSScriptRoot `
    -PassThru `
    -WindowStyle Hidden

Start-Sleep -Seconds 3
Write-Output "FastAPI app started. PID: $($process.Id)"
