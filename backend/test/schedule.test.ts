import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSlotTimes, scheduleProblem, type ScheduleInput } from '../src/lib/schedule.js';

const day = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  date: '2026-11-02', startTime: '09:00', endTime: '12:00', lunchEnabled: false,
  slotDuration: '30', slotGap: '0', capacity: '5', ...over,
});

test('slots fill the day and skip lunch', () => {
  const slots = generateSlotTimes(day({ endTime: '14:00', lunchEnabled: true, lunchStart: '11:00', lunchEnd: '12:00', slotDuration: '45', slotGap: '15' }));
  assert.deepEqual(slots.map((s) => `${s.startTime}-${s.endTime}`), ['09:00-09:45', '10:00-10:45', '12:00-12:45', '13:00-13:45']);
});

test('valid schedule passes', () => {
  assert.equal(scheduleProblem('2026-11-02', '2026-11-03', 2, [day(), day({ date: '2026-11-03' })], 'Asia/Kolkata'), '');
});

test('rejects bad input with a clear message', () => {
  assert.match(scheduleProblem('2026-11-03', '2026-11-02', 1, [day()], 'Asia/Kolkata'), /end on or after/);
  assert.match(scheduleProblem('2026-11-02', '2026-11-02', 2, [day()], 'Asia/Kolkata'), /count does not match/);
  assert.match(scheduleProblem('2026-11-02', '2026-11-02', 1, [day({ capacity: '21' })], 'Asia/Kolkata'), /capacity/);
  assert.match(scheduleProblem('2026-11-02', '2026-11-02', 1, [day({ date: '2026-11-05' })], 'Asia/Kolkata'), /within the event dates/);
  assert.match(scheduleProblem('2026-11-02', '2026-11-03', 2, [day(), day()], 'Asia/Kolkata'), /distinct and in ascending/);
  assert.match(scheduleProblem('2026-11-02', '2026-11-02', 1, [day()], 'Mars/Base'), /timezone/);
});

test('rejects times a clock change skips', () => {
  // 8 March 2026, New York: clocks jump from 02:00 to 03:00.
  const dst = day({ date: '2026-03-08', startTime: '01:30', endTime: '03:30', slotDuration: '30' });
  assert.match(scheduleProblem('2026-03-08', '2026-03-08', 1, [dst], 'America/New_York'), /clock change/);
});
