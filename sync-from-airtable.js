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

function existingFilesIn(folder) {
  try {
    return new Set(fs.readdirSync(path.join(__dirname, folder)).filter(f => f.endsWith('.mp3')));
  } catch (e) { return new Set(); }
}
const _audioRootFiles = existingFilesIn('audio');
const _triggerFiles = existingFilesIn('audio/trigger-phrases');
const _listenClipFiles = existingFilesIn('audio/listen-clips');

function audioFileExists(filename) {
  if (!filename) return false;
  if (filename.startsWith('LC') || filename.startsWith('ListenClips_')) return _listenClipFiles.has(filename);
  if (filename.startsWith('T') || filename.startsWith('TriggerPhrases_')) return _triggerFiles.has(filename);
  return _audioRootFiles.has(filename);
}

function buildAudioFilenames(primary, variantsRaw) {
  const variants = (variantsRaw || '')
    .split(/\n/)
    .map(s => s.trim())
    .filter(Boolean);
  // Only include filenames that actually exist on disk so the runtime
  // picker never routes to a missing file.
  return [primary, ...variants].filter(Boolean).filter(audioFileExists);
}

// ── Backward-chaining buildup helpers ──────────────────────────────
// Function words (LLR-approved list) — chunks must contain ≥1 content word.
const _FUNCTION_WORDS = {
  fr: new Set(['le','la','les','un','une','des','de','du','d','l','à','a','au','aux','et','ou','en','dans','sur','pour','par','avec','sans','que','qui','ce','se','si','ne','pas','plus','y','je','tu','il','elle','nous','vous','ils','elles','me','te','lui','mon','ton','son','ma','ta','sa','mes','tes','ses']),
  nl: new Set(['de','het','een','van','in','op','aan','te','bij','voor','met','uit','naar','over','door','om','als','dat','die','dit','deze','der','den','er','ze','we','ik','je','hij','zij','hun','hen','mijn','jouw','zijn','haar','ons','onze']),
  de: new Set(['der','die','das','ein','eine','einem','einen','einer','eines','des','dem','den','von','in','auf','an','zu','bei','mit','aus','nach','über','durch','für','um','als','dass','und','oder','aber','ich','du','er','sie','wir','ihr','mein','dein','sein','ihr','unser','euer']),
};

function generateBuildupChunks(phraseText, langCode, existingPhraseNatives) {
  const normalized = (phraseText || '')
    .replace(/\.\.\.+\s*$/, '')
    .trim()
    .replace(/\s*—\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = normalized.split(' ').filter(t => t.length > 0);
  if (tokens.length <= 2) return [];
  const all = [];
  for (let startIdx = tokens.length - 2; startIdx >= 0; startIdx--) {
    all.push(tokens.slice(startIdx).join(' '));
  }
  const candidates = all.slice(0, -1);
  const funcWords = _FUNCTION_WORDS[langCode] || new Set();
  const existing = new Set((existingPhraseNatives || []).map(s => (s || '').toLowerCase().trim()));
  return candidates.filter(chunk => {
    if (chunk.includes('...')) return false;
    if (existing.has(chunk.toLowerCase().trim())) return false;
    const toks = chunk.toLowerCase().split(/[\s,!?]+/).filter(t => t.length);
    if (!toks.some(t => !funcWords.has(t))) return false;
    return true;
  });
}

// Build a buildupChunks array for a trigger/clip from its parent audio
// filename + computed chunks. Only includes chunks whose audio file is on
// disk so the player never reaches for a missing file.
function buildRuntimeChunks(parentAudioFilename, chunkTexts) {
  if (!parentAudioFilename || !chunkTexts || !chunkTexts.length) return [];
  const stem = parentAudioFilename.replace(/\.mp3$/i, '');
  return chunkTexts.map((text, i) => ({
    text,
    audioFileName: `${stem}_chunk_${i + 1}.mp3`,
    recordingNote: '',
  })).filter(c => audioFileExists(c.audioFileName));
}

// ── Phrases ──

function recordToPhrase(record) {
  const f = record.fields;
  const langRaw = f['Language'];
  const langName = langRaw ? (typeof langRaw === 'object' ? langRaw.name : langRaw) : 'French';
  const lang = LANG_CODE[langName] || 'fr';
  const tierRaw = f['Tier'];
  const tier = tierRaw ? (typeof tierRaw === 'object' ? tierRaw.name : tierRaw) : null;
  const contextLabelRaw = f['Context Label'];
  const contextLabel = contextLabelRaw
    ? (typeof contextLabelRaw === 'object' ? contextLabelRaw.name : contextLabelRaw)
    : '';
  const emoji = f['Emoji'] || f['emoji'] || '';

  return {
    id: record.id,
    lang,
    flag: LANG_FLAG[lang] || '',
    langLabel: langName,
    tier,
    contextLabel,
    sortOrder: f['Sort Order'] || null,
    alwaysCapitalize: f['Always Capitalize'] === true,
    emoji,
    meaning: f['English Meaning'] || '',
    meanings: parseArray(f['Meanings']),
    native: f['Phrase Native'] || '',
    romanization: f['Romanization'] || null,
    note: f['Note'] || '',
    hasBuildup: f['Has Buildup'] === true,
    isBuildupChunk: f['Is Buildup Chunk'] === true,
    buildupParent: f['Buildup Parent'] || '',
    recordingNote: f['Recording Note'] || '',
    capabilityLabel: f['Capability Label'] || '',
    alsoAccepted: parseArray(f['Also Accepted']),
    pendingPackSystem: f['Pending Pack System'] === true,
    audioFileName: f['Audio Filename'] || f['File Name'] || '',
    audioFilenames: buildAudioFilenames(f['Audio Filename'] || f['File Name'] || '', f['Audio Filename Variants']),
    situations: parseArray(f['Situations']),
    situationEarly: parseArray(f['Situation (Early)']),
    situationLate: parseArray(f['Situation (Late)']),
    responses: parseArray(f['Responses']),
    direction: f['Direction'] ? (typeof f['Direction'] === 'object' ? f['Direction'].name : f['Direction']) : '',
    preferenceGroup: Array.isArray(f['Preference Group'])
      ? f['Preference Group'].map(v => typeof v === 'object' ? v.name : v)
      : [],
    substage: f['Substage']
      ? (typeof f['Substage'] === 'object' ? f['Substage'].name : f['Substage'])
      : null,
    tripFocus: Array.isArray(f['Trip Focus'])
      ? f['Trip Focus'].map(v => typeof v === 'object' ? v.name : v)
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
  const tierRaw = f['Tier'];
  const tier = tierRaw ? (typeof tierRaw === 'object' ? tierRaw.name : tierRaw) : '';
  return {
    id: record.id,
    tier,
    triggerPhrase: f['Trigger Phrase'] || '',
    englishTranslation: f['English Translation'] || '',
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
    fileName: f['Audio Filename'] || f['File Name'] || '',
    audioFilenames: buildAudioFilenames(f['Audio Filename'] || f['File Name'] || '', f['Audio Filename Variants']),
    audioRecorded: f['Audio Recorded'] === true,
    hasBuildup: f['Has Buildup'] === true,
    sortOrder: f['Sort Order'] || null,
    difficulty: f['Sort Order'] || 0,
    voice: f['Voice'] || '',
    displayLabel: f['Display Label'] || '',
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
  const tierRaw = f['Tier'];
  const tier = tierRaw ? (typeof tierRaw === 'object' ? tierRaw.name : tierRaw) : '';
  return {
    id: record.id,
    tier,
    frenchText: f['Listen Clip'] || '',
    englishTranslation: f['English Translation'] || '',
    anchorPhrase: f['Anchor Phrase'] || '',
    contextLabel: f['Context Label'] || '',
    scenePrompt: f['Scene Prompt'] || '',
    clipType: f['Clip Type'] || '',
    language: f['Language'] || 'French',
    fileName: f['Audio Filename'] || f['File Name'] || '',
    audioFilenames: buildAudioFilenames(f['Audio Filename'] || f['File Name'] || '', f['Audio Filename Variants']),
    audioRecorded: f['Audio Recorded'] === true,
    hasBuildup: f['Has Buildup'] === true,
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

function updateHtmlFile(phrases, triggerPhrases, experiences, situations, listenClips, cultureNotes, allPhrases) {
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

  // Regenerate audio manifest from all phrases with audio (including buildup chunks)
  const manifest = {};
  allPhrases.filter(p => p.audioFileName && p.native).forEach(p => {
    manifest[p.native] = p.audioFileName;
  });
  // Preserve any existing manifest entries not covered by the sync (e.g.
  // buildup chunks whose File Name may not be set in Airtable)
  const manifestPath = path.join(__dirname, 'audio', 'manifest.json');
  try {
    const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const [k, v] of Object.entries(existing)) {
      if (!manifest[k]) manifest[k] = v;
    }
  } catch (e) { /* first run, no existing manifest */ }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Regenerated audio/manifest.json with ${Object.keys(manifest).length} entries`);
}

function gitCommitAndPush() {
  execSync('git add index.html audio/manifest.json', { cwd: __dirname, stdio: 'inherit' });
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
  const phrases = allPhrases.filter(p => !p.isBuildupChunk && p.tier);
  console.log(`Excluded ${allPhrases.length - phrases.length} buildup chunks`);

  // Index chunk records by their Buildup Parent and attach buildupChunks
  // arrays to every parent phrase. Chunks are ordered by the numeric suffix
  // in their Audio Filename (_chunk_1, _chunk_2, …) so the runtime sequence
  // matches the canonical short→long progression from Phase 2.
  const chunkRecords = allPhrases.filter(p => p.isBuildupChunk && p.buildupParent);
  const chunksByParent = {};
  chunkRecords.forEach(c => {
    (chunksByParent[c.buildupParent] = chunksByParent[c.buildupParent] || []).push(c);
  });
  function chunkOrder(c) {
    const m = (c.audioFileName || '').match(/_chunk_(\d+)\.mp3$/i);
    return m ? parseInt(m[1], 10) : 9999;
  }
  let attachedPhraseChunks = 0;
  phrases.forEach(p => {
    if (!p.hasBuildup) return;
    const kids = chunksByParent[p.id];
    if (!kids || !kids.length) { p.buildupChunks = []; return; }
    p.buildupChunks = kids
      .slice()
      .sort((a, b) => chunkOrder(a) - chunkOrder(b))
      .map(c => ({
        text: c.native,
        audioFileName: c.audioFileName,
        recordingNote: c.recordingNote || '',
      }))
      .filter(c => audioFileExists(c.audioFileName));
    attachedPhraseChunks += p.buildupChunks.length;
  });
  console.log(`Attached buildupChunks to ${phrases.filter(p => p.hasBuildup).length} phrase parents (${attachedPhraseChunks} chunks total)`);

  // Trigger / Listen Clip chunks are computed at sync time from the parent
  // text using the same algorithm; no separate Airtable records exist for them.
  // Dedup against the per-language pool of standalone phrase natives.
  const phraseNativesByLang = { fr: [], nl: [], de: [] };
  phrases.forEach(p => {
    if (p.lang && p.native) (phraseNativesByLang[p.lang] = phraseNativesByLang[p.lang] || []).push(p.native);
  });

  // Process trigger phrases
  const triggerPhrases = triggerRecords.map(recordToTrigger);
  let attachedTriggerChunks = 0, triggersWithBuildup = 0;
  triggerPhrases.forEach(t => {
    if (!t.hasBuildup || !t.fileName || !t.triggerPhrase) { t.buildupChunks = []; return; }
    const code = LANG_CODE[t.language] || null;
    if (!code) { t.buildupChunks = []; return; }
    const texts = generateBuildupChunks(t.triggerPhrase, code, phraseNativesByLang[code] || []);
    t.buildupChunks = buildRuntimeChunks(t.fileName, texts);
    if (t.buildupChunks.length) { triggersWithBuildup++; attachedTriggerChunks += t.buildupChunks.length; }
  });
  console.log(`Computed buildupChunks for ${triggersWithBuildup} trigger phrases (${attachedTriggerChunks} chunks total)`);

  // Process experiences
  const experiences = experienceRecords.map(recordToExperience);

  // Process situations
  const situations = situationRecords.map(recordToSituation);

  // Process listen clips
  const listenClips = listenClipRecords.map(recordToListenClip);
  let attachedClipChunks = 0, clipsWithBuildup = 0;
  listenClips.forEach(c => {
    const native = c.frenchText || '';
    if (!c.hasBuildup || !c.fileName || !native) { c.buildupChunks = []; return; }
    const code = LANG_CODE[c.language] || null;
    if (!code) { c.buildupChunks = []; return; }
    const texts = generateBuildupChunks(native, code, phraseNativesByLang[code] || []);
    c.buildupChunks = buildRuntimeChunks(c.fileName, texts);
    if (c.buildupChunks.length) { clipsWithBuildup++; attachedClipChunks += c.buildupChunks.length; }
  });
  console.log(`Computed buildupChunks for ${clipsWithBuildup} listen clips (${attachedClipChunks} chunks total)`);

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

  updateHtmlFile(phrases, triggerPhrases, experiences, situations, listenClips, cultureNotes, allPhrases);
  gitCommitAndPush();
})();
