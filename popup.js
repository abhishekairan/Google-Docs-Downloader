/* global chrome */

const FORMATS = [
  { value: 'pdf', label: 'PDF (.pdf)', ext: 'pdf' },
  { value: 'docx', label: 'Microsoft Word (.docx)', ext: 'docx' },
  { value: 'odt', label: 'OpenDocument (.odt)', ext: 'odt' },
  { value: 'rtf', label: 'Rich Text (.rtf)', ext: 'rtf' },
  { value: 'txt', label: 'Plain text (.txt)', ext: 'txt' },
  { value: 'md', label: 'Markdown (.md)', ext: 'md' },
  { value: 'html', label: 'Web page (.html)', ext: 'html' },
  { value: 'epub', label: 'EPUB (.epub)', ext: 'epub' },
];

const DEFAULT_SETTINGS = {
  formats: ['pdf'],
  naming: 'doc-tab',
  includeParents: true,
  subfolder: false,
  zipMode: false,
};

const DOC_URL_RE = /^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/[^/]+/;

const $ = (id) => document.getElementById(id);
const views = {
  empty: $('view-empty'),
  select: $('view-select'),
  progress: $('view-progress'),
};

let settings = { ...DEFAULT_SETTINGS };
let doc = null; // { docId, userIndex, title, tabs: [{id, level, title, selected, path}], currentTabId }
let activeTabId = null; // browser tab id
let selected = new Set();
let dismissedJobId = null; // job the user closed with "Done" – ignore its late broadcasts

/* ------------------------------------------------------------------ */
/* Injected into the Google Docs page. Must be self-contained.         */
/* ------------------------------------------------------------------ */
function scrapeDocument() {
  const m = location.pathname.match(/^\/document\/(?:u\/(\d+)\/)?d\/([^/]+)/);
  if (!m) return { error: 'not-a-doc' };

  const userIndex = m[1] != null ? m[1] : null;
  const docId = m[2];
  const title =
    (document.title || '').replace(/\s*-\s*Google Docs\s*$/i, '').trim() || 'Document';
  const currentTabId = new URLSearchParams(location.search).get('tab') || 't.0';

  // Google renders every document tab (even when the side panel is collapsed)
  // as <div id="chapter-container-{tabId}" class="chapter-container chapter-container-level-{n}">.
  // The very first tab ("t.0") is rendered with an empty id suffix.
  const containers = Array.from(document.querySelectorAll('[id^="chapter-container-"]'));
  const tabs = containers.map((c, i) => {
    const rawId = c.id.slice('chapter-container-'.length);
    const levelMatch = c.className.match(/chapter-container-level-(\d+)/);
    const treeitem = c.querySelector('[role="treeitem"]');
    const labelEl = c.querySelector('.chapter-item-label');
    const label =
      (treeitem && treeitem.getAttribute('aria-label')) ||
      (labelEl && labelEl.textContent) ||
      '';
    return {
      id: rawId || 't.0',
      level: levelMatch ? parseInt(levelMatch[1], 10) : 0,
      title: label.trim() || `Tab ${i + 1}`,
      selected: !!treeitem && treeitem.getAttribute('aria-selected') === 'true',
    };
  });

  if (tabs.length === 0) {
    // Single-tab document: the tabs panel does not exist at all.
    tabs.push({ id: currentTabId, level: 0, title, selected: true, single: true });
  }

  return { docId, userIndex, title, tabs, currentTabId };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function show(view) {
  for (const [name, el] of Object.entries(views)) {
    el.classList.toggle('hidden', name !== view);
  }
}

function sanitizeSegment(s) {
  return (
    String(s)
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .slice(0, 100) || 'Untitled'
  );
}

function withPaths(tabs) {
  const stack = [];
  return tabs.map((t) => {
    stack.length = t.level;
    stack[t.level] = t.title;
    return { ...t, path: stack.slice(0, t.level + 1).filter(Boolean) };
  });
}

/** Selected formats, in the canonical FORMATS order. */
function selectedFormats() {
  return FORMATS.filter((f) => settings.formats.includes(f.value));
}

function exportUrl(tabId, fmt) {
  const u = doc.userIndex != null ? `/u/${doc.userIndex}` : '';
  return (
    `https://docs.google.com/document${u}/d/${encodeURIComponent(doc.docId)}` +
    `/export?format=${fmt.value}&tab=${encodeURIComponent(tabId)}`
  );
}

function buildFilename(tab, index, total, fmt) {
  const parts = [];
  if (settings.naming === 'doc-tab' || settings.naming === 'num-doc-tab') {
    parts.push(doc.title);
  }
  if (settings.includeParents && tab.path.length > 1) {
    parts.push(...tab.path.slice(0, -1));
  }
  // A single-tab document has no distinct tab title; avoid "Doc – Doc.pdf".
  if (!(tab.single && parts.includes(doc.title))) parts.push(tab.title);

  let name = parts.map(sanitizeSegment).join(' – ');
  if (settings.naming === 'num-tab' || settings.naming === 'num-doc-tab') {
    const width = Math.max(2, String(total).length);
    name = `${String(index + 1).padStart(width, '0')} – ${name}`;
  }
  name = `${name.slice(0, 180)}.${fmt.ext}`;
  if (settings.subfolder && !settings.zipMode) {
    name = `${sanitizeSegment(doc.title)}/${name}`;
  }
  return name;
}

function selectedTabs() {
  return doc.tabs.filter((t) => selected.has(t.id));
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderFormatChips() {
  const wrap = $('formats');
  wrap.innerHTML = '';
  for (const f of FORMATS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.value = f.value;
    chip.textContent = `.${f.ext}`;
    chip.title = f.label;
    chip.setAttribute('aria-pressed', String(settings.formats.includes(f.value)));
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      if (on) {
        if (!settings.formats.includes(f.value)) settings.formats.push(f.value);
      } else {
        settings.formats = settings.formats.filter((v) => v !== f.value);
      }
      chip.setAttribute('aria-pressed', String(on));
      saveSettings();
      updateSelectionUi();
    });
    wrap.appendChild(chip);
  }
}

function renderSettings() {
  $('naming').value = settings.naming;
  $('includeParents').checked = settings.includeParents;
  $('subfolder').checked = settings.subfolder;
  $('zipMode').checked = settings.zipMode;
  $('subfolder').disabled = settings.zipMode;
}

function renderTabList() {
  const list = $('tabList');
  list.innerHTML = '';
  doc.tabs.forEach((tab) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.className = 'tab-row';
    label.style.paddingLeft = `${8 + tab.level * 18}px`;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(tab.id);
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(tab.id);
      else selected.delete(tab.id);
      updateSelectionUi();
    });

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = (tab.level > 0 ? '↳ ' : '') + tab.title;
    title.title = tab.title;

    label.append(cb, title);
    if (tab.id === doc.currentTabId) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'current';
      label.appendChild(badge);
    }
    li.appendChild(label);
    list.appendChild(li);
  });
  updateSelectionUi();
}

function updateSelectionUi() {
  const n = selected.size;
  const total = doc.tabs.length;
  const fmts = selectedFormats();
  const files = n * fmts.length;
  const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;

  $('selCount').textContent = `${n} of ${plural(total, 'tab')} selected`;
  $('fmtHint').textContent = fmts.length ? fmts.map((f) => f.ext).join(', ') : 'pick at least one';
  $('fileCount').textContent =
    files > 0
      ? fmts.length > 1
        ? `${plural(n, 'tab')} × ${plural(fmts.length, 'format')} = ${plural(files, 'file')}`
        : plural(files, 'file')
      : '';

  const btn = $('downloadBtn');
  btn.disabled = files === 0;
  if (files === 0) btn.textContent = 'Download';
  else if (settings.zipMode) btn.textContent = `Download .zip`;
  else if (fmts.length === 1) btn.textContent = `Download ${plural(n, fmts[0].ext.toUpperCase())}`;
  else btn.textContent = `Download ${plural(files, 'file')}`;
  renderFilenamePreview();
}

function renderFilenamePreview() {
  const el = $('filenamePreview');
  const tabs = selectedTabs();
  const fmts = selectedFormats();
  if (!tabs.length || !fmts.length) {
    el.textContent = '';
    return;
  }
  const first = buildFilename(tabs[0], 0, tabs.length, fmts[0]);
  const more = tabs.length * fmts.length > 1 ? ', …' : '';
  el.textContent = settings.zipMode ? `${zipName()}  →  ${first}${more}` : `e.g. ${first}${more}`;
}

function zipName() {
  const exts = selectedFormats().map((f) => f.ext).join('+');
  return `${sanitizeSegment(doc.title)} – tabs (${exts}).zip`;
}

function statusGlyph(item) {
  switch (item.status) {
    case 'done':
      return '✓';
    case 'warn':
      return '⚠';
    case 'failed':
      return '✕';
    case 'downloading':
    case 'retrying':
      return '<span class="spinner"></span>';
    default:
      return '○';
  }
}

function renderProgress(job) {
  show('progress');
  const list = $('progressList');
  list.innerHTML = '';
  let done = 0;
  let failed = 0;
  for (const item of job.items) {
    if (item.status === 'done' || item.status === 'warn') done++;
    if (item.status === 'failed') failed++;
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'tab-row';
    const st = document.createElement('span');
    st.className = `status ${item.status}`;
    st.innerHTML = statusGlyph(item);
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = item.filename;
    title.title = item.filename;
    row.append(st, title);
    li.appendChild(row);
    if (item.error) {
      const err = document.createElement('span');
      err.className = 'error-text';
      err.textContent = item.error;
      li.appendChild(err);
    }
    list.appendChild(li);
  }

  const total = job.items.length;
  const summary = $('jobSummary');
  if (!job.done) {
    const verb = job.mode === 'zip' ? 'Exporting' : 'Downloading';
    let text = `${verb} ${done + failed} / ${total}…`;
    if (job.throttled && job.paceMs) {
      const left = total - done - failed;
      const secs = Math.round((left * job.paceMs) / 1000);
      const eta = secs >= 90 ? `≈ ${Math.round(secs / 60)} min` : `≈ ${secs} s`;
      text += ` ${eta} left`;
    }
    summary.textContent = text;
  } else if (job.cancelled) {
    summary.textContent = 'Cancelled';
  } else if (job.mode === 'zip') {
    summary.textContent = job.error
      ? 'Failed'
      : `${done} file${done === 1 ? '' : 's'} bundled into .zip${failed ? `, ${failed} failed` : ''}`;
  } else {
    summary.textContent = failed ? `${done} downloaded, ${failed} failed` : `${done} downloaded`;
  }

  const msg = $('jobMsg');
  if (job.error) {
    msg.textContent = job.error;
    msg.classList.remove('info');
  } else if (job.throttled && !job.done) {
    msg.textContent =
      `Google limits exports to about one every ${Math.round((job.paceMs || 5000) / 1000)} s per document ` +
      '(after a short burst). The extension paces itself to that limit – you can close this popup, downloads continue.';
    msg.classList.add('info');
  } else {
    msg.textContent = '';
    msg.classList.remove('info');
  }
  $('cancelBtn').classList.toggle('hidden', job.done);
  $('doneBtn').classList.toggle('hidden', !job.done);
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function saveSettings() {
  try {
    await chrome.storage.sync.set({ settings });
  } catch {
    /* ignore */
  }
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get('settings');
    settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
    // Migrate from the old single-format setting.
    if (typeof settings.format === 'string') {
      settings.formats = [settings.format];
      delete settings.format;
    }
    settings.formats = (Array.isArray(settings.formats) ? settings.formats : []).filter((v) =>
      FORMATS.some((f) => f.value === v)
    );
    if (!settings.formats.length) settings.formats = ['pdf'];
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

async function getTargetTab() {
  // Dev/testing aid: popup.html?tab=<chromeTabId> opens the picker for that
  // tab even when popup.html is loaded in a normal browser tab.
  const override = new URLSearchParams(location.search).get('tab');
  if (override && /^\d+$/.test(override)) {
    try {
      return await chrome.tabs.get(Number(override));
    } catch {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function loadDocument() {
  const tab = await getTargetTab();
  activeTabId = tab ? tab.id : null;

  if (!tab || !tab.url || !DOC_URL_RE.test(tab.url)) {
    $('docTitle').textContent = '';
    $('emptyMsg').textContent =
      'Open a Google Doc first, then click this icon to download its document tabs as separate files.';
    show('empty');
    return false;
  }

  let result;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeDocument,
    });
    result = injection && injection.result;
  } catch (err) {
    $('emptyMsg').textContent = `Could not read the document: ${err.message}`;
    show('empty');
    return false;
  }

  if (!result || result.error) {
    $('emptyMsg').textContent = 'This page does not look like a Google Docs document.';
    show('empty');
    return false;
  }

  doc = { ...result, tabs: withPaths(result.tabs) };
  $('docTitle').textContent = doc.title;
  $('docTitle').title = doc.title;

  selected = new Set(doc.tabs.map((t) => t.id)); // default: everything selected
  renderTabList();
  show('select');
  return true;
}

async function startDownload() {
  const tabs = selectedTabs();
  const fmts = selectedFormats();
  if (!tabs.length || !fmts.length) return;

  // Tab-major order: all formats of tab 1, then all formats of tab 2, ...
  const items = [];
  tabs.forEach((t, i) => {
    for (const fmt of fmts) {
      items.push({
        id: t.id,
        title: t.title,
        format: fmt.value,
        url: exportUrl(t.id, fmt),
        filename: buildFilename(t, i, tabs.length, fmt),
      });
    }
  });

  const jobSpec = {
    id: `${doc.docId}:${Date.now()}`,
    docId: doc.docId,
    userIndex: doc.userIndex,
    docTitle: doc.title,
    allTabs: doc.tabs.map((t) => ({ id: t.id, title: t.title })),
    formats: fmts.map((f) => f.value),
    mode: settings.zipMode ? 'zip' : 'files',
    zipName: settings.zipMode ? zipName() : undefined,
    items,
  };

  const res = await chrome.runtime.sendMessage({ type: 'START_JOB', job: jobSpec });
  if (!res || !res.ok) {
    $('jobMsg').textContent = (res && res.error) || 'Could not start the download.';
    return;
  }
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (state) renderProgress(state);
}

function wireEvents() {
  $('selAll').addEventListener('click', () => {
    selected = new Set(doc.tabs.map((t) => t.id));
    renderTabList();
  });
  $('selNone').addEventListener('click', () => {
    selected = new Set();
    renderTabList();
  });
  $('selCurrent').addEventListener('click', () => {
    selected = new Set([doc.currentTabId]);
    if (!doc.tabs.some((t) => t.id === doc.currentTabId)) {
      const cur = doc.tabs.find((t) => t.selected);
      selected = new Set(cur ? [cur.id] : []);
    }
    renderTabList();
  });

  $('naming').addEventListener('change', (e) => {
    settings.naming = e.target.value;
    saveSettings();
    renderFilenamePreview();
  });
  for (const key of ['includeParents', 'subfolder', 'zipMode']) {
    $(key).addEventListener('change', (e) => {
      settings[key] = e.target.checked;
      saveSettings();
      renderSettings();
      updateSelectionUi();
    });
  }

  $('downloadBtn').addEventListener('click', startDownload);
  $('retryBtn').addEventListener('click', () => loadDocument());
  $('cancelBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CANCEL_JOB' });
  });
  $('doneBtn').addEventListener('click', async () => {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (state) dismissedJobId = state.id;
    await chrome.runtime.sendMessage({ type: 'CLEAR_JOB' });
    if (doc) {
      renderTabList();
      show('select');
    } else {
      loadDocument();
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'PROGRESS' && msg.job && msg.job.id !== dismissedJobId) {
      renderProgress(msg.job);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

(async function init() {
  await loadSettings();
  renderFormatChips();
  renderSettings();
  wireEvents();

  // If a job is still running (popup was closed and reopened), show it.
  let running = null;
  try {
    running = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  } catch {
    /* service worker not awake yet – fine */
  }

  await loadDocument();

  if (running && !running.done) {
    renderProgress(running);
  }
})();
