$mysqlBase = "C:\Users\Administrator\mysql-local"
$mysqld = Join-Path $mysqlBase "mysql-8.4.8-winx64\bin\mysqld.exe"
$defaults = Join-Path $mysqlBase "my.ini"

$alreadyRunning = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq "mysqld.exe" -and $_.CommandLine -like "*$defaults*" }

if ($alreadyRunning) {
    Write-Output "MySQL is already running on 127.0.0.1:3306"
    exit 0
}

$process = Start-Process -FilePath $mysqld `
    -ArgumentList "--defaults-file=$defaults" `
    -PassThru `
    -WindowStyle Hidden

Start-Sleep -Seconds 3
Write-Output "MySQL started. PID: $($process.Id)"
