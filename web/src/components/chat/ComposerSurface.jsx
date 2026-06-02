import { ChatThread } from "./ChatThread.jsx";
import { ModeSwitch } from "./ModeSwitch.jsx";
import { ProjectionSwitch } from "./ProjectionSwitch.jsx";
import { PromptInput } from "./PromptInput.jsx";
import { SuggestionRail } from "./SuggestionRail.jsx";

export function ComposerSurface({
  mapMode,
  heatEnabled,
  focusedRegion,
  tweaksOpen,
  tweaksPanel,
  quota,
  isAuthed,
  agentMode,
  canUseAgent,
  setAiMode,
  input,
  thinking,
  hasThread,
  messages,
  questionMemory,
  threadRef,
  textareaRef,
  submit,
  clearThread,
  onNeedAuth,
  onKeyDown,
  growTextarea,
  onOpenEvent,
  onPickRegion,
  onMapModeChange,
  onTweaksToggle,
}) {
  return (
    <div className="chat-shell" data-projection={mapMode === "globe" ? "globe" : "flat"}>
      {hasThread && (
        <ChatThread
          messages={messages}
          thinking={thinking}
          agentMode={agentMode}
          mapMode={mapMode}
          heatEnabled={heatEnabled}
          focusedRegion={focusedRegion}
          threadRef={threadRef}
          onClear={clearThread}
          onOpenEvent={onOpenEvent}
          onPickRegion={onPickRegion}
          onNeedAuth={onNeedAuth}
        />
      )}

      {!hasThread && !tweaksOpen && (
        <SuggestionRail
          mapMode={mapMode}
          focusedRegion={focusedRegion}
          questionMemory={questionMemory}
          onPick={submit}
        />
      )}

      <PromptInput
        input={input}
        textareaRef={textareaRef}
        agentMode={agentMode}
        mapMode={mapMode}
        thinking={thinking}
        toolbar={
          <>
            <ModeSwitch
              quota={quota}
              isAuthed={isAuthed}
              agentMode={agentMode}
              canUseAgent={canUseAgent}
              setAiMode={setAiMode}
              onNeedAuth={onNeedAuth}
            />
            <ProjectionSwitch
              mapMode={mapMode}
              tweaksOpen={tweaksOpen}
              filtersActive={tweaksOpen || heatEnabled}
              tweaksPanel={tweaksPanel}
              onMapModeChange={onMapModeChange}
              onTweaksToggle={onTweaksToggle}
            />
          </>
        }
        onChange={growTextarea}
        onKeyDown={onKeyDown}
        onSubmit={submit}
      />
    </div>
  );
}
