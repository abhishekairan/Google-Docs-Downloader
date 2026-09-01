# Privacy Policy — Tab Downloader for Google Docs

_Last updated: 1 September 2026_

**Tab Downloader for Google Docs** runs entirely inside your browser.

## What it does

When you click the extension icon on a Google Docs page it reads the list of
document tabs from that page and, when you ask it to, downloads the tabs you
selected using Google's own export endpoint (`docs.google.com/…/export`). The
download is performed by Chrome with the Google account you are already signed
in to.

## Data collection

- The extension does **not** collect, transmit, or store any personal data.
- It does **not** send document content, titles, or tab names anywhere except
  to Google's own `docs.google.com` export endpoint, which is required to
  produce the file you asked for.
- It has no analytics, no telemetry, no remote code, and no servers of its own.
- Your preferences (chosen file format, naming style, ZIP option) are stored
  with `chrome.storage.sync`, which lives in your Chrome profile and syncs only
  through your own Google account if Chrome sync is enabled.

## Permissions

| Permission | Purpose |
| --- | --- |
| `scripting` + `docs.google.com` host access | Read the tab list from the open document and request exports |
| `*.googleusercontent.com` host access | Google serves the exported file from this domain (via redirect); needed to bundle files into a ZIP |
| `downloads` | Save the exported files with meaningful names |
| `storage` | Remember your preferences |

## Contact

Questions about this policy: abhishekairan1234@gmail.com
