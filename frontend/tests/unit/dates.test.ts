import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarDate, zonedDate, zonedDayStart, todayCalendarDate, slotInstant, formatSlotTime, calendarDateFormatter, isTimeZone, eventTimeZone } from '../../lib/events/dates';
import { getEventStatus, hasSlotEnded, withCurrentEventStatus } from '../../lib/events/status';

test('event status changes at India midnight, not UTC midnight', () => {
  assert.equal(getEventStatus('2026-10-01', '2026-10-01', new Date('2026-09-30T18:29:59Z')), 'UPCOMING');
  assert.equal(getEventStatus('2026-10-01', '2026-10-01', new Date('2026-09-30T18:30:00Z')), 'LIVE');
  assert.equal(getEventStatus('2026-10-01', '2026-10-01', new Date('2026-10-01T18:30:00Z')), 'COMPLETED');
  assert.equal(withCurrentEventStatus({ startDate: '2000-01-01', endDate: '2000-01-01', status: 'LIVE' }).status, 'COMPLETED');
});

test('calendar storage and appointment instants have distinct meanings', () => {
  const now = new Date('2026-09-30T20:00:00Z');
  assert.equal(zonedDate(now), '2026-10-01');
  assert.equal(todayCalendarDate(now).toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(zonedDayStart('2026-10-01').toISOString(), '2026-09-30T18:30:00.000Z');
  assert.equal(slotInstant('2026-10-01', '08:00').toISOString(), '2026-10-01T02:30:00.000Z');
  assert.equal(calendarDate('2026-10-01T00:00:00Z'), '2026-10-01');
  assert.equal(formatSlotTime('08:00'), '8:00 am');
  assert.equal(calendarDateFormatter('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date('2026-10-01')), '01/10/2026');
});

test('global event status uses its own date even when countries are a day apart', () => {
  const now = new Date('2026-10-01T10:00:00Z');
  assert.equal(getEventStatus('2026-10-01', '2026-10-01', now, 'Pacific/Kiritimati'), 'COMPLETED');
  assert.equal(getEventStatus('2026-10-01', '2026-10-01', now, 'Pacific/Honolulu'), 'LIVE');
  assert.equal(hasSlotEnded('2026-10-01', '08:00', now, 'Asia/Kolkata'), true);
  assert.equal(hasSlotEnded('2026-10-01', '08:00', now, 'America/Los_Angeles'), false);
  assert.equal(eventTimeZone(undefined), 'Asia/Kolkata');
  assert.equal(isTimeZone('Not/AZone'), false);
  assert.equal(isTimeZone('America/New_York'), true);
});

test('slot instants follow seasonal offsets and reject skipped or repeated clocks', () => {
  assert.equal(slotInstant('2026-01-10', '08:00', 'America/New_York').toISOString(), '2026-01-10T13:00:00.000Z');
  assert.equal(slotInstant('2026-07-10', '08:00', 'America/New_York').toISOString(), '2026-07-10T12:00:00.000Z');
  assert.ok(Number.isNaN(slotInstant('2026-03-08', '02:30', 'America/New_York').getTime()));
  assert.ok(Number.isNaN(slotInstant('2026-11-01', '01:30', 'America/New_York').getTime()));
});

test('slot availability ends at the booked IST end time', () => {
  assert.equal(hasSlotEnded('2026-10-01', '18:00', new Date('2026-10-01T12:29:59Z')), false);
  assert.equal(hasSlotEnded('2026-10-01', '18:00', new Date('2026-10-01T12:30:00Z')), true);
  assert.equal(hasSlotEnded('bad-date', '18:00'), true);
  assert.equal(hasSlotEnded('2026-10-01', '25:00'), true);
});
