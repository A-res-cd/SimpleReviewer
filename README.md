# SimpleReviewer

An iPhone-first study PWA. Files and study progress stay in this browser. Cloud AI receives extracted text only after the user starts generation.

## Local setup

1. Install Node.js 22 or newer.
2. Run `npm install` and `npm run dev`.
3. For AI calls, copy `.env.example` to `.env.local` and add a Cloudflare Turnstile site key. The Worker secret never belongs in a `VITE_` variable.

The app works without AI configuration: import files, view extracted text, create flashcards, and study locally. AI calls need the Pages Function, a Turnstile widget, and a KV namespace.

## Free Cloudflare setup

1. Create a free Cloudflare account and a Pages project named `simple-reviewer`:

   ```powershell
   npx wrangler pages project create simple-reviewer
   ```
2. Create a Turnstile widget for the Pages hostname. Put its **site key** in `.env.local` as `VITE_TURNSTILE_SITE_KEY` before building. Add both your production hostname and the local development hostname if needed.
3. Create a free KV namespace for the shared daily model-call counter:

   ```powershell
   npx wrangler kv namespace create USAGE
   ```

   Copy its ID into `wrangler.toml`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`.
4. Add the Turnstile secret to Pages; do not commit it:

   ```powershell
   npx wrangler pages secret put TURNSTILE_SECRET --project-name simple-reviewer
   ```

5. Add `TURNSTILE_HOSTNAME` in Cloudflare Pages as a plain-text variable matching the exact hostname returned by Turnstile.
6. Deploy with `npm run deploy`. Cloudflare Pages serves the static PWA and its `/api/reviewer/generate` Function. The Function uses the Workers AI binding in `wrangler.toml` and keeps provider credentials out of the browser.

The Function permits up to 24 model calls per UTC day across the whole app and stops when that cap or Cloudflare’s free AI allowance is reached. There is no paid fallback. Large documents can use multiple calls; the Function caps text at 96,000 characters and eight chunks. Reviewers are stored only in local browser storage.

For local AI development, build once, then run `npx wrangler pages dev dist`. Configure local `.dev.vars` with a Turnstile test secret and `TURNSTILE_HOSTNAME=localhost`. The Vite-only `npm run dev` is for local file and study flows; its AI route is not connected.

## Use on iPhone

Open the deployed Pages URL in Safari, tap Share, then **Add to Home Screen**. Local reviewer and flashcard study works offline after the app has loaded. AI generation needs a connection.

Use **Backup** to download a ZIP of source files and study data. Tap the small upload button in the header to restore a backup. Clearing Safari website data can erase the local library, so keep a backup.

Watch Pages Function errors and Workers AI usage in the Cloudflare dashboard. The function does not log source text.

## Supported files

- PDF: in-app page viewer and text extraction; scanned pages use browser OCR.
- DOCX: readable text extraction and preview.
- PPTX: slide-by-slide text extraction and preview.
- TXT, JPG, PNG: text read or OCR, with a source preview.

OCR defaults to English. OCR and file parsing run in the browser; the original file is never sent to the AI endpoint.
