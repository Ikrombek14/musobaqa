#!/usr/bin/env bash
# ============================================================
# Serverda yangilash. GitHub Actions shu skriptni chaqiradi.
#
#   bash scripts/ci-deploy.sh <commit-sha>
#
# ⚠️ Nega alohida fayl, ssh ichidagi heredoc emas:
#    `docker compose run` STDIN dan oʻqiydi. Skript ssh ga heredoc
#    orqali berilsa, compose skriptning qolgan qismini yutib yuboradi
#    va undan keyingi buyruqlar BAJARILMAY qoladi — ssh esa 0 qaytaradi.
#    Natijada deploy «muvaffaqiyatli» boʻlib koʻrinadi, aslida esa
#    konteyner qayta yaratilmagan. Aynan shu ikki marta sodir boʻlgan.
#
#    Shu sababdan quyida har bir compose buyrugʻiga `</dev/null`
#    qoʻshilgan — zaxira himoya.
# ============================================================
set -euo pipefail

GIT_SHA="${1:?commit SHA kerak: bash scripts/ci-deploy.sh <sha>}"
cd "$(dirname "$0")/.."

export GIT_SHA
export BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "Obraz yigʻilmoqda ($GIT_SHA)"
docker compose build app </dev/null

# ============================================================
# Migratsiyadan OLDIN zaxira — maʼlumot yoʻqolmasligi kafolati.
#
# `backup` konteyneri har 10 daqiqada nusxa oladi, lekin migratsiya
# aynan ikki nusxa orasida ishga tushsa, xato boʻlganda 10 daqiqalik
# maʼlumot yoʻqoladi. Musobaqa kunida bu — oʻnlab yozilgan natija.
# Shuning uchun har deploy'da, migratsiyadan avval alohida nusxa.
#
# Zaxira olinmasa deploy TOʻXTAYDI: zaxirasiz migratsiya qilishdan
# koʻra deploy qilmagan yaxshi.
# ============================================================
step "Migratsiyadan oldin zaxira"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

mkdir -p backups
BACKUP_FILE="backups/pre-migrate-$(date +%Y%m%d-%H%M%S).sql"

if docker compose exec -T db pg_dump -U "${POSTGRES_USER:-musobaqa_app}" \
	"${POSTGRES_DB:-musobaqa}" >"$BACKUP_FILE" 2>backups/last-error.log </dev/null; then
	SIZE=$(wc -c <"$BACKUP_FILE")
	if [ "$SIZE" -lt 100 ]; then
		echo "  ✗ zaxira boʻsh chiqdi ($SIZE bayt) — migratsiya qilinmaydi"
		exit 1
	fi
	echo "  ✓ $BACKUP_FILE · $SIZE bayt"
else
	echo "  ✗ zaxira olinmadi — deploy toʻxtatildi:"
	tail -5 backups/last-error.log
	exit 1
fi

# Oxirgi 30 ta migratsiya-oldi nusxasi saqlanadi
ls -1t backups/pre-migrate-*.sql 2>/dev/null | tail -n +31 | while read -r old; do
	rm -f "$old"
done

step "Migratsiyalar"
# --build: `run` mavjud obrazni qayta ishlatadi, yangi migratsiya
# eski obrazda boʻlmay jimgina oʻtkazib yuborilishi mumkin
docker compose run --rm --build -T tools npm run db:migrate:ci </dev/null

step "Ilova qayta ishga tushmoqda"
docker compose up -d db backup </dev/null
# --force-recreate: obraz yangilangan boʻlsa ham `up -d` konteynerni
# har doim qayta yaratmaydi
docker compose up -d --force-recreate --no-deps app </dev/null

step "Javob berishi tekshirilmoqda"
for i in $(seq 1 30); do
	if docker compose exec -T app node -e \
		"fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
		</dev/null 2>/dev/null; then
		echo "  ✓ javob bermoqda"
		break
	fi
	if [ "$i" -eq 30 ]; then
		echo "  ✗ koʻtarilmadi:"
		docker compose logs --tail=50 app </dev/null
		exit 1
	fi
	sleep 2
done

step "Versiya tekshirilmoqda"
RUNNING=$(docker compose exec -T app node -e \
	"fetch('http://127.0.0.1:3000/api/version').then(r=>r.json()).then(v=>console.log(v.sha)).catch(()=>{console.log('xato');process.exit(1)})" \
	</dev/null)

echo "  kutilgan: $GIT_SHA"
echo "  serverda: $RUNNING"

if [ "$RUNNING" != "$GIT_SHA" ]; then
	echo "  ✗ ESKI VERSIYA ISHLAB TURIBDI — deploy amalda boʻlmadi"
	exit 1
fi

printf '\n\033[32m✓ Deploy tugadi\033[0m\n'
