import React from 'react';
import { cn } from '../../lib/utils.ts';

export function PromptSuggestion({ className, children, ...props }) {
  return (
    <button type="button" className={cn('prompt-kit-suggestion', className)} {...props}>
      {children}
    </button>
  );
}
