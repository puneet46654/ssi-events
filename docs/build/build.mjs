// Builds docs/SSI-Events-Project-Documentation.{pdf,docx} from project-document.md, docs/api-contract.md
// and docs/data-model.md. Usage: cd docs/build && npm ci && npm run build
// Needs Chromium: `npx playwright-core install chromium`, or set CHROME_PATH.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import hljs from 'highlight.js';
import { chromium } from 'playwright-core';
import * as D from 'docx';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = process.argv[3] || path.join(REPO, 'docs');
const DOC = process.argv[2] === 'guide' ? 'guide' : 'project';
const DOCS = {
  project: { subtitle: 'Project Documentation', docNo: 'SSI-EVT-PD-001', file: 'SSI-Events-Project-Documentation', source: 'project-document.md',
    issue: 'First issue: system as deployed at release d0f559b', images: null },
  guide: { subtitle: 'User Guide', docNo: 'SSI-EVT-UG-001', file: 'SSI-Events-User-Guide', source: 'user-guide.md',
    issue: 'First issue: attendee and staff guide for the release of 9 October 2026', images: 'guide-img' },
};
const META = {
  title: 'SSI Events Platform',
  ...DOCS[DOC],
  version: '1.0',
  date: '9 October 2026',
  url: 'https://events.ssistudios.com',
  repo: 'gitlab.com/naveen-ssi/ssi-events',
  owner: 'SS Innovations',
};
// Print palette: black text, grey rules, the brand blue only for the logo and links.
const BRAND = '283F8F', INK = '1A1A1A', MUTED = '595959', RULE = 'BFBFBF', CODE_BG = 'F4F4F4';
const LOGO = fs.readFileSync(path.join(REPO, 'frontend/public/logos/ssii-logo.png'));

/* ---------- Source ---------- */

const shift = (md) => md
  .replace(/^# .*\n+/, '')                       // the file's own title
  .replace(/^(#{1,5}) /gm, (_, h) => `${h}# `);   // one level deeper under the chapter heading
const changes = [
  ['—', 'import', '2026-10-08', 'Application imported from the previous repository; Lambda and CloudFront hosting; merge-request pipeline'],
  ['!1', 'aws-foundation', '2026-10-09 04:32', 'AWS foundation: backend Lambda, DynamoDB table, frontend/backend split'],
  ['!2', 'rename-ssinnovations-events', '2026-10-09 04:43', 'Product renamed to SSInnovations Events; catalogue served at /'],
  ['!3', 'backend-public-events', '2026-10-09 04:45', 'Public events, realtime counters and analytics collection endpoints'],
  ['!4', 'admin-login-event-create', '2026-10-09 04:58', 'Admin sign-in and event creation'],
  ['!5', 'bookings-endpoints', '2026-10-09 05:29', 'Attendee bookings, reschedule, cancel; My Tickets access by ticket grant'],
  ['!6', 'redesign-ssi-design-language', '2026-10-09 05:58', 'SS Innovations design language; category cards; phone-first layout'],
  ['!7', 'admin-events-users', '2026-10-09 06:26', 'Event edit and delete with edit lock; User & Access; activity log'],
  ['!8', 'checkin-bookings', '2026-10-09 06:49', 'Admin bookings list and detail; QR and manual check-in'],
  ['!9', 'ticket-emails', '2026-10-09 07:20', 'Ticket emails through SES; savable ticket card'],
  ['!10', 'hotfix-qrcode-bundle', '2026-10-09 07:30', 'Fix for API start-up failure after !9 (07:22-07:26 UTC); bundle smoke test added to CI'],
  ['!11', 'mantram-setup', '2026-10-09 07:39', 'Registration form by event type; SSi MantraM copy; /mantram page'],
  ['!12', 'homepage-categories', '2026-10-09 07:52', 'Category pages /smrsc, /cme; category cards with images'],
  ['!13', 'ticket-email-cc', '2026-10-09 08:00', 'Staff copied on ticket emails (MAIL_CC)'],
  ['!14', 'category-photos', '2026-10-09 08:00', 'SMRSC and SSi MantraM card photographs'],
  ['!15', 'admin-reports', '2026-10-09 08:06', 'Reports: summary, charts, export ledger'],
  ['!16', 'admin-email-login', '2026-10-09 08:07', 'Admin sign-in by email or login ID'],
  ['!17', 'admin-dashboard', '2026-10-09 08:11', 'Dashboard figures'],
  ['!18', 'analytics-feedback', '2026-10-09 08:19', 'Analytics storage, summary and live view; app feedback'],
  ['!19', 'event-cancel-emails', '2026-10-09 08:31', 'Attendee emails when an event is cancelled (background job)'],
  ['!20', 'checkin-early-walkin', '2026-10-09 08:37', 'Check-in opens 15 minutes early; move early or late arrivals into an open slot'],
  ['!21', 'admin-readable-text', '2026-10-09 08:42', 'Admin text sizes raised (minimum 12 px)'],
  ['!22', 'registration-only', '2026-10-09 08:59', 'Registration-only events (no time slots)'],
  ['!23', 'handover-cleanup', '2026-10-09 09:21', 'Legacy frontend server code removed; local development API; documentation'],
];
const changeTable = ['Merge times are UTC. Each change was merged by a maintainer after its merge-request pipeline passed.', '',
  '| MR | Branch | Merged | Change |', '| --- | --- | --- | --- |',
  ...changes.map((c) => `| ${c.map((x) => x.replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n');

let md = fs.readFileSync(path.join(HERE, META.source), 'utf8');
if (DOC === 'project') md = md
  .replace('{{DATA_MODEL}}', shift(fs.readFileSync(path.join(REPO, 'docs/data-model.md'), 'utf8')).replace('Keep this file and that one in step.', 'The two are kept in step.'))
  .replace('{{API_CONTRACT}}', shift(fs.readFileSync(path.join(REPO, 'docs/api-contract.md'), 'utf8')).replace('This file is the agreement', 'This section is the agreement'))
  .replace('{{CHANGES}}', changeTable);
if (/claude|anthropic|\bai\b|openai|chatgpt|copilot|co-authored/i.test(md)) throw new Error('Source mentions AI tooling');
const tokens = marked.lexer(md);

/* ---------- Highlighting ---------- */

const LANG_ALIAS = { sh: 'bash', shell: 'bash', ts: 'typescript', js: 'javascript', yml: 'yaml' };
function highlight(code, lang) {
  const l = LANG_ALIAS[lang] || lang;
  if (l && hljs.getLanguage(l)) return hljs.highlight(code, { language: l }).value;
  if (!l) return hljs.highlightAuto(code, ['json', 'bash', 'typescript', 'http']).value;
  return hljs.highlight(code, { language: 'plaintext' }).value;
}
// GitHub light palette for hljs classes (shared by PDF CSS and DOCX runs).
const COLORS = {
  keyword: 'CF222E', built_in: '8250DF', type: '8250DF', literal: '0550AE', number: '0550AE', string: '0A3069',
  attr: '0550AE', attribute: '0550AE', property: '0550AE', comment: '6E7781', meta: '8250DF', title: '8250DF',
  'title.function': '8250DF', 'title.class': '953800', params: '24292F', variable: '953800', regexp: '0A3069',
  symbol: '0550AE', punctuation: '57606A', 'template-variable': '953800', subst: '24292F', section: '0550AE', name: '116329', tag: '116329',
};

/* ---------- Images and callouts ---------- */

const imagePath = (href) => path.join(HERE, META.images || '', href);
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
const CALLOUTS = { 'Tip:': ['tip'], 'Note:': ['note'], 'Important:': ['important'] };
function calloutOf(t) {
  const first = t.tokens?.[0];
  const lead = first?.tokens?.[0];
  if (first?.type !== 'paragraph' || lead?.type !== 'strong') return null;
  const kind = CALLOUTS[lead.text.trim()];
  return kind ? { kind, label: lead.text.trim().replace(':', ''), rest: first.tokens.slice(1) } : null;
}

/* ---------- PDF (HTML + Chromium) ---------- */

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => `<pre class="code"><code class="hljs">${highlight(text, (lang || '').trim())}</code>${lang ? `<span class="lang">${lang}</span>` : ''}</pre>`;
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
renderer.heading = function ({ tokens: t, depth }) {
  const text = this.parser.parseInline(t);
  return `<h${depth} id="${slug(text)}">${text}</h${depth}>`;
};
const imagesOnly = (t) => t.some((x) => x.type === 'image') && t.every((x) => x.type === 'image' || (x.type === 'text' && !x.text.trim()));
renderer.paragraph = function ({ tokens: t }) {
  if (imagesOnly(t)) {
    const imgs = t.filter((x) => x.type === 'image');
    const figs = imgs.map((x) => this.parser.parseInline([x])).join('');
    return imgs.length > 1 ? `<div class="figrow">${figs}</div>` : figs;
  }
  return `<p>${this.parser.parseInline(t)}</p>`;
};
let pdfFigure = 0;
renderer.image = ({ href, text }) => {
  const file = imagePath(href);
  const { width, height } = pngSize(file);
  const phone = height > width;
  pdfFigure += 1;
  return `<figure class="${phone ? 'phone' : 'wide'}"><img src="data:image/png;base64,${fs.readFileSync(file).toString('base64')}" alt="${text}"><figcaption><b>Figure ${pdfFigure}</b>&ensp;${text}</figcaption></figure>`;
};
renderer.blockquote = function ({ tokens: t }) {
  const c = calloutOf({ tokens: t });
  if (!c) return `<blockquote>${this.parser.parse(t)}</blockquote>`;
  return `<div class="callout ${c.kind[0]}"><div class="label">${c.label}</div><div class="text">${this.parser.parseInline(c.rest).replace(/^\s+/, '')}${t.length > 1 ? this.parser.parse(t.slice(1)) : ''}</div></div>`;
};
const bodyHtml = marked.parser(tokens, { renderer });
const toc = tokens.filter((t) => t.type === 'heading' && t.depth <= 2)
  .map((t) => `<li class="toc-${t.depth}"><a href="#${slug(t.text)}">${t.text.replace(/`/g, '')}</a></li>`).join('');
const hljsCss = Object.entries(COLORS).map(([k, c]) => `.hljs-${k.replace('.', '.')}{color:#${c}}`).join('')
  + '.hljs-title.function_{color:#8250DF}.hljs-title.class_{color:#953800}.hljs-comment{font-style:italic}';

const html = `<!doctype html><html><head><meta charset="utf-8"><title>${META.title} — ${META.subtitle}</title><style>
@page { size: A4; margin: 24mm 20mm 22mm 20mm; }
* { box-sizing: border-box; }
body { font-family: Cambria, Georgia, 'Times New Roman', serif; color: #${INK}; font-size: 10.5pt; line-height: 1.5; }
h1, h2, h3, h4, h5, th, figcaption, .callout .label, .cover, .toc, table { font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; }
.cover { height: 244mm; display: flex; flex-direction: column; page-break-after: always; }
.cover .logo { height: 13mm; }
.cover .title { margin-top: 62mm; border-top: 2.2pt solid #${INK}; padding-top: 7mm; }
.cover h1 { font-size: 30pt; font-weight: 700; margin: 0 0 3mm; color: #${INK}; letter-spacing: -0.2pt; border: 0; padding: 0; page-break-before: auto; }
.cover h2 { font-size: 16pt; font-weight: 400; margin: 0; color: #${MUTED}; border: 0; padding: 0; }
.cover table.meta { margin-top: auto; width: 100%; font-size: 9pt; border-top: 1pt solid #${INK}; border-bottom: 1pt solid #${INK}; }
.cover table.meta td { border: 0; border-bottom: 0.5pt solid #D9D9D9; padding: 4pt 0; background: none !important; }
.cover table.meta tr:last-child td { border-bottom: 0; }
.cover table.meta td:first-child { width: 32mm; color: #${MUTED}; }
.control { page-break-after: always; }
h1 { font-size: 20pt; font-weight: 700; color: #${INK}; margin: 0 0 14pt; padding-bottom: 5pt; border-bottom: 1pt solid #${INK}; page-break-before: always; }
.control h1, .toc h1 { page-break-before: auto; }
h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
h2 { font-size: 13pt; font-weight: 700; color: #${INK}; margin: 20pt 0 6pt; }
h3 { font-size: 11pt; font-weight: 700; margin: 14pt 0 4pt; color: #${INK}; }
h4 { font-size: 10pt; font-weight: 700; margin: 12pt 0 3pt; color: #${INK}; text-transform: uppercase; letter-spacing: 0.4pt; } h5 { font-size: 10pt; margin: 10pt 0 3pt; }
p { margin: 0 0 7pt; } ul, ol { margin: 0 0 8pt; padding-left: 20pt; } li { margin: 2pt 0; } ol > li::marker { font-family: Arial, sans-serif; font-weight: 700; }
a { color: #${INK}; text-decoration: underline; text-decoration-color: #${RULE}; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 9pt; background: none; padding: 0; color: #${INK}; }
pre.code { position: relative; background: #${CODE_BG}; border: 0.5pt solid #${RULE}; padding: 8pt 10pt; margin: 6pt 0 10pt; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
pre.code code { font-size: 8.4pt; line-height: 1.45; color: #24292F; }
pre.code .lang { position: absolute; top: 3pt; right: 7pt; font-family: Arial, sans-serif; font-size: 6.5pt; color: #8C8C8C; text-transform: uppercase; letter-spacing: 0.5pt; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 12pt; font-size: 8.8pt; line-height: 1.4; page-break-inside: auto; border-top: 1.2pt solid #${INK}; border-bottom: 1.2pt solid #${INK}; }
th { text-align: left; font-weight: 700; padding: 4pt 6pt; border-bottom: 0.6pt solid #${INK}; color: #${INK}; }
td { border-bottom: 0.4pt solid #D9D9D9; padding: 4pt 6pt; vertical-align: top; } tr { page-break-inside: avoid; } tbody tr:last-child td { border-bottom: 0; }
.toc ol { list-style: none; padding: 0; } .toc li { margin: 0; padding: 3pt 0; border-bottom: 0.4pt solid #E6E6E6; }
.toc .toc-1 { font-weight: 700; margin-top: 8pt; border-bottom: 0.6pt solid #${INK}; } .toc .toc-2 { padding-left: 12mm; font-size: 9.5pt; }
.toc a { text-decoration: none; }
figure { margin: 8pt 0 12pt; text-align: center; page-break-inside: avoid; }
figure img { border: 0.5pt solid #A6A6A6; }
figure.phone img { width: 56mm; } figure.wide img { width: 100%; }
.figrow { display: flex; justify-content: center; gap: 10mm; page-break-inside: avoid; } .figrow figure { margin: 6pt 0 10pt; flex: 0 1 auto; } .figrow figure.phone img { width: 48mm; }
.figrow figure figcaption { max-width: 52mm; margin-left: auto; margin-right: auto; }
figcaption { font-size: 8.3pt; color: #${MUTED}; margin-top: 4pt; line-height: 1.35; }
figcaption b { color: #${INK}; }
.callout { display: flex; gap: 10pt; margin: 8pt 0 12pt; padding: 6pt 0; border-top: 0.75pt solid #${INK}; border-bottom: 0.75pt solid #${INK}; page-break-inside: avoid; }
.callout .label { flex: 0 0 24mm; font-size: 7.8pt; font-weight: 700; letter-spacing: 0.8pt; text-transform: uppercase; padding-top: 1.5pt; }
.callout .text { flex: 1; } .callout .text p:last-child { margin-bottom: 0; }
.callout.important { border-top-width: 2pt; }
${hljsCss}
</style></head><body>
<section class="cover"><div><img class="logo" src="data:image/png;base64,${LOGO.toString('base64')}" alt="SS Innovations"></div>
<div class="title"><h1>${META.title}</h1><h2>${META.subtitle}</h2></div>
<table class="meta"><tr><td>Document number</td><td>${META.docNo}</td></tr><tr><td>Version</td><td>${META.version}</td></tr><tr><td>Issue date</td><td>${META.date}</td></tr>
<tr><td>System</td><td>${META.url}</td></tr><tr><td>Owner</td><td>${META.owner}</td></tr><tr><td>Classification</td><td>Internal</td></tr></table>
</section>
<section class="control"><h1>Document control</h1>
<table><thead><tr><th>Version</th><th>Date</th><th>Description</th></tr></thead><tbody><tr><td>1.0</td><td>${META.date}</td><td>${META.issue}</td></tr></tbody></table>
<h2>Review and approval</h2>
<table><thead><tr><th style="width:22%">Role</th><th style="width:30%">Name</th><th style="width:28%">Signature</th><th>Date</th></tr></thead><tbody>
<tr><td>Prepared by</td><td>&nbsp;</td><td></td><td></td></tr><tr><td>Reviewed by</td><td>&nbsp;</td><td></td><td></td></tr><tr><td>Approved by</td><td>&nbsp;</td><td></td><td></td></tr></tbody></table>
</section>
<section class="toc"><h1>Contents</h1><ol>${toc}</ol></section>
${bodyHtml}
</body></html>`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
const pdfPath = path.join(OUT, `${META.file}.pdf`);
await page.pdf({
  path: pdfPath, format: 'A4', printBackground: true, displayHeaderFooter: true,
  margin: { top: '24mm', bottom: '22mm', left: '20mm', right: '20mm' },
  headerTemplate: `<div style="font-size:7.5pt;color:#595959;width:100%;margin:0 20mm;padding-bottom:3pt;border-bottom:0.5pt solid #8C8C8C;display:flex;justify-content:space-between;font-family:Arial"><span>${META.title}: ${META.subtitle}</span><span>${META.docNo} &nbsp;Version ${META.version}</span></div>`,
  footerTemplate: `<div style="font-size:7.5pt;color:#595959;width:100%;margin:0 20mm;padding-top:3pt;border-top:0.5pt solid #8C8C8C;display:flex;justify-content:space-between;font-family:Arial"><span>${META.owner} &middot; Internal</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
});
await browser.close();
console.log('PDF', pdfPath);

/* ---------- DOCX ---------- */

const FONT = 'Cambria', HFONT = 'Arial', MONO = 'Consolas';
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');

/** hljs HTML → coloured runs, one array per line. */
function codeRuns(code, lang) {
  const out = highlight(code, lang);
  const lines = [[]]; const stack = [];
  const re = /<span class="([^"]+)">|<\/span>|([^<]+)/g; let m;
  while ((m = re.exec(out))) {
    if (m[1]) { stack.push(m[1].replace(/hljs-/g, '').split(' ')[0].replace(/_$/, '')); continue; }
    if (m[0] === '</span>') { stack.pop(); continue; }
    const cls = [...stack].reverse().find((c) => COLORS[c]);
    decode(m[2]).split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines.at(-1).push(new D.TextRun({ text: part, font: MONO, size: 16, color: cls ? COLORS[cls] : '24292F', italics: cls === 'comment' }));
    });
  }
  return lines;
}

function inlineRuns(toks, base = {}) {
  const runs = [];
  for (const t of toks || []) {
    if (t.type === 'text' || t.type === 'escape') {
      if (t.tokens) runs.push(...inlineRuns(t.tokens, base));
      else runs.push(new D.TextRun({ text: decode(t.text), font: FONT, size: 20, ...base }));
    } else if (t.type === 'strong') runs.push(...inlineRuns(t.tokens, { ...base, bold: true }));
    else if (t.type === 'em') runs.push(...inlineRuns(t.tokens, { ...base, italics: true }));
    else if (t.type === 'codespan') runs.push(new D.TextRun({ text: decode(t.text), font: MONO, size: 18, color: INK }));
    else if (t.type === 'link') runs.push(new D.ExternalHyperlink({ link: t.href, children: inlineRuns(t.tokens, { ...base, underline: {} }) }));
    else if (t.type === 'br') runs.push(new D.TextRun({ break: 1 }));
    else if (t.raw) runs.push(new D.TextRun({ text: decode(t.raw), font: FONT, size: 20, ...base }));
  }
  return runs;
}

const CONTENT_WIDTH = 9026; // A4 width minus 1" margins, in DXA
const NONE = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const rule = (size, color = INK) => ({ style: D.BorderStyle.SINGLE, size, color });
function table(t) {
  const cols = t.header.length;
  const weights = t.header.map((h, i) => Math.max(4, Math.min(60, Math.max(h.text.length, ...t.rows.map((r) => (r[i]?.text || '').length)))));
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.round((w / total) * CONTENT_WIDTH));
  widths[cols - 1] += CONTENT_WIDTH - widths.reduce((a, b) => a + b, 0);
  const last = t.rows.length - 1;
  const cell = (c, i, header, ri) => new D.TableCell({
    width: { size: widths[i], type: D.WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    borders: {
      top: header ? rule(10) : NONE, left: NONE, right: NONE,
      bottom: header ? rule(5) : ri === last ? rule(10) : rule(3, 'D9D9D9'),
    },
    children: [new D.Paragraph({ children: inlineRuns(c.tokens, header ? { bold: true, size: 17, font: HFONT } : { size: 17, font: HFONT }) })],
  });
  return new D.Table({
    width: { size: CONTENT_WIDTH, type: D.WidthType.DXA }, columnWidths: widths,
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [new D.TableRow({ tableHeader: true, children: t.header.map((c, i) => cell(c, i, true)) }),
      ...t.rows.map((r, ri) => new D.TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false, ri)) }))],
  });
}

let docxFigure = 0;
const caption = (text) => { docxFigure += 1; return [
  new D.TextRun({ text: `Figure ${docxFigure}`, bold: true, size: 16, font: HFONT, color: INK }),
  new D.TextRun({ text: `  ${text}`, size: 16, font: HFONT, color: MUTED })]; };
const picture = (file, w, text, href) => { const { width, height } = pngSize(file); return new D.ImageRun({ type: 'png', data: fs.readFileSync(file),
  transformation: { width: w, height: Math.round((w * height) / width) }, altText: { title: text, description: text, name: href },
  outline: { type: 'solidFill', solidFillType: 'rgb', value: 'A6A6A6' } }); };

const HEADINGS = { 1: D.HeadingLevel.HEADING_1, 2: D.HeadingLevel.HEADING_2, 3: D.HeadingLevel.HEADING_3, 4: D.HeadingLevel.HEADING_4, 5: D.HeadingLevel.HEADING_5 };
const body = [];
function block(t, level = 0) {
  switch (t.type) {
    case 'heading':
      body.push(new D.Paragraph({ heading: HEADINGS[Math.min(t.depth, 5)], pageBreakBefore: t.depth === 1, children: inlineRuns(t.tokens) }));
      break;
    case 'paragraph': {
      const imgs = t.tokens.filter((x) => x.type === 'image');
      const onlyImages = imgs.length > 0 && t.tokens.every((x) => x.type === 'image' || (x.type === 'text' && !x.text.trim()));
      if (onlyImages && imgs.length > 1) {
        // Side by side: a borderless table, one image and caption per cell.
        const colW = Math.floor(CONTENT_WIDTH / imgs.length);
        const none = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
        body.push(new D.Table({ width: { size: colW * imgs.length, type: D.WidthType.DXA }, columnWidths: imgs.map(() => colW),
          borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
          rows: [new D.TableRow({ cantSplit: true, children: imgs.map((img) => {
            const w = imgs.length > 2 ? 180 : 200;
            return new D.TableCell({ width: { size: colW, type: D.WidthType.DXA }, borders: { top: none, left: none, bottom: none, right: none }, children: [
              new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [picture(imagePath(img.href), w, img.text, img.href)] }),
              new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 60, after: 120 }, children: caption(img.text) }),
            ] });
          }) })] }), new D.Paragraph({ spacing: { after: 80 }, children: [] }));
        break;
      }
      const only = onlyImages ? imgs[0] : null;
      if (!only) { body.push(new D.Paragraph({ spacing: { after: 120 }, children: inlineRuns(t.tokens) })); break; }
      const file = imagePath(only.href);
      const { width, height } = pngSize(file);
      const w = height > width ? 200 : 600; // points-ish pixels at 96 dpi
      body.push(
        new D.Paragraph({ alignment: D.AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 }, children: [picture(file, w, only.text, only.href)] }),
        new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 200 }, children: caption(only.text) }),
      );
      break;
    }
    case 'list':
      for (const item of t.items) {
        const [first, ...rest] = item.tokens;
        const runs = first?.type === 'text' ? inlineRuns(first.tokens || [first]) : [];
        body.push(new D.Paragraph({ numbering: { reference: t.ordered ? 'numbers' : 'bullets', level }, spacing: { after: 40 }, children: runs }));
        for (const sub of rest) block(sub, level + 1);
      }
      break;
    case 'table': body.push(table(t), new D.Paragraph({ spacing: { after: 80 }, children: [] })); break;
    case 'code': {
      // A one-cell table: shading and borders that Word renders consistently, and the block stays together.
      const lines = codeRuns(t.text, (t.lang || '').trim());
      const edge = { style: D.BorderStyle.SINGLE, size: 4, color: RULE };
      body.push(new D.Table({
        width: { size: CONTENT_WIDTH, type: D.WidthType.DXA }, columnWidths: [CONTENT_WIDTH],
        rows: [new D.TableRow({ cantSplit: lines.length < 40, children: [new D.TableCell({
          width: { size: CONTENT_WIDTH, type: D.WidthType.DXA },
          shading: { type: D.ShadingType.CLEAR, fill: CODE_BG, color: 'auto' },
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          borders: { top: edge, left: edge, bottom: edge, right: edge },
          children: lines.map((runs) => new D.Paragraph({ spacing: { before: 0, after: 0, line: 250 },
            children: runs.length ? runs : [new D.TextRun({ text: ' ', font: MONO, size: 16 })] })),
        })] })],
      }), new D.Paragraph({ spacing: { after: 100 }, children: [] }));
      break;
    }
    case 'blockquote': {
      const c = calloutOf(t);
      if (!c) { for (const sub of t.tokens) block(sub, level); break; }
      // Ruled panel: label column and text, rules above and below (heavier above for Important).
      const top = rule(c.kind[0] === 'important' ? 16 : 6), bottom = rule(6);
      const LABEL_W = 1400;
      const cellOf = (w, children, extra = {}) => new D.TableCell({ width: { size: w, type: D.WidthType.DXA },
        margins: { top: 90, bottom: 90, left: 0, right: 120 }, borders: { top, bottom, left: NONE, right: NONE }, children, ...extra });
      body.push(new D.Table({
        width: { size: CONTENT_WIDTH, type: D.WidthType.DXA }, columnWidths: [LABEL_W, CONTENT_WIDTH - LABEL_W],
        borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
        rows: [new D.TableRow({ cantSplit: true, children: [
          cellOf(LABEL_W, [new D.Paragraph({ children: [new D.TextRun({ text: c.label.toUpperCase(), bold: true, font: HFONT, size: 15, characterSpacing: 16 })] })]),
          cellOf(CONTENT_WIDTH - LABEL_W, [new D.Paragraph({ children: inlineRuns(c.rest.length && c.rest[0].type === 'text' ? [{ ...c.rest[0], text: c.rest[0].text.replace(/^\s+/, ''), tokens: undefined }, ...c.rest.slice(1)] : c.rest) })]),
        ] })],
      }), new D.Paragraph({ spacing: { after: 100 }, children: [] }));
      break;
    }
    case 'hr': body.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } }, children: [] })); break;
    case 'space': break;
    default: if (t.text) body.push(new D.Paragraph({ children: [new D.TextRun({ text: t.text, font: FONT, size: 20 })] }));
  }
}
tokens.forEach((t) => block(t));

const simpleTable = (header, rows, widths) => table({
  header: header.map((h) => ({ text: h, tokens: [{ type: 'text', text: h }] })),
  rows: rows.map((r) => r.map((c) => ({ text: c, tokens: [{ type: 'text', text: c }] }))),
});

const metaRow = (k, v, lastRow) => new D.TableRow({ children: [[k, 2000, MUTED], [v, 7026, INK]].map(([text, w, color]) => new D.TableCell({
  width: { size: w, type: D.WidthType.DXA }, margins: { top: 70, bottom: 70, left: 0, right: 0 },
  borders: { top: NONE, left: NONE, right: NONE, bottom: lastRow ? rule(8) : rule(3, 'D9D9D9') },
  children: [new D.Paragraph({ children: [new D.TextRun({ text, color, font: HFONT, size: 18 })] })] })) });
const metaRows = [['Document number', META.docNo], ['Version', META.version], ['Issue date', META.date], ['System', META.url], ['Owner', META.owner], ['Classification', 'Internal']];
const logoSize = (() => { const { width, height } = pngSize(path.join(REPO, 'frontend/public/logos/ssii-logo.png')); return { width: Math.round((48 * width) / height), height: 48 }; })();
const cover = [
  new D.Paragraph({ children: [new D.ImageRun({ type: 'png', data: LOGO, transformation: logoSize, altText: { title: 'SS Innovations', description: 'SS Innovations logo', name: 'logo' } })] }),
  new D.Paragraph({ spacing: { before: 3400, after: 0 }, border: { top: { style: D.BorderStyle.SINGLE, size: 18, color: INK, space: 12 } }, children: [] }),
  new D.Paragraph({ spacing: { after: 100 }, children: [new D.TextRun({ text: META.title, font: HFONT, size: 60, bold: true, color: INK })] }),
  new D.Paragraph({ spacing: { after: 3600 }, children: [new D.TextRun({ text: META.subtitle, font: HFONT, size: 32, color: MUTED })] }),
  new D.Table({ width: { size: 9026, type: D.WidthType.DXA }, columnWidths: [2000, 7026],
    borders: { top: rule(8), bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: metaRows.map(([k, v], i) => metaRow(k, v, i === metaRows.length - 1)) }),
  new D.Paragraph({ children: [new D.PageBreak()] }),
  new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun('Document control')] }),
  simpleTable(['Version', 'Date', 'Description'], [[META.version, META.date, META.issue]]),
  new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, children: [new D.TextRun('Review and approval')] }),
  simpleTable(['Role', 'Name', 'Signature', 'Date'], [['Prepared by', ' ', ' ', ' '], ['Reviewed by', ' ', ' ', ' '], ['Approved by', ' ', ' ', ' ']]),
  new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new D.TextRun('Contents')] }),
  new D.TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
];

const doc = new D.Document({
  creator: META.owner, title: `${META.title} — ${META.subtitle}`, description: META.docNo,
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: FONT, size: 21, color: INK }, paragraph: { spacing: { line: 276 } } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 40, bold: true, color: INK, font: HFONT },
        paragraph: { spacing: { before: 0, after: 240 }, outlineLevel: 0, border: { bottom: { style: D.BorderStyle.SINGLE, size: 8, color: INK, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: INK, font: HFONT }, paragraph: { spacing: { before: 360, after: 100 }, outlineLevel: 1, keepNext: true } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: INK, font: HFONT }, paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 2, keepNext: true } },
      { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 19, bold: true, color: INK, font: HFONT, allCaps: true }, paragraph: { spacing: { before: 200, after: 60 }, outlineLevel: 3, keepNext: true } },
      { id: 'Heading5', name: 'Heading 5', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 20, bold: true, color: INK, font: HFONT }, paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 4, keepNext: true } },
    ],
  },
  numbering: { config: [
    { reference: 'bullets', levels: [0, 1, 2].map((level) => ({ level, format: D.LevelFormat.BULLET, text: ['•', '–', '·'][level], alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + level * 360, hanging: 240 } } } })) },
    { reference: 'numbers', levels: [0, 1, 2].map((level) => ({ level, format: D.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + level * 360, hanging: 300 } } } })) },
  ] },
  sections: [{
    properties: { titlePage: true, page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1300, left: 1440, right: 1440 } } },
    headers: { default: new D.Header({ children: [new D.Paragraph({ tabStops: [{ type: D.TabStopType.RIGHT, position: 9026 }],
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: '8C8C8C', space: 3 } },
      children: [new D.TextRun({ text: `${META.title}: ${META.subtitle}`, size: 15, color: MUTED, font: HFONT }), new D.TextRun({ text: `\t${META.docNo}  Version ${META.version}`, size: 15, color: MUTED, font: HFONT })] })] }) },
    footers: { default: new D.Footer({ children: [new D.Paragraph({ tabStops: [{ type: D.TabStopType.RIGHT, position: 9026 }],
      border: { top: { style: D.BorderStyle.SINGLE, size: 4, color: '8C8C8C', space: 3 } },
      children: [new D.TextRun({ text: `${META.owner} · Internal`, size: 15, color: MUTED, font: HFONT }),
        new D.TextRun({ children: ['\tPage ', D.PageNumber.CURRENT, ' of ', D.PageNumber.TOTAL_PAGES], size: 15, color: MUTED, font: HFONT })] })] }) },
    children: [...cover, ...body],
  }],
});
const docxPath = path.join(OUT, `${META.file}.docx`);
fs.writeFileSync(docxPath, await D.Packer.toBuffer(doc));
console.log('DOCX', docxPath);
