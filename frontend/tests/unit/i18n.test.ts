import assert from 'node:assert/strict';
import test from 'node:test';
import common from '../../lib/i18n/messages/common';
import details from '../../lib/i18n/messages/details';
import event from '../../lib/i18n/messages/event';
import home from '../../lib/i18n/messages/home';
import slots from '../../lib/i18n/messages/slots';
import tickets from '../../lib/i18n/messages/tickets';
import { LOCALES, type Messages } from '../../lib/i18n/types';

const namespaces: Record<string, Messages> = { common, details, event, home, slots, tickets };
const vars = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every English string is translated into Chinese, Korean and Japanese, with the same {variables}', () => {
  const problems: string[] = [];
  for (const [ns, messages] of Object.entries(namespaces)) {
    for (const [key, english] of Object.entries(messages.en)) {
      for (const locale of LOCALES.filter((l) => l !== 'en')) {
        const text = messages[locale][key];
        // Split-sentence parts (fooBefore / fooAfter) may be empty where the word order puts the variable first or last.
        if (text === undefined || (!text.trim() && !/(Before|After)$/.test(key))) problems.push(`${locale} missing ${ns}.${key}`);
        else if (vars(text) !== vars(english)) problems.push(`${locale} ${ns}.${key}: variables {${vars(text)}} vs English {${vars(english)}}`);
      }
    }
    for (const locale of LOCALES) {
      for (const key of Object.keys(messages[locale])) {
        if (!(key in messages.en)) problems.push(`${locale} has ${ns}.${key}, which English lacks`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('every t("ns.key") used in the attendee pages exists in English', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== 'admin' || dir.endsWith('components')) walk(path); }
      else if (/\.tsx?$/.test(name)) files.push(path);
    }
  };
  for (const dir of ['app', 'components', 'lib']) walk(dir);
  const missing: string[] = [];
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z]+)\.([a-zA-Z0-9]+)'/g)) {
      const ns = namespaces[m[1]!];
      if (!ns || !(m[2]! in ns.en)) missing.push(`${file}: ${m[1]}.${m[2]}`);
    }
    for (const m of readFileSync(file, 'utf8').matchAll(/[^\w.]t\(\s*'([a-zA-Z0-9]+)'\s*[,)]/g)) {
      if (/useI18n/.test(readFileSync(file, 'utf8'))) missing.push(`${file}: "${m[1]}" has no namespace`);
    }
  }
  assert.deepEqual(missing, []);
});
