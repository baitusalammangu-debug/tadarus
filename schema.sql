-- =========================================================
--  SKEMA DATABASE APLIKASI TADARUS (Cloudflare D1 / SQLite)
--  Jalankan sekali:  npx wrangler d1 execute tadarus-db --remote --file=schema.sql
-- =========================================================

CREATE TABLE IF NOT EXISTS pengaturan (
  kunci TEXT PRIMARY KEY,
  nilai TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  nama TEXT NOT NULL,
  password TEXT NOT NULL,
  peran TEXT NOT NULL CHECK (peran IN ('admin','guru','siswa')),
  kelompok_id INTEGER,              -- untuk siswa
  nis TEXT,
  jk TEXT,                          -- L / P
  tgl_mulai TEXT,                   -- YYYY-MM-DD, awal jadwal tadarus siswa
  halaman_mulai INTEGER DEFAULT 1,  -- halaman awal (1 = Al-Fatihah)
  aktif INTEGER DEFAULT 1,
  wajib_ganti_pw INTEGER DEFAULT 1,
  dibuat TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_kelompok ON users(kelompok_id);

CREATE TABLE IF NOT EXISTS kelompok (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  guru_id INTEGER,
  hari_aktif TEXT DEFAULT '0123456',  -- 0=Minggu ... 6=Sabtu
  min_detik INTEGER DEFAULT 30,       -- jeda minimal per halaman (anti asal klik)
  tgl_mulai TEXT,                     -- default tgl mulai untuk siswa baru
  keterangan TEXT
);

-- Riwayat target: berlaku mulai tanggal tertentu. Target siswa (siswa_id) menimpa target kelompok.
CREATE TABLE IF NOT EXISTS jadwal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kelompok_id INTEGER,
  siswa_id INTEGER,
  mulai TEXT NOT NULL,
  halaman_per_hari INTEGER NOT NULL,
  dibuat_oleh INTEGER,
  dibuat TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jadwal_k ON jadwal(kelompok_id);
CREATE INDEX IF NOT EXISTS idx_jadwal_s ON jadwal(siswa_id);

-- Hari libur (tidak dihitung target). kelompok_id NULL = berlaku semua.
CREATE TABLE IF NOT EXISTS libur (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal TEXT NOT NULL,
  kelompok_id INTEGER,
  keterangan TEXT
);
CREATE INDEX IF NOT EXISTS idx_libur_t ON libur(tanggal);

-- Setiap baris = 1 halaman yang selesai dibaca
CREATE TABLE IF NOT EXISTS bacaan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  siswa_id INTEGER NOT NULL,
  halaman INTEGER NOT NULL,
  tanggal TEXT NOT NULL,           -- tanggal WIB
  waktu TEXT DEFAULT (datetime('now')),
  sumber TEXT DEFAULT 'app',       -- app / guru
  oleh INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bacaan_s ON bacaan(siswa_id, tanggal);

CREATE TABLE IF NOT EXISTS sesi (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kedaluwarsa INTEGER NOT NULL
);

-- Pengumuman / pesan guru
CREATE TABLE IF NOT EXISTS pengumuman (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kelompok_id INTEGER,
  judul TEXT,
  isi TEXT,
  oleh INTEGER,
  dibuat TEXT DEFAULT (datetime('now'))
);

-- Admin awal: username admin / password admin123 (WAJIB diganti saat login pertama)
INSERT OR IGNORE INTO users (id, username, nama, password, peran, wajib_ganti_pw)
VALUES (1, 'admin', 'Administrator', 'pbkdf2$100000$iqBNU2Sp+fzMLptGqt6niQ==$WSTeltxm+BbVLrXEgdhSxI3PjJ8ehNWWI3+V1TpeC6U=', 'admin', 1);

INSERT OR IGNORE INTO pengaturan (kunci, nilai) VALUES
 ('nama_lembaga', 'Tadarus Al-Qur''an'),
 ('sub_judul', 'Program Tadarus Rutin Harian'),
 ('poin_harian', '10'),
 ('poin_khatam', '100'),
 ('default_halaman_per_hari', '2');
