import React from 'react';
import { cn } from '../../lib/utils.ts';

export function Message({ className, children, ...props }) {
  return (
    <div className={cn('prompt-kit-message', className)} {...props}>
      {children}
    </div>
  );
}

export function MessageContent({ className, children, ...props }) {
  return (
    <div className={cn('prompt-kit-message-content', className)} {...props}>
      {children}
    </div>
  );
}

export function MessageAvatar({ className, fallback = 'AI', ...props }) {
  return (
    <div className={cn('prompt-kit-message-avatar', className)} aria-hidden {...props}>
      {fallback}
    </div>
  );
}

export function MessageActions({ className, children, ...props }) {
  return (
    <div className={cn('prompt-kit-message-actions', className)} {...props}>
      {children}
    </div>
  );
}

export function MessageAction({ tooltip, children, ...props }) {
  return (
    <span className="prompt-kit-message-action" title={tooltip} {...props}>
      {children}
    </span>
  );
}
