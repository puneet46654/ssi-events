'use client';

import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

/** App-wide: every framer-motion animation honours the device's "Reduce motion" setting. */
export default function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
