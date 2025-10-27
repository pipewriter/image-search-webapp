// server.js
// Node 18+ required (built-in fetch). Run: npm i express && node server.js

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure a downloads folder exists for saved images

const DOWNLOADS_DIR = path.join(`C:\\Users\\prdia\\Dropbox\\_ps36_quadtree\\Worlds\\363539079185280926\\DumpFolder`);
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

// Body parser for JSON
app.use(express.json({ limit: '1mb' }));

// Serve the single-page webapp from the same domain (different route is fine; here we use '/')
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Optionally serve the downloads folder so you can preview saved files in the browser
app.use('/downloads', express.static(DOWNLOADS_DIR, { maxAge: '1d' }));

// Very simple endpoint: accepts { url }, downloads, writes to disk
app.post('/api/download', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing "url" in JSON body.' });
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid URL.' });
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      return res.status(400).json({ ok: false, error: 'Only http/https URLs are allowed.' });
    }

    // Fetch the resource (follow redirects)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
    let response;
    try {
      response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SimpleImageDownloader/1.0)',
          'Accept': 'image/*,*/*;q=0.8',
          // Some hosts require a referer — safest is the origin of the URL itself:
          'Referer': parsed.origin + '/',
        },
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return res.status(response.status).json({ ok: false, error: `Upstream responded ${response.status}` });
    }

    // Check content-type to choose an extension; fall back to URL path’s ext if needed
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const extFromType = extFromContentType(contentType);
    const extFromUrl = safeExt(path.extname(parsed.pathname).split('?')[0]);
    const ext = extFromType || extFromUrl || '.img';

    const filename = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filepath = path.join(DOWNLOADS_DIR, filename);

    // Simpler (memory) approach: buffer then write
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filepath, buffer);

    return res.json({
      ok: true,
      savedAs: filename,
    //   path:`C:\\Users\\prdia\\Dropbox\\_ps36_quadtree\\Worlds\\363539079185280926\\DumpFolder\\${encodeURIComponent(filename)}`,
    //   path: `/downloads/${encodeURIComponent(filename)}`,
      bytesWritten: buffer.length,
      contentType,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return res.status(504).json({ ok: false, error: 'Download timed out.' });
    }
    console.error('Download error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to download image.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT} to use the gallery.`);
});

// Helpers
function extFromContentType(ct) {
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
    'image/tiff': '.tif',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
  };
  return map[ct] || (ct.startsWith('image/') ? `.${ct.split('/')[1].replace('+xml', '')}` : '');
}

function safeExt(ext) {
  if (!ext) return '';
  // ensure it looks like ".xxx" and is alphanumeric-ish
  const cleaned = ext.replace(/[^a-z0-9.]/gi, '').toLowerCase();
  if (!cleaned.startsWith('.')) return '';
  if (cleaned.length > 10) return ''; // unreasonable
  return cleaned;
}
