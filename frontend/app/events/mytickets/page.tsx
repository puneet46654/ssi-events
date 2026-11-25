'use client';

import { useHydrated } from '@/lib/use-hydrated';
import { useBackCloses } from '@/lib/use-back-closes';
import { eventTimeZone } from '@/lib/events/dates';
import { googleCalendarUrl } from '@/lib/events/calendar';
import { useDialog } from '@/lib/use-dialog';
import { AppFeedbackForm, useAppFeedbackDone } from '@/components/user/AppFeedback';
import { hasSlotEnded } from '@/lib/events/status';
import { ticketStorage } from '@/lib/booking-contracts';

import { isValidPhone, normalizePhone } from '@/lib/phone';
import { chooseCountries, INDIA_FALLBACK, type CountryOption } from '@/lib/country-defaults';

import Image from 'next/image';


import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  AnimatePresence,
  motion,
  useDragControls,
} from 'framer-motion';
import SheetHandle from '@/components/user/SheetHandle';

import {
  QRCodeSVG,
} from 'qrcode.react';
import {
  useRealtimeRefresh,
} from '@/components/realtime/RealtimeProvider';


/* ============================================================
   TYPES
============================================================ */

type TicketStatus =
  | 'ACTIVE'
  | 'EXPIRED'
  | 'ATTENDED'
  | 'CANCELLED'
  | 'WAITLISTED';


interface Ticket {
  timeZone?: string;

  bookingId:
    string;

  eventId:
    string;

  eventName:
    string;

  venue:
    string;

  imageUrl:
    string;

  date:
    string;

  startTime:
    string;

  endTime:
    string;


  status:
    TicketStatus;

  /** Place in the slot's waitlist queue (waitlist entries only). */
  waitlistPosition?: number | null;


  attendanceStatus:
    string;


  checkedInAt:
    string | null;


  checkedInBy:
    string;


  checkInMethod:
    string;


  qrData:
    string;
  details?: { title?: string; fullName?: string };
  /** No time slot: the ticket is valid for the event's dates. */
  registrationOnly?: boolean;
  eventStartDate?: string | null;
  eventEndDate?: string | null;
  slotId: string;
  dayScheduleId: string;
  /** True only on the device that made the booking, before its slot starts. */
  canManage?: boolean;
}



/* ============================================================
   CONSTANTS
============================================================ */

const CACHE_KEY =
  ticketStorage.mobile;






/* ============================================================
   PAGE
============================================================ */


export default function MyTicketsPage() {


  const hydrated = useHydrated();
  const [mobile, setMobile] = useState('');
  // Needed on a device that didn't make the booking: a phone number alone never reveals tickets.
  const [reference, setReference] = useState('');
  const [referenceNeeded, setReferenceNeeded] = useState(false);
  const [countries, setCountries] = useState<CountryOption[]>([INDIA_FALLBACK]);
  const [phoneCountry, setPhoneCountry] = useState(INDIA_FALLBACK);
  const [savedMobile, setSavedMobile] = useState('');
  // The number whose tickets were showing before "Look up another ticket", so the attendee can return to them.
  const [previousMobile, setPreviousMobile] = useState('');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  // Set when the attendee arrives straight from booking a slot.
  const [justBooked, setJustBooked] = useState('');
  const qrDrag = useDragControls();
  const justBookedWaitlist = tickets.some(ticket => ticket.bookingId === justBooked && ticket.status === 'WAITLISTED');
  // Asked on My Tickets (right after booking, or on any later visit) until this device has rated the app.
  const [feedbackDone, markFeedbackDone] = useAppFeedbackDone();
  const [managing, setManaging] = useState<{ ticket: Ticket; mode: 'reschedule' | 'cancel' } | null>(null);
  // The phone Back button closes an open sheet instead of leaving the page.
  useBackCloses(!!selectedTicket, () => setSelectedTicket(null));
  useBackCloses(!!managing, () => setManaging(null));
  const [loaded, setLoaded] = useState(false);
  const lookupRef = useRef<string | null>(null);
  const pendingRef = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);

  const loadTickets = useCallback(async (value: string, bookingReference = '') => {
    const clean = normalizePhone(value);
    if (!isValidPhone(value)) {
      setError('Enter the mobile number you registered with.');
      return;
    }
    pendingRef.current?.abort();
    const controller = new AbortController();
    pendingRef.current = controller;
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/events/mytickets', {
        method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: clean, ...(bookingReference.trim() ? { bookingId: bookingReference.trim().toUpperCase() } : {}) }),
      });
      const data = await response.json();
      if (version !== requestVersion.current || controller.signal.aborted) return;
      if (!response.ok || !data.success) throw new Error(data.message || 'Unable to load your ticket. Please retry.');
      if (data.referenceNeeded) {
        // Nothing this device may show yet: ask for the reference instead of showing an empty list.
        setReferenceNeeded(true);
        setTickets([]);
        setError('No tickets for this number have been opened on this device. Enter the booking reference from your confirmation to view them.');
        return;
      }
      setReferenceNeeded(false);
      setReference('');
      setTickets(data.tickets);
      setSelectedTicket(current => current ? data.tickets.find((ticket: Ticket) => ticket.bookingId === current.bookingId) || null : null);
      setSavedMobile(clean);
      setPreviousMobile('');
      setMobile(clean);
      lookupRef.current = clean;
      setLoaded(true);
      // Remember this device's number until its last ticket's slot ends, so tickets show without retyping.
      const keep = (data.tickets as Ticket[]).some(ticket => ticket.status !== 'CANCELLED' && !!ticket.date
        && !hasSlotEnded(ticket.date, ticket.endTime, new Date(), ticket.timeZone));
      try { if (keep) localStorage.setItem(CACHE_KEY, clean); else localStorage.removeItem(CACHE_KEY); } catch { /* Storage is optional. */ }
    } catch (error) {
      if (version !== requestVersion.current || controller.signal.aborted) return;
      setError(error instanceof Error ? error.message : 'Unable to load your ticket. Please retry.');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const booked = new URLSearchParams(window.location.search).get('booked');
      if (booked) {
        setJustBooked(booked);
        // A refresh should not repeat the confirmation.
        window.history.replaceState(window.history.state, '', window.location.pathname);
      }
      try {
        const cachedMobile = localStorage.getItem(CACHE_KEY);
        if (cachedMobile) void loadTickets(cachedMobile);
      } catch { /* Start with an empty lookup when browser storage is unavailable. */ }
    }, 0);
    return () => { window.clearTimeout(timer); pendingRef.current?.abort(); };
  }, [loadTickets]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/location/countries', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
      .then(response => response.json())
      .then(data => {
        if (!data?.success || !Array.isArray(data.countries)) return;
        const list = (data.countries as CountryOption[]).filter(country => country.callingCode);
        if (!list.length) return;
        setCountries(list);
        setPhoneCountry(chooseCountries(list).phone);
      })
      .catch(() => { /* Keep India as the only option. */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!justBooked || !tickets.some(ticket => ticket.bookingId === justBooked)) return;
    const frame = requestAnimationFrame(() => document.getElementById(`ticket-${justBooked}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    return () => cancelAnimationFrame(frame);
  }, [justBooked, tickets]);

  /** The number as typed, with the selected country code unless the visitor typed their own +code. */
  function fullNumber(value: string) {
    if (value.trim().startsWith('+')) return value;
    return phoneCountry.callingCode + normalizePhone(value).replace(/^0+/, '');
  }

  function refreshTickets() {
    if (lookupRef.current) void loadTickets(lookupRef.current);
  }
  useRealtimeRefresh('attendance', refreshTickets);
  useRealtimeRefresh('bookings', refreshTickets);

  function resetTickets() {
    const previous = savedMobile || lookupRef.current || '';
    requestVersion.current++;
    pendingRef.current?.abort();
    pendingRef.current = null;
    lookupRef.current = null;
    setMobile(''); setSavedMobile(''); setTickets([]);
    setSelectedTicket(null); setLoaded(false); setLoading(false); setError('');
    // Keep the remembered number until another lookup succeeds, and let Back return to these tickets.
    setPreviousMobile(previous);
    if (previous) window.history.pushState(window.history.state, '', window.location.href);
  }

  // The browser or phone Back button returns to the tickets that were showing.
  useEffect(() => {
    if (!previousMobile) return;
    const restore = () => { setPreviousMobile(''); void loadTickets(previousMobile); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [previousMobile, loadTickets]);

  function changeMobile(value: string) {
    requestVersion.current++;
    pendingRef.current?.abort();
    pendingRef.current = null;
    setLoading(false);
    setError('');
    setMobile(value);
  }

  /* ==========================================================
     UI
  ========================================================== */


  return (

    <main
      className="
        min-h-dvh
        booking-bg
        pb-4

        md:pb-0
      "
    >




      <div
        className="
          mx-auto

          w-full
          max-w-[1200px]

          px-3.5
          pt-3
          pb-6
          md:px-6
          md:py-8


        "
      >


        {/* TITLE */}


        <motion.div
          className="flex items-center justify-between gap-3"
          initial={{
            opacity:0,
            y:5,
          }}
          animate={{
            opacity:1,
            y:0,
          }}
        >

          <h1
            className="
              font-heading

              text-[22px]

              font-bold

              tracking-[-0.03em]

              text-secondary
            "
          >
            My tickets
          </h1>



          {(savedMobile || loading) && (
            <button
              type="button"
              onClick={resetTickets}
              className="
                shrink-0
                rounded-full
                px-3
                py-1.5
                text-[13px]
                font-semibold
                text-primary
                transition-colors
                hover:bg-primary/[0.06]
                hover:text-primary-dark
              "
            >
              Look up another ticket
            </button>
          )}


        </motion.div>





        {/* MOBILE INPUT */}


        {!savedMobile && (

          <motion.section
            initial={{
              opacity:0,
              y:10,
            }}
            animate={{
              opacity:1,
              y:0,
            }}
            className="
              glass
              mt-3
              rounded-2xl
              p-4
            "
          >

            <label
              htmlFor="ticket-mobile"
              className="
                text-[13px]

                font-semibold

                text-secondary
              "
            >
              Registered mobile number
            </label>


            <div className="mt-2 flex gap-2">
              <select disabled={!hydrated}
                aria-label="Country code"
                value={phoneCountry.iso2}
                onChange={e => {
                  const next = countries.find(country => country.iso2 === e.target.value);
                  if (next) { setPhoneCountry(next); changeMobile(mobile); }
                }}
                className="select-chevron h-11 w-28 shrink-0 rounded-xl border border-gray-200 bg-white/80 px-2.5 text-[13px] outline-none focus:border-primary/40"
              >
                {countries.map(country => (
                  <option key={country.iso2} value={country.iso2}>{country.flag} {country.callingCode} {country.name}</option>
                ))}
              </select>

            <input disabled={!hydrated}
              id="ticket-mobile"
              value={
                mobile
              }

              onChange={
                e =>
                  changeMobile(e.target.value)
              }

              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadTickets(fullNumber(mobile), reference);
              }}

              placeholder="Mobile number, e.g. 98765 43210"

              inputMode="tel"

              className="


                h-11
                min-w-0 flex-1
                rounded-xl
                bg-white/80
                transition-colors
                focus:bg-white

                border
                border-gray-200

                px-3

                text-[13px]

                outline-none

                focus:border-primary/40
              "
            />
            </div>



            <label htmlFor="ticket-reference" className="mt-3 block text-[13px] font-semibold text-secondary">
              Booking reference{referenceNeeded ? '' : ' (optional)'}
            </label>
            <input disabled={!hydrated}
              id="ticket-reference"
              value={reference}
              onChange={e => { setError(''); setReference(e.target.value.toUpperCase()); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void loadTickets(fullNumber(mobile), reference); }}
              placeholder="SSI-EV-2026-1A2B3C4D5E6F"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white/80 px-3 text-[13px] uppercase transition-colors focus:bg-white tracking-wide outline-none focus:border-primary/40"
            />

            <p className="mt-3 text-xs text-gray-500">On the device you booked with, your mobile number is enough. On any other device, also enter the booking reference shown on your confirmation.</p>

            <button
              disabled={!hydrated || loading}
              onClick={() =>
                void loadTickets(fullNumber(mobile), reference)
              }

              className="
                mt-3

                h-11

                w-full

                btn-primary rounded-full text-[15px] font-medium text-white "
            >

              {loading
                ? 'Checking...'
                : 'View tickets'}
            </button>
            {previousMobile && (
              <button
                type="button"
                onClick={() => window.history.back()}
                className="mt-2 h-11 w-full rounded-lg border border-gray-200 text-[12px] font-semibold text-secondary hover:bg-gray-50"
              >
                ← Back to my tickets (number ending {previousMobile.slice(-4)})
              </button>
            )}


          </motion.section>

        )}






        {/* ERROR */}


        {
          error && (

            <div
              className="
                mt-3
                rounded-xl

                border
                border-red-200

                bg-red-50

                px-4
                py-3

                text-[12px]

                text-red-700
              "
            >

              {error}

            </div>

          )
        }






        {/* EMPTY */}


        {
          loaded &&
          tickets.length===0 && (

            <div
              className="
                glass
                mt-3
                rounded-2xl
                p-6

                text-center
              "
            >

              <h2
                className="
                  text-[16px]

                  font-semibold

                  text-secondary
                "
              >
                No tickets found
              </h2>


              <p
                className="
                  mt-2

                  text-[12px]

                  text-gray-500
                "
              >
                No ticket matches this mobile number.
              </p>


            </div>

          )
        }






        {/* TICKETS */}


        {justBooked && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            role="status"
            className="glass mt-3 flex items-start gap-3 rounded-2xl px-3.5 py-3"
          >
            <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-bold text-white">✓</span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-secondary">{justBookedWaitlist ? "You're on the waitlist" : 'Booking confirmed'}</p>
              <p className="mt-0.5 text-[12px] text-gray-600">
                {justBookedWaitlist
                  ? 'Your waitlist place is below, and we have emailed you the details. If a booked attendee does not arrive, staff at the venue will seat waitlisted attendees in the order they joined. Give your name or reference at the registration desk.'
                  : `Your ticket ${justBooked} is below, and we have emailed a copy to the address you registered with. Open QR Ticket to save it to your phone, and present it at the venue for check-in.`}
              </p>
            </div>
            <button type="button" onClick={() => setJustBooked('')} aria-label="Dismiss" className="text-[18px] leading-none text-gray-400 hover:text-gray-600">×</button>
          </motion.div>
        )}

        {feedbackDone === false && tickets.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            aria-label="Rate SSInnovations Events"
            className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-4 backdrop-blur-md"
          >
            <AppFeedbackForm compact onDone={markFeedbackDone} />
          </motion.section>
        )}

        <div
          className="
            mt-3
            grid
            grid-cols-1
            gap-3

            md:grid-cols-2

            xl:grid-cols-3
          "
        >

          {
            tickets.map(
              ticket => (

                <TicketCard

                  key={
                    ticket.bookingId
                  }

                  ticket={
                    ticket
                  }

                  onClick={() =>
                    setSelectedTicket(
                      ticket,
                    )
                  }
                  onManage={mode => setManaging({ ticket, mode })}
                  highlighted={ticket.bookingId === justBooked}
                />

              ),
            )
          }


        </div>


      </div>





      {/* QR MODAL */}


      <AnimatePresence>

        {
          selectedTicket && (

            <motion.div

              initial={{
                opacity:0,
              }}

              animate={{
                opacity:1,
              }}

              exit={{
                opacity:0,
              }}

              className="
                fixed

                inset-0

                z-50

                flex

                items-end
                justify-center
                bg-black/35
                backdrop-blur-[3px]
                sm:items-center
                sm:px-4
              "

              onClick={() =>
                setSelectedTicket(
                  null,
                )
              }

            >


              <motion.div

                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
                dragControls={qrDrag}
                dragListener={false}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.7 }}
                onDragEnd={(_, info) => { if (info.offset.y > 110 || info.velocity.y > 650) setSelectedTicket(null); }}

                className="
                  w-full
                  max-w-sm
                  max-h-[92dvh]
                  overflow-y-auto
                  rounded-t-3xl
                  bg-white
                  px-5
                  pt-3
                  pb-[max(20px,env(safe-area-inset-bottom))]
                  sm:rounded-3xl
                  sm:p-5

                  text-center
                "

                onClick={
                  e =>
                    e.stopPropagation()
                }

              >

                <SheetHandle controls={qrDrag} />
                <TicketPass ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />


              </motion.div>


            </motion.div>

          )
        }

      </AnimatePresence>

      <AnimatePresence>
      {managing && (
        <ManageTicketDialog
          key={managing.ticket.bookingId + managing.mode}
          ticket={managing.ticket}
          mode={managing.mode}
          onClose={() => setManaging(null)}
          onDone={() => { setManaging(null); refreshTickets(); }}
        />
      )}
      </AnimatePresence>
    </main>

  );
}






/* ============================================================
   CARD
============================================================ */


function TicketCard({
  ticket,
  onClick,
  onManage,
  highlighted = false,
}: {
  ticket: Ticket;
  onClick: () => void;
  onManage: (mode: 'reschedule' | 'cancel') => void;
  highlighted?: boolean;
}) {
  const upcoming = ticket.status === 'ACTIVE';
  const waitlisted = ticket.status === 'WAITLISTED';
  const changeable = (upcoming || waitlisted) && !!ticket.canManage;
  const date = ticket.date
    ? new Date(ticket.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    : '';
  const when = ticket.registrationOnly
    ? ticket.eventEndDate && ticket.eventEndDate !== ticket.date
      ? `${date} – ${new Date(ticket.eventEndDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })} · Any time`
      : `${date} · Any time`
    : `${date} · ${ticket.startTime} – ${ticket.endTime}`;

  return (
    <motion.article
      id={`ticket-${ticket.bookingId}`}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={`glass overflow-hidden rounded-2xl p-3 ${highlighted ? 'ring-2 ring-primary/40' : ''}`}
    >
      <div className="flex gap-3">
        <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-[linear-gradient(135deg,#283F8F,#23879A)]">
          {ticket.imageUrl ? (
            <Image width={160} height={160} unoptimized src={ticket.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-[13px] font-semibold text-white/90">SSI</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug text-secondary">{ticket.eventName}</h2>
            <StatusBadge status={ticket.status} position={ticket.waitlistPosition} />
          </div>
          <p className="mt-1 truncate text-[12.5px] font-medium text-secondary/80">
            {when}
            {!ticket.registrationOnly && <span className="text-gray-400"> {shortZone(ticket.timeZone)}</span>}
          </p>
          {ticket.venue && <p className="truncate text-[12px] text-gray-500">{ticket.venue}</p>}
        </div>
      </div>

      {waitlisted ? (
        <p className="mt-3 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-3 py-2 text-[12.5px] leading-snug text-amber-800">
          You are registered and we have your details. This slot is full, so there is no QR code yet. If a seat frees up, use Change slot to take it and get your QR ticket; at the venue, staff also seat waitlisted doctors in order.
        </p>
      ) : (
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onClick}
          className="btn-primary h-10 flex-1 rounded-full px-4 text-[14px] font-medium text-white transition-transform active:scale-[0.98]"
        >
          {ticket.status === 'CANCELLED' ? 'View cancellation' : 'Show QR ticket'}
        </button>
        {upcoming && (
          <a
            href={googleCalendarUrl(ticket)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Add to Google Calendar"
            title="Add to Google Calendar"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-gray-200/80 bg-white/70 text-secondary transition-colors hover:bg-white"
          >
            <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
              <path strokeLinecap="round" d="M3.5 10h17M8 3v4M16 3v4M12 13v4M10 15h4" />
            </svg>
          </a>
        )}
      </div>
      )}

      {changeable && (
        <div className="mt-2 flex items-center justify-between border-t border-gray-200/60 pt-2 text-[12.5px] font-semibold">
          <span className="truncate text-gray-400">{ticket.bookingId}</span>
          <span className="flex shrink-0 gap-1">
            {!ticket.registrationOnly && (
              <button type="button" onClick={() => onManage('reschedule')} className="rounded-full px-3 py-1.5 text-primary transition-colors hover:bg-primary/[0.06]">
                {waitlisted ? 'Change slot' : 'Reschedule'}
              </button>
            )}
            <button type="button" onClick={() => onManage('cancel')} className="rounded-full px-3 py-1.5 text-red-600 transition-colors hover:bg-red-50">
              {waitlisted ? 'Leave waitlist' : 'Cancel'}
            </button>
          </span>
        </div>
      )}
      {!changeable && <p className="mt-2 truncate text-[12px] font-semibold text-gray-400">{ticket.bookingId}</p>}
    </motion.article>
  );
}

/** Short zone name, e.g. Asia/Kolkata -> IST. */
function shortZone(timeZone?: string) {
  try {
    return new Intl.DateTimeFormat('en-IN', { timeZone: eventTimeZone(timeZone), timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

function StatusBadge({ status, position }: { status: TicketStatus; position?: number | null }) {
  const style =
    status === 'WAITLISTED'
      ? 'bg-amber-100 text-amber-800'
      : status === 'ACTIVE'
      ? 'bg-emerald-50/90 text-emerald-700'
      : status === 'ATTENDED'
        ? 'bg-primary/10 text-primary'
        : 'bg-gray-100 text-gray-600';
  const label = status === 'WAITLISTED' ? `Waitlist${position ? ` #${position}` : ''}` : status === 'ACTIVE' ? 'Upcoming' : status === 'ATTENDED' ? 'Attended' : status.charAt(0) + status.slice(1).toLowerCase();
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style}`}>{label}</span>;
}

/* ============================================================
   RESCHEDULE / CANCEL
============================================================ */

type SlotOption = { _id: string; startTime: string; endTime: string; remaining: number; available: boolean; waitlistOpen?: boolean; waitlistCount?: number };
type DayOption = { _id: string; date: string; slots: SlotOption[] };

function ManageTicketDialog({
  ticket,
  mode,
  onClose,
  onDone,
}: {
  ticket: Ticket;
  mode: 'reschedule' | 'cancel';
  onClose: () => void;
  onDone: () => void;
}) {
  const dialog = useDialog(true, onClose, mode === 'cancel' ? 'Cancel booking' : 'Reschedule booking');
  const sheetDrag = useDragControls();
  const [days, setDays] = useState<DayOption[] | null>(mode === 'cancel' ? [] : null);
  const [choice, setChoice] = useState<{ dayScheduleId: string; slotId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'reschedule') return;
    const controller = new AbortController();
    fetch(`/api/events/${encodeURIComponent(ticket.eventId)}/slots?refresh=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
      .then(response => response.json())
      .then(data => {
        if (!data?.success || !Array.isArray(data.days)) throw new Error(data?.error || 'Unable to load time slots.');
        setDays((data.days as DayOption[]).map(day => ({
          ...day, slots: day.slots.filter(slot => ticket.status === 'WAITLISTED'
            ? slot.available || (slot.waitlistOpen && slot._id !== ticket.slotId)
            : slot.available && slot._id !== ticket.slotId),
        })).filter(day => day.slots.length));
      })
      .catch(err => { if (!controller.signal.aborted) { setDays([]); setError(err instanceof Error ? err.message : 'Unable to load time slots.'); } });
    return () => controller.abort();
  }, [mode, ticket.eventId, ticket.slotId, ticket.status]);

  async function submit() {
    if (saving || (mode === 'reschedule' && !choice)) return;
    setSaving(true);
    setError('');
    try {
      const response = mode === 'cancel'
        ? await fetch(`/api/bookings?bookingId=${encodeURIComponent(ticket.bookingId)}`, { method: 'DELETE', cache: 'no-store' })
        : await fetch('/api/bookings', {
          method: 'PATCH', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: ticket.bookingId, ...choice }),
        });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Something went wrong. Please retry.');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please retry.');
      setSaving(false);
    }
  }

  const dayLabel = (value: string) => new Date(value).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 backdrop-blur-[3px] sm:items-center sm:px-4" onClick={onClose}
    >
      <motion.div
        {...dialog}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
        dragControls={sheetDrag} dragListener={false}
        drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.7 }}
        onDragEnd={(_, info) => { if (info.offset.y > 110 || info.velocity.y > 650) onClose(); }}
        className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] sm:rounded-3xl sm:p-6"
        onClick={event => event.stopPropagation()}
      >
        <SheetHandle controls={sheetDrag} />
        <h2 className="text-[16px] font-semibold text-secondary">
          {mode === 'cancel' ? (ticket.status === 'WAITLISTED' ? 'Leave the waitlist?' : 'Cancel this booking?') : ticket.status === 'WAITLISTED' ? 'Change your slot' : 'Choose a new time slot'}
        </h2>
        <p className="mt-1 text-[12px] text-gray-500">
          {ticket.eventName} · {ticket.registrationOnly ? 'registration' : <>currently {ticket.date ? dayLabel(ticket.date) : ''}, {ticket.startTime} - {ticket.endTime}</>}
        </p>

        {mode === 'reschedule' && ticket.status === 'WAITLISTED' && (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[12.5px] leading-snug text-emerald-800">
            Pick a slot with seats left to get a confirmed booking and your QR ticket straight away, or another full slot to wait there instead.
          </p>
        )}

        {mode === 'cancel' ? (
          <p className="mt-4 text-[13px] text-gray-600">
            {ticket.status === 'WAITLISTED'
              ? 'You will lose your place in the queue for this slot. You can join again later, but you would go to the back of the queue.'
              : 'Your seat will be released for someone else and this QR ticket will stop working. This cannot be undone.'}
          </p>
        ) : days === null ? (
          <p className="mt-4 text-[13px] text-gray-500">Loading available slots...</p>
        ) : days.length === 0 && !error ? (
          <p className="mt-4 text-[13px] text-gray-500">{ticket.status === 'WAITLISTED' ? 'No other slots are open right now.' : 'No other slots have seats left right now.'}</p>
        ) : (
          <div className="mt-4 space-y-4">
            {days.map(day => (
              <div key={day._id}>
                <p className="text-[13px] font-semibold uppercase tracking-wide text-gray-400">{dayLabel(day.date)}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {day.slots.map(slot => {
                    const selected = choice?.slotId === slot._id;
                    return (
                      <button key={slot._id} type="button" aria-pressed={selected}
                        onClick={() => setChoice({ dayScheduleId: day._id, slotId: slot._id })}
                        className={`rounded-xl border px-3 py-2 text-left text-[12px] transition-colors duration-200 ${selected ? 'border-primary bg-primary/[0.06] text-primary' : 'border-gray-200 text-secondary hover:bg-gray-50'}`}>
                        <span className="block font-semibold">{slot.startTime} - {slot.endTime}</span>
                        {slot.available
                          ? <span className="text-[13px] text-emerald-700">{slot._id === ticket.slotId ? 'Seat free in your slot · ' : ''}{slot.remaining} seat{slot.remaining === 1 ? '' : 's'} left</span>
                          : <span className="text-[13px] text-amber-700">Full · waitlist{slot.waitlistCount ? ` (${slot.waitlistCount} waiting)` : ''}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-11 flex-1 rounded-full border border-gray-200 px-4 text-[13px] font-semibold text-secondary sm:flex-none">
            {mode === 'cancel' ? (ticket.status === 'WAITLISTED' ? 'Stay on waitlist' : 'Keep booking') : 'Close'}
          </button>
          <button type="button" onClick={() => void submit()} disabled={saving || (mode === 'reschedule' && !choice)}
            className={`h-11 flex-1 rounded-full px-4 text-[13px] font-semibold text-white disabled:opacity-50 sm:flex-none ${mode === 'cancel' ? 'bg-red-600' : 'bg-primary'}`}>
            {saving ? 'Saving...' : mode === 'cancel' ? (ticket.status === 'WAITLISTED' ? 'Leave waitlist' : 'Cancel booking')
              : ticket.status === 'WAITLISTED' && choice && !days?.some(d => d.slots.some(sl => sl._id === choice.slotId && sl.available)) ? 'Move to this waitlist'
              : ticket.status === 'WAITLISTED' ? 'Confirm my seat' : 'Confirm new slot'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** The ticket as one card: what staff need at the door, and what the attendee saves to their phone. */
function TicketPass({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const cancelled = ticket.status === 'CANCELLED';
  const name = [ticket.details?.title, ticket.details?.fullName].filter(Boolean).join(' ');
  const date = new Date(ticket.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const endDate = new Date(ticket.eventEndDate || ticket.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  async function save() {
    if (!cardRef.current || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const { toPng } = await import('html-to-image');
      const url = await toPng(cardRef.current, { pixelRatio: 3, backgroundColor: '#ffffff', cacheBust: true });
      const link = document.createElement('a');
      link.href = url;
      link.download = `SSI-ticket-${ticket.bookingId}.png`;
      link.click();
    } catch {
      setSaveError('The ticket could not be saved. Please take a screenshot instead.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div ref={cardRef} className="bg-white px-2 pb-2 text-left">
        <p className="text-[12px] font-medium text-primary">SS Innovations Events</p>
        <p className="mt-1 text-[17px] font-semibold leading-snug text-secondary">{ticket.eventName}</p>
        <dl className="mt-3 space-y-1.5 text-[13px] text-gray-700">
          {name && <div><dt className="sr-only">Attendee</dt><dd className="font-medium text-secondary">{name}</dd></div>}
          <div><dt className="sr-only">Date</dt><dd>{ticket.registrationOnly && endDate !== date ? `${date} to ${endDate}` : date}</dd></div>
          <div><dt className="sr-only">Time</dt><dd>{ticket.registrationOnly ? 'Any time during the event' : `${ticket.startTime} – ${ticket.endTime} (${eventTimeZone(ticket.timeZone)})`}</dd></div>
          {ticket.venue && <div><dt className="sr-only">Venue</dt><dd>{ticket.venue}</dd></div>}
        </dl>
        <div className="mt-4 flex justify-center">
          {cancelled
            ? <p className="max-w-xs py-8 text-center font-semibold text-red-700">Event cancelled. This ticket is not valid for admission.</p>
            : <QRCodeSVG value={ticket.qrData} size={220} marginSize={2} />}
        </div>
        <p className="mt-3 text-center text-[13px] font-semibold tracking-wide text-secondary">{ticket.bookingId}</p>
      </div>
      {saveError && <p role="alert" className="mt-3 text-[12px] text-red-700">{saveError}</p>}
      <div className="mt-4 flex gap-2">
        {!cancelled && (
          <button type="button" onClick={() => { void save(); }} disabled={saving}
            className="btn-primary h-11 flex-1 rounded-full px-4 text-[14px] font-medium text-white disabled:opacity-60">
            {saving ? 'Saving…' : 'Save ticket'}
          </button>
        )}
        <button type="button" onClick={onClose}
          className="h-11 flex-1 rounded-full border border-gray-200 px-4 text-[14px] font-semibold text-secondary">
          Close
        </button>
      </div>
    </>
  );
}
