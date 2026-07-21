'use strict';

// Sincronización con GitHub por API REST (sin git instalado).
// - push(): sube index.html + content.json + assets/ como un commit.
// - pull(): baja index.html + content.json si alguien publicó desde otra máquina.
// Config en panel/config.local.json (NUNCA se sube al repo):
//   { "password": "...", "github": { "owner": "...", "repo": "...", "branch": "main", "token": "github_pat_..." } }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITE_DIR = path.join(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'config.local.json');
const API = 'https://api.github.com';

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

function ghConfig() {
  const cfg = loadConfig().github || {};
  const owner = process.env.GITHUB_OWNER || cfg.owner;
  const repo = process.env.GITHUB_REPO || cfg.repo;
  const token = process.env.GITHUB_TOKEN || cfg.token;
  const branch = process.env.GITHUB_BRANCH || cfg.branch || 'main';
  if (!owner || !repo || !token) return null;
  return { owner, repo, token, branch };
}

async function api(cfg, method, endpoint, body, opts = {}) {
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: opts.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'panel-diego-visuals',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(opts.timeout || 60000),
  });
  if (opts.allow404 && res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${method} ${endpoint} → ${res.status} ${text.slice(0, 200)}`);
  }
  return opts.raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}

// sha1 de blob git, para saltarse archivos que no han cambiado
function gitBlobSha(buf) {
  return crypto.createHash('sha1')
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest('hex');
}

// Archivos que viajan al repo: la web y su contenido.
function collectLocalFiles() {
  const files = new Map(); // ruta repo → ruta absoluta
  files.set('index.html', path.join(SITE_DIR, 'index.html'));
  files.set('panel/data/content.json', path.join(__dirname, 'data', 'content.json'));
  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      const abs = path.join(dir, entry.name);
      const rel = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, rel);
      else files.set(rel, abs);
    }
  };
  walk(path.join(SITE_DIR, 'assets'), 'assets');
  return files;
}

async function push(message = 'Actualización desde el panel') {
  const cfg = ghConfig();
  if (!cfg) throw new Error('GitHub no configurado');

  const ref = await api(cfg, 'GET', `/git/ref/heads/${cfg.branch}`);
  const headSha = ref.object.sha;
  const headCommit = await api(cfg, 'GET', `/git/commits/${headSha}`);
  const remoteTree = await api(cfg, 'GET', `/git/trees/${headCommit.tree.sha}?recursive=1`);
  const remoteShaByPath = new Map(
    remoteTree.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha])
  );

  const local = collectLocalFiles();
  const treeEntries = [];

  for (const [repoPath, absPath] of local) {
    const buf = fs.readFileSync(absPath);
    const sha = gitBlobSha(buf);
    if (remoteShaByPath.get(repoPath) === sha) continue; // sin cambios
    const blob = await api(cfg, 'POST', '/git/blobs', {
      content: buf.toString('base64'),
      encoding: 'base64',
    }, { timeout: 300000 });
    treeEntries.push({ path: repoPath, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // Archivos subidos que ya no existen en local → se quitan del repo
  for (const repoPath of remoteShaByPath.keys()) {
    if (repoPath.startsWith('assets/uploads/') && !local.has(repoPath)) {
      treeEntries.push({ path: repoPath, mode: '100644', type: 'blob', sha: null });
    }
  }

  if (!treeEntries.length) return { pushed: 0, upToDate: true };

  const tree = await api(cfg, 'POST', '/git/trees', {
    base_tree: headCommit.tree.sha,
    tree: treeEntries,
  });
  const commit = await api(cfg, 'POST', '/git/commits', {
    message,
    tree: tree.sha,
    parents: [headSha],
  });
  await api(cfg, 'PATCH', `/git/refs/heads/${cfg.branch}`, { sha: commit.sha });
  return { pushed: treeEntries.length, commit: commit.sha };
}

// Al arrancar: si alguien (Alex) publicó diseño o contenido desde otra máquina,
// esta copia lo adopta. La última publicación gana.
async function pull() {
  const cfg = ghConfig();
  if (!cfg) return { pulled: 0 };
  let pulled = 0;
  const targets = [
    ['index.html', path.join(SITE_DIR, 'index.html')],
    ['panel/data/content.json', path.join(__dirname, 'data', 'content.json')],
  ];
  for (const [repoPath, absPath] of targets) {
    const remote = await api(cfg, 'GET', `/contents/${repoPath}?ref=${cfg.branch}`, null, { raw: true, allow404: true, timeout: 120000 });
    if (remote == null) continue;
    const localBuf = fs.existsSync(absPath) ? fs.readFileSync(absPath) : Buffer.alloc(0);
    if (!localBuf.equals(remote)) {
      fs.writeFileSync(absPath, remote);
      pulled++;
    }
  }
  return { pulled };
}

module.exports = { loadConfig, ghConfig, push, pull };
