import { Link } from "react-router-dom";
import { useState } from "react";
import { isSocial } from "./chatUtils.js";

export function NewsImage({ src, className }) {
  const [loaded, setLoaded] = useState(true);

  if (!src || !loaded) return null;
  return <img className={className} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setLoaded(false)} />;
}

export function CitationImageStrip({ items }) {
  const imgs = (items || []).filter((item) => item.imageUrl);
  if (!imgs.length) return null;

  return (
    <div className="chat-source-strip">
      {imgs.map((item) => {
        const inner = (
          <>
            <NewsImage src={item.imageUrl} className="chat-source-strip__image" />
            <span className="chat-source-strip__caption">
              <b>[{item.index}]</b> {item.source}
              {isSocial(item.source) && <span className="social-badge">social</span>}
            </span>
          </>
        );

        if (item.eventId) {
          return (
            <Link key={item.index} className="chat-source-strip__item" to={`/event/${item.eventId}`}>
              {inner}
            </Link>
          );
        }

        if (item.url) {
          return (
            <a key={item.index} className="chat-source-strip__item" href={item.url} target="_blank" rel="noreferrer">
              {inner}
            </a>
          );
        }

        return <div key={item.index} className="chat-source-strip__item">{inner}</div>;
      })}
    </div>
  );
}

export function CitationTray({ items }) {
  if (!items?.length) return null;

  return (
    <div className="chat-citations">
      <div className="chat-citations__label">Sources</div>
      {items.map((item) => (
        <details key={item.index} className="chat-citation">
          <summary>
            <span className="chat-citation__index">[{item.index}]</span>
            <span className="chat-citation__title">{item.title}</span>
            <span className="chat-citation__source">
              {item.source}
              {isSocial(item.source) && <span className="social-badge">social</span>}
            </span>
            <span className="chat-citation__caret" aria-hidden>v</span>
          </summary>
          <div className="chat-citation__detail">
            <NewsImage src={item.imageUrl} className="chat-citation__image" />
            {item.quote && <p className="chat-citation__quote">"{item.quote}"</p>}
            <div className="chat-actions">
              {item.eventId && <Link className="chat-action chat-action--primary" to={`/event/${item.eventId}`}>View page</Link>}
              {item.url && <a className="chat-action" href={item.url} target="_blank" rel="noreferrer">Source</a>}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
