#!/bin/bash
# Minimal dev-server starter — same survival pattern as dev.sh:
# bun run dev as disowned background child of this script.
cd /home/z/my-project
bun run dev > /dev/null 2>&1 &
DEV_PID=$!
disown "$DEV_PID" 2>/dev/null || true
# সার্ভার প্রস্তুত হওয়া পর্যন্ত অপেক্ষা (এই স্ক্রিপ্ট জীবিত থাকা মাত্র)
for i in $(seq 1 60); do
  if curl -s --connect-timeout 2 --max-time 5 http://localhost:3000/ >/dev/null 2>&1; then
    echo "ready after ${i}s (server pid=$DEV_PID)"
    exit 0
  fi
  sleep 1
done
echo "server failed to become ready"
exit 1
