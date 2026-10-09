'use client';

export type RegistrationMode = 'slots' | 'open';

const OPTIONS: { id: RegistrationMode; name: string; description: string }[] = [
  { id: 'slots', name: 'Time slots', description: 'Attendees register and choose a time slot. Check-in follows their slot.' },
  { id: 'open', name: 'Registration only', description: 'Attendees register and receive one QR ticket for the event, with no time slot. Check-in is open throughout the event days.' },
];

/**
 * How attendees book an event: a time slot, or registration only. Registration only can have a
 * limit on the number of registrations; leaving it blank means no limit.
 */
export default function RegistrationModePicker({
  mode, onModeChange, capacity, onCapacityChange, locked = false,
}: {
  mode: RegistrationMode;
  onModeChange: (mode: RegistrationMode) => void;
  capacity: string;
  onCapacityChange: (value: string) => void;
  /** People have already booked: the type can no longer change. */
  locked?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="block text-sm font-semibold text-secondary">Booking type</p>
        <p className="mt-1 text-sm leading-5 text-gray-500">
          {locked ? 'People have already registered, so the booking type can no longer change.' : 'Choose whether attendees book a time slot or simply register.'}
        </p>
      </div>
      <div role="radiogroup" aria-label="Booking type" className="grid gap-2 sm:grid-cols-2">
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
    </div>
  );
}
