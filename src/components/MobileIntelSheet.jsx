import React from 'react';
import useBreakpoint from '../hooks/useBreakpoint';
import useUIStore from '../stores/uiStore';
import BottomSheet from './ui/BottomSheet';
import AnomalyPanel from './AnomalyPanel';
import WatchlistPanel from './WatchlistPanel';
import NarrativePanel from './NarrativePanel';

export default function MobileIntelSheet({
  velocitySpikes,
  silenceEntries,
  newsList,
  onRegionSelect,
}) {
  const { isMobile } = useBreakpoint();
  const drawerMode = useUIStore((s) => s.drawerMode);
  const setDrawerMode = useUIStore((s) => s.setDrawerMode);
  if (!isMobile) return null;
  return (
    <BottomSheet
      open={drawerMode === 'intel-mobile'}
      onClose={() => setDrawerMode(null)}
      title="Intel"
      ariaLabel="Intel panel"
      heightVh={85}
    >
      <div className="mobile-intel-stack">
        <AnomalyPanel
          velocitySpikes={velocitySpikes}
          silenceEntries={silenceEntries}
          onRegionSelect={onRegionSelect}
        />
        <WatchlistPanel onRegionSelect={onRegionSelect} />
        <NarrativePanel newsList={newsList} onRegionSelect={onRegionSelect} />
      </div>
    </BottomSheet>
  );
}
