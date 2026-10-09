import { randomBytes } from 'node:crypto';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import QRCode from 'qrcode';
import { db, keys, TABLE_NAME } from '../db/table.js';
import type { BookingItem, EventCore } from './bookings.js';
import { eventTimeZone } from './dates.js';
import { slotInstant } from './schedule.js';

/*
 * Ticket emails, sent through Amazon SES from the verified domain events.ssistudios.com.
 * Configured by MAIL_FROM (e.g. `SS Innovations Events <tickets@events.ssistudios.com>`), plus
 * optional MAIL_CC (comma-separated staff addresses copied on every ticket email), MAIL_REPLY_TO
 * and SITE_URL. Without MAIL_FROM nothing is sent (tests, local runs).
 * An email never decides whether a booking succeeds: failures are logged and recorded on the booking.
 */

export type TicketEmailKind = 'confirmed' | 'rescheduled' | 'cancelled' | 'event-cancelled';

/** Kinds where the booking can no longer be used: no QR code, and the email points to other events. */
const ENDED: TicketEmailKind[] = ['cancelled', 'event-cancelled'];

export const ses = new SESv2Client({ maxAttempts: 2 });

const BRAND = '#283F8F';
const QR_CID = 'ticket-qr@events.ssistudios.com';

/** MAIL_CC: staff copied on every ticket email; anything that isn't a plain address is ignored. */
export function staffCopies(): string[] {
  return (process.env.MAIL_CC || '').split(',').map((a) => a.trim().toLowerCase())
    .filter((a) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(a));
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function siteUrl(): string {
  return (process.env.SITE_URL || 'https://events.ssistudios.com').replace(/\/+$/, '');
}

/** "Monday, 2 November 2026" for a `YYYY-MM-DD` calendar date. */
function longDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`));
}

/** "09:00 – 09:30 (India Standard Time)" in the event's own timezone. */
function slotTimes(b: Pick<BookingItem, 'date' | 'startTime' | 'endTime'>, timeZone: string): string {
  const zone = eventTimeZone(timeZone);
  const instant = slotInstant(b.date, b.startTime, zone);
  const zoneName = Number.isFinite(instant)
    ? new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'long' }).formatToParts(instant)
      .find((p) => p.type === 'timeZoneName')?.value ?? zone
    : zone;
  return `${b.startTime} – ${b.endTime} (${zoneName})`;
}

const COPY: Record<TicketEmailKind, { subject: (event: string) => string; heading: string; lead: string }> = {
  confirmed: {
    subject: (event) => `Booking confirmed: ${event}`,
    heading: 'Your booking is confirmed',
    lead: 'Thank you for registering. Your booking details are below. Please present the QR code at the venue, either on your phone or printed, for check-in.',
  },
  rescheduled: {
    subject: (event) => `Booking rescheduled: ${event}`,
    heading: 'Your booking has been rescheduled',
    lead: 'Your booking now has the date and time shown below. Your booking reference and QR code are unchanged; please present the QR code at the venue for check-in.',
  },
  cancelled: {
    subject: (event) => `Booking cancelled: ${event}`,
    heading: 'Your booking has been cancelled',
    lead: 'As requested, we have cancelled the booking below and released the slot. The QR code for this booking is no longer valid. You are welcome to book another slot on our website at any time.',
  },
  'event-cancelled': {
    subject: (event) => `Event cancelled: ${event}`,
    heading: 'This event has been cancelled',
    lead: 'We regret to inform you that the event below has been cancelled. Your booking is no longer required and its QR code is no longer valid for admission. We apologise for the inconvenience this may cause.',
  },
};

export type TicketEmail = { to: string; subject: string; html: string; text: string; qrPng?: Buffer };

/** Builds the email for a booking. Exported for tests and for previewing the wording. */
export async function ticketEmail(kind: TicketEmailKind, b: BookingItem, event: EventCore): Promise<TicketEmail> {
  const copy = COPY[kind];
  const name = [b.details.title, b.details.fullName].filter(Boolean).join(' ').trim();
  const myTickets = `${siteUrl()}/events/mytickets`;
  const rows: [string, string][] = [
    ['Event', event.eventName],
    ['Date', longDate(b.date)],
    ['Time', slotTimes(b, event.timeZone)],
    ['Venue', event.venue],
    ['Booking reference', b.bookingId],
  ];
  const qrData = JSON.stringify({ type: 'SSI_EVENTS_ATTENDANCE', doctorId: b.bookingId, bookingId: b.bookingId, eventId: b.eventId });
  const qrPng = ENDED.includes(kind) ? undefined : await QRCode.toBuffer(qrData, { type: 'png', width: 480, margin: 2, errorCorrectionLevel: 'M' });

  const manage = ENDED.includes(kind)
    ? `You can find upcoming events at ${siteUrl()}.`
    : `To view, reschedule or cancel this booking, open My Tickets on our website and enter your mobile number and booking reference: ${myTickets}`;

  const text = [
    `Dear ${name},`, '', copy.lead, '',
    ...rows.map(([label, value]) => `${label}: ${value}`), '',
    manage, '',
    'SS Innovations',
    'This message was sent to you because a booking was made on events.ssistudios.com with this email address.',
  ].join('\n');

  const cell = 'padding:10px 0;border-bottom:1px solid #E6E8EF;font-size:15px;line-height:22px;vertical-align:top;';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.heading)}</title></head>
<body style="margin:0;padding:0;background:#F4F5F9;font-family:Figtree,'Segoe UI',Helvetica,Arial,sans-serif;color:#1B1F2B;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;">
<tr><td style="background:${BRAND};padding:20px 28px;color:#FFFFFF;font-size:16px;letter-spacing:0.2px;">SS Innovations Events</td></tr>
<tr><td style="padding:28px 28px 8px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:600;color:${BRAND};">${escapeHtml(copy.heading)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:23px;">Dear ${escapeHtml(name)},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:23px;">${escapeHtml(copy.lead)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${rows.map(([label, value]) => `<tr><td style="${cell}width:38%;color:#5B6275;">${escapeHtml(label)}</td><td style="${cell}font-weight:600;">${escapeHtml(value)}</td></tr>`).join('\n')}
</table>
</td></tr>
${qrPng ? `<tr><td align="center" style="padding:24px 28px 8px;">
<img src="cid:${QR_CID}" width="240" height="240" alt="Check-in QR code for booking ${escapeHtml(b.bookingId)}" style="display:block;width:240px;height:240px;border:0;">
<p style="margin:12px 0 0;font-size:13px;color:#5B6275;">Booking reference ${escapeHtml(b.bookingId)}</p>
</td></tr>` : ''}
<tr><td style="padding:20px 28px 28px;font-size:14px;line-height:22px;color:#3A4052;">
${ENDED.includes(kind)
    ? `You can find upcoming events at <a href="${siteUrl()}" style="color:${BRAND};">events.ssistudios.com</a>.`
    : `To view, reschedule or cancel this booking, open <a href="${myTickets}" style="color:${BRAND};">My Tickets</a> on our website and enter your mobile number and booking reference.`}
</td></tr>
<tr><td style="padding:16px 28px;background:#F8F9FC;font-size:12px;line-height:18px;color:#6B7285;">
SS Innovations<br>This message was sent to you because a booking was made on events.ssistudios.com with this email address.
</td></tr>
</table></td></tr></table></body></html>`;

  return { to: b.email || b.details.email, subject: copy.subject(event.eventName), html, text, qrPng };
}

const base64Lines = (data: Buffer | string) => Buffer.from(data).toString('base64').replace(/.{76}(?=.)/g, '$&\r\n');
const encodedWord = (value: string) => `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;

/** RFC 5322 message: text + HTML alternatives, with the QR code as an inline image. */
export function mimeMessage(mail: TicketEmail, from: string, replyTo?: string, cc: string[] = []): Buffer {
  const related = `rel_${randomBytes(12).toString('hex')}`;
  const alternative = `alt_${randomBytes(12).toString('hex')}`;
  const lines = [
    `From: ${from}`,
    `To: ${mail.to}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodedWord(mail.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${related}"`,
    '',
    `--${related}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    '',
    `--${alternative}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(mail.text),
    `--${alternative}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(mail.html),
    `--${alternative}--`,
    ...(mail.qrPng ? [
      `--${related}`,
      'Content-Type: image/png; name="ticket-qr.png"',
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${QR_CID}>`,
      'Content-Disposition: inline; filename="ticket-qr.png"',
      '',
      base64Lines(mail.qrPng),
    ] : []),
    `--${related}--`,
    '',
  ];
  return Buffer.from(lines.join('\r\n'));
}

/**
 * Emails the attendee about their booking, if email is configured. Never throws: the outcome is
 * logged and, while the booking still exists, recorded on it as `lastEmail`.
 */
export async function notifyAttendee(
  kind: TicketEmailKind, booking: BookingItem, event: EventCore | undefined, options: { copyStaff?: boolean } = {},
): Promise<boolean> {
  const from = process.env.MAIL_FROM;
  if (!from || !event) return false;
  const cc = options.copyStaff === false ? [] : staffCopies();
  const at = new Date().toISOString();
  let record: Record<string, unknown>;
  let sent = false;
  try {
    const mail = await ticketEmail(kind, booking, event);
    const result = await ses.send(new SendEmailCommand({
      FromEmailAddress: /<([^>]+)>/.exec(from)?.[1] ?? from, // the IAM policy only allows @events.ssistudios.com
      Destination: { ToAddresses: [mail.to], ...(cc.length ? { CcAddresses: cc } : {}) },
      Content: { Raw: { Data: mimeMessage(mail, from, process.env.MAIL_REPLY_TO || undefined, cc) } },
    }));
    record = { kind, at, messageId: result.MessageId ?? '' };
    sent = true;
  } catch (err) {
    console.error('Ticket email failed', { bookingId: booking.bookingId, kind, err });
    record = { kind, at, error: (err as { name?: string })?.name || 'Error' };
  }
  if (kind === 'cancelled') return sent; // the booking item is gone
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: keys.booking(booking.bookingId),
      UpdateExpression: 'SET lastEmail = :e', ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':e': record },
    }));
  } catch (err) {
    console.error('Recording the ticket email failed', { bookingId: booking.bookingId, err });
  }
  return sent;
}

/** A short plain notice to the staff in MAIL_CC (e.g. after an event's attendees were emailed). Never throws. */
export async function emailStaff(subject: string, lines: string[]): Promise<void> {
  const from = process.env.MAIL_FROM;
  const [to, ...cc] = staffCopies();
  if (!from || !to) return;
  const text = [...lines, '', 'SS Innovations Events'].join('\n');
  const html = `<!doctype html><html lang="en"><body style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:23px;color:#1B1F2B;">${
    lines.map((l) => `<p style="margin:0 0 10px;">${escapeHtml(l)}</p>`).join('')}<p style="margin:16px 0 0;color:#6B7285;font-size:13px;">SS Innovations Events</p></body></html>`;
  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: /<([^>]+)>/.exec(from)?.[1] ?? from,
      Destination: { ToAddresses: [to], ...(cc.length ? { CcAddresses: cc } : {}) },
      Content: { Raw: { Data: mimeMessage({ to, subject, html, text }, from, process.env.MAIL_REPLY_TO || undefined, cc) } },
    }));
  } catch (err) {
    console.error('Staff email failed', { subject, err });
  }
}
