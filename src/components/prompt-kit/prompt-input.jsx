import React from 'react';
import { cn } from '../../lib/utils.ts';

export function PromptInput({ className, children, isLoading, ...props }) {
  return (
    <div className={cn('prompt-kit-input', className)} data-loading={isLoading ? 'true' : undefined} {...props}>
      {children}
    </div>
  );
}

export const PromptInputTextarea = React.forwardRef(function PromptInputTextarea({
  className,
  ...props
}, ref) {
  return (
    <textarea
      ref={ref}
      className={cn('prompt-kit-input-textarea', className)}
      {...props}
    />
  );
});

export function PromptInputActions({ className, children, ...props }) {
  return (
    <div className={cn('prompt-kit-input-actions', className)} {...props}>
      {children}
    </div>
  );
}

export function PromptInputAction({ tooltip, children, ...props }) {
  return (
    <span className="prompt-kit-input-action" title={tooltip} {...props}>
      {children}
    </span>
  );
}
