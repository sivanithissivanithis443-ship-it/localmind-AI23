# LocalMind AI — Universal AI Answer Engine

LocalMind is a React + Vite Progressive Web App (PWA) with multilingual chat (English, Tamil and Tanglish), multimodal image input, voice transcription, speech output, and local IndexedDB chat history. AI requests are handled by server-side Vercel Functions under `/api/*`.

## Deploy from Android using GitHub + Vercel

1. Sign in to GitHub and open the repository containing this project.
2. Upload the complete contents of this folder to the repository root (the `package.json`, `index.html`, `src/`, `api/`, and `lib/` items must be at the top level).
3. Open https://vercel.com/new and sign in.
4. Choose **Continue with GitHub**, authorize Vercel, and import the LocalMind repository.
5. Keep the detected Vite settings: Build Command `npm run build`; Output Directory `dist`; Install Command `npm install`. The Root Directory should be `./` if the files are at the repository root.
6. Before or after the first deployment, open **Project → Settings → Environment Variables** and add `GEMINI_API_KEY` with your own Gemini API key. Select Production, Preview, and Development if you want the key in all environments. Save it.
7. Open **Deployments** and redeploy the latest deployment after adding the key.
8. Open the generated `.vercel.app` URL. Test `/api/health`; it should return JSON with `status: "ok"` and `aiConfigured: true`. Then send a short chat message.

## Vercel environment variable

Required server-side secret:

- `GEMINI_API_KEY` — create/manage it in Google AI Studio, then add it only in Vercel Project Settings → Environment Variables. Do not put it in `VITE_...` variables, browser code, GitHub commits, screenshots, or public chat messages.

The API key is not included in this ZIP. The app's AI endpoints return a clear setup error until you add it.

## Local development (computer)

```bash
npm install
cp .env.example .env
# Replace the placeholder with your own GEMINI_API_KEY
npm run dev
```

## Android app-like installation

After the HTTPS Vercel site is deployed, open it in Chrome on Android → browser menu (⋮) → **Install app** or **Add to Home screen**. This installs the PWA. It is not a Play Store APK; a separate Android packaging step is needed for an APK.

## Notes

- Chat history is stored locally in the browser on that device. It is not automatically synced across devices.
- Microphone and camera access require HTTPS and user permission.
- The AI backend requires internet access and a valid Gemini API key. The PWA shell may cache for offline opening, but cloud AI replies will not work offline.
