/* lucide-style stroke icons */
function mkIcon(paths, fill) {
  return function Icon({ size = 20, ...rest }) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill={fill ? "currentColor" : "none"}
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...rest}>
        {paths.map((d, i) => <path key={i} d={d} />)}
      </svg>
    );
  };
}
function mkRaw(children) {
  return function Icon({ size = 20, ...rest }) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...rest}>
        {children}
      </svg>
    );
  };
}

const Icons = {
  Search: mkRaw(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></>),
  Globe: mkRaw(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" /></>),
  Map: mkRaw(<><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></>),
  Signals: mkRaw(<><path d="M3 12h3l2.5-7 5 16 2.5-9h5" /></>),
  Cases: mkRaw(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>),
  Entities: mkRaw(<><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="7" r="2.4" /><circle cx="12" cy="18" r="2.4" /><path d="M7.7 7.5 10.5 16M16.7 8.7 13.4 16M8 6.3h7.6" /></>),
  Eye: mkRaw(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="2.6" /></>),
  Settings: mkRaw(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>),
  Sun: mkRaw(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  Moon: mkRaw(<><path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" /></>),
  Send: mkRaw(<><path d="M12 19V5M5 12l7-7 7 7" /></>),
  X: mkRaw(<><path d="M6 6 18 18M18 6 6 18" /></>),
  Check: mkRaw(<><path d="M4 12.5 9 17.5 20 6.5" /></>),
  Plus: mkRaw(<><path d="M12 5v14M5 12h14" /></>),
  Download: mkRaw(<><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></>),
  Bell: mkRaw(<><path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9Z" /><path d="M10.5 20a2 2 0 0 0 3 0" /></>),
  Trend: mkRaw(<><path d="M3 17 9 11l4 4 8-8" /><path d="M16 7h5v5" /></>),
  Chevron: mkRaw(<><path d="m9 6 6 6-6 6" /></>),
  Sparkle: mkRaw(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M17.7 6.3l-2.1 2.1M8.4 15.6l-2.1 2.1" /></>),
  Star: mkIcon(["M12 3.5 14.3 9l5.7.5-4.3 3.8 1.3 5.6L12 16l-5 2.9 1.3-5.6L4 9.5 9.7 9 12 3.5Z"], true),
  Link: mkRaw(<><path d="M9 15 15 9" /><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1M13 18l-1 1a4 4 0 0 1-6-6l1-1" /></>),
  Clock: mkRaw(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  Lock: mkRaw(<><rect x="4.5" y="11" width="15" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  Alert: mkRaw(<><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17.5v.5" /></>),
  User: mkRaw(<><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></>),
  Layers: mkRaw(<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>),
  Pin: mkRaw(<><path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" /><circle cx="12" cy="9" r="2.4" /></>),
  Compass: mkRaw(<><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></>),
  ArrowUp: mkRaw(<><path d="m6 13 6-6 6 6" /></>),
  Filter: mkRaw(<><path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" /></>),
  Menu: mkRaw(<><path d="M4 7h16M4 12h16M4 17h16" /></>),
  Refresh: mkRaw(<><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" /></>),
  Shield: mkRaw(<><path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3Z" /></>),
  Mail: mkRaw(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
  Key: mkRaw(<><circle cx="8" cy="15" r="4" /><path d="M11 12 20 3M17 6l2 2M14 9l2 2" /></>),
  Github: mkRaw(<><path d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5c0-1 .3-1.7-.4-2.4 2.6-.3 5.4-1.3 5.4-5.8a4.5 4.5 0 0 0-1.3-3.1 4.2 4.2 0 0 0-.1-3.1s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C8.3 1.4 7.3 1.7 7.3 1.7a4.2 4.2 0 0 0-.1 3.1A4.5 4.5 0 0 0 5.9 8c0 4.5 2.8 5.5 5.4 5.8-.7.7-.7 1.4-.5 2.4V21" /></>),
  LogOut: mkRaw(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></>),
  Trash: mkRaw(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>),
  Server: mkRaw(<><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></>),
  Activity: mkRaw(<><path d="M3 12h4l3-8 4 16 3-8h4" /></>),
  Database: mkRaw(<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>),
  Flag: mkRaw(<><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>),
  Inbox: mkRaw(<><path d="M3 13h5l1.5 3h5L21 13M6 5h12l3 8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6L6 5Z" /></>),
  Sliders: mkRaw(<><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="13" cy="18" r="2" /><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" /></>),
  ArrowRt: mkRaw(<><path d="M5 12h14M13 6l6 6-6 6" /></>),
  ArrowLeft: mkRaw(<><path d="M19 12H5M11 18l-6-6 6-6" /></>),
  Card: mkRaw(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></>),
};
export { Icons };
