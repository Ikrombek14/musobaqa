#!/usr/bin/env bash
# ============================================================
# VPS'da ishga tushirish / yangilash.
#
#   ./scripts/deploy.sh
#
# Idempotent: qayta-qayta ishlatsa boʻladi. Baza maʼlumoti
# saqlanib qoladi, faqat kod va migratsiyalar yangilanadi.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -f .env ] || fail ".env fayli yoʻq. Namunadan nusxa oling: cp .env.example .env"

# Boʻsh qolgan majburiy qiymatlarni oldindan ushlaymiz — yarim
# koʻtarilgan stack'ni tuzatgandan koʻra shu yerda toʻxtash arzon.
step "Sozlamalar tekshirilmoqda"
missing=()
for key in DOMAIN POSTGRES_PASSWORD SESSION_SECRET ADMIN_PASSWORD; do
	value=$(grep -E "^${key}=" .env | cut -d= -f2- || true)
	[ -z "$value" ] && missing+=("$key")
done
[ ${#missing[@]} -gt 0 ] && fail ".env da toʻldirilmagan: ${missing[*]}"

secret=$(grep -E "^SESSION_SECRET=" .env | cut -d= -f2-)
[ ${#secret} -lt 32 ] && fail "SESSION_SECRET kamida 32 belgi boʻlishi kerak"
echo "  hammasi joyida"

step "Obrazlar yigʻilmoqda"
docker compose build

step "Baza koʻtarilmoqda"
docker compose up -d db
docker compose exec -T db sh -c 'until pg_isready -q; do sleep 1; done'
echo "  baza tayyor"

step "Migratsiyalar qoʻllanmoqda"
docker compose run --rm tools npm run db:migrate:ci

step "Ilova ishga tushmoqda"
docker compose up -d app backup

# 80/443 boʻsh boʻlsa oʻz Caddy'mizni ham koʻtaramiz. Band boʻlsa —
# serverda boshqa reverse proxy bor, u `app` ning host portiga
# yoʻnaltirilgan boʻlishi kerak.
if ss -tln 2>/dev/null | grep -qE ':(80|443)\s'; then
	echo "  80/443 band — mavjud reverse proxy ishlatiladi"
	echo "  ilova porti: ${APP_PORT:-4600}"
else
	step "Caddy ishga tushmoqda (HTTPS)"
	docker compose --profile own-proxy up -d caddy
fi

step "Holat tekshirilmoqda"
for i in $(seq 1 30); do
	if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
		echo "  ilova javob bermoqda"
		break
	fi
	[ "$i" -eq 30 ] && fail "ilova koʻtarilmadi — docker compose logs app"
	sleep 2
done

DOMAIN=$(grep -E "^DOMAIN=" .env | cut -d= -f2-)
printf '\n\033[32m✓ Tayyor\033[0m\n'
printf '  Sayt:        https://%s\n' "$DOMAIN"
printf '  Admin:       https://%s/admin\n' "$DOMAIN"
printf '  Hakam:       https://%s/hakam\n' "$DOMAIN"
printf '  Jonli tablo: https://%s/jonli\n\n' "$DOMAIN"
printf '  Loglar:      docker compose logs -f app\n'
printf '  Zaxiralar:   ls -lt backups/ | head\n\n'
