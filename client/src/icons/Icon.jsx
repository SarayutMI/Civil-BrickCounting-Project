/* ===================================================================
   ICON — inline SVGs ported 1:1 from the original app.js ICON object.
   Usage: <Icon name="home" />
=================================================================== */
const PATHS = {
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/></>,
  home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/></>,
  task: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10h8M8 14h5"/></>,
  dash: <path d="M4 19V10M10 19V5M16 19v-7M22 19H2"/>,
  report: <><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
  logs: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></>,
  gear: <><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.5 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.3-.9c.77.66 1.65 1.17 2.6 1.5L10 22h4l.5-2.4a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4-2-1.6z"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 21h4"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  trash: <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></>,
  edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></>,
  play: <path d="M8 5v14l11-7z"/>,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
  download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 19h16"/></>,
  check: <path d="m4 12 5 5L20 6"/>,
  x: <path d="M18 6 6 18M6 6l12 12"/>,
  camera: <><path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13.5" r="3.2"/></>,
  users: <><circle cx="9" cy="8" r="3.2"/><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5"/><circle cx="17.5" cy="8.5" r="2.6"/><path d="M15.8 13.6c2.9.4 5.2 2.3 5.2 5.4"/></>,
  area: <path d="M4 8 10 4l10 5-6 4 6 4-10 5-10-5 6-4Z"/>,
  percent: <><path d="M5 19 19 5"/><circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="17" r="2.3"/></>,
  block: <path d="M3 9h8v6H3zM13 9h8v6h-8z"/>,
  upload: <><path d="M12 15V3m0 0 4 4m-4-4L8 7"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  pulse: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M6.5 11h2.5l1.5-3 2.5 6 1.5-3h3"/><path d="M9 21h6M12 17v4"/></>,
  wifi: <><path d="M2 8.8a15 15 0 0 1 20 0M5 12.3a10 10 0 0 1 14 0M8.5 15.8a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/></>,
  thermo: <><path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 11v6"/></>,
  server: <><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></>,
  db: <><ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
  ai: <><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></>,
  board: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h5M8 15h8"/><circle cx="17" cy="11" r="1"/></>,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="M10.6 5.1A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/></>,
  discord: <><rect x="3" y="6" width="18" height="13" rx="4"/><circle cx="9" cy="12.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12.5" r="1.3" fill="currentColor" stroke="none"/></>,
  empty: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16"/></>,
};

// A handful of icons in the original are drawn filled (fill="currentColor" stroke="none")
// rather than outlined — keep that distinction so they render identically.
const FILLED = new Set(['play', 'pause', 'stop']);
// Original per-icon stroke-width overrides (default elsewhere is 1.7).
const STROKE_WIDTH = { search: '1.8', plus: '2', check: '2', x: '2' };
// plus/x/check omit stroke-linejoin in the original — harmless to keep it, but match exactly.
const NO_LINEJOIN = new Set(['plus', 'x']);

export default function Icon({ name, ...rest }) {
  const body = PATHS[name];
  if (!body) return null;
  if (FILLED.has(name)) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...rest}>
        {body}
      </svg>
    );
  }
  const strokeWidth = STROKE_WIDTH[name] || '1.7';
  const linejoin = NO_LINEJOIN.has(name) ? undefined : 'round';
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin={linejoin} {...rest}>
      {body}
    </svg>
  );
}

export function iconMarkupNames() {
  return Object.keys(PATHS);
}
