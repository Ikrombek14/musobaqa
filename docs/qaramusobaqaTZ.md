# QARA Musobaqa — Texnik Topshiriq

**Musobaqa sanasi:** 16-avgust 2026
**Hujjat sanasi:** 12-avgust 2026
**Holat:** kelishildi, kod yozishga tayyor

---

## 1. Loyihaning vazifasi

To'rt yo'nalishli robototexnika musobaqasi uchun bitta veb-tizim:

1. Ishtirokchilarni Exceldan import qilish va avtomatik raqamlash
2. Musobaqa kuni check-in (robotni webcam orqali suratga olish)
3. Jeребьevka (draw) — har yo'nalish uchun o'z formati bilan
4. Hakamlar uchun natija kiritish paneli
5. Ommaviy jonli tablo — natijalar real vaqtda yangilanadi

**Hajmi:** ~150–400 jamoa, yarmi robofutbolda.

---

## 2. Texnologiyalar

Butun tizim **o'z VPS serverimizda**, tashqi SaaS'ga bog'liqlik yo'q.

| Qatlam | Tanlov | Izoh |
|---|---|---|
| Framework | Next.js 15 (App Router, standalone) + TypeScript | Server Actions — alohida API kerak emas |
| Ma'lumotlar bazasi | **PostgreSQL 16** (o'z serverimizda) | Drizzle ORM + SQL migratsiyalar |
| Realtime | **Postgres `LISTEN/NOTIFY` → SSE** | Redis ham, WebSocket server ham kerak emas |
| Autentifikatsiya | Cookie sessiya (`iron-session`) | Hakam — PIN, admin — parol. Argon2 hash |
| Fayl saqlash | Serverning diski (`/var/qara/uploads`) | 400 surat ≈ 80 MB. Sharp bilan siqiladi |
| UI | Tailwind CSS v4 + shadcn/ui | |
| Excel | SheetJS (`xlsx`) | Server actionda parse |
| Ishga tushirish | Docker Compose + Caddy | Caddy HTTPS'ni avtomatik oladi (webcam uchun shart) |

### Nega LISTEN/NOTIFY + SSE

Hakam natija yozadi → Postgres triggeri `NOTIFY` yuboradi → Node protsessi eshitadi → tabloga ulangan hamma brauzerga SSE orqali uzatiladi (~50 ms).

Klient serverga hech narsa yubormaydi — oqim bir yo'nalishli. Shunday holatda SSE WebSocket'dan sodda: brauzer o'zi qayta ulanadi, oddiy HTTP orqali ketadi, proxy bilan muammo bo'lmaydi. Bitta server bo'lgani uchun Redis backplane ham kerak emas.

### Deploy

```
docker compose up -d     # postgres + app + caddy
```

Bitta `compose.yml` fayl. Ayni shu fayl **VPS'da ham, musobaqa zalidagi noutbukda ham** ishlaydi — internet uzilib qolsa check-in va hakam paneli lokal tarmoqda davom etadi.

**Zaxira:** Postgres har 10 daqiqada `pg_dump` qiladi, nusxa alohida diskda saqlanadi. Musobaqa kuni bu majburiy.

---

## 3. Raqamlash

Har yo'nalish uchun alohida ketma-ketlik. Raqam **check-in paytida** beriladi (importda emas) — kelmagan jamoa raqamni band qilmaydi.

```
Robofutbol   → R01, R02, R03 …
Sumo         → S01, S02 …
Linefollower → L01, L02 …
Robrace      → RR01, RR02 …
```

99 dan oshsa `R100` ga o'tadi. Raqam berish Postgres tranzaksiyasi ichida (`SELECT … FOR UPDATE`) — ikkita stol bir vaqtda check-in qilsa ham takrorlanmaydi.

---

## 4. Yo'nalish qoidalari

### 4.1 Robofutbol — guruh + pleyoff

- Jamoalar guruhlarga bo'linadi (guruh o'lchami admin panelda sozlanadi, default 4)
- Guruh ichida round-robin (har kim har kim bilan)
- **Ochko:** g'alaba 3 · durang 1 · mag'lubiyat 0
- **Teng bo'lsa tartib:** ochko → gol farqi → urgan gollar → shaxsiy uchrashuv
- Har guruhdan top-2 pleyoffga chiqadi
- Pleyoff — single elimination, grid o'lchami avtomatik (kerak bo'lsa bay qo'yiladi)

### 4.2 Sumo — single elimination

- **3 tadan 2 (best of 3)**
- Hakam paneli raundlarni sanaydi, 2-g'alabada uchrashuv avtomatik yopiladi
- Yutqazgan chiqib ketadi

### 4.3 Robrace — single elimination

- **Bitta raund**, ikki ishtirokchi yonma-yon poyga qiladi
- Yutgan keyingi bosqichga, yutqazgan chiqib ketadi
- Vaqt ham yoziladi (ixtiyoriy, statistika uchun)
- Jeребьevka **butunlay tasodifiy**

### 4.4 Linefollower — vaqt bo'yicha reyting

- **2 ta urinish**, eng yaxshisi hisobga olinadi
- Reyting eng qisqa vaqt bo'yicha
- **Robot yo'ldan chiqsa:** qo'lda oxirgi nuqtaga qaytariladi, **+5 soniya jarima**
- Yakuniy vaqt = xom vaqt + (jarimalar soni × 5 s)
- Umuman tugatolmasa — DNF, o'sha urinish hisobga olinmaydi
- Ikkala urinish ham DNF bo'lsa — reytingda oxirgi o'rin
- Vaqt aniqligi: `mm:ss.SS` (yuzdan bir soniya)

---

## 5. Jeребьevka (draw)

**Umumiy qoidalar:**

- `crypto.getRandomValues` bilan seed generatsiya qilinadi
- Fisher–Yates aralashtirish
- **Seed bazaga saqlanadi** — natijani qayta hisoblab isbotlash mumkin (nizo chiqsa himoya)
- Kim, qachon o'tkazgani yoziladi (audit)
- Bir marta o'tkazilgan draw qayta o'tkazilmaydi (admin majburan bekor qilmasa)

**Himoya qoidasi (robofutbol):** bir maktabning ikki jamoasi bitta guruhga tushmaydi. Iloji bo'lmasa (masalan bitta maktabdan 5 jamoa, guruh 4 talik) — algoritm imkon qadar tarqatadi va ogohlantirish chiqaradi.

**Sahna rejimi:** kartochkalar birma-bir ochilib guruhga/gridga tushadigan animatsiya. Katta ekranga chiqarish uchun.

---

## 6. Ma'lumot modeli

```
categories       code (R|S|L|RR), name, format
teams            id, category, number "R12", name, school, region, coach, checked_in_at
participants     id, team_id, full_name, birth_year, phone
robots           id, team_id, photo_url, captured_at, captured_by

groups           id, category, name "A"          -- faqat robofutbol
group_teams      group_id, team_id

matches          id, category, stage, group_id, round, field_no,
                 team_a, team_b, score_a, score_b,
                 rounds_json,                     -- sumo best-of-3 uchun
                 winner_id, status, started_at, finished_at, judge_id

runs             id, team_id, attempt_no, raw_ms, penalties, final_ms,
                 status (ok|dnf), judge_id, created_at   -- linefollower

draws            id, category, seed, created_by, created_at, result_json
judges           id, name, pin_hash, category, field_no
audit_log        id, actor, action, entity, before, after, at
```

**Muhim:** `matches` va `runs` jadvallarida `judge_id` va vaqt bor — kim, qachon, nima yozganini keyin tekshirib bo'ladi.

---

## 7. Sahifalar

| Yo'l | Kim uchun | Vazifasi |
|---|---|---|
| `/` | Hamma | Musobaqa haqida, yo'nalishlar, jonli natijalarga link |
| `/admin/import` | Admin | Excel yuklash → ustunlarni moslash → preview → tasdiq |
| `/admin/checkin` | Registratsiya stoli | Qidirish → «keldi» → webcam surat → raqam beriladi |
| `/admin/draw` | Admin | Yo'nalish tanlash → sozlamalar → draw → sahna animatsiyasi |
| `/admin/schedule` | Admin | Jadval generatori + **vaqt kalkulyatori** |
| `/admin/teams` | Admin | Ro'yxat, qidiruv, tahrirlash, PDF/Excel eksport |
| `/hakam` | Hakamlar | PIN kirish → mening maydonim → o'yinlar → natija |
| `/jonli` | TV ekran | Katta shrift, yo'nalishlar avtomatik aylanadi |
| `/jonli/[yonalish]` | Hamma | Grid, guruh jadvali, reyting — telefonda ham |

### 7.1 Check-in ekrani (eng muhim, 16-avgust ertalab)

Bitta ekran, uch qadam, ~25 soniya:

1. **Qidiruv** — jamoa nomi yoki ishtirokchi ismini yozish (fuzzy search, 2-3 harfdan ishlaydi)
2. **Tasdiq** — ma'lumotlar ko'rsatiladi, «Keldi» tugmasi bosiladi
3. **Surat** — kamera darhol ochiladi, «Suratga ol» → yuklandi → **raqam katta shrift bilan chiqadi** (masalan `R12`)

Yon tugma: «Ro'yxatda yo'q» → qisqa forma (jamoa nomi, ishtirokchilar, maktab, telefon) → o'sha yerda raqam beriladi.

### 7.2 Jadval kalkulyatori

Admin sozlamalarni o'zgartirganda darhol hisoblab ko'rsatadi:

> 38 guruh × 4 jamoa → 228 o'yin · 3 maydon · 6 daq → **7 soat 36 daqiqa**

Guruh o'lchami, o'yin davomiyligi va maydonlar soni — uchtasi ham slayder. Tashkilotchi raqamni ko'rib o'zi qaror qiladi.

### 7.3 Hakam paneli

Responsive — telefon va noutbukda ishlaydi. PIN bilan kiradi, faqat o'z maydonining o'yinlarini ko'radi.

- **Robofutbol:** ikki jamoa, `+1` / `−1` tugmalar, taymer, «Yakunlash»
- **Sumo:** uch raund kataklari, har raundda kim yutgani bosiladi, 2-g'alabada avtomatik yopiladi
- **Robrace:** ikki katta tugma — kim yutdi, ixtiyoriy vaqt maydoni
- **Linefollower:** taymer (start/stop), «Jarima +5s» tugmasi (bosgan sari sanaydi), «DNF» tugmasi, urinish raqami

Har yakunlangan natija 10 soniya davomida «Bekor qilish» tugmasini ko'rsatadi — xato bosilsa qaytarish uchun.

---

## 8. Ish rejasi

| Sana | Ish |
|---|---|
| **12–13 avg** | Loyiha skeleti, Supabase schema, auth, Excel import, check-in + webcam, raqamlash |
| **14 avg** | Draw dvigateli (4 format), bracket/guruh generatori, jadval kalkulyatori, admin panel |
| **15 avg** | Hakam paneli (4 yo'nalish), jonli tablo, realtime, dizayn sayqali |
| **16 avg ertalab** | Real ma'lumot bilan test, deploy, zaxira rejasi |

---

## 9. Boshlash uchun kerak

- [ ] **Excel fayl** (yoki bir necha qatorli namuna) — importni ustunlarga moslash uchun
- [ ] **VPS kirish** — IP, SSH foydalanuvchi va kalit/parol
- [ ] **VPS xarakteristikasi** — RAM, CPU, OS versiyasi (minimum: 2 GB RAM, 2 vCPU, Ubuntu 22.04+)
- [ ] **Domen** — serverga yo'naltirilganmi? Caddy HTTPS olishi uchun kerak
- [ ] Musobaqa nomi, logotipi, brend ranglari (bo'lmasa men taklif qilaman)
- [ ] Interfeys tili — o'zbek (default) yoki o'zbek + rus

---

## 10. Hal qilinmagan / keyinroq

- Domen nomi (Vercel'ning bepul `.vercel.app` manzili ham ishlaydi)
- Robofutbol o'yin davomiyligi (default 5 daqiqa qo'yildi, kalkulyatorda o'zgaradi)
- G'oliblar uchun diplom/sertifikat generatsiyasi
- Musobaqadan keyingi statistika hisoboti
