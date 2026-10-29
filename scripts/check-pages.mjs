// Page checker for the static site. Run: node scripts/check-pages.mjs
// Exits 0 with "OK <n> pages", or 1 listing each failure as "<page>: <problem>".
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Add each new page here.
const PAGES = [
  { file: 'index.html', url: 'https://synapsematches.com/' },
  { file: 'privacy.html', url: 'https://synapsematches.com/privacy.html' },
  { file: 'terms.html', url: 'https://synapsematches.com/terms.html' },
  { file: '404.html', url: 'https://synapsematches.com/404.html' },
  { file: 'verification/index.html', url: 'https://synapsematches.com/verification/' },
];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NO_SEO_CHECKS = new Set(['404.html']); // title, description, canonical, sitemap
const BANNED_WORDS = ['Cleveland', 'Boston', 'Research Triangle'];
const ENDPOINT = 'functions/v1/join-waitlist';

const failures = [];
const fail = (page, problem) => failures.push(`${page}: ${problem}`);
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]);

// Tiny tag scanner: returns [{ name, attrs }] for every start tag outside comments, scripts and styles.
function scanTags(html) {
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (m) => m.slice(0, m.indexOf('>') + 1));
  const tags = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  for (let m; (m = tagRe.exec(clean)); ) {
    const attrs = {};
    const attrRe = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    for (let a; (a = attrRe.exec(m[2])); ) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    tags.push({ name: m[1].toLowerCase(), attrs });
  }
  return tags;
}

function visibleText(html) {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<script\b(?![^>]*application\/ld\+json)[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

const idCache = new Map();
function idsOf(file) {
  if (!idCache.has(file)) {
    idCache.set(file, new Set(scanTags(read(file)).filter((t) => 'id' in t.attrs).map((t) => t.attrs.id)));
  }
  return idCache.get(file);
}

function checkLink(page, ref) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) return; // external, mailto:, tel:, data:
  const hashAt = ref.indexOf('#');
  const fragment = hashAt === -1 ? '' : ref.slice(hashAt + 1);
  const pathPart = (hashAt === -1 ? ref : ref.slice(0, hashAt)).split('?')[0];

  let target = page;
  if (pathPart !== '') {
    const abs = pathPart.startsWith('/')
      ? join(ROOT, pathPart)
      : join(ROOT, dirname(page), pathPart);
    const rel = relative(ROOT, normalize(abs));
    if (rel.startsWith('..')) return fail(page, `link ${ref} leaves the repo`);
    const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
    if (pathPart.endsWith('/') || rel === '') {
      target = join(rel, 'index.html');
    } else if (isDir(abs)) {
      return fail(page, `link ${ref}: ${rel}/ is a folder, link to /${rel}/`);
    } else {
      target = rel;
    }
    if (!existsSync(join(ROOT, target)) || statSync(join(ROOT, target)).isDirectory()) {
      return fail(page, `link ${ref} does not resolve to a file`);
    }
  }
  if (fragment && target.endsWith('.html') && !idsOf(target).has(fragment)) {
    fail(page, `link ${ref}: no id "${fragment}" in ${target}`);
  }
}

const sitemapUrls = [...read('sitemap.xml').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);

for (const { file, url } of PAGES) {
  if (!existsSync(join(ROOT, file))) {
    fail(file, 'file does not exist');
    continue;
  }
  const html = read(file);
  const tags = scanTags(html);
  const seo = !NO_SEO_CHECKS.has(file);

  const h1s = tags.filter((t) => t.name === 'h1').length;
  if (h1s !== 1) fail(file, `${h1s} <h1> tags, expected exactly 1`);

  if (seo) {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!title || !title[1].trim()) fail(file, 'missing <title>');
    else if (decode(title[1].trim()).length > 60) fail(file, `<title> is ${decode(title[1].trim()).length} characters, max 60`);

    const desc = tags.find((t) => t.name === 'meta' && (t.attrs.name || '').toLowerCase() === 'description');
    if (!desc || !desc.attrs.content?.trim()) fail(file, 'missing meta description');
    else if (decode(desc.attrs.content).length > 160) fail(file, `meta description is ${decode(desc.attrs.content).length} characters, max 160`);

    const canon = tags.find((t) => t.name === 'link' && (t.attrs.rel || '').toLowerCase() === 'canonical');
    if (!canon) fail(file, 'missing canonical');
    else if (canon.attrs.href !== url) fail(file, `canonical ${canon.attrs.href} is not ${url}`);

    if (!sitemapUrls.includes(url)) fail(file, `${url} is not in sitemap.xml`);
  }

  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      JSON.parse(m[1]);
    } catch (e) {
      fail(file, `invalid JSON-LD: ${e.message}`);
    }
    if (m[1].includes('FAQPage')) fail(file, 'JSON-LD contains FAQPage');
  }

  const seen = new Set();
  for (const t of tags) {
    if (!('id' in t.attrs)) continue;
    if (seen.has(t.attrs.id)) fail(file, `duplicate id "${t.attrs.id}"`);
    seen.add(t.attrs.id);
  }

  const hasBlock = tags.some((t) => (t.attrs.class || '').split(/\s+/).includes('waitlist-block'));
  const loadsShared = tags.some((t) => t.name === 'script' && /^\/waitlist\.js(?:\?.*)?$/.test(t.attrs.src || ''));
  if (hasBlock && !loadsShared) fail(file, '.waitlist-block but no /waitlist.js');
  if (html.includes(ENDPOINT)) fail(file, 'contains join-waitlist endpoint');

  for (const t of tags) {
    for (const attr of ['href', 'src']) {
      if (attr in t.attrs && t.attrs[attr] !== '') checkLink(file, decode(t.attrs[attr]));
    }
  }

  const text = visibleText(html);
  for (const word of BANNED_WORDS) if (text.includes(word)) fail(file, `page text contains "${word}"`);
}

if (existsSync(join(ROOT, 'waitlist.js'))) {
  for (const m of read('waitlist.js').matchAll(/fetch\(\s*'([^']*)'/g)) {
    if (!m[1].startsWith('/') && !m[1].startsWith('https://')) fail('waitlist.js', `fetch('${m[1]}') must start with / or https://`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`OK ${PAGES.length} pages`);
