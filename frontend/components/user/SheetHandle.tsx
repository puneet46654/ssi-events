'use client';

import type { DragControls } from 'framer-motion';

/** iOS sheet grab handle: the only place a drag starts, so scrolling inside the sheet still scrolls. */
export default function SheetHandle({ controls }: { controls: DragControls }) {
  return (
    <div
      onPointerDown={(event) => controls.start(event)}
      className="-mx-5 -mt-3 mb-1 cursor-grab touch-none px-5 pb-1 pt-3 active:cursor-grabbing sm:hidden"
      aria-hidden="true"
    >
      <span className="sheet-handle" />
    </div>
  );
}
