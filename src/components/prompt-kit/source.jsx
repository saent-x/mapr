import React from 'react';
import { cn } from '../../lib/utils.ts';

export function Source({ className, children, ...props }) {
  return (
    <a className={cn('prompt-kit-source', className)} {...props}>
      {children}
    </a>
  );
}

export function SourceTrigger({ className, label, children, ...props }) {
  return (
    <button type="button" className={cn('prompt-kit-source-trigger', className)} {...props}>
      {children || label}
    </button>
  );
}

export function SourceContent({ className, title, description, children, ...props }) {
  return (
    <span className={cn('prompt-kit-source-content', className)} {...props}>
      {title && <span className="prompt-kit-source-title">{title}</span>}
      {description && <span className="prompt-kit-source-description">{description}</span>}
      {children}
    </span>
  );
}
