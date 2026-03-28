$exe = "C:\Users\Administrator\tools\heidisql\app\heidisql.exe"

if (-not (Test-Path $exe)) {
    Write-Error "HeidiSQL executable was not found: $exe"
    exit 1
}

$args = @(
    '-d=Auth Demo Local'
    '-h="127.0.0.1"'
    '-P=3306'
    '-u=root'
    '-p=RootDemo123!'
    '-l=libmysql.dll'
    '-n=0'
)

$process = Start-Process -FilePath $exe -ArgumentList $args -PassThru
Write-Output "HeidiSQL started and connected. PID: $($process.Id)"
