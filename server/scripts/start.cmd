@echo off
REM ============================================================
REM 启动后端服务（读取 server\.env，连接本机 MySQL 8.4 服务）
REM MySQL 已注册为 Windows 服务 MySQL84（开机自启），无需手动启动
REM ============================================================
setlocal
cd /d "%~dp0.."

if not exist ".env" (
  echo [!] .env not found. Copy .env.example to .env and fill in DB settings.
  exit /b 1
)

REM 检查 MySQL 服务是否在运行
sc query MySQL84 | findstr /C:"RUNNING" >nul 2>&1
if errorlevel 1 (
  echo [!] MySQL service MySQL84 is not running. Starting it...
  net start MySQL84 >nul 2>&1
  if errorlevel 1 (
    echo [x] Failed to start MySQL84. Please start it manually as Administrator.
    exit /b 1
  )
  echo [ok] MySQL84 started
)

echo.
echo [*] starting XiCheng server...
echo     front-end : http://127.0.0.1:4500/
echo     admin     : http://127.0.0.1:4500/admin
echo.

node --env-file=.env src/server.js
