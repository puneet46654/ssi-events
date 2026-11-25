/** Two-step progress card shared by the booking details form (step 1) and the time-slot page (step 2). */
/** On step 2, `onEditDetails` makes "Your details" a button back to the form. */
export default function BookingStepper({ step, onEditDetails }: { step: 1 | 2; onEditDetails?: () => void }) {
  const done = step === 2;
  const editable = done && !!onEditDetails;
  return (
    <nav
      aria-label="Booking progress"
      className="flex items-center gap-2.5 glass rounded-2xl px-3 py-2 sm:px-4"
    >
      <div
        className={`flex shrink-0 items-center gap-2 ${editable ? '-m-1 cursor-pointer rounded-xl p-1 transition-colors hover:bg-primary/[0.05] active:bg-primary/[0.08]' : ''}`}
        aria-current={step === 1 ? 'step' : undefined}
        {...(editable ? { role: 'button', tabIndex: 0, 'aria-label': 'Edit your details', onClick: onEditDetails, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEditDetails!(); } } } : {})}
      >
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-white ${
            done
              ? 'bg-[linear-gradient(135deg,#283F8F,#23879A)]'
              : 'bg-[linear-gradient(135deg,#283F8F,#23879A)] ring-[3px] ring-primary/10'
          }`}
        >
          {done ? (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
            </svg>
          ) : (
            '1'
          )}
        </span>
        <span className="leading-tight">
          <span className="block text-[10px] font-semibold uppercase max-[359px]:hidden tracking-[0.08em] text-gray-400">Step 1</span>
          <span className={`block text-[13.5px] font-semibold ${done ? 'text-primary' : 'text-secondary'}`}>Your details</span>
        </span>
      </div>

      <div className="h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
        <div
          className={`h-full rounded-full bg-[linear-gradient(90deg,#283F8F,#23879A)] transition-[width] duration-700 ease-out ${
            done ? 'w-full' : 'w-1/2'
          }`}
        />
      </div>

      <div className="flex shrink-0 items-center gap-2" aria-current={step === 2 ? 'step' : undefined}>
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] font-semibold ${
            done
              ? 'bg-[linear-gradient(135deg,#283F8F,#23879A)] text-white ring-[3px] ring-primary/10'
              : 'border-2 border-gray-200 bg-white text-gray-400'
          }`}
        >
          2
        </span>
        <span className="leading-tight">
          <span className="block text-[10px] font-semibold uppercase max-[359px]:hidden tracking-[0.08em] text-gray-400">Step 2</span>
          <span className={`block text-[13.5px] font-semibold ${done ? 'text-secondary' : 'text-gray-400'}`}>Time slot</span>
        </span>
      </div>
    </nav>
  );
}
