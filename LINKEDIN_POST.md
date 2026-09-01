# LinkedIn post

Attach: `marketing/out/promo-marquee-1400x560.png` (or the 4 screenshots as a carousel/PDF).
Replace `<STORE-LINK>` after the listing is live. Keep the first line punchy — it's the
only thing people see before "…see more".

---

I built a Chrome extension because Google Docs annoyed me one time too many.

If you use **document tabs** in Google Docs (and if you write anything longer than a memo, you probably do), you know the problem: when it's time to download, Google gives you exactly two choices — *this tab* or *all tabs mashed into one file*.

Need tabs 2, 5 and 9 as separate PDFs? That's nine clicks, three renames, and a small loss of faith in humanity.

So I built **Tab Downloader for Google Docs**. Open a doc, click the icon, tick the tabs you want, choose your formats, download. Every tab becomes its own file with a sensible name.

What it does:
🗂️ Pick any combination of tabs and nested subtabs
📄 PDF, Word, OpenDocument, RTF, TXT, Markdown, HTML, EPUB — select several at once
🏷️ Names like "Project Plan – Research.pdf", numbered, or into a folder / single .zip
⚡ Markdown & text of a 30-tab doc in about a second
🔒 No sign-in, no servers, no analytics — it just uses the Google session you're already in

The most interesting engineering bit: Google quietly rate-limits exports to a handful per document, then about one every five seconds. So the extension measures the limit, paces itself to it, retries automatically and shows an ETA — and for text formats it fetches the whole document once and splits it locally, sidestepping the limit entirely.

Free, open source (MIT), no permissions beyond what it needs.

👉 Install: <STORE-LINK>
👉 Source: <GITHUB-LINK>

If you know someone who lives in Google Docs, send them this — and if you hit a doc where it misbehaves, tell me. I'd genuinely like to know.

#GoogleDocs #ChromeExtension #Productivity #OpenSource #BuildInPublic #JavaScript

---

## Shorter variant (for a comment or a repost)

Google Docs tabs are great until you need to download three of them separately. I built a free Chrome extension that fixes that: tick the tabs, pick PDF/Word/Markdown/…, one click, one file per tab. Open source. <STORE-LINK>
