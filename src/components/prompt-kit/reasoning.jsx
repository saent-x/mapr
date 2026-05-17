import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.ts';

export function Reasoning({
  className,
  children,
  open,
  onOpenChange,
  isStreaming = false,
  ...props
}) {
  const [internalOpen, setInternalOpen] = useState(false);

  useEffect(() => {
    if (!isStreaming && open === undefined) setInternalOpen(false);
  }, [isStreaming, open]);

  const currentOpen = open ?? internalOpen;
  const handleOpenChange = useCallback((nextOpen) => {
    if (onOpenChange) onOpenChange(nextOpen);
    else setInternalOpen(nextOpen);
  }, [onOpenChange]);

  return (
    <div className={cn('prompt-kit-reasoning', className)} data-open={currentOpen ? 'true' : undefined} {...props}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;
        if (child.type === ReasoningTrigger || child.type === ReasoningContent) {
          return React.cloneElement(child, { open: currentOpen, onOpenChange: handleOpenChange });
        }
        return child;
      })}
    </div>
  );
}

export const ReasoningTrigger = React.forwardRef(function ReasoningTrigger({
  className,
  children,
  open,
  onOpenChange,
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn('prompt-kit-reasoning-trigger', className)}
      aria-expanded={Boolean(open)}
      onClick={() => onOpenChange?.(!open)}
      {...props}
    >
      <span>{children}</span>
      <ChevronDown size={14} aria-hidden />
    </button>
  );
});

export const ReasoningContent = React.forwardRef(function ReasoningContent({
  className,
  children,
  open,
  ...props
}, ref) {
  if (!open) return null;
  return (
    <div ref={ref} className={cn('prompt-kit-reasoning-content', className)} {...props}>
      {children}
    </div>
  );
});
