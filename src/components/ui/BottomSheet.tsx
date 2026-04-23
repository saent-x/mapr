import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel?: string;
  maxHeightVh?: number;
  children?: React.ReactNode;
};

const DISMISS_PX = 80;

export default function BottomSheet({
  open,
  onClose,
  title,
  ariaLabel,
  maxHeightVh = 85,
  children,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartY = useRef<number | null>(null);
  const [dragDy, setDragDy] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !sheetRef.current) return;
    const focusable = sheetRef.current.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragStartY.current = e.clientY;
    setDragDy(0);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current == null) return;
    const dy = e.clientY - dragStartY.current;
    setDragDy(Math.max(0, dy));
  }, []);
  const onPointerUp = useCallback(() => {
    const dy = dragDy;
    dragStartY.current = null;
    setDragDy(0);
    if (dy > DISMISS_PX) onClose();
  }, [dragDy, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') {
    return (
      <>
        <div className="bottom-sheet-scrim" aria-hidden onClick={onClose} />
        <aside
          ref={sheetRef}
          className="bottom-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel || title || 'Bottom sheet'}
          style={{ maxHeight: `${maxHeightVh}vh` }}
        >
          <div
            className="bottom-sheet-handle"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            role="presentation"
          >
            <span className="bottom-sheet-grabber" aria-hidden />
            {title ? <span className="bottom-sheet-title">{title}</span> : null}
          </div>
          <div className="bottom-sheet-body">{children}</div>
        </aside>
      </>
    );
  }

  const transform = dragDy > 0 ? `translateY(${dragDy}px)` : undefined;

  return createPortal(
    <>
      <div className="bottom-sheet-scrim" aria-hidden onClick={onClose} />
      <aside
        ref={sheetRef}
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title || 'Bottom sheet'}
        style={{ maxHeight: `${maxHeightVh}vh`, transform }}
      >
        <div
          className="bottom-sheet-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          role="presentation"
        >
          <span className="bottom-sheet-grabber" aria-hidden />
          {title ? <span className="bottom-sheet-title">{title}</span> : null}
        </div>
        <div className="bottom-sheet-body">{children}</div>
      </aside>
    </>,
    document.body,
  );
}
