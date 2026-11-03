// Validates maintenance.yaml (converted to JSON beforehand) and renders a
// Markdown summary of the next maintenance for each instance.
//
// Usage: node check-maintenance.mjs <maintenance.json> <output.md>
// Exits with code 1 when the file is invalid (the summary is still written).

import { readFileSync, writeFileSync } from 'node:fs';

const INSTANCES = { anct: 'ANCT', dinum: 'DINUM', preprod: 'Preprod' };
// CEST = heure d'été (+0200), CET = heure d'hiver (+0100).
const TZ_OFFSETS = { CET: '+01:00', CEST: '+02:00' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const [inputPath, outputPath] = process.argv.slice(2);

const parisFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  dateStyle: 'full',
  timeStyle: 'short',
});

// Returns "CET" or "CEST" depending on the actual Paris offset at this date.
function parisTzName(date) {
  const name = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    timeZoneName: 'longOffset',
  }).formatToParts(date).find((p) => p.type === 'timeZoneName').value;
  return name === 'GMT+02:00' ? 'CEST' : 'CET';
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

function checkInstance(conf) {
  const errors = [];
  const warnings = [];

  if (conf === null || typeof conf !== 'object' || Array.isArray(conf)) {
    return { errors: ['la configuration doit être un objet'], warnings };
  }

  const { tz, startDate, durationMinutes, completeInterruption } = conf;

  if (!(tz in TZ_OFFSETS)) {
    errors.push(`\`tz\` doit valoir \`CET\` ou \`CEST\` (reçu : \`${tz}\`)`);
  }
  if (typeof startDate !== 'string' || !DATE_RE.test(startDate)) {
    errors.push(`\`startDate\` doit être au format \`AAAA-MM-JJTHH:MM[:SS]\` (reçu : \`${startDate}\`)`);
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    errors.push(`\`durationMinutes\` doit être un entier strictement positif (reçu : \`${durationMinutes}\`)`);
  }
  if (typeof completeInterruption !== 'boolean') {
    errors.push(`\`completeInterruption\` doit être un booléen (reçu : \`${completeInterruption}\`)`);
  }
  if (errors.length) return { errors, warnings };

  const start = new Date(startDate + TZ_OFFSETS[tz]);
  if (Number.isNaN(start.getTime())) {
    return { errors: [`\`startDate\` n'est pas une date valide (\`${startDate}\`)`], warnings };
  }
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  const expectedTz = parisTzName(start);
  if (expectedTz !== tz) {
    warnings.push(`\`tz\` vaut \`${tz}\` mais Paris sera en \`${expectedTz}\` à cette date : l'heure affichée diffère d'une heure de \`startDate\``);
  }
  if (end < new Date()) {
    warnings.push('la maintenance est dans le passé');
  }

  return { errors, warnings, start, end, durationMinutes, completeInterruption };
}

let data;
let parseError;
try {
  data = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (e) {
  parseError = e.message;
}

const lines = ['## 🛠️ Prochaine maintenance', ''];
let hasErrors = false;

if (parseError || data === null || typeof data !== 'object') {
  hasErrors = true;
  lines.push(`❌ Impossible de lire \`maintenance.yaml\` : ${parseError ?? 'le document doit être un objet'}`);
} else {
  const details = [];
  lines.push(
    '| Instance | Début (heure de Paris) | Fin (heure de Paris) | Durée | Interruption de service |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const [key, label] of Object.entries(INSTANCES)) {
    if (!(key in data)) {
      hasErrors = true;
      lines.push(`| ${label} | ❌ instance \`${key}\` absente | | | |`);
      continue;
    }
    const res = checkInstance(data[key]);
    if (res.errors.length) {
      hasErrors = true;
      lines.push(`| ${label} | ❌ configuration invalide | | | |`);
      details.push(...res.errors.map((e) => `- ❌ **${label}** : ${e}`));
      continue;
    }
    details.push(...res.warnings.map((w) => `- ⚠️ **${label}** : ${w}`));
    lines.push(`| ${label} | ${parisFormatter.format(res.start)} | ${parisFormatter.format(res.end)} | ${formatDuration(res.durationMinutes)} | ${res.completeInterruption ? '💥 Oui' : 'Non'} |`);
  }
  if (details.length) lines.push('', ...details);
}

lines.push('', hasErrors ? '❌ `maintenance.yaml` est invalide.' : '✅ `maintenance.yaml` est valide.');

const markdown = lines.join('\n') + '\n';
writeFileSync(outputPath, markdown);
console.log(markdown);
process.exit(hasErrors ? 1 : 0);
