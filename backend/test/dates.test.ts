import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventStatus, eventTimeZone, zonedDate } from '../src/lib/dates.js';

test('status follows the event calendar in its own timezone', () => {
  // 2026-10-09 20:00 UTC is already 10 October in Kolkata but still 9 October in New York.
  const now = new Date('2026-10-09T20:00:00Z');
  assert.equal(eventStatus('2026-10-10', '2026-10-11', now, 'Asia/Kolkata'), 'LIVE');
  assert.equal(eventStatus('2026-10-10', '2026-10-11', now, 'America/New_York'), 'UPCOMING');
  assert.equal(eventStatus('2026-10-01', '2026-10-09', now, 'Asia/Kolkata'), 'COMPLETED');
  assert.equal(eventStatus('2026-10-01', '2026-10-09', now, 'America/New_York'), 'LIVE');
});

test('cancellation always wins', () => {
  assert.equal(eventStatus('2026-10-10', '2026-10-11', new Date('2026-10-10T06:00:00Z'), 'Asia/Kolkata', 'CANCELLED'), 'CANCELLED');
});

test('invalid or missing timezone falls back to India', () => {
  assert.equal(eventTimeZone('Not/AZone'), 'Asia/Kolkata');
  assert.equal(eventTimeZone(undefined), 'Asia/Kolkata');
  assert.equal(zonedDate(new Date('2026-10-09T20:00:00Z'), 'Asia/Kolkata'), '2026-10-10');
});
