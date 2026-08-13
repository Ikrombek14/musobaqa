# ============================================================
# Qoʻlda deploy — GitHub Actions ishlamay qolganda zaxira yoʻl.
#
#   .\scripts\deploy.ps1
#   .\scripts\deploy.ps1 -SkipPush     # server allaqachon yangi commitda
#
# Odatdagi yoʻl — `git push`: Actions sinovlardan oʻtkazib, keyin
# deploy qiladi. Bu skript sinovlarni OʻTKAZMAYDI, shuning uchun
# faqat shoshilinch holatda ishlating (musobaqa kuni GitHub ishlamay
# qolsa yoki tarmoq sekin boʻlsa).
#
# Serverga SSH kalit bilan kiradi — parol soʻralmaydi.
# ============================================================

param(
    [switch]$SkipPush,
    [string]$ServerHost = "169.58.130.201",
    [string]$ServerUser = "root",
    [string]$AppDir = "/opt/musobaqa"
)

$ErrorActionPreference = "Stop"

function Step($text) { Write-Host "`n▸ $text" -ForegroundColor White }
function Ok($text) { Write-Host "  ✓ $text" -ForegroundColor Green }
function Fail($text) { Write-Host "`n✗ $text" -ForegroundColor Red; exit 1 }

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# --- Tekshiruvlar ---
Step "Holat tekshirilmoqda"

$dirty = git status --porcelain
if ($dirty) {
    Write-Host "  Saqlanmagan oʻzgarishlar bor:" -ForegroundColor Yellow
    git status --short
    Fail "Avval commit qiling yoki oʻzgarishlarni bekor qiling"
}

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne "main") {
    Write-Host "  Joriy branch: $branch (kutilgan: main)" -ForegroundColor Yellow
}

$sha = git rev-parse HEAD
Ok "commit: $sha"

# --- Push ---
if (-not $SkipPush) {
    Step "GitHub'ga yuborilmoqda"
    git push origin $branch
    if (-not $?) { Fail "push bajarilmadi" }
    Ok "yuborildi"
}

# --- Serverda yangilash ---
Step "Serverda yangilanmoqda ($ServerHost)"
Write-Host "  Sinovlar OʻTKAZILMAYDI — bu shoshilinch yoʻl" -ForegroundColor Yellow

$remote = @"
set -euo pipefail
cd $AppDir
git fetch --all --prune
git reset --hard origin/$branch
chmod +x scripts/*.sh
bash scripts/ci-deploy.sh '$sha'
"@

# Skript ssh ga argument sifatida beriladi, STDIN orqali EMAS:
# `docker compose run` stdin'dan oʻqiydi va skript qoldigʻini yutib
# yuboradi — keyingi buyruqlar bajarilmay qoladi (bu ilgari sodir boʻlgan).
$remoteOneLine = ($remote -split "`n" | Where-Object { $_ -notmatch '^\s*$' }) -join "; "

ssh -n -o BatchMode=yes "$ServerUser@$ServerHost" $remoteOneLine
if ($LASTEXITCODE -ne 0) { Fail "Serverda deploy yiqildi (yuqoridagi loglarga qarang)" }

# --- Tasdiqlash ---
Step "Versiya tekshirilmoqda"
try {
    $version = Invoke-RestMethod -Uri "https://musobaqa.robbitonline.uz/api/version" -TimeoutSec 20
    Write-Host "  kutilgan: $sha"
    Write-Host "  serverda: $($version.sha)"
    if ($version.sha -ne $sha) { Fail "ESKI VERSIYA ISHLAB TURIBDI — deploy amalda boʻlmadi" }
    Ok "versiya mos"
} catch {
    Fail "Versiyani tekshirib boʻlmadi: $_"
}

Write-Host "`n✓ Deploy tugadi" -ForegroundColor Green
Write-Host "  https://musobaqa.robbitonline.uz`n"
