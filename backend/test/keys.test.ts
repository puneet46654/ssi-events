import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keys, ttlAfter } from '../src/db/table.js';

test('slot sort keys order by day then start time', () => {
  const sks = [
    keys.slot('e1', 10, '09:00', 's3').SK,
    keys.slot('e1', 2, '14:00', 's2').SK,
    keys.slot('e1', 2, '09:30', 's1').SK,
  ].sort();
  assert.deepEqual(sks, ['SLOT#02#09:30#s1', 'SLOT#02#14:00#s2', 'SLOT#10#09:00#s3']);
});

test('admin usernames are case-insensitive', () => {
  assert.deepEqual(keys.admin(' Naveen '), keys.admin('naveen'));
});

test('ttl is epoch seconds', () => {
  assert.equal(ttlAfter(60, 1_000_000), 1060);
});
