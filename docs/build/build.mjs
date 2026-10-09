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
import JSZip from 'jszip';

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
// Black and white: black text, grey borders and header fills. Only the note boxes carry a light tint.
// Roboto for body text, Poppins for headings (fonts/, SIL OFL 1.1).
const INK = '1A1A1A', MUTED = '595959', RULE = 'BFBFBF', HEAD_BG = 'F2F2F2', NOTE_BG = 'F7F7F7', CODE_BG = 'F4F4F4';
const fontFile = (name) => fs.readFileSync(path.join(HERE, 'fonts', `${name}.ttf`));
const FONT_FACES = [['Roboto', 400, 'normal', 'Roboto-Regular'], ['Roboto', 400, 'italic', 'Roboto-Italic'], ['Roboto', 700, 'normal', 'Roboto-Bold'],
  ['Roboto', 700, 'italic', 'Roboto-BoldItalic'], ['Poppins', 500, 'normal', 'Poppins-Medium'], ['Poppins', 600, 'normal', 'Poppins-SemiBold']]
  .map(([family, weight, style, file]) => `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};src:url(data:font/ttf;base64,${fontFile(file).toString('base64')}) format('truetype');}`).join('\n');
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
// Conventional light fills: notes blue, tips green, important warnings amber.
const CALLOUTS = { 'Tip:': ['tip', 'EAF6EC', 'A8D5B0'], 'Note:': ['note', 'EAF2FB', 'A9C4E4'], 'Important:': ['important', 'FFF4D6', 'E5C46A'] };
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
  return `<div class="callout ${c.kind[0]}"><span class="label">${c.label}:</span> ${this.parser.parseInline(c.rest).replace(/^\s+/, '')}${t.length > 1 ? this.parser.parse(t.slice(1)) : ''}</div>`;
};
const bodyHtml = marked.parser(tokens, { renderer });
const toc = tokens.filter((t) => t.type === 'heading' && t.depth <= 2)
  .map((t) => `<li class="toc-${t.depth}"><a href="#${slug(t.text)}">${t.text.replace(/`/g, '')}</a></li>`).join('');
// Code is set in black; comments in grey italics.
const hljsCss = '.hljs-comment{color:#6E6E6E;font-style:italic}';

const html = `<!doctype html><html><head><meta charset="utf-8"><title>${META.title} — ${META.subtitle}</title><style>
${FONT_FACES}
@page { size: A4; margin: 24mm 20mm 22mm 20mm; }
* { box-sizing: border-box; }
body { font-family: Roboto, Arial, sans-serif; color: #${INK}; font-size: 10pt; line-height: 1.55; }
h1, h2, h3, h4, h5, .cover h1, .cover h2 { font-family: Poppins, Arial, sans-serif; font-weight: 600; }
.cover { height: 244mm; display: flex; flex-direction: column; page-break-after: always; }
.cover .logo { height: 13mm; }
.cover .title { margin-top: 70mm; }
.cover h1 { font-size: 30pt; margin: 0 0 2mm; color: #${INK}; border: 0; padding: 0; page-break-before: auto; }
.cover h2 { font-size: 16pt; font-weight: 500; margin: 0; color: #${MUTED}; border: 0; padding: 0; }
.cover table.meta { margin-top: auto; width: 100%; }
.cover table.meta td:first-child { width: 38mm; background: #${HEAD_BG}; font-weight: 700; }
.control { page-break-after: always; }
h1 { font-size: 20pt; color: #${INK}; margin: 0 0 12pt; padding-bottom: 4pt; border-bottom: 1px solid #${RULE}; page-break-before: always; }
.control h1, .toc h1 { page-break-before: auto; }
h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
h2 { font-size: 13.5pt; color: #${INK}; margin: 18pt 0 6pt; }
h3 { font-size: 11.5pt; margin: 14pt 0 4pt; color: #${INK}; }
h4 { font-size: 10.5pt; margin: 12pt 0 3pt; color: #${INK}; } h5 { font-size: 10pt; margin: 10pt 0 3pt; }
p { margin: 0 0 7pt; } ul, ol { margin: 0 0 8pt; padding-left: 20pt; } li { margin: 2pt 0; }
a { color: #${INK}; text-decoration: underline; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 9pt; background: #${CODE_BG}; padding: 0 2pt; color: #${INK}; }
pre.code { position: relative; background: #${CODE_BG}; border: 1px solid #${RULE}; padding: 8pt 10pt; margin: 6pt 0 10pt; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
pre.code code { background: none; padding: 0; font-size: 8.4pt; line-height: 1.45; color: #${INK}; }
pre.code .lang { position: absolute; top: 3pt; right: 7pt; font-size: 6.5pt; color: #8C8C8C; text-transform: uppercase; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 12pt; font-size: 9pt; line-height: 1.4; page-break-inside: auto; }
th, td { border: 1px solid #${RULE}; padding: 5pt 7pt; vertical-align: top; text-align: left; }
th { background: #${HEAD_BG}; font-weight: 700; } tr { page-break-inside: avoid; }
.toc ol { list-style: none; padding: 0; } .toc li { margin: 0; padding: 2pt 0; }
.toc .toc-1 { font-weight: 700; margin-top: 8pt; } .toc .toc-2 { padding-left: 8mm; }
figure { margin: 8pt 0 12pt; text-align: center; page-break-inside: avoid; }
figure img { border: 1px solid #${RULE}; }
figure.phone img { width: 56mm; } figure.wide img { width: 100%; }
.figrow { display: flex; justify-content: center; gap: 10mm; page-break-inside: avoid; } .figrow figure { margin: 6pt 0 10pt; flex: 0 1 auto; } .figrow figure.phone img { width: 48mm; }
.figrow figure figcaption { max-width: 52mm; margin-left: auto; margin-right: auto; }
figcaption { font-size: 8.5pt; color: #${MUTED}; margin-top: 4pt; line-height: 1.35; }
figcaption b { color: #${INK}; }
.callout { border: 1px solid #${RULE}; background: #${NOTE_BG}; padding: 7pt 10pt; margin: 8pt 0 12pt; page-break-inside: avoid; }
${Object.values(CALLOUTS).map(([kind, fill, edge]) => `.callout.${kind} { background: #${fill}; border-color: #${edge}; }`).join(' ')}
.callout .label { font-weight: 700; }
.callout p:last-child { margin-bottom: 0; }
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
  headerTemplate: `<div style="font-size:7.5pt;color:#595959;width:100%;margin:0 20mm;padding-bottom:3pt;border-bottom:0.5pt solid #BFBFBF;display:flex;justify-content:space-between;font-family:Roboto,Arial"><span>${META.title}: ${META.subtitle}</span><span>${META.docNo} &nbsp;Version ${META.version}</span></div>`,
  footerTemplate: `<div style="font-size:7.5pt;color:#595959;width:100%;margin:0 20mm;padding-top:3pt;border-top:0.5pt solid #BFBFBF;display:flex;justify-content:space-between;font-family:Roboto,Arial"><span>${META.owner} &middot; Internal</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
});
await browser.close();
console.log('PDF', pdfPath);

/* ---------- DOCX ---------- */

const FONT = 'Roboto', HFONT = 'Poppins SemiBold', MONO = 'Consolas';
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
      if (part) lines.at(-1).push(new D.TextRun({ text: part, font: MONO, size: 16, color: cls === 'comment' ? '6E6E6E' : INK, italics: cls === 'comment' }));
    });
  }
  return lines;
}

function inlineRuns(toks, base = {}) {
  const runs = [];
  for (const t of toks || []) {
    if (t.type === 'text' || t.type === 'escape') {
      if (t.tokens) runs.push(...inlineRuns(t.tokens, base));
      else runs.push(new D.TextRun({ text: decode(t.text), font: FONT, ...base }));
    } else if (t.type === 'strong') runs.push(...inlineRuns(t.tokens, { ...base, bold: true }));
    else if (t.type === 'em') runs.push(...inlineRuns(t.tokens, { ...base, italics: true }));
    else if (t.type === 'codespan') runs.push(new D.TextRun({ text: decode(t.text), font: MONO, size: 18, color: INK }));
    else if (t.type === 'link') runs.push(new D.ExternalHyperlink({ link: t.href, children: inlineRuns(t.tokens, { ...base, underline: {} }) }));
    else if (t.type === 'br') runs.push(new D.TextRun({ break: 1 }));
    else if (t.raw) runs.push(new D.TextRun({ text: decode(t.raw), font: FONT, ...base }));
  }
  return runs;
}

const CONTENT_WIDTH = 9026; // A4 width minus 1" margins, in DXA
const NONE = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const rule = (size, color = INK) => ({ style: D.BorderStyle.SINGLE, size, color });
const GRID = { style: D.BorderStyle.SINGLE, size: 4, color: RULE };
const gridBorders = { top: GRID, bottom: GRID, left: GRID, right: GRID };
function table(t) {
  const cols = t.header.length;
  const weights = t.header.map((h, i) => Math.max(4, Math.min(60, Math.max(h.text.length, ...t.rows.map((r) => (r[i]?.text || '').length)))));
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.round((w / total) * CONTENT_WIDTH));
  widths[cols - 1] += CONTENT_WIDTH - widths.reduce((a, b) => a + b, 0);
  const cell = (c, i, header) => new D.TableCell({
    width: { size: widths[i], type: D.WidthType.DXA },
    shading: header ? { type: D.ShadingType.CLEAR, fill: HEAD_BG, color: 'auto' } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    borders: gridBorders,
    children: [new D.Paragraph({ children: inlineRuns(c.tokens, header ? { bold: true, size: 18 } : { size: 18 }) })],
  });
  return new D.Table({
    width: { size: CONTENT_WIDTH, type: D.WidthType.DXA }, columnWidths: widths,
    rows: [new D.TableRow({ tableHeader: true, children: t.header.map((c, i) => cell(c, i, true)) }),
      ...t.rows.map((r) => new D.TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) }))],
  });
}

let docxFigure = 0;
const caption = (text) => { docxFigure += 1; return [
  new D.TextRun({ text: `Figure ${docxFigure}`, bold: true, size: 17, color: INK }),
  new D.TextRun({ text: `  ${text}`, size: 17, color: MUTED })]; };
const picture = (file, w, text, href) => { const { width, height } = pngSize(file); return new D.ImageRun({ type: 'png', data: fs.readFileSync(file),
  transformation: { width: w, height: Math.round((w * height) / width) }, altText: { title: text, description: text, name: href },
  outline: { type: 'solidFill', solidFillType: 'rgb', value: 'A6A6A6' } }); };

const HEADINGS = { 1: D.HeadingLevel.HEADING_1, 2: D.HeadingLevel.HEADING_2, 3: D.HeadingLevel.HEADING_3, 4: D.HeadingLevel.HEADING_4, 5: D.HeadingLevel.HEADING_5 };
const body = [];
function block(t, level = 0) {
  switch (t.type) {
    case 'heading':
      body.push(new D.Paragraph({ heading: HEADINGS[Math.min(t.depth, 5)], pageBreakBefore: t.depth === 1, children: inlineRuns(t.tokens, { font: HFONT }) }));
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
      // A plain bordered box with a light fill; the label leads the text.
      body.push(new D.Table({
        width: { size: CONTENT_WIDTH, type: D.WidthType.DXA }, columnWidths: [CONTENT_WIDTH],
        rows: [new D.TableRow({ cantSplit: true, children: [new D.TableCell({
          width: { size: CONTENT_WIDTH, type: D.WidthType.DXA },
          shading: { type: D.ShadingType.CLEAR, fill: c.kind[1], color: 'auto' },
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          borders: Object.fromEntries(['top', 'bottom', 'left', 'right'].map((side) => [side, { style: D.BorderStyle.SINGLE, size: 4, color: c.kind[2] }])),
          children: [new D.Paragraph({ children: [new D.TextRun({ text: `${c.label}: `, bold: true }),
            ...inlineRuns(c.rest.length && c.rest[0].type === 'text' ? [{ ...c.rest[0], text: c.rest[0].text.replace(/^\s+/, ''), tokens: undefined }, ...c.rest.slice(1)] : c.rest)] })],
        })] })],
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

const metaRow = (k, v) => new D.TableRow({ children: [[k, 2200, true], [v, 6826, false]].map(([text, w, head]) => new D.TableCell({
  width: { size: w, type: D.WidthType.DXA }, margins: { top: 70, bottom: 70, left: 110, right: 110 }, borders: gridBorders,
  shading: head ? { type: D.ShadingType.CLEAR, fill: HEAD_BG, color: 'auto' } : undefined,
  children: [new D.Paragraph({ children: [new D.TextRun({ text, bold: head, size: 19 })] })] })) });
const metaRows = [['Document number', META.docNo], ['Version', META.version], ['Issue date', META.date], ['System', META.url], ['Owner', META.owner], ['Classification', 'Internal']];
const logoSize = (() => { const { width, height } = pngSize(path.join(REPO, 'frontend/public/logos/ssii-logo.png')); return { width: Math.round((48 * width) / height), height: 48 }; })();
const cover = [
  new D.Paragraph({ children: [new D.ImageRun({ type: 'png', data: LOGO, transformation: logoSize, altText: { title: 'SS Innovations', description: 'SS Innovations logo', name: 'logo' } })] }),
  new D.Paragraph({ spacing: { before: 3800, after: 100 }, children: [new D.TextRun({ text: META.title, font: HFONT, size: 60, color: INK })] }),
  new D.Paragraph({ spacing: { after: 3600 }, children: [new D.TextRun({ text: META.subtitle, font: 'Poppins Medium', size: 32, color: MUTED })] }),
  new D.Table({ width: { size: 9026, type: D.WidthType.DXA }, columnWidths: [2200, 6826], rows: metaRows.map(([k, v]) => metaRow(k, v)) }),
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
  fonts: [['Roboto', 'Roboto-Regular'], ['Poppins SemiBold', 'Poppins-SemiBold'], ['Poppins Medium', 'Poppins-Medium']]
    .map(([name, file]) => ({ name, data: fontFile(file), characterSet: D.CharacterSet.ANSI })),
  styles: {
    default: { document: { run: { font: FONT, size: 20, color: INK }, paragraph: { spacing: { line: 276 } } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 40, color: INK, font: HFONT },
        paragraph: { spacing: { before: 0, after: 240 }, outlineLevel: 0, border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, color: INK, font: HFONT }, paragraph: { spacing: { before: 360, after: 100 }, outlineLevel: 1, keepNext: true } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, color: INK, font: HFONT }, paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 2, keepNext: true } },
      { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 19, color: INK, font: HFONT }, paragraph: { spacing: { before: 200, after: 60 }, outlineLevel: 3, keepNext: true } },
      { id: 'Heading5', name: 'Heading 5', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 20, color: INK, font: HFONT }, paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 4, keepNext: true } },
    ],
  },
  numbering: { config: [
    { reference: 'bullets', levels: [0, 1, 2].map((level) => ({ level, format: D.LevelFormat.BULLET, text: ['•', '–', '·'][level], alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + level * 360, hanging: 240 } } } })) },
    { reference: 'numbers', levels: [0, 1, 2].map((level) => ({ level, format: D.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + level * 360, hanging: 300 } } } })) },
  ] },
  sections: [{
    properties: { titlePage: true, page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1300, left: 1440, right: 1440 } } },
    headers: { default: new D.Header({ children: [new D.Paragraph({ tabStops: [{ type: D.TabStopType.RIGHT, position: 9026 }],
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: RULE, space: 3 } },
      children: [new D.TextRun({ text: `${META.title}: ${META.subtitle}`, size: 15, color: MUTED }), new D.TextRun({ text: `\t${META.docNo}  Version ${META.version}`, size: 15, color: MUTED })] })] }) },
    footers: { default: new D.Footer({ children: [new D.Paragraph({ tabStops: [{ type: D.TabStopType.RIGHT, position: 9026 }],
      border: { top: { style: D.BorderStyle.SINGLE, size: 4, color: RULE, space: 3 } },
      children: [new D.TextRun({ text: `${META.owner} · Internal`, size: 15, color: MUTED }),
        new D.TextRun({ children: ['\tPage ', D.PageNumber.CURRENT, ' of ', D.PageNumber.TOTAL_PAGES], size: 15, color: MUTED })] })] }) },
    children: [...cover, ...body],
  }],
});
const docxPath = path.join(OUT, `${META.file}.docx`);
// Word expects upper-case font keys and the embed setting before it uses the embedded fonts.
const zip = await JSZip.loadAsync(await D.Packer.toBuffer(doc));
const fontTable = await zip.file('word/fontTable.xml').async('string');
zip.file('word/fontTable.xml', fontTable.replace(/w:fontKey="(\{[^"]+\})"/g, (_, key) => `w:fontKey="${key.toUpperCase()}"`));
const settings = await zip.file('word/settings.xml').async('string');
// Schema order: the embed settings follow w:displayBackgroundShape.
if (!settings.includes('embedTrueTypeFonts')) zip.file('word/settings.xml', settings.replace('<w:displayBackgroundShape/>', '<w:displayBackgroundShape/><w:embedTrueTypeFonts/><w:saveSubsetFonts/>'));
fs.writeFileSync(docxPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log('DOCX', docxPath);
