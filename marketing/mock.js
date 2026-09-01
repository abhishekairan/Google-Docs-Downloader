/*
 * Renders a static replica of the extension popup for marketing images.
 * Uses the real popup.css so the artwork matches the shipped UI exactly.
 *
 *   renderMockPopup(container, {
 *     view: 'select' | 'progress',
 *     doc: 'Product Requirements',
 *     tabs: [{ title, level, checked, current }],
 *     formats: ['pdf', 'md'],
 *     options: { open: true, naming: 'doc-tab', includeParents: true, subfolder: false, zip: false },
 *     progress: [{ name, status, error }], summary, info
 *   })
 */
const ALL_FORMATS = ['pdf', 'docx', 'odt', 'rtf', 'txt', 'md', 'html', 'epub'];
const NAMING_LABELS = {
  'doc-tab': 'Document – Tab',
  tab: 'Tab only',
  'num-tab': '01 – Tab',
  'num-doc-tab': '01 – Document – Tab',
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of [].concat(children)) if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

function renderMockPopup(container, cfg) {
  const popup = el('div', { class: 'mock-popup' });

  popup.appendChild(
    el('header', { class: 'header' }, [
      el('img', { src: '../icons/icon32.png', width: 24, height: 24, alt: '' }),
      el('div', { class: 'header-text' }, [
        el('h1', { text: 'Docs Tab Downloader' }),
        el('p', { class: 'doc-title', text: cfg.doc || '' }),
      ]),
    ])
  );

  const main = el('main');
  popup.appendChild(main);

  if (cfg.view === 'progress') {
    const section = el('section', { class: 'view' });
    const list = el('ul', { class: 'tab-list progress' });
    for (const p of cfg.progress) {
      const li = el('li');
      const glyph =
        p.status === 'done' ? '✓' : p.status === 'failed' ? '✕' : p.status === 'warn' ? '⚠' : p.status === 'queued' ? '○' : '';
      const st = el('span', { class: `status ${p.status}` });
      if (p.status === 'downloading' || p.status === 'retrying') st.appendChild(el('span', { class: 'spinner' }));
      else st.textContent = glyph;
      li.appendChild(el('div', { class: 'tab-row' }, [st, el('span', { class: 'title', text: p.name })]));
      if (p.error) li.appendChild(el('span', { class: 'error-text', text: p.error }));
      list.appendChild(li);
    }
    section.appendChild(list);
    section.appendChild(el('p', { class: 'job-msg' + (cfg.info ? ' info' : ''), text: cfg.info || cfg.error || '' }));
    section.appendChild(
      el('div', { class: 'footer' }, [
        el('span', { class: 'muted', text: cfg.summary || '' }),
        el('span', { class: 'spacer' }),
        cfg.done
          ? el('button', { class: 'btn primary', text: 'Done' })
          : el('button', { class: 'btn secondary', text: 'Cancel' }),
      ])
    );
    main.appendChild(section);
    container.appendChild(popup);
    return popup;
  }

  const section = el('section', { class: 'view' });
  const selectedCount = cfg.tabs.filter((t) => t.checked).length;
  section.appendChild(
    el('div', { class: 'toolbar' }, [
      el('span', { class: 'muted', text: `${selectedCount} of ${cfg.tabs.length} tabs selected` }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'link', text: 'All' }),
      el('button', { class: 'link', text: 'None' }),
      el('button', { class: 'link', text: 'Current' }),
    ])
  );

  const list = el('ul', { class: 'tab-list' });
  for (const t of cfg.tabs) {
    const row = el('label', { class: 'tab-row', style: `padding-left:${8 + (t.level || 0) * 18}px` }, [
      el('input', { type: 'checkbox', checked: !!t.checked }),
      el('span', { class: 'title', text: (t.level ? '↳ ' : '') + t.title }),
      t.current ? el('span', { class: 'badge', text: 'current' }) : null,
    ]);
    list.appendChild(el('li', {}, row));
  }
  section.appendChild(list);

  const o = cfg.options || {};
  const details = el('details', { class: 'options', open: !!o.open }, [
    el('summary', { text: 'Options' }),
    el('label', { class: 'row' }, [
      el('span', { text: 'File names' }),
      el('select', {}, Object.entries(NAMING_LABELS).map(([v, l]) => el('option', { value: v, text: l, selected: (o.naming || 'doc-tab') === v }))),
    ]),
    el('label', { class: 'row check' }, [el('input', { type: 'checkbox', checked: o.includeParents !== false }), el('span', { text: 'Prefix subtabs with their parent tab name' })]),
    el('label', { class: 'row check' }, [el('input', { type: 'checkbox', checked: !!o.subfolder, disabled: !!o.zip }), el('span', { text: 'Save into a folder named after the document' })]),
    el('label', { class: 'row check' }, [el('input', { type: 'checkbox', checked: !!o.zip }), el('span', { text: 'Bundle everything into a single .zip' })]),
    el('p', { class: 'preview muted', text: o.preview || '' }),
  ]);
  section.appendChild(details);

  const fmts = cfg.formats || ['pdf'];
  section.appendChild(
    el('div', { class: 'formats-block' }, [
      el('div', { class: 'toolbar' }, [
        el('span', { class: 'muted', text: 'Formats' }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'muted small', text: fmts.join(', ') }),
      ]),
      el('div', { class: 'chips' }, ALL_FORMATS.map((f) => el('button', { class: 'chip', 'aria-pressed': String(fmts.includes(f)), text: '.' + f }))),
    ])
  );

  const files = selectedCount * fmts.length;
  const countText = fmts.length > 1 ? `${selectedCount} tabs × ${fmts.length} formats = ${files} files` : `${files} file${files === 1 ? '' : 's'}`;
  const btnText = o.zip ? 'Download .zip' : fmts.length === 1 ? `Download ${selectedCount} ${fmts[0].toUpperCase()}${selectedCount === 1 ? '' : 's'}` : `Download ${files} files`;
  section.appendChild(
    el('div', { class: 'footer' }, [
      el('span', { class: 'muted', text: countText }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn primary', text: btnText }),
    ])
  );
  main.appendChild(section);
  container.appendChild(popup);
  return popup;
}

/** A stylised (non-Google) document editor backdrop with a tabs sidebar. */
function renderDocBackdrop(container, { title, tabs, activeIndex = 0, bodyLines = 14 }) {
  const wrap = el('div', { class: 'doc-backdrop' });
  wrap.appendChild(
    el('div', { class: 'doc-topbar' }, [
      el('div', { class: 'doc-logo' }),
      el('div', {}, [
        el('div', { class: 'doc-name', text: title }),
        el('div', { class: 'doc-menu', text: 'File   Edit   View   Insert   Format   Tools   Extensions   Help' }),
      ]),
    ])
  );
  const body = el('div', { class: 'doc-body' });
  const side = el('div', { class: 'doc-side' }, [el('div', { class: 'doc-side-title', text: 'Document tabs' })]);
  tabs.forEach((t, i) => {
    side.appendChild(
      el('div', { class: 'doc-side-item' + (i === activeIndex ? ' active' : ''), style: `padding-left:${14 + (t.level || 0) * 16}px` }, [
        el('span', { class: 'doc-side-icon' }),
        el('span', { text: t.title }),
      ])
    );
  });
  body.appendChild(side);
  const page = el('div', { class: 'doc-page' });
  page.appendChild(el('div', { class: 'doc-h1', text: tabs[activeIndex].title }));
  for (let i = 0; i < bodyLines; i++) {
    const w = [96, 88, 92, 70, 0, 94, 85, 90, 60][i % 9];
    page.appendChild(w ? el('div', { class: 'doc-line', style: `width:${w}%` }) : el('div', { class: 'doc-gap' }));
  }
  body.appendChild(page);
  wrap.appendChild(body);
  container.appendChild(wrap);
  return wrap;
}
