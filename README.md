# 📖 Aplikasi Tadarus Al-Qur'an Rutin Harian

Aplikasi web (PWA) untuk program tadarus harian siswa/santri.
Berjalan di **Cloudflare Pages + D1** (gratis), kode disimpan di **GitHub**.

## Fitur

**Siswa / santri** (login dengan akun dari admin)
- Beranda: sisa halaman wajib hari ini, **hutang**, **tabungan (spare)**, poin, hari beruntun, progres khatam, pengumuman guru.
- Menu **Tadarus**: langsung membuka halaman mushaf sesuai jadwal (berurutan dari Al-Fatihah sampai An-Nas, lalu khatam & ulang). Tombol **✓ Selesai** per halaman, dengan jeda minimal (anti asal klik).
- Mushaf lengkap 604 halaman dengan **teks Al-Qur'an Kemenag RI (Mushaf Standar Indonesia)** + terjemah Kemenag, daftar surah & juz, ukuran huruf bisa diatur, bisa dibaca offline.
- **Tajwid berwarna** otomatis (ghunnah, ikhfa', idgham, iqlab, qalqalah, mad wajib/jaiz/lazim, alif lam syamsiyah). Ketuk huruf berwarna untuk melihat nama & penjelasan hukumnya; ada legenda warna di bawah halaman. Bisa dimatikan (tombol **Tj**).
- **Bacaan latin** Kemenag (tombol **Lt**) dan terjemah (tombol **Id**).
- **Murottal** per ayat (tombol 🔊): pilih qari (Al-Husary, Alafasy, Al-Minsyawi, Murottal Kemenag), putar satu halaman dengan sorotan ayat yang sedang dibaca, ketuk nomor ayat untuk mulai dari ayat itu, dan opsi mengulang tiap ayat (2×–10×) untuk menghafal/menirukan. Audio dari cdn.islamic.network dan quran.kemenag.go.id (butuh internet).
- Riwayat kalender (tepat jadwal / tidak terpenuhi / libur), peringkat poin kelompok.
- Notifikasi pengingat harian.

**Aturan perhitungan**
- Target = *halaman per hari* yang ditetapkan guru (per kelompok, atau khusus per siswa), pada hari-hari aktif.
- Tidak membaca (berhalangan) → menjadi **hutang** dan wajib diganti. Bacaan berikutnya otomatis melunasi hutang lebih dulu.
- Membaca melebihi target → menjadi **tabungan** yang menutup target hari berikutnya.
- Setiap hari terjadwal yang terpenuhi tepat waktu → **poin harian** (default 10). Setiap khatam → **bonus** (default 100).
- Hari libur (ditetapkan guru/admin) tidak dihitung target.
- Perubahan target menyimpan riwayat, sehingga perhitungan hari-hari lalu tetap adil.

**Guru**: rekap kelompok (tuntas/belum, hutang, tabungan, poin, posisi halaman, 7 hari terakhir), unduh CSV/cetak, atur target, hari aktif, jeda minimal per halaman, hari libur, pengumuman, peringkat, detail siswa (setor bacaan manual, target khusus, titik mulai).

**Admin**: dasbor, kelompok, pengguna (tambah, ubah, reset password, nonaktifkan, **impor CSV/Excel massal** + cetak kartu akun), libur global, pengaturan (nama lembaga, logo, poin).

---

## Cara Pasang (GitHub + Cloudflare)

Gunakan akun **baitusalammangu@gmail.com** untuk GitHub dan Cloudflare.

### 1. Buat database D1
1. Masuk ke <https://dash.cloudflare.com> → **Storage & Databases → D1 SQL Database → Create**.
2. Nama database: `tadarus-db` → **Create**.
3. Salin **Database ID** yang tampil.
4. Buka tab **Console** database tersebut, salin seluruh isi file `schema.sql`, tempel, lalu **Execute**.

### 2. Isi Database ID
Buka file `wrangler.toml`, ganti `GANTI_DENGAN_DATABASE_ID_ANDA` dengan Database ID dari langkah 1.

### 3. Unggah ke GitHub
1. Buat repository baru di GitHub, misalnya `tadarus` (boleh Private).
2. Unggah **seluruh isi folder ini** (bukan folder `node_modules`): `public/`, `functions/`, `schema.sql`, `wrangler.toml`, `package.json`, `README.md`, `.gitignore`.
   - Lewat web: **Add file → Upload files** → seret semua file/folder → **Commit**.
   - Atau lewat terminal:
     ```bash
     git init && git add . && git commit -m "Aplikasi tadarus"
     git branch -M main
     git remote add origin https://github.com/NAMA-AKUN/tadarus.git
     git push -u origin main
     ```

### 4. Hubungkan ke Cloudflare Pages
1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → pilih repo `tadarus`.
2. Build settings:
   - Framework preset: **None**
   - Build command: *(kosongkan)*
   - Build output directory: `public`
3. **Save and Deploy**. Binding D1 (`DB`) otomatis terbaca dari `wrangler.toml`.
4. (Opsional) **Custom domains** → misal `tadarus.sekolahanda.sch.id`.

### 5. Login pertama
- Buka alamat aplikasi → login **admin / admin123** → langsung diminta ganti password.
- Urutan awal: **Pengguna** (buat akun guru) → **Kelompok** (nama, guru, target halaman/hari, tanggal mulai) → **Pengguna → Impor CSV** untuk siswa → cetak kartu akun dan bagikan.

Setiap kali ada perubahan di GitHub, Cloudflare otomatis memperbarui aplikasi.

---

## Format impor siswa (CSV / salin dari Excel)

Baris pertama adalah judul kolom. Hanya `nama` yang wajib.

```
nama;username;password;kelompok;nis;jk;peran
Ahmad Fauzi;;;X-1;12345;L;siswa
Siti Aminah;siti.aminah;rahasia1;X-1;12346;P;siswa
```
- `username` kosong → dibuat dari NIS (atau nama).
- `password` kosong → dibuat acak (ditampilkan sekali, bisa dicetak).
- `kelompok` yang belum ada → dibuat otomatis (target default dari Pengaturan).

## Tentang notifikasi
- Saat siswa membuka aplikasi dan targetnya belum tuntas, muncul notifikasi (sekali per hari) + peringatan di beranda.
- Jika aplikasi **dipasang ke layar utama** (Android/Chrome: menu ⋮ → *Install app / Tambahkan ke layar utama*), pengingat juga dicoba dikirim di latar belakang (Periodic Background Sync). Jadwal persisnya diatur oleh browser, jadi tidak selalu tepat di jam tertentu.
- iPhone: pasang lewat Safari → Bagikan → *Tambahkan ke Layar Utama* (iOS 16.4+), lalu aktifkan pengingat di menu Akun.

## Uji di komputer sendiri (opsional)
```bash
npm install
npm run db:local      # buat database lokal
npm run dev           # buka http://localhost:8788
```

## Struktur
```
public/            tampilan (HTML, CSS, JS, PWA) + data mushaf
  quran/p/1..604   teks Al-Qur'an per halaman (Arab + terjemah)
  quran/meta.json  daftar surah & juz
  fonts/           font mushaf (Scheherazade New; tambahkan lpmq.ttf bila ada)
functions/api/     API (Cloudflare Pages Functions)
schema.sql         struktur database D1 + akun admin awal
scripts/           skrip pembuat data mushaf
```

## Teks & font
- Teks Arab dan terjemah: **Kemenag RI** (quran.kemenag.go.id, Mushaf Standar Indonesia), diambil melalui paket `quran-kemenag`. Pembagian 604 halaman dan 30 juz mengikuti data Kemenag.
- Font bawaan: Scheherazade New (SIL, lisensi OFL), mendukung semua tanda baca Mushaf Standar Indonesia.
- **Agar tampilan persis seperti mushaf Kemenag**, pakai font resmi **LPMQ Isep Misbah** (gratis dari Lajnah Pentashihan Mushaf Al-Qur'an Kemenag): unduh dari situs LPMQ (lajnah.kemenag.go.id), ganti nama filenya menjadi `lpmq.ttf` (atau `lpmq.woff2`), letakkan di folder `public/fonts/`, lalu commit ke GitHub. Aplikasi otomatis memakainya. Perangkat yang sudah memasang font LPMQ juga otomatis memakainya.
- Mohon tetap ditashih bila ditemukan kekeliruan tampilan.
