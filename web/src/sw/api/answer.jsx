/* ============================================================
   Render the qwen-generated grounded answer (GitHub-flavored Markdown:
   a bold bottom line, then `-` bullets / short `###` headings, with inline
   [n] citation markers). Tiny, safe renderer — no HTML injection, no deps.
   ============================================================ */
import React from "react";

// Split the answer into a serif "bottom line" (the lead bold/first line) and
// the supporting body.
export function splitAnswer(md) {
  const text = (md || "").trim();
  if (!text) return { lead: "", body: "" };
  const lines = text.split("\n");
  let leadIdx = lines.findIndex((l) => l.trim());
  if (leadIdx < 0) return { lead: "", body: "" };
  let lead = lines[leadIdx].trim();
  // strip leading markdown emphasis/bullet from the lead line
  lead = lead.replace(/^[-*]\s+/, "").replace(/^#{1,6}\s+/, "").replace(/^\*\*(.+?)\*\*\s*$/, "$1").trim();
  const body = lines.slice(leadIdx + 1).join("\n").trim();
  return { lead, body };
}

// Inline renderer: **bold**, *italic*, `code`, and [n] citation chips.
function renderInline(text, keyBase) {
  const out = [];
  // tokenize on **bold**, *italic*, `code`, [n]
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[\d+\])/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = keyBase + "-" + i++;
    if (tok.startsWith("**")) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="md-code">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("*")) out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    else if (/^\[\d+\]$/.test(tok)) out.push(<sup key={k} className="cite-mark">{tok.slice(1, -1)}</sup>);
    else out.push(tok);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal block renderer for the answer body (headings · bullets · paragraphs). */
export function Markdown({ text }) {
  const src = (text || "").trim();
  if (!src) return null;
  const blocks = [];
  const lines = src.split("\n");
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={"p" + blocks.length} className="md-p">{renderInline(para.join(" "), "p" + blocks.length)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(<ul key={"ul" + blocks.length} className="md-ul">{list}</ul>);
      list = null;
    }
  };
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); return; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); flushList(); blocks.push(<div key={"h" + idx} className="md-h">{renderInline(h[2], "h" + idx)}</div>); return; }
    const b = line.match(/^[-*]\s+(.*)$/);
    if (b) { flushPara(); list = list || []; list.push(<li key={"li" + idx}>{renderInline(b[1], "li" + idx)}</li>); return; }
    flushList();
    para.push(line);
  });
  flushPara();
  flushList();
  return <div className="md">{blocks}</div>;
}
