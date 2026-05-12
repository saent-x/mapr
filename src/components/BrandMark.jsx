import React from 'react';

export default function BrandMark({ className = 'brand-mark', size = 20, title = 'MAPR', decorative = true }) {
  const ariaProps = decorative
    ? { 'aria-hidden': true }
    : { role: 'img', 'aria-label': title };

  return (
    <span className={className} {...ariaProps}>
      <svg width={size} height={size} viewBox="0 0 20 20" focusable="false">
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="var(--amber)" strokeWidth="1" />
        <path d="M10 1.5 L10 18.5 M1.5 10 L18.5 10" stroke="var(--amber)" strokeWidth="0.6" opacity="0.5" />
        <path d="M5 10 Q10 5 15 10 Q10 15 5 10 Z" fill="var(--amber)" />
        <circle cx="10" cy="10" r="1.5" fill="var(--bg-0)" />
      </svg>
    </span>
  );
}
