/*
 * DEV ONLY – not shipped. Stripped by tools/build.js.
 *
 * When popup.html is embedded in an iframe with ?tab=<id> (see getTargetTab in
 * popup.js), this exposes a tiny postMessage API so automated tests running in
 * the host page can inspect and drive the popup UI:
 *
 *   frame.contentWindow.postMessage({__dtd: true, id, cmd: 'state'}, '*')
 *   frame.contentWindow.postMessage({__dtd: true, id, cmd: 'click', selector}, '*')
 *   frame.contentWindow.postMessage({__dtd: true, id, cmd: 'set', selector, value}, '*')
 *
 * Every command answers with {__dtd: true, id, result}.
 */
(() => {
  const embedded = window.parent !== window || !!window.opener;
  if (!embedded) return;
  if (!new URLSearchParams(location.search).get('tab')) return;

  const safeHost = (u) => { try { return new URL(u).host; } catch { return null; } };
  const safePath = (u) => { try { return new URL(u).pathname.slice(0, 80); } catch { return null; } };

  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent : null;
  };

  function snapshot() {
    const view = [...document.querySelectorAll('.view')].find((v) => !v.classList.contains('hidden'));
    return {
      view: view ? view.id : null,
      docTitle: text('#docTitle'),
      emptyMsg: text('#emptyMsg'),
      selCount: text('#selCount'),
      tabs: [...document.querySelectorAll('#tabList .tab-row')].map((r) => ({
        title: r.querySelector('.title').textContent,
        checked: r.querySelector('input').checked,
        badge: r.querySelector('.badge') ? r.querySelector('.badge').textContent : null,
        indent: r.style.paddingLeft,
      })),
      formats: [...document.querySelectorAll('.chip')].map((c) => ({
        value: c.dataset.value,
        on: c.getAttribute('aria-pressed') === 'true',
      })),
      fmtHint: text('#fmtHint'),
      fileCount: text('#fileCount'),
      preview: text('#filenamePreview'),
      button: text('#downloadBtn'),
      buttonDisabled: document.getElementById('downloadBtn').disabled,
      options: {
        naming: document.getElementById('naming').value,
        includeParents: document.getElementById('includeParents').checked,
        subfolder: document.getElementById('subfolder').checked,
        subfolderDisabled: document.getElementById('subfolder').disabled,
        zipMode: document.getElementById('zipMode').checked,
      },
      progress: [...document.querySelectorAll('#progressList li')].map((li) => ({
        status: li.querySelector('.status').className.replace('status ', ''),
        name: li.querySelector('.title').textContent,
        error: li.querySelector('.error-text') ? li.querySelector('.error-text').textContent : null,
      })),
      summary: text('#jobSummary'),
      jobMsg: text('#jobMsg'),
      cancelHidden: document.getElementById('cancelBtn').classList.contains('hidden'),
      doneHidden: document.getElementById('doneBtn').classList.contains('hidden'),
    };
  }

  window.addEventListener('message', async (ev) => {
    const msg = ev.data;
    if (!msg || msg.__dtd !== true || !msg.cmd) return;
    let result;
    try {
      switch (msg.cmd) {
        case 'downloads': {
          const recs = await chrome.downloads.search({ limit: msg.limit || 10, orderBy: ['-startTime'] });
          result = recs.map((r) => ({
            id: r.id, state: r.state, filename: r.filename, url: r.url.slice(0, 120), mime: r.mime,
            host: safeHost(r.url), finalHost: safeHost(r.finalUrl), finalPath: safePath(r.finalUrl),
            bytesReceived: r.bytesReceived, totalBytes: r.totalBytes, danger: r.danger,
            paused: r.paused, error: r.error, exists: r.exists, byExtensionName: r.byExtensionName,
          }));
          break;
        }
        case 'job':
          result = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
          break;
        case 'dl': {
          // Fire a raw chrome.downloads.download and report its record after a delay.
          const opts = { url: msg.url, conflictAction: 'uniquify', saveAs: false };
          if (msg.filename) opts.filename = msg.filename;
          let id, err;
          try {
            id = await chrome.downloads.download(opts);
          } catch (e) {
            err = String(e && e.message ? e.message : e);
          }
          await new Promise((r) => setTimeout(r, msg.wait || 3000));
          const [rec] = id ? await chrome.downloads.search({ id }) : [null];
          result = { id, err, state: rec && rec.state, filename: rec && rec.filename, error: rec && rec.error, bytes: rec && rec.bytesReceived };
          break;
        }
        case 'fetch': {
          // Probe an export URL from the extension context.
          const out = {};
          try {
            const res = await fetch(msg.url, { credentials: 'include', redirect: msg.redirect || 'follow' });
            out.status = res.status;
            out.type = res.type;
            out.redirected = res.redirected;
            out.finalHost = res.url ? new URL(res.url).host : null;
            out.contentType = res.headers.get('content-type');
            out.location = res.headers.get('location');
            out.retryAfter = res.headers.get('retry-after');
            out.disposition = res.headers.get('content-disposition');
            const buf = await res.arrayBuffer();
            out.len = buf.byteLength;
            if (msg.text) out.text = new TextDecoder().decode(buf).slice(0, msg.text);
          } catch (e) {
            out.error = String(e && e.message ? e.message : e);
          }
          result = out;
          break;
        }
        case 'cancel': {
          for (const id of msg.ids || []) {
            try { await chrome.downloads.cancel(id); } catch {}
            try { await chrome.downloads.erase({ id }); } catch {}
          }
          result = 'ok';
          break;
        }
        case 'state':
          result = snapshot();
          break;
        case 'click': {
          const el = document.querySelector(msg.selector);
          if (!el) throw new Error('no element: ' + msg.selector);
          el.click();
          result = snapshot();
          break;
        }
        case 'set': {
          const el = document.querySelector(msg.selector);
          if (!el) throw new Error('no element: ' + msg.selector);
          if (el.type === 'checkbox') el.checked = !!msg.value;
          else el.value = msg.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          result = snapshot();
          break;
        }
        default:
          throw new Error('unknown cmd ' + msg.cmd);
      }
    } catch (err) {
      result = { error: String(err && err.message ? err.message : err) };
    }
    ev.source.postMessage({ __dtd: true, id: msg.id, result }, '*');
  });
})();
