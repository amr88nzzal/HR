#!/usr/bin/env bash
# يشغّل النسخ يومياً في الساعة BACKUP_HOUR_UTC (افتراضياً 02) وتحقق الاستعادة أسبوعياً (الأحد)،
# ويكتب حالة آخر تشغيل في $BACKUP_DIR/status.json لتراقبها أنت (انظر docs/RUNBOOK.md).
set -uo pipefail
BACKUP_DIR="${BACKUP_DIR:-/backups}"
HOUR="${BACKUP_HOUR_UTC:-02}"
mkdir -p "$BACKUP_DIR"

status() { # status <kind> <ok|fail> <message>
  printf '{"kind":"%s","result":"%s","at":"%s","message":"%s"}\n' "$1" "$2" "$(date -u +%FT%TZ)" "$3" \
    >"$BACKUP_DIR/status-$1.json"
}

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "today ${HOUR}:00" +%s)
  [ "$next" -le "$now" ] && next=$(date -u -d "tomorrow ${HOUR}:00" +%s)
  echo "التشغيل القادم: $(date -u -d "@$next" +%FT%TZ)"
  sleep $((next - now))

  if /opt/backup/backup.sh; then status backup ok "اكتمل"; else status backup fail "فشل النسخ؛ راجع السجل"; fi
  if [ "$(date -u +%u)" = "7" ]; then
    if out=$(/opt/backup/restore-verify.sh 2>&1); then status restore ok "$(echo "$out" | tail -1)"
    else status restore fail "$(echo "$out" | tail -1)"; fi
  fi
done
