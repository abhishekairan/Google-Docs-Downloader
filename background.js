/*
 * Service worker: owns the download job so it keeps running even if the
 * popup is closed. The popup sends START_JOB and polls GET_STATE / listens
 * for PROGRESS broadcasts.
 *
 * Google's export endpoint has a quota PER DOCUMENT (measured 2026-09):
 * roughly 6 exports in a burst, then about one every 5 seconds, shared by
 * every format, endpoint and tab. Two things keep large jobs fast:
 *   1. A global adaptive pacer – bursts, then settles at the cadence Google
 *      actually accepts instead of failing/retrying blindly.
 *   2. A "merged" fast path for Markdown and plain text: one export of the
 *      whole document, split locally on the tab headings Google inserts.
 */
importScripts('zip.js');

const CONCURRENCY = 2; // parallel exports in "separate files" mode
const MAX_ATTEMPTS = 8; // per item; each attempt is paced, so this is cheap
const PACE_INITIAL_MS = 5000; // cadence adopted after the first throttle
const PACE_MIN_MS = 4000;
const PACE_MAX_MS = 20000;
const RETRYABLE_INTERRUPTS = new Set([
  'SERVER_FAILED', // what chrome.downloads reports for HTTP 429/5xx
  'SERVER_BAD_CONTENT',
  'NETWORK_FAILED',
  'NETWORK_TIMEOUT',
  'NETWORK_DISCONNECTED',
]);
const MERGEABLE_FORMATS = new Set(['md', 'txt']);

let job = null;
const pending = new Map(); // downloadId -> { job, item, resolve }

/* ------------------------------------------------------------------ */
/* Global pacer                                                        */
/* ------------------------------------------------------------------ */

const pacer = { minInterval: 0, nextStart: 0, okStreak: 0 };

function resetPacer() {
  pacer.minInterval = 0;
  pacer.nextStart = 0;
  pacer.okStreak = 0;
}

/** Wait until the pacer allows another export to start. */
async function acquireSlot(j) {
  for (;;) {
    const wait = pacer.nextStart - Date.now();
    if (wait <= 0) break;
    await sleep(Math.min(wait, 400));
    if (j.cancelled) return false;
  }
  pacer.nextStart = Date.now() + pacer.minInterval;
  return true;
}

function pacerThrottled(j) {
  pacer.okStreak = 0;
  pacer.minInterval = pacer.minInterval
    ? Math.min(Math.round(pacer.minInterval * 1.5), PACE_MAX_MS)
    : PACE_INITIAL_MS;
  pacer.nextStart = Date.now() + pacer.minInterval;
  j.throttled = true;
  j.paceMs = pacer.minInterval;
}

function pacerSucceeded(j) {
  if (!pacer.minInterval) return;
  pacer.okStreak++;
  if (pacer.okStreak >= 6) {
    pacer.okStreak = 0;
    pacer.minInterval = Math.max(PACE_MIN_MS, Math.round(pacer.minInterval * 0.9));
  }
  j.paceMs = pacer.minInterval;
}

/* ------------------------------------------------------------------ */
/* Messaging                                                           */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg && msg.type) {
    case 'START_JOB':
      if (job && !job.done) {
        sendResponse({ ok: false, error: 'A download is already running.' });
        return false;
      }
      startJob(msg.job);
      sendResponse({ ok: true });
      return false;
    case 'GET_STATE':
      sendResponse(job);
      return false;
    case 'CANCEL_JOB':
      if (job) cancelJob(job);
      sendResponse({ ok: true });
      return false;
    case 'CLEAR_JOB':
      if (job && job.done) job = null;
      sendResponse({ ok: true });
      return false;
    default:
      return false;
  }
});

function broadcast(j) {
  if (j !== job) return; // stale worker of a cleared/replaced job
  chrome.runtime.sendMessage({ type: 'PROGRESS', job: j }).catch(() => {});
}

function startJob(spec) {
  const j = {
    id: spec.id,
    docId: spec.docId,
    userIndex: spec.userIndex,
    docTitle: spec.docTitle,
    allTabs: spec.allTabs || [], // every tab of the document, in order
    formats: spec.formats,
    mode: spec.mode,
    zipName: spec.zipName,
    items: spec.items.map((it) => ({ ...it, status: 'queued', error: null })),
    done: false,
    cancelled: false,
    throttled: false,
    paceMs: 0,
    startedAt: Date.now(),
  };
  job = j;
  resetPacer();
  broadcast(j);
  runJob(j).catch((err) => {
    j.error = String((err && err.message) || err);
    j.done = true;
    broadcast(j);
  });
}

function cancelJob(j) {
  if (j.done) return;
  j.cancelled = true;
  for (const [id, entry] of pending) {
    if (entry.job !== j) continue;
    pending.delete(id);
    chrome.downloads.cancel(id).catch(() => {});
    chrome.downloads.erase({ id }).catch(() => {});
    markCancelled(entry.item);
    entry.resolve();
  }
  for (const item of j.items) {
    if (['queued', 'retrying', 'downloading'].includes(item.status)) markCancelled(item);
  }
  j.done = true;
  broadcast(j);
}

function markCancelled(item) {
  item.status = 'failed';
  item.error = 'Cancelled';
  item.errorCode = 'USER_CANCELED';
}

/* ------------------------------------------------------------------ */
/* Job runner                                                          */
/* ------------------------------------------------------------------ */

async function runJob(j) {
  const zipFiles = j.mode === 'zip' ? [] : null;
  const usedNames = new Set();

  // 1. Fast path: Markdown / TXT via one merged export per format.
  const remaining = [];
  const byFormat = new Map();
  for (const item of j.items) {
    if (!byFormat.has(item.format)) byFormat.set(item.format, []);
    byFormat.get(item.format).push(item);
  }
  for (const [format, items] of byFormat) {
    if (j.cancelled) return;
    if (MERGEABLE_FORMATS.has(format) && items.length >= 2 && j.allTabs.length >= 2) {
      const ok = await tryMergedExport(j, format, items, zipFiles, usedNames);
      if (ok) continue;
    }
    remaining.push(...items);
  }

  // 2. Everything else: one export per tab, paced.
  if (j.mode === 'zip') {
    for (const item of remaining) {
      if (j.cancelled) return;
      const data = await fetchItem(j, item);
      if (data) zipFiles.push({ name: uniqueName(item.filename, usedNames), data });
    }
  } else {
    const queue = [...remaining];
    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push(
        (async () => {
          while (queue.length && !j.cancelled) {
            await downloadWithRetry(j, queue.shift());
          }
        })()
      );
    }
    await Promise.all(workers);
  }

  if (j.cancelled) return;

  if (j.mode === 'zip') {
    if (!zipFiles.length) {
      j.error = 'None of the selected tabs could be exported.';
    } else {
      await saveZip(j, zipFiles);
    }
  }
  j.done = true;
  broadcast(j);
}

/* ------------------------------------------------------------------ */
/* Fast path: merged export split on tab headings                      */
/* ------------------------------------------------------------------ */

/**
 * Exports the whole document once (no tab= parameter) and splits it into
 * per-tab pieces. Google prefixes every tab with its title: "# Title" in
 * Markdown, a bare "Title" line in plain text. Titles are matched in
 * document order, so a false split needs user content that equals the
 * *next* tab's heading exactly. If the boundaries don't line up we bail
 * out and the caller falls back to per-tab exports.
 * @returns {Promise<boolean>} true when every item was produced
 */
async function tryMergedExport(j, format, items, zipFiles, usedNames) {
  for (const item of items) {
    item.status = 'downloading';
    item.error = null;
  }
  broadcast(j);

  let text;
  try {
    const data = await fetchExport(j, exportUrl(j, format, null), format, { label: 'merged ' + format });
    if (!data) return false;
    text = new TextDecoder().decode(data);
  } catch {
    return false;
  }

  const pieces = splitMergedExport(text, format, j.allTabs);
  if (!pieces) {
    for (const item of items) item.status = 'queued';
    broadcast(j);
    return false;
  }

  const encoder = new TextEncoder();
  for (const item of items) {
    if (j.cancelled) return true;
    const piece = pieces.get(item.id);
    if (piece == null) {
      item.status = 'failed';
      item.error = 'Tab not found in the merged export';
      continue;
    }
    const bytes = encoder.encode(format === 'txt' ? '﻿' + piece : piece);
    if (zipFiles) {
      zipFiles.push({ name: uniqueName(item.filename, usedNames), data: bytes });
      item.status = 'done';
      item.bytes = bytes.length;
    } else {
      const mime = format === 'md' ? 'text/markdown' : 'text/plain';
      const url = `data:${mime};charset=utf-8;base64,${bytesToBase64(bytes)}`;
      await downloadUrl(j, item, url);
    }
    broadcast(j);
  }
  return true;
}

/** Undo Google's Markdown escaping ("tab 2\." -> "tab 2.") for comparisons. */
function unescapeMd(s) {
  return s.replace(/\\([\\`*_{}\[\]()#+\-.!|<>~])/g, '$1');
}

/**
 * @returns {Map<tabId, string> | null} null when the headings don't line up
 */
function splitMergedExport(text, format, allTabs) {
  const body = text.replace(/^﻿/, '');
  const newline = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);

  const matches = (line, title) => {
    if (format === 'md') {
      const m = line.match(/^#\s+(.*?)\s*$/);
      return !!m && unescapeMd(m[1]) === title;
    }
    return line.trim() === title.trim();
  };

  const starts = [];
  let cursor = 0;
  for (const tab of allTabs) {
    let found = -1;
    for (let i = cursor; i < lines.length; i++) {
      if (matches(lines[i], tab.title)) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    starts.push(found);
    cursor = found + 1;
  }

  const pieces = new Map();
  allTabs.forEach((tab, idx) => {
    const from = starts[idx] + 1;
    const to = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    const seg = lines.slice(from, to);
    while (seg.length && seg[0].trim() === '') seg.shift();
    while (seg.length && seg[seg.length - 1].trim() === '') seg.pop();
    pieces.set(tab.id, seg.join(newline));
  });
  return pieces;
}

/* ------------------------------------------------------------------ */
/* Per-tab exports                                                     */
/* ------------------------------------------------------------------ */

function exportUrl(j, format, tabId) {
  const u = j.userIndex != null ? `/u/${j.userIndex}` : '';
  const tab = tabId ? `&tab=${encodeURIComponent(tabId)}` : '';
  return `https://docs.google.com/document${u}/d/${encodeURIComponent(j.docId)}/export?format=${format}${tab}`;
}

/** Files mode: chrome.downloads, retried through the pacer. */
async function downloadWithRetry(j, item) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (!(await acquireSlot(j))) {
      markCancelled(item);
      return;
    }
    await downloadUrl(j, item, item.url);
    if (item.status !== 'failed' || !RETRYABLE_INTERRUPTS.has(item.errorCode)) {
      if (item.status === 'done' || item.status === 'warn') pacerSucceeded(j);
      return;
    }
    if (attempt === MAX_ATTEMPTS || j.cancelled) return;
    pacerThrottled(j);
    item.status = 'retrying';
    item.error = `Google is throttling exports – retrying (${attempt + 1}/${MAX_ATTEMPTS})…`;
    broadcast(j);
  }
}

function downloadUrl(j, item, url) {
  return new Promise((resolve) => {
    if (j.cancelled) {
      markCancelled(item);
      resolve();
      return;
    }
    item.status = 'downloading';
    item.error = null;
    item.errorCode = null;
    broadcast(j);
    chrome.downloads.download(
      { url, filename: item.filename, conflictAction: 'uniquify', saveAs: false },
      (downloadId) => {
        if (chrome.runtime.lastError || downloadId === undefined) {
          item.status = 'failed';
          item.error = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Download failed to start';
          broadcast(j);
          resolve();
          return;
        }
        if (j.cancelled) {
          chrome.downloads.cancel(downloadId).catch(() => {});
          chrome.downloads.erase({ id: downloadId }).catch(() => {});
          markCancelled(item);
          resolve();
          return;
        }
        item.downloadId = downloadId;
        pending.set(downloadId, { job: j, item, resolve });
        // Tiny files can complete before this callback runs – re-check.
        chrome.downloads.search({ id: downloadId }).then(([record]) => {
          if (record && record.state !== 'in_progress') settle(downloadId, record.state, record.error);
        });
        // "Ask where to save each file" blocks every download on a dialog.
        setTimeout(async () => {
          if (!pending.has(downloadId)) return;
          const [record] = await chrome.downloads.search({ id: downloadId });
          if (record && record.state === 'in_progress' && !record.filename) {
            item.error = 'Waiting for the Save dialog – your browser is set to ask where to save each file.';
            broadcast(j);
          }
        }, 4000);
      }
    );
  });
}

function settle(downloadId, state, errorCode) {
  const entry = pending.get(downloadId);
  if (!entry) return;
  pending.delete(downloadId);
  const { job: j, item, resolve } = entry;
  if (state === 'complete') {
    verifyDownloadedFile(downloadId, item).finally(() => {
      broadcast(j);
      resolve();
    });
  } else {
    item.status = 'failed';
    item.errorCode = errorCode || null;
    item.error = humanizeInterrupt(errorCode);
    chrome.downloads.erase({ id: downloadId }).catch(() => {});
    broadcast(j);
    resolve();
  }
}

chrome.downloads.onChanged.addListener((delta) => {
  const entry = pending.get(delta.id);
  if (!entry) return;
  if (delta.filename && delta.filename.current) entry.item.savedAs = delta.filename.current;
  if (!delta.state) return;
  const state = delta.state.current;
  if (state === 'complete' || state === 'interrupted') {
    settle(delta.id, state, delta.error && delta.error.current);
  }
});

async function verifyDownloadedFile(downloadId, item) {
  item.status = 'done';
  try {
    const [record] = await chrome.downloads.search({ id: downloadId });
    if (!record) return;
    const mime = (record.mime || '').toLowerCase();
    if (item.format !== 'html' && mime.includes('text/html')) {
      item.status = 'warn';
      item.error =
        'Google returned a web page instead of the file. Make sure you are signed in to the account that has access to this document.';
    }
  } catch {
    /* keep "done" */
  }
}

function humanizeInterrupt(code) {
  if (!code) return 'Download interrupted';
  const map = {
    USER_CANCELED: 'Cancelled',
    FILE_ACCESS_DENIED: 'Cannot write to the download folder',
    FILE_NO_SPACE: 'Not enough disk space',
    FILE_NAME_TOO_LONG: 'File name too long',
    NETWORK_FAILED: 'Network error',
    NETWORK_TIMEOUT: 'Network timeout',
    SERVER_FORBIDDEN: 'Google refused the export (no access?)',
    SERVER_UNAUTHORIZED: 'Not signed in',
    SERVER_BAD_CONTENT: 'Google returned an error page',
    SERVER_FAILED: 'Google rejected the export (rate limit) – try again in a minute',
  };
  return map[code] || code.replace(/_/g, ' ').toLowerCase();
}

/* ------------------------------------------------------------------ */
/* ZIP mode: fetch in the worker                                       */
/* ------------------------------------------------------------------ */

async function fetchItem(j, item) {
  item.status = 'downloading';
  item.error = null;
  broadcast(j);
  try {
    const data = await fetchExport(j, item.url, item.format, { item });
    if (data) {
      item.status = 'done';
      item.bytes = data.length;
    }
    broadcast(j);
    return data;
  } catch (err) {
    if (j.cancelled) return null;
    item.status = 'failed';
    item.error = String((err && err.message) || err);
    broadcast(j);
    return null;
  }
}

/**
 * fetch() an export URL through the pacer, retrying on 429/5xx.
 * @returns {Promise<Uint8Array|null>} null only when cancelled
 */
async function fetchExport(j, url, format, { item } = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (!(await acquireSlot(j))) return null;
    if (item) {
      item.status = 'downloading';
      item.error = null;
      broadcast(j);
    }
    let res = null;
    try {
      res = await fetch(url, { credentials: 'include', redirect: 'follow' });
    } catch {
      if (attempt === MAX_ATTEMPTS) throw new Error('Network error while contacting Google');
    }
    if (j.cancelled) return null;

    if (res && res.ok) {
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (format !== 'html' && contentType.includes('text/html')) {
        throw new Error('Google returned a web page instead of the file (not signed in / no access?)');
      }
      pacerSucceeded(j);
      return new Uint8Array(await res.arrayBuffer());
    }
    if (res && !(res.status === 429 || res.status >= 500)) {
      throw new Error(`Google responded with HTTP ${res.status}`);
    }
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(
        res && res.status === 429
          ? 'Google is rate-limiting exports – wait a minute and try again'
          : `Google responded with HTTP ${res ? res.status : 'error'}`
      );
    }
    pacerThrottled(j);
    const retryAfter = res && Number(res.headers.get('retry-after'));
    if (retryAfter > 0 && retryAfter <= 60) {
      pacer.nextStart = Math.max(pacer.nextStart, Date.now() + retryAfter * 1000);
    }
    if (item) {
      item.status = 'retrying';
      item.error = `Google is throttling exports – retrying (${attempt + 1}/${MAX_ATTEMPTS})…`;
      broadcast(j);
    }
  }
  return null;
}

async function saveZip(j, files) {
  const zipBytes = buildZip(files);
  const url = 'data:application/zip;base64,' + bytesToBase64(zipBytes);
  await new Promise((resolve) => {
    chrome.downloads.download(
      { url, filename: j.zipName, conflictAction: 'uniquify', saveAs: false },
      (downloadId) => {
        if (chrome.runtime.lastError || downloadId === undefined) {
          j.error = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'ZIP download failed to start';
        } else {
          j.zipDownloadId = downloadId;
        }
        resolve();
      }
    );
  });
}

function uniqueName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (used.has(`${base} (${n})${ext}`)) n++;
  const candidate = `${base} (${n})${ext}`;
  used.add(candidate);
  return candidate;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
