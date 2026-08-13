# Musobaqa

Toʻrt yoʻnalishli robototexnika musobaqasi uchun tizim: roʻyxatdan oʻtkazish,
jerebyovka, hakamlik va jonli natijalar.

**Musobaqa sanasi:** 16-avgust 2026
**Manzil:** https://musobaqa.robbitonline.uz

| Yoʻnalish | Format | Raqam |
|---|---|---|
| Robofutbol | Guruh (round-robin) + pleyoff, 3/1/0 ochko | `R01` |
| Sumo | Olib tashlash, 3 tadan 2 | `S01` |
| Linefollower | 2 urinish, eng yaxshisi, yoʻldan chiqish +5 s | `L01` |
| Robrace | Olib tashlash, bitta raund | `RR01` |

---

## Sahifalar

| Yoʻl | Kim uchun |
|---|---|
| `/` | Hamma — musobaqa haqida |
| `/jonli` · `/jonli/[yoʻnalish]` | Jonli tablo (TV va telefon) |
| `/hakam` | Hakamlar — PIN bilan kirish |
| `/admin` | Boshqaruv markazi — real vaqtda hamma narsa |
| `/admin/checkin` | Roʻyxatdan oʻtkazish stoli |
| `/admin/jamoalar` | Barcha jamoalar, qidiruv, tahrirlash, CSV |
| `/admin/draw` | Jerebyovka |
| `/admin/juftliklar` | Kim bilan kim tushgani |
| `/admin/hakamlar` | Hakamlar CRUD, PIN |
| `/admin/sozlamalar` | Maydonlar soni, guruh oʻlchami, guruh→maydon |

---

## Lokal ishga tushirish

Kerak: Node 24+, PostgreSQL 18 (yoki Docker).

```bash
npm install
cp .env.example .env.local      # DATABASE_URL, SESSION_SECRET, ADMIN_PASSWORD
npm run db:migrate
npm run db:seed                 # 60 namuna jamoa, 9 hakam
npm run dev                     # http://localhost:3000
```

Seed hakam PIN kodlarini terminalga chiqaradi. Admin paroli — `.env.local`
dagi `ADMIN_PASSWORD`.

> Webcam `localhost` da ishlaydi. Boshqa qurilmadan kirish uchun HTTPS
> shart — VPS'da Caddy buni hal qiladi.

---

## Sinovlar

```bash
npm run verify          # mantiq: jerebyovka, raqamlash, avtomatik turlar
npm run start:e2e       # 3100 portda production server (alohida terminal)
npm run e2e             # 32 ta brauzer sinovi
```

E2E **production build**ga uriladi, dev serverga emas: dev rejimda Next
sahifani soʻrov paytida kompilyatsiya qiladi va sinovlar yolgʻon xato beradi.

Har bir E2E sinov konsol xatolari va HTTP 500 javoblarni ham kuzatadi —
jimgina yuzaga kelgan xato ham sinovni yiqitadi.

---

## VPS'ga chiqarish

**Kerak:** Ubuntu 22.04+, 2 GB RAM, 2 vCPU, Docker + Compose, DNS A-record
domenni VPS IP'siga yoʻnaltirgan boʻlishi.

```bash
git clone <repo> qara && cd qara
cp .env.example .env && nano .env     # DOMAIN va uchta parolni toʻldiring
chmod +x scripts/deploy.sh scripts/backup.sh
./scripts/deploy.sh
```

Skript: obrazlarni yigʻadi → bazani koʻtaradi → migratsiyalarni qoʻllaydi →
ilova va Caddy'ni ishga tushiradi → javob berishini tekshiradi.

Parol yaratish:
```bash
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -base64 32   # SESSION_SECRET
```

### Yangilash

```bash
git pull && ./scripts/deploy.sh
```

Baza maʼlumoti saqlanadi.

---

## Musobaqa kuni

### Ertalab (ochilishdan 1 soat oldin)

- [ ] `docker compose ps` — hammasi `Up (healthy)`
- [ ] `https://<domen>/admin` ochiladi, parol ishlaydi
- [ ] `/admin/hakamlar` — har maydonga hakam biriktirilgan, PIN kodlar
      chop etilgan va tarqatilgan
- [ ] `/admin/sozlamalar` — har yoʻnalishda maydonlar soni toʻgʻri
- [ ] Bitta telefondan `/hakam` ga kirib koʻring — PIN ishlayaptimi
- [ ] TV ekranda `/jonli` — «Jonli» indikatori **yashil** boʻlsin
- [ ] `ls -lt backups/` — oxirgi nusxa 10 daqiqadan eski emas

### Roʻyxatdan oʻtkazish

`/admin/checkin` — qidiruv → «Keldi» → surat → raqam.
Roʻyxatda yoʻq jamoa oʻsha yerda qoʻshiladi.

Raqam **check-in paytida** beriladi: kelmagan jamoa raqamni band qilmaydi.

### Jerebyovka

`/admin/draw` → yoʻnalish → tasdiq. Faqat check-in qilinganlar qatnashadi.
Seed saqlanadi — nizo chiqsa natijani qayta hisoblab isbotlash mumkin.

Natija yozilgandan keyin jerebyovkani bekor qilib boʻlmaydi.

### Musobaqa davomida

`/admin` ekranini ochiq qoldiring — qaysi maydonda nima boʻlayotgani,
oxirgi natijalar va kim yozgani koʻrinib turadi.

**Keyingi turlar avtomatik ochiladi.** Hakam oxirgi natijani yozishi bilan
keyingi bosqich oʻyinlariga maydon biriktiriladi va ular hakam ekranida
oʻzi paydo boʻladi. Robofutbolda guruh bosqichi tugagach pleyoff oʻzi
tuziladi (har guruhdan top-2).

---

## Muammo boʻlsa

| Belgi | Nima qilish |
|---|---|
| Tabloda «Ulanish yoʻq» | `docker compose logs app \| tail -50`. Brauzer oʻzi qayta ulanadi, natija yoʻqolmaydi. |
| Natija tabloda koʻrinmayapti | `docker compose logs app \| grep realtime`. `LISTEN faol` boʻlishi kerak. |
| Hakam oʻyinini koʻrmayapti | `/admin/sozlamalar` — maydon soni; `/admin/hakamlar` — hakam qaysi maydonga biriktirilgan |
| Kamera ochilmayapti | HTTPS ishlayaptimi? Brauzer ruxsat berilganmi? |
| Sekinlashdi | `docker stats` — RAM. Postgres 512 MB `shared_buffers` bilan sozlangan. |

### Zaxiradan tiklash

```bash
ls -lt backups/
docker compose exec -T db psql -U qara_app -d qara < backups/qara-20260816-0930.sql
```

Ilovani qayta ishga tushirish **shart emas** — realtime id ketma-ketligi
qayta boshlanganini oʻzi aniqlaydi va tiklanadi.

---

## Texnologiyalar

Next.js 16 (App Router, Server Actions) · React 19 · TypeScript ·
PostgreSQL 18 + Drizzle · Tailwind v4 · Docker Compose + Caddy

**Realtime:** Postgres `LISTEN/NOTIFY` → bitta Node ulanishi → SSE.
Har bir tomoshabin uchun alohida baza ulanishi ochilmaydi; hodisalar
100 ms oynada toʻplanadi. Redis ham, WebSocket server ham kerak emas.

**Raqamlash:** `allocate_team_number` funksiyasi `FOR UPDATE` qulfi ostida —
ikki stol ayni soniyada check-in qilsa ham raqam takrorlanmaydi.
