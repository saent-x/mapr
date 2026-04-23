import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel?: string;
  maxHeightVh?: number;
  peekVh?: number;
  heightVh?: number;
  children?: React.ReactNode;
};

const DISMISS_PX = 80;
const EXPAND_PX = 80;

export default function BottomSheet({
  open,
  onClose,
  title,
  ariaLabel,
  maxHeightVh = 85,
  peekVh,
  heightVh,
  children,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartY = useRef<number | null>(null);
  const [dragDy, setDragDy] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

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
    setDragDy(dy);
  }, []);
  const onPointerUp = useCallback(() => {
    const dy = dragDy;
    dragStartY.current = null;
    setDragDy(0);
    if (peekVh != null) {
      if (dy < -EXPAND_PX && !expanded) {
        setExpanded(true);
        return;
      }
      if (dy > DISMISS_PX) {
        if (expanded) setExpanded(false);
        else onClose();
      }
      return;
    }
    if (dy > DISMISS_PX) onClose();
  }, [dragDy, expanded, peekVh, onClose]);

  if (!open) return null;

  let sheetHeight: number | null = null;
  if (heightVh != null) sheetHeight = heightVh;
  else if (peekVh != null) sheetHeight = expanded ? maxHeightVh : peekVh;

  const baseStyle: React.CSSProperties = sheetHeight != null
    ? { height: `${sheetHeight}vh` }
    : { maxHeight: `${maxHeightVh}vh` };
  const transform = dragDy > 0 ? `translateY(${dragDy}px)` : undefined;
  const sheetStyle: React.CSSProperties = transform
    ? { ...baseStyle, transform }
    : baseStyle;

  const content = (
    <>
      <div className="bottom-sheet-scrim" aria-hidden onClick={onClose} />
      <aside
        ref={sheetRef}
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title || 'Bottom sheet'}
        style={sheetStyle}
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

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}
