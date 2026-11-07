#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="$(printenv PORT 2>/dev/null || echo 8080)"
if ! command -v python3 >/dev/null 2>&1; then echo 'Can cai Python 3 truoc khi ngat mang.'; exit 1; fi
echo "AutoTax PDF Offline: http://127.0.0.1:$PORT"
echo "Thiet bi LAN: http://IP-MAY-LINUX:$PORT"
echo 'Nhan Ctrl+C de dung'
exec python3 -m http.server "$PORT" --bind 0.0.0.0 --directory .
