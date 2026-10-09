import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { error, HttpError, type Response } from './http.js';
import { Router } from './router.js';
import { isCancelNoticeJob, runCancelNotices, type CancelNoticeJob } from './lib/cancel-notices.js';
import { login, logout, session } from './routes/admin-auth.js';
import { collectAnalytics } from './routes/analytics.js';
import { cancelBooking, createBooking, eventSlots, getOwnBooking, myTickets, rescheduleBooking, savePending } from './routes/bookings.js';
import { listActivity } from './routes/admin-activity.js';
import { attendanceSummary, checkIn } from './routes/admin-attendance.js';
import { analyticsLive, analyticsSummary } from './routes/admin-analytics.js';
import { dashboard } from './routes/admin-dashboard.js';
import { feedbackStatus, submitFeedback } from './routes/feedback.js';
import { reports } from './routes/admin-reports.js';
import { deleteAdminBooking, deletePendingBooking, getAdminBooking, listBookings, updateAdminBooking } from './routes/admin-bookings.js';
import { createUser, deleteUser, listUsers, updateUser } from './routes/admin-users.js';
import { createEvent, deleteEvent, eventImage, getEvent, listEvents, updateEvent } from './routes/events.js';
import { health } from './routes/health.js';
import { countries, states } from './routes/location.js';
import { realtimeVersions } from './routes/realtime.js';

// Every endpoint is registered here and documented in docs/api-contract.md.
export const router = new Router()
  .get('/api/health', health)
  .get('/api/events', listEvents)
  .post('/api/events', createEvent)
  .get('/api/events/:id', getEvent)
  .put('/api/events/:id', updateEvent)
  .delete('/api/events/:id', deleteEvent)
  .get('/api/events/:id/image', eventImage)
  .get('/api/events/:id/slots', eventSlots)
  .post('/api/events/mytickets', myTickets)
  .get('/api/bookings', getOwnBooking)
  .post('/api/bookings', createBooking)
  .patch('/api/bookings', rescheduleBooking)
  .delete('/api/bookings', cancelBooking)
  .post('/api/bookings/pending', savePending)
  .get('/api/location/countries', countries)
  .get('/api/location/states', states)
  .get('/api/realtime', realtimeVersions)
  .post('/api/analytics/collect', collectAnalytics)
  .post('/api/admin/login', login)
  .post('/api/admin/logout', logout)
  .get('/api/admin/session', session)
  .get('/api/admin/users', listUsers)
  .post('/api/admin/users', createUser)
  .put('/api/admin/users/:id', updateUser)
  .delete('/api/admin/users/:id', deleteUser)
  .get('/api/admin/activity', listActivity)
  .get('/api/admin/bookings', listBookings)
  .delete('/api/admin/bookings/pending/:id', deletePendingBooking)
  .get('/api/admin/bookings/:id', getAdminBooking)
  .patch('/api/admin/bookings/:id', updateAdminBooking)
  .delete('/api/admin/bookings/:id', deleteAdminBooking)
  .get('/api/admin/attendance', attendanceSummary)
  .post('/api/admin/attendance', checkIn)
  .get('/api/admin/reports', reports)
  .get('/api/admin/dashboard', dashboard)
  .get('/api/admin/analytics', analyticsSummary)
  .get('/api/admin/analytics/live', analyticsLive)
  .get('/api/feedback', feedbackStatus)
  .post('/api/feedback', submitFeedback);

export async function handler(event: APIGatewayProxyEventV2): Promise<Response>;
export async function handler(event: CancelNoticeJob): Promise<void>;
export async function handler(event: APIGatewayProxyEventV2 | CancelNoticeJob): Promise<Response | void> {
  // Background work the API hands to itself (see lib/cancel-notices.ts), not an HTTP request.
  if (isCancelNoticeJob(event)) return runCancelNotices(event);
  try {
    return await router.handle(event);
  } catch (err) {
    if (err instanceof HttpError) return error(err.statusCode, err.message);
    console.error('Unhandled error', { path: event.rawPath, method: event.requestContext.http.method, err });
    return error(500, 'Something went wrong. Please try again.');
  }
}
