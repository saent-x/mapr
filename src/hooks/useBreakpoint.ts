import { useEffect, useState } from 'react';

export type BreakpointState = {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
};

const MOBILE_MAX = 767;
const TABLET_MAX = 1023;

export function getBreakpointFromWidth(width: number): BreakpointState {
  if (!width || width <= 0) {
    return { isMobile: false, isTablet: false, isDesktop: true };
  }
  if (width <= MOBILE_MAX) {
    return { isMobile: true, isTablet: false, isDesktop: false };
  }
  if (width <= TABLET_MAX) {
    return { isMobile: false, isTablet: true, isDesktop: false };
  }
  return { isMobile: false, isTablet: false, isDesktop: true };
}

function readWidth(): number {
  if (typeof window === 'undefined') return 0;
  return window.innerWidth || 0;
}

export default function useBreakpoint(): BreakpointState {
  const [state, setState] = useState<BreakpointState>(() =>
    getBreakpointFromWidth(readWidth()),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mq767 = window.matchMedia('(max-width: 767px)');
    const mq1023 = window.matchMedia('(max-width: 1023px)');
    const update = () => setState(getBreakpointFromWidth(window.innerWidth));
    mq767.addEventListener('change', update);
    mq1023.addEventListener('change', update);
    update();
    return () => {
      mq767.removeEventListener('change', update);
      mq1023.removeEventListener('change', update);
    };
  }, []);

  return state;
}
