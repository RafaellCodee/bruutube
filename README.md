# BruTube — Neobrutalism YouTube Clone

Web cloning YouTube bergaya **Neobrutalism** yang bersih, bebas iklan banner/pop-up, mendukung live feed & pencarian YouTube, halaman profil channel, menu profil akun, mode fokus, playlist, dan siap deploy ke **Vercel**.

## Menjalankan di Lokal
```bash
npm install
npm start
```
Buka: `http://127.0.0.1:8080`

## Cara Deploy ke Vercel

### Opsi 1: Via GitHub (Paling Mudah)
1. Push folder proyek ini ke repository GitHub Anda.
2. Buka [vercel.com/new](https://vercel.com/new) dan pilih repository tersebut.
3. Biarkan **Framework Preset: Other**, **Build Command: (kosong)**, **Output Directory: (kosong)**.
4. *(Direkomendasikan agar 100% stabil di IP cloud Vercel)* Tambahkan Environment Variable di Vercel:
   - Key: `YOUTUBE_API_KEY`
   - Value: API Key **YouTube Data API v3** Anda (gratis dari Google Cloud Console).
5. Klik **Deploy**.

### Opsi 2: Via Vercel CLI
```bash
npx vercel
```
Untuk production deploy:
```bash
npx vercel --prod
```

## Struktur Proyek
- `index.html`, `styles.css`, `data.js`, `app.js` — Frontend BruTube (Neobrutalism UI).
- `lib/youtube.js` — Modul shared pengambilan data YouTube (mendukung `YOUTUBE_API_KEY` resmi + fallback otomatis `youtube-sr`/`yt-search`).
- `api/*.js` & `vercel.json` — Vercel Serverless Functions (`/api/feed`, `/api/search`, `/api/video`, `/api/channel`, `/api/health`).
- `server.js` — Server lokal untuk development (`npm start`).
