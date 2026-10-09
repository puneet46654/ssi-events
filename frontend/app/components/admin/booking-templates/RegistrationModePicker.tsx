'use client';

export type RegistrationMode = 'slots' | 'open' | 'info';
export type EventLink = { label: string; url: string };

const OPTIONS: { id: RegistrationMode; name: string; description: string }[] = [
  { id: 'slots', name: 'Time slots', description: 'Attendees register and choose a time slot. Check-in follows their slot.' },
  { id: 'open', name: 'Registration only', description: 'Attendees register and receive one QR ticket for the event, with no time slot. Check-in is open throughout the event days.' },
  { id: 'info', name: 'Information only', description: 'No registration. The event is listed with its details, where to find us and links, for example a conference we are attending.' },
];

const MAX_LINKS = 4;
const LINK_SUGGESTIONS = ['Conference website', 'LinkedIn post', 'Press release', 'Photo gallery'];
const inputClass = 'h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-[15px] text-secondary outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10';

/**
 * How attendees book an event: a time slot, registration only, or not at all (information only).
 * Registration only can have a limit on the number of registrations; leaving it blank means no
 * limit. Information only takes an optional stand or booth and up to four labelled links.
 */
export default function RegistrationModePicker({
  mode, onModeChange, capacity, onCapacityChange, locked = false,
  stand = '', onStandChange, links = [], onLinksChange,
}: {
  mode: RegistrationMode;
  onModeChange: (mode: RegistrationMode) => void;
  capacity: string;
  onCapacityChange: (value: string) => void;
  /** People have already booked: the type can no longer change. */
  locked?: boolean;
  stand?: string;
  onStandChange?: (value: string) => void;
  links?: EventLink[];
  onLinksChange?: (links: EventLink[]) => void;
}) {
  const setLink = (index: number, change: Partial<EventLink>) =>
    onLinksChange?.(links.map((link, i) => (i === index ? { ...link, ...change } : link)));
  return (
    <div className="space-y-3">
      <div>
        <p className="block text-sm font-semibold text-secondary">Booking type</p>
        <p className="mt-1 text-sm leading-5 text-gray-500">
          {locked ? 'People have already registered, so the booking type can no longer change.' : 'Choose whether attendees book a time slot, simply register, or whether the event is listed for information only.'}
        </p>
      </div>
      <div role="radiogroup" aria-label="Booking type" className="grid gap-2">
        {OPTIONS.map((option) => {
          const selected = mode === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={locked && !selected}
              onClick={() => { if (!locked) onModeChange(option.id); }}
              className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                selected ? 'border-primary bg-primary/[0.06]' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <span className="block text-[15px] font-semibold text-secondary">{option.name}</span>
              <span className="mt-1 block text-sm leading-5 text-gray-600">{option.description}</span>
            </button>
          );
        })}
      </div>
      {mode === 'open' && (
        <div>
          <label htmlFor="registration-capacity" className="block text-sm font-semibold text-secondary">Registration limit (optional)</label>
          <input
            id="registration-capacity"
            type="number"
            inputMode="numeric"
            min={1}
            max={100000}
            step={1}
            placeholder="No limit"
            value={capacity}
            onChange={(e) => onCapacityChange(e.target.value.replace(/[^0-9]/g, ''))}
            className="mt-1 h-11 w-full max-w-[220px] rounded-lg border border-gray-200 bg-white px-3 text-[15px] text-secondary outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          />
          <p className="mt-1 text-sm text-gray-500">Registration closes when this many people have registered. Leave blank for no limit.</p>
        </div>
      )}
      {mode === 'info' && (
        <div className="space-y-4">
          <div>
            <label htmlFor="event-stand" className="block text-sm font-semibold text-secondary">Stand or booth (optional)</label>
            <input
              id="event-stand"
              maxLength={120}
              placeholder="e.g. Hall 8, Stand C12"
              value={stand}
              onChange={(e) => onStandChange?.(e.target.value)}
              className={`mt-1 max-w-[420px] ${inputClass}`}
            />
            <p className="mt-1 text-sm text-gray-500">Shown on the event page as &ldquo;Find us at&rdquo;.</p>
          </div>
          <div>
            <p className="block text-sm font-semibold text-secondary">Links (optional)</p>
            <p className="mt-1 text-sm text-gray-500">Up to {MAX_LINKS}, such as the conference website or a LinkedIn post. The first link is also the main button on the event page.</p>
            <datalist id="event-link-labels">
              {LINK_SUGGESTIONS.map((label) => <option key={label} value={label} />)}
            </datalist>
            <ul className="mt-2 space-y-2">
              {links.map((link, index) => (
                <li key={index} className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                  <input
                    aria-label={`Link ${index + 1} label`}
                    list="event-link-labels"
                    maxLength={60}
                    placeholder="Label, e.g. LinkedIn post"
                    value={link.label}
                    onChange={(e) => setLink(index, { label: e.target.value })}
                    className={inputClass}
                  />
                  <input
                    aria-label={`Link ${index + 1} address`}
                    type="url"
                    inputMode="url"
                    maxLength={500}
                    placeholder="https://"
                    value={link.url}
                    onChange={(e) => setLink(index, { url: e.target.value })}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => onLinksChange?.(links.filter((_, i) => i !== index))}
                    className="text-sm font-medium text-gray-600 underline-offset-4 hover:text-red-600 hover:underline"
                  >
                    Remove link
                  </button>
                </li>
              ))}
            </ul>
            {links.length < MAX_LINKS && (
              <button
                type="button"
                onClick={() => onLinksChange?.([...links, { label: links.length ? '' : 'Conference website', url: '' }])}
                className="mt-2 h-10 rounded-lg border border-dashed border-gray-300 px-4 text-sm font-medium text-primary hover:border-primary/50"
              >
                Add link
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
