/*
 * Builds a store-ready package in dist/:
 *   dist/tab-downloader-for-google-docs-<version>/   (clean unpacked copy)
 *   dist/tab-downloader-for-google-docs-<version>.zip (upload this)
 *
 * Strips everything that exists only for development:
 *   - dev-bridge.js and its <script> tag in popup.html
 *   - web_accessible_resources in manifest.json (only needed to embed the
 *     popup during automated testing)
 *
 * Run: node tools/build.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const slug = 'tab-downloader-for-google-docs';
const outDir = path.join(root, 'dist', `${slug}-${manifest.version}`);
const zipPath = path.join(root, 'dist', `${slug}-${manifest.version}.zip`);

const INCLUDE = ['manifest.json', 'background.js', 'zip.js', 'popup.html', 'popup.css', 'popup.js', 'icons'];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const entry of INCLUDE) {
  fs.cpSync(path.join(root, entry), path.join(outDir, entry), { recursive: true });
}

// manifest: drop dev-only keys
const cleanManifest = { ...manifest };
delete cleanManifest.web_accessible_resources;
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(cleanManifest, null, 2) + '\n');

// popup.html: drop the dev bridge script tag
const popupPath = path.join(outDir, 'popup.html');
const popup = fs.readFileSync(popupPath, 'utf8');
const cleaned = popup.replace(/^[ \t]*<script src="dev-bridge\.js"><\/script>.*\r?\n/m, '');
if (cleaned === popup) {
  console.warn('warning: dev-bridge script tag not found in popup.html (already clean?)');
}
if (/dev-bridge/.test(cleaned)) throw new Error('dev-bridge reference still present in popup.html');
fs.writeFileSync(popupPath, cleaned);

// Sanity checks
for (const f of ['background.js', 'popup.js', 'zip.js']) {
  execFileSync(process.execPath, ['--check', path.join(outDir, f)], { stdio: 'inherit' });
}
const bad = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
for (const f of ['background.js', 'popup.js', 'zip.js', 'popup.html', 'popup.css', 'manifest.json']) {
  if (bad.test(fs.readFileSync(path.join(outDir, f), 'utf8'))) throw new Error(`control characters in ${f}`);
}

// Zip. Windows 10+ ships bsdtar as tar.exe, which writes proper forward-slash
// entry names (PowerShell's Compress-Archive writes backslashes, which the
// Chrome Web Store does not reliably accept). Elsewhere use the zip CLI.
fs.rmSync(zipPath, { force: true });
if (process.platform === 'win32') {
  // Use the absolute path: inside Git Bash a GNU tar shadows it and treats "F:" as a hostname.
  const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(bsdtar, ['-a', '-c', '-f', zipPath, '-C', outDir, ...INCLUDE], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', zipPath, '.'], { cwd: outDir, stdio: 'inherit' });
}

console.log(`\nBuilt ${path.relative(root, zipPath)} (v${manifest.version})`);
console.log('Unpacked copy:', path.relative(root, outDir));
