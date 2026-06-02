import { SendIco } from "../icons.jsx";

export function PromptInput({
  input,
  textareaRef,
  agentMode,
  mapMode,
  thinking,
  toolbar,
  onChange,
  onKeyDown,
  onSubmit,
}) {
  const ready = input.trim().length > 0;
  const label = agentMode ? "Ask MAPR Agent" : "Search live feed";
  const placeholder = agentMode
    ? mapMode === "globe"
      ? "Ask about routes..."
      : "Ask MAPR..."
    : mapMode === "globe"
      ? "Search routes..."
      : "Search events...";

  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={input}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
      />
      <div className="chat-composer__toolbar">
        <div className="chat-composer__tools">
          {toolbar}
        </div>
        <button
          className="chat-composer__send"
          data-ready={ready}
          disabled={!ready || thinking}
          aria-disabled={!ready || thinking}
          type="submit"
          title={ready ? "Send" : "Enter a prompt"}
        >
          {SendIco}
        </button>
      </div>
    </form>
  );
}
