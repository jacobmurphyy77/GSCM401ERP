export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`wcw-brand${compact ? " wcw-brand-compact" : ""}`}>
    <svg className="wcw-brand-mark" viewBox="0 0 72 54" fill="none" aria-hidden="true">
      <path d="M5 39 27 8l14 21 9-13 17 23" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m21 17 6 6 5-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="8" y="34" width="34" height="15" rx="7.5" stroke="currentColor" strokeWidth="3.5" />
      <rect x="31" y="34" width="33" height="15" rx="7.5" stroke="currentColor" strokeWidth="3.5" />
      <circle cx="16" cy="41.5" r="2" fill="currentColor" /><circle cx="35" cy="41.5" r="2" fill="currentColor" /><circle cx="56" cy="41.5" r="2" fill="currentColor" />
    </svg>
    <span className="wcw-brand-type"><strong>WASATCH</strong><span>CYCLE WORKS</span></span>
  </span>;
}
