import React, { useState } from 'react';
import { Clock } from 'lucide-react';
import useBreakpoint from '../hooks/useBreakpoint';
import BottomSheet from './ui/BottomSheet';
import EventTimeline from './EventTimeline';

export default function MobileTimelineSheet({
  events = [],
  scrubTime,
  onScrub,
  onEventSelect,
  selectedStoryId,
}) {
  const { isMobile, isTablet } = useBreakpoint();
  const [open, setOpen] = useState(false);

  if (!isMobile && !isTablet) return null;

  const scrubActive = scrubTime != null;

  return (
    <>
      <button
        type="button"
        className="mobile-timeline-fab"
        aria-label={`Timeline${scrubActive ? ' — historical scrub active' : ''}`}
        aria-expanded={open}
        data-scrub-active={scrubActive || undefined}
        onClick={() => setOpen(true)}
      >
        <Clock size={18} aria-hidden />
        <span className="mobile-timeline-fab-label">TIME</span>
        {scrubActive && <span className="mobile-timeline-fab-dot" aria-hidden />}
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Timeline"
        ariaLabel="Event timeline"
        maxHeightVh={60}
      >
        <div className="mobile-timeline-wrap">
          <EventTimeline
            events={events}
            scrubTime={scrubTime}
            onScrub={onScrub}
            onEventSelect={(story) => {
              onEventSelect?.(story);
              setOpen(false);
            }}
            selectedStoryId={selectedStoryId}
          />
        </div>
      </BottomSheet>
    </>
  );
}
