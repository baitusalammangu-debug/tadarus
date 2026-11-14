/* =========================================================
   PEWARNAAN TAJWID OTOMATIS untuk teks Al-Qur'an Kemenag RI
   (Mushaf Standar Indonesia). Berbasis kaidah, bukan data manual.
   ========================================================= */
(function (root) {
  'use strict';
  const FATHATAN = 'ً', DAMMATAN = 'ٌ', KASRATAN = 'ٍ';
  const FATHAH = 'َ', DAMMAH = 'ُ', KASRAH = 'ِ';
  const SYADDAH = 'ّ', SUKUN = 'ْ';
  const MADDAH = 'ٓ';        // Kemenag: mad jaiz munfasil
  const MADDA_KECIL = 'ۤ';   // Kemenag: mad wajib muttasil / mad lazim
  const MIM_IQLAB = 'ۢ';     // mim kecil tanda iqlab
  const TANWIN = FATHATAN + DAMMATAN + KASRATAN;
  const VOKAL = FATHAH + DAMMAH + KASRAH + TANWIN + 'ٖٗ';
  // tanda waqaf, rubu', sajdah, ruku' — tidak dibaca
  const WAQAF = 'ۖۗۘۙۚۛۜ۞۩ࣖ۝';

  const HALQI = 'ءأإؤئهعحغخ';
  const IDGHAM_GHUNNAH = 'ينمو';
  const IDGHAM_BILA = 'لر';
  const IKHFA = 'تثجدذزسشصضطظفقك';
  const QALQALAH = 'قطبجد';
  const SYAMSIYAH = 'تثدذرزسشصضطظلن';

  const isMark = (ch) => {
    const c = ch.codePointAt(0);
    return (c >= 0x064B && c <= 0x065F) || c === 0x0670 || (c >= 0x06D6 && c <= 0x06ED && c !== 0x06DE && c !== 0x06E5 && c !== 0x06E6 && c !== 0x06E9) || (c >= 0x08D3 && c <= 0x08FF);
  };

  // pecah teks menjadi klaster: {b: huruf dasar, m: tanda-tanda, t: teks utuh, w: indeks kata}
  function klaster(teks) {
    const out = [];
    let w = 0;
    for (const ch of teks) {
      if (ch === ' ') { out.push({ spasi: true, t: ch }); w++; continue; }
      if (isMark(ch) && out.length && !out[out.length - 1].spasi) {
        const k = out[out.length - 1]; k.m += ch; k.t += ch; continue;
      }
      out.push({ b: isMark(ch) ? '' : ch, m: isMark(ch) ? ch : '', t: ch, w });
    }
    return out;
  }
  // klaster yang tidak dibaca (tanda waqaf berdiri sendiri, placeholder 'ە', tanda tanpa huruf)
  const abaikan = (k) => k.spasi || k.b === '' || k.b === 'ە' || WAQAF.includes(k.b);
  const punya = (k, s) => [...s].some((c) => k.m.includes(c));
  const tanpaHarakat = (k) => !punya(k, VOKAL + SUKUN + SYADDAH + 'ٰ');

  function tandai(teks) {
    const K = klaster(teks);
    const n = K.length;
    const rule = new Array(n).fill(null);
    const set = (i, r, timpa = false) => { if (i >= 0 && i < n && (timpa || !rule[i])) rule[i] = r; };

    // huruf berikutnya yang dibaca setelah indeks i (melewati huruf diam pada kata yang sama, spasi & tanda waqaf)
    const berikut = (i) => {
      const w = K[i].w;
      let j = i + 1;
      while (j < n && !K[j].spasi && K[j].w === w && (abaikan(K[j]) || tanpaHarakat(K[j]))) j++; // alif/ya diam setelah tanwin, dsb.
      while (j < n && abaikan(K[j])) j++;
      return j < n ? j : -1;
    };
    const iqlabSetelah = (i) => { // mim kecil iqlab bisa menempel atau berdiri sendiri setelah spasi
      for (let j = i; j < Math.min(n, i + 4); j++) if (K[j].m && K[j].m.includes(MIM_IQLAB)) return true;
      return false;
    };
    const akhirAyat = (i) => { for (let j = i + 1; j < n; j++) if (!abaikan(K[j])) return false; return true; };

    for (let i = 0; i < n; i++) {
      const k = K[i];
      if (abaikan(k)) continue;
      const b = k.b;

      // ---- lam syamsiyah: ال + huruf syamsiyah bertasydid (kecuali lafaz Allah)
      if (b === 'ل' && tanpaHarakat(k) && i > 0 && K[i - 1].b === 'ا' && (i < 2 || K[i - 2].spasi || ['و', 'ف', 'ب', 'ك'].includes(K[i - 2].b))) {
        const nx = K[i + 1];
        if (nx && SYAMSIYAH.includes(nx.b) && nx.m.includes(SYADDAH) && !(nx.b === 'ل' && nx.m.includes('ٰ')) && !(nx.b === 'ل' && K[i + 2] && K[i + 2].b === 'ه' && nx.m.includes(SYADDAH) && /[َٰ]/.test(nx.m))) {
          set(i, 'syamsiyah');
        }
      }

      // ---- nun sukun / tanwin
      const isTanwin = punya(k, TANWIN);
      const isNunSukun = b === 'ن' && (k.m.includes(SUKUN) || k.m.includes(MIM_IQLAB)) && !punya(k, VOKAL + SYADDAH);
      if (isTanwin || isNunSukun) {
        if (iqlabSetelah(i)) { set(i, 'iqlab', true); const j = berikut(i); if (j > 0 && K[j].b === 'ب') set(j, 'iqlab', true); continue; }
        const j = berikut(i);
        if (j < 0) continue; // akhir ayat → dibaca waqaf
        const h = K[j];
        const lainKata = h.w !== k.w;
        if (h.b === 'ا' && tanpaHarakat(h)) continue;          // hamzah washal → nun washal (idzhar)
        if (HALQI.includes(h.b) || (h.b === 'ا' && !tanpaHarakat(h))) continue; // idzhar halqi
        if (IDGHAM_GHUNNAH.includes(h.b)) {
          if (lainKata && h.m.includes(SYADDAH)) { set(i, 'idgham-g', true); set(j, 'idgham-g', true); }
          continue; // dalam satu kata = idzhar wajib
        }
        if (IDGHAM_BILA.includes(h.b)) { if (lainKata && h.m.includes(SYADDAH)) { set(i, 'idgham-b', true); set(j, 'idgham-b', true); } continue; }
        if (h.b === 'ب') { set(i, 'iqlab', true); set(j, 'iqlab', true); continue; }
        if (IKHFA.includes(h.b)) { set(i, 'ikhfa', true); set(j, 'ikhfa', true); continue; }
        continue;
      }

      // ---- mim sukun
      if (b === 'م' && k.m.includes(SUKUN) && !punya(k, VOKAL)) {
        const j = berikut(i);
        if (j > 0) {
          if (K[j].b === 'ب') { set(i, 'ikhfa-s', true); set(j, 'ikhfa-s', true); }
          else if (K[j].b === 'م' && K[j].m.includes(SYADDAH)) { set(i, 'idgham-m', true); set(j, 'idgham-m', true); }
        }
      }

      // ---- ghunnah musyaddadah: nun / mim bertasydid
      if ((b === 'ن' || b === 'م') && k.m.includes(SYADDAH)) set(i, 'ghunnah');

      // ---- qalqalah
      if (QALQALAH.includes(b)) {
        if (k.m.includes(SUKUN)) set(i, 'qalqalah');
        else if (akhirAyat(i) && !k.m.includes(SYADDAH)) set(i, 'qalqalah-k');
      }

      // ---- mad far'i
      if (k.m.includes(MADDA_KECIL) || k.m.includes(MADDAH)) {
        let r;
        if (k.m.includes(MADDAH)) r = 'mad-jaiz';
        else {
          // huruf setelahnya bertasydid/sukun → mad lazim, selainnya (hamzah) → mad wajib
          const j = i + 1 < n && !K[i + 1].spasi ? i + 1 : -1;
          const nx = j > 0 ? K[j] : null;
          r = nx && (nx.m.includes(SYADDAH) || nx.m.includes(SUKUN) || nx.m.includes(MADDA_KECIL)) ? 'mad-lazim' : (nx ? 'mad-wajib' : 'mad-lazim');
        }
        set(i, r, true);
        if (i > 0 && !K[i - 1].spasi && !abaikan(K[i - 1])) set(i - 1, r, true); // huruf sebelum huruf mad
      }
    }
    return { K, rule };
  }

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // hasil HTML: klaster berurutan dengan kaidah sama digabung dalam satu <span>
  function html(teks) {
    const { K, rule } = tandai(teks);
    let out = '', cur = null, buf = '';
    const tutup = () => { if (!buf) return; out += cur ? `<span class="tj tj-${cur}" data-tj="${cur}">${buf}</span>` : buf; buf = ''; };
    K.forEach((k, i) => {
      const r = k.spasi ? null : rule[i];
      if (r !== cur) { tutup(); cur = r; }
      buf += esc(k.t);
    });
    tutup();
    return out;
  }

  const INFO = {
    'ghunnah': ['Ghunnah', 'Nun atau mim bertasydid (نّ / مّ). Dibaca mendengung ±2–3 harakat.'],
    'ikhfa': ["Ikhfa' Haqiqi", "Nun sukun/tanwin bertemu salah satu dari 15 huruf ikhfa (ت ث ج د ذ ز س ش ص ض ط ظ ف ق ك). Dibaca samar antara idzhar dan idgham, disertai dengung."],
    'idgham-g': ['Idgham Bighunnah', 'Nun sukun/tanwin bertemu ي ن م و (pada kata berbeda). Dimasukkan ke huruf berikutnya dengan dengung.'],
    'idgham-b': ['Idgham Bilaghunnah', 'Nun sukun/tanwin bertemu ل atau ر. Dimasukkan ke huruf berikutnya tanpa dengung.'],
    'iqlab': ['Iqlab', 'Nun sukun/tanwin bertemu ب. Bunyi nun diganti mim (tanda mim kecil ۢ) disertai dengung.'],
    'ikhfa-s': ["Ikhfa' Syafawi", 'Mim sukun bertemu ب. Mim dibaca samar di bibir disertai dengung.'],
    'idgham-m': ['Idgham Mimi (Mitslain)', 'Mim sukun bertemu م. Dimasukkan dengan dengung.'],
    'qalqalah': ['Qalqalah Sughra', 'Huruf ق ط ب ج د bersukun di tengah bacaan. Dibaca memantul ringan.'],
    'qalqalah-k': ['Qalqalah Kubra', 'Huruf ق ط ب ج د di akhir ayat saat berhenti (waqaf). Dibaca memantul lebih kuat.'],
    'mad-wajib': ['Mad Wajib Muttasil', 'Huruf mad bertemu hamzah dalam satu kata (tanda ۤ). Panjang 4–5 harakat.'],
    'mad-jaiz': ["Mad Jaiz Munfasil", 'Huruf mad di akhir kata bertemu hamzah di awal kata berikutnya (tanda ٓ). Panjang 2–5 harakat.'],
    'mad-lazim': ['Mad Lazim', 'Huruf mad bertemu tasydid/sukun asli, termasuk pada huruf pembuka surah (الۤمّۤ). Panjang 6 harakat.'],
    'syamsiyah': ['Alif Lam Syamsiyah', 'Alif lam bertemu huruf syamsiyah (bertasydid). Lam tidak dibaca, langsung ke huruf berikutnya.'],
  };

  root.Tajwid = { tandai, html, INFO };
  if (typeof module !== 'undefined') module.exports = root.Tajwid;
})(typeof window !== 'undefined' ? window : globalThis);
