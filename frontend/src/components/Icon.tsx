import type { SVGProps } from "react";

export type IconName =
  | "play"
  | "pause"
  | "stop"
  | "sparkles"
  | "undo"
  | "redo"
  | "lock"
  | "unlock"
  | "download"
  | "upload"
  | "chevronLeft"
  | "chevronRight"
  | "trash"
  | "arrowUp"
  | "arrowDown"
  | "settings"
  | "piano"
  | "wave"
  | "server"
  | "check";

const paths: Record<IconName, React.ReactNode> = {
  play: <path d="m9 7 8 5-8 5V7Z" />,
  pause: <><path d="M9 7v10" /><path d="M15 7v10" /></>,
  stop: <rect x="8" y="8" width="8" height="8" rx="1" />,
  sparkles: <><path d="m12 3 .8 2.2L15 6l-2.2.8L12 9l-.8-2.2L9 6l2.2-.8L12 3Z" /><path d="m18 11 .6 1.4L20 13l-1.4.6L18 15l-.6-1.4L16 13l1.4-.6L18 11Z" /><path d="m6 12 1 2.5L9.5 15 7 16l-1 2.5L5 16l-2.5-1L5 14.5 6 12Z" /></>,
  undo: <><path d="m9 8-4 4 4 4" /><path d="M5 12h8a5 5 0 0 1 5 5" /></>,
  redo: <><path d="m15 8 4 4-4 4" /><path d="M19 12h-8a5 5 0 0 0-5 5" /></>,
  lock: <><rect x="6" y="10" width="12" height="10" rx="2" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></>,
  unlock: <><rect x="6" y="10" width="12" height="10" rx="2" /><path d="M15 10V7a3 3 0 0 0-5.5-1.7" /></>,
  download: <><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M5 20h14" /></>,
  upload: <><path d="M12 17V5" /><path d="m8 9 4-4 4 4" /><path d="M5 20h14" /></>,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m7 7 1 13h8l1-13" /></>,
  arrowUp: <><path d="m7 11 5-5 5 5" /><path d="M12 6v12" /></>,
  arrowDown: <><path d="m7 13 5 5 5-5" /><path d="M12 18V6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  piano: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v9M11 5v9M15 5v9M19 5v9" /><path d="M5 14h14" /></>,
  wave: <path d="M3 12h2l2-6 3 12 3-12 2 6h6" />,
  server: <><rect x="4" y="4" width="16" height="6" rx="2" /><rect x="4" y="14" width="16" height="6" rx="2" /><path d="M8 7h.01M8 17h.01" /></>,
  check: <path d="m5 12 4 4L19 6" />,
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
