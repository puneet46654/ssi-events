import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { eventBookings } from './admin-data.js';
import { getEventCore, type BookingItem } from './bookings.js';
import { emailStaff, notifyAttendee } from './email.js';

/*
 * Emails every attendee of a cancelled event. It runs outside the admin's request: the API invokes
 * itself asynchronously, and each run sends what fits in its time budget at SES's rate limit, then
 * hands the rest to the next run. A booking already emailed about the cancellation is skipped, so a
 * retried or resumed run never emails anyone twice. Staff get one summary at the end.
 */

export type CancelNoticeJob = {
  job: 'event-cancelled-emails';
  eventId: string;
  startedBy: string;
  sent?: number;
  failed?: number;
  /** Bookings are worked through in reference order; this is the last one handled. */
  after?: string;
};

export const isCancelNoticeJob = (value: unknown): value is CancelNoticeJob =>
  !!value && typeof value === 'object' && (value as { job?: unknown }).job === 'event-cancelled-emails';

const BATCH = 10;          // emails sent together
const BATCH_MS = 900;      // ≈11 a second, under the account's SES limit of 14 (shared with other apps)
const BUDGET_MS = 18_000;  // the function's timeout is 25 s

const lambda = new LambdaClient({});
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the job in a fresh invocation in AWS, or straight away elsewhere (tests, local runs). */
async function continueJob(job: CancelNoticeJob): Promise<void> {
  const fn = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!fn) return runCancelNotices(job);
  await lambda.send(new InvokeCommand({ FunctionName: fn, InvocationType: 'Event', Payload: new TextEncoder().encode(JSON.stringify(job)) }));
}

/** Starts emailing a cancelled event's attendees. Never throws: a failure to start is logged. */
export async function startCancelNotices(eventId: string, startedBy: string): Promise<boolean> {
  if (!process.env.MAIL_FROM) return false;
  try {
    await continueJob({ job: 'event-cancelled-emails', eventId, startedBy });
    return true;
  } catch (err) {
    console.error('Could not start the cancellation emails', { eventId, err });
    return false;
  }
}

export async function runCancelNotices(job: CancelNoticeJob): Promise<void> {
  const started = Date.now();
  const event = await getEventCore(job.eventId);
  if (!event || event.status !== 'CANCELLED') return;
  const pending = (await eventBookings(job.eventId))
    .filter((b) => !job.after || b.bookingId > job.after)
    .sort((a, b) => a.bookingId.localeCompare(b.bookingId));
  let { sent = 0, failed = 0 } = job;

  for (let i = 0; i < pending.length; i += BATCH) {
    if (Date.now() - started > BUDGET_MS) {
      await continueJob({ ...job, sent, failed, after: pending[i - 1]!.bookingId });
      return;
    }
    const batchStarted = Date.now();
    const batch = pending.slice(i, i + BATCH)
      .filter((b) => (b as BookingItem & { lastEmail?: { kind?: string } }).lastEmail?.kind !== 'event-cancelled');
    const results = await Promise.all(batch.map((b) => notifyAttendee('event-cancelled', b, event, { copyStaff: false })));
    sent += results.filter(Boolean).length;
    failed += results.filter((ok) => !ok).length;
    await pause(Math.max(0, BATCH_MS - (Date.now() - batchStarted)));
  }

  await emailStaff(`Event cancelled: ${event.eventName}`, [
    `${event.eventName} (${event.startDate}) was cancelled by ${job.startedBy}.`,
    `Attendees emailed: ${sent}.${failed ? ` Not delivered to SES: ${failed}; see the bookings list for who was not reached.` : ''}`,
  ]);
}
