# Publishing to the Chrome Web Store — step by step

Everything you need is already in this repo. Total time: ~30 minutes of clicking,
then 1–3 days of review.

## 0. Before you start

- [ ] `node tools/build.js` → produces `dist/tab-downloader-for-google-docs-<version>.zip`
      (dev bridge and `web_accessible_resources` stripped; forward-slash zip paths).
- [ ] Host `PRIVACY.md` at a public URL. Easiest: push this repo to GitHub, then use
      `https://github.com/<you>/<repo>/blob/main/PRIVACY.md` — or enable GitHub Pages.
- [ ] Have these files ready from `marketing/out/`:
      - `screenshot-1-pick-tabs.png` … `screenshot-4-result.png` (1280×800)
      - `promo-small-440x280.png` (required "small promo tile")
      - `promo-marquee-1400x560.png` (optional "marquee")
- [ ] Copy text from `STORE_LISTING.md` (summary, description, permission justifications).

## 1. Developer dashboard

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the account
   that already holds your developer registration.
2. Click **New item** → **Choose file** → upload the zip from `dist/`.
   The dashboard parses the manifest and creates a draft.

## 2. Store listing tab

| Field | Value |
| --- | --- |
| Title | taken from manifest: *Tab Downloader for Google Docs* |
| Summary | from `STORE_LISTING.md` (≤132 chars) |
| Description | from `STORE_LISTING.md` — paste as plain text, keep the ✔ lines |
| Category | Productivity → Tools |
| Language | English |
| Store icon | auto-filled from manifest (`icons/icon128.png`) |
| Screenshots | upload the 4 PNGs in order |
| Small promo tile | `promo-small-440x280.png` |
| Marquee promo tile | `promo-marquee-1400x560.png` |
| Official URL / Homepage | your GitHub repo URL |
| Support URL | GitHub issues URL |

## 3. Privacy tab (this is where most rejections come from)

1. **Single purpose description** — paste:
   > Download selected document tabs of the open Google Doc as separate files.
2. **Permission justifications** — copy each block from `STORE_LISTING.md`
   (`scripting`, `downloads`, `storage`, host `docs.google.com`, host `*.googleusercontent.com`).
3. **Are you using remote code?** → **No**.
4. **Data usage** → tick **nothing** in the "what data do you collect" list; then certify the
   three disclosures (no selling, no unrelated use, no creditworthiness use).
5. **Privacy policy URL** → the hosted `PRIVACY.md` link.

## 4. Distribution tab

- Visibility: **Public**.
- Regions: all.
- Pricing: free.

## 5. Submit

1. Click **Submit for review**. Leave "publish automatically after review" **on**.
2. Expected review time: usually within 24–72 h; host permissions on Google domains can
   push it into a manual review lane. The `googleusercontent.com` justification in
   `STORE_LISTING.md` explains exactly why it's needed — that wording matters.
3. You'll get an e-mail on approval or with a rejection reason. Typical reasons and fixes:
   - *"Requesting a host permission that isn't needed"* → reply pointing at the
     justification: exports 302-redirect to `doc-…-docstext.googleusercontent.com`; ZIP
     mode must fetch from there. If they insist, ZIP mode could be made optional
     (`optional_host_permissions`) — ask me and I'll wire it up.
   - *"Description mentions Google"* → the description already includes the
     "not affiliated with Google" line; keep it.
   - *"Screenshots don't reflect functionality"* → the screenshots use a stylised editor
     backdrop with the real popup CSS; if a reviewer objects, replace them with
     literal screenshots of the popup over a real doc (1280×800 crop).

## 6. After it's live

- Update `LINKEDIN_POST.md` with the store link and post it.
- Add the store badge/link to `README.md`.
- Tag the release: `git tag v1.0.0 && git push --tags`.

## Updating later

1. Bump `version` in `manifest.json` (e.g. 1.0.1).
2. `node tools/build.js`.
3. Dashboard → your item → **Package** → **Upload new package** → submit.
   Reviews for updates are usually faster than the first one.
