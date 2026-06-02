import { InfinityIco, SearchIco, SparkIco } from "../icons.jsx";
import { fmtReset } from "./chatUtils.js";

export function ModeSwitch({ quota, isAuthed, agentMode, canUseAgent, setAiMode, onNeedAuth }) {
  return (
    <div className="chat-mode-row">
      <div className="chat-mode" role="group" aria-label="Chat mode">
        <button
          type="button"
          className="chat-mode__button chat-mode__button--icon"
          data-active={agentMode}
          data-locked={!canUseAgent}
          disabled={isAuthed && !canUseAgent}
          aria-label="Agent"
          title={!isAuthed ? "Sign in to use MAPR Agent" : !canUseAgent ? `Agent quota reached; resets ${fmtReset(quota?.resetAt)}` : "MAPR Agent: grounded, cited answers"}
          onClick={() => {
            if (!isAuthed) return onNeedAuth();
            if (!canUseAgent) return;
            setAiMode(true);
          }}
        >
          {SparkIco}
        </button>
        <button
          type="button"
          className="chat-mode__button chat-mode__button--icon"
          data-active={!agentMode}
          aria-label="Search"
          title="Faceted feed search: deterministic, no AI"
          onClick={() => setAiMode(false)}
        >
          {SearchIco}
        </button>
      </div>
      {isAuthed && (
        <span
          className="chat-mode__quota"
          title={quota?.unlimited ? "Unlimited questions" : `${quota?.remaining ?? 0} of ${quota?.limit ?? 0} questions left`}
          aria-label={quota?.unlimited ? "Unlimited questions" : `${quota?.remaining ?? 0} of ${quota?.limit ?? 0} questions left`}
        >
          {quota?.unlimited ? InfinityIco : `${quota?.remaining ?? 0}/${quota?.limit ?? 0}`}
        </span>
      )}
    </div>
  );
}
