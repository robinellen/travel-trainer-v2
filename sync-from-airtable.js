require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE_ID = 'appkvW8Fy5q6eCKLa';
const PHRASES_TABLE = 'tbljYanxfDihWhaMs';
const TRIGGER_TABLE = 'tbltyfoXkuoNdP03O';
const EXPERIENCES_TABLE = 'Experiences';
const SITUATIONS_TABLE = 'tbldojSHHVbgGTPjD';
const LISTEN_CLIPS_TABLE = 'tbl8riiiNg48tDyWm';
const CULTURE_NOTES_TABLE = 'tblmRuAFbE8SUmRuk';
const HTML_FILE = path.join(__dirname, 'index.html');

const LANG_CODE = { French: 'fr', Dutch: 'nl', German: 'de' };
const LANG_FLAG = { fr: '🇫🇷', nl: '🇳🇱', de: '🇩🇪' };

async function fetchAllRecords(tableId) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    console.error('Error: set AIRTABLE_API_KEY in your .env file');
    process.exit(1);
  }

  const records = [];
  let offset = null;

  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Airtable error ${res.status} for table ${tableId}: ${body}`);
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

// ── Phrases ──

function recordToPhrase(record) {
  const f = record.fields;
  const langRaw = f['Language'];
  const langName = langRaw ? (typeof langRaw === 'object' ? langRaw.name : langRaw) : 'French';
  const lang = LANG_CODE[langName] || 'fr';
  const tierRaw = f['Tier'];
  const tier = tierRaw ? (typeof tierRaw === 'object' ? tierRaw.name : tierRaw) : '1';
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
    native: f['Phrase (Native)'] || '',
    romanization: f['Romanization'] || null,
    note: f['Note'] || '',
    hasBuildup: f['Has Buildup'] === true,
    isBuildupChunk: f['Is Buildup Chunk'] === true,
    capabilityLabel: f['Capability Label'] || '',
    alsoAccepted: parseArray(f['Also Accepted']),
    audioRecorded: f['Audio Recorded'] === true,
    situations: parseArray(f['Situations']),
    situationEarly: parseArray(f['Situation (Early)']),
    situationLate: parseArray(f['Situation (Late)']),
    responses: parseArray(f['Responses']),
    direction: f['Direction'] ? (typeof f['Direction'] === 'object' ? f['Direction'].name : f['Direction']) : '',
    preferenceGroup: Array.isArray(f['Preference Group'])
      ? f['Preference Group'].map(v => typeof v === 'object' ? v.name : v)
      : [],
  };
}

// ── Trigger Phrases ──

function recordToTrigger(record) {
  const f = record.fields;
  const langRaw = f['Language'];
  const langName = langRaw ? (typeof langRaw === 'object' ? langRaw.name : langRaw) : 'French';
  const intentRaw = f['Intent'];
  const intentName = intentRaw ? (typeof intentRaw === 'object' ? intentRaw.name : intentRaw) : '';
  return {
    id: record.id,
    triggerPhrase: f['Trigger Phrase'] || '',
    signal: f['Signal'] || '',
    signalWord: f['Signal Word'] || '',
    signalWordDefinition: f['Signal Word Definition'] || '',
    signalWordNote: f['Signal Word Note'] || '',
    intent: intentName,
    type: f['Type'] || '',
    language: langName,
    experience: f['Experience'] || '',
    depthLevel: f['Depth Level'] || '',
    scenePrompt: f['Scene Prompt'] || '',
    romanization: f['Romanization'] || '',
    distractors: parseArray(f['Distractors']),
    fileName: f['File Name'] || '',
    audioRecorded: f['Audio Recorded'] === true,
    sortOrder: f['Sort Order'] || null,
    difficulty: f['Sort Order'] || 0,
    voice: f['Voice'] || '',
    preferenceGroup: Array.isArray(f['Preference Group'])
      ? f['Preference Group'].map(v => typeof v === 'object' ? v.name : v)
      : [],
  };
}

// ── Situations ──

function recordToSituation(record) {
  const f = record.fields;
  return {
    id: record.id,
    scenario: f['Scenario'] || '',
    contextLabel: f['Context Label'] || '',
    phraseNative: f['Phrase (Native)'] || '',
    englishHint: f['English Hint'] || '',
    recoveryAlsoValid: f['Recovery Also Valid'] === true,
    language: f['Language'] || 'French',
    sortOrder: f['Sort Order'] || null,
    scoreRange: f['Score Range'] || 'Any',
  };
}

// ── Listen Clips ──

function recordToListenClip(record) {
  const f = record.fields;
  return {
    id: record.id,
    frenchText: f['French Text'] || '',
    englishTranslation: f['English Translation'] || '',
    anchorPhrase: f['Anchor Phrase'] || '',
    contextLabel: f['Context Label'] || '',
    scenePrompt: f['Scene Prompt'] || '',
    clipType: f['Clip Type'] || '',
    language: f['Language'] || 'French',
    fileName: f['File Name'] || '',
    audioRecorded: f['Audio Recorded'] === true,
    difficulty: f['Difficulty'] || '',
    sortOrder: f['Sort Order'] || null,
  };
}

// ── Culture Notes ──

function recordToCultureNote(record) {
  const f = record.fields;
  const langRaw = f['Language'];
  const langName = langRaw ? (typeof langRaw === 'object' ? langRaw.name : langRaw) : 'French';
  const categoryRaw = f['Category'];
  const category = categoryRaw ? (typeof categoryRaw === 'object' ? categoryRaw.name : categoryRaw) : '';
  return {
    id: record.id,
    title: f['Title'] || '',
    category,
    body: f['Body'] || '',
    language: langName,
    emoji: f['Emoji'] || '',
    sortOrder: f['Sort Order'] || null,
  };
}

// ── Experiences ──

function recordToExperience(record) {
  const f = record.fields;
  return {
    id: record.id,
    name: f['Experience'] || '',
    emoji: f['Emoji'] || '',
    language: f['Language'] || 'French',
    culturalNote: f['Cultural Note'] || '',
    depthLevel: f['Depth Level'] || '',
    status: f['Status'] || '',
    region: f['Region'] || '',
    arc: f['Arc'] || '',
  };
}

// ── HTML update ──

function updateHtmlFile(phrases, triggerPhrases, experiences, situations, listenClips, cultureNotes) {
  let html = fs.readFileSync(HTML_FILE, 'utf8');

  // Replace PHRASES array
  const phrasesPattern = /const PHRASES = \[[\s\S]*?\];/;
  if (!phrasesPattern.test(html)) {
    console.error('Could not find PHRASES array in index.html');
    process.exit(1);
  }
  html = html.replace(phrasesPattern, 'const PHRASES = ' + JSON.stringify(phrases, null, 2) + ';');

  // Replace or insert TRIGGER_PHRASES array
  const triggerPattern = /const TRIGGER_PHRASES = \[[\s\S]*?\];/;
  const triggerBlock = 'const TRIGGER_PHRASES = ' + JSON.stringify(triggerPhrases, null, 2) + ';';
  if (triggerPattern.test(html)) {
    html = html.replace(triggerPattern, triggerBlock);
  } else {
    html = html.replace('const PHRASES = ', triggerBlock + '\n\nconst PHRASES = ');
  }

  // Replace or insert EXPERIENCES array
  const expPattern = /const EXPERIENCES = \[[\s\S]*?\];/;
  const expBlock = 'const EXPERIENCES = ' + JSON.stringify(experiences, null, 2) + ';';
  if (expPattern.test(html)) {
    html = html.replace(expPattern, expBlock);
  } else {
    html = html.replace('const TRIGGER_PHRASES = ', expBlock + '\n\n' + 'const TRIGGER_PHRASES = ');
  }

  // Replace or insert SITUATIONS array
  const situPattern = /const SITUATIONS = \[[\s\S]*?\];/;
  const situBlock = 'const SITUATIONS = ' + JSON.stringify(situations, null, 2) + ';';
  if (situPattern.test(html)) {
    html = html.replace(situPattern, situBlock);
  } else {
    html = html.replace('const EXPERIENCES = ', situBlock + '\n\n' + 'const EXPERIENCES = ');
  }

  // Replace or insert LISTEN_CLIPS array
  const lcPattern = /const LISTEN_CLIPS = \[[\s\S]*?\];/;
  const lcBlock = 'const LISTEN_CLIPS = ' + JSON.stringify(listenClips, null, 2) + ';';
  if (lcPattern.test(html)) {
    html = html.replace(lcPattern, lcBlock);
  } else {
    html = html.replace('const SITUATIONS = ', lcBlock + '\n\n' + 'const SITUATIONS = ');
  }

  // Replace or insert CULTURE_NOTES array
  const cnPattern = /const CULTURE_NOTES = \[[\s\S]*?\];/;
  const cnBlock = 'const CULTURE_NOTES = ' + JSON.stringify(cultureNotes, null, 2) + ';';
  if (cnPattern.test(html)) {
    html = html.replace(cnPattern, cnBlock);
  } else {
    html = html.replace('const LISTEN_CLIPS = ', cnBlock + '\n\n' + 'const LISTEN_CLIPS = ');
  }

  fs.writeFileSync(HTML_FILE, html, 'utf8');
  console.log(`Updated index.html with ${phrases.length} phrases, ${triggerPhrases.length} trigger phrases, ${experiences.length} experiences, ${situations.length} situations, ${listenClips.length} listen clips, ${cultureNotes.length} culture notes`);
}

function gitCommitAndPush() {
  execSync('git add index.html', { cwd: __dirname, stdio: 'inherit' });
  const staged = execSync('git diff --cached --name-only', { cwd: __dirname }).toString().trim();
  if (!staged) {
    console.log('No changes to commit — data already up to date');
    return;
  }
  execSync('git commit -m "sync phrases from Airtable"', { cwd: __dirname, stdio: 'inherit' });
  execSync('git push', { cwd: __dirname, stdio: 'inherit' });
  console.log('Pushed to GitHub — Netlify will redeploy automatically');
}

(async () => {
  console.log('Fetching records from Airtable...');

  // Fetch all six tables in parallel
  const [phraseRecords, triggerRecords, experienceRecords, situationRecords, listenClipRecords, cultureNoteRecords] = await Promise.all([
    fetchAllRecords(PHRASES_TABLE),
    fetchAllRecords(TRIGGER_TABLE),
    fetchAllRecords(EXPERIENCES_TABLE),
    fetchAllRecords(SITUATIONS_TABLE),
    fetchAllRecords(LISTEN_CLIPS_TABLE),
    fetchAllRecords(CULTURE_NOTES_TABLE),
  ]);

  console.log(`Fetched ${phraseRecords.length} phrases, ${triggerRecords.length} trigger phrases, ${experienceRecords.length} experiences, ${situationRecords.length} situations, ${listenClipRecords.length} listen clips, ${cultureNoteRecords.length} culture notes`);

  // Process phrases
  const allPhrases = phraseRecords.map(recordToPhrase);
  const phrases = allPhrases.filter(p => !p.isBuildupChunk);
  console.log(`Excluded ${allPhrases.length - phrases.length} buildup chunks`);

  // Process trigger phrases
  const triggerPhrases = triggerRecords.map(recordToTrigger);

  // Process experiences
  const experiences = experienceRecords.map(recordToExperience);

  // Process situations
  const situations = situationRecords.map(recordToSituation);

  // Process listen clips
  const listenClips = listenClipRecords.map(recordToListenClip);

  // Process culture notes
  const cultureNotes = cultureNoteRecords
    .map(recordToCultureNote)
    .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));

  // Debug logging
  const recovery = phrases.filter(p => p.tier === 'Recovery');
  console.log(`Recovery phrases (${recovery.length}):`, recovery.map(p => p.native));

  const foundation = phrases.filter(p => p.tier === '1').sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
  console.log(`Foundation phrases in sort order (${foundation.length}):`, foundation.map(p => `${p.sortOrder}: ${p.native}`));

  const withCapability = phrases.filter(p => p.capabilityLabel);
  console.log(`Phrases with capabilityLabel (${withCapability.length})`);

  const cafeTriggers = triggerPhrases.filter(t => t.experience === 'At the Café');
  console.log(`At the Café trigger phrases (${cafeTriggers.length}):`, cafeTriggers.map(t => t.triggerPhrase));

  const cafeL1 = experiences.find(e => e.name === 'At the Café' && e.depthLevel === 'Level 1 — Survive it');
  console.log(`Café L1 arc:`, cafeL1?.arc ? cafeL1.arc.slice(0, 80) + '...' : 'NOT FOUND');

  const frenchSituations = situations.filter(s => s.language === 'French');
  console.log(`French situations (${frenchSituations.length})`);
  console.log(`Situations with recoveryAlsoValid (${situations.filter(s => s.recoveryAlsoValid).length})`);

  const frenchClips = listenClips.filter(c => c.language === 'French' && c.audioRecorded);
  console.log(`French listen clips with audio (${frenchClips.length})`);

  console.log(`Culture notes by language:`, Object.fromEntries(
    Object.entries(cultureNotes.reduce((acc, n) => { acc[n.language] = (acc[n.language]||0)+1; return acc; }, {}))
  ));

  updateHtmlFile(phrases, triggerPhrases, experiences, situations, listenClips, cultureNotes);
  gitCommitAndPush();
})();
