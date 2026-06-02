import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SparkIco } from "../icons.jsx";
import { CitationImageStrip, CitationTray } from "./CitationTray.jsx";
import { AnomalyRows, EvidenceEventRow, FacetSummary, RegionRows } from "./EvidenceRows.jsx";

const MD_COMPONENTS = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};

function RichAnswer({ text }) {
  return (
    <div className="chat-markdown">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={MD_COMPONENTS}>{text}</Markdown>
    </div>
  );
}

export function ChatMessage({ message, onOpenEvent, onPickRegion, onNeedAuth }) {
  if (message.role === "user") {
    return (
      <div className="chat-message chat-message--user">
        <span>{message.text}</span>
      </div>
    );
  }

  return (
    <div className={`chat-message chat-message--assistant ${message.tone === "error" ? "is-error" : ""}`}>
      <div className="chat-message__mark" aria-hidden>{SparkIco}</div>
      <div className="chat-message__body">
        {message.agent ? <RichAnswer text={message.reply} /> : <p className="chat-message__text">{message.reply}</p>}
        {message.agent && <CitationImageStrip items={message.citations} />}
        {message.scope && <div className="chat-scope-chip">{message.scope}</div>}
        {message.facets && <FacetSummary facets={message.facets} />}
        {message.events?.length > 0 && (
          <div className="chat-evidence-list">
            {message.events.map((event) => (
              <EvidenceEventRow key={event._id} event={event} onOpen={onOpenEvent} />
            ))}
          </div>
        )}
        {message.anomalies?.length > 0 && <AnomalyRows items={message.anomalies} />}
        {message.regions?.length > 0 && <RegionRows items={message.regions} onPick={onPickRegion} />}
        <CitationTray items={message.citations} />
        {message.needAuth && (
          <button type="button" className="btn primary" style={{ alignSelf: "flex-start" }} onClick={onNeedAuth}>
            Account
          </button>
        )}
      </div>
    </div>
  );
}
