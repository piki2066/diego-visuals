'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const express = require('express');
const multer = require('multer');
const { applyContent, normalizeContent } = require('./generate');
const GH = require('./github-sync');

// ── Rutas ──────────────────────────────────────────────────────────────
const SITE_DIR = path.join(__dirname, '..');
const INDEX_PATH = path.join(SITE_DIR, 'index.html');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(SITE_DIR, 'assets', 'uploads');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const CONTENT_PATH = path.join(DATA_DIR, 'content.json');

const PORT = process.env.PORT || 4173;
const PASSWORD = process.env.ADMIN_PASSWORD || GH.loadConfig().password || 'diego2026';
const SESSION_TTL = 7 * 24 * 3600 * 1000;
const MAX_BACKUPS = 50;

for (const dir of [DATA_DIR, BACKUPS_DIR, UPLOADS_DIR]) fs.mkdirSync(dir, { recursive: true });

// Si DATA_DIR es un volumen nuevo sin contenido, sembrarlo con el content.json del repo.
const SEED_CONTENT = path.join(__dirname, 'data', 'content.json');
if (!fs.existsSync(CONTENT_PATH) && fs.existsSync(SEED_CONTENT)) {
  fs.copyFileSync(SEED_CONTENT, CONTENT_PATH);
}

// ── ffmpeg (para re-codificar el vídeo del hero a all-intra) ───────────
function findFfmpeg() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  try {
    const p = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg']).toString().trim().split('\n')[0];
    if (p) return p;
  } catch (_) { /* no está en PATH */ }
  try { return require('ffmpeg-static'); } catch (_) { return null; }
}
const FFMPEG = findFfmpeg();

// El scroll-scrub del hero busca frames constantemente: cada frame debe ser
// keyframe (all-intra), si no el seeking va a saltos.
function encodeAllIntra(input, output) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, [
      '-y', '-i', input,
      '-an',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-g', '1', '-keyint_min', '1', '-bf', '0',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=min(1920\\,iw):-2',
      '-movflags', '+faststart',
      output,
    ], { timeout: 15 * 60 * 1000 }, (err, _out, stderr) => {
      if (err) reject(new Error(`ffmpeg: ${err.message}\n${String(stderr).slice(-800)}`));
      else resolve();
    });
  });
}

// ── Contenido y regeneración ───────────────────────────────────────────
function readContent() {
  try {
    return JSON.parse(fs.readFileSync(CONTENT_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

function regenerate(content) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const { html: out, missing } = applyContent(html, content);
  if (missing.length) console.warn('[panel] marcadores ausentes en index.html:', missing.join(', '));
  if (out !== html) fs.writeFileSync(INDEX_PATH, out);
  return missing;
}

function backupNow() {
  const stamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 19);
  const dir = path.join(BACKUPS_DIR, stamp);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(CONTENT_PATH)) fs.copyFileSync(CONTENT_PATH, path.join(dir, 'content.json'));
  if (fs.existsSync(INDEX_PATH)) fs.copyFileSync(INDEX_PATH, path.join(dir, 'index.html'));
  // Podar backups antiguos
  const all = fs.readdirSync(BACKUPS_DIR).filter((d) => /^[\d_-]+$/.test(d)).sort();
  while (all.length > MAX_BACKUPS) {
    fs.rmSync(path.join(BACKUPS_DIR, all.shift()), { recursive: true, force: true });
  }
  return stamp;
}

// ── Sesiones ───────────────────────────────────────────────────────────
const sessions = new Map(); // token → expiry
const previews = new Map(); // token → html
const loginAttempts = new Map(); // ip → [timestamps]

function getToken(req) {
  const m = /(?:^|;\s*)panel_token=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

function isAuthed(req) {
  const token = getToken(req);
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    sessions.delete(token);
    previews.delete(token);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  if (!isAuthed(req)) return res.status(401).json({ error: 'No autorizado' });
  next();
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ── App ────────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

const noCache = { 'Cache-Control': 'no-cache' };

app.get(['/', '/index.html'], (_req, res) => {
  res.set(noCache).sendFile(INDEX_PATH);
});

// Los archivos subidos pueden vivir en un volumen aparte (UPLOADS_DIR):
// se montan antes que el resto de /assets.
app.use('/assets/uploads', express.static(UPLOADS_DIR, { maxAge: '365d', immutable: true }));
app.use('/assets', express.static(path.join(SITE_DIR, 'assets'), { maxAge: '1h' }));

app.get(['/admin', '/admin/'], (_req, res) => {
  res.set(noCache).sendFile(path.join(__dirname, 'admin.html'));
});

// ── API ────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const attempts = (loginAttempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (attempts.length >= 8) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
  }
  attempts.push(now);
  loginAttempts.set(ip, attempts);

  if (!safeEqual(req.body && req.body.password, PASSWORD)) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, now + SESSION_TTL);
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `panel_token=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax${secure}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = getToken(req);
  if (token) { sessions.delete(token); previews.delete(token); }
  res.set('Set-Cookie', 'panel_token=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/status', requireAuth, (_req, res) => {
  res.json({ ok: true, ffmpeg: !!FFMPEG, github: !!GH.ghConfig() });
});

// Empuja la web al repo (GitHub Pages la publica). Devuelve el estado para el panel.
async function pushToWeb() {
  if (!GH.ghConfig()) return { web: 'off' };
  try {
    await GH.push('Actualización desde el panel');
    return { web: 'ok' };
  } catch (err) {
    console.error('[panel] push a GitHub falló:', err.message);
    return { web: 'error', webError: 'Los cambios están guardados en este ordenador, pero no se pudieron subir a internet. Comprueba tu conexión y vuelve a pulsar Publicar.' };
  }
}

app.get('/api/content', requireAuth, (_req, res) => {
  const content = readContent();
  if (!content) return res.status(500).json({ error: 'No se pudo leer el contenido' });
  res.json(normalizeContent(content));
});

app.post('/api/publish', requireAuth, async (req, res) => {
  try {
    const content = normalizeContent(req.body && req.body.content);
    backupNow();
    fs.writeFileSync(CONTENT_PATH, JSON.stringify(content, null, 2));
    const missing = regenerate(content);
    const webStatus = await pushToWeb();
    res.json({ ok: true, missing, ...webStatus });
  } catch (err) {
    console.error('[panel] error al publicar:', err);
    res.status(500).json({ error: 'Error al publicar los cambios' });
  }
});

app.post('/api/preview', requireAuth, (req, res) => {
  try {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    const { html: out } = applyContent(html, req.body && req.body.content);
    previews.set(getToken(req), out);
    res.json({ ok: true });
  } catch (err) {
    console.error('[panel] error en preview:', err);
    res.status(500).json({ error: 'Error al generar la vista previa' });
  }
});

app.get('/preview', (req, res) => {
  if (!isAuthed(req)) return res.redirect('/admin');
  const html = previews.get(getToken(req));
  if (!html) return res.redirect('/admin');
  res.set(noCache).type('html').send(html);
});

app.get('/api/backups', requireAuth, (_req, res) => {
  const list = fs.readdirSync(BACKUPS_DIR)
    .filter((d) => /^[\d_-]+$/.test(d) && fs.existsSync(path.join(BACKUPS_DIR, d, 'content.json')))
    .sort()
    .reverse();
  res.json({ backups: list });
});

app.post('/api/restore', requireAuth, async (req, res) => {
  const id = String((req.body && req.body.id) || '');
  if (!/^[\d_-]+$/.test(id)) return res.status(400).json({ error: 'Backup no válido' });
  const file = path.join(BACKUPS_DIR, id, 'content.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Backup no encontrado' });
  try {
    backupNow();
    const content = normalizeContent(JSON.parse(fs.readFileSync(file, 'utf8')));
    fs.writeFileSync(CONTENT_PATH, JSON.stringify(content, null, 2));
    regenerate(content);
    const webStatus = await pushToWeb();
    res.json({ ok: true, content, ...webStatus });
  } catch (err) {
    console.error('[panel] error al restaurar:', err);
    res.status(500).json({ error: 'Error al restaurar el backup' });
  }
});

// ── Subida de archivos ─────────────────────────────────────────────────
const KINDS = {
  hero:    { exts: ['.mp4', '.mov', '.webm'], maxMB: 500 },
  preview: { exts: ['.mp4', '.mov', '.webm'], maxMB: 60 },
  thumb:   { exts: ['.jpg', '.jpeg', '.png', '.webp'], maxMB: 15 },
  photo:   { exts: ['.jpg', '.jpeg', '.png', '.webp'], maxMB: 15 },
};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const kind = KINDS[req.query.kind] ? req.query.kind : 'file';
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
      cb(null, `${kind}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  const kind = KINDS[req.query.kind];
  const fail = (code, msg) => {
    if (file) fs.rmSync(file.path, { force: true });
    res.status(code).json({ error: msg });
  };
  if (!file) return fail(400, 'No se recibió ningún archivo');
  if (!kind) return fail(400, 'Tipo de archivo no válido');
  const ext = path.extname(file.filename).toLowerCase();
  if (!kind.exts.includes(ext)) {
    return fail(400, `Formato no admitido. Usa: ${kind.exts.join(', ')}`);
  }
  if (file.size > kind.maxMB * 1024 * 1024) {
    return fail(413, `El archivo pesa demasiado (máximo ${kind.maxMB} MB)`);
  }

  // El vídeo del hero se re-codifica a all-intra para que el scroll vaya fluido.
  if (req.query.kind === 'hero' && FFMPEG) {
    const encoded = path.join(UPLOADS_DIR, `hero-${Date.now()}-scrub.mp4`);
    try {
      await encodeAllIntra(file.path, encoded);
      fs.rmSync(file.path, { force: true });
      return res.json({ ok: true, path: `assets/uploads/${path.basename(encoded)}`, encoded: true });
    } catch (err) {
      console.error('[panel] fallo re-codificando hero:', err.message);
      fs.rmSync(encoded, { force: true });
      // Se usa el original tal cual; el panel avisa de que el scroll puede ir a saltos.
      return res.json({ ok: true, path: `assets/uploads/${file.filename}`, encoded: false });
    }
  }

  res.json({ ok: true, path: `assets/uploads/${file.filename}`, encoded: req.query.kind !== 'hero' });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(413).json({ error: 'El archivo pesa demasiado' });
  }
  console.error('[panel] error:', err);
  res.status(500).json({ error: 'Error interno' });
});

// ── Arranque ───────────────────────────────────────────────────────────
(async () => {
  // Si Alex publicó diseño o contenido desde otra máquina, esta copia lo adopta.
  if (GH.ghConfig()) {
    try {
      const { pulled } = await GH.pull();
      if (pulled) console.log(`[panel] sincronizado desde GitHub (${pulled} archivo/s actualizados)`);
    } catch (err) {
      console.warn('[panel] sin conexión con GitHub al arrancar (se sigue en local):', err.message);
    }
  }

  const content = readContent();
  if (content) {
    try {
      regenerate(content);
      console.log('[panel] index.html regenerado desde content.json');
    } catch (err) {
      console.error('[panel] no se pudo regenerar al arrancar:', err.message);
    }
  }

  app.listen(PORT, () => {
    console.log(`[panel] web:   http://localhost:${PORT}/`);
    console.log(`[panel] panel: http://localhost:${PORT}/admin`);
    console.log(`[panel] ffmpeg: ${FFMPEG ? FFMPEG : 'NO disponible (el vídeo del hero no se re-codificará)'}`);
    console.log(`[panel] GitHub: ${GH.ghConfig() ? 'configurado — Publicar sube la web a internet' : 'sin configurar — los cambios se quedan en esta máquina'}`);
    if (PASSWORD === 'diego2026') {
      console.warn('[panel] AVISO: usando contraseña por defecto. Ponla en panel/config.local.json.');
    }
  });
})();
