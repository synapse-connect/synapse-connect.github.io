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
  { file: 'nurses/index.html', url: 'https://synapsematches.com/nurses/' },
  { file: 'doctors/index.html', url: 'https://synapsematches.com/doctors/' },
  { file: 'pharmacists/index.html', url: 'https://synapsematches.com/pharmacists/' },
  { file: 'healthcare-students/index.html', url: 'https://synapsematches.com/healthcare-students/' },
  { file: 'guides/dating-with-12-hour-shifts/index.html', url: 'https://synapsematches.com/guides/dating-with-12-hour-shifts/' },
];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NO_SEO_CHECKS = new Set(['404.html']); // title, description, canonical, sitemap
const BANNED_WORDS = ['Cleveland', 'Boston', 'Research Triangle'];
const ENDPOINT = 'functions/v1/join-waitlist';

// Dark mode (card #585). Every page carries the same no-flash snippet, switch and colour file.
const THEME_SNIPPET = `<script data-cfasync="false">(function(){try{var t=localStorage.getItem('synapse-theme');if(t==='light'||t==='dark'){var d=document.documentElement;d.setAttribute('data-theme',t);d.style.colorScheme=t}}catch(e){}})();</script>`;
const TOKENS_CSS = 'ds/css/tokens.css';

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

// The design system's page background, light and dark, from the synced colour file.
function backgrounds() {
  if (!existsSync(join(ROOT, TOKENS_CSS))) return null;
  const css = read(TOKENS_CSS);
  const light = css.match(/:root\s*\{[^}]*--background:\s*(#[0-9a-fA-F]{6})/);
  const dark = css.match(/:root\[data-theme="dark"\]\s*\{[^}]*--background:\s*(#[0-9a-fA-F]{6})/);
  const version = css.match(/synapse-design v(\d+\.\d+\.\d+)/);
  return light && dark && version ? { light: light[1].toUpperCase(), dark: dark[1].toUpperCase(), version: version[1] } : null;
}
const BG = backgrounds();
if (!BG) fail(TOKENS_CSS, 'missing, or has no light and dark --background and version line');

function checkTheme(file, html, tags) {
  const head = html.slice(0, html.search(/<\/head>/i));
  const snippetAt = head.indexOf(THEME_SNIPPET);
  const firstSheet = head.search(/<link\b[^>]*rel=["'](?:stylesheet|preload)["']/i);
  if (snippetAt === -1) fail(file, 'missing the no-flash theme snippet in <head>');
  else if (firstSheet !== -1 && snippetAt > firstSheet) fail(file, 'the no-flash theme snippet must come before the first stylesheet');

  const sheets = tags.filter((t) => t.name === 'link' && (t.attrs.rel || '').toLowerCase() === 'stylesheet').map((t) => t.attrs.href || '');
  const tokensAt = sheets.findIndex((h) => /^\/ds\/css\/tokens\.css\?v=/.test(h));
  const styleAt = sheets.findIndex((h) => /(?:^|\/)style\.css(?:\?|$)/.test(h));
  if (tokensAt === -1) fail(file, 'missing <link rel="stylesheet" href="/ds/css/tokens.css?v=...">');
  else {
    if (styleAt !== -1 && tokensAt > styleAt) fail(file, '/ds/css/tokens.css must come before style.css');
    if (BG && sheets[tokensAt] !== `/ds/css/tokens.css?v=${BG.version}`) fail(file, `tokens.css link should be ?v=${BG.version}, the synced version`);
  }

  const metas = tags.filter((t) => t.name === 'meta');
  const scheme = metas.find((t) => (t.attrs.name || '').toLowerCase() === 'color-scheme');
  if (!scheme || scheme.attrs.content !== 'light dark') fail(file, 'missing <meta name="color-scheme" content="light dark">');
  const colours = metas.filter((t) => (t.attrs.name || '').toLowerCase() === 'theme-color');
  const byMedia = Object.fromEntries(colours.map((t) => [t.attrs.media || '', (t.attrs.content || '').toUpperCase()]));
  if (colours.length !== 2 || !BG
    || byMedia['(prefers-color-scheme: light)'] !== BG.light || byMedia['(prefers-color-scheme: dark)'] !== BG.dark) {
    fail(file, `needs two theme-color metas: ${BG?.light} for (prefers-color-scheme: light) and ${BG?.dark} for (prefers-color-scheme: dark)`);
  }

  const themeJs = tags.filter((t) => t.name === 'script' && /^\/theme\.js(?:\?.*)?$/.test(t.attrs.src || ''));
  if (themeJs.length !== 1 || !('defer' in themeJs[0].attrs)) fail(file, `${themeJs.length} deferred /theme.js scripts, expected exactly 1`);

  const toggles = tags.filter((t) => t.name === 'button' && (t.attrs.class || '').split(/\s+/).includes('theme-toggle'));
  const holders = tags.filter((t) => t.name === 'li' && (t.attrs.class || '').split(/\s+/).includes('nav-theme'));
  if (toggles.length !== 1) fail(file, `${toggles.length} .theme-toggle buttons, expected exactly 1`);
  else {
    const b = toggles[0].attrs;
    if (b.type !== 'button' || b['aria-label'] !== 'Dark theme' || !('aria-pressed' in b)) {
      fail(file, '.theme-toggle needs type="button", aria-label="Dark theme" and aria-pressed');
    }
  }
  if (holders.length !== 1 || !('hidden' in holders[0].attrs)) fail(file, 'the switch sits in one <li class="nav-theme" hidden>, shown by theme.js');

  // The switch is hand-copied into every header: its markup must match the first page's exactly.
  const markup = html.match(/<li\b[^>]*\bclass="[^"]*\bnav-theme\b[^"]*"[\s\S]*?<\/li>/)?.[0];
  if (!markup) fail(file, 'could not read the switch markup to compare it');
  else {
    switchMarkup ??= { file, markup };
    if (markup !== switchMarkup.markup) fail(file, `the switch markup differs from ${switchMarkup.file}`);
  }
}
let switchMarkup = null;

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
  const sharedLoads = tags.filter((t) => t.name === 'script' && /^\/waitlist\.js(?:\?.*)?$/.test(t.attrs.src || '')).length;
  if (hasBlock && sharedLoads !== 1) fail(file, `.waitlist-block but ${sharedLoads} /waitlist.js scripts, expected exactly 1`);
  if (html.includes(ENDPOINT)) fail(file, 'contains join-waitlist endpoint');

  for (const t of tags) {
    for (const attr of ['href', 'src']) {
      if (attr in t.attrs && t.attrs[attr] !== '') checkLink(file, decode(t.attrs[attr]));
    }
  }

  checkTheme(file, html, tags);

  const text = visibleText(html);
  for (const word of BANNED_WORDS) if (text.includes(word)) fail(file, `page text contains "${word}"`);
}

if (existsSync(join(ROOT, 'waitlist.js'))) {
  for (const m of read('waitlist.js').matchAll(/fetch\(\s*'([^']*)'/g)) {
    if (!m[1].startsWith('/') && !m[1].startsWith('https://')) fail('waitlist.js', `fetch('${m[1]}') must start with / or https://`);
  }
}

// Only declaration values are checked (the innermost {…} blocks), so id and class selectors never trip it.
const COLOUR_VALUE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|:[^;]*(?<![-\w])(?:white|black|red|green|blue|gr[ae]y|silver|yellow|orange|purple|pink|navy|teal|maroon|olive|lime|aqua|fuchsia)\b/i;
const declarations = [...read('style.css').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
if (declarations.some((d) => COLOUR_VALUE.test(d))) fail('style.css', 'writes a colour value; colours come from /ds/css/tokens.css');

// Printed pages use the light theme even with JavaScript off (card #587): the design system's dark
// colours are screen-only, and the browser's own controls must print light too.
if (!/@media\s+print\s*\{\s*[^{}]*\{[^}]*color-scheme:\s*light/.test(read('style.css'))) fail('style.css', 'needs @media print { … color-scheme: light } so printed pages stay light');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`OK ${PAGES.length} pages`);
