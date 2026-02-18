# QEmail Worker

Cloudflare Worker untuk memproses email masuk dan meneruskannya ke backend API melalui webhook. Worker ini menggunakan Cloudflare Email Routing untuk menerima email, mem-parsing kontennya, dan mengirimkan notifikasi ke endpoint API yang dikonfigurasi.

## Fitur

- Menerima email masuk via Cloudflare Email Routing
- Parsing konten email (subject, header, body teks/HTML)
- Mendukung format MIME multipart dengan encoding base64 dan quoted-printable
- Meneruskan email ke alamat tujuan (jika dikonfigurasi)
- Mengirim notifikasi webhook ke backend API dengan autentikasi shared secret

## Prasyarat

- Akun [Cloudflare](https://cloudflare.com) dengan Email Routing aktif
- [Node.js](https://nodejs.org) dan npm terinstal
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) terinstal

## Konfigurasi

Worker ini membutuhkan dua secret yang harus dikonfigurasi sebelum deploy:

| Secret | Keterangan |
|---|---|
| `API_ENDPOINT` | URL endpoint backend API untuk menerima webhook |
| `WEBHOOK_SECRET` | Secret key untuk autentikasi request webhook |

## Langkah-langkah Deploy

**1. Set secret `API_ENDPOINT`**

```bash
npx wrangler secret put API_ENDPOINT
```

**2. Set secret `WEBHOOK_SECRET`**

```bash
npx wrangler secret put WEBHOOK_SECRET
```

**3. Deploy worker ke Cloudflare**

```bash
npx wrangler deploy
```

Setelah deploy berhasil, hubungkan worker ini dengan domain di pengaturan **Email Routing** pada dashboard Cloudflare.
