# Wavechat — Tahap 1

## Sudah berfungsi (kode ditulis, BELUM diuji jalan di lingkungan ini)
Login Google, onboarding nickname + username unik, cari user via username, chat personal realtime (Socket.IO, tersimpan di PostgreSQL), status terkirim/dibaca, typing, online, UI neobrutalism responsif.

## Belum ada (tahap berikutnya)
Grup, reply/edit/hapus/forward/reaksi, upload media, stories, channel/komunitas, panggilan WebRTC, notifikasi, archive/block/privasi, halaman profil/pengaturan.

## Menjalankan lokal
1. Buat OAuth Client ID (Web) di Google Cloud Console; Authorized JavaScript origins: `http://localhost:5173`.
2. Buat database PostgreSQL (lokal atau Supabase Free).
3. `cp .env.example backend/.env` dan `frontend/.env`, lalu isi (bagian masing-masing).
4. Backend: `cd backend && npm i && npm run db && npm run dev`
5. Frontend: `cd frontend && npm i && npm run dev` → http://localhost:5173

## Deploy gratis
Frontend: Cloudflare Pages (build `npm run build`, output `dist`, set VITE_*). Backend: Render Free (start `npm start`; tertidur saat idle). DB: Supabase Free (pakai connection string; jalankan `npm run db`). Set `CLIENT_ORIGIN` ke domain frontend dan tambahkan domain itu di Google OAuth origins.
# wavechat
# wavechat
