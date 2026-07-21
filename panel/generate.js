'use strict';

// Genera las zonas editables de index.html a partir de content.json.
// Cada zona vive entre <!-- ADMIN:KEY --> y <!-- /ADMIN:KEY --> en el HTML.

const SVG = {
  star: '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  placeholder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r=".5" fill="currentColor"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// URLs que acaban en atributos href/src. Relativas (assets/...) o http(s).
function safeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^assets\/[\w\-./]+$/.test(u)) return u;
  return '';
}

function ytId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/);
  return m ? m[1] : null;
}

function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const chars = words.slice(0, 2).map((w) => w[0].toUpperCase());
  return chars.join('') || '?';
}

function handleFromUrl(url) {
  const m = String(url || '').replace(/\/+$/, '').match(/\/([^/?#]+)(?:[?#].*)?$/);
  return m ? '@' + m[1] : url;
}

const clampInt = (v, min, max, dflt) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

const str = (v, max) => String(v == null ? '' : v).slice(0, max).trim();

// ── Normalización: el contenido siempre entra por aquí antes de renderizar ──
function normalizeContent(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const hero = c.hero || {};
  const sections = c.sections || {};
  const contact = c.contact || {};
  const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

  return {
    hero: {
      badge: str(hero.badge, 80),
      badgeVisible: hero.badgeVisible !== false,
      titleLines: list(hero.titleLines, 3).map((l) => str(l, 30)).filter(Boolean),
      subtitle: str(hero.subtitle, 120),
      description: str(hero.description, 400),
      tools: list(hero.tools, 6).map((t) => ({ abbr: str(t && t.abbr, 4), name: str(t && t.name, 40) })).filter((t) => t.abbr),
      videoSrc: safeUrl(hero.videoSrc) || 'assets/video/hero-scrub.mp4',
      videoVersion: clampInt(hero.videoVersion, 1, 1e9, 1),
    },
    stats: list(c.stats, 6).map((s) => ({
      value: clampInt(s && s.value, 0, 999999999, 0),
      suffix: str(s && s.suffix, 6) || '+',
      label: str(s && s.label, 40),
    })),
    clients: list(c.clients, 30).map((cl) => ({
      name: str(cl && cl.name, 60),
      desc: str(cl && cl.desc, 90),
      photo: safeUrl(cl && cl.photo),
    })).filter((cl) => cl.name),
    projects: list(c.projects, 24).map((p) => ({
      title: str(p && p.title, 90),
      category: str(p && p.category, 90),
      video: safeUrl(p && p.video),
      thumb: safeUrl(p && p.thumb),
      preview: safeUrl(p && p.preview),
      comingSoon: !!(p && p.comingSoon),
    })).filter((p) => p.title),
    testimonials: list(c.testimonials, 20).map((t) => ({
      text: str(t && t.text, 600),
      name: str(t && t.name, 60),
      role: str(t && t.role, 60),
      stars: clampInt(t && t.stars, 1, 5, 5),
    })).filter((t) => t.text && t.name),
    sections: {
      trabajosDesc: str(sections.trabajosDesc, 300),
      testimoniosDesc: str(sections.testimoniosDesc, 300),
      contactoDesc: str(sections.contactoDesc, 300),
    },
    contact: {
      email: str(contact.email, 120).replace(/[<>"'\s]/g, ''),
      x: safeUrl(contact.x),
      instagram: safeUrl(contact.instagram),
    },
  };
}

// ── Renderizadores por zona ──

function renderHeroVideo(c) {
  const src = `${esc(c.hero.videoSrc)}?v=${c.hero.videoVersion}`;
  return [
    '<video',
    '          class="hero-video-scrub"',
    '          id="heroVideo"',
    `          src="${src}"`,
    '          muted',
    '          playsinline',
    '          webkit-playsinline',
    '          preload="auto"',
    '          aria-hidden="true"',
    '        ></video>',
  ].join('\n');
}

function renderHero(c) {
  const h = c.hero;
  const out = [];
  if (h.badgeVisible && h.badge) {
    out.push('<div class="hero-badge">');
    out.push('            <span class="dot"></span>');
    out.push(`            ${esc(h.badge)}`);
    out.push('          </div>');
    out.push('');
  }
  const title = h.titleLines.map((l) => `<span class="title-word">${esc(l)}</span>`).join('<br>');
  out.push(`          <h1 id="heroTitle">${title}</h1>`);
  out.push('');
  out.push(`          <p class="hero-subtitle">${esc(h.subtitle)}</p>`);
  if (h.tools.length) {
    out.push('');
    out.push('          <div class="hero-tools">');
    h.tools.forEach((t) => out.push(`            <div class="tool-badge" title="${esc(t.name)}">${esc(t.abbr)}</div>`));
    out.push('          </div>');
  }
  out.push('');
  out.push('          <p class="hero-description">');
  out.push(`            ${esc(h.description)}`);
  out.push('          </p>');
  out.push('');
  out.push('          <div class="hero-actions">');
  out.push('            <a href="#trabajos" class="btn btn-primary magnetic-btn">');
  out.push('              Ver Trabajos');
  out.push(`              ${SVG.arrow}`);
  out.push('            </a>');
  out.push('            <a href="#contacto" class="btn btn-secondary magnetic-btn">Contactar</a>');
  out.push('          </div>');
  out.push('');
  out.push('          <div class="hero-scroll">');
  out.push('            <div class="scroll-indicator">');
  out.push('              <div class="scroll-dot"></div>');
  out.push('            </div>');
  out.push('          </div>');
  // La primera línea va pegada al marcador; el join añade la sangría del resto.
  return out.join('\n');
}

function renderNavCta(c) {
  return `<li><a href="mailto:${esc(c.contact.email)}" class="nav-cta magnetic-btn">¡Hablemos!</a></li>`;
}

function clientCard(cl) {
  const avatar = cl.photo
    ? `<div class="client-avatar"><img src="${esc(cl.photo)}" alt="${esc(cl.name)}" loading="lazy"></div>`
    : `<div class="client-avatar">${esc(initials(cl.name))}</div>`;
  return `<div class="client-card">${avatar}<div class="client-info"><h4>${esc(cl.name)}</h4><span>${esc(cl.desc)}</span></div></div>`;
}

function renderClients(c) {
  // Duplicado x2 para el loop infinito del carrusel.
  const cards = c.clients.concat(c.clients).map(clientCard);
  return cards.join('\n        ');
}

function renderStats(c) {
  return c.stats.map((s, i) => {
    const suffix = s.suffix === '+' ? '' : ` data-suffix="${esc(s.suffix)}"`;
    return [
      `<div class="stat-item stagger-${(i % 4) + 1}">`,
      `        <div class="stat-number" data-target="${s.value}"${suffix}>0</div>`,
      `        <div class="stat-label">${esc(s.label)}</div>`,
      '      </div>',
    ].join('\n');
  }).join('\n      ');
}

function renderProjects(c) {
  return c.projects.map((p, i) => {
    const video = p.comingSoon ? '' : p.video;
    let media;
    const id = ytId(video);
    if (p.thumb) {
      media = `          <img class="project-thumb" src="${esc(p.thumb)}" alt="${esc(p.title)}" loading="lazy">`;
    } else if (id) {
      media = `          <img class="project-thumb" src="https://i.ytimg.com/vi/${id}/maxresdefault.jpg" alt="${esc(p.title)}" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${id}/hqdefault.jpg'">`;
    } else {
      media = [
        '          <div class="project-placeholder">',
        `            ${SVG.placeholder}`,
        '            <span>Próximamente</span>',
        '          </div>',
      ].join('\n');
    }
    const preview = p.preview
      ? `<video src="${esc(p.preview)}" muted loop playsinline preload="none"></video>`
      : '';
    return [
      `<div class="project-card reveal-scale stagger-${(i % 4) + 1}" data-video="${esc(video)}">`,
      media,
      `          <div class="project-video-preview">${preview}</div>`,
      `          <div class="project-overlay"><h3>${esc(p.title)}</h3><p>${esc(p.category)}</p></div>`,
      '        </div>',
    ].join('\n');
  }).join('\n\n        ');
}

function renderTestimonials(c) {
  return c.testimonials.map((t, i) => {
    const stars = Array.from({ length: t.stars }, () => `            ${SVG.star}`).join('\n');
    return [
      `<div class="testimonial-card reveal-rotate stagger-${(i % 3) + 1}">`,
      '          <div class="testimonial-stars">',
      stars,
      '          </div>',
      `          <p class="testimonial-text">${esc(t.text)}</p>`,
      '          <div class="testimonial-author">',
      `            <div class="testimonial-avatar">${esc(initials(t.name)[0] || '?')}</div>`,
      '            <div>',
      `              <div class="testimonial-name">${esc(t.name)}</div>`,
      `              <div class="testimonial-role">${esc(t.role)}</div>`,
      '            </div>',
      '          </div>',
      '        </div>',
    ].join('\n');
  }).join('\n\n        ');
}

function renderContact(c) {
  const links = [];
  if (c.contact.email) {
    links.push([
      `<a href="mailto:${esc(c.contact.email)}" class="cta-link reveal-rotate stagger-1 magnetic-btn">`,
      `          ${SVG.email}`,
      `          <span>${esc(c.contact.email)}</span>`,
      '        </a>',
    ].join('\n'));
  }
  if (c.contact.x) {
    links.push([
      `<a href="${esc(c.contact.x)}" class="cta-link reveal-rotate stagger-2 magnetic-btn">`,
      `          ${SVG.x}`,
      `          <span>${esc(handleFromUrl(c.contact.x))}</span>`,
      '        </a>',
    ].join('\n'));
  }
  if (c.contact.instagram) {
    links.push([
      `<a href="${esc(c.contact.instagram)}" class="cta-link reveal-rotate stagger-3 magnetic-btn">`,
      `          ${SVG.instagram}`,
      `          <span>${esc(handleFromUrl(c.contact.instagram))}</span>`,
      '        </a>',
    ].join('\n'));
  }
  return links.join('\n        ');
}

function renderFooterSocials(c) {
  const links = [];
  if (c.contact.x) {
    links.push([
      `<a href="${esc(c.contact.x)}" aria-label="X / Twitter">`,
      `          ${SVG.x}`,
      '        </a>',
    ].join('\n'));
  }
  if (c.contact.instagram) {
    links.push([
      `<a href="${esc(c.contact.instagram)}" aria-label="Instagram">`,
      `          ${SVG.instagram}`,
      '        </a>',
    ].join('\n'));
  }
  return links.join('\n        ');
}

const RENDERERS = {
  HERO_VIDEO: renderHeroVideo,
  HERO: renderHero,
  NAV_CTA: renderNavCta,
  CLIENTS: renderClients,
  STATS: renderStats,
  DESC_TRABAJOS: (c) => esc(c.sections.trabajosDesc),
  PROJECTS: renderProjects,
  DESC_TESTIMONIOS: (c) => esc(c.sections.testimoniosDesc),
  TESTIMONIALS: renderTestimonials,
  DESC_CONTACTO: (c) => esc(c.sections.contactoDesc),
  CONTACT: renderContact,
  FOOTER_SOCIALS: renderFooterSocials,
};

// Zonas de una sola línea: el contenido va pegado a los marcadores.
const INLINE = new Set(['DESC_TRABAJOS', 'DESC_TESTIMONIOS', 'DESC_CONTACTO']);

// Sangría con la que se reinsertan las zonas de bloque.
const INDENT = {
  HERO_VIDEO: '        ',
  HERO: '          ',
  NAV_CTA: '        ',
  CLIENTS: '        ',
  STATS: '      ',
  PROJECTS: '        ',
  TESTIMONIALS: '        ',
  CONTACT: '        ',
  FOOTER_SOCIALS: '        ',
};

function applyContent(html, rawContent) {
  const content = normalizeContent(rawContent);
  const missing = [];
  let out = html;
  for (const [key, render] of Object.entries(RENDERERS)) {
    const re = new RegExp(`(<!-- ADMIN:${key} -->)([\\s\\S]*?)(<!-- /ADMIN:${key} -->)`);
    if (!re.test(out)) {
      missing.push(key);
      continue;
    }
    const body = render(content);
    out = out.replace(re, (_m, open, _mid, close) => (
      INLINE.has(key)
        ? `${open}${body}${close}`
        : `${open}\n${INDENT[key]}${body}\n${INDENT[key]}${close}`
    ));
  }
  return { html: out, missing };
}

module.exports = { applyContent, normalizeContent, ytId };
