import { useEffect, useRef, useState } from "react";
import { CloseIco, GlobeIco, MapIco, SparkIco } from "../icons.jsx";
import { ChatMessage } from "./ChatMessage.jsx";
import { regionName } from "./chatUtils.js";

function ThinkingState() {
  return (
    <div className="chat-message chat-message--assistant">
      <div className="chat-message__mark" aria-hidden>{SparkIco}</div>
      <div className="chat-thinking" aria-label="MAPR is analyzing live events">
        <span className="chat-thinking__line" />
        <span className="chat-thinking__line short" />
        <span className="chat-thinking__dots"><i /><i /><i /></span>
      </div>
    </div>
  );
}

export function ChatThread({
  messages,
  thinking,
  agentMode,
  mapMode,
  heatEnabled,
  focusedRegion,
  threadRef,
  onClear,
  onOpenEvent,
  onPickRegion,
  onNeedAuth,
}) {
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const timerRef = useRef(null);

  const scrollToBottom = () => {
    if (!threadRef.current) return;
    threadRef.current.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
    setHasUnreadBelow(false);
  };

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 96) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
      setHasUnreadBelow(false);
    } else {
      setHasUnreadBelow(true);
    }
  }, [messages.length, thinking, threadRef]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const clear = () => {
    if (messages.length <= 2 || confirmingClear) {
      window.clearTimeout(timerRef.current);
      setConfirmingClear(false);
      onClear();
      return;
    }
    setConfirmingClear(true);
    timerRef.current = window.setTimeout(() => setConfirmingClear(false), 2000);
  };

  const projectionLabel = mapMode === "globe" ? "Globe" : "FlatMap";
  const projectionIcon = mapMode === "globe" ? GlobeIco : MapIco;
  const focusLabel = focusedRegion ? regionName(focusedRegion) : "global";

  return (
    <div className="chat-thread-card">
      <div className="chat-thread-head">
        <span className="chat-thread-head__dot" />
        <span>{agentMode ? "MAPR Agent" : "Feed Search"}</span>
        <span className="chat-thread-head__projection">
          {projectionIcon}
          {projectionLabel}
        </span>
        <span className="chat-thread-head__spacer" />
        <span className="chat-thread-head__ground">
          {agentMode ? "grounded" : "faceted"} / {focusLabel}{heatEnabled ? " / heat" : ""}
        </span>
        <button type="button" onClick={clear} title="Clear conversation">
          {confirmingClear ? "Confirm clear" : CloseIco}
        </button>
      </div>
      <div
        className="chat-thread"
        ref={threadRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 96) setHasUnreadBelow(false);
        }}
      >
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            onOpenEvent={onOpenEvent}
            onPickRegion={onPickRegion}
            onNeedAuth={onNeedAuth}
          />
        ))}
        {thinking && <ThinkingState />}
      </div>
      {hasUnreadBelow && (
        <button type="button" className="chat-new-answer" onClick={scrollToBottom}>
          New answer
        </button>
      )}
    </div>
  );
}
