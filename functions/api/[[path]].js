// =========================================================
//  API APLIKASI TADARUS — Cloudflare Pages Functions + D1
//  Binding database: DB
// =========================================================

const TOTAL_HALAMAN = 604;
const SESI_HARI = 30;

// ---------- util umum ----------
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const err = (pesan, status = 400) => json({ error: pesan }, status);

class HttpError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

// Tanggal hari ini dalam WIB (UTC+7)
const hariIniWIB = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const tambahHari = (tgl, n) => {
  const d = new Date(tgl + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const hariKe = (tgl) => new Date(tgl + 'T00:00:00Z').getUTCDay();
const validTgl = (t) => typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t) && !isNaN(Date.parse(t));

// ---------- password (PBKDF2-SHA256) ----------
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await pbkdf2(pw, salt, 100000);
  return `pbkdf2$100000$${b64(salt)}$${b64(h)}`;
}
async function cekPassword(pw, stored) {
  try {
    const [, iter, s, h] = stored.split('$');
    const hasil = b64(await pbkdf2(pw, unb64(s), parseInt(iter)));
    return hasil === h;
  } catch { return false; }
}
const tokenAcak = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, '');

// ---------- pengaturan ----------
async function ambilPengaturan(db) {
  const { results } = await db.prepare('SELECT kunci, nilai FROM pengaturan').all();
  const p = {};
  for (const r of results) p[r.kunci] = r.nilai;
  return p;
}

// =========================================================
//  MESIN PERHITUNGAN TARGET / HUTANG / SPARE / POIN
// =========================================================
// jadwalK: jadwal kelompok, jadwalS: jadwal khusus siswa (urut mulai ASC)
// liburSet: Set tanggal libur, logHarian: {tanggal: jumlah}
// logOwoj: {tanggal: jumlah halaman OWOJ} — ikut memenuhi target harian, tetapi tidak menggeser posisi khatam tadarus
// targetBawaan: target bila tidak ada jadwal (mis. target harian guru)
function hitungStatus({ siswa, kelompok, jadwalK, jadwalS, liburSet, logHarian, logOwoj = {}, targetBawaan = 0, pengaturan, hariIni, riwayatHari = 0 }) {
  const poinHarian = parseInt(pengaturan.poin_harian || '10');
  const poinKhatam = parseInt(pengaturan.poin_khatam || '100');
  const hariAktif = (kelompok?.hari_aktif ?? '0123456');
  const mulai = siswa.tgl_mulai || kelompok?.tgl_mulai || hariIni;
  const halamanMulai = siswa.halaman_mulai || 1;

  const efektif = (tgl) => {
    let v = null;
    for (const j of jadwalS) if (j.mulai <= tgl) v = j.halaman_per_hari;
    if (v !== null) return v;
    for (const j of jadwalK) if (j.mulai <= tgl) v = j.halaman_per_hari;
    return v ?? targetBawaan;
  };

  // total bacaan sebelum tanggal mulai (jika ada) tetap dihitung
  let kum = 0, totalTadarus = 0;
  for (const [t, n] of Object.entries(logHarian)) { totalTadarus += n; if (t < mulai) kum += n; }
  for (const [t, n] of Object.entries(logOwoj)) if (t < mulai) kum += n;

  let wajib = 0, poin = 0, hariTepat = 0, hariTerjadwal = 0, streak = 0;
  let wajibKemarin = 0;
  const riwayat = [];
  let targetHariIni = 0, terjadwalHariIni = false;

  if (mulai <= hariIni) {
    for (let t = mulai; t <= hariIni; t = tambahHari(t, 1)) {
      const ppd = efektif(t);
      const terjadwal = ppd > 0 && hariAktif.includes(String(hariKe(t))) && !liburSet.has(t);
      const dibaca = (logHarian[t] || 0) + (logOwoj[t] || 0);
      kum += dibaca;
      if (terjadwal) wajib += ppd;
      let status = terjadwal ? (kum >= wajib ? 'tepat' : (t === hariIni ? 'belum' : 'kurang')) : (liburSet.has(t) ? 'libur' : 'bebas');
      if (terjadwal) {
        hariTerjadwal++;
        if (kum >= wajib) { poin += poinHarian; hariTepat++; streak++; }
        else if (t !== hariIni) streak = 0;
      }
      if (t === hariIni) { targetHariIni = terjadwal ? ppd : 0; terjadwalHariIni = terjadwal; }
      else wajibKemarin = wajib;
      riwayat.push({ t, ppd: terjadwal ? ppd : 0, dibaca, status });
    }
  }
  // bacaan bertanggal setelah hari ini (seharusnya tidak ada)
  for (const [t, n] of Object.entries(logHarian)) if (t > hariIni) kum += n;
  for (const [t, n] of Object.entries(logOwoj)) if (t > hariIni) kum += n;

  const total = kum;                                 // tadarus + OWOJ (untuk target)
  const posisi = halamanMulai - 1 + totalTadarus;          // jumlah halaman yang telah dilewati dari awal mushaf
  const khatam = Math.floor(posisi / TOTAL_HALAMAN);
  const halamanBerikut = (posisi % TOTAL_HALAMAN) + 1;
  poin += khatam * poinKhatam;

  // hutang = kewajiban hari-hari sebelumnya yang belum terbayar (bacaan hari ini lebih dulu melunasi hutang)
  const hutang = Math.max(0, wajibKemarin - total);
  const sisaHariIni = Math.max(0, wajib - total);    // termasuk hutang
  const spare = Math.max(0, total - wajib);
  const dibacaHariIni = (logHarian[hariIni] || 0) + (logOwoj[hariIni] || 0);

  return {
    tgl_mulai: mulai,
    halaman_mulai: halamanMulai,
    total_dibaca: total,
    total_tadarus: totalTadarus,
    dibaca_owoj_hari_ini: logOwoj[hariIni] || 0,
    halaman_berikut: halamanBerikut,
    khatam,
    progres_khatam: +(((posisi % TOTAL_HALAMAN) / TOTAL_HALAMAN) * 100).toFixed(1),
    target_hari_ini: targetHariIni,
    terjadwal_hari_ini: terjadwalHariIni,
    dibaca_hari_ini: dibacaHariIni,
    wajib_kumulatif: wajib,
    hutang: Math.max(0, hutang),
    sisa_hari_ini: sisaHariIni,
    spare,
    selesai_hari_ini: sisaHariIni === 0,
    poin,
    hari_tepat: hariTepat,
    hari_terjadwal: hariTerjadwal,
    streak,
    persen_disiplin: hariTerjadwal ? Math.round((hariTepat / hariTerjadwal) * 100) : 100,
    riwayat: riwayatHari ? riwayat.slice(-riwayatHari) : undefined,
  };
}

function pesanNotif(s, nama, peran = 'siswa') {
  const g = peran !== 'siswa';
  const n = g ? nama : nama.split(' ')[0];
  const kamu = g ? 'Anda' : 'kamu';
  if (!s.terjadwal_hari_ini && s.hutang === 0) return { jenis: 'info', teks: `Hari ini tidak ada jadwal tadarus, ${n}. Tetap boleh membaca untuk menabung halaman.` };
  if (s.selesai_hari_ini) {
    if (s.spare > 0) return { jenis: 'sukses', teks: `Alhamdulillah, target hari ini tuntas! ${g ? 'Anda' : 'Kamu'} punya tabungan ${s.spare} halaman untuk hari berikutnya.` };
    return { jenis: 'sukses', teks: `Alhamdulillah, target tadarus hari ini sudah tuntas. Barakallahu fiik, ${n}!` };
  }
  if (s.hutang > 0) return { jenis: 'bahaya', teks: `${n}, ${kamu} punya hutang ${s.hutang} halaman. Hari ini wajib membaca ${s.sisa_hari_ini} halaman (target ${s.target_hari_ini} + hutang).` };
  return { jenis: 'peringatan', teks: `${n}, hari ini ${kamu} wajib membaca ${s.sisa_hari_ini} halaman${s.dibaca_hari_ini ? ' lagi' : ''}, mulai halaman ${s.halaman_berikut}. Halaman OWOJ juga ikut terhitung.` };
}

// Memuat data yang dibutuhkan untuk menghitung banyak siswa sekaligus
async function statusBanyakSiswa(db, daftarSiswa, pengaturan, riwayatHari = 0) {
  if (!daftarSiswa.length) return [];
  const hariIni = hariIniWIB();
  const ids = daftarSiswa.map((s) => s.id);
  const kids = [...new Set(daftarSiswa.map((s) => s.kelompok_id).filter(Boolean))];
  const ph = (arr) => arr.map(() => '?').join(',') || 'NULL';

  // D1 membatasi ±100 parameter per kueri & 50 kueri per permintaan (paket gratis):
  // untuk daftar besar, ambil seluruh data tanpa filter IN lalu saring di memori.
  const semua = ids.length + kids.length > 80;
  const [kel, jad, lib, log] = await Promise.all([
    semua ? db.prepare('SELECT * FROM kelompok').all()
      : kids.length ? db.prepare(`SELECT * FROM kelompok WHERE id IN (${ph(kids)})`).bind(...kids).all() : { results: [] },
    semua ? db.prepare('SELECT * FROM jadwal ORDER BY mulai, id').all()
      : db.prepare(`SELECT * FROM jadwal WHERE siswa_id IN (${ph(ids)}) ${kids.length ? `OR kelompok_id IN (${ph(kids)})` : ''} ORDER BY mulai, id`).bind(...ids, ...kids).all(),
    semua ? db.prepare('SELECT tanggal, kelompok_id FROM libur').all()
      : db.prepare(`SELECT tanggal, kelompok_id FROM libur WHERE kelompok_id IS NULL ${kids.length ? `OR kelompok_id IN (${ph(kids)})` : ''}`).bind(...kids).all(),
    semua ? db.prepare('SELECT siswa_id, tanggal, COUNT(*) n FROM bacaan GROUP BY siswa_id, tanggal').all()
      : db.prepare(`SELECT siswa_id, tanggal, COUNT(*) n FROM bacaan WHERE siswa_id IN (${ph(ids)}) GROUP BY siswa_id, tanggal`).bind(...ids).all(),
  ]);
  const kelMap = Object.fromEntries(kel.results.map((k) => [k.id, k]));
  let owojMap = {};
  try {
    const ow = semua ? await db.prepare('SELECT user_id, COUNT(*) n FROM owoj_pilihan WHERE selesai_pada IS NOT NULL GROUP BY user_id').all()
      : await db.prepare(`SELECT user_id, COUNT(*) n FROM owoj_pilihan WHERE selesai_pada IS NOT NULL AND user_id IN (${ph(ids)}) GROUP BY user_id`).bind(...ids).all();
    owojMap = Object.fromEntries(ow.results.map((r) => [r.user_id, r.n]));
  } catch {}
  const poinOwoj = parseInt(pengaturan.owoj_poin ?? '50');
  const owojLog = {};
  if ((pengaturan.owoj_hitung_tadarus ?? '1') !== '0') {
    try {
      const ol = await db.prepare(`SELECT p.user_id, date(b.waktu, '+7 hours') AS t, COUNT(*) n FROM owoj_baca b JOIN owoj_pilihan p ON p.id = b.pilihan_id
        ${semua ? '' : `WHERE p.user_id IN (${ph(ids)})`} GROUP BY p.user_id, t`).bind(...(semua ? [] : ids)).all();
      for (const r of ol.results) (owojLog[r.user_id] ||= {})[r.t] = r.n;
    } catch {}
  }
  const targetGuru = (pengaturan.tadarus_guru_aktif ?? '1') !== '0' ? parseInt(pengaturan.target_guru ?? '2') : 0;
  const logMap = {};
  for (const r of log.results) (logMap[r.siswa_id] ||= {})[r.tanggal] = r.n;

  return daftarSiswa.map((s) => {
    const k = kelMap[s.kelompok_id] || null;
    const liburSet = new Set(lib.results.filter((l) => l.kelompok_id === null || l.kelompok_id === s.kelompok_id).map((l) => l.tanggal));
    const st = hitungStatus({
      siswa: s,
      kelompok: k,
      jadwalK: jad.results.filter((j) => j.kelompok_id && j.kelompok_id === s.kelompok_id && !j.siswa_id),
      jadwalS: jad.results.filter((j) => j.siswa_id === s.id),
      liburSet,
      logHarian: logMap[s.id] || {},
      logOwoj: owojLog[s.id] || {},
      targetBawaan: s.peran === 'guru' ? targetGuru : 0,
      pengaturan,
      hariIni,
      riwayatHari,
    });
    st.owoj_tuntas = owojMap[s.id] || 0;
    st.poin_tadarus = st.poin;
    st.poin_owoj = st.owoj_tuntas * poinOwoj;
    st.poin += st.poin_owoj;
    return { siswa: s, kelompok: k, status: st };
  });
}

const kolomSiswa = 'id, username, nama, peran, kelompok_id, nis, jk, tgl_mulai, halaman_mulai, aktif';

// =========================================================
//  AUTENTIKASI
// =========================================================
async function userDariToken(db, req) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const row = await db
    .prepare(`SELECT u.*, s.kedaluwarsa FROM sesi s JOIN users u ON u.id = s.user_id WHERE s.token = ?`)
    .bind(token).first();
  if (!row || row.kedaluwarsa < Date.now() || !row.aktif) return null;
  delete row.password;
  row._token = token;
  return row;
}
const wajibPeran = (u, ...peran) => {
  if (!u) throw new HttpError('Silakan login terlebih dahulu', 401);
  if (!peran.includes(u.peran)) throw new HttpError('Akses ditolak', 403);
};

// guru hanya boleh mengelola kelompok miliknya
async function cekAksesKelompok(db, u, kelompokId) {
  if (u.peran === 'admin') return true;
  const k = await db.prepare('SELECT guru_id, guru2_id FROM kelompok WHERE id = ?').bind(kelompokId).first();
  // pendamping kelompok: wali kelas (guru_id) atau guru agama (guru2_id)
  if (!k || (k.guru_id !== u.id && k.guru2_id !== u.id)) throw new HttpError('Anda bukan pendamping kelompok ini', 403);
  return true;
}
async function cekAksesSiswa(db, u, siswaId) {
  const s = await db.prepare(`SELECT ${kolomSiswa} FROM users WHERE id = ? AND peran = 'siswa'`).bind(siswaId).first();
  if (!s) throw new HttpError('Siswa tidak ditemukan', 404);
  if (u.peran === 'admin') return s;
  if (u.peran === 'guru') { await cekAksesKelompok(db, u, s.kelompok_id); return s; }
  throw new HttpError('Akses ditolak', 403);
}


// ---------- pembuatan tabel otomatis (tidak perlu menjalankan schema.sql manual) ----------
const SKEMA = [
 "CREATE TABLE IF NOT EXISTS pengaturan ( kunci TEXT PRIMARY KEY, nilai TEXT )",
 "CREATE TABLE IF NOT EXISTS users ( id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, nama TEXT NOT NULL, password TEXT NOT NULL, peran TEXT NOT NULL CHECK (peran IN ('admin','guru','siswa')), kelompok_id INTEGER, nis TEXT, jk TEXT, tgl_mulai TEXT, halaman_mulai INTEGER DEFAULT 1, aktif INTEGER DEFAULT 1, wajib_ganti_pw INTEGER DEFAULT 1, dibuat TEXT DEFAULT (datetime('now')) )",
 "CREATE INDEX IF NOT EXISTS idx_users_kelompok ON users(kelompok_id)",
 "CREATE TABLE IF NOT EXISTS kelompok ( id INTEGER PRIMARY KEY AUTOINCREMENT, nama TEXT NOT NULL, guru_id INTEGER, hari_aktif TEXT DEFAULT '0123456', min_detik INTEGER DEFAULT 30, tgl_mulai TEXT, keterangan TEXT )",
 "CREATE TABLE IF NOT EXISTS jadwal ( id INTEGER PRIMARY KEY AUTOINCREMENT, kelompok_id INTEGER, siswa_id INTEGER, mulai TEXT NOT NULL, halaman_per_hari INTEGER NOT NULL, dibuat_oleh INTEGER, dibuat TEXT DEFAULT (datetime('now')) )",
 "CREATE INDEX IF NOT EXISTS idx_jadwal_k ON jadwal(kelompok_id)",
 "CREATE INDEX IF NOT EXISTS idx_jadwal_s ON jadwal(siswa_id)",
 "CREATE TABLE IF NOT EXISTS libur ( id INTEGER PRIMARY KEY AUTOINCREMENT, tanggal TEXT NOT NULL, kelompok_id INTEGER, keterangan TEXT )",
 "CREATE INDEX IF NOT EXISTS idx_libur_t ON libur(tanggal)",
 "CREATE TABLE IF NOT EXISTS bacaan ( id INTEGER PRIMARY KEY AUTOINCREMENT, siswa_id INTEGER NOT NULL, halaman INTEGER NOT NULL, tanggal TEXT NOT NULL, waktu TEXT DEFAULT (datetime('now')), sumber TEXT DEFAULT 'app', oleh INTEGER )",
 "CREATE INDEX IF NOT EXISTS idx_bacaan_s ON bacaan(siswa_id, tanggal)",
 "CREATE TABLE IF NOT EXISTS sesi ( token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, kedaluwarsa INTEGER NOT NULL )",
 "CREATE TABLE IF NOT EXISTS pengumuman ( id INTEGER PRIMARY KEY AUTOINCREMENT, kelompok_id INTEGER, judul TEXT, isi TEXT, oleh INTEGER, dibuat TEXT DEFAULT (datetime('now')) )",
 "INSERT OR IGNORE INTO users (id, username, nama, password, peran, wajib_ganti_pw) VALUES (1, 'admin', 'Administrator', 'pbkdf2$100000$iqBNU2Sp+fzMLptGqt6niQ==$WSTeltxm+BbVLrXEgdhSxI3PjJ8ehNWWI3+V1TpeC6U=', 'admin', 1)",
 "INSERT OR IGNORE INTO pengaturan (kunci, nilai) VALUES ('nama_lembaga', 'Tadarus Al-Qur''an'), ('sub_judul', 'Program Tadarus Rutin Harian'), ('poin_harian', '10'), ('poin_khatam', '100'), ('default_halaman_per_hari', '2')",
 "CREATE TABLE IF NOT EXISTS owoj_pilihan ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kelompok_id INTEGER NOT NULL DEFAULT 0, pekan TEXT NOT NULL, juz INTEGER NOT NULL, putaran INTEGER DEFAULT 1, dibuat TEXT DEFAULT (datetime('now')), selesai_pada TEXT )",
 "CREATE INDEX IF NOT EXISTS idx_owoj_pk ON owoj_pilihan(pekan, kelompok_id)",
 "CREATE TABLE IF NOT EXISTS owoj_baca ( id INTEGER PRIMARY KEY AUTOINCREMENT, pilihan_id INTEGER NOT NULL, halaman INTEGER NOT NULL, waktu TEXT DEFAULT (datetime('now')), UNIQUE (pilihan_id, halaman) )",
 "INSERT OR IGNORE INTO pengaturan (kunci, nilai) VALUES ('owoj_aktif', '1'), ('owoj_hari_mulai', '1'), ('owoj_juz_unik', '1'), ('owoj_poin', '50')"
];
let skemaSiap = false;
const MIGRASI = [
  "ALTER TABLE owoj_baca ADD COLUMN sumber TEXT DEFAULT 'app'",
  "INSERT OR IGNORE INTO pengaturan (kunci, nilai) VALUES ('target_guru','2'),('tadarus_guru_aktif','1'),('owoj_hitung_tadarus','1'),('izin_cetak','1'),('owoj_cakupan','sekolah')",
  "ALTER TABLE kelompok ADD COLUMN kode TEXT",
  "ALTER TABLE kelompok ADD COLUMN kode_aktif INTEGER DEFAULT 1",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_kelompok_kode ON kelompok(kode)",
  "ALTER TABLE owoj_pilihan ADD COLUMN putaran INTEGER DEFAULT 1",
  "ALTER TABLE kelompok ADD COLUMN guru2_id INTEGER",
  "ALTER TABLE users ADD COLUMN guru_agama INTEGER DEFAULT 0",
  "INSERT OR IGNORE INTO pengaturan (kunci, nilai) VALUES ('owoj_maks_juz','5')",
  "INSERT OR IGNORE INTO pengaturan (kunci, nilai) VALUES ('owoj_kunci_depan','1')",
];
async function pastikanSkema(db) {
  if (skemaSiap) return;
  const ada = await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('users','pengaturan','kelompok','jadwal','libur','bacaan','sesi','pengumuman','owoj_pilihan','owoj_baca')`).first();
  if (!ada || ada.n < 10) await db.batch(SKEMA.map((s) => db.prepare(s)));
  // migrasi kolom baru (aman diulang; error "duplicate column" diabaikan)
  for (const m of MIGRASI) { try { await db.prepare(m).run(); } catch {} }
  // OWOJ: hapus batas 1 juz per orang per pekan (UNIQUE user_id, pekan) & tambah kolom putaran
  try {
    const t = await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='owoj_pilihan'").first();
    if (t && /UNIQUE\s*\(\s*user_id/i.test(t.sql)) {
      await db.batch([
        db.prepare('DROP TABLE IF EXISTS owoj_pilihan_baru'),
        db.prepare("CREATE TABLE owoj_pilihan_baru (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kelompok_id INTEGER NOT NULL DEFAULT 0, pekan TEXT NOT NULL, juz INTEGER NOT NULL, putaran INTEGER DEFAULT 1, dibuat TEXT DEFAULT (datetime('now')), selesai_pada TEXT)"),
        db.prepare('INSERT INTO owoj_pilihan_baru (id, user_id, kelompok_id, pekan, juz, putaran, dibuat, selesai_pada) SELECT id, user_id, kelompok_id, pekan, juz, 1, dibuat, selesai_pada FROM owoj_pilihan'),
        db.prepare('DROP TABLE owoj_pilihan'),
        db.prepare('ALTER TABLE owoj_pilihan_baru RENAME TO owoj_pilihan'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_owoj_pk ON owoj_pilihan(pekan, kelompok_id)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_owoj_user ON owoj_pilihan(user_id, pekan)'),
      ]);
    }
  } catch (e) { console.error('migrasi owoj', e); }
  skemaSiap = true;
}

// =========================================================
//  ROUTER
// =========================================================
export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  const db = env.DB;
  if (!db) return err('Database D1 belum di-binding (nama binding: DB)', 500);
  try { await pastikanSkema(db); } catch (e) { return err('Gagal menyiapkan database: ' + e.message, 500); }
  const seg = (params.path || []).filter(Boolean);
  const method = request.method;
  const url = new URL(request.url);
  let body = {};
  if (['POST', 'PUT', 'DELETE'].includes(method)) {
    try { body = await request.json(); } catch { body = {}; }
  }
  try {
    const route = `${method} /${seg.map((s) => (/^\d+$/.test(s) ? ':id' : s)).join('/')}`;
    const id = seg.find((s) => /^\d+$/.test(s)) ? parseInt(seg.find((s) => /^\d+$/.test(s))) : null;
    const u = route === 'POST /login' || route === 'GET /info' ? null : await userDariToken(db, request);
    const h = HANDLER[route];
    if (!h) return err('Endpoint tidak ditemukan: ' + route, 404);
    return await h({ db, u, body, id, url, request, env });
  } catch (e) {
    if (e instanceof HttpError) return err(e.message, e.status);
    console.error(e);
    return err('Kesalahan server: ' + e.message, 500);
  }
}

const HANDLER = {
  // ---------- publik ----------
  'GET /info': async ({ db }) => {
    const p = await ambilPengaturan(db);
    return json({ nama_lembaga: p.nama_lembaga, sub_judul: p.sub_judul, logo: p.logo || null, hari_ini: hariIniWIB() });
  },

  'POST /login': async ({ db, body }) => {
    const username = String(body.username || '').trim().toLowerCase();
    const u = await db.prepare('SELECT * FROM users WHERE lower(username) = ?').bind(username).first();
    if (!u || !(await cekPassword(String(body.password || ''), u.password))) throw new HttpError('Username atau password salah', 401);
    if (!u.aktif) throw new HttpError('Akun dinonaktifkan. Hubungi admin.', 403);
    const token = tokenAcak();
    await db.batch([
      db.prepare('DELETE FROM sesi WHERE kedaluwarsa < ?').bind(Date.now()),
      db.prepare('INSERT INTO sesi (token, user_id, kedaluwarsa) VALUES (?,?,?)').bind(token, u.id, Date.now() + SESI_HARI * 864e5),
    ]);
    delete u.password;
    return json({ token, user: u });
  },

  'POST /logout': async ({ db, u }) => {
    if (u) await db.prepare('DELETE FROM sesi WHERE token = ?').bind(u._token).run();
    return json({ ok: true });
  },

  'GET /me': async ({ db, u }) => {
    if (!u) throw new HttpError('Sesi berakhir, silakan login lagi', 401);
    const p = await ambilPengaturan(db);
    let kelompok = null;
    if (u.kelompok_id) kelompok = await db.prepare('SELECT k.*, g.nama AS guru_nama, g2.nama AS guru2_nama FROM kelompok k LEFT JOIN users g ON g.id = k.guru_id LEFT JOIN users g2 ON g2.id = k.guru2_id WHERE k.id = ?').bind(u.kelompok_id).first();
    const { _token, ...user } = u;
    return json({ user, kelompok, pengaturan: p, hari_ini: hariIniWIB() });
  },

  'POST /password': async ({ db, u, body }) => {
    if (!u) throw new HttpError('Silakan login', 401);
    const row = await db.prepare('SELECT password FROM users WHERE id = ?').bind(u.id).first();
    if (!(await cekPassword(String(body.lama || ''), row.password))) throw new HttpError('Password lama salah');
    const baru = String(body.baru || '');
    if (baru.length < 6) throw new HttpError('Password baru minimal 6 karakter');
    await db.prepare('UPDATE users SET password = ?, wajib_ganti_pw = 0 WHERE id = ?').bind(await hashPassword(baru), u.id).run();
    return json({ ok: true });
  },

  // ---------- SISWA ----------
  'GET /saya/status': async ({ db, u, url }) => {
    wajibPeran(u, 'siswa', 'guru', 'admin');
    const p = await ambilPengaturan(db);
    const hari = Math.min(400, parseInt(url.searchParams.get('riwayat') || '42'));
    const s = await db.prepare(`SELECT ${kolomSiswa} FROM users WHERE id = ?`).bind(u.id).first();
    if (!s.tgl_mulai) { s.tgl_mulai = hariIniWIB(); await db.prepare('UPDATE users SET tgl_mulai = ? WHERE id = ?').bind(s.tgl_mulai, u.id).run(); }
    const [r] = await statusBanyakSiswa(db, [s], p, hari);
    const pengumuman = await db.prepare('SELECT p.*, u.nama AS oleh_nama FROM pengumuman p LEFT JOIN users u ON u.id = p.oleh WHERE p.kelompok_id IS NULL OR p.kelompok_id = ? ORDER BY p.id DESC LIMIT 5').bind(s.kelompok_id || 0).all();
    const terakhir = await db.prepare('SELECT waktu FROM bacaan WHERE siswa_id = ? ORDER BY id DESC LIMIT 1').bind(u.id).first();
    return json({
      ...r.status,
      notif: pesanNotif(r.status, u.nama, u.peran),
      min_detik: r.kelompok?.min_detik ?? 30,
      terakhir_baca: terakhir?.waktu || null,
      pengumuman: pengumuman.results,
      hari_ini: hariIniWIB(),
    });
  },

  // tandai halaman selesai dibaca (harus berurutan)
  'POST /saya/baca': async ({ db, u, body }) => {
    wajibPeran(u, 'siswa', 'guru', 'admin');
    const p = await ambilPengaturan(db);
    const s = await db.prepare(`SELECT ${kolomSiswa} FROM users WHERE id = ?`).bind(u.id).first();
    const [r] = await statusBanyakSiswa(db, [s], p);
    const hlm = parseInt(body.halaman);
    if (hlm !== r.status.halaman_berikut) throw new HttpError(`Bacaan harus berurutan. Halaman yang harus dibaca: ${r.status.halaman_berikut}`);
    const minDetik = r.kelompok?.min_detik ?? 30;
    const akhir = await db.prepare(`SELECT (julianday('now') - julianday(waktu)) * 86400 AS detik FROM bacaan WHERE siswa_id = ? AND sumber = 'app' ORDER BY id DESC LIMIT 1`).bind(u.id).first();
    if (akhir && akhir.detik < minDetik) {
      throw new HttpError(`Bacalah dengan tartil. Tunggu ${Math.ceil(minDetik - akhir.detik)} detik lagi sebelum menandai halaman ini.`, 429);
    }
    await db.prepare('INSERT INTO bacaan (siswa_id, halaman, tanggal, sumber, oleh) VALUES (?,?,?,?,?)').bind(u.id, hlm, hariIniWIB(), 'app', u.id).run();
    const [r2] = await statusBanyakSiswa(db, [s], p);
    return json({ ...r2.status, notif: pesanNotif(r2.status, u.nama, u.peran), khatam_baru: r2.status.khatam > r.status.khatam });
  },

  // batalkan tanda terakhir (hanya bacaan hari ini lewat aplikasi)
  'POST /saya/batal': async ({ db, u }) => {
    wajibPeran(u, 'siswa', 'guru', 'admin');
    const row = await db.prepare(`SELECT id FROM bacaan WHERE siswa_id = ? AND tanggal = ? AND sumber = 'app' ORDER BY id DESC LIMIT 1`).bind(u.id, hariIniWIB()).first();
    if (!row) throw new HttpError('Tidak ada bacaan hari ini yang bisa dibatalkan');
    const last = await db.prepare('SELECT id FROM bacaan WHERE siswa_id = ? ORDER BY id DESC LIMIT 1').bind(u.id).first();
    if (last.id !== row.id) throw new HttpError('Hanya tanda terakhir yang bisa dibatalkan');
    await db.prepare('DELETE FROM bacaan WHERE id = ?').bind(row.id).run();
    return json({ ok: true });
  },

  'GET /saya/peringkat': async ({ db, u }) => {
    wajibPeran(u, 'siswa');
    return json(await peringkat(db, u.kelompok_id));
  },

  // ---------- GURU & ADMIN ----------
  'GET /kelompok': async ({ db, u }) => {
    wajibPeran(u, 'admin', 'guru');
    const where = u.peran === 'guru' ? 'WHERE (k.guru_id = ? OR k.guru2_id = ?)' : '';
    const st = db.prepare(`SELECT k.*, g.nama AS guru_nama, g2.nama AS guru2_nama, (SELECT COUNT(*) FROM users s WHERE s.kelompok_id = k.id AND s.peran='siswa' AND s.aktif=1) AS jumlah_siswa,
      (SELECT halaman_per_hari FROM jadwal j WHERE j.kelompok_id = k.id AND j.siswa_id IS NULL AND j.mulai <= ? ORDER BY j.mulai DESC, j.id DESC LIMIT 1) AS target
      FROM kelompok k LEFT JOIN users g ON g.id = k.guru_id LEFT JOIN users g2 ON g2.id = k.guru2_id ${where} ORDER BY k.nama`);
    const { results } = u.peran === 'guru' ? await st.bind(hariIniWIB(), u.id, u.id).all() : await st.bind(hariIniWIB()).all();
    for (const k of results) if (!k.kode) { k.kode = await kodeBaru(db, k.nama); await db.prepare('UPDATE kelompok SET kode = ? WHERE id = ?').bind(k.kode, k.id).run(); }
    return json(results);
  },

  'POST /kelompok': async ({ db, u, body }) => {
    wajibPeran(u, 'admin', 'guru');
    if (!body.nama) throw new HttpError('Nama kelompok wajib diisi');
    if (u.peran === 'guru') { body.guru_id = u.id; body.guru2_id = null; }  // kelompok buatan guru: guru tsb menjadi wali kelas
    const p = await ambilPengaturan(db);
    const mulai = validTgl(body.tgl_mulai) ? body.tgl_mulai : hariIniWIB();
    const r = await db.prepare('INSERT INTO kelompok (nama, guru_id, guru2_id, hari_aktif, min_detik, tgl_mulai, keterangan) VALUES (?,?,?,?,?,?,?)')
      .bind(body.nama, body.guru_id || null, body.guru2_id || null, body.hari_aktif || '0123456', parseInt(body.min_detik ?? 30), mulai, body.keterangan || null).run();
    const kid = r.meta.last_row_id;
    const kode = await kodeBaru(db, body.nama);
    await db.batch([
      db.prepare('INSERT INTO jadwal (kelompok_id, mulai, halaman_per_hari, dibuat_oleh) VALUES (?,?,?,?)')
        .bind(kid, mulai, parseInt(body.halaman_per_hari || p.default_halaman_per_hari || 2), u.id),
      db.prepare('UPDATE kelompok SET kode = ?, kode_aktif = 1 WHERE id = ?').bind(kode, kid),
    ]);
    return json({ id: kid, kode });
  },

  'PUT /kelompok/:id': async ({ db, u, body, id }) => {
    wajibPeran(u, 'admin', 'guru');
    await cekAksesKelompok(db, u, id);
    const k = await db.prepare('SELECT * FROM kelompok WHERE id = ?').bind(id).first();
    const v = { ...k, ...body };
    if (u.peran === 'guru') { v.guru_id = k.guru_id; v.guru2_id = k.guru2_id; v.nama = body.nama || k.nama; }
    await db.prepare('UPDATE kelompok SET nama=?, guru_id=?, guru2_id=?, hari_aktif=?, min_detik=?, tgl_mulai=?, keterangan=?, kode_aktif=? WHERE id=?')
      .bind(v.nama, v.guru_id || null, v.guru2_id || null, String(v.hari_aktif ?? '0123456'), parseInt(v.min_detik ?? 30), v.tgl_mulai, v.keterangan || null, v.kode_aktif === 0 || v.kode_aktif === '0' ? 0 : 1, id).run();
    return json({ ok: true });
  },

  'DELETE /kelompok/:id': async ({ db, u, id }) => {
    wajibPeran(u, 'admin', 'guru');
    await cekAksesKelompok(db, u, id);
    if (u.peran === 'guru') {
      const kk = await db.prepare('SELECT guru_id FROM kelompok WHERE id = ?').bind(id).first();
      if (kk.guru_id !== u.id) throw new HttpError('Hanya wali kelas atau admin yang dapat menghapus kelompok', 403);
    }
    const n = await db.prepare(`SELECT COUNT(*) n FROM users WHERE kelompok_id = ? AND peran='siswa'`).bind(id).first();
    if (n.n > 0) throw new HttpError('Kelompok masih memiliki siswa. Pindahkan siswa terlebih dahulu.');
    await db.batch([
      db.prepare('DELETE FROM jadwal WHERE kelompok_id = ?').bind(id),
      db.prepare('DELETE FROM libur WHERE kelompok_id = ?').bind(id),
      db.prepare('DELETE FROM kelompok WHERE id = ?').bind(id),
    ]);
    return json({ ok: true });
  },

  // rekap kelompok: semua siswa + status hari ini
  'GET /kelompok/:id/rekap': async ({ db, u, id }) => {
    wajibPeran(u, 'admin', 'guru');
    await cekAksesKelompok(db, u, id);
    const p = await ambilPengaturan(db);
    const k = await db.prepare('SELECT k.*, g.nama AS guru_nama, g2.nama AS guru2_nama FROM kelompok k LEFT JOIN users g ON g.id = k.guru_id LEFT JOIN users g2 ON g2.id = k.guru2_id WHERE k.id = ?').bind(id).first();
    const { results } = await db.prepare(`SELECT ${kolomSiswa} FROM users WHERE kelompok_id = ? AND peran = 'siswa' ORDER BY nama`).bind(id).all();
    const data = await statusBanyakSiswa(db, results, p, 7);
    const jadwal = await db.prepare('SELECT j.*, s.nama AS siswa_nama FROM jadwal j LEFT JOIN users s ON s.id = j.siswa_id WHERE j.kelompok_id = ? OR j.siswa_id IN (SELECT id FROM users WHERE kelompok_id = ?) ORDER BY j.mulai DESC, j.id DESC').bind(id, id).all();
    const libur = await db.prepare('SELECT * FROM libur WHERE kelompok_id = ? OR kelompok_id IS NULL ORDER BY tanggal DESC LIMIT 100').bind(id).all();
    const pengumuman = await db.prepare('SELECT * FROM pengumuman WHERE kelompok_id = ? ORDER BY id DESC LIMIT 20').bind(id).all();
    return json({
      kelompok: k,
      hari_ini: hariIniWIB(),
      siswa: data.map((d) => ({ ...d.siswa, ...d.status })),
      jadwal: jadwal.results,
      libur: libur.results,
      pengumuman: pengumuman.results,
    });
  },

  'GET /siswa/:id': async ({ db, u, id, url }) => {
    wajibPeran(u, 'admin', 'guru');
    const s = await cekAksesSiswa(db, u, id);
    const p = await ambilPengaturan(db);
    const hari = Math.min(400, parseInt(url.searchParams.get('riwayat') || '60'));
    const [r] = await statusBanyakSiswa(db, [s], p, hari);
    const log = await db.prepare('SELECT b.*, o.nama AS oleh_nama FROM bacaan b LEFT JOIN users o ON o.id = b.oleh WHERE b.siswa_id = ? ORDER BY b.id DESC LIMIT 100').bind(id).all();
    const jadwal = await db.prepare('SELECT * FROM jadwal WHERE siswa_id = ? ORDER BY mulai DESC').bind(id).all();
    return json({ siswa: s, kelompok: r.kelompok, status: r.status, log: log.results, jadwal_khusus: jadwal.results });
  },

  // guru mengatur tgl mulai / halaman mulai siswa
  'PUT /siswa/:id/mulai': async ({ db, u, id, body }) => {
    wajibPeran(u, 'admin', 'guru');
    await cekAksesSiswa(db, u, id);
    const hlm = Math.max(1, Math.min(TOTAL_HALAMAN, parseInt(body.halaman_mulai || 1)));
    if (body.tgl_mulai && !validTgl(body.tgl_mulai)) throw new HttpError('Tanggal tidak valid');
    await db.prepare('UPDATE users SET tgl_mulai = ?, halaman_mulai = ? WHERE id = ?').bind(body.tgl_mulai || null, hlm, id).run();
    return json({ ok: true });
  },

  // guru menyetor bacaan siswa secara manual (mis. setoran langsung di kelas)
  'POST /siswa/:id/setor': async ({ db, u, id, body }) => {
    wajibPeran(u, 'admin', 'guru');
    const s = await cekAksesSiswa(db, u, id);
    const jumlah = parseInt(body.jumlah);
    if (!(jumlah >= 1 && jumlah <= 604)) throw new HttpError('Jumlah halaman 1–604');
    const tgl = body.tanggal || hariIniWIB();
    if (!validTgl(tgl) || tgl > hariIniWIB()) throw new HttpError('Tanggal tidak valid / di masa depan');
    const p = await ambilPengaturan(db);
    const [r] = await statusBanyakSiswa(db, [s], p);
    let hlm = r.status.halaman_berikut;
    const stmts = [];
    for (let i = 0; i < jumlah; i++) {
      stmts.push(db.prepare('INSERT INTO bacaan (siswa_id, halaman, tanggal, sumber, oleh) VALUES (?,?,?,?,?)').bind(id, hlm, tgl, 'guru', u.id));
      hlm = hlm >= TOTAL_HALAMAN ? 1 : hlm + 1;
    }
    await db.batch(stmts);
    return json({ ok: true });
  },

  'DELETE /bacaan/:id': async ({ db, u, id }) => {
    wajibPeran(u, 'admin', 'guru');
    const b = await db.prepare('SELECT * FROM bacaan WHERE id = ?').bind(id).first();
    if (!b) throw new HttpError('Data tidak ditemukan', 404);
    await cekAksesSiswa(db, u, b.siswa_id);
    await db.prepare('DELETE FROM bacaan WHERE id = ?').bind(id).run();
    return json({ ok: true });
  },

  // target/jadwal (kelompok atau per siswa)
  'POST /jadwal': async ({ db, u, body }) => {
    wajibPeran(u, 'admin', 'guru');
    const hpd = parseInt(body.halaman_per_hari);
    if (!(hpd >= 0 && hpd <= 604)) throw new HttpError('Target halaman per hari tidak valid');
    const mulai = body.mulai || hariIniWIB();
    if (!validTgl(mulai)) throw new HttpError('Tanggal mulai tidak valid');
    if (body.siswa_id) {
      await cekAksesSiswa(db, u, body.siswa_id);
      await db.prepare('INSERT INTO jadwal (siswa_id, mulai, halaman_per_hari, dibuat_oleh) VALUES (?,?,?,?)').bind(body.siswa_id, mulai, hpd, u.id).run();
    } else if (body.kelompok_id) {
      await cekAksesKelompok(db, u, body.kelompok_id);
      await db.prepare('INSERT INTO jadwal (kelompok_id, mulai, halaman_per_hari, dibuat_oleh) VALUES (?,?,?,?)').bind(body.kelompok_id, mulai, hpd, u.id).run();
    } else throw new HttpError('Pilih kelompok atau siswa');
    return json({ ok: true });
  },

  'DELETE /jadwal/:id': async ({ db, u, id }) => {
    wajibPeran(u, 'admin', 'guru');
    const j = await db.prepare('SELECT * FROM jadwal WHERE id = ?').bind(id).first();
    if (!j) throw new HttpError('Jadwal tidak ditemukan', 404);
    if (j.siswa_id) await cekAksesSiswa(db, u, j.siswa_id);
    else {
      await cekAksesKelompok(db, u, j.kelompok_id);
      const n = await db.prepare('SELECT COUNT(*) n FROM jadwal WHERE kelompok_id = ? AND siswa_id IS NULL').bind(j.kelompok_id).first();
      if (n.n <= 1) throw new HttpError('Kelompok harus memiliki minimal satu target. Ubah dengan menambah target baru.');
    }
    await db.prepare('DELETE FROM jadwal WHERE id = ?').bind(id).run();
    return json({ ok: true });
  },

  'POST /libur': async ({ db, u, body }) => {
    wajibPeran(u, 'admin', 'guru');
    if (!validTgl(body.tanggal)) throw new HttpError('Tanggal tidak valid');
    const sampai = validTgl(body.sampai) ? body.sampai : body.tanggal;
    if (body.kelompok_id) await cekAksesKelompok(db, u, body.kelompok_id);
    else if (u.peran !== 'admin') throw new HttpError('Hanya admin yang dapat membuat libur untuk semua kelompok', 403);
    const stmts = [];
    for (let t = body.tanggal; t <= sampai && stmts.length < 120; t = tambahHari(t, 1))
      stmts.push(db.prepare('INSERT INTO libur (tanggal, kelompok_id, keterangan) VALUES (?,?,?)').bind(t, body.kelompok_id || null, body.keterangan || null));
    await db.batch(stmts);
    return json({ ok: true, jumlah: stmts.length });
  },

  'GET /libur': async ({ db, u }) => {
    wajibPeran(u, 'admin', 'guru');
    const { results } = await db.prepare('SELECT l.*, k.nama AS kelompok_nama FROM libur l LEFT JOIN kelompok k ON k.id = l.kelompok_id ORDER BY tanggal DESC LIMIT 300').all();
    return json(results);
  },

  'DELETE /libur/:id': async ({ db, u, id }) => {
    wajibPeran(u, 'admin', 'guru');
    const l = await db.prepare('SELECT * FROM libur WHERE id = ?').bind(id).first();
    if (!l) throw new HttpError('Tidak ditemukan', 404);
    if (l.kelompok_id) await cekAksesKelompok(db, u, l.kelompok_id);
    else if (u.peran !== 'admin') throw new HttpError('Akses ditolak', 403);
    await db.prepare('DELETE FROM libur WHERE id = ?').bind(id).run();
    return json({ ok: true });
  },

  'POST /pengumuman': async ({ db, u, body }) => {
    wajibPeran(u, 'admin', 'guru');
    if (body.kelompok_id) await cekAksesKelompok(db, u, body.kelompok_id);
    else if (u.peran !== 'admin') throw new HttpError('Pilih kelompok', 400);
    if (!body.isi) throw new HttpError('Isi pengumuman wajib diisi');
    await db.prepare('INSERT INTO pengumuman (kelompok_id, judul, isi, oleh) VALUES (?,?,?,?)').bind(body.kelompok_id || null, body.judul || null, body.isi, u.id).run();
    return json({ ok: true });
  },

  'DELETE /pengumuman/:id': async ({ db, u, id }) => {
    wajibPeran(u, 'admin', 'guru');
    const p = await db.prepare('SELECT * FROM pengumuman WHERE id = ?').bind(id).first();
    if (!p) throw new HttpError('Tidak ditemukan', 404);
    if (u.peran !== 'admin' && p.oleh !== u.id) throw new HttpError('Akses ditolak', 403);
    await db.prepare('DELETE FROM pengumuman WHERE id = ?').bind(id).run();
    return json({ ok: true });
  },

  'GET /peringkat/:id': async ({ db, u, id }) => {
    wajibPeran(u, 'admin', 'guru');
    await cekAksesKelompok(db, u, id);
    return json(await peringkat(db, id));
  },

  // ---------- ADMIN: pengguna ----------
  'GET /users': async ({ db, u, url }) => {
    wajibPeran(u, 'admin');
    const peran = url.searchParams.get('peran');
    const kel = url.searchParams.get('kelompok_id');
    let q = `SELECT u.id, u.username, u.nama, u.peran, u.kelompok_id, u.nis, u.jk, u.tgl_mulai, u.halaman_mulai, u.aktif, u.wajib_ganti_pw, u.guru_agama, k.nama AS kelompok_nama
             FROM users u LEFT JOIN kelompok k ON k.id = u.kelompok_id WHERE 1=1`;
    const b = [];
    if (peran) { q += ' AND u.peran = ?'; b.push(peran); }
    if (kel) { q += ' AND u.kelompok_id = ?'; b.push(kel); }
    q += ' ORDER BY u.peran, k.nama, u.nama';
    const { results } = await db.prepare(q).bind(...b).all();
    return json(results);
  },

  'POST /users': async ({ db, u, body }) => {
    wajibPeran(u, 'admin');
    const hasil = await buatUser(db, body);
    return json(hasil);
  },

  // impor massal: body.users = [{username, nama, password, peran, kelompok, nis, jk}]
  'POST /users/import': async ({ db, u, body }) => {
    wajibPeran(u, 'admin');
    const list = Array.isArray(body.users) ? body.users : [];
    if (!list.length) throw new HttpError('Data kosong');
    if (list.length > 25) throw new HttpError('Maksimal 25 baris per permintaan (aplikasi mengirim bertahap otomatis)');
    const { results: kel } = await db.prepare('SELECT id, nama FROM kelompok').all();
    const kelMap = Object.fromEntries(kel.map((k) => [k.nama.trim().toLowerCase(), k.id]));
    const ok = [], gagal = [];
    for (const [i, row] of list.entries()) {
      try {
        const kname = String(row.kelompok || '').trim().toLowerCase();
        if (kname && !kelMap[kname]) {
          const r = await HANDLER['POST /kelompok']({ db, u, body: { nama: String(row.kelompok).trim() } });
          kelMap[kname] = (await r.json()).id;
        }
        const r = await buatUser(db, { ...row, peran: row.peran || 'siswa', kelompok_id: kname ? kelMap[kname] : null });
        ok.push({ baris: i + 1, ...r });
      } catch (e) { gagal.push({ baris: i + 1, username: row.username, error: e.message }); }
    }
    return json({ berhasil: ok.length, gagal, akun: ok });
  },

  'PUT /users/:id': async ({ db, u, id, body }) => {
    wajibPeran(u, 'admin');
    const lama = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    if (!lama) throw new HttpError('Pengguna tidak ditemukan', 404);
    const v = { ...lama, ...body };
    if (id === u.id && (v.peran !== 'admin' || !v.aktif)) throw new HttpError('Tidak bisa menurunkan/menonaktifkan akun sendiri');
    const uname = String(v.username).trim().toLowerCase();
    const dup = await db.prepare('SELECT id FROM users WHERE lower(username) = ? AND id != ?').bind(uname, id).first();
    if (dup) throw new HttpError('Username sudah dipakai');
    await db.prepare('UPDATE users SET username=?, nama=?, peran=?, kelompok_id=?, nis=?, jk=?, aktif=?, guru_agama=? WHERE id=?')
      .bind(uname, v.nama, v.peran, v.peran === 'siswa' ? (v.kelompok_id || null) : null, v.nis || null, v.jk || null, v.aktif ? 1 : 0, v.peran === 'guru' && (v.guru_agama === 1 || v.guru_agama === '1' || v.guru_agama === true) ? 1 : 0, id).run();
    if (v.peran !== 'guru' || !(v.guru_agama === 1 || v.guru_agama === '1' || v.guru_agama === true)) await db.prepare('UPDATE kelompok SET guru2_id = NULL WHERE guru2_id = ?').bind(id).run();
    if (body.password) {
      await db.prepare('UPDATE users SET password=?, wajib_ganti_pw=1 WHERE id=?').bind(await hashPassword(String(body.password)), id).run();
      await db.prepare('DELETE FROM sesi WHERE user_id = ?').bind(id).run();
    }
    return json({ ok: true });
  },

  'DELETE /users/:id': async ({ db, u, id }) => {
    wajibPeran(u, 'admin');
    if (id === u.id) throw new HttpError('Tidak bisa menghapus akun sendiri');
    await db.batch([
      db.prepare('DELETE FROM bacaan WHERE siswa_id = ?').bind(id),
      db.prepare('DELETE FROM owoj_baca WHERE pilihan_id IN (SELECT id FROM owoj_pilihan WHERE user_id = ?)').bind(id),
      db.prepare('DELETE FROM owoj_pilihan WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM jadwal WHERE siswa_id = ?').bind(id),
      db.prepare('DELETE FROM sesi WHERE user_id = ?').bind(id),
      db.prepare('UPDATE kelompok SET guru_id = NULL WHERE guru_id = ?').bind(id),
      db.prepare('UPDATE kelompok SET guru2_id = NULL WHERE guru2_id = ?').bind(id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(id),
    ]);
    return json({ ok: true });
  },

  'GET /pengaturan': async ({ db, u }) => {
    wajibPeran(u, 'admin');
    return json(await ambilPengaturan(db));
  },

  'PUT /pengaturan': async ({ db, u, body }) => {
    wajibPeran(u, 'admin');
    const izin = ['nama_lembaga', 'sub_judul', 'poin_harian', 'poin_khatam', 'default_halaman_per_hari', 'logo', 'owoj_aktif', 'owoj_hari_mulai', 'owoj_juz_unik', 'owoj_poin', 'owoj_hitung_tadarus', 'target_guru', 'tadarus_guru_aktif', 'izin_cetak', 'owoj_cakupan', 'owoj_maks_juz', 'owoj_kunci_depan'];
    const stmts = Object.entries(body).filter(([k]) => izin.includes(k))
      .map(([k, v]) => db.prepare('INSERT INTO pengaturan (kunci, nilai) VALUES (?,?) ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai').bind(k, String(v ?? '')));
    if (stmts.length) await db.batch(stmts);
    return json({ ok: true });
  },

  'GET /dashboard': async ({ db, u }) => {
    wajibPeran(u, 'admin');
    const p = await ambilPengaturan(db);
    const c = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM users WHERE peran='siswa' AND aktif=1) siswa,
      (SELECT COUNT(*) FROM users WHERE peran='guru' AND aktif=1) guru,
      (SELECT COUNT(*) FROM kelompok) kelompok,
      (SELECT COUNT(*) FROM bacaan WHERE tanggal = ?) halaman_hari_ini,
      (SELECT COUNT(*) FROM bacaan) halaman_total`).bind(hariIniWIB()).first();
    const { results } = await db.prepare(`SELECT ${kolomSiswa} FROM users WHERE peran='siswa' AND aktif=1`).all();
    const data = await statusBanyakSiswa(db, results, p);
    const selesai = data.filter((d) => d.status.selesai_hari_ini).length;
    const berhutang = data.filter((d) => d.status.hutang > 0).length;
    const khatam = data.reduce((a, d) => a + d.status.khatam, 0);
    return json({ ...c, selesai_hari_ini: selesai, berhutang, total_khatam: khatam });
  },
};

async function buatUser(db, b) {
  const username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new HttpError('Username 3–40 karakter (huruf kecil, angka, titik, minus, garis bawah)');
  if (!b.nama) throw new HttpError('Nama wajib diisi');
  const peran = ['admin', 'guru', 'siswa'].includes(b.peran) ? b.peran : 'siswa';
  const dup = await db.prepare('SELECT id FROM users WHERE lower(username) = ?').bind(username).first();
  if (dup) throw new HttpError(`Username "${username}" sudah dipakai`);
  const password = String(b.password || '') || Math.random().toString(36).slice(2, 8);
  let tglMulai = validTgl(b.tgl_mulai) ? b.tgl_mulai : null;
  if (!tglMulai && peran === 'siswa') {
    // mulai hari ini, atau tanggal mulai kelompok bila program kelompok baru dimulai nanti
    tglMulai = hariIniWIB();
    if (b.kelompok_id) {
      const k = await db.prepare('SELECT tgl_mulai FROM kelompok WHERE id = ?').bind(b.kelompok_id).first();
      if (k?.tgl_mulai && k.tgl_mulai > tglMulai) tglMulai = k.tgl_mulai;
    }
  }
  const r = await db.prepare('INSERT INTO users (username, nama, password, peran, kelompok_id, nis, jk, tgl_mulai, halaman_mulai) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(username, String(b.nama).trim(), await hashPassword(password), peran, peran === 'siswa' ? (b.kelompok_id || null) : null,
      b.nis || null, b.jk || null, tglMulai, Math.max(1, Math.min(604, parseInt(b.halaman_mulai || 1))))
    .run();
  const ga = String(b.guru_agama ?? '').trim().toLowerCase();
  if (peran === 'guru' && ['1', 'ya', 'y', 'true', 'agama'].includes(ga)) await db.prepare('UPDATE users SET guru_agama = 1 WHERE id = ?').bind(r.meta.last_row_id).run();
  return { id: r.meta.last_row_id, username, password, nama: b.nama };
}

async function peringkat(db, kelompokId) {
  const p = await ambilPengaturan(db);
  const q = kelompokId
    ? db.prepare(`SELECT ${kolomSiswa} FROM users WHERE peran='siswa' AND aktif=1 AND kelompok_id = ?`).bind(kelompokId)
    : db.prepare(`SELECT ${kolomSiswa} FROM users WHERE peran='siswa' AND aktif=1`);
  const { results } = await q.all();
  const data = await statusBanyakSiswa(db, results, p);
  return data
    .map((d) => ({ id: d.siswa.id, nama: d.siswa.nama, poin: d.status.poin, khatam: d.status.khatam, total_dibaca: d.status.total_dibaca, streak: d.status.streak, hutang: d.status.hutang }))
    .sort((a, b) => b.poin - a.poin || b.total_dibaca - a.total_dibaca);
}

// =========================================================
//  PROGRAM OWOJ (One Week One Juz)
// =========================================================
const JUZ = [[1,1,21],[2,22,41],[3,42,61],[4,62,81],[5,82,101],[6,102,121],[7,122,141],[8,142,161],[9,162,181],[10,182,201],[11,202,221],[12,222,241],[13,242,262],[14,262,281],[15,282,301],[16,302,321],[17,322,341],[18,342,361],[19,362,382],[20,382,401],[21,401,421],[22,422,441],[23,441,461],[24,462,481],[25,482,502],[26,502,521],[27,522,541],[28,542,561],[29,562,581],[30,582,604]];
const halJuz = (j) => { const r = JUZ[j - 1]; return { awal: r[1], akhir: r[2], total: r[2] - r[1] + 1 }; };
const OWOJ_DEF = { owoj_aktif: '1', owoj_hari_mulai: '1', owoj_juz_unik: '1', owoj_poin: '50', owoj_cakupan: 'sekolah', owoj_maks_juz: '5', owoj_kunci_depan: '1' };
// cakupan 'sekolah' = semua murid & guru berbagi satu peta 30 juz; 'kelompok' = peta per kelompok
const perKelompok = (p) => p.owoj_cakupan === 'kelompok';
function pekanDari(tgl, hariMulai) {
  const h = hariKe(tgl);
  const mulai = tambahHari(tgl, -((h - hariMulai + 7) % 7));
  return { mulai, akhir: tambahHari(mulai, 6) };
}
async function infoPekan(db) {
  const p = { ...OWOJ_DEF, ...(await ambilPengaturan(db)) };
  const hi = hariIniWIB();
  const pk = pekanDari(hi, parseInt(p.owoj_hari_mulai));
  const sisa = Math.round((Date.parse(pk.akhir) - Date.parse(hi)) / 864e5) + 1;
  return { p, hari_ini: hi, pekan: pk.mulai, akhir: pk.akhir, sisa_hari: sisa, pekan_depan: tambahHari(pk.mulai, 7) };
}
// kelompok OWOJ seorang pengguna: siswa → kelompoknya; guru → kelompok yang dipilih (miliknya)
async function kelompokOwoj(db, u, kid) {
  if (u.peran === 'siswa') return u.kelompok_id || 0;
  if (kid === undefined || kid === null || kid === '') {
    const k = await db.prepare('SELECT id FROM kelompok WHERE guru_id = ? OR guru2_id = ? ORDER BY (guru_id = ?) DESC, nama LIMIT 1').bind(u.id, u.id, u.id).first();
    if (k) return k.id;
    if (u.peran === 'admin') { const a = await db.prepare('SELECT id FROM kelompok ORDER BY nama LIMIT 1').first(); return a ? a.id : 0; }
    return 0;
  }
  kid = parseInt(kid);
  if (kid && u.peran === 'guru') await cekAksesKelompok(db, u, kid);
  return kid;
}
const detailPilihan = (r) => {
  const hj = halJuz(r.juz);
  return { ...r, ...hj, putaran: r.putaran || 1, halaman_berikut: r.dibaca >= hj.total ? null : hj.awal + r.dibaca, persen: Math.round((r.dibaca / hj.total) * 100) };
};
// semua juz yang dipilih seorang pengguna pada suatu pekan
async function pilihanSaya(db, userId, pekan) {
  const { results } = await db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM owoj_baca b WHERE b.pilihan_id = p.id) AS dibaca
     FROM owoj_pilihan p WHERE p.user_id = ? AND p.pekan = ? ORDER BY p.id`).bind(userId, pekan).all();
  return results.map(detailPilihan);
}
async function satuPilihan(db, id, userId) {
  const r = await db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM owoj_baca b WHERE b.pilihan_id = p.id) AS dibaca
     FROM owoj_pilihan p WHERE p.id = ? AND p.user_id = ?`).bind(id, userId).first();
  return r ? detailPilihan(r) : null;
}
// pilihan pekan ini: berdasarkan id, atau juz pertama yang belum tuntas
async function pilihanTarget(db, u, pekan, id) {
  if (id) {
    const pl = await satuPilihan(db, parseInt(id), u.id);
    if (!pl || pl.pekan !== pekan) throw new HttpError('Juz OWOJ tidak ditemukan untuk pekan ini');
    return pl;
  }
  const semua = await pilihanSaya(db, u.id, pekan);
  return semua.find((x) => x.halaman_berikut) || semua[0] || null;
}
async function petaJuz(db, kelompokId, pekan, satuSekolah = false) {
  const { results } = await db.prepare(`SELECT p.id, p.juz, p.putaran, p.user_id, p.selesai_pada, u.nama, u.peran, k.nama AS kelompok_nama,
      (SELECT COUNT(*) FROM owoj_baca b WHERE b.pilihan_id = p.id) AS dibaca
      FROM owoj_pilihan p JOIN users u ON u.id = p.user_id LEFT JOIN kelompok k ON k.id = p.kelompok_id
      WHERE p.pekan = ? ${satuSekolah ? '' : 'AND p.kelompok_id = ?'} ORDER BY p.juz, p.putaran, p.id`).bind(...(satuSekolah ? [pekan] : [pekan, kelompokId])).all();
  return results.map((r) => ({ ...r, putaran: r.putaran || 1, total: halJuz(r.juz).total }));
}
// statistik putaran: juz boleh diambil lagi bila semua juz sudah diambil sebanyak juz tsb (sistem putaran)
function statPeta(peta) {
  const ambil = Array(31).fill(0), tuntas = Array(31).fill(0);
  for (const x of peta) { ambil[x.juz]++; if (x.selesai_pada) tuntas[x.juz]++; }
  const minAmbil = Math.min(...ambil.slice(1)), khatam = Math.min(...tuntas.slice(1));
  return {
    khatam,                                   // berapa kali 30 juz tuntas dalam pekan ini
    putaran: minAmbil + 1,                    // putaran yang sedang dibuka untuk dipilih
    diambil_putaran: ambil.slice(1).filter((n) => n > minAmbil).length,   // juz yang sudah diambil di putaran berjalan
    tuntas_putaran: tuntas.slice(1).filter((n) => n > khatam).length,    // juz tuntas menuju khatam berikutnya
    ambil, tuntas,
  };
}
async function ringkasPekan(db, sekolah, kid) {
  const w = sekolah ? '1=1' : 'kelompok_id = ?', b = sekolah ? [] : [kid];
  const { results: per } = await db.prepare(`SELECT pekan, COUNT(DISTINCT user_id) AS peserta, COUNT(*) AS pilihan,
      SUM(CASE WHEN selesai_pada IS NOT NULL THEN 1 ELSE 0 END) AS tuntas FROM owoj_pilihan WHERE ${w} GROUP BY pekan ORDER BY pekan DESC LIMIT 12`).bind(...b).all();
  if (!per.length) return [];
  const { results: pj } = await db.prepare(`SELECT pekan, juz, SUM(CASE WHEN selesai_pada IS NOT NULL THEN 1 ELSE 0 END) AS t FROM owoj_pilihan
      WHERE ${w} AND pekan >= ? GROUP BY pekan, juz`).bind(...b, per[per.length - 1].pekan).all();
  return per.map((r) => {
    const t = Array(31).fill(0);
    for (const x of pj) if (x.pekan === r.pekan) t[x.juz] = x.t;
    return { ...r, khatam: Math.min(...t.slice(1)), juz_tuntas: t.slice(1).filter((n) => n > 0).length };
  });
}

Object.assign(HANDLER, {
  'GET /owoj': async ({ db, u, url }) => {
    wajibPeran(u, 'siswa', 'guru', 'admin');
    const I = await infoPekan(db);
    const kid = await kelompokOwoj(db, u, url.searchParams.get('kelompok_id'));
    const pekan = validTgl(url.searchParams.get('pekan')) ? pekanDari(url.searchParams.get('pekan'), parseInt(I.p.owoj_hari_mulai)).mulai : I.pekan;
    const sekolah = !perKelompok(I.p);
    const [saya, sayaDepan, peta, petaDepan, ringkas] = await Promise.all([
      pilihanSaya(db, u.id, I.pekan), pilihanSaya(db, u.id, I.pekan_depan),
      petaJuz(db, kid, pekan, sekolah), petaJuz(db, kid, I.pekan_depan, sekolah), ringkasPekan(db, sekolah, kid),
    ]);
    const riwayat = await db.prepare(`SELECT p.id, p.pekan, p.juz, p.putaran, p.selesai_pada, (SELECT COUNT(*) FROM owoj_baca b WHERE b.pilihan_id = p.id) AS dibaca
      FROM owoj_pilihan p WHERE p.user_id = ? ORDER BY p.pekan DESC, p.id DESC LIMIT 20`).bind(u.id).all();
    const kelompok = kid ? await db.prepare('SELECT id, nama, min_detik FROM kelompok WHERE id = ?').bind(kid).first() : null;
    let kelompokSaya = [];
    if (u.peran !== 'siswa') {
      const q = u.peran === 'admin' ? db.prepare('SELECT id, nama FROM kelompok ORDER BY nama') : db.prepare('SELECT id, nama FROM kelompok WHERE guru_id = ? OR guru2_id = ? ORDER BY nama').bind(u.id, u.id);
      kelompokSaya = (await q.all()).results;
    }
    const st = statPeta(peta), stD = statPeta(petaDepan);
    // kunci pemesanan pekan depan selama pekan berjalan belum khatam (30 juz tuntas)
    const stIni = pekan === I.pekan ? st : statPeta(await petaJuz(db, kid, I.pekan, sekolah));
    const kunciDepan = (I.p.owoj_kunci_depan ?? '1') !== '0' && stIni.khatam < 1;
    const tuntasIni = stIni.tuntas_putaran, kosongIni = stIni.ambil.slice(1).filter((n) => n <= stIni.khatam).length; // juz yang belum diambil menuju khatam berikutnya
    delete st.ambil; delete st.tuntas; delete stD.ambil; delete stD.tuntas;
    return json({
      aktif: I.p.owoj_aktif !== '0', hari_ini: I.hari_ini, pekan, pekan_ini: I.pekan, akhir: pekanDari(pekan, parseInt(I.p.owoj_hari_mulai)).akhir, sisa_hari: I.sisa_hari,
      juz_unik: I.p.owoj_juz_unik !== '0', poin: parseInt(I.p.owoj_poin), maks_juz: parseInt(I.p.owoj_maks_juz ?? '5'),
      kelompok, kelompok_id: kid, kelompok_saya: kelompokSaya,
      saya, peta, stat: st, riwayat: riwayat.results, ringkas, min_detik: kelompok?.min_detik ?? 30,
      pekan_depan: I.pekan_depan, akhir_depan: tambahHari(I.pekan_depan, 6), saya_depan: sayaDepan, peta_depan: petaDepan, stat_depan: stD,
      izin_cetak: (I.p.izin_cetak ?? '1') !== '0', cakupan: sekolah ? 'sekolah' : 'kelompok',
      kunci_depan: kunciDepan, ini_tuntas: stIni.khatam >= 1 ? 30 : tuntasIni, ini_kosong: stIni.khatam >= 1 ? 0 : kosongIni,
    });
  },

  'POST /owoj/pilih': async ({ db, u, body }) => {
    wajibPeran(u, 'siswa', 'guru', 'admin');
    const I = await infoPekan(db);
    if (I.p.owoj_aktif === '0') throw new HttpError('Program OWOJ sedang tidak aktif');
    const juz = parseInt(body.juz);
    if (!(juz >= 1 && juz <= 30)) throw new HttpError('Juz tidak valid');
    const kid = await kelompokOwoj(db, u, body.kelompok_id);
    const depan = body.untuk === 'depan';
    const pekan = depan ? I.pekan_depan : I.pekan;
    if (depan && (I.p.owoj_kunci_depan ?? '1') !== '0') {
      const stIni = statPeta(await petaJuz(db, kid, I.pekan, !perKelompok(I.p)));
      if (stIni.khatam < 1) {
        const kosong = []; for (let j = 1; j <= 30; j++) if (stIni.ambil[j] === 0) kosong.push(j);
        throw new HttpError(`Pekan ini belum khatam (${stIni.tuntas_putaran}/30 juz tuntas). Pemesanan juz pekan depan dibuka setelah 30 juz pekan ini tuntas.` + (kosong.length ? ` Juz yang belum diambil pekan ini: ${kosong.join(', ')}.` : ''));
      }
    }
    const milik = await pilihanSaya(db, u.id, pekan);
    const maks = parseInt(I.p.owoj_maks_juz ?? '5');
    if (maks > 0 && milik.length >= maks) throw new HttpError(`Maksimal ${maks} juz per orang dalam satu pekan.`);
    if (milik.some((x) => x.juz === juz && !x.selesai_pada)) throw new HttpError(`Juz ${juz} sudah ada di daftar Anda dan belum tuntas.`);
    const peta = await petaJuz(db, kid, pekan, !perKelompok(I.p));
    const st = statPeta(peta);
    const putaran = st.ambil[juz] + 1;
    if (I.p.owoj_juz_unik !== '0' && st.ambil[juz] > st.ambil.slice(1).reduce((a, b) => Math.min(a, b), Infinity)) {
      const oleh = peta.filter((x) => x.juz === juz).map((x) => x.nama).pop();
      const sisa = []; for (let j = 1; j <= 30; j++) if (st.ambil[j] < st.putaran) sisa.push(j);
      throw new HttpError(`Juz ${juz} sudah diambil ${oleh} pada putaran ke-${st.putaran}. Juz yang masih tersedia: ${sisa.join(', ')}.`);
    }
    await db.prepare('INSERT INTO owoj_pilihan (user_id, kelompok_id, pekan, juz, putaran) VALUES (?,?,?,?,?)').bind(u.id, kid, pekan, juz, putaran).run();
    return json({ ok: true, putaran, saya: await pilihanSaya(db, u.id, pekan) });
  },

  'POST /owoj/batal': async ({ db, u, body }) => {
    wajibPeran(u, 'siswa', 'guru', 'admin');
    const pl = await satuPilihan(db, parseInt(body.id), u.id);
    if (!pl) throw new HttpError('Pilihan juz tidak ditemukan');
    if (pl.dibaca > 0) throw new HttpError('Sudah mulai dibaca, tidak bisa dibatalkan');
    await db.prepare('DELETE FROM owoj_pilihan WHERE id = ?').bind(pl.id).run();
    return json({ ok: true });
  },

  'POST /owoj/baca': async ({ db, u, body }) => {
    wajibPeran(u, 'siswa', 'guru', 'admin');
    const I = await infoPekan(db);
    const pl = await pilihanTarget(db, u, I.pekan, body.id);
    if (!pl) throw new HttpError('Pilih juz OWOJ pekan ini terlebih dahulu');
    if (!pl.halaman_berikut) throw new HttpError(`Juz ${pl.juz} sudah tuntas. Alhamdulillah!`);
    const hlm = parseInt(body.halaman);
    if (hlm !== pl.halaman_berikut) throw new HttpError(`Bacaan harus berurutan. Halaman berikutnya: ${pl.halaman_berikut}`);
    const k = pl.kelompok_id ? await db.prepare('SELECT min_detik FROM kelompok WHERE id = ?').bind(pl.kelompok_id).first() : null;
    const minDetik = k?.min_detik ?? 30;
    const akhir = await db.prepare(`SELECT (julianday('now') - julianday(b.waktu)) * 86400 AS detik FROM owoj_baca b JOIN owoj_pilihan p ON p.id = b.pilihan_id
      WHERE p.user_id = ? AND (b.sumber IS NULL OR b.sumber = 'app') ORDER BY b.id DESC LIMIT 1`).bind(u.id).first();
    if (akhir && akhir.detik < minDetik) throw new HttpError(`Bacalah dengan tartil. Tunggu ${Math.ceil(minDetik - akhir.detik)} detik lagi sebelum menandai halaman ini.`, 429);
    await db.prepare('INSERT INTO owoj_baca (pilihan_id, halaman) VALUES (?,?)').bind(pl.id, hlm).run();
    let baru = await satuPilihan(db, pl.id, u.id);
    let tuntas = false;
    if (!baru.halaman_berikut && !baru.selesai_pada) {
      await db.prepare(`UPDATE owoj_pilihan SET selesai_pada = datetime('now') WHERE id = ?`).bind(pl.id).run();
      tuntas = true; baru = await satuPilihan(db, pl.id, u.id);
    }
    return json({ ok: true, tuntas, poin: parseInt(I.p.owoj_poin), saya: baru });
  },

  'POST /owoj/batal-baca': async ({ db, u, body }) => {
    wajibPeran(u, 'siswa', 'guru', 'admin');
    const I = await infoPekan(db);
    const pl = await pilihanTarget(db, u, I.pekan, body.id);
    if (!pl || !pl.dibaca) throw new HttpError('Tidak ada bacaan yang bisa dibatalkan');
    await db.batch([
      db.prepare('DELETE FROM owoj_baca WHERE id = (SELECT MAX(id) FROM owoj_baca WHERE pilihan_id = ?)').bind(pl.id),
      db.prepare('UPDATE owoj_pilihan SET selesai_pada = NULL WHERE id = ?').bind(pl.id),
    ]);
    return json({ ok: true });
  },

  // rekap OWOJ kelompok untuk guru/admin
  'GET /owoj/rekap/:id': async ({ db, u, id, url }) => {
    wajibPeran(u, 'guru', 'admin');
    await cekAksesKelompok(db, u, id);
    const I = await infoPekan(db);
    const pekan = validTgl(url.searchParams.get('pekan')) ? pekanDari(url.searchParams.get('pekan'), parseInt(I.p.owoj_hari_mulai)).mulai : I.pekan;
    const peta = await petaJuz(db, id, pekan, !perKelompok(I.p));
    const { results: anggota } = await db.prepare(`SELECT id, nama, nis, username FROM users WHERE peran='siswa' AND aktif=1 AND kelompok_id = ? ORDER BY nama`).bind(id).all();
    const byUser = {};
    for (const x of peta) (byUser[x.user_id] ||= []).push(x);
    return json({
      pekan, akhir: pekanDari(pekan, parseInt(I.p.owoj_hari_mulai)).akhir, pekan_ini: I.pekan,
      siswa: anggota.map((s) => ({ ...s, pilihan: byUser[s.id] || [] })),
      guru: peta.filter((x) => x.peran !== 'siswa'), peta,
    });
  },
});

// =========================================================
//  LAPORAN BACA DARI MUSHAF CETAK (offline) + REKAP TADARUS GURU
// =========================================================
Object.assign(HANDLER, {
  // body: { jenis: 'tadarus' | 'owoj', jumlah, tanggal, pernyataan: true }
  'POST /saya/cetak': async ({ db, u, body }) => {
    wajibPeran(u, 'siswa', 'guru', 'admin');
    const p = { ...OWOJ_DEF, ...(await ambilPengaturan(db)) };
    if ((p.izin_cetak ?? '1') === '0') throw new HttpError('Laporan baca mushaf cetak sedang tidak diizinkan');
    if (body.pernyataan !== true) throw new HttpError('Centang pernyataan kejujuran terlebih dahulu');
    const hi = hariIniWIB(), kemarin = tambahHari(hi, -1);
    const tgl = body.tanggal || hi;
    if (tgl !== hi && tgl !== kemarin) throw new HttpError('Laporan hanya untuk hari ini atau kemarin');
    const jumlah = parseInt(body.jumlah);
    if (!(jumlah >= 1 && jumlah <= 100)) throw new HttpError('Jumlah halaman 1–100 per laporan');
    if (body.jenis === 'owoj') {
      const I = await infoPekan(db);
      if (tgl < I.pekan) throw new HttpError('Tanggal di luar pekan OWOJ ini');
      const pl = await pilihanTarget(db, u, I.pekan, body.pilihan_id);
      if (!pl) throw new HttpError('Pilih juz OWOJ pekan ini terlebih dahulu');
      const sisa = pl.total - pl.dibaca;
      if (!sisa) throw new HttpError(`Juz ${pl.juz} sudah tuntas`);
      const n = Math.min(jumlah, sisa);
      const waktu = tgl + ' 05:00:00'; // = pukul 12.00 WIB pada tanggal tsb
      const st = [];
      for (let i = 0; i < n; i++) st.push(db.prepare('INSERT INTO owoj_baca (pilihan_id, halaman, waktu, sumber) VALUES (?,?,?,?)').bind(pl.id, pl.halaman_berikut + i, waktu, 'cetak'));
      await db.batch(st);
      let tuntas = false;
      if (n === sisa) { await db.prepare(`UPDATE owoj_pilihan SET selesai_pada = datetime('now') WHERE id = ?`).bind(pl.id).run(); tuntas = true; }
      return json({ ok: true, jenis: 'owoj', juz: pl.juz, dicatat: n, tuntas, dari: pl.halaman_berikut, sampai: pl.halaman_berikut + n - 1 });
    }
    // tadarus harian: lanjut berurutan dari posisi terakhir
    const s = await db.prepare(`SELECT ${kolomSiswa} FROM users WHERE id = ?`).bind(u.id).first();
    const [r] = await statusBanyakSiswa(db, [s], p);
    let hlm = r.status.halaman_berikut;
    const dari = hlm;
    const st = [];
    for (let i = 0; i < jumlah; i++) {
      st.push(db.prepare('INSERT INTO bacaan (siswa_id, halaman, tanggal, sumber, oleh) VALUES (?,?,?,?,?)').bind(u.id, hlm, tgl, 'cetak', u.id));
      hlm = hlm >= TOTAL_HALAMAN ? 1 : hlm + 1;
    }
    await db.batch(st);
    return json({ ok: true, jenis: 'tadarus', dicatat: jumlah, dari, sampai: dari + jumlah - 1 > TOTAL_HALAMAN ? (dari + jumlah - 1) - TOTAL_HALAMAN : dari + jumlah - 1 });
  },

  'GET /guru-tadarus': async ({ db, u }) => {
    wajibPeran(u, 'admin', 'guru');
    const p = await ambilPengaturan(db);
    const { results } = await db.prepare(`SELECT ${kolomSiswa} FROM users WHERE peran = 'guru' AND aktif = 1 ORDER BY nama`).all();
    for (const g of results) if (!g.tgl_mulai) g.tgl_mulai = hariIniWIB();
    const data = await statusBanyakSiswa(db, results, p, 7);
    return json(data.map((d) => ({ ...d.siswa, ...d.status })));
  },
});

// =========================================================
//  KODE GABUNG KELOMPOK
// =========================================================
const HURUF_KODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa O/0/I/1 agar tidak tertukar
async function kodeBaru(db, nama) {
  const awal = String(nama || 'GRUP').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'GRUP';
  for (let i = 0; i < 20; i++) {
    const acak = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => HURUF_KODE[b % HURUF_KODE.length]).join('');
    const kode = `${awal}-${acak}`;
    const ada = await db.prepare('SELECT id FROM kelompok WHERE kode = ?').bind(kode).first();
    if (!ada) return kode;
  }
  throw new HttpError('Gagal membuat kode, coba lagi');
}
Object.assign(HANDLER, {
  // cek kode sebelum bergabung
  'GET /gabung': async ({ db, u, url }) => {
    wajibPeran(u, 'siswa');
    const kode = String(url.searchParams.get('kode') || '').trim().toUpperCase();
    const k = await db.prepare('SELECT k.id, k.nama, k.kode_aktif, g.nama AS guru_nama, g2.nama AS guru2_nama FROM kelompok k LEFT JOIN users g ON g.id = k.guru_id LEFT JOIN users g2 ON g2.id = k.guru2_id WHERE upper(k.kode) = ?').bind(kode).first();
    if (!k) throw new HttpError('Kode kelompok tidak ditemukan. Periksa kembali kodenya.', 404);
    if (k.kode_aktif === 0) throw new HttpError('Kode kelompok ini sedang dinonaktifkan oleh guru.');
    const target = await db.prepare('SELECT halaman_per_hari FROM jadwal WHERE kelompok_id = ? AND siswa_id IS NULL AND mulai <= ? ORDER BY mulai DESC, id DESC LIMIT 1').bind(k.id, hariIniWIB()).first();
    return json({ ...k, target: target?.halaman_per_hari ?? 0, sudah_anggota: u.kelompok_id === k.id });
  },
  'POST /gabung': async ({ db, u, body }) => {
    wajibPeran(u, 'siswa');
    const kode = String(body.kode || '').trim().toUpperCase();
    const k = await db.prepare('SELECT id, nama, kode_aktif, tgl_mulai FROM kelompok WHERE upper(kode) = ?').bind(kode).first();
    if (!k) throw new HttpError('Kode kelompok tidak ditemukan', 404);
    if (k.kode_aktif === 0) throw new HttpError('Kode kelompok ini sedang dinonaktifkan oleh guru.');
    if (u.kelompok_id === k.id) return json({ ok: true, kelompok: k.nama });
    const adaBacaan = await db.prepare('SELECT COUNT(*) n FROM bacaan WHERE siswa_id = ?').bind(u.id).first();
    // belum punya kelompok/riwayat → jadwal dimulai hari ini (atau tanggal mulai kelompok bila lebih akhir)
    let tgl = u.tgl_mulai;
    if (!u.kelompok_id || !adaBacaan.n || !tgl) { tgl = hariIniWIB(); if (k.tgl_mulai && k.tgl_mulai > tgl) tgl = k.tgl_mulai; }
    await db.prepare('UPDATE users SET kelompok_id = ?, tgl_mulai = ? WHERE id = ?').bind(k.id, tgl, u.id).run();
    return json({ ok: true, kelompok: k.nama });
  },
  'POST /kelompok/:id/kode': async ({ db, u, id }) => {
    wajibPeran(u, 'admin', 'guru');
    await cekAksesKelompok(db, u, id);
    const k = await db.prepare('SELECT nama FROM kelompok WHERE id = ?').bind(id).first();
    const kode = await kodeBaru(db, k.nama);
    await db.prepare('UPDATE kelompok SET kode = ?, kode_aktif = 1 WHERE id = ?').bind(kode, id).run();
    return json({ ok: true, kode });
  },
  'POST /kelompok/:id/keluarkan': async ({ db, u, id, body }) => {
    wajibPeran(u, 'admin', 'guru');
    await cekAksesKelompok(db, u, id);
    const r = await db.prepare(`UPDATE users SET kelompok_id = NULL WHERE id = ? AND kelompok_id = ? AND peran = 'siswa'`).bind(parseInt(body.siswa_id), id).run();
    if (!r.meta.changes) throw new HttpError('Siswa tidak ditemukan di kelompok ini');
    return json({ ok: true });
  },
});

// =========================================================
//  GURU AGAMA SEBAGAI PENDAMPING KE-2 KELOMPOK
// =========================================================
Object.assign(HANDLER, {
  // daftar semua kelompok beserta wali kelas & guru agama (untuk guru agama / admin)
  'GET /dampingan': async ({ db, u }) => {
    wajibPeran(u, 'admin', 'guru');
    if (u.peran === 'guru' && !u.guru_agama) throw new HttpError('Fitur ini khusus guru agama', 403);
    const { results } = await db.prepare(`SELECT k.id, k.nama, k.guru_id, k.guru2_id, g.nama AS guru_nama, g2.nama AS guru2_nama,
      (SELECT COUNT(*) FROM users s WHERE s.kelompok_id = k.id AND s.peran='siswa' AND s.aktif=1) AS jumlah_siswa
      FROM kelompok k LEFT JOIN users g ON g.id = k.guru_id LEFT JOIN users g2 ON g2.id = k.guru2_id ORDER BY k.nama`).all();
    const { results: guruAgama } = await db.prepare(`SELECT id, nama FROM users WHERE peran='guru' AND aktif=1 AND guru_agama=1 ORDER BY nama`).all();
    return json({ kelompok: results, guru_agama: guruAgama });
  },
  // body: { guru_id (khusus admin), pasang: [id kelompok], lepas: [id kelompok] }
  'POST /dampingan': async ({ db, u, body }) => {
    wajibPeran(u, 'admin', 'guru');
    let gid = u.id;
    if (u.peran === 'admin') gid = parseInt(body.guru_id);
    else if (!u.guru_agama) throw new HttpError('Fitur ini khusus guru agama', 403);
    const g = await db.prepare(`SELECT id, nama, guru_agama FROM users WHERE id = ? AND peran = 'guru'`).bind(gid).first();
    if (!g) throw new HttpError('Guru tidak ditemukan');
    if (!g.guru_agama) throw new HttpError(`${g.nama} belum ditandai sebagai Guru Agama. Ubah di menu Pengguna.`);
    const pasang = (body.pasang || []).map(Number).filter(Boolean).slice(0, 80);
    const lepas = (body.lepas || []).map(Number).filter(Boolean).slice(0, 80);
    const st = [], gagal = [];
    for (const kid of pasang) {
      const k = await db.prepare('SELECT nama, guru_id, guru2_id FROM kelompok WHERE id = ?').bind(kid).first();
      if (!k) continue;
      if (k.guru_id === gid) { gagal.push(`${k.nama}: sudah menjadi wali kelas`); continue; }
      if (k.guru2_id && k.guru2_id !== gid && u.peran !== 'admin') { gagal.push(`${k.nama}: sudah ada guru agama lain`); continue; }
      st.push(db.prepare('UPDATE kelompok SET guru2_id = ? WHERE id = ?').bind(gid, kid));
    }
    for (const kid of lepas) st.push(db.prepare('UPDATE kelompok SET guru2_id = NULL WHERE id = ? AND guru2_id = ?').bind(kid, gid));
    if (st.length) await db.batch(st);
    return json({ ok: true, diproses: st.length, gagal });
  },
});
