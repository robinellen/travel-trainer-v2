require('dotenv').config();

const BASE_ID = 'appkvW8Fy5q6eCKLa';
const API_KEY = process.env.AIRTABLE_API_KEY;
if (!API_KEY) {
  console.error('Missing AIRTABLE_API_KEY in .env');
  process.exit(1);
}

const TABLES = [
  { name: 'Phrases',         id: 'tbljYanxfDihWhaMs', audioField: 'fldHK3jPuDao8pZDl', variantField: 'fldXqCJtQtwEMPGnn' },
  { name: 'Trigger Phrases', id: 'tbltyfoXkuoNdP03O', audioField: 'fldp4bLgQqywjPlux', variantField: 'fldbESFKih84YbUCL' },
  { name: 'Listen Clips',    id: 'tbl8riiiNg48tDyWm', audioField: 'fldJHkvOknZOgo8Xt', variantField: 'fld5RG7TAVyTadZYO' },
];

function toV2(filename) {
  return filename.replace(/\.mp3$/i, '_v2.mp3');
}

async function fetchAll(tableId, fieldIds) {
  const records = [];
  let offset = null;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('returnFieldsByFieldId', 'true');
    for (const f of fieldIds) url.searchParams.append('fields[]', f);
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${API_KEY}` } });
    if (!res.ok) throw new Error(`List ${tableId} failed ${res.status}: ${await res.text()}`);
    const data = await res.json();
    records.push(...data.records);
    offset = data.offset || null;
  } while (offset);
  return records;
}

async function updateBatch(tableId, batch) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?returnFieldsByFieldId=true`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: batch }),
  });
  if (!res.ok) throw new Error(`Update ${tableId} failed ${res.status}: ${await res.text()}`);
}

(async () => {
  for (const t of TABLES) {
    const records = await fetchAll(t.id, [t.audioField, t.variantField]);
    const updates = [];
    for (const r of records) {
      const audio = (r.fields[t.audioField] || '').trim();
      if (!audio) continue;
      updates.push({ id: r.id, fields: { [t.variantField]: toV2(audio) } });
    }
    for (let i = 0; i < updates.length; i += 10) {
      await updateBatch(t.id, updates.slice(i, i + 10));
    }
    console.log(`${t.name}: ${records.length} records, ${updates.length} updated`);
  }
})();
