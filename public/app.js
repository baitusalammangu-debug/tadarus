/* =========================================================
   APLIKASI TADARUS — Frontend (vanilla JS, tanpa build)
   ========================================================= */
'use strict';

const S = {
  token: localStorage.getItem('tadarus_token'),
  me: null,          // {user, kelompok, pengaturan, hari_ini}
  info: null,
  meta: null,        // data surah & juz
  status: null,      // status siswa terakhir
};
const TOTAL = 604;
const HARI = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// ---------- util ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const angkaArab = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const tglIndo = (t, hari = true) => {
  if (!t) return '-';
  const d = new Date(t.slice(0, 10) + 'T00:00:00Z');
  return (hari ? HARI[d.getUTCDay()] + ', ' : '') + d.getUTCDate() + ' ' + BULAN[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
};
const hariIni = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const waktuWIB = (dt) => { if (!dt) return '-'; const d = new Date(dt.replace(' ', 'T') + 'Z'); return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (error ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.className = ''), 3200);
}
function modal(html, onReady) {
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
  onReady && onReady($('#modal-body'));
}
function tutupModal() { $('#modal').classList.add('hidden'); $('#modal-body').innerHTML = ''; }
document.addEventListener('click', (e) => {
  if (e.target.id === 'modal') tutupModal();
  if (e.target.closest('[data-tutup]')) tutupModal();
});

async function api(path, opt = {}) {
  const res = await fetch('/api' + path, {
    method: opt.method || 'GET',
    headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && path !== '/login') { keluar(false); throw new Error(data.error || 'Sesi berakhir'); }
  if (!res.ok) throw new Error(data.error || 'Gagal (' + res.status + ')');
  return data;
}
const coba = async (fn, pesanOk) => {
  try { const r = await fn(); if (pesanOk) toast(pesanOk); return r; }
  catch (e) { toast(e.message, true); throw e; }
};

async function muatMeta() {
  if (S.meta) return S.meta;
  S.meta = await (await fetch('/quran/meta.json')).json();
  return S.meta;
}
const cacheHalaman = {};
const cacheBlok = {};
// data mushaf disimpan per 20 halaman: /quran/h/1.json = hlm 1–20, dst.
async function muatHalaman(n) {
  if (cacheHalaman[n]) return cacheHalaman[n];
  const k = Math.floor((n - 1) / 20) + 1;
  cacheBlok[k] ||= fetch(`/quran/h/${k}.json`).then((r) => { if (!r.ok) throw new Error('Gagal memuat halaman ' + n); return r.json(); });
  try {
    const blok = await cacheBlok[k];
    for (const [p, d] of Object.entries(blok)) cacheHalaman[p] = d;
  } catch (e) { delete cacheBlok[k]; throw e; }
  return cacheHalaman[n];
}
function surahDiHalaman(p) {
  let s = S.meta.surah[0];
  for (const x of S.meta.surah) if (x[4] <= p) s = x; else break;
  return s;
}
function juzDiHalaman(p) {
  let j = 1;
  for (const x of S.meta.juz) if (x[1] <= p) j = x[0];
  return j;
}

// ---------- kerangka tampilan ----------
const NAV = {
  siswa: [['#/', '🏠', 'Beranda'], ['#/baca', '📖', 'Tadarus'], ['#/owoj', '🗓️', 'OWOJ'], ['#/mushaf', '🕮', 'Mushaf'], ['#/peringkat', '🏆', 'Peringkat'], ['#/riwayat', '📅', 'Riwayat']],
  guru: [['#/', '👥', 'Kelompok'], ['#/saya', '📖', 'Tadarus Saya'], ['#/owoj', '🗓️', 'OWOJ'], ['#/mushaf', '🕮', 'Mushaf'], ['#/akun', '👤', 'Akun']],
  admin: [['#/', '📊', 'Dasbor'], ['#/kelompok', '👥', 'Kelompok'], ['#/pengguna', '🪪', 'Pengguna'], ['#/owoj', '🗓️', 'OWOJ'], ['#/pengaturan', '⚙️', 'Atur'], ['#/libur', '📆', 'Libur'], ['#/mushaf', '🕮', 'Mushaf']],
};
function shell(html) {
  const u = S.me.user;
  const p = S.me.pengaturan;
  const nav = NAV[u.peran];
  const cur = location.hash || '#/';
  const aktif = (h) => (h === '#/' ? cur === '#/' || cur === '' : cur.startsWith(h)) ? 'aktif' : '';
  $('#app').innerHTML = `
  <header class="topbar">
    <img src="${esc(p.logo || '/icons/icon-192.png')}" alt="">
    <div class="judul"><b>${esc(p.nama_lembaga || 'Tadarus')}</b><span>${esc(u.nama)} · ${u.peran === 'siswa' ? (S.me.kelompok ? esc(S.me.kelompok.nama) : 'Siswa') : u.peran === 'guru' ? 'Guru' : 'Admin'}</span></div>
    <button onclick="location.hash='#/akun'" title="Akun">👤</button>
  </header>
  <div class="shell">
    <nav class="sidenav">${nav.filter(([h]) => h !== '#/akun').map(([h, i, l]) => `<a href="${h}" class="${aktif(h)}"><span>${i}</span>${l}</a>`).join('')}
      <a href="#/akun" class="${aktif('#/akun')}"><span>👤</span>Akun</a></nav>
    <main class="wrap" id="main">${html}</main>
  </div>
  <nav class="bottomnav">${nav.slice(0, 5).map(([h, i, l]) => `<a href="${h}" class="${aktif(h)}"><span class="ik">${i}</span>${l}</a>`).join('')}</nav>`;
  window.scrollTo(0, 0);
  return $('#main');
}
const memuat = () => shell('<div class="kosong">Memuat…</div>');

// =========================================================
//  LOGIN
// =========================================================
async function viewLogin() {
  const info = S.info || (S.info = await api('/info').catch(() => ({})));
  $('#app').innerHTML = `
  <div class="login"><form class="box" id="f-login">
    <img class="logo" src="${esc(info.logo || '/icons/icon-192.png')}" alt="">
    <h1 style="text-align:center;margin-bottom:2px">${esc(info.nama_lembaga || 'Tadarus Al-Qur\'an')}</h1>
    <p class="muted small" style="text-align:center;margin-top:0">${esc(info.sub_judul || 'Program Tadarus Rutin Harian')}</p>
    <div class="ayat">فَاقْرَءُوْا مَا تَيَسَّرَ مِنَ الْقُرْاٰنِۗ</div>
    <p class="tiny muted" style="text-align:center;margin-top:-4px">“Maka bacalah apa yang mudah (bagimu) dari Al-Qur'an” — QS. Al-Muzzammil: 20</p>
    <div class="field"><label>Username</label><input class="input" name="username" autocomplete="username" autocapitalize="none" required></div>
    <div class="field"><label>Password</label><input class="input" type="password" name="password" autocomplete="current-password" required></div>
    <button class="btn blok besar">Masuk</button>
    <p class="tiny muted" style="text-align:center;margin-bottom:0">Akun diberikan oleh admin/guru. Lupa password? Hubungi admin.</p>
  </form></div>`;
  $('#f-login').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = $('button', e.target); btn.disabled = true; btn.textContent = 'Memeriksa…';
    try {
      const r = await api('/login', { method: 'POST', body: f });
      S.token = r.token; localStorage.setItem('tadarus_token', r.token);
      await muatSaya();
      const kg = sessionStorage.getItem('kode_gabung');
      location.hash = kg && S.me.user.peran === 'siswa' ? '#/gabung/' + encodeURIComponent(kg) : '#/'; router();
    } catch (er) { toast(er.message, true); btn.disabled = false; btn.textContent = 'Masuk'; }
  };
}
async function muatSaya() {
  S.me = await api('/me');
  simpanTokenUntukSW();
  return S.me;
}
async function keluar(panggilApi = true) {
  if (panggilApi && S.token) { try { await api('/logout', { method: 'POST' }); } catch {} }
  S.token = null; S.me = null; S.status = null;
  localStorage.removeItem('tadarus_token');
  try { const c = await caches.open('tadarus-auth'); await c.delete('/__token'); } catch {}
  location.hash = '#/login';
  viewLogin();
}

// =========================================================
//  NOTIFIKASI / PENGINGAT
// =========================================================
async function simpanTokenUntukSW() {
  if (!('caches' in window) || !S.token || !['siswa', 'guru'].includes(S.me?.user?.peran)) return;
  try {
    const c = await caches.open('tadarus-auth');
    const lama = await c.match('/__token');
    const terakhir = lama ? (await lama.json()).terakhir : null;
    await c.put('/__token', new Response(JSON.stringify({ token: S.token, terakhir })));
  } catch {}
}
async function aktifkanNotif() {
  if (!('Notification' in window)) return toast('Perangkat/browser ini tidak mendukung notifikasi', true);
  const izin = await Notification.requestPermission();
  if (izin !== 'granted') return toast('Izin notifikasi ditolak. Aktifkan lewat pengaturan browser.', true);
  const reg = await navigator.serviceWorker?.ready;
  try {
    if (reg && 'periodicSync' in reg) await reg.periodicSync.register('tadarus-pengingat', { minInterval: 6 * 3600e3 });
  } catch {}
  toast('Pengingat tadarus aktif ✓');
  router();
}
async function notifHarian(st) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || st.selesai_hari_ini) return;
  const kunci = 'notif_' + st.hari_ini;
  if (localStorage.getItem(kunci)) return;
  localStorage.setItem(kunci, '1');
  const reg = await navigator.serviceWorker?.ready;
  const opt = { body: st.notif.teks, icon: '/icons/icon-192.png', tag: 'tadarus-harian', data: { url: '/#/baca' } };
  try { reg ? reg.showNotification('Waktunya Tadarus 📖', opt) : new Notification('Waktunya Tadarus 📖', opt); } catch {}
}

// =========================================================
//  SISWA
// =========================================================
async function muatStatus(riwayat = 42) {
  S.status = await api('/saya/status?riwayat=' + riwayat);
  return S.status;
}

async function viewBerandaSiswa() {
  memuat();
  await muatMeta();
  const [st, ow] = await Promise.all([muatStatus(14), api('/owoj').catch(() => null)]);
  notifHarian(st);
  const owAktif = ow && ow.aktif ? ow.saya.filter((x) => !x.selesai_pada) : [];
  const kartuOwoj = !ow || !ow.aktif ? '' : ow.saya.length ? `
    <a class="card flat row spread" href="#/owoj${owAktif.length ? '/baca/' + owAktif[0].id : ''}" style="color:inherit">
      <div style="flex:1"><b>🗓️ OWOJ · ${ow.saya.map((x) => 'Juz ' + x.juz + (x.selesai_pada ? ' ✓' : '')).join(', ')}</b>
      <div class="small muted">${owAktif.length ? `Juz ${owAktif[0].juz}: ${owAktif[0].dibaca}/${owAktif[0].total} halaman · ${ow.sisa_hari} hari lagi` : 'Semua juz pilihanmu tuntas ✓ · boleh ambil juz lagi'}${ow.stat.khatam ? ` · 🏆 khatam bersama ${ow.stat.khatam}×` : ''}</div>
      ${owAktif.length ? `<div class="progress" style="margin-top:6px"><i style="width:${owAktif[0].persen}%"></i></div>` : ''}</div>
      <span class="btn kecil emas" style="margin-left:10px">${owAktif.length ? 'Baca' : 'Lihat'}</span></a>` : `
    <a class="card flat row spread" href="#/owoj" style="color:inherit"><div><b>🗓️ OWOJ pekan ini</b><div class="small muted">Kamu belum memilih juz. ${30 - ow.stat.diambil_putaran} juz tersedia di putaran ${ow.stat.putaran}.</div></div><span class="btn kecil">Pilih juz</span></a>`;
  const u = S.me.user;
  const kewajibanHariIni = st.dibaca_hari_ini + st.sisa_hari_ini;
  const pct = st.selesai_hari_ini ? 100 : Math.round((st.dibaca_hari_ini / Math.max(1, kewajibanHariIni)) * 100);
  const sur = surahDiHalaman(st.halaman_berikut);
  const jam = new Date(Date.now() + 7 * 3600e3).getUTCHours();
  const salam = jam < 11 ? 'Selamat pagi' : jam < 15 ? 'Selamat siang' : jam < 18 ? 'Selamat sore' : 'Selamat malam';
  const notifCard = ('Notification' in window && Notification.permission !== 'granted') ? `
    <div class="card flat row spread"><div><b>🔔 Aktifkan pengingat harian</b><div class="small muted">Dapatkan notifikasi kewajiban tadarus setiap hari.</div></div>
    <button class="btn kecil" onclick="aktifkanNotif()">Aktifkan</button></div>` : '';

  shell(`
  <section class="hero">
    <div class="salam">${salam}, Assalamu'alaikum</div>
    <h1>${esc(u.nama)}</h1>
    <div class="wajib">
      <div class="ring" style="--p:${pct}"><div>${st.selesai_hari_ini ? '<b>✓</b><span>Tuntas</span>' : `<b>${st.sisa_hari_ini}</b><span>halaman lagi</span>`}</div></div>
      <div class="info">
        <p>🎯 Target hari ini: <b>${st.terjadwal_hari_ini ? st.target_hari_ini + ' halaman' : 'Libur'}</b></p>
        <p>📖 Sudah dibaca: <b>${st.dibaca_hari_ini} halaman</b>${st.dibaca_owoj_hari_ini ? ` <span class="tiny">(${st.dibaca_owoj_hari_ini} hlm OWOJ)</span>` : ''}</p>
        ${st.hutang ? `<p>⚠️ Hutang: <b>${st.hutang} halaman</b></p>` : ''}
        ${st.spare ? `<p>💰 Tabungan: <b>${st.spare} halaman</b></p>` : ''}
        <p class="small" style="opacity:.85">Mulai: hlm ${st.halaman_berikut} · ${esc(sur[1])} · Juz ${juzDiHalaman(st.halaman_berikut)}</p>
      </div>
    </div>
    <a class="btn emas blok besar" href="#/baca">${st.selesai_hari_ini ? '📖 Baca lagi (menabung halaman)' : '📖 Mulai Tadarus Sekarang'}</a>
    ${S.me.pengaturan.izin_cetak !== '0' ? `<button class="btn putih blok" style="margin-top:8px;background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.3)" onclick="laporCetak('tadarus')">📗 Sudah membaca dari mushaf cetak? Laporkan di sini</button>` : ''}
  </section>
  <div class="alert ${st.notif.jenis}">${{ sukses: '✅', bahaya: '⏰', peringatan: '📌', info: 'ℹ️' }[st.notif.jenis]} <span>${esc(st.notif.teks)}</span></div>
  ${u.peran === 'siswa' && !S.me.kelompok ? `<a class="card row spread" href="#/akun" style="color:inherit;border-left:5px solid var(--biru)"><div><b>👥 Kamu belum masuk kelompok</b><div class="small muted">Masukkan kode gabung dari gurumu agar mendapat target tadarus.</div></div><span class="btn kecil">Masukkan kode</span></a>` : ''}
  ${kartuOwoj}
  ${notifCard}
  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat hijau"><div class="n">${st.poin}</div><div class="l">⭐ Poin${st.poin_owoj ? ` (OWOJ ${st.poin_owoj})` : ''}</div></div>
    <div class="stat emas"><div class="n">${st.streak}</div><div class="l">🔥 Hari beruntun</div></div>
    <div class="stat biru"><div class="n">${st.khatam}</div><div class="l">🎉 Khatam</div></div>
    <div class="stat ${st.persen_disiplin < 70 ? 'merah' : 'hijau'}"><div class="n">${st.persen_disiplin}%</div><div class="l">✔️ Tepat jadwal</div></div>
  </div>
  <div class="card">
    <div class="row spread"><h3 style="margin:0">Progres khatam ke-${st.khatam + 1}</h3><span class="badge hijau">${st.progres_khatam}%</span></div>
    <div class="progress" style="margin:10px 0 6px"><i style="width:${st.progres_khatam}%"></i></div>
    <div class="small muted">Halaman ${st.halaman_berikut - 1} dari ${TOTAL} · total dibaca ${st.total_dibaca} halaman sejak ${tglIndo(st.tgl_mulai, false)}</div>
  </div>
  <div class="card">
    <div class="row spread"><h3 style="margin:0">14 hari terakhir</h3><a class="small" href="#/riwayat">Lihat semua →</a></div>
    <div style="margin-top:12px">${kalender(st.riwayat || [], true)}</div>
  </div>
  ${st.pengumuman?.length ? `<div class="card"><h3>📢 Pengumuman</h3>${st.pengumuman.map((p) => `
    <div style="padding:10px 0;border-top:1px solid #f0ede4">${p.judul ? `<b>${esc(p.judul)}</b><br>` : ''}<span style="white-space:pre-line">${esc(p.isi)}</span>
    <div class="tiny muted">${esc(p.oleh_nama || '')} · ${waktuWIB(p.dibuat)}</div></div>`).join('')}</div>` : ''}
  `);
}

// ---------- kalender riwayat ----------
function kalender(riwayat, ringkas = false) {
  if (!riwayat.length) return '<div class="kosong small">Belum ada riwayat jadwal.</div>';
  const awal = new Date(riwayat[0].t + 'T00:00:00Z').getUTCDay();
  const today = hariIni();
  let html = '<div class="kal">' + HARI.map((h) => `<div class="h">${h.slice(0, 3)}</div>`).join('');
  for (let i = 0; i < awal; i++) html += '<div></div>';
  for (const r of riwayat) {
    const tgl = parseInt(r.t.slice(8));
    const judul = `${tglIndo(r.t)} — ${r.status === 'tepat' ? 'Tepat jadwal' : r.status === 'kurang' ? 'Tidak memenuhi target' : r.status === 'belum' ? 'Belum selesai' : r.status === 'libur' ? 'Libur' : 'Tidak terjadwal'} · dibaca ${r.dibaca} hlm${r.ppd ? ' / target ' + r.ppd : ''}`;
    html += `<div class="d ${r.status} ${r.t === today ? 'hariini' : ''}" title="${esc(judul)}">${tgl}${r.dibaca ? `<small>${r.dibaca}</small>` : ''}</div>`;
  }
  html += '</div>';
  html += `<div class="legend"><span><i style="background:var(--hijau)"></i>Tepat jadwal</span><span><i style="background:var(--merah-muda);border:1px solid #f1c3be"></i>Tidak terpenuhi</span><span><i style="border:2px dashed var(--emas)"></i>Hari ini</span><span><i style="background:var(--biru-muda)"></i>Libur</span><span class="tiny">angka kecil = halaman dibaca</span></div>`;
  return html;
}

async function viewRiwayat() {
  memuat();
  const st = await muatStatus(120);
  shell(`
  <h1>Riwayat Tadarus</h1>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat"><div class="n">${st.total_dibaca}</div><div class="l">Total halaman</div></div>
    <div class="stat hijau"><div class="n">${st.hari_tepat}/${st.hari_terjadwal}</div><div class="l">Hari tepat jadwal</div></div>
    <div class="stat merah"><div class="n">${st.hutang}</div><div class="l">Hutang halaman</div></div>
    <div class="stat emas"><div class="n">${st.spare}</div><div class="l">Tabungan halaman</div></div>
  </div>
  <div class="card"><h3>Kalender (120 hari terakhir)</h3>${kalender(st.riwayat)}</div>
  <div class="card small">
    <h3>Cara perhitungan</h3>
    <ul style="padding-left:18px;margin:0;line-height:1.7">
      <li>Setiap hari terjadwal kamu wajib membaca sesuai target guru.</li>
      <li>Jika tidak membaca (misal berhalangan), halaman hari itu menjadi <b>hutang</b> dan wajib diganti. Bacaan berikutnya otomatis melunasi hutang lebih dulu.</li>
      <li>Membaca melebihi target akan menjadi <b>tabungan</b> yang menutup target hari-hari berikutnya.</li>
      <li>Setiap hari yang terpenuhi tepat waktu mendapat <b>${S.me.pengaturan.poin_harian || 10} poin</b>, dan setiap khatam mendapat <b>${S.me.pengaturan.poin_khatam || 100} poin</b>.</li>
    </ul>
  </div>`);
}

async function viewPeringkat(kelompokId) {
  memuat();
  const data = kelompokId ? await api('/peringkat/' + kelompokId) : await api('/saya/peringkat');
  const sayaId = S.me.user.id;
  shell(`<h1>🏆 Peringkat Poin</h1>
  <p class="muted small">${S.me.kelompok ? esc(S.me.kelompok.nama) : 'Semua siswa'}</p>
  <div class="card">${data.length ? data.map((r, i) => `
    <div class="rank r${i + 1} ${r.id === sayaId ? 'saya' : ''}">
      <div class="pos">${i + 1}</div>
      <div class="nm">${esc(r.nama)}<div class="tiny muted">${r.total_dibaca} hlm · 🔥${r.streak} · ${r.khatam}× khatam ${r.hutang ? `· <span style="color:var(--merah)">hutang ${r.hutang}</span>` : ''}</div></div>
      <div class="pt">${r.poin} ⭐</div>
    </div>`).join('') : '<div class="kosong">Belum ada data</div>'}</div>`);
}

// =========================================================
//  PEMBACA MUSHAF
// =========================================================
const pref = {
  get fs() { return parseFloat(localStorage.getItem('fs') || '1.75'); },
  set fs(v) { localStorage.setItem('fs', v); },
  get terj() { return localStorage.getItem('terj') === '1'; },
  set terj(v) { localStorage.setItem('terj', v ? '1' : '0'); },
  get latin() { return localStorage.getItem('latin') === '1'; },
  set latin(v) { localStorage.setItem('latin', v ? '1' : '0'); },
  get tajwid() { return localStorage.getItem('tajwid') !== '0'; },   // default AKTIF
  set tajwid(v) { localStorage.setItem('tajwid', v ? '1' : '0'); },
  get qari() { return localStorage.getItem('qari') || 'husary'; },
  set qari(v) { localStorage.setItem('qari', v); },
  get ulang() { return parseInt(localStorage.getItem('ulang') || '1'); },
  set ulang(v) { localStorage.setItem('ulang', v); },
};

const teksArab = (t) => (pref.tajwid && window.Tajwid ? Tajwid.html(t) : esc(t));
function htmlHalaman(d) {
  let out = '', buf = '';
  const flush = () => { if (buf) { out += `<div class="ayat-wrap">${buf}</div>`; buf = ''; } };
  for (const [s, a, teks, terj, latin] of d.v) {
    if (a === 1) {
      flush();
      const m = S.meta.surah[s - 1];
      out += `<div class="surah-head"><div class="ar">${esc(m[2])}</div><div class="lt">${s}. ${esc(m[1])} · ${m[3]} ayat · ${m[5]}</div></div>`;
      if (s !== 1 && s !== 9) out += `<div class="basmalah" data-basmalah="${s}">${teksArab(S.meta.basmalah)}</div>`;
    }
    buf += `<span class="ay" data-s="${s}" data-a="${a}">${teksArab(teks)} <span class="nomor" data-s="${s}" data-a="${a}" title="Putar ayat ini">﴿${angkaArab(a)}﴾</span>`
      + `<span class="latin">${esc(latin || '')}</span><span class="terj"><b>${s}:${a}</b> ${esc(terj)}</span></span> `;
  }
  flush();
  return out;
}
const WARNA_TAJWID = ['ghunnah', 'ikhfa', 'idgham-g', 'idgham-b', 'iqlab', 'ikhfa-s', 'idgham-m', 'qalqalah', 'qalqalah-k', 'mad-wajib', 'mad-jaiz', 'mad-lazim', 'syamsiyah'];
const legendaTajwid = () => `<div class="legenda-tj">${WARNA_TAJWID.map((k) => `<button class="chip-tj" data-info="${k}"><i class="tjc-${k}"></i>${esc(Tajwid.INFO[k][0])}</button>`).join('')}</div>`;

function barPembaca(n, ekstra = '') {
  const sur = surahDiHalaman(n);
  return `<div class="reader-top"><div class="reader-bar">
    <div class="ttl">${esc(sur[1])}<span>Hlm ${n} · Juz ${juzDiHalaman(n)}</span></div>
    <div class="row" style="gap:5px;flex-wrap:nowrap">${ekstra}
      <button class="icon-btn" data-aksi="kecil" title="Perkecil huruf">A−</button>
      <button class="icon-btn" data-aksi="besar" title="Perbesar huruf">A+</button>
      <button class="icon-btn ${pref.tajwid ? 'on' : ''}" data-aksi="tajwid" title="Warna tajwid">Tj</button>
      <button class="icon-btn ${pref.latin ? 'on' : ''}" data-aksi="latin" title="Bacaan latin">Lt</button>
      <button class="icon-btn ${pref.terj ? 'on' : ''}" data-aksi="terj" title="Terjemah">Id</button>
      <button class="icon-btn" data-aksi="audio" title="Dengarkan murottal">🔊</button>
    </div></div>
    <div class="pemutar hidden" id="pemutar">
      <button class="btn kecil" id="pm-play">▶ Putar halaman</button>
      <button class="btn putih kecil hidden" id="pm-stop">⏹</button>
      <select class="input" id="pm-qari">${Object.entries(QARI).map(([k, q]) => `<option value="${k}" ${k === pref.qari ? 'selected' : ''}>${esc(q.nama)}</option>`).join('')}</select>
      <select class="input" id="pm-ulang" title="Ulangi setiap ayat">${[1, 2, 3, 5, 10].map((x) => `<option value="${x}" ${x === pref.ulang ? 'selected' : ''}>${x === 1 ? 'Tanpa ulang' : 'Ulang ' + x + '×'}</option>`).join('')}</select>
      <span class="small muted" id="pm-ket">Ketuk nomor ayat untuk memutar dari ayat tersebut.</span>
    </div></div>`;
}

// ---------- pemutar murottal ----------
const QARI = {
  husary: { nama: 'Al-Husary (tartil, untuk belajar)', ed: 'ar.husary' },
  alafasy: { nama: 'Mishary Alafasy', ed: 'ar.alafasy' },
  minshawi: { nama: 'Al-Minsyawi', ed: 'ar.minshawi' },
  kemenag: { nama: 'Murottal Kemenag RI', kemenag: true },
};
function nomorGlobal(s, a) {
  let n = 0;
  for (let i = 0; i < s - 1; i++) n += S.meta.surah[i][3];
  return n + a;
}
function urlAudio(qari, s, a) {
  const q = QARI[qari] || QARI.husary;
  const g = nomorGlobal(s, a);
  const kem = `https://quran.kemenag.go.id/cmsq/source/s01/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`;
  const cdn = (ed, br) => `https://cdn.islamic.network/quran/audio/${br}/${ed}/${g}.mp3`;
  if (q.kemenag) return [kem, cdn('ar.husary', 128), cdn('ar.alafasy', 128)];
  return [cdn(q.ed, 128), cdn(q.ed, 64), cdn(q.ed, 192), cdn('ar.alafasy', 128), kem];
}
const Pemutar = {
  audio: null, antrian: [], idx: 0, ulangKe: 0, root: null, aktif: false,
  siapkan(root, d) {
    this.berhenti();
    this.root = root;
    this.antrian = [];
    for (const [s, a] of d.v) {
      if (a === 1 && s !== 1 && s !== 9 && !QARI[pref.qari]?.kemenag) this.antrian.push({ s: 1, a: 1, basmalah: s });
      this.antrian.push({ s, a });
    }
  },
  mulai(dariS, dariA) {
    if (!this.antrian.length) return;
    let i = 0;
    if (dariS) { i = this.antrian.findIndex((x) => x.s === dariS && x.a === dariA && !x.basmalah); if (i < 0) i = 0; }
    this.idx = i; this.ulangKe = 0; this.aktif = true;
    this.putar();
  },
  putar(cobaKe = 0) {
    const it = this.antrian[this.idx];
    if (!it) return this.selesai();
    const urls = urlAudio(pref.qari, it.s, it.a);
    if (cobaKe >= urls.length) { toast('Audio tidak dapat diputar. Periksa koneksi internet.', true); return this.berhenti(); }
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.audio.onended = () => this.lanjut();
    }
    this.audio.onerror = () => this.putar(cobaKe + 1);
    this.audio.src = urls[cobaKe];
    this.audio.play().catch((e) => { if (e.name !== 'AbortError') this.putar(cobaKe + 1); });
    this.sorot(it);
    this.ui();
  },
  lanjut() {
    const it = this.antrian[this.idx];
    if (it && !it.basmalah && this.ulangKe + 1 < pref.ulang) { this.ulangKe++; return this.putar(); }
    this.ulangKe = 0; this.idx++;
    if (this.idx >= this.antrian.length) return this.selesai();
    this.putar();
  },
  selesai() { this.berhenti(); toast('Murottal halaman ini selesai ✓'); },
  jeda() { if (!this.audio) return; if (this.audio.paused) this.audio.play(); else this.audio.pause(); this.ui(); },
  berhenti() {
    this.aktif = false;
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); try { this.audio.load(); } catch {} }
    if (this.root) $$('.diputar', this.root).forEach((e) => e.classList.remove('diputar'));
    this.ui();
  },
  sorot(it) {
    if (!this.root) return;
    $$('.diputar', this.root).forEach((e) => e.classList.remove('diputar'));
    const el = it.basmalah ? $(`[data-basmalah="${it.basmalah}"]`, this.root) : $(`.ay[data-s="${it.s}"][data-a="${it.a}"]`, this.root);
    if (el) { el.classList.add('diputar'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  },
  ui() {
    const p = $('#pm-play'), st = $('#pm-stop'), ket = $('#pm-ket');
    if (!p) return;
    const it = this.antrian[this.idx];
    if (this.aktif && this.audio) {
      p.textContent = this.audio.paused ? '▶ Lanjut' : '⏸ Jeda';
      st.classList.remove('hidden');
      ket.textContent = it ? (it.basmalah ? 'Basmalah' : `Ayat ${it.s}:${it.a}`) + (pref.ulang > 1 && !it.basmalah ? ` · ulang ${this.ulangKe + 1}/${pref.ulang}` : '') : '';
    } else {
      p.textContent = '▶ Putar halaman'; st.classList.add('hidden');
      ket.textContent = 'Ketuk nomor ayat untuk memutar dari ayat tersebut.';
    }
  },
};
window.addEventListener('hashchange', () => Pemutar.berhenti());

function infoTajwid(k) {
  const [nama, ket] = Tajwid.INFO[k] || [k, ''];
  modal(`<div class="row" style="gap:10px;align-items:center"><i class="tjc-${k}" style="width:18px;height:18px;border-radius:5px;display:inline-block"></i><h2 style="margin:0">${esc(nama)}</h2></div>
    <p>${esc(ket).replace(/([\u0600-\u06FF][\u0600-\u06FF\s]*[\u0600-\u06FF]|[\u0600-\u06FF])/g, '<bdi dir="rtl" class="ar-inline">$1</bdi>')}</p><h3 style="margin-top:16px">Keterangan warna tajwid</h3>${legendaTajwid()}
    <p class="tiny muted">Warna tajwid dibuat otomatis berdasarkan kaidah dan penandaan mushaf Kemenag. Tetap belajar langsung kepada guru (talaqqi).</p>
    <button class="btn" data-tutup>Tutup</button>`, (m) => $$('[data-info]', m).forEach((b) => (b.onclick = () => infoTajwid(b.dataset.info))));
}

function pasangBarPembaca(root, d) {
  const mushaf = $('.mushaf', root);
  const isi = $('.isi-hlm', root);
  const render = () => { isi.innerHTML = htmlHalaman(d); Pemutar.root = root; };
  const terapkan = () => {
    mushaf.style.setProperty('--fs', pref.fs + 'rem');
    mushaf.classList.toggle('mode-terjemah', pref.terj);
    mushaf.classList.toggle('mode-latin', pref.latin);
    $('.legenda-wrap', root).innerHTML = pref.tajwid ? `<div class="small muted" style="margin:6px 0">Ketuk huruf berwarna untuk melihat hukum tajwidnya.</div>${legendaTajwid()}` : '';
  };
  render(); terapkan();
  Pemutar.siapkan(root, d);
  $$('[data-aksi]', root).forEach((b) => (b.onclick = () => {
    const a = b.dataset.aksi;
    if (a === 'kecil') pref.fs = Math.max(1.2, pref.fs - 0.15);
    if (a === 'besar') pref.fs = Math.min(3, pref.fs + 0.15);
    if (a === 'terj') { pref.terj = !pref.terj; b.classList.toggle('on', pref.terj); }
    if (a === 'latin') { pref.latin = !pref.latin; b.classList.toggle('on', pref.latin); }
    if (a === 'tajwid') { pref.tajwid = !pref.tajwid; b.classList.toggle('on', pref.tajwid); render(); if (Pemutar.aktif) Pemutar.sorot(Pemutar.antrian[Pemutar.idx]); }
    if (a === 'audio') { $('#pemutar', root).classList.toggle('hidden'); b.classList.toggle('on'); }
    terapkan();
  }));
  root.addEventListener('click', (e) => {
    const no = e.target.closest('.nomor');
    if (no) { $('#pemutar', root).classList.remove('hidden'); $('[data-aksi="audio"]', root).classList.add('on'); Pemutar.mulai(+no.dataset.s, +no.dataset.a); return; }
    const tj = e.target.closest('[data-tj],[data-info]');
    if (tj) infoTajwid(tj.dataset.tj || tj.dataset.info);
  });
  $('#pm-play', root).onclick = () => (Pemutar.aktif ? Pemutar.jeda() : Pemutar.mulai());
  $('#pm-stop', root).onclick = () => Pemutar.berhenti();
  $('#pm-qari', root).onchange = (e) => { pref.qari = e.target.value; const was = Pemutar.aktif; const it = Pemutar.antrian[Pemutar.idx]; Pemutar.siapkan(root, d); if (was && it) Pemutar.mulai(it.s, it.a); };
  $('#pm-ulang', root).onchange = (e) => { pref.ulang = parseInt(e.target.value); Pemutar.ui(); };
}

// ---- mode TADARUS (siswa, berurutan sesuai jadwal) ----
let timerBaca = null;
async function viewBaca() {
  memuat();
  await muatMeta();
  const st = await muatStatus(1);
  await renderBaca(st);
}
async function renderBaca(st) {
  clearInterval(timerBaca);
  const n = st.halaman_berikut;
  const d = await muatHalaman(n);
  muatHalaman(n >= TOTAL ? 1 : n + 1).catch(() => {}); // pramuat halaman berikutnya
  const kewajiban = st.dibaca_hari_ini + st.sisa_hari_ini;
  const pct = st.selesai_hari_ini ? 100 : Math.round((st.dibaca_hari_ini / Math.max(1, kewajiban)) * 100);
  const main = shell(`
    ${barPembaca(n)}
    <article class="mushaf"><div class="isi-hlm"></div><div class="hlm-no">— ${angkaArab(n)} —</div><div class="legenda-wrap"></div></article>
    <div class="aksi-baca"><div class="panel">
      <div class="ket">
        <b>${st.selesai_hari_ini ? (st.spare ? `Tabungan ${st.spare} halaman 💰` : 'Target hari ini tuntas ✓') : `Sisa wajib hari ini: ${st.sisa_hari_ini} hlm`}</b>
        <span class="muted">Dibaca hari ini ${st.dibaca_hari_ini} hlm${st.hutang ? ` · hutang ${st.hutang}` : ''}</span>
        <div class="progress" style="margin-top:6px"><i style="width:${pct}%"></i></div>
      </div>
      <button class="btn besar" id="btn-selesai" disabled>✓ Selesai</button>
    </div></div>
    <div class="row" style="justify-content:center;margin-top:4px">
      ${st.dibaca_hari_ini ? '<button class="btn putih kecil" id="btn-batal">↩ Batalkan tanda terakhir</button>' : ''}
      <a class="btn putih kecil" href="#/mushaf/${n}">Buka mode mushaf bebas</a>
      ${S.me.pengaturan.izin_cetak !== '0' ? `<button class="btn putih kecil" onclick="laporCetak('tadarus')">📗 Lapor mushaf cetak</button>` : ''}
    </div>`);
  main.style.paddingTop = '0';
  pasangBarPembaca(main, d);

  // hitung mundur minimal waktu baca per halaman
  const btn = $('#btn-selesai');
  const minDetik = st.min_detik ?? 30;
  let sisa = minDetik;
  if (st.terakhir_baca) {
    const lalu = (Date.now() - new Date(st.terakhir_baca.replace(' ', 'T') + 'Z').getTime()) / 1000;
    sisa = Math.max(0, Math.min(minDetik, Math.ceil(minDetik - lalu)));
    if (!S._halamanTerbuka || S._halamanTerbuka.n !== n) sisa = Math.max(sisa, Math.min(minDetik, 10));
  }
  S._halamanTerbuka = { n, t: Date.now() };
  const tick = () => {
    if (sisa <= 0) { btn.disabled = false; btn.textContent = `✓ Selesai hlm ${n}`; clearInterval(timerBaca); return; }
    btn.textContent = `⏳ ${sisa} dtk`; sisa--;
  };
  tick(); timerBaca = setInterval(tick, 1000);

  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Menyimpan…';
    try {
      const r = await api('/saya/baca', { method: 'POST', body: { halaman: n } });
      const baruTuntas = !st.selesai_hari_ini && r.selesai_hari_ini;
      r.min_detik = st.min_detik; r.terakhir_baca = new Date().toISOString().slice(0, 19).replace('T', ' ');
      S.status = r;
      if (r.khatam_baru) selebrasiKhatam(r);
      else if (baruTuntas) selebrasiTuntas(r);
      else toast(`Halaman ${n} tercatat ✓`);
      await renderBaca(r);
    } catch (e) {
      toast(e.message, true);
      const m = e.message.match(/Tunggu (\d+) detik/);
      sisa = m ? parseInt(m[1]) : 0; clearInterval(timerBaca); tick(); timerBaca = setInterval(tick, 1000);
    }
  };
  const bb = $('#btn-batal');
  if (bb) bb.onclick = async () => {
    if (!confirm('Batalkan tanda halaman terakhir?')) return;
    await coba(() => api('/saya/batal', { method: 'POST' }), 'Tanda terakhir dibatalkan');
    viewBaca();
  };
}
function selebrasiTuntas(r) {
  modal(`<div class="selebrasi"><div class="emo">🌟</div><h2>Alhamdulillah, target hari ini tuntas!</h2>
    <p>+${S.me.pengaturan.poin_harian || 10} poin · total <b>${r.poin}</b> poin</p>
    <p class="muted small">Kamu boleh melanjutkan membaca. Halaman tambahan akan menjadi tabungan untuk hari berikutnya.</p>
    <div class="row" style="justify-content:center"><button class="btn" data-tutup>Lanjut membaca</button><a class="btn sec" href="#/" data-tutup>Ke beranda</a></div></div>`);
}
function selebrasiKhatam(r) {
  modal(`<div class="selebrasi"><div class="emo">🎉📖🎉</div><h2>Masya Allah, KHATAM ke-${r.khatam}!</h2>
    <p>Selamat telah menyelesaikan 30 juz. +${S.me.pengaturan.poin_khatam || 100} poin bonus.</p>
    <p style="font-family:'Quran','QuranCadangan',serif;font-size:1.25rem;color:var(--hijau-tua)">اَللّٰهُمَّ ارْحَمْنِيْ بِالْقُرْاٰنِ</p>
    <p class="muted small">Bacaan berikutnya dimulai kembali dari Al-Fatihah.</p>
    <button class="btn" data-tutup>Aamiin</button></div>`);
}

// ---- mode MUSHAF bebas ----
async function viewMushafIndeks() {
  memuat();
  await muatMeta();
  const tab = sessionStorage.getItem('tab_mushaf') || 'surah';
  const main = shell(`
    <div class="row spread"><h1 style="margin:0">Al-Qur'an</h1>
      <form id="f-hlm" class="row" style="gap:6px"><input class="input" name="p" type="number" min="1" max="604" placeholder="Hlm" style="width:90px"><button class="btn kecil">Buka</button></form></div>
    ${S.me.user.peran === 'siswa' && S.status ? `<a class="card flat row spread" href="#/baca" style="margin-top:12px;color:inherit"><div><b>Lanjut tadarus</b><div class="small muted">Halaman ${S.status.halaman_berikut} · ${esc(surahDiHalaman(S.status.halaman_berikut)[1])}</div></div><span class="btn kecil">Baca</span></a>` : ''}
    <div class="tabs" style="margin-top:12px"><button data-t="surah" class="${tab === 'surah' ? 'aktif' : ''}">Surah</button><button data-t="juz" class="${tab === 'juz' ? 'aktif' : ''}">Juz</button></div>
    <input class="input" id="cari-surah" placeholder="Cari nama surah…" style="margin-bottom:12px">
    <div id="isi-mushaf"></div>`);
  const isi = $('#isi-mushaf');
  const render = (t, q = '') => {
    $('#cari-surah').classList.toggle('hidden', t !== 'surah');
    if (t === 'surah') {
      const ql = q.toLowerCase().replace(/[^a-z0-9]/g, '');
      isi.innerHTML = '<div class="daftar-surah">' + S.meta.surah.filter((s) => !ql || s[1].toLowerCase().replace(/[^a-z0-9]/g, '').includes(ql) || String(s[0]) === q).map((s) => `
        <a class="item-surah" href="#/mushaf/${s[4]}"><div class="no"><span>${s[0]}</span></div>
        <div class="nm"><b>${esc(s[1])}</b><span class="tiny muted">${s[5]} · ${s[3]} ayat · hlm ${s[4]}</span></div><div class="ar">${esc(s[2].replace('سُوْرَةُ ', ''))}</div></a>`).join('') + '</div>';
    } else {
      isi.innerHTML = '<div class="daftar-surah">' + S.meta.juz.map(([j, p]) => `
        <a class="item-surah" href="#/mushaf/${p}"><div class="no"><span>${j}</span></div>
        <div class="nm"><b>Juz ${j}</b><span class="tiny muted">mulai hlm ${p} · ${esc(surahDiHalaman(p)[1])}</span></div></a>`).join('') + '</div>';
    }
  };
  render(tab);
  $$('.tabs button', main).forEach((b) => (b.onclick = () => { sessionStorage.setItem('tab_mushaf', b.dataset.t); $$('.tabs button').forEach((x) => x.classList.toggle('aktif', x === b)); render(b.dataset.t, $('#cari-surah').value); }));
  $('#cari-surah').oninput = (e) => render('surah', e.target.value.trim());
  $('#f-hlm').onsubmit = (e) => { e.preventDefault(); const p = parseInt(e.target.p.value); if (p >= 1 && p <= 604) location.hash = '#/mushaf/' + p; };
}

async function viewMushafHalaman(n) {
  n = Math.max(1, Math.min(TOTAL, n));
  memuat();
  await muatMeta();
  const d = await muatHalaman(n);
  const nav = `<div class="row" style="justify-content:space-between;max-width:760px;margin:0 auto">
      <a class="btn putih kecil" href="#/mushaf/${Math.min(TOTAL, n + 1)}" ${n >= TOTAL ? 'style="visibility:hidden"' : ''}>‹ Hlm ${n + 1}</a>
      <a class="btn sec kecil" href="#/mushaf">Daftar surah</a>
      <a class="btn putih kecil" href="#/mushaf/${Math.max(1, n - 1)}" ${n <= 1 ? 'style="visibility:hidden"' : ''}>Hlm ${n - 1} ›</a></div>`;
  const main = shell(`${barPembaca(n)}
    <div style="height:10px"></div>${nav}
    <article class="mushaf"><div class="isi-hlm"></div><div class="hlm-no">— ${angkaArab(n)} —</div><div class="legenda-wrap"></div></article>
    ${nav}
    ${S.me.user.peran === 'siswa' ? '<p class="small muted" style="text-align:center">Mode mushaf bebas tidak dihitung sebagai tadarus. Gunakan menu <a href="#/baca">Tadarus</a> untuk mencatat bacaan.</p>' : ''}`);
  main.style.paddingTop = '0';
  pasangBarPembaca(main, d);
  muatHalaman(Math.min(TOTAL, n + 1)).catch(() => {});
  // geser (swipe): ke kiri = halaman berikutnya (arah mushaf)
  let x0 = null;
  const art = $('.mushaf', main);
  art.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  art.addEventListener('touchend', (e) => {
    if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 80) location.hash = '#/mushaf/' + (dx > 0 ? Math.min(TOTAL, n + 1) : Math.max(1, n - 1));
  });
}

// =========================================================
//  AKUN
// =========================================================
function viewAkun() {
  const u = S.me.user;
  const wajibGanti = u.wajib_ganti_pw;
  const notifOk = 'Notification' in window && Notification.permission === 'granted';
  shell(`
  <h1>Akun Saya</h1>
  ${wajibGanti ? '<div class="alert peringatan">🔐 Demi keamanan, silakan ganti password bawaan Anda terlebih dahulu.</div>' : ''}
  <div class="card">
    <div class="row"><div style="width:54px;height:54px;border-radius:16px;background:var(--hijau-muda);display:grid;place-items:center;font-size:1.6rem">👤</div>
    <div><b style="font-size:1.1rem">${esc(u.nama)}</b><div class="small muted">@${esc(u.username)} · ${u.peran}${S.me.kelompok ? ' · ' + esc(S.me.kelompok.nama) : ''}${S.me.kelompok?.guru_nama ? ' · Guru: ' + esc(S.me.kelompok.guru_nama) : ''}</div></div></div>
  </div>
  <div class="card"><h3>Ganti Password</h3>
    <form id="f-pw">
      <div class="field"><label>Password lama</label><input class="input" type="password" name="lama" required></div>
      <div class="field"><label>Password baru (min. 6 karakter)</label><input class="input" type="password" name="baru" minlength="6" required></div>
      <div class="field"><label>Ulangi password baru</label><input class="input" type="password" name="ulang" minlength="6" required></div>
      <button class="btn">Simpan Password</button>
    </form></div>
  ${u.peran === 'siswa' ? `<div class="card"><h3>👥 Gabung Kelompok</h3>
    <p class="small muted" style="margin-top:-4px">${S.me.kelompok ? `Kelompok saat ini: <b>${esc(S.me.kelompok.nama)}</b>. Memasukkan kode lain akan memindahkanmu ke kelompok tersebut.` : 'Kamu belum masuk kelompok. Minta kode gabung kepada gurumu.'}</p>
    <form id="f-gabung" class="row"><input class="input" name="kode" placeholder="Contoh: BAITIJ-7K2Q" style="flex:1;min-width:170px;text-transform:uppercase" required><button class="btn">Gabung</button></form></div>` : ''}
  ${u.peran === 'siswa' ? `<div class="card row spread"><div><b>🔔 Pengingat harian</b><div class="small muted">${notifOk ? 'Aktif di perangkat ini.' : 'Belum aktif di perangkat ini.'}</div></div>
    ${notifOk ? '<button class="btn sec kecil" id="tes-notif">Tes notifikasi</button>' : '<button class="btn kecil" onclick="aktifkanNotif()">Aktifkan</button>'}</div>
    <div class="card small muted">💡 Tips: pasang aplikasi ini di layar utama HP (menu browser → <i>Tambahkan ke layar utama / Install app</i>) agar pengingat lebih andal dan mushaf bisa dibaca offline.</div>` : ''}
  <button class="btn merah blok" id="btn-keluar">Keluar</button>
  `);
  $('#f-pw').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.baru !== f.ulang) return toast('Ulangi password tidak sama', true);
    await coba(() => api('/password', { method: 'POST', body: f }), 'Password berhasil diganti');
    S.me.user.wajib_ganti_pw = 0; location.hash = '#/';
  };
  $('#btn-keluar').onclick = () => keluar();
  const fg = $('#f-gabung');
  if (fg) fg.onsubmit = (e) => { e.preventDefault(); location.hash = '#/gabung/' + encodeURIComponent(e.target.kode.value.trim().toUpperCase()); };
  const tn = $('#tes-notif');
  if (tn) tn.onclick = async () => {
    const reg = await navigator.serviceWorker?.ready;
    const opt = { body: 'Notifikasi tadarus berfungsi dengan baik ✓', icon: '/icons/icon-192.png' };
    reg ? reg.showNotification('Tadarus', opt) : new Notification('Tadarus', opt);
  };
}

// =========================================================
//  GURU
// =========================================================
async function viewDaftarKelompok() {
  memuat();
  const [data, st] = await Promise.all([api('/kelompok'), api('/saya/status?riwayat=1').catch(() => null)]);
  if (st) notifHarian(st);
  const kartu = st && (st.terjadwal_hari_ini || st.hutang || st.total_dibaca) ? `
    <a class="card row spread" href="#/saya" style="color:inherit;border-left:5px solid ${st.selesai_hari_ini ? 'var(--hijau)' : st.hutang ? 'var(--merah)' : 'var(--emas)'}">
      <div><b>📖 Tadarus saya hari ini</b><div class="small muted">${st.selesai_hari_ini ? `Tuntas ✓ · dibaca ${st.dibaca_hari_ini} halaman` : `Wajib ${st.sisa_hari_ini} halaman lagi${st.hutang ? ` (termasuk hutang ${st.hutang})` : ''}`} · ⭐ ${st.poin} poin</div></div>
      <span class="btn kecil ${st.selesai_hari_ini ? 'sec' : 'emas'}">${st.selesai_hari_ini ? 'Lihat' : 'Baca'}</span></a>` : '';
  shell(`${kartu}<div class="row spread"><h1 style="margin:0">Kelompok Tadarus</h1><button class="btn" onclick="formKelompokBaru()">+ Buat Kelompok</button></div>
  <p class="small muted">Buat kelompok/halaqah sendiri lalu bagikan <b>kode gabung</b> kepada murid. Murid memasukkan kode di menu Akun.</p>
  ${data.length ? `<div class="grid g3" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${data.map((k) => `
    <a class="card kelompok-card" href="#/k/${k.id}">
      <div class="row spread"><b style="font-size:1.05rem">${esc(k.nama)}</b><span class="badge hijau">${k.jumlah_siswa} siswa</span></div>
      <div class="small muted" style="margin-top:6px">🎯 ${k.target ?? 0} halaman/hari · 👤 ${esc(k.guru_nama || 'Belum ada guru')}</div>
      <div class="kode-mini">🔑 ${esc(k.kode || '-')}${k.kode_aktif === 0 ? ' <span class="badge">nonaktif</span>' : ''}</div>
    </a>`).join('')}</div>` : '<div class="card kosong">Belum ada kelompok. Klik <b>+ Buat Kelompok</b> untuk membuat kelompok dan mendapatkan kode gabung.</div>'}`);
}

function formKelompokBaru() {
  const p = S.me.pengaturan;
  modal(`<h2>Buat Kelompok Baru</h2><form id="f-kb">
    <div class="field"><label>Nama kelompok</label><input class="input" name="nama" placeholder="mis. Baiti Jannaty" required></div>
    <div class="grid g2"><div class="field"><label>Target halaman/hari</label><input class="input" type="number" name="halaman_per_hari" min="0" max="604" value="${p.default_halaman_per_hari || 2}"></div>
    <div class="field"><label>Mulai program</label><input class="input" type="date" name="tgl_mulai" value="${hariIni()}"></div></div>
    <div class="field"><label>Hari wajib tadarus</label><div class="chip-hari">${HARI.map((h, i) => `<label><input type="checkbox" name="h" value="${i}" checked> ${h.slice(0, 3)}</label>`).join('')}</div></div>
    <div class="row"><button class="btn">Buat & dapatkan kode</button><button type="button" class="btn sec" data-tutup>Batal</button></div></form>`, (m) => {
    $('#f-kb', m).onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = { nama: fd.get('nama'), halaman_per_hari: fd.get('halaman_per_hari'), tgl_mulai: fd.get('tgl_mulai'), hari_aktif: fd.getAll('h').join('') };
      const r = await coba(() => api('/kelompok', { method: 'POST', body }), 'Kelompok dibuat');
      tutupModal();
      location.hash = `#/k/${r.id}/anggota`;
    };
  });
}
window.formKelompokBaru = formKelompokBaru;

function tautanGabung(kode) { return `${location.origin}/#/gabung/${encodeURIComponent(kode)}`; }
function bagikanKode(k) {
  const teks = `Assalamu'alaikum. Ayo bergabung di kelompok tadarus *${k.nama}*.\n\n1. Buka ${location.origin}\n2. Login dengan akun masing-masing\n3. Masuk menu Akun → Gabung Kelompok, masukkan kode: *${k.kode}*\n\nAtau langsung klik: ${tautanGabung(k.kode)}`;
  return teks;
}

const STATUS_BADGE = (s) => s.selesai_hari_ini
  ? (s.terjadwal_hari_ini || s.dibaca_hari_ini ? '<span class="badge hijau">Tuntas</span>' : '<span class="badge biru">Libur</span>')
  : s.dibaca_hari_ini ? '<span class="badge emas">Sebagian</span>' : '<span class="badge merah">Belum</span>';

async function viewKelompok(id, tab = 'rekap') {
  memuat();
  await muatMeta();
  const d = await api(`/kelompok/${id}/rekap`);
  const k = d.kelompok;
  const sis = d.siswa;
  const selesai = sis.filter((s) => s.selesai_hari_ini).length;
  const berhutang = sis.filter((s) => s.hutang > 0).length;
  const targetNow = d.jadwal.find((j) => j.kelompok_id && !j.siswa_id && j.mulai <= d.hari_ini);
  const main = shell(`
  <div class="row spread"><div><a class="small" href="#/${S.me.user.peran === 'admin' ? 'kelompok' : ''}">← Kembali</a><h1 style="margin:4px 0 0">${esc(k.nama)}</h1>
  <div class="small muted">Guru: ${esc(k.guru_nama || '-')} · 🎯 ${targetNow?.halaman_per_hari ?? 0} hlm/hari · ${tglIndo(d.hari_ini)}</div></div></div>
  <div class="grid g4" style="margin:14px 0">
    <div class="stat"><div class="n">${sis.length}</div><div class="l">Siswa</div></div>
    <div class="stat hijau"><div class="n">${selesai}</div><div class="l">Tuntas hari ini</div></div>
    <div class="stat emas"><div class="n">${sis.length - selesai}</div><div class="l">Belum tuntas</div></div>
    <div class="stat merah"><div class="n">${berhutang}</div><div class="l">Punya hutang</div></div>
  </div>
  <div class="tabs">${[['rekap', 'Rekap'], ['anggota', 'Anggota & Kode'], ['target', 'Target'], ['hari', 'Hari & Libur'], ['umum', 'Pengumuman'], ['rank', 'Peringkat']].map(([t, l]) => `<button data-t="${t}" class="${tab === t ? 'aktif' : ''}">${l}</button>`).join('')}</div>
  <div id="isi-tab"></div>`);
  $$('.tabs button', main).forEach((b) => (b.onclick = () => { $$('.tabs button').forEach((x) => x.classList.toggle('aktif', x === b)); renderTab(b.dataset.t); }));

  const renderTab = async (t) => {
    const el = $('#isi-tab');
    if (t === 'rekap') {
      el.innerHTML = `<div class="card">
        <div class="row spread no-print" style="margin-bottom:10px">
          <div class="row" style="gap:6px"><select class="input" id="flt" style="width:auto"><option value="">Semua siswa</option><option value="belum">Belum tuntas</option><option value="hutang">Punya hutang</option><option value="tuntas">Sudah tuntas</option></select>
          <input class="input" id="q" placeholder="Cari nama…" style="width:160px"></div>
          <div class="row" style="gap:6px"><button class="btn sec kecil" id="csv">⬇ Unduh CSV</button><button class="btn sec kecil" onclick="print()">🖨 Cetak</button></div></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Nama</th><th>Hari ini</th><th>Hutang</th><th>Tabungan</th><th>Poin</th><th>Posisi</th><th>Khatam</th><th>7 hari</th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
      const isiTabel = () => {
        const f = $('#flt').value, q = $('#q').value.toLowerCase();
        const rows = sis.filter((s) => (!q || s.nama.toLowerCase().includes(q)) && (!f || (f === 'belum' && !s.selesai_hari_ini) || (f === 'hutang' && s.hutang > 0) || (f === 'tuntas' && s.selesai_hari_ini)));
        $('#tb').innerHTML = rows.length ? rows.map((s, i) => `<tr style="cursor:pointer" onclick="location.hash='#/s/${s.id}'">
          <td>${i + 1}</td><td><b>${esc(s.nama)}</b>${s.aktif ? '' : ' <span class="badge">nonaktif</span>'}<div class="tiny muted">${esc(s.nis || s.username)}</div></td>
          <td>${STATUS_BADGE(s)}<div class="tiny muted">${s.dibaca_hari_ini}/${s.dibaca_hari_ini + s.sisa_hari_ini} hlm</div></td>
          <td>${s.hutang ? `<b style="color:var(--merah)">${s.hutang}</b>` : '0'}</td>
          <td>${s.spare ? `<b style="color:var(--kuning)">${s.spare}</b>` : '0'}</td>
          <td><b>${s.poin}</b></td>
          <td class="small">hlm ${s.halaman_berikut}<div class="tiny muted">${esc(surahDiHalaman(s.halaman_berikut)[1])}</div></td>
          <td>${s.khatam}</td>
          <td><div class="titik">${(s.riwayat || []).map((r) => `<i class="${r.status}" title="${r.t}: ${r.dibaca} hlm"></i>`).join('')}</div></td></tr>`).join('')
          : '<tr><td colspan="9" class="kosong">Tidak ada siswa</td></tr>';
      };
      isiTabel();
      $('#flt').onchange = isiTabel; $('#q').oninput = isiTabel;
      $('#csv').onclick = () => unduhCSV(`rekap-${k.nama}-${d.hari_ini}.csv`, [
        ['No', 'Nama', 'NIS', 'Username', 'Dibaca hari ini', 'Sisa wajib hari ini', 'Hutang', 'Tabungan', 'Poin', 'Hari tepat', 'Hari terjadwal', 'Halaman berikut', 'Khatam', 'Total dibaca'],
        ...sis.map((s, i) => [i + 1, s.nama, s.nis || '', s.username, s.dibaca_hari_ini, s.sisa_hari_ini, s.hutang, s.spare, s.poin, s.hari_tepat, s.hari_terjadwal, s.halaman_berikut, s.khatam, s.total_dibaca]),
      ]);
    }
    if (t === 'target') {
      el.innerHTML = `<div class="card"><h3>Tetapkan target baru</h3>
        <p class="small muted">Target berlaku mulai tanggal yang dipilih. Riwayat target lama tetap dipakai untuk menghitung hari-hari sebelumnya, sehingga hutang/tabungan siswa tetap adil.</p>
        <form id="f-target" class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
          <div class="field"><label>Berlaku untuk</label><select class="input" name="untuk"><option value="">Seluruh kelompok</option>${sis.map((s) => `<option value="${s.id}">${esc(s.nama)} (khusus)</option>`).join('')}</select></div>
          <div class="field"><label>Halaman per hari</label><input class="input" type="number" name="halaman_per_hari" min="0" max="604" value="${targetNow?.halaman_per_hari ?? 2}" required></div>
          <div class="field"><label>Berlaku mulai</label><input class="input" type="date" name="mulai" value="${d.hari_ini}" required></div>
          <div class="field" style="align-self:end"><button class="btn blok">Simpan target</button></div>
        </form>
        <p class="tiny muted">Contoh: 1 juz ≈ 20 halaman. Target 20 hlm/hari = khatam ±30 hari; 4 hlm/hari ≈ 5 bulan; 2 hlm/hari ≈ 10 bulan. Isi 0 untuk membebaskan sementara.</p></div>
        <div class="card"><h3>Riwayat target</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Berlaku mulai</th><th>Untuk</th><th>Hlm/hari</th><th></th></tr></thead><tbody>
        ${d.jadwal.map((j) => `<tr><td>${tglIndo(j.mulai)}</td><td>${j.siswa_id ? `<span class="badge emas">${esc(j.siswa_nama)}</span>` : 'Kelompok'}</td><td><b>${j.halaman_per_hari}</b></td>
        <td><button class="btn putih kecil" data-hapus-jadwal="${j.id}">Hapus</button></td></tr>`).join('')}</tbody></table></div></div>`;
      $('#f-target').onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        await coba(() => api('/jadwal', { method: 'POST', body: { halaman_per_hari: f.halaman_per_hari, mulai: f.mulai, ...(f.untuk ? { siswa_id: f.untuk } : { kelompok_id: id }) } }), 'Target disimpan');
        viewKelompok(id, 'target');
      };
      $$('[data-hapus-jadwal]', el).forEach((b) => (b.onclick = async () => {
        if (!confirm('Hapus target ini? Perhitungan hutang/poin akan dihitung ulang.')) return;
        await coba(() => api('/jadwal/' + b.dataset.hapusJadwal, { method: 'DELETE' }), 'Target dihapus');
        viewKelompok(id, 'target');
      }));
    }
    if (t === 'hari') {
      const ha = k.hari_aktif ?? '0123456';
      el.innerHTML = `<div class="card"><h3>Hari tadarus & aturan</h3><form id="f-hari">
        <div class="field"><label>Hari wajib tadarus</label><div class="chip-hari">${HARI.map((h, i) => `<label><input type="checkbox" name="h" value="${i}" ${ha.includes(String(i)) ? 'checked' : ''}> ${h}</label>`).join('')}</div></div>
        <div class="grid g2"><div class="field"><label>Jeda minimal per halaman (detik)</label><input class="input" type="number" min="0" max="600" name="min_detik" value="${k.min_detik ?? 30}"><div class="tiny muted">Mencegah siswa asal menekan tombol tanpa membaca.</div></div>
        <div class="field"><label>Tanggal mulai program (default siswa baru)</label><input class="input" type="date" name="tgl_mulai" value="${k.tgl_mulai || ''}"></div></div>
        <button class="btn">Simpan</button></form></div>
        <div class="card"><h3>Hari libur kelompok</h3><p class="small muted">Pada hari libur target tidak dihitung (tidak menambah hutang). Untuk siswa yang berhalangan pribadi, biarkan tetap terhitung hutang agar wajib diganti.</p>
        <form id="f-libur" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
          <div class="field"><label>Dari tanggal</label><input class="input" type="date" name="tanggal" required></div>
          <div class="field"><label>Sampai (opsional)</label><input class="input" type="date" name="sampai"></div>
          <div class="field"><label>Keterangan</label><input class="input" name="keterangan" placeholder="mis. Ujian / Libur semester"></div>
          <div class="field" style="align-self:end"><button class="btn blok">Tambah libur</button></div></form>
        <div class="tbl-wrap"><table class="tbl"><tbody>${d.libur.map((l) => `<tr><td>${tglIndo(l.tanggal)}</td><td>${esc(l.keterangan || '')}</td><td>${l.kelompok_id ? '' : '<span class="badge biru">Semua kelompok</span>'}</td>
        <td>${l.kelompok_id || S.me.user.peran === 'admin' ? `<button class="btn putih kecil" data-hapus-libur="${l.id}">Hapus</button>` : ''}</td></tr>`).join('') || '<tr><td class="kosong">Belum ada hari libur</td></tr>'}</tbody></table></div></div>`;
      $('#f-hari').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        await coba(() => api('/kelompok/' + id, { method: 'PUT', body: { hari_aktif: fd.getAll('h').join(''), min_detik: fd.get('min_detik'), tgl_mulai: fd.get('tgl_mulai') || null } }), 'Pengaturan disimpan');
        viewKelompok(id, 'hari');
      };
      $('#f-libur').onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        await coba(() => api('/libur', { method: 'POST', body: { ...f, kelompok_id: id } }), 'Hari libur ditambahkan');
        viewKelompok(id, 'hari');
      };
      $$('[data-hapus-libur]', el).forEach((b) => (b.onclick = async () => { await coba(() => api('/libur/' + b.dataset.hapusLibur, { method: 'DELETE' }), 'Dihapus'); viewKelompok(id, 'hari'); }));
    }
    if (t === 'umum') {
      el.innerHTML = `<div class="card"><h3>Kirim pengumuman / pesan</h3><form id="f-umum">
        <div class="field"><input class="input" name="judul" placeholder="Judul (opsional)"></div>
        <div class="field"><textarea class="input" name="isi" rows="3" placeholder="Isi pesan untuk siswa kelompok ini…" required></textarea></div>
        <button class="btn">Kirim</button></form></div>
        <div class="card">${d.pengumuman.map((p) => `<div style="padding:10px 0;border-bottom:1px solid #f0ede4" class="row spread"><div>${p.judul ? `<b>${esc(p.judul)}</b><br>` : ''}<span style="white-space:pre-line">${esc(p.isi)}</span><div class="tiny muted">${waktuWIB(p.dibuat)}</div></div>
        <button class="btn putih kecil" data-hapus-umum="${p.id}">Hapus</button></div>`).join('') || '<div class="kosong">Belum ada pengumuman</div>'}</div>`;
      $('#f-umum').onsubmit = async (e) => {
        e.preventDefault();
        await coba(() => api('/pengumuman', { method: 'POST', body: { ...Object.fromEntries(new FormData(e.target)), kelompok_id: id } }), 'Pengumuman terkirim');
        viewKelompok(id, 'umum');
      };
      $$('[data-hapus-umum]', el).forEach((b) => (b.onclick = async () => { await coba(() => api('/pengumuman/' + b.dataset.hapusUmum, { method: 'DELETE' }), 'Dihapus'); viewKelompok(id, 'umum'); }));
    }
    if (t === 'anggota') {
      const kode = k.kode || '-';
      el.innerHTML = `<div class="card kode-card">
        <div class="small muted">Kode gabung kelompok</div>
        <div class="kode-besar">${esc(kode)}</div>
        <div class="small ${k.kode_aktif === 0 ? '' : 'muted'}">${k.kode_aktif === 0 ? '⛔ Kode sedang dinonaktifkan — murid tidak bisa bergabung.' : 'Bagikan kode ini kepada murid. Murid memasukkannya di menu <b>Akun → Gabung Kelompok</b>.'}</div>
        <div class="row" style="justify-content:center;margin-top:12px">
          <button class="btn kecil" id="salin-kode">📋 Salin kode</button>
          <button class="btn sec kecil" id="salin-link">🔗 Salin tautan gabung</button>
          <a class="btn kecil" style="background:#25d366" target="_blank" href="https://wa.me/?text=${encodeURIComponent(bagikanKode(k))}">Bagikan via WhatsApp</a>
        </div>
        <div class="row" style="justify-content:center;margin-top:8px">
          <button class="btn putih kecil" id="kode-baru">🔄 Buat kode baru</button>
          <button class="btn putih kecil" id="kode-togel">${k.kode_aktif === 0 ? '✅ Aktifkan kode' : '⛔ Nonaktifkan kode'}</button>
        </div>
        <p class="tiny muted">Membuat kode baru membuat kode lama tidak berlaku. Anggota yang sudah bergabung tetap di kelompok.</p>
      </div>
      <div class="card"><h3>Anggota (${sis.length})</h3>
        ${sis.length ? sis.map((x) => `<div class="row spread" style="padding:8px 0;border-bottom:1px solid #f0ede4"><div><b>${esc(x.nama)}</b><div class="tiny muted">@${esc(x.username)}${x.nis ? ' · NIS ' + esc(x.nis) : ''}</div></div>
          <button class="btn putih kecil" data-keluar="${x.id}" data-nama="${esc(x.nama)}">Keluarkan</button></div>`).join('') : '<div class="kosong">Belum ada anggota. Bagikan kode di atas.</div>'}
      </div>
      <div class="card"><h3>Ubah kelompok</h3><form id="f-ubah-k" class="row"><input class="input" name="nama" value="${esc(k.nama)}" style="flex:1;min-width:180px" required><button class="btn">Simpan nama</button></form>
        <button class="btn merah kecil" id="hapus-k" style="margin-top:12px">Hapus kelompok</button><span class="tiny muted"> (hanya bila tidak ada anggota)</span></div>`;
      const salin = async (t, pesan) => { try { await navigator.clipboard.writeText(t); toast(pesan); } catch { prompt('Salin teks berikut:', t); } };
      $('#salin-kode').onclick = () => salin(kode, 'Kode disalin ✓');
      $('#salin-link').onclick = () => salin(tautanGabung(kode), 'Tautan gabung disalin ✓');
      $('#kode-baru').onclick = async () => { if (!confirm('Buat kode baru? Kode lama tidak bisa dipakai lagi.')) return; await coba(() => api(`/kelompok/${id}/kode`, { method: 'POST' }), 'Kode baru dibuat'); viewKelompok(id, 'anggota'); };
      $('#kode-togel').onclick = async () => { await coba(() => api('/kelompok/' + id, { method: 'PUT', body: { kode_aktif: k.kode_aktif === 0 ? 1 : 0 } }), 'Disimpan'); viewKelompok(id, 'anggota'); };
      $$('[data-keluar]', el).forEach((b) => (b.onclick = async () => {
        if (!confirm(`Keluarkan ${b.dataset.nama} dari kelompok ini? Riwayat bacaannya tetap tersimpan.`)) return;
        await coba(() => api(`/kelompok/${id}/keluarkan`, { method: 'POST', body: { siswa_id: +b.dataset.keluar } }), 'Dikeluarkan'); viewKelompok(id, 'anggota');
      }));
      $('#f-ubah-k').onsubmit = async (e) => { e.preventDefault(); await coba(() => api('/kelompok/' + id, { method: 'PUT', body: { nama: e.target.nama.value } }), 'Disimpan'); viewKelompok(id, 'anggota'); };
      $('#hapus-k').onclick = async () => { if (!confirm('Hapus kelompok ini?')) return; await coba(() => api('/kelompok/' + id, { method: 'DELETE' }), 'Kelompok dihapus'); location.hash = S.me.user.peran === 'admin' ? '#/kelompok' : '#/'; };
    }
    if (t === 'rank') {
      el.innerHTML = '<div class="card kosong">Memuat…</div>';
      const r = await api('/peringkat/' + id);
      el.innerHTML = `<div class="card">${r.map((x, i) => `<div class="rank r${i + 1}"><div class="pos">${i + 1}</div><div class="nm">${esc(x.nama)}<div class="tiny muted">${x.total_dibaca} hlm · 🔥${x.streak} · ${x.khatam}× khatam</div></div><div class="pt">${x.poin} ⭐</div></div>`).join('') || '<div class="kosong">Belum ada data</div>'}</div>`;
    }
  };
  renderTab(tab);
}

async function viewSiswaDetail(id) {
  memuat();
  await muatMeta();
  const d = await api(`/siswa/${id}?riwayat=60`);
  const s = d.siswa, st = d.status;
  const opsiSurah = S.meta.surah.map((x) => `<option value="${x[4]}">${x[0]}. ${esc(x[1])} (hlm ${x[4]})</option>`).join('');
  shell(`
  <a class="small" href="#/k/${s.kelompok_id}">← ${esc(d.kelompok?.nama || 'Kembali')}</a>
  <h1 style="margin:4px 0">${esc(s.nama)}</h1><div class="small muted">@${esc(s.username)} ${s.nis ? '· NIS ' + esc(s.nis) : ''} · mulai ${tglIndo(st.tgl_mulai, false)} dari hlm ${st.halaman_mulai}</div>
  <div class="alert ${st.selesai_hari_ini ? 'sukses' : st.hutang ? 'bahaya' : 'peringatan'}" style="margin-top:12px">${st.selesai_hari_ini ? '✅ Target hari ini tuntas' : `⏰ Sisa wajib hari ini ${st.sisa_hari_ini} halaman`}${st.hutang ? ` · hutang ${st.hutang} halaman` : ''}${st.spare ? ` · tabungan ${st.spare} halaman` : ''}</div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat hijau"><div class="n">${st.poin}</div><div class="l">Poin</div></div>
    <div class="stat"><div class="n">${st.total_dibaca}</div><div class="l">Total halaman</div></div>
    <div class="stat emas"><div class="n">${st.hari_tepat}/${st.hari_terjadwal}</div><div class="l">Hari tepat jadwal</div></div>
    <div class="stat biru"><div class="n">${st.khatam}</div><div class="l">Khatam · posisi hlm ${st.halaman_berikut}</div></div>
  </div>
  <div class="card"><h3>Kalender 60 hari</h3>${kalender(st.riwayat || [])}</div>
  <div class="grid g2" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="card"><h3>✍️ Setor bacaan manual</h3><p class="small muted">Untuk bacaan yang disimak langsung oleh guru. Halaman dicatat berurutan mulai hlm ${st.halaman_berikut}.</p>
      <form id="f-setor" class="row"><input class="input" type="number" name="jumlah" min="1" max="604" placeholder="Jumlah hlm" style="width:120px" required>
      <input class="input" type="date" name="tanggal" value="${hariIni()}" max="${hariIni()}" style="width:170px"><button class="btn">Setor</button></form></div>
    <div class="card"><h3>🎯 Target khusus siswa ini</h3>
      <form id="f-tsis" class="row"><input class="input" type="number" name="halaman_per_hari" min="0" max="604" placeholder="Hlm/hari" style="width:110px" required>
      <input class="input" type="date" name="mulai" value="${hariIni()}" style="width:170px"><button class="btn">Simpan</button></form>
      ${d.jadwal_khusus.length ? `<div class="small" style="margin-top:10px">${d.jadwal_khusus.map((j) => `<div class="row spread" style="padding:4px 0"><span>${tglIndo(j.mulai)} → <b>${j.halaman_per_hari} hlm/hari</b></span><button class="btn putih kecil" data-hj="${j.id}">Hapus</button></div>`).join('')}</div>` : '<p class="tiny muted">Belum ada — mengikuti target kelompok.</p>'}</div>
    <div class="card"><h3>📍 Titik mulai tadarus</h3><p class="small muted">Gunakan jika siswa melanjutkan dari bacaan sebelumnya (bukan dari Al-Fatihah).</p>
      <form id="f-mulai"><div class="grid g2"><div class="field"><label>Tanggal mulai</label><input class="input" type="date" name="tgl_mulai" value="${s.tgl_mulai || ''}"></div>
      <div class="field"><label>Halaman mulai</label><input class="input" type="number" min="1" max="604" name="halaman_mulai" value="${s.halaman_mulai || 1}"></div></div>
      <div class="field"><label>atau pilih awal surah</label><select class="input" id="pilih-surah"><option value="">—</option>${opsiSurah}</select></div>
      <button class="btn">Simpan</button></form></div>
  </div>
  <div class="card"><h3>Log bacaan terakhir</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Halaman</th><th>Waktu</th><th>Sumber</th><th></th></tr></thead><tbody>
    ${d.log.map((l) => `<tr><td>${tglIndo(l.tanggal)}</td><td>hlm ${l.halaman} <span class="tiny muted">${esc(surahDiHalaman(l.halaman)[1])}</span></td><td class="small">${waktuWIB(l.waktu)}</td><td>${l.sumber === 'guru' ? `<span class="badge emas">Setor: ${esc(l.oleh_nama || 'guru')}</span>` : l.sumber === 'cetak' ? '<span class="badge biru">📗 Mushaf cetak</span>' : '<span class="badge hijau">Aplikasi</span>'}</td>
    <td><button class="btn putih kecil" data-hl="${l.id}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="5" class="kosong">Belum ada bacaan</td></tr>'}</tbody></table></div></div>`);
  $('#f-setor').onsubmit = async (e) => { e.preventDefault(); await coba(() => api(`/siswa/${id}/setor`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }), 'Setoran dicatat'); viewSiswaDetail(id); };
  $('#f-tsis').onsubmit = async (e) => { e.preventDefault(); await coba(() => api('/jadwal', { method: 'POST', body: { ...Object.fromEntries(new FormData(e.target)), siswa_id: id } }), 'Target khusus disimpan'); viewSiswaDetail(id); };
  $('#pilih-surah').onchange = (e) => { if (e.target.value) $('#f-mulai').halaman_mulai.value = e.target.value; };
  $('#f-mulai').onsubmit = async (e) => { e.preventDefault(); await coba(() => api(`/siswa/${id}/mulai`, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }), 'Titik mulai disimpan'); viewSiswaDetail(id); };
  $$('[data-hj]').forEach((b) => (b.onclick = async () => { await coba(() => api('/jadwal/' + b.dataset.hj, { method: 'DELETE' }), 'Dihapus'); viewSiswaDetail(id); }));
  $$('[data-hl]').forEach((b) => (b.onclick = async () => { if (!confirm('Hapus catatan bacaan ini?')) return; await coba(() => api('/bacaan/' + b.dataset.hl, { method: 'DELETE' }), 'Dihapus'); viewSiswaDetail(id); }));
}

// =========================================================
//  ADMIN
// =========================================================
async function viewDasborAdmin() {
  memuat();
  const [d, kel, gt] = await Promise.all([api('/dashboard'), api('/kelompok'), api('/guru-tadarus').catch(() => [])]);
  shell(`<h1>Dasbor Admin</h1><p class="muted small" style="margin-top:-6px">${tglIndo(hariIni())}</p>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat"><div class="n">${d.siswa}</div><div class="l">Siswa aktif</div></div>
    <div class="stat"><div class="n">${d.guru}</div><div class="l">Guru</div></div>
    <div class="stat hijau"><div class="n">${d.selesai_hari_ini}</div><div class="l">Tuntas hari ini</div></div>
    <div class="stat merah"><div class="n">${d.berhutang}</div><div class="l">Siswa berhutang</div></div>
    <div class="stat"><div class="n">${d.kelompok}</div><div class="l">Kelompok</div></div>
    <div class="stat emas"><div class="n">${d.halaman_hari_ini}</div><div class="l">Halaman dibaca hari ini</div></div>
    <div class="stat"><div class="n">${d.halaman_total}</div><div class="l">Total halaman</div></div>
    <div class="stat biru"><div class="n">${d.total_khatam}</div><div class="l">Total khatam</div></div>
  </div>
  ${d.siswa === 0 ? `<div class="alert info">👋 Mulai dengan: (1) buat akun guru di menu <a href="#/pengguna">Pengguna</a>, (2) buat <a href="#/kelompok">Kelompok</a> beserta target halaman/hari, (3) impor/tambah akun siswa ke kelompok.</div>` : ''}
  <h2>Kelompok</h2>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${kel.map((k) => `<a class="card kelompok-card" href="#/k/${k.id}"><div class="row spread"><b>${esc(k.nama)}</b><span class="badge hijau">${k.jumlah_siswa} siswa</span></div><div class="small muted" style="margin-top:6px">🎯 ${k.target ?? 0} hlm/hari · ${esc(k.guru_nama || 'tanpa guru')}</div></a>`).join('') || '<div class="card kosong">Belum ada kelompok</div>'}</div>
  <h2 style="margin-top:20px">Tadarus Guru</h2>
  <div class="card">${gt.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nama</th><th>Hari ini</th><th>Hutang</th><th>Tabungan</th><th>Poin</th><th>7 hari</th></tr></thead><tbody>
    ${gt.map((g) => `<tr><td><b>${esc(g.nama)}</b></td><td>${STATUS_BADGE(g)}<div class="tiny muted">${g.dibaca_hari_ini}/${g.dibaca_hari_ini + g.sisa_hari_ini} hlm</div></td><td>${g.hutang ? `<b style="color:var(--merah)">${g.hutang}</b>` : 0}</td><td>${g.spare}</td><td><b>${g.poin}</b></td>
    <td><div class="titik">${(g.riwayat || []).map((r) => `<i class="${r.status}" title="${r.t}: ${r.dibaca} hlm"></i>`).join('')}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="kosong">Belum ada akun guru</div>'}
    <p class="tiny muted">Target guru diatur di menu Pengaturan.</p></div>`);
}

async function viewAdminKelompok() {
  memuat();
  const [kel, guru] = await Promise.all([api('/kelompok'), api('/users?peran=guru')]);
  const p = S.me.pengaturan;
  shell(`<div class="row spread"><h1 style="margin:0">Kelompok</h1><button class="btn" id="tambah">+ Kelompok</button></div>
  <p class="small muted">Kelompok = kelas/halaqah. Setiap kelompok punya guru pembimbing, target halaman per hari dan hari aktif.</p>
  <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nama</th><th>Kode gabung</th><th>Guru</th><th>Siswa</th><th>Target</th><th>Hari aktif</th><th></th></tr></thead><tbody>
  ${kel.map((k) => `<tr><td><a href="#/k/${k.id}"><b>${esc(k.nama)}</b></a></td><td><a href="#/k/${k.id}/anggota"><code>${esc(k.kode || '-')}</code></a></td><td>${esc(k.guru_nama || '-')}</td><td>${k.jumlah_siswa}</td><td>${k.target ?? 0} hlm/hari</td>
  <td class="small">${(k.hari_aktif || '').split('').map((i) => HARI[i]?.slice(0, 3)).join(', ')}</td>
  <td class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn putih kecil" data-edit="${k.id}">Ubah</button><button class="btn putih kecil" data-hapus="${k.id}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="7" class="kosong">Belum ada kelompok</td></tr>'}
  </tbody></table></div></div>`);
  const form = (k = {}) => modal(`<h2>${k.id ? 'Ubah' : 'Tambah'} Kelompok</h2><form id="f-k">
    <div class="field"><label>Nama kelompok</label><input class="input" name="nama" value="${esc(k.nama || '')}" placeholder="mis. X-1 / Halaqah Al-Fatih" required></div>
    <div class="field"><label>Guru pembimbing</label><select class="input" name="guru_id"><option value="">— pilih —</option>${guru.map((g) => `<option value="${g.id}" ${g.id === k.guru_id ? 'selected' : ''}>${esc(g.nama)}</option>`).join('')}</select></div>
    ${k.id ? '' : `<div class="grid g2"><div class="field"><label>Target halaman/hari</label><input class="input" type="number" name="halaman_per_hari" min="0" max="604" value="${p.default_halaman_per_hari || 2}"></div>
    <div class="field"><label>Mulai program</label><input class="input" type="date" name="tgl_mulai" value="${hariIni()}"></div></div>`}
    <div class="field"><label>Hari wajib tadarus</label><div class="chip-hari">${HARI.map((h, i) => `<label><input type="checkbox" name="h" value="${i}" ${(k.hari_aktif ?? '0123456').includes(String(i)) ? 'checked' : ''}> ${h.slice(0, 3)}</label>`).join('')}</div></div>
    <div class="row"><button class="btn">Simpan</button><button type="button" class="btn sec" data-tutup>Batal</button></div></form>`, (m) => {
    $('#f-k', m).onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = { ...Object.fromEntries(fd), hari_aktif: fd.getAll('h').join('') };
      delete body.h;
      body.guru_id = body.guru_id ? parseInt(body.guru_id) : null;
      if (k.id) await coba(() => api('/kelompok/' + k.id, { method: 'PUT', body }), 'Disimpan');
      else await coba(() => api('/kelompok', { method: 'POST', body }), 'Kelompok dibuat');
      tutupModal(); viewAdminKelompok();
    };
  });
  $('#tambah').onclick = () => form();
  $$('[data-edit]').forEach((b) => (b.onclick = () => form(kel.find((k) => k.id == b.dataset.edit))));
  $$('[data-hapus]').forEach((b) => (b.onclick = async () => { if (!confirm('Hapus kelompok ini?')) return; await coba(() => api('/kelompok/' + b.dataset.hapus, { method: 'DELETE' }), 'Dihapus'); viewAdminKelompok(); }));
}

async function viewPengguna() {
  memuat();
  const [users, kel] = await Promise.all([api('/users'), api('/kelompok')]);
  const filt = JSON.parse(sessionStorage.getItem('filt_user') || '{}');
  shell(`<div class="row spread"><h1 style="margin:0">Pengguna</h1>
    <div class="row" style="gap:6px"><button class="btn sec" id="impor">⬆ Impor CSV</button><button class="btn" id="tambah">+ Pengguna</button></div></div>
    <div class="card" style="margin-top:12px"><div class="row" style="margin-bottom:10px;gap:6px">
      <select class="input" id="fp" style="width:auto"><option value="">Semua peran</option><option value="siswa">Siswa</option><option value="guru">Guru</option><option value="admin">Admin</option></select>
      <select class="input" id="fk" style="width:auto"><option value="">Semua kelompok</option>${kel.map((k) => `<option value="${k.id}">${esc(k.nama)}</option>`).join('')}</select>
      <input class="input" id="fq" placeholder="Cari nama / username…" style="width:200px">
      <span class="small muted" id="jml"></span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nama</th><th>Username</th><th>Peran</th><th>Kelompok</th><th>Status</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`);
  $('#fp').value = filt.p || ''; $('#fk').value = filt.k || ''; $('#fq').value = filt.q || '';
  const isi = () => {
    const p = $('#fp').value, k = $('#fk').value, q = $('#fq').value.toLowerCase();
    sessionStorage.setItem('filt_user', JSON.stringify({ p, k, q }));
    const rows = users.filter((u) => (!p || u.peran === p) && (!k || String(u.kelompok_id) === k) && (!q || u.nama.toLowerCase().includes(q) || u.username.includes(q)));
    $('#jml').textContent = rows.length + ' pengguna';
    $('#tb').innerHTML = rows.map((u) => `<tr><td><b>${esc(u.nama)}</b>${u.nis ? `<div class="tiny muted">NIS ${esc(u.nis)}</div>` : ''}</td><td>${esc(u.username)}</td>
      <td><span class="badge ${u.peran === 'admin' ? 'merah' : u.peran === 'guru' ? 'biru' : 'hijau'}">${u.peran}</span></td><td>${esc(u.kelompok_nama || '-')}</td>
      <td>${u.aktif ? '<span class="badge hijau">aktif</span>' : '<span class="badge">nonaktif</span>'}${u.wajib_ganti_pw ? ' <span class="badge emas" title="Belum mengganti password bawaan">pw awal</span>' : ''}</td>
      <td class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn putih kecil" data-edit="${u.id}">Ubah</button><button class="btn putih kecil" data-reset="${u.id}">Reset PW</button><button class="btn putih kecil" data-hapus="${u.id}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="6" class="kosong">Tidak ada data</td></tr>';
    $$('[data-edit]').forEach((b) => (b.onclick = () => formUser(users.find((x) => x.id == b.dataset.edit))));
    $$('[data-reset]').forEach((b) => (b.onclick = async () => {
      const u = users.find((x) => x.id == b.dataset.reset);
      const pw = prompt(`Password baru untuk ${u.nama}:`, Math.random().toString(36).slice(2, 8));
      if (!pw) return;
      await coba(() => api('/users/' + u.id, { method: 'PUT', body: { password: pw } }));
      tampilAkun([{ nama: u.nama, username: u.username, password: pw }], 'Password direset');
    }));
    $$('[data-hapus]').forEach((b) => (b.onclick = async () => {
      const u = users.find((x) => x.id == b.dataset.hapus);
      if (!confirm(`Hapus ${u.nama}? Semua riwayat bacaannya ikut terhapus. (Alternatif: nonaktifkan lewat Ubah)`)) return;
      await coba(() => api('/users/' + u.id, { method: 'DELETE' }), 'Dihapus'); viewPengguna();
    }));
  };
  isi();
  ['fp', 'fk'].forEach((x) => ($('#' + x).onchange = isi)); $('#fq').oninput = isi;

  const formUser = (u = {}) => modal(`<h2>${u.id ? 'Ubah' : 'Tambah'} Pengguna</h2><form id="f-u">
    <div class="grid g2"><div class="field"><label>Peran</label><select class="input" name="peran">${['siswa', 'guru', 'admin'].map((p) => `<option ${p === (u.peran || filt.p || 'siswa') ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <div class="field" id="fld-kel"><label>Kelompok</label><select class="input" name="kelompok_id"><option value="">—</option>${kel.map((k) => `<option value="${k.id}" ${k.id === u.kelompok_id || (!u.id && String(k.id) === filt.k) ? 'selected' : ''}>${esc(k.nama)}</option>`).join('')}</select></div></div>
    <div class="field"><label>Nama lengkap</label><input class="input" name="nama" value="${esc(u.nama || '')}" required></div>
    <div class="grid g2"><div class="field"><label>Username</label><input class="input" name="username" value="${esc(u.username || '')}" autocapitalize="none" required></div>
    <div class="field"><label>${u.id ? 'Password baru (kosongkan bila tetap)' : 'Password (kosong = acak)'}</label><input class="input" name="password"></div></div>
    <div class="grid g2"><div class="field"><label>NIS / No. Induk</label><input class="input" name="nis" value="${esc(u.nis || '')}"></div>
    <div class="field"><label>L/P</label><select class="input" name="jk"><option value="">—</option><option ${u.jk === 'L' ? 'selected' : ''}>L</option><option ${u.jk === 'P' ? 'selected' : ''}>P</option></select></div></div>
    ${u.id ? `<label class="row small"><input type="checkbox" name="aktif" ${u.aktif ? 'checked' : ''}> Akun aktif</label><br>` : ''}
    <div class="row"><button class="btn">Simpan</button><button type="button" class="btn sec" data-tutup>Batal</button></div></form>`, (m) => {
    const f = $('#f-u', m);
    const togel = () => $('#fld-kel', m).style.visibility = f.peran.value === 'siswa' ? 'visible' : 'hidden';
    f.peran.onchange = togel; togel();
    if (!u.id) f.nama.oninput = () => { if (!f.username._ubah) f.username.value = buatUsername(f.nama.value, f.nis.value); };
    f.username.oninput = () => (f.username._ubah = true);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      body.kelompok_id = body.kelompok_id ? parseInt(body.kelompok_id) : null;
      if (u.id) {
        body.aktif = f.aktif.checked ? 1 : 0;
        if (!body.password) delete body.password;
        await coba(() => api('/users/' + u.id, { method: 'PUT', body }), 'Disimpan');
        tutupModal(); viewPengguna();
      } else {
        const r = await coba(() => api('/users', { method: 'POST', body }));
        await viewPengguna();
        tampilAkun([r], 'Akun dibuat');
      }
    };
  });
  $('#tambah').onclick = () => formUser();
  $('#impor').onclick = () => modal(`<h2>Impor Pengguna dari CSV / Excel</h2>
    <p class="small">Salin dari Excel/Spreadsheet (dengan baris judul) lalu tempel di bawah, atau pilih file .csv. Bisa ratusan baris sekaligus (dikirim bertahap otomatis). Kolom yang dikenali:
    <code>nama, username, password, kelompok, nis, jk, peran</code>. Hanya <b>nama</b> yang wajib — username dibuat otomatis, password acak, peran default <i>siswa</i>, kelompok baru otomatis dibuat.</p>
    <button class="btn putih kecil" id="contoh">⬇ Unduh contoh CSV</button>
    <div class="field" style="margin-top:10px"><input type="file" accept=".csv,.txt" id="file-csv" class="input"></div>
    <div class="field"><textarea class="input" id="txt-csv" rows="8" placeholder="nama;kelompok;nis&#10;Ahmad Fauzi;X-1;12345&#10;Siti Aminah;X-1;12346"></textarea></div>
    <div class="row"><button class="btn" id="proses">Impor</button><button class="btn sec" data-tutup>Batal</button></div><div id="hasil-impor"></div>`, (m) => {
    $('#contoh', m).onclick = () => unduhCSV('contoh-impor-siswa.csv', [['nama', 'username', 'password', 'kelompok', 'nis', 'jk', 'peran'], ['Ahmad Fauzi', '', '', 'X-1', '12345', 'L', 'siswa'], ['Siti Aminah', 'siti.aminah', 'rahasia1', 'X-1', '12346', 'P', 'siswa'], ['Ust. Hasan', 'hasan', '', '', '', 'L', 'guru']]);
    $('#file-csv', m).onchange = async (e) => { const f = e.target.files[0]; if (f) $('#txt-csv', m).value = await f.text(); };
    $('#proses', m).onclick = async () => {
      const rows = parseCSV($('#txt-csv', m).value);
      if (rows.length < 2) return toast('Data kosong / tanpa baris judul', true);
      const head = rows[0].map((h) => h.trim().toLowerCase());
      if (!head.includes('nama')) return toast('Kolom "nama" tidak ditemukan pada baris judul', true);
      const dipakai = new Set(users.map((u) => u.username));
      const list = rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => {
        const o = {}; head.forEach((h, i) => (o[h] = (r[i] || '').trim()));
        if (!o.username) { let un = buatUsername(o.nama, o.nis), n = 2; const dasar = un; while (dipakai.has(un)) un = dasar + n++; o.username = un; }
        dipakai.add(o.username.toLowerCase());
        if (!o.password) o.password = Math.random().toString(36).slice(2, 8);
        if (o.peran) o.peran = o.peran.toLowerCase();
        return o;
      });
      // dikirim bertahap (5 baris per permintaan) agar aman untuk batas Cloudflare paket gratis
      const btn = $('#proses', m); btn.disabled = true;
      const UKURAN = 5, akun = [], gagal = [];
      for (let i = 0; i < list.length; i += UKURAN) {
        const potong = list.slice(i, i + UKURAN);
        btn.textContent = `Mengimpor ${Math.min(i + UKURAN, list.length)} / ${list.length}…`;
        let r = null;
        for (let coba = 0; coba < 3 && !r; coba++) {
          try { r = await api('/users/import', { method: 'POST', body: { users: potong } }); }
          catch (e) { if (coba === 2) potong.forEach((x, k) => gagal.push({ baris: i + k + 1, username: x.username, error: e.message })); else await new Promise((ok) => setTimeout(ok, 1500)); }
        }
        if (r) {
          r.akun.forEach((x) => akun.push(x));
          r.gagal.forEach((g) => gagal.push({ ...g, baris: i + g.baris }));
        }
      }
      await viewPengguna();
      tampilAkun(akun, `${akun.length} akun berhasil dibuat` + (gagal.length ? `, ${gagal.length} gagal` : ''), gagal);
    };
  });
}
function buatUsername(nama, nis) {
  if (nis) return String(nis).toLowerCase().replace(/[^a-z0-9]/g, '');
  const p = String(nama || '').toLowerCase().normalize('NFD').replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(Boolean);
  return (p.slice(0, 2).join('.') || 'user').slice(0, 30);
}
function tampilAkun(akun, judul, gagal = []) {
  const url = location.origin;
  modal(`<div class="no-print"><h2>✅ ${esc(judul)}</h2><p class="small muted">Catat/cetak dan bagikan akun berikut. Password ini <b>hanya ditampilkan sekali</b>. Pengguna akan diminta mengganti password saat login pertama.</p>
    ${gagal.length ? `<div class="alert bahaya small" style="display:block">${gagal.map((g) => `Baris ${g.baris} (${esc(g.username || '')}): ${esc(g.error)}`).join('<br>')}</div>` : ''}
    <div class="row" style="margin-bottom:10px"><button class="btn kecil" id="cetak-akun">🖨 Cetak kartu akun</button><button class="btn sec kecil" id="csv-akun">⬇ CSV</button><button class="btn putih kecil" data-tutup>Tutup</button></div></div>
    <div class="kartu-grid" id="kartu">${akun.map((a) => `<div class="kartu-akun"><b>${esc(a.nama)}</b><br>Username: <code>${esc(a.username)}</code><br>Password: <code>${esc(a.password)}</code><div class="tiny muted" style="margin-top:4px">${esc(url)}</div></div>`).join('')}</div>`, (m) => {
    $('#csv-akun', m).onclick = () => unduhCSV('akun-tadarus.csv', [['nama', 'username', 'password', 'alamat'], ...akun.map((a) => [a.nama, a.username, a.password, url])]);
    $('#cetak-akun', m).onclick = () => {
      const w = window.open('', '_blank');
      w.document.write(`<html><head><title>Kartu Akun Tadarus</title><style>body{font-family:sans-serif;margin:12mm}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}.k{border:1px dashed #888;border-radius:8px;padding:10px;font-size:12px;break-inside:avoid}.k b{font-size:13px}code{font-size:13px;font-weight:bold}h3{margin:0 0 8px}</style></head><body><h3>${esc(S.me.pengaturan.nama_lembaga || 'Tadarus')} — Akun Aplikasi Tadarus</h3><div class="g">${$('#kartu', m).innerHTML.replaceAll('kartu-akun', 'k')}</div><script>print()<\/script></body></html>`);
      w.document.close();
    };
  });
}

async function viewLiburAdmin() {
  memuat();
  const data = await api('/libur');
  shell(`<h1>Hari Libur</h1><p class="small muted">Libur untuk <b>semua kelompok</b> (mis. libur nasional, Idul Fitri). Libur khusus kelompok diatur oleh guru di halaman kelompok.</p>
  <div class="card"><form id="f-libur" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
    <div class="field"><label>Dari tanggal</label><input class="input" type="date" name="tanggal" required></div>
    <div class="field"><label>Sampai (opsional)</label><input class="input" type="date" name="sampai"></div>
    <div class="field"><label>Keterangan</label><input class="input" name="keterangan" placeholder="mis. Libur Idul Fitri"></div>
    <div class="field" style="align-self:end"><button class="btn blok">Tambah</button></div></form></div>
  <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Keterangan</th><th>Berlaku</th><th></th></tr></thead><tbody>
  ${data.map((l) => `<tr><td>${tglIndo(l.tanggal)}</td><td>${esc(l.keterangan || '')}</td><td>${l.kelompok_id ? esc(l.kelompok_nama) : '<span class="badge biru">Semua</span>'}</td><td><button class="btn putih kecil" data-h="${l.id}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="4" class="kosong">Belum ada</td></tr>'}
  </tbody></table></div></div>`);
  $('#f-libur').onsubmit = async (e) => { e.preventDefault(); await coba(() => api('/libur', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }), 'Ditambahkan'); viewLiburAdmin(); };
  $$('[data-h]').forEach((b) => (b.onclick = async () => { await coba(() => api('/libur/' + b.dataset.h, { method: 'DELETE' }), 'Dihapus'); viewLiburAdmin(); }));
}

async function viewPengaturan() {
  memuat();
  const p = await api('/pengaturan');
  shell(`<h1>Pengaturan</h1><div class="card"><form id="f-p">
    <div class="field"><label>Nama lembaga / aplikasi</label><input class="input" name="nama_lembaga" value="${esc(p.nama_lembaga || '')}"></div>
    <div class="field"><label>Sub judul</label><input class="input" name="sub_judul" value="${esc(p.sub_judul || '')}"></div>
    <div class="field"><label>URL logo (opsional, gambar persegi)</label><input class="input" name="logo" value="${esc(p.logo || '')}" placeholder="https://…/logo.png"></div>
    <div class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      <div class="field"><label>Poin per hari tepat jadwal</label><input class="input" type="number" min="0" name="poin_harian" value="${esc(p.poin_harian || 10)}"></div>
      <div class="field"><label>Bonus poin per khatam</label><input class="input" type="number" min="0" name="poin_khatam" value="${esc(p.poin_khatam || 100)}"></div>
      <div class="field"><label>Default target hlm/hari</label><input class="input" type="number" min="0" max="604" name="default_halaman_per_hari" value="${esc(p.default_halaman_per_hari || 2)}"></div>
    </div>
    <h3 style="margin-top:10px">Tadarus guru</h3>
    <div class="grid g2" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      <div class="field"><label>Guru juga wajib tadarus harian</label><select class="input" name="tadarus_guru_aktif"><option value="1" ${p.tadarus_guru_aktif !== '0' ? 'selected' : ''}>Ya</option><option value="0" ${p.tadarus_guru_aktif === '0' ? 'selected' : ''}>Tidak</option></select></div>
      <div class="field"><label>Target guru (halaman/hari)</label><input class="input" type="number" min="0" max="604" name="target_guru" value="${esc(p.target_guru ?? 2)}"></div>
    </div>
    <h3 style="margin-top:10px">Laporan mushaf cetak</h3>
    <div class="field"><label>Siswa/guru boleh melapor sudah membaca dari mushaf cetak (offline)</label><select class="input" name="izin_cetak"><option value="1" ${p.izin_cetak !== '0' ? 'selected' : ''}>Boleh (dengan pernyataan jujur, tercatat sebagai "mushaf cetak")</option><option value="0" ${p.izin_cetak === '0' ? 'selected' : ''}>Tidak boleh</option></select></div>
    <h3 style="margin-top:10px">Program OWOJ (One Week One Juz)</h3>
    <div class="grid g2" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      <div class="field"><label>Status program</label><select class="input" name="owoj_aktif"><option value="1" ${p.owoj_aktif !== '0' ? 'selected' : ''}>Aktif</option><option value="0" ${p.owoj_aktif === '0' ? 'selected' : ''}>Nonaktif</option></select></div>
      <div class="field"><label>Pekan dimulai hari</label><select class="input" name="owoj_hari_mulai">${HARI.map((h, i) => `<option value="${i}" ${String(i) === String(p.owoj_hari_mulai ?? '1') ? 'selected' : ''}>${h}</option>`).join('')}</select></div>
      <div class="field"><label>Cakupan grup OWOJ</label><select class="input" name="owoj_cakupan"><option value="sekolah" ${p.owoj_cakupan !== 'kelompok' ? 'selected' : ''}>Satu sekolah/lembaga — semua murid & guru berbagi satu peta 30 juz</option><option value="kelompok" ${p.owoj_cakupan === 'kelompok' ? 'selected' : ''}>Per kelompok — tiap kelas punya peta 30 juz sendiri</option></select></div>
      <div class="field"><label>Maksimal juz per orang per pekan</label><input class="input" type="number" min="0" max="30" name="owoj_maks_juz" value="${esc(p.owoj_maks_juz ?? 5)}"><div class="tiny muted">0 = tanpa batas</div></div>
      <div class="field"><label>Pembagian juz</label><select class="input" name="owoj_juz_unik"><option value="1" ${p.owoj_juz_unik !== '0' ? 'selected' : ''}>Sistem putaran — juz bisa diambil lagi setelah ke-30 juz diambil (khatam bersama)</option><option value="0" ${p.owoj_juz_unik === '0' ? 'selected' : ''}>Bebas — juz mana pun boleh dipilih bersamaan</option></select></div>
      <div class="field"><label>Poin per juz OWOJ tuntas</label><input class="input" type="number" min="0" name="owoj_poin" value="${esc(p.owoj_poin ?? 50)}"></div>
      <div class="field"><label>Halaman OWOJ ikut memenuhi target tadarus harian</label><select class="input" name="owoj_hitung_tadarus"><option value="1" ${p.owoj_hitung_tadarus !== '0' ? 'selected' : ''}>Ya (otomatis tercatat, kelebihan jadi tabungan)</option><option value="0" ${p.owoj_hitung_tadarus === '0' ? 'selected' : ''}>Tidak (terpisah)</option></select></div>
    </div>
    <button class="btn">Simpan</button></form></div>`);
  $('#f-p').onsubmit = async (e) => {
    e.preventDefault();
    await coba(() => api('/pengaturan', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }), 'Pengaturan disimpan');
    await muatSaya(); S.info = null; viewPengaturan();
  };
}

// ---------- CSV ----------
function parseCSV(teks) {
  const baris = teks.replace(/\r/g, '').split('\n');
  const contoh = baris[0] || '';
  const sep = contoh.includes('\t') ? '\t' : (contoh.split(';').length > contoh.split(',').length ? ';' : ',');
  const out = [];
  for (const b of baris) {
    if (!b.trim()) continue;
    const r = []; let cur = '', q = false;
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (q) { if (c === '"' && b[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === sep) { r.push(cur); cur = ''; } else cur += c;
    }
    r.push(cur); out.push(r);
  }
  return out;
}
function unduhCSV(nama, rows) {
  const isi = rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + isi], { type: 'text/csv;charset=utf-8' }));
  a.download = nama; a.click();
}


// =========================================================
//  OWOJ — One Week One Juz (banyak juz per orang + putaran khatam)
// =========================================================
const rentangPekan = (d) => `${tglIndo(d.pekan, false)} – ${tglIndo(d.akhir, false)}`;
const statusPilihan = (x) => !x ? '<span class="badge merah">Belum memilih</span>'
  : x.selesai_pada ? '<span class="badge hijau">Tuntas ✓</span>'
  : x.dibaca ? `<span class="badge emas">${x.dibaca}/${x.total} hlm</span>` : '<span class="badge biru">Belum mulai</span>';
const teksKhatam = (n) => n > 0 ? `Khatam ${n}×` : 'Belum khatam';

async function viewOwoj() {
  memuat();
  await muatMeta();
  const guru = S.me.user.peran !== 'siswa';
  const kidPilih = sessionStorage.getItem('owoj_k') || '';
  const pekanPilih = sessionStorage.getItem('owoj_pekan') || '';
  const q = new URLSearchParams();
  if (kidPilih) q.set('kelompok_id', kidPilih);
  if (pekanPilih) q.set('pekan', pekanPilih);
  const d = await api('/owoj?' + q);
  const modeDepan = sessionStorage.getItem('owoj_mode') === 'depan';
  if (modeDepan) { d.peta = d.peta_depan; d.stat = d.stat_depan; d.pekan = d.pekan_depan; d.akhir = d.akhir_depan; }
  const pekanIni = !modeDepan && d.pekan === d.pekan_ini;
  const bisaPilih = d.aktif && (pekanIni || modeDepan);
  const rekap = guru && d.kelompok_id ? await api(`/owoj/rekap/${d.kelompok_id}?pekan=${d.pekan}`).catch(() => null) : null;
  const saya = (modeDepan ? d.saya_depan : pekanIni ? d.saya : []) || [];
  const st = d.stat;
  const kamu = guru ? 'Anda' : 'kamu';
  const sisaKuota = d.maks_juz > 0 ? Math.max(0, d.maks_juz - saya.length) : Infinity;

  // jumlah pengambilan & tuntas per juz
  const ambil = Array(31).fill(0), tuntas = Array(31).fill(0);
  for (const x of d.peta) { ambil[x.juz]++; if (x.selesai_pada) tuntas[x.juz]++; }
  const minAmbil = Math.min(...ambil.slice(1));
  const tersedia = (j) => !d.juz_unik || ambil[j] === minAmbil;

  const kartuJuzSaya = (pl) => {
    const perHari = pl.halaman_berikut ? Math.ceil((pl.total - pl.dibaca) / Math.max(1, d.sisa_hari)) : 0;
    return `<div class="owoj-item ${pl.selesai_pada ? 'selesai' : ''}">
      <div class="row spread"><div><b>Juz ${pl.juz}</b> <span class="badge ${pl.putaran > 1 ? 'emas' : 'hijau'}">Putaran ${pl.putaran}</span>
        <div class="tiny muted">Hlm ${pl.awal}–${pl.akhir} · ${pl.total} halaman · ${esc(surahDiHalaman(pl.awal)[1])}</div></div>
        <div class="owoj-angka kecil">${pl.selesai_pada ? '✓' : pl.persen + '%'}</div></div>
      <div class="progress" style="margin:8px 0 4px"><i style="width:${pl.persen}%"></i></div>
      <div class="small">${pl.selesai_pada ? `🎉 Tuntas · +${d.poin} poin` : modeDepan ? 'Bisa dibaca saat pekan depan tiba.' : `${pl.dibaca}/${pl.total} hlm · saran <b>${perHari} hlm/hari</b>`}</div>
      <div class="row" style="margin-top:8px;gap:6px">
        ${!modeDepan && pekanIni && !pl.selesai_pada ? `<a class="btn kecil" href="#/owoj/baca/${pl.id}">📖 ${pl.dibaca ? 'Lanjut baca' : 'Mulai baca'}</a>` : ''}
        ${!modeDepan && pekanIni && !pl.selesai_pada && d.izin_cetak ? `<button class="btn putih kecil" onclick="laporCetak('owoj', ${pl.id})">📗 Lapor mushaf cetak</button>` : ''}
        ${!pl.dibaca ? `<button class="btn putih kecil" data-batal="${pl.id}">Batalkan</button>` : ''}
      </div></div>`;
  };

  const kartuSaya = !bisaPilih ? '' : `
    <div class="card owoj-saya">
      <div class="row spread"><h3 style="margin:0">Juz ${guru ? 'saya' : 'saya'} ${modeDepan ? 'pekan depan' : 'pekan ini'} (${saya.length})</h3>
        <span class="tiny muted">${d.maks_juz > 0 ? `maks. ${d.maks_juz} juz/orang` : 'tanpa batas juz'}</span></div>
      ${saya.length ? `<div class="owoj-daftar">${saya.map(kartuJuzSaya).join('')}</div>` : `<p class="small muted" style="margin:8px 0 0">${guru ? 'Anda' : 'Kamu'} belum memilih juz. Ketuk juz yang tersedia pada peta di bawah.</p>`}
      ${saya.length && sisaKuota > 0 ? `<p class="tiny muted" style="margin:8px 0 0">➕ ${guru ? 'Anda' : 'Kamu'} masih bisa menambah ${sisaKuota === Infinity ? '' : sisaKuota + ' '}juz lagi — ketuk juz di peta.</p>` : ''}
    </div>`;

  const peserta = (j) => d.peta.filter((x) => x.juz === j);
  const grid = Array.from({ length: 30 }, (_, i) => {
    const j = i + 1;
    const ps = peserta(j).filter((x) => x.putaran >= st.putaran || (!d.juz_unik && !x.selesai_pada)); // hanya putaran berjalan
    const milikSaya = saya.some((x) => x.juz === j && !x.selesai_pada);
    const bisa = bisaPilih && tersedia(j) && sisaKuota > 0 && !milikSaya;
    const akhir = ps[ps.length - 1];
    const progres = akhir ? Math.round((akhir.dibaca / akhir.total) * 100) : 0;
    const selesai = ps.some((x) => x.selesai_pada);
    const cls = milikSaya ? 'saya' : selesai ? 'tuntas' : ps.length ? 'diambil' : 'kosong';
    return `<button class="juz-tile ${cls}" data-juz="${j}" ${bisa ? '' : 'data-kunci="1"'}>
      <b>Juz ${j}</b>${ambil[j] > 1 ? `<span class="putaran-badge" title="diambil ${ambil[j]}× pekan ini">${ambil[j]}×</span>` : ''}
      <span class="nm">${ps.length ? esc(ps.map((x) => x.nama.split(' ')[0]).slice(-2).join(', ')) : (bisaPilih ? 'Tersedia' : '—')}</span>
      ${ps.length ? `<span class="bar-mini"><i style="width:${progres}%"></i></span>` : ''}
      ${selesai ? '<span class="cek">✓</span>' : ''}
    </button>`;
  }).join('');

  const tabelGuru = rekap ? `
    <div class="card"><div class="row spread"><h3 style="margin:0">Peserta ${esc(d.kelompok?.nama || '')}</h3><button class="btn sec kecil" id="owoj-csv">⬇ CSV</button></div>
    <div class="small muted" style="margin:4px 0 10px">${rekap.siswa.filter((s) => s.pilihan.length).length}/${rekap.siswa.length} siswa ikut · ${rekap.siswa.reduce((n, s) => n + s.pilihan.filter((x) => x.selesai_pada).length, 0)} juz tuntas</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nama</th><th>Juz dipilih</th><th>Tuntas</th></tr></thead><tbody>
    ${rekap.siswa.map((s) => `<tr><td><b>${esc(s.nama)}</b></td><td>${s.pilihan.length ? s.pilihan.map((x) => `<span class="badge ${x.selesai_pada ? 'hijau' : x.dibaca ? 'emas' : 'biru'}" title="putaran ${x.putaran}: ${x.dibaca}/${x.total} hlm">Juz ${x.juz}${x.selesai_pada ? ' ✓' : ` · ${x.dibaca}/${x.total}`}</span>`).join(' ') : '<span class="badge merah">Belum memilih</span>'}</td>
      <td>${s.pilihan.filter((x) => x.selesai_pada).length}</td></tr>`).join('')}
    ${rekap.guru.map((g) => `<tr><td><b>${esc(g.nama)}</b> <span class="badge biru">guru</span></td><td><span class="badge ${g.selesai_pada ? 'hijau' : 'emas'}">Juz ${g.juz}${g.selesai_pada ? ' ✓' : ` · ${g.dibaca}/${g.total}`}</span></td><td>${g.selesai_pada ? 1 : 0}</td></tr>`).join('')}
    </tbody></table></div></div>` : '';

  const daftarPeserta = !rekap && d.peta.length ? `<div class="card"><h3>Peserta ${modeDepan ? 'pekan depan' : 'pekan ini'} (${new Set(d.peta.map((x) => x.user_id)).size} orang · ${d.peta.length} juz)</h3>
    ${d.peta.map((x) => `<div class="row spread" style="padding:8px 0;border-bottom:1px solid #f0ede4"><div><b>${esc(x.nama)}</b> ${x.peran !== 'siswa' ? '<span class="badge biru">guru</span>' : ''}
      <div class="tiny muted">Juz ${x.juz} · putaran ${x.putaran}${d.cakupan === 'sekolah' && x.kelompok_nama ? ' · ' + esc(x.kelompok_nama) : ''}</div></div>
      <div style="width:120px;text-align:right">${statusPilihan(x)}<div class="bar-mini"><i style="width:${Math.round((x.dibaca / x.total) * 100)}%"></i></div></div></div>`).join('')}</div>` : '';

  shell(`
    <div class="row spread"><div><h1 style="margin:0">OWOJ</h1><div class="small muted">One Week One Juz · khatam bersama setiap pekan</div></div>
      ${guru && d.kelompok_saya.length ? `<select class="input" id="owoj-k" style="width:auto">${d.kelompok_saya.map((k) => `<option value="${k.id}" ${k.id === d.kelompok_id ? 'selected' : ''}>${esc(k.nama)}</option>`).join('')}</select>` : ''}</div>
    ${!d.aktif ? '<div class="alert info" style="margin-top:12px">Program OWOJ sedang tidak aktif.</div>' : ''}
    <div class="tabs" style="margin:14px 0 0"><button id="tab-ini" class="${modeDepan ? '' : 'aktif'}">Pekan ini</button><button id="tab-depan" class="${modeDepan ? 'aktif' : ''}">Pekan depan${d.saya_depan.length ? ` (${d.saya_depan.length})` : ''}</button></div>
    <div class="owoj-hero">
      <div class="row spread"><div><div class="small" style="opacity:.85">${modeDepan ? 'Pekan depan' : pekanIni ? 'Pekan ini' : 'Pekan'}</div><b style="font-size:1.1rem">${rentangPekan(d)}</b></div>
        <div style="text-align:right">${pekanIni ? `<b style="font-size:1.6rem">${d.sisa_hari}</b><div class="tiny">hari lagi</div>` : ''}</div></div>
      <div class="owoj-khatam"><span>🏆 ${teksKhatam(st.khatam)}</span><small>${d.cakupan === 'sekolah' ? 'semua peserta' : esc(d.kelompok?.nama || '')} · pekan ${tglIndo(d.pekan, false)} – ${tglIndo(d.akhir, false)}</small></div>
      <div class="row spread" style="margin-top:10px"><span class="small">Menuju khatam ke-${st.khatam + 1} (putaran ${st.khatam + 1})</span><b>${st.tuntas_putaran}/30 juz tuntas</b></div>
      <div class="progress owoj-prog"><i style="width:${(st.tuntas_putaran / 30) * 100}%"></i></div>
      <div class="tiny" style="opacity:.9;margin-top:4px">Pemilihan juz sedang di <b>putaran ${st.putaran}</b>: ${st.diambil_putaran} juz sudah diambil, ${30 - st.diambil_putaran} juz tersedia${d.juz_unik ? '' : ' (juz boleh dipilih bersamaan)'}.</div>
      <div class="row ${modeDepan ? 'hidden' : ''}" style="margin-top:10px;gap:6px"><button class="btn putih kecil" id="pk-prev">‹ Pekan lalu</button>${!pekanIni ? '<button class="btn putih kecil" id="pk-now">Pekan ini</button>' : ''}${!pekanIni ? '<button class="btn putih kecil" id="pk-next">Pekan berikutnya ›</button>' : ''}</div>
    </div>
    ${kartuSaya}
    <div class="card"><div class="row spread"><h3 style="margin:0">Peta Juz</h3>
      <span class="tiny muted">${d.cakupan === 'sekolah' ? 'Satu peta untuk semua murid & guru' : 'Peta per kelompok'}</span></div>
      <div class="legend" style="margin:6px 0 10px"><span><i style="background:#fff;border:1px solid var(--garis)"></i>Tersedia (putaran ${st.putaran})</span><span><i style="background:var(--kuning-muda)"></i>Sudah diambil</span><span><i style="background:var(--hijau-muda)"></i>Tuntas</span><span><i style="background:var(--hijau)"></i>Juz saya</span><span><b>2×</b> = diambil 2 kali</span></div>
      <div class="juz-grid">${grid}</div>
      <p class="tiny muted" style="margin-bottom:0">Sistem putaran: setelah ke-30 juz diambil, semua juz terbuka lagi untuk putaran berikutnya. Setiap putaran yang 30 juznya tuntas = 1× khatam.</p></div>
    ${tabelGuru}${daftarPeserta}
    ${d.riwayat.length ? `<div class="card"><h3>Riwayat OWOJ ${guru ? 'saya' : 'saya'}</h3><div class="tbl-wrap"><table class="tbl"><tbody>
      ${d.riwayat.map((r) => `<tr><td>${tglIndo(r.pekan, false)}</td><td>Juz ${r.juz} <span class="tiny muted">putaran ${r.putaran || 1}</span></td><td>${r.selesai_pada ? '<span class="badge hijau">Tuntas</span>' : r.pekan >= d.pekan_ini ? `<span class="badge emas">${r.dibaca} hlm</span>` : `<span class="badge merah">Tidak tuntas (${r.dibaca} hlm)</span>`}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    ${d.ringkas.length ? `<div class="card"><h3>Rekap khatam per pekan</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pekan</th><th>Peserta</th><th>Juz tuntas</th><th>Khatam</th></tr></thead><tbody>
      ${d.ringkas.map((r) => `<tr><td>${tglIndo(r.pekan, false)} – ${tglIndo(tambahTgl(r.pekan, 6), false)}</td><td>${r.peserta} orang</td><td>${r.tuntas} juz</td><td><b>${r.khatam ? `${r.khatam}× 🎉` : '-'}</b></td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    <p class="tiny muted">Setiap juz OWOJ yang tuntas dalam pekannya mendapat ${d.poin} poin.</p>`);

  $$('.juz-tile').forEach((b) => (b.onclick = async () => {
    const j = +b.dataset.juz;
    if (b.dataset.kunci) {
      const ps = peserta(j);
      if (saya.some((x) => x.juz === j && !x.selesai_pada)) return toast(`Juz ${j} sudah ada di daftar ${kamu}`);
      if (!bisaPilih) return toast('Hanya bisa memilih juz untuk pekan ini atau pekan depan');
      if (sisaKuota <= 0) return toast(`Batas ${d.maks_juz} juz per pekan sudah tercapai`, true);
      return toast((ps.length ? ps.map((x) => `${x.nama}: ${x.selesai_pada ? 'tuntas' : x.dibaca + '/' + x.total + ' hlm'}`).join(' · ') + '. ' : '') + `Juz ${j} baru bisa diambil lagi pada putaran berikutnya.`);
    }
    const r = halJuzUI(j);
    if (!confirm(`Ambil Juz ${j} (hlm ${r[1]}–${r[2]}, ${r[2] - r[1] + 1} halaman) untuk ${modeDepan ? 'pekan depan' : 'pekan ini'}${ambil[j] ? ` — putaran ke-${ambil[j] + 1}` : ''}?`)) return;
    await coba(() => api('/owoj/pilih', { method: 'POST', body: { juz: j, kelompok_id: d.kelompok_id, untuk: modeDepan ? 'depan' : 'ini' } }), modeDepan ? `Juz ${j} dipesan untuk pekan depan.` : `Juz ${j} ditambahkan. Selamat membaca!`);
    viewOwoj();
  }));
  $$('[data-batal]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Batalkan pilihan juz ini?')) return;
    await coba(() => api('/owoj/batal', { method: 'POST', body: { id: +b.dataset.batal } }), 'Pilihan dibatalkan'); viewOwoj();
  }));
  $('#tab-ini').onclick = () => { sessionStorage.removeItem('owoj_mode'); viewOwoj(); };
  $('#tab-depan').onclick = () => { sessionStorage.setItem('owoj_mode', 'depan'); sessionStorage.removeItem('owoj_pekan'); viewOwoj(); };
  const sk = $('#owoj-k'); if (sk) sk.onchange = () => { sessionStorage.setItem('owoj_k', sk.value); viewOwoj(); };
  const geser = (n) => { sessionStorage.setItem('owoj_pekan', tambahTgl(d.pekan, n)); viewOwoj(); };
  $('#pk-prev').onclick = () => geser(-7);
  const pn = $('#pk-next'); if (pn) pn.onclick = () => { if (d.akhir >= d.pekan_ini) { sessionStorage.removeItem('owoj_pekan'); viewOwoj(); } else geser(7); };
  const pw = $('#pk-now'); if (pw) pw.onclick = () => { sessionStorage.removeItem('owoj_pekan'); viewOwoj(); };
  const cv = $('#owoj-csv'); if (cv) cv.onclick = () => unduhCSV(`owoj-${d.kelompok?.nama || ''}-${d.pekan}.csv`, [['Nama', 'NIS', 'Juz', 'Putaran', 'Halaman dibaca', 'Total halaman', 'Status'],
    ...rekap.siswa.flatMap((s) => s.pilihan.length ? s.pilihan.map((x) => [s.nama, s.nis || '', x.juz, x.putaran, x.dibaca, x.total, x.selesai_pada ? 'Tuntas' : 'Belum tuntas']) : [[s.nama, s.nis || '', '', '', '', '', 'Belum memilih']])]);
}
const halJuzUI = (j) => S.meta.juz[j - 1];
const tambahTgl = (t, n) => { const x = new Date(t + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

let timerOwoj = null;
async function viewOwojBaca(id) {
  memuat();
  await muatMeta();
  const d = await api('/owoj');
  const pl = id ? d.saya.find((x) => x.id === id) : d.saya.find((x) => x.halaman_berikut);
  if (!pl) { location.hash = '#/owoj'; return; }
  await renderOwojBaca(pl, d.min_detik, d.sisa_hari);
}
async function renderOwojBaca(pl, minDetik, sisaHari) {
  clearInterval(timerOwoj);
  if (!pl.halaman_berikut) {
    shell(`<div class="card selebrasi"><div class="emo">🎉</div><h2>Juz ${pl.juz} tuntas!</h2><p>Alhamdulillah, bacaan OWOJ juz ini selesai.</p><a class="btn" href="#/owoj">Lihat peta juz</a></div>`);
    return;
  }
  const n = pl.halaman_berikut;
  const d = await muatHalaman(n);
  muatHalaman(Math.min(TOTAL, n + 1)).catch(() => {});
  const main = shell(`
    ${barPembaca(n)}
    <div class="owoj-pita">OWOJ · Juz ${pl.juz} (putaran ${pl.putaran}) · halaman ke-${pl.dibaca + 1} dari ${pl.total}</div>
    <article class="mushaf"><div class="isi-hlm"></div><div class="hlm-no">— ${angkaArab(n)} —</div><div class="legenda-wrap"></div></article>
    <div class="aksi-baca"><div class="panel">
      <div class="ket"><b>OWOJ Juz ${pl.juz}: ${pl.dibaca}/${pl.total} hlm</b>
        <span class="muted">Sisa ${pl.total - pl.dibaca} hlm · ${sisaHari} hari lagi</span>
        <div class="progress" style="margin-top:6px"><i style="width:${pl.persen}%"></i></div></div>
      <button class="btn besar emas" id="btn-owoj" disabled>✓ Selesai</button>
    </div></div>
    <div class="row" style="justify-content:center;margin-top:4px">
      ${pl.dibaca ? '<button class="btn putih kecil" id="owoj-undo">↩ Batalkan tanda terakhir</button>' : ''}
      <a class="btn putih kecil" href="#/owoj">Peta juz</a></div>`);
  main.style.paddingTop = '0';
  pasangBarPembaca(main, d);
  const btn = $('#btn-owoj');
  let sisa = minDetik;
  const tick = () => {
    if (sisa <= 0) { btn.disabled = false; btn.textContent = `✓ Selesai hlm ${n}`; clearInterval(timerOwoj); return; }
    btn.textContent = `⏳ ${sisa} dtk`; sisa--;
  };
  tick(); timerOwoj = setInterval(tick, 1000);
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Menyimpan…';
    try {
      const r = await api('/owoj/baca', { method: 'POST', body: { id: pl.id, halaman: n } });
      if (r.tuntas) modal(`<div class="selebrasi"><div class="emo">🌟📖🌟</div><h2>Juz ${pl.juz} tuntas!</h2><p>Masya Allah, +${r.poin} poin.</p><a class="btn" href="#/owoj" data-tutup>Lihat peta juz</a></div>`);
      else toast(`Halaman ${n} tercatat ✓`);
      await renderOwojBaca(r.saya, minDetik, sisaHari);
    } catch (e) {
      toast(e.message, true);
      const m = e.message.match(/Tunggu (\d+) detik/);
      sisa = m ? parseInt(m[1]) : 0; clearInterval(timerOwoj); tick(); timerOwoj = setInterval(tick, 1000);
    }
  };
  const u = $('#owoj-undo');
  if (u) u.onclick = async () => { if (!confirm('Batalkan tanda halaman terakhir?')) return; await coba(() => api('/owoj/batal-baca', { method: 'POST', body: { id: pl.id } }), 'Dibatalkan'); viewOwojBaca(pl.id); };
}

// =========================================================
//  LAPOR BACA DARI MUSHAF CETAK (offline)
// =========================================================
async function laporCetak(jenisAwal = 'tadarus', pilihanId = null) {
  await muatMeta();
  const [st, ow] = await Promise.all([api('/saya/status?riwayat=1'), api('/owoj').catch(() => null)]);
  const daftarPl = ow && ow.aktif ? ow.saya.filter((x) => x.halaman_berikut) : [];
  const pl = daftarPl.find((x) => x.id === pilihanId) || daftarPl[0] || null;
  const jenis = pl && jenisAwal === 'owoj' ? 'owoj' : 'tadarus';
  const hi = hariIni();
  const kmrn = new Date(Date.now() + 7 * 3600e3 - 864e5).toISOString().slice(0, 10);
  modal(`<h2>📗 Lapor baca mushaf cetak</h2>
    <p class="small muted">Untuk bacaan yang dilakukan langsung dari mushaf Al-Qur'an cetak (tidak lewat aplikasi). Laporan tercatat dengan tanda <b>"Mushaf cetak"</b> dan dapat dilihat oleh guru.</p>
    <form id="f-cetak">
      <div class="field"><label>Jenis bacaan</label>
        <label class="row small" style="gap:6px;margin-bottom:6px"><input type="radio" name="jenis" value="tadarus" ${jenis === 'tadarus' ? 'checked' : ''}> Tadarus harian — lanjut dari <b>hlm ${st.halaman_berikut}</b> (${esc(surahDiHalaman(st.halaman_berikut)[1])})</label>
        ${daftarPl.map((x) => `<label class="row small" style="gap:6px;margin-bottom:6px"><input type="radio" name="jenis" value="owoj:${x.id}" ${jenis === 'owoj' && x.id === pl.id ? 'checked' : ''}> OWOJ Juz ${x.juz} — lanjut dari <b>hlm ${x.halaman_berikut}</b> (sisa ${x.total - x.dibaca} hlm)</label>`).join('')}
      </div>
      <div class="grid g2">
        <div class="field"><label>Jumlah halaman dibaca</label><input class="input" type="number" name="jumlah" min="1" max="100" value="${Math.max(1, st.sisa_hari_ini || 2)}" required></div>
        <div class="field"><label>Tanggal membaca</label><select class="input" name="tanggal"><option value="${hi}">Hari ini (${tglIndo(hi, false)})</option><option value="${kmrn}">Kemarin (${tglIndo(kmrn, false)})</option></select></div>
      </div>
      <div class="alert info small" id="ket-cetak" style="display:block"></div>
      <label class="row small" style="gap:8px;align-items:flex-start;margin:6px 0 14px"><input type="checkbox" name="pernyataan" required style="margin-top:3px">
        <span>Saya menyatakan dengan jujur bahwa saya benar-benar telah membaca halaman tersebut dari mushaf Al-Qur'an cetak. <i>Allah Maha Melihat.</i></span></label>
      <div class="row"><button class="btn">Kirim laporan</button><button type="button" class="btn sec" data-tutup>Batal</button></div>
    </form>`, (m) => {
    const f = $('#f-cetak', m);
    const ket = () => {
      const j = f.jenis.value, n = Math.max(1, parseInt(f.jumlah.value || 1));
      const px = j.startsWith('owoj:') ? daftarPl.find((x) => x.id === +j.slice(5)) : null;
      const dari = px ? px.halaman_berikut : st.halaman_berikut;
      const sampai = px ? Math.min(px.akhir, dari + n - 1) : ((dari + n - 2) % 604) + 1;
      $('#ket-cetak', m).innerHTML = `Akan dicatat: <b>halaman ${dari} – ${sampai}</b> (${esc(surahDiHalaman(dari)[1])} s.d. ${esc(surahDiHalaman(sampai)[1])}). Pastikan sesuai dengan halaman mushaf cetak yang dibaca (mushaf standar 604 halaman / pojok).`;
    };
    ket(); f.oninput = ket; f.onchange = ket;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const jv = f.jenis.value;
      const r = await coba(() => api('/saya/cetak', { method: 'POST', body: { jenis: jv.startsWith('owoj') ? 'owoj' : 'tadarus', pilihan_id: jv.startsWith('owoj:') ? +jv.slice(5) : null, jumlah: parseInt(f.jumlah.value), tanggal: f.tanggal.value, pernyataan: f.pernyataan.checked } }));
      tutupModal();
      toast(`Laporan tercatat: ${r.dicatat} halaman (hlm ${r.dari}–${r.sampai}) ✓`);
      if (r.tuntas) toast(`Masya Allah, Juz ${r.juz} tuntas! 🎉`);
      router();
    };
  });
}
window.laporCetak = laporCetak;

// =========================================================
//  GABUNG KELOMPOK DENGAN KODE
// =========================================================
async function viewGabung(kode) {
  sessionStorage.removeItem('kode_gabung');
  if (S.me.user.peran !== 'siswa') { shell(`<div class="card kosong">Tautan gabung hanya untuk akun murid/santri.<br><br><a class="btn" href="#/">Kembali</a></div>`); return; }
  memuat();
  let k;
  try { k = await api('/gabung?kode=' + encodeURIComponent(kode)); }
  catch (e) { shell(`<div class="card kosong">⚠️ ${esc(e.message)}<br><br><a class="btn" href="#/akun">Coba kode lain</a></div>`); return; }
  shell(`<div class="card selebrasi" style="max-width:480px;margin:20px auto">
    <div class="emo">👥</div><h2>Gabung kelompok ${esc(k.nama)}?</h2>
    <p>Guru pembimbing: <b>${esc(k.guru_nama || '-')}</b><br>Target tadarus: <b>${k.target} halaman/hari</b></p>
    ${k.sudah_anggota ? '<div class="alert sukses">Kamu sudah menjadi anggota kelompok ini.</div><a class="btn" href="#/">Ke beranda</a>' : `
    ${S.me.kelompok ? `<div class="alert peringatan small">Kamu akan pindah dari kelompok <b>${esc(S.me.kelompok.nama)}</b>. Riwayat bacaan dan poinmu tetap tersimpan.</div>` : ''}
    <div class="row" style="justify-content:center"><button class="btn" id="ya-gabung">Ya, gabung</button><a class="btn sec" href="#/">Batal</a></div>`}
  </div>`);
  const b = $('#ya-gabung');
  if (b) b.onclick = async () => {
    b.disabled = true;
    const r = await coba(() => api('/gabung', { method: 'POST', body: { kode } }));
    await muatSaya();
    toast(`Alhamdulillah, kamu sudah bergabung di ${r.kelompok} ✓`);
    location.hash = '#/';
  };
}

// =========================================================
//  ROUTER
// =========================================================
async function router() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/gabung/')) sessionStorage.setItem('kode_gabung', decodeURIComponent(hash.slice(9)));
  if (!S.token) return viewLogin();
  try {
    if (!S.me) await muatSaya();
  } catch { return; }
  tutupModal();
  clearInterval(timerBaca); clearInterval(timerOwoj);
  const u = S.me.user;
  if (u.wajib_ganti_pw && hash !== '#/akun') { location.hash = '#/akun'; return; }
  const m = (re) => hash.match(re);
  let r;
  try {
    if ((r = m(/^#\/gabung\/(.+)/))) return await viewGabung(decodeURIComponent(r[1]));
    if (hash === '#/akun') return viewAkun();
    if ((r = m(/^#\/owoj\/baca(?:\/(\d+))?/))) return await viewOwojBaca(r[1] ? parseInt(r[1]) : null);
    if (hash === '#/owoj') return await viewOwoj();
    if ((r = m(/^#\/mushaf\/(\d+)/))) return await viewMushafHalaman(parseInt(r[1]));
    if (hash.startsWith('#/mushaf')) return await viewMushafIndeks();
    if (u.peran === 'guru' || u.peran === 'admin') {
      if (hash === '#/saya') return await viewBerandaSiswa();
      if (hash === '#/baca') return await viewBaca();
      if (hash === '#/riwayat') return await viewRiwayat();
    }
    if (u.peran === 'siswa') {
      if (hash === '#/baca') return await viewBaca();
      if (hash === '#/riwayat') return await viewRiwayat();
      if (hash === '#/peringkat') return await viewPeringkat();
      return await viewBerandaSiswa();
    }
    if ((r = m(/^#\/k\/(\d+)(?:\/(\w+))?/))) return await viewKelompok(parseInt(r[1]), r[2] || 'rekap');
    if ((r = m(/^#\/s\/(\d+)/))) return await viewSiswaDetail(parseInt(r[1]));
    if (u.peran === 'admin') {
      if (hash === '#/kelompok') return await viewAdminKelompok();
      if (hash === '#/pengguna') return await viewPengguna();
      if (hash === '#/libur') return await viewLiburAdmin();
      if (hash === '#/pengaturan') return await viewPengaturan();
      return await viewDasborAdmin();
    }
    return await viewDaftarKelompok();
  } catch (e) {
    console.error(e);
    if (S.token) shell(`<div class="card kosong">⚠️ ${esc(e.message)}<br><br><button class="btn" onclick="router()">Coba lagi</button></div>`);
  }
}
window.addEventListener('hashchange', router);
window.aktifkanNotif = aktifkanNotif;
window.router = router;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
    reg.active?.postMessage('cek-pengingat');
  }).catch(() => {});
}
router();
