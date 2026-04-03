require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE_ID = 'appkvW8Fy5q6eCKLa';
const TABLE_ID = 'tbljYanxfDihWhaMs';
const HTML_FILE = path.join(__dirname, 'index.html');

const LANG_CODE = { French: 'fr', Dutch: 'nl', German: 'de' };
const LANG_FLAG = { fr: '🇫🇷', nl: '🇳🇱', de: '🇩🇪' };

async function fetchAllRecords() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    console.error('Error: set AIRTABLE_API_KEY in your .env file');
    process.exit(1);
  }

  const records = [];
  let offset = null;

  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Airtable error ${res.status}: ${body}`);
      process.exit(1);
    }

    const data = await res.json();
    records.push(...data.records);
    offset = data.offset || null;
  } while (offset);

  return records;
}

function stripTrailingPeriod(str) {
  return str.replace(/\.\s*$/, '');
}

function parseArray(value) {
  if (!value) return [];
  return value
    .split(/\n/)
    .map(s => stripTrailingPeriod(s.trim()))
    .filter(Boolean);
}

function recordToPhrase(record) {
  const f = record.fields;

  // Language may be a plain string or a singleSelect object { name: "French" }
  const langRaw = f['Language'];
  const langName = langRaw ? (typeof langRaw === 'object' ? langRaw.name : langRaw) : 'French';
  const lang = LANG_CODE[langName] || 'fr';

  // Tier may be a plain string or a singleSelect object { name: "1" }
  const tierRaw = f['Tier'];
  const tier = tierRaw ? (typeof tierRaw === 'object' ? tierRaw.name : tierRaw) : '1';

  // Emoji field name changed — try both
  const emoji = f['Emoji'] || f['emoji'] || '';

  return {
    id: record.id,
    lang,
    flag: LANG_FLAG[lang] || '',
    langLabel: langName,
    tier,
    sortOrder: f['Sort Order'] || null,
    alwaysCapitalize: f['Always Capitalize'] === true,
    emoji,
    meaning: f['English Meaning'] || '',
    meanings: parseArray(f['Meanings']),
    native: f['Phrase (Native)'] || '', // raw value — do not transform case
    romanization: f['Romanization'] || null,
    note: f['Note'] || '',
    hasBuildup: f['Has Buildup'] === true,
    isBuildupChunk: f['Is Buildup Chunk'] === true,
    capabilityLabel: f['Capability Label'] || '',
    audioRecorded: f['Audio Recorded'] === true,
    situations: parseArray(f['Situations']),
    situationEarly: parseArray(f['Situation (Early)']),
    situationLate: parseArray(f['Situation (Late)']),
    responses: parseArray(f['Responses']),
  };
}

function buildPhrasesBlock(phrases) {
  return 'const PHRASES = ' + JSON.stringify(phrases, null, 2) + ';';
}

function updateHtmlFile(phrases) {
  let html = fs.readFileSync(HTML_FILE, 'utf8');

  // Replace PHRASES array
  const phrasesPattern = /const PHRASES = \[[\s\S]*?\];/;
  if (!phrasesPattern.test(html)) {
    console.error('Could not find PHRASES array in index.html');
    process.exit(1);
  }
  html = html.replace(phrasesPattern, buildPhrasesBlock(phrases));

  fs.writeFileSync(HTML_FILE, html, 'utf8');
  console.log(`Updated index.html with ${phrases.length} phrases`);
}

function gitCommitAndPush() {
  execSync('git add index.html', { cwd: __dirname, stdio: 'inherit' });

  // Check if index.html is actually staged with changes
  const staged = execSync('git diff --cached --name-only', { cwd: __dirname }).toString().trim();
  if (!staged) {
    console.log('No changes to commit — phrases already up to date');
    return;
  }

  execSync('git commit -m "sync phrases from Airtable"', { cwd: __dirname, stdio: 'inherit' });
  execSync('git push', { cwd: __dirname, stdio: 'inherit' });
  console.log('Pushed to GitHub — Netlify will redeploy automatically');
}

(async () => {
  console.log('Fetching records from Airtable...');
  const records = await fetchAllRecords();
  console.log(`Fetched ${records.length} records`);

  const allPhrases = records.map(recordToPhrase);
  // Exclude buildup chunks — they are audio-only fragments, never user-facing
  const phrases = allPhrases.filter(p => !p.isBuildupChunk);
  console.log(`Excluded ${allPhrases.length - phrases.length} buildup chunks`);

  // Debug: verify Recovery and Foundation ordering
  const recovery = phrases.filter(p => p.tier === 'Recovery');
  console.log(`Recovery phrases (${recovery.length}):`, recovery.map(p => p.native));
  const foundation = phrases.filter(p => p.tier === '1').sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
  console.log(`Foundation phrases in sort order (${foundation.length}):`, foundation.map(p => `${p.sortOrder}: ${p.native}`));
  const withCapability = phrases.filter(p => p.capabilityLabel);
  console.log(`Phrases with capabilityLabel (${withCapability.length}):`, withCapability.map(p => `${p.native} → "${p.capabilityLabel}"`));

  updateHtmlFile(phrases);
  gitCommitAndPush();
})();
