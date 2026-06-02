import { useRef } from "react";
import { useAction, useConvex, useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { ComposerSurface } from "./chat/ComposerSurface.jsx";
import { useComposerController } from "./chat/useComposerController.js";

/**
 * Bottom-center chat command surface.
 * Agent mode calls grounded RAG; Search mode runs deterministic map filtering.
 */
export default function Composer({
  mapMode,
  heatEnabled,
  focusedRegion,
  tweaksOpen,
  tweaksPanel,
  events,
  onMapModeChange,
  onTweaksToggle,
  onResult,
  onOpenEvent,
  onPickRegion,
  isAuthed,
  onNeedAuth,
}) {
  const convex = useConvex();
  const ask = useAction(anyApi.rag.ask);
  const quota = useQuery(anyApi.qa.quotaStatus, {});
  const threadRef = useRef(null);
  const textareaRef = useRef(null);

  const controller = useComposerController({
    convex,
    ask,
    quota,
    isAuthed,
    events,
    onResult,
    textareaRef,
  });

  return (
    <ComposerSurface
      mapMode={mapMode}
      heatEnabled={heatEnabled}
      focusedRegion={focusedRegion}
      tweaksOpen={tweaksOpen}
      tweaksPanel={tweaksPanel}
      onMapModeChange={onMapModeChange}
      onTweaksToggle={onTweaksToggle}
      quota={quota}
      isAuthed={isAuthed}
      onOpenEvent={onOpenEvent}
      onPickRegion={onPickRegion}
      onNeedAuth={onNeedAuth}
      threadRef={threadRef}
      textareaRef={textareaRef}
      {...controller}
    />
  );
}
