// Builds assets/us-places.json, the city/town list for the waitlist (synapse#540).
// Source: US Census Bureau 2024 Gazetteer files (public domain):
//   places (cities, towns, villages, CDPs) for every state, plus county
//   subdivisions for New England, where the town is the local unit.
// Each entry is "Name|ST|GEOID|lat|lon" (center point, 2 decimals), largest land
// area first so "Boston" offers Boston, MA before the small Bostons.
// shortcut: land area stands in for population (the Gazetteer has none); switch to Census population estimates if ordering bothers people.
// Run: node scripts/build-us-places.mjs   (needs `unzip`)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/';
const NEW_ENGLAND = new Set(['CT', 'MA', 'ME', 'NH', 'RI', 'VT']);
// Census type words after the name ("Cleveland city", "Durham CDP", "Pawtucket city (balance)").
const TYPE_WORDS = / (city and borough|consolidated government|metropolitan government|metro government|unified government|urban county|charter township|city|town|village|borough|CDP|municipality|township|plantation|comunidad|zona urbana|corporation)( \(balance\))?$/;

async function readGazetteer(file) {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const dir = mkdtempSync(join(tmpdir(), 'gaz-'));
  const zip = join(dir, file);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const text = execFileSync('unzip', ['-p', zip], { maxBuffer: 64 << 20 }).toString('utf8');
  const [header, ...lines] = text.trim().split('\n');
  const cols = header.split('\t').map((c) => c.trim());
  return lines.map((line) => Object.fromEntries(line.split('\t').map((v, i) => [cols[i], v.trim()])));
}

const places = await readGazetteer('2024_Gaz_place_national.zip');
const towns = (await readGazetteer('2024_Gaz_cousubs_national.zip'))
  // Only real New England towns and cities, not gores, grants or unorganized territories.
  .filter((r) => NEW_ENGLAND.has(r.USPS) && / (town|city)$/.test(r.NAME));

const seen = new Set();
const rows = [];
for (const r of [...places, ...towns]) {
  const name = r.NAME.replace(TYPE_WORDS, '').replace(/ \(balance\)$/, '');
  const key = `${name}|${r.USPS}`;
  if (seen.has(key)) continue; // a place wins over a town of the same name
  seen.add(key);
  rows.push({ aland: +r.ALAND, line: `${key}|${r.GEOID}|${(+r.INTPTLAT).toFixed(2)}|${(+r.INTPTLONG).toFixed(2)}` });
}
const out = rows.sort((a, b) => b.aland - a.aland).map((r) => r.line);

// Self-check before writing.
const has = (n) => out.some((e) => e.startsWith(n + '|'));
const must = ['Providence|RI', 'Cleveland|OH', 'Durham|NC', 'Chapel Hill|NC', 'Boston|MA', 'Lincoln|RI', 'Smithfield|RI', 'Brookline|MA', 'West Hartford|CT', 'Hanover|NH'];
const missing = must.filter((n) => !has(n));
const leftover = out.filter((e) => TYPE_WORDS.test(e.split('|')[0]) || / \(balance\)$/.test(e.split('|')[0]));
const badRow = out.filter((e) => !/^[^|]{1,100}\|[A-Z]{2}\|(\d{7}|\d{10})\|-?\d+\.\d{2}\|-?\d+\.\d{2}$/.test(e));
const json = JSON.stringify(out);
if (missing.length || leftover.length || badRow.length || json.length > 1.5e6) {
  console.error({ missing, leftover: leftover.slice(0, 10), badRow: badRow.slice(0, 10), bytes: json.length });
  process.exit(1);
}
writeFileSync(new URL('../assets/us-places.json', import.meta.url), json);
console.log(`assets/us-places.json: ${out.length} places (${places.length} Census places, ${towns.length} New England towns), ${json.length} bytes`);
