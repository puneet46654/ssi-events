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
const OUT = process.argv[2] || path.join(REPO, 'docs');
const META = {
  title: 'SSI Events Platform',
  subtitle: 'Project Documentation',
  docNo: 'SSI-EVT-PD-001',
  version: '1.0',
  date: '9 October 2026',
  url: 'https://events.ssistudios.com',
  repo: 'gitlab.com/naveen-ssi/ssi-events',
  owner: 'SS Innovations',
};
const BRAND = '283F8F', INK = '0F1729', MUTED = '5B6275', RULE = 'D9DDE7', CODE_BG = 'F6F8FA';

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

let md = fs.readFileSync(path.join(HERE, 'project-document.md'), 'utf8')
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

/* ---------- PDF (HTML + Chromium) ---------- */

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => `<pre class="code"><code class="hljs">${highlight(text, (lang || '').trim())}</code>${lang ? `<span class="lang">${lang}</span>` : ''}</pre>`;
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
renderer.heading = function ({ tokens: t, depth }) {
  const text = this.parser.parseInline(t);
  return `<h${depth} id="${slug(text)}">${text}</h${depth}>`;
};
const bodyHtml = marked.parser(tokens, { renderer });
const toc = tokens.filter((t) => t.type === 'heading' && t.depth <= 2)
  .map((t) => `<li class="toc-${t.depth}"><a href="#${slug(t.text)}">${t.text.replace(/`/g, '')}</a></li>`).join('');
const hljsCss = Object.entries(COLORS).map(([k, c]) => `.hljs-${k.replace('.', '.')}{color:#${c}}`).join('')
  + '.hljs-title.function_{color:#8250DF}.hljs-title.class_{color:#953800}.hljs-comment{font-style:italic}';

const html = `<!doctype html><html><head><meta charset="utf-8"><title>${META.title} — ${META.subtitle}</title><style>
@page { size: A4; margin: 22mm 18mm 20mm 18mm; }
* { box-sizing: border-box; }
body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #${INK}; font-size: 10pt; line-height: 1.55; }
.cover { height: 248mm; display: flex; flex-direction: column; page-break-after: always; } .cover > div:last-child { margin-top: auto; }
.cover .band { height: 6px; background: linear-gradient(90deg, #283F8F, #23879A, #34BD98); border-radius: 3px; }
.cover h1 { font-size: 34pt; margin: 0 0 4mm; color: #${INK}; letter-spacing: -0.5px; border: 0; }
.cover h2 { font-size: 18pt; margin: 0; color: #${BRAND}; font-weight: 500; border: 0; padding: 0; }
.cover table { width: auto; margin-top: 14mm; font-size: 10pt; }
.cover td { border: 0; padding: 2px 18px 2px 0; } .cover td:first-child { color: #${MUTED}; }
.control { page-break-after: always; }
h1 { font-size: 19pt; color: #${BRAND}; margin: 0 0 12pt; padding-bottom: 6pt; border-bottom: 2px solid #${BRAND}; page-break-before: always; }
.control h1, .toc h1, .cover h1 { page-break-before: auto; }
h2 { font-size: 13.5pt; color: #${INK}; margin: 18pt 0 6pt; } h3 { font-size: 11.5pt; margin: 14pt 0 4pt; color: #${INK}; }
h4 { font-size: 10.5pt; margin: 12pt 0 4pt; color: #${BRAND}; } h5 { font-size: 10pt; margin: 10pt 0 3pt; }
p { margin: 0 0 7pt; } ul, ol { margin: 0 0 7pt; padding-left: 18pt; } li { margin: 1.5pt 0; }
a { color: #${BRAND}; text-decoration: none; }
code { font-family: 'Cascadia Code', Consolas, 'Courier New', monospace; font-size: 8.8pt; background: #EEF1F6; padding: 0.5pt 3pt; border-radius: 3px; color: #1F2D5C; }
pre.code { position: relative; background: #${CODE_BG}; border: 1px solid #${RULE}; border-left: 3px solid #${BRAND}; border-radius: 6px; padding: 9pt 11pt; margin: 6pt 0 10pt; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
pre.code code { background: none; padding: 0; font-size: 8.4pt; line-height: 1.5; color: #24292F; }
pre.code .lang { position: absolute; top: 4pt; right: 8pt; font-size: 7pt; color: #8C95A6; text-transform: uppercase; letter-spacing: 0.5px; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 11pt; font-size: 8.8pt; page-break-inside: auto; }
th { background: #${BRAND}; color: #fff; text-align: left; font-weight: 600; padding: 4pt 6pt; }
td { border-bottom: 1px solid #${RULE}; padding: 4pt 6pt; vertical-align: top; } tr { page-break-inside: avoid; }
tbody tr:nth-child(even) td { background: #F8F9FC; }
.toc ol { list-style: none; padding: 0; columns: 1; } .toc li { margin: 2pt 0; } .toc .toc-2 { padding-left: 16pt; font-size: 9pt; color: #${MUTED}; }
.toc .toc-1 { font-weight: 600; margin-top: 6pt; }
${hljsCss}
</style></head><body>
<section class="cover"><div class="band"></div><div style="margin-top:70mm">
<h1>${META.title}</h1><h2>${META.subtitle}</h2>
<table><tr><td>Document</td><td>${META.docNo}</td></tr><tr><td>Version</td><td>${META.version}</td></tr><tr><td>Date</td><td>${META.date}</td></tr>
<tr><td>System</td><td>${META.url}</td></tr><tr><td>Repository</td><td>${META.repo}</td></tr><tr><td>Owner</td><td>${META.owner}</td></tr></table>
</div><div></div></section>
<section class="control"><h1>Document control</h1>
<table><thead><tr><th>Version</th><th>Date</th><th>Description</th></tr></thead><tbody><tr><td>1.0</td><td>${META.date}</td><td>First issue: system as deployed at release d0f559b</td></tr></tbody></table>
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
const pdfPath = path.join(OUT, 'SSI-Events-Project-Documentation.pdf');
await page.pdf({
  path: pdfPath, format: 'A4', printBackground: true, displayHeaderFooter: true,
  margin: { top: '22mm', bottom: '20mm', left: '18mm', right: '18mm' },
  headerTemplate: `<div style="font-size:7pt;color:#8C95A6;width:100%;padding:0 18mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>${META.title} — ${META.subtitle}</span><span>${META.docNo} v${META.version}</span></div>`,
  footerTemplate: `<div style="font-size:7pt;color:#8C95A6;width:100%;padding:0 18mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>${META.owner} · Internal</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
});
await browser.close();
console.log('PDF', pdfPath);

/* ---------- DOCX ---------- */

const FONT = 'Segoe UI', MONO = 'Consolas';
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
    else if (t.type === 'codespan') runs.push(new D.TextRun({ text: decode(t.text), font: MONO, size: 17, color: '1F2D5C', shading: { type: D.ShadingType.CLEAR, fill: 'EEF1F6', color: 'auto' } }));
    else if (t.type === 'link') runs.push(new D.ExternalHyperlink({ link: t.href, children: inlineRuns(t.tokens, { ...base, color: BRAND }) }));
    else if (t.type === 'br') runs.push(new D.TextRun({ break: 1 }));
    else if (t.raw) runs.push(new D.TextRun({ text: decode(t.raw), font: FONT, size: 20, ...base }));
  }
  return runs;
}

const CONTENT_WIDTH = 9026; // A4 width minus 1" margins, in DXA
const cellBorder = { style: D.BorderStyle.SINGLE, size: 4, color: RULE };
function table(t) {
  const cols = t.header.length;
  const weights = t.header.map((h, i) => Math.max(4, Math.min(60, Math.max(h.text.length, ...t.rows.map((r) => (r[i]?.text || '').length)))));
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.round((w / total) * CONTENT_WIDTH));
  widths[cols - 1] += CONTENT_WIDTH - widths.reduce((a, b) => a + b, 0);
  const cell = (c, i, header, shade) => new D.TableCell({
    width: { size: widths[i], type: D.WidthType.DXA },
    shading: header ? { type: D.ShadingType.CLEAR, fill: BRAND, color: 'auto' } : shade ? { type: D.ShadingType.CLEAR, fill: 'F8F9FC', color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    borders: { top: cellBorder, left: cellBorder, bottom: cellBorder, right: cellBorder },
    children: [new D.Paragraph({ children: inlineRuns(c.tokens, header ? { bold: true, color: 'FFFFFF', size: 17 } : { size: 17 }) })],
  });
  return new D.Table({
    width: { size: CONTENT_WIDTH, type: D.WidthType.DXA }, columnWidths: widths,
    rows: [new D.TableRow({ tableHeader: true, children: t.header.map((c, i) => cell(c, i, true)) }),
      ...t.rows.map((r, ri) => new D.TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false, ri % 2 === 1)) }))],
  });
}

const HEADINGS = { 1: D.HeadingLevel.HEADING_1, 2: D.HeadingLevel.HEADING_2, 3: D.HeadingLevel.HEADING_3, 4: D.HeadingLevel.HEADING_4, 5: D.HeadingLevel.HEADING_5 };
const body = [];
function block(t, level = 0) {
  switch (t.type) {
    case 'heading':
      body.push(new D.Paragraph({ heading: HEADINGS[Math.min(t.depth, 5)], pageBreakBefore: t.depth === 1, children: inlineRuns(t.tokens) }));
      break;
    case 'paragraph': body.push(new D.Paragraph({ spacing: { after: 120 }, children: inlineRuns(t.tokens) })); break;
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
          borders: { top: edge, left: { style: D.BorderStyle.SINGLE, size: 18, color: BRAND }, bottom: edge, right: edge },
          children: lines.map((runs) => new D.Paragraph({ spacing: { before: 0, after: 0, line: 250 },
            children: runs.length ? runs : [new D.TextRun({ text: ' ', font: MONO, size: 16 })] })),
        })] })],
      }), new D.Paragraph({ spacing: { after: 100 }, children: [] }));
      break;
    }
    case 'blockquote': for (const s of t.tokens) block(s, level); break;
    case 'hr': body.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } }, children: [] })); break;
    case 'space': break;
    default: if (t.text) body.push(new D.Paragraph({ children: [new D.TextRun({ text: t.text, font: FONT, size: 20 })] }));
  }
}
tokens.forEach((t) => block(t));

const label = (k, v) => new D.TableRow({ children: [
  new D.TableCell({ width: { size: 2200, type: D.WidthType.DXA }, borders: D.TableBorders?.NONE, children: [new D.Paragraph({ children: [new D.TextRun({ text: k, color: MUTED, font: FONT, size: 20 })] })] }),
  new D.TableCell({ width: { size: 6826, type: D.WidthType.DXA }, children: [new D.Paragraph({ children: [new D.TextRun({ text: v, font: FONT, size: 20 })] })] }),
] });
const noBorders = { top: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, insideHorizontal: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, insideVertical: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' } };
const simpleTable = (header, rows, widths) => table({
  header: header.map((h) => ({ text: h, tokens: [{ type: 'text', text: h }] })),
  rows: rows.map((r) => r.map((c) => ({ text: c, tokens: [{ type: 'text', text: c }] }))),
});

const cover = [
  new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 24, color: BRAND, space: 1 } }, children: [] }),
  new D.Paragraph({ spacing: { before: 3600, after: 120 }, children: [new D.TextRun({ text: META.title, font: FONT, size: 64, bold: true, color: INK })] }),
  new D.Paragraph({ spacing: { after: 600 }, children: [new D.TextRun({ text: META.subtitle, font: FONT, size: 36, color: BRAND })] }),
  new D.Table({ width: { size: 9026, type: D.WidthType.DXA }, columnWidths: [2200, 6826], borders: noBorders,
    rows: [['Document', META.docNo], ['Version', META.version], ['Date', META.date], ['System', META.url], ['Repository', META.repo], ['Owner', META.owner]].map(([k, v]) => label(k, v)) }),
  new D.Paragraph({ children: [new D.PageBreak()] }),
  new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun('Document control')] }),
  simpleTable(['Version', 'Date', 'Description'], [[META.version, META.date, 'First issue: system as deployed at release d0f559b']]),
  new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, children: [new D.TextRun('Review and approval')] }),
  simpleTable(['Role', 'Name', 'Signature', 'Date'], [['Prepared by', ' ', ' ', ' '], ['Reviewed by', ' ', ' ', ' '], ['Approved by', ' ', ' ', ' ']]),
  new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new D.TextRun('Contents')] }),
  new D.TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
];

const doc = new D.Document({
  creator: META.owner, title: `${META.title} — ${META.subtitle}`, description: META.docNo,
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: FONT, size: 20, color: INK } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 36, bold: true, color: BRAND, font: FONT },
        paragraph: { spacing: { before: 0, after: 200 }, outlineLevel: 0, border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: BRAND, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 27, bold: true, color: INK, font: FONT }, paragraph: { spacing: { before: 300, after: 100 }, outlineLevel: 1, keepNext: true } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 23, bold: true, color: INK, font: FONT }, paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 2, keepNext: true } },
      { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 21, bold: true, color: BRAND, font: FONT }, paragraph: { spacing: { before: 200, after: 60 }, outlineLevel: 3, keepNext: true } },
      { id: 'Heading5', name: 'Heading 5', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 20, bold: true, color: INK, font: FONT }, paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 4, keepNext: true } },
    ],
  },
  numbering: { config: [
    { reference: 'bullets', levels: [0, 1, 2].map((level) => ({ level, format: D.LevelFormat.BULLET, text: ['•', '–', '·'][level], alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + level * 360, hanging: 240 } } } })) },
    { reference: 'numbers', levels: [0, 1, 2].map((level) => ({ level, format: D.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + level * 360, hanging: 300 } } } })) },
  ] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1300, left: 1440, right: 1440 } } },
    headers: { default: new D.Header({ children: [new D.Paragraph({ tabStops: [{ type: D.TabStopType.RIGHT, position: 9026 }],
      children: [new D.TextRun({ text: `${META.title} — ${META.subtitle}`, size: 15, color: '8C95A6' }), new D.TextRun({ text: `\t${META.docNo} v${META.version}`, size: 15, color: '8C95A6' })] })] }) },
    footers: { default: new D.Footer({ children: [new D.Paragraph({ tabStops: [{ type: D.TabStopType.RIGHT, position: 9026 }],
      children: [new D.TextRun({ text: `${META.owner} · Internal`, size: 15, color: '8C95A6' }),
        new D.TextRun({ children: ['\tPage ', D.PageNumber.CURRENT, ' of ', D.PageNumber.TOTAL_PAGES], size: 15, color: '8C95A6' })] })] }) },
    children: [...cover, ...body],
  }],
});
const docxPath = path.join(OUT, 'SSI-Events-Project-Documentation.docx');
fs.writeFileSync(docxPath, await D.Packer.toBuffer(doc));
console.log('DOCX', docxPath);
