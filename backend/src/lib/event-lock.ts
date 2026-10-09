/**
 * Edit lock on an event item (`editLock` = epoch ms when it lapses). While an admin's schedule edit
 * runs, new bookings and reschedules on that event are refused, so the seat counts it checks can't
 * change underneath it. The lock lapses on its own if the edit dies (Lambda timeout is 25 s).
 */
export const EDIT_LOCK_MS = 60_000;

/** Condition fragment; pass `':now': Date.now()` in ExpressionAttributeValues. */
export const NOT_EDIT_LOCKED = '(attribute_not_exists(editLock) OR editLock < :now)';

export const EDIT_LOCKED_MESSAGE = 'This event is being updated by the organisers. Please try again in a minute.';
