# Membangun data mushaf per halaman (604 hlm) dari teks Al-Qur'an KEMENAG RI
# (Mushaf Standar Indonesia, quran.kemenag.go.id, via paket npm "quran-kemenag")
# + metadata juz dari fawazahmed0/quran-api (info.json)
# + bacaan latin Kemenag dari paket npm "quran-pack" (dist/surah/source)
# Pemakaian: python3 scripts/build-quran.py <folder_verses_kemenag> <info.json> <folder_latin_quran_pack> [folder_output]
import json, sys, os, glob, re
src, info_path, latin_dir = sys.argv[1], sys.argv[2], sys.argv[3]
out = sys.argv[4] if len(sys.argv) > 4 else 'public/quran'
LAT = {}
for s_ in range(1, 115):
    d_ = json.load(open(os.path.join(latin_dir, f'{s_}.json')))
    for k_, v_ in d_['latins'].items(): LAT[(s_, int(k_))] = v_
info = json.load(open(info_path))
ayat = []
for f in glob.glob(os.path.join(src, '*.json')):
    ayat += json.load(open(f))
ayat.sort(key=lambda a: (a['surah_id'], a['verse_number']))
assert len(ayat) == 6236
bersih = lambda t: re.sub(r'\s+', ' ', t.replace('\xa0', ' ')).strip()
pages = {}
for a in ayat:
    p = a['page_number']
    pages.setdefault(p, {'p': p, 'j': a['juz_id'], 'v': []})
    pages[p]['v'].append([a['surah_id'], a['verse_number'], bersih(a['verse_arabic']), bersih(a['verse_bahasa']), bersih(LAT[(a['surah_id'], a['verse_number'])])])
# digabung per 20 halaman (31 file) agar mudah diunggah ke GitHub (batas 100 file per unggahan web)
os.makedirs(os.path.join(out, 'h'), exist_ok=True)
for k in range(31):
    blok = {p: pages[p] for p in range(20 * k + 1, min(604, 20 * k + 20) + 1)}
    json.dump(blok, open(os.path.join(out, 'h', f'{k + 1}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
latin = ["Al-Fatihah","Al-Baqarah","Ali 'Imran","An-Nisa'","Al-Ma'idah","Al-An'am","Al-A'raf","Al-Anfal","At-Taubah","Yunus","Hud","Yusuf","Ar-Ra'd","Ibrahim","Al-Hijr","An-Nahl","Al-Isra'","Al-Kahf","Maryam","Taha","Al-Anbiya'","Al-Hajj","Al-Mu'minun","An-Nur","Al-Furqan","Asy-Syu'ara'","An-Naml","Al-Qasas","Al-'Ankabut","Ar-Rum","Luqman","As-Sajdah","Al-Ahzab","Saba'","Fatir","Yasin","As-Saffat","Sad","Az-Zumar","Gafir","Fussilat","Asy-Syura","Az-Zukhruf","Ad-Dukhan","Al-Jasiyah","Al-Ahqaf","Muhammad","Al-Fath","Al-Hujurat","Qaf","Az-Zariyat","At-Tur","An-Najm","Al-Qamar","Ar-Rahman","Al-Waqi'ah","Al-Hadid","Al-Mujadilah","Al-Hasyr","Al-Mumtahanah","As-Saff","Al-Jumu'ah","Al-Munafiqun","At-Tagabun","At-Talaq","At-Tahrim","Al-Mulk","Al-Qalam","Al-Haqqah","Al-Ma'arij","Nuh","Al-Jinn","Al-Muzzammil","Al-Muddassir","Al-Qiyamah","Al-Insan","Al-Mursalat","An-Naba'","An-Nazi'at","'Abasa","At-Takwir","Al-Infitar","Al-Mutaffifin","Al-Insyiqaq","Al-Buruj","At-Tariq","Al-A'la","Al-Gasyiyah","Al-Fajr","Al-Balad","Asy-Syams","Al-Lail","Ad-Duha","Asy-Syarh","At-Tin","Al-'Alaq","Al-Qadr","Al-Bayyinah","Az-Zalzalah","Al-'Adiyat","Al-Qari'ah","At-Takasur","Al-'Asr","Al-Humazah","Al-Fil","Quraisy","Al-Ma'un","Al-Kausar","Al-Kafirun","An-Nasr","Al-Lahab","Al-Ikhlas","Al-Falaq","An-Nas"]
mulai = {}
for a in ayat:
    mulai.setdefault(a['surah_id'], a['page_number'])
surah = []
for ch in info['chapters']:
    n = ch['chapter']
    surah.append([n, latin[n-1], ch['arabicname'], len(ch['verses']), mulai[n], 'Makkiyah' if ch['revelation'] == 'Mecca' else 'Madaniyah'])
juz = []
for j in range(1, 31):
    hs = [a['page_number'] for a in ayat if a['juz_id'] == j]
    juz.append([j, min(hs), max(hs)])  # [juz, halaman awal, halaman akhir]
basmalah = bersih(ayat[0]['verse_arabic'])
json.dump({'surah': surah, 'juz': juz, 'pages': len(pages), 'basmalah': basmalah, 'sumber': 'Kemenag RI'}, open(os.path.join(out, 'meta.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('halaman:', len(pages), '| juz:', juz[:3], '...')
