'use strict';

// Regenera index.html desde data/content.json.
// Lo ejecuta el GitHub Action en cada publicación desde el panel web
// (y sirve también para regenerar a mano: node panel/build.js).

const fs = require('fs');
const path = require('path');
const { applyContent } = require('./generate');

const INDEX = path.join(__dirname, '..', 'index.html');
const CONTENT = path.join(__dirname, 'data', 'content.json');

const content = JSON.parse(fs.readFileSync(CONTENT, 'utf8'));
const html = fs.readFileSync(INDEX, 'utf8');
const { html: out, missing } = applyContent(html, content);

if (missing.length) console.warn('AVISO: marcadores ausentes en index.html:', missing.join(', '));
if (out !== html) {
  fs.writeFileSync(INDEX, out);
  console.log('index.html regenerado.');
} else {
  console.log('index.html ya estaba al día.');
}
