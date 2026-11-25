import assert from 'node:assert/strict';
import test from 'node:test';
import { parentPath } from '../../lib/flow-nav';

test('Back goes to the logical previous booking step, never off the site', () => {
  assert.equal(parentPath('/events/E1/book/slots'), '/events/E1/book');
  assert.equal(parentPath('/events/E1/book/slots/'), '/events/E1/book');
  assert.equal(parentPath('/events/E1/book'), '/events/E1');
  assert.equal(parentPath('/events/E1/book/feedback'), '/events/E1');
  assert.equal(parentPath('/events/E1'), '/');
  assert.equal(parentPath('/events/mytickets'), '/');
  assert.equal(parentPath('/privacy'), '/');
});
