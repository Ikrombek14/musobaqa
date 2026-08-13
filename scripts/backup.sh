#!/bin/sh
# ============================================================
# Har 10 daqiqada pg_dump. Musobaqa kuni majburiy.
#
# Nusxalar `./backups` da (host papkasi) — konteyner oʻchsa ham
# qoladi. Oxirgi 48 ta nusxa saqlanadi (~8 soat).
#
# Tiklash:
#   docker compose exec -T db psql -U qara_app -d qara < backups/qara-YYYYmmdd-HHMM.sql
#
# ⚠️ Tiklashdan keyin app konteynerini QAYTA ISHGA TUSHIRISH shart emas:
#    realtime avtomatik oʻzini tiklaydi (id ketma-ketligi qayta
#    boshlanganini oʻzi aniqlaydi).
# ============================================================

set -eu

INTERVAL="${BACKUP_INTERVAL_SECONDS:-600}"
KEEP="${BACKUP_KEEP:-48}"
DIR=/backups

mkdir -p "$DIR"
echo "[backup] boshlandi · har ${INTERVAL}s · oxirgi ${KEEP} nusxa saqlanadi"

while true; do
	STAMP=$(date +%Y%m%d-%H%M)
	FILE="$DIR/qara-$STAMP.sql"

	if pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists > "$FILE.tmp" 2>"$DIR/last-error.log"; then
		mv "$FILE.tmp" "$FILE"
		SIZE=$(wc -c < "$FILE")
		echo "[backup] $STAMP · ${SIZE} bayt"

		# Eskilarini tozalaymiz
		ls -1t "$DIR"/qara-*.sql 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
			rm -f "$old"
		done
	else
		rm -f "$FILE.tmp"
		echo "[backup] XATO — $DIR/last-error.log ga qarang"
	fi

	sleep "$INTERVAL"
done
