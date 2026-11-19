/** Drawn on one 20-unit grid, filled, so the transport reads as one set. */

export function PlayIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M6 3.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L7.2 3.1A.8.8 0 0 0 6 3.8Z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect x="4.5" y="3.5" width="4" height="13" rx="1" fill="currentColor" />
      <rect x="11.5" y="3.5" width="4" height="13" rx="1" fill="currentColor" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect x="4.5" y="4.5" width="11" height="11" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="m4.5 10.5 3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
