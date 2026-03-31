#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/srv/ai-workflow"
MID_ROOT="$APP_ROOT/ai-mid-platform"
WF003_ROOT="$APP_ROOT/WF-003/car-export-portal"

echo "[1/7] Updating source"
cd "$APP_ROOT"
git pull

echo "[2/7] Installing mid-platform dependencies"
cd "$MID_ROOT"
npm install

echo "[3/7] Building mid-platform"
npm run build

echo "[4/7] Installing WF-003 portal dependencies"
cd "$WF003_ROOT"
npm install

echo "[5/7] Installing systemd service"
sudo cp "$APP_ROOT/deploy/systemd/wf003-car-export.service" /etc/systemd/system/wf003-car-export.service

echo "[6/7] Reloading services"
sudo systemctl daemon-reload
sudo systemctl restart ai-mid-platform
sudo systemctl enable wf003-car-export
sudo systemctl restart wf003-car-export

echo "[7/7] Service status"
sudo systemctl --no-pager --full status ai-mid-platform || true
sudo systemctl --no-pager --full status wf003-car-export || true

echo "WF-003 deploy finished."
