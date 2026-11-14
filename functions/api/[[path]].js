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
function hitungStatus({ siswa, kelompok, jadwalK, jadwalS, liburSet, logHarian, pengaturan, hariIni, riwayatHari = 0 }) {
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
    return v ?? 0;
  };

  // total bacaan sebelum tanggal mulai (jika ada) tetap dihitung
  let kum = 0;
  for (const [t, n] of Object.entries(logHarian)) if (t < mulai) kum += n;

  let wajib = 0, poin = 0, hariTepat = 0, hariTerjadwal = 0, streak = 0;
  let wajibKemarin = 0;
  const riwayat = [];
  let targetHariIni = 0, terjadwalHariIni = false;

  if (mulai <= hariIni) {
    for (let t = mulai; t <= hariIni; t = tambahHari(t, 1)) {
      const ppd = efektif(t);
      const terjadwal = ppd > 0 && hariAktif.includes(String(hariKe(t))) && !liburSet.has(t);
      const dibaca = logHarian[t] || 0;
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

  const total = kum;
  const posisi = halamanMulai - 1 + total;          // jumlah halaman yang telah dilewati dari awal mushaf
  const khatam = Math.floor(posisi / TOTAL_HALAMAN);
  const halamanBerikut = (posisi % TOTAL_HALAMAN) + 1;
  poin += khatam * poinKhatam;

  // hutang = kewajiban hari-hari sebelumnya yang belum terbayar (bacaan hari ini lebih dulu melunasi hutang)
  const hutang = Math.max(0, wajibKemarin - total);
  const sisaHariIni = Math.max(0, wajib - total);    // termasuk hutang
  const spare = Math.max(0, total - wajib);
  const dibacaHariIni = logHarian[hariIni] || 0;

  return {
    tgl_mulai: mulai,
    halaman_mulai: halamanMulai,
    total_dibaca: total,
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

function pesanNotif(s, nama) {
  const n = nama.split(' ')[0];
  if (!s.terjadwal_hari_ini && s.hutang === 0) return { jenis: 'info', teks: `Hari ini tidak ada jadwal tadarus, ${n}. Tetap boleh membaca untuk menabung halaman.` };
  if (s.selesai_hari_ini) {
    if (s.spare > 0) return { jenis: 'sukses', teks: `Alhamdulillah, target hari ini tuntas! Kamu punya tabungan ${s.spare} halaman untuk hari berikutnya.` };
    return { jenis: 'sukses', teks: `Alhamdulillah, target tadarus hari ini sudah tuntas. Barakallahu fiik, ${n}!` };
  }
  if (s.hutang > 0) return { jenis: 'bahaya', teks: `${n}, kamu punya hutang ${s.hutang} halaman. Hari ini wajib membaca ${s.sisa_hari_ini} halaman (target ${s.target_hari_ini} + hutang).` };
  return { jenis: 'peringatan', teks: `${n}, hari ini kamu wajib membaca ${s.sisa_hari_ini} halaman, mulai halaman ${s.halaman_berikut}.` };
}

// Memuat data yang dibutuhkan untuk menghitung banyak siswa sekaligus
async function statusBanyakSiswa(db, daftarSiswa, pengaturan, riwayatHari = 0) {
  if (!daftarSiswa.length) return [];
  const hariIni = hariIniWIB();
  const ids = daftarSiswa.map((s) => s.id);
  const kids = [...new Set(daftarSiswa.map((s) => s.kelompok_id).filter(Boolean))];
  const ph = (arr) => arr.map(() => '?').join(',') || 'NULL';

  const [kel, jad, lib, log] = await Promise.all([
    kids.length ? db.prepare(`SELECT * FROM kelompok WHERE id IN (${ph(kids)})`).bind(...kids).all() : { results: [] },
    db.prepare(`SELECT * FROM jadwal WHERE siswa_id IN (${ph(ids)}) ${kids.length ? `OR kelompok_id IN (${ph(kids)})` : ''} ORDER BY mulai, id`).bind(...ids, ...kids).all(),
    db.prepare(`SELECT tanggal, kelompok_id FROM libur WHERE kelompok_id IS NULL ${kids.length ? `OR kelompok_id IN (${ph(kids)})` : ''}`).bind(...kids).all(),
    db.prepare(`SELECT siswa_id, tanggal, COUNT(*) n FROM bacaan WHERE siswa_id IN (${ph(ids)}) GROUP BY siswa_id, tanggal`).bind(...ids).all(),
  ]);
  const kelMap = Object.fromEntries(kel.results.map((k) => [k.id, k]));
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
      pengaturan,
      hariIni,
      riwayatHari,
    });
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
  const k = await db.prepare('SELECT guru_id FROM kelompok WHERE id = ?').bind(kelompokId).first();
  if (!k || k.guru_id !== u.id) throw new HttpError('Kelompok ini bukan milik Anda', 403);
  return true;
}
async function cekAksesSiswa(db, u, siswaId) {
  const s = await db.prepare(`SELECT ${kolomSiswa} FROM users WHERE id = ? AND peran = 'siswa'`).bind(siswaId).first();
  if (!s) throw new HttpError('Siswa tidak ditemukan', 404);
  if (u.peran === 'admin') return s;
  if (u.peran === 'guru') { await cekAksesKelompok(db, u, s.kelompok_id); return s; }
  throw new HttpError('Akses ditolak', 403);
}

// =========================================================
//  ROUTER
// =========================================================
export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  const db = env.DB;
  if (!db) return err('Database D1 belum di-binding (nama binding: DB)', 500);
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
    if (u.kelompok_id) kelompok = await db.prepare('SELECT k.*, g.nama AS guru_nama FROM kelompok k LEFT JOIN users g ON g.id = k.guru_id WHERE k.id = ?').bind(u.kelompok_id).first();
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
    wajibPeran(u, 'siswa');
    const p = await ambilPengaturan(db);
    const hari = Math.min(400, parseInt(url.searchParams.get('riwayat') || '42'));
    const s = await db.prepare(`SELECT ${kolomSiswa} FROM users WHERE id = ?`).bind(u.id).first();
    const [r] = await statusBanyakSiswa(db, [s], p, hari);
    const pengumuman = await db.prepare('SELECT p.*, u.nama AS oleh_nama FROM pengumuman p LEFT JOIN users u ON u.id = p.oleh WHERE p.kelompok_id IS NULL OR p.kelompok_id = ? ORDER BY p.id DESC LIMIT 5').bind(s.kelompok_id || 0).all();
    const terakhir = await db.prepare('SELECT waktu FROM bacaan WHERE siswa_id = ? ORDER BY id DESC LIMIT 1').bind(u.id).first();
    return json({
      ...r.status,
      notif: pesanNotif(r.status, u.nama),
      min_detik: r.kelompok?.min_detik ?? 30,
      terakhir_baca: terakhir?.waktu || null,
      pengumuman: pengumuman.results,
      hari_ini: hariIniWIB(),
    });
  },

  // tandai halaman selesai dibaca (harus berurutan)
  'POST /saya/baca': async ({ db, u, body }) => {
    wajibPeran(u, 'siswa');
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
    return json({ ...r2.status, notif: pesanNotif(r2.status, u.nama), khatam_baru: r2.status.khatam > r.status.khatam });
  },

  // batalkan tanda terakhir (hanya bacaan hari ini lewat aplikasi)
  'POST /saya/batal': async ({ db, u }) => {
    wajibPeran(u, 'siswa');
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
    const where = u.peran === 'guru' ? 'WHERE k.guru_id = ?' : '';
    const st = db.prepare(`SELECT k.*, g.nama AS guru_nama, (SELECT COUNT(*) FROM users s WHERE s.kelompok_id = k.id AND s.peran='siswa' AND s.aktif=1) AS jumlah_siswa,
      (SELECT halaman_per_hari FROM jadwal j WHERE j.kelompok_id = k.id AND j.siswa_id IS NULL AND j.mulai <= ? ORDER BY j.mulai DESC, j.id DESC LIMIT 1) AS target
      FROM kelompok k LEFT JOIN users g ON g.id = k.guru_id ${where} ORDER BY k.nama`);
    const { results } = u.peran === 'guru' ? await st.bind(hariIniWIB(), u.id).all() : await st.bind(hariIniWIB()).all();
    return json(results);
  },

  'POST /kelompok': async ({ db, u, body }) => {
    wajibPeran(u, 'admin');
    if (!body.nama) throw new HttpError('Nama kelompok wajib diisi');
    const p = await ambilPengaturan(db);
    const mulai = validTgl(body.tgl_mulai) ? body.tgl_mulai : hariIniWIB();
    const r = await db.prepare('INSERT INTO kelompok (nama, guru_id, hari_aktif, min_detik, tgl_mulai, keterangan) VALUES (?,?,?,?,?,?)')
      .bind(body.nama, body.guru_id || null, body.hari_aktif || '0123456', parseInt(body.min_detik ?? 30), mulai, body.keterangan || null).run();
    const kid = r.meta.last_row_id;
    await db.prepare('INSERT INTO jadwal (kelompok_id, mulai, halaman_per_hari, dibuat_oleh) VALUES (?,?,?,?)')
      .bind(kid, mulai, parseInt(body.halaman_per_hari || p.default_halaman_per_hari || 2), u.id).run();
    return json({ id: kid });
  },

  'PUT /kelompok/:id': async ({ db, u, body, id }) => {
    wajibPeran(u, 'admin', 'guru');
    await cekAksesKelompok(db, u, id);
    const k = await db.prepare('SELECT * FROM kelompok WHERE id = ?').bind(id).first();
    const v = { ...k, ...body };
    if (u.peran === 'guru') { v.guru_id = k.guru_id; v.nama = body.nama || k.nama; }
    await db.prepare('UPDATE kelompok SET nama=?, guru_id=?, hari_aktif=?, min_detik=?, tgl_mulai=?, keterangan=? WHERE id=?')
      .bind(v.nama, v.guru_id || null, String(v.hari_aktif ?? '0123456'), parseInt(v.min_detik ?? 30), v.tgl_mulai, v.keterangan || null, id).run();
    return json({ ok: true });
  },

  'DELETE /kelompok/:id': async ({ db, u, id }) => {
    wajibPeran(u, 'admin');
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
    const k = await db.prepare('SELECT k.*, g.nama AS guru_nama FROM kelompok k LEFT JOIN users g ON g.id = k.guru_id WHERE k.id = ?').bind(id).first();
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
    let q = `SELECT u.id, u.username, u.nama, u.peran, u.kelompok_id, u.nis, u.jk, u.tgl_mulai, u.halaman_mulai, u.aktif, u.wajib_ganti_pw, k.nama AS kelompok_nama
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
    if (list.length > 500) throw new HttpError('Maksimal 500 baris per impor');
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
    await db.prepare('UPDATE users SET username=?, nama=?, peran=?, kelompok_id=?, nis=?, jk=?, aktif=? WHERE id=?')
      .bind(uname, v.nama, v.peran, v.peran === 'siswa' ? (v.kelompok_id || null) : null, v.nis || null, v.jk || null, v.aktif ? 1 : 0, id).run();
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
      db.prepare('DELETE FROM jadwal WHERE siswa_id = ?').bind(id),
      db.prepare('DELETE FROM sesi WHERE user_id = ?').bind(id),
      db.prepare('UPDATE kelompok SET guru_id = NULL WHERE guru_id = ?').bind(id),
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
    const izin = ['nama_lembaga', 'sub_judul', 'poin_harian', 'poin_khatam', 'default_halaman_per_hari', 'logo'];
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
