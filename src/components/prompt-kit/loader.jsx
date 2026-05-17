import React from 'react';
import { cn } from '../../lib/utils.ts';

export function Loader({ className, label, ...props }) {
  return (
    <div className={cn('prompt-kit-loader', className)} {...props}>
      <span className="prompt-kit-loader-dot" />
      <span className="prompt-kit-loader-dot" />
      <span className="prompt-kit-loader-dot" />
      {label && <span className="prompt-kit-loader-label">{label}</span>}
    </div>
  );
}
