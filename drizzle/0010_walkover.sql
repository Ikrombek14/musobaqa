-- Texnik magʻlubiyat: jamoa maydonga chiqmadi.
--
-- Ilgari hakam soxta hisob yozishga majbur edi (masalan 1:0) va
-- statistikada yoʻq gol qolib ketardi. Endi oʻyin alohida belgilanadi:
-- hisob jadval uchun 1:0 boʻlib qoladi (gʻolib 3 ochko oladi), lekin
-- ekranda raqam emas, «texnik» deb koʻrsatiladi.
alter table matches
  add column if not exists walkover boolean not null default false;
