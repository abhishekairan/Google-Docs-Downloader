# Chrome Web Store listing copy

## Name (max 45 chars)

Tab Downloader for Google Docs

## Summary (max 132 chars)

Download individual Google Docs document tabs as separate PDF, Word, Markdown, text or HTML files. Pick exactly the tabs you need.

## Category

Productivity → Tools

## Description

Google Docs lets you split a document into tabs — but when it's time to
download, you only get "current tab" or "all tabs in one go". Need tabs 2, 5 and
7 as separate PDFs? That's a lot of clicking.

Tab Downloader for Google Docs fixes that. Open any document, click the icon,
tick the tabs you want, choose a format, and download. Every tab becomes its own
file with a sensible name.

✔ Pick any combination of tabs (nested subtabs included)
✔ PDF, Word (.docx), OpenDocument (.odt), RTF, plain text, Markdown, HTML, EPUB
✔ Select several formats at once — e.g. get every tab as both .pdf and .md in one click
✔ Files named "Document – Tab.pdf" (or numbered, or tab-only — your choice)
✔ Optionally prefix subtabs with their parent tab's name
✔ Save into a folder named after the document
✔ Or bundle everything into a single .zip
✔ Keeps downloading even if you close the popup
✔ Markdown and text exports of large documents finish in seconds (one request for all tabs)

Note on speed: Google allows only a handful of exports per document in quick
succession, then about one every 5 seconds. For PDF/Word the extension paces
itself to that limit and shows an estimated time — a 30-tab PDF export takes
around two minutes. That is Google's quota, not something an extension can
bypass.
✔ No sign-in, no OAuth, no servers — uses the Google session you already have

How it works: the extension reads the tab list from the open document and asks
Google's own export endpoint for each tab you selected. Nothing is sent
anywhere except to docs.google.com. No data is collected.

Note: this extension is not affiliated with or endorsed by Google. Google Docs
is a trademark of Google LLC.

## Permission justifications (Privacy tab in the developer dashboard)

**scripting** — Used only to read the list of document tabs (titles and IDs)
from the Google Docs page the user has open when they click the extension icon.

**downloads** — Used to save each exported tab as a file with a meaningful
filename, and optionally into a sub-folder or as a single ZIP.

**storage** — Stores the user's preferences (file format, naming pattern, ZIP
option) so they don't have to be re-selected each time.

**Host permission https://docs.google.com/\*** — Required to run the tab-list
reader on Google Docs pages and to request exports from Google's own export
endpoint.

**Host permission https://\*.googleusercontent.com/\*** — Google answers every
export request with a redirect to a `doc-…-docstext.googleusercontent.com`
URL that serves the actual file. In ZIP mode the extension fetches the files
itself to bundle them locally, so it must be allowed to follow that redirect.
No other googleusercontent.com content is accessed.

**Single purpose**: Download selected document tabs of a Google Doc as separate
files.

**Remote code**: No. All code is packaged with the extension.

**Data usage**: The extension does not collect or transmit user data.

## Privacy policy URL

Host `PRIVACY.md` (e.g. on GitHub Pages or your site) and paste the URL.

## Screenshots (1280×800 or 640×400)

1. Popup open over a Google Doc with several tabs, three of them ticked
2. Options expanded showing naming pattern + ZIP toggle
3. Progress view with green ticks
4. Resulting files in the Downloads folder

## Promo tile (440×280) — optional

Icon on the left, headline "Download only the tabs you need" on the right.
