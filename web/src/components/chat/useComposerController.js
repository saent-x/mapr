import { useCallback, useMemo, useState } from "react";
import { anyApi } from "convex/server";
import { deriveMapReaction } from "./mapContext.js";

const QUESTION_MEMORY_KEY = "mapr.questionMemory.v1";
const QUESTION_MEMORY_LIMIT = 16;

function loadQuestionMemory() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(QUESTION_MEMORY_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, QUESTION_MEMORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function rememberQuestion(question, setQuestionMemory) {
  setQuestionMemory((items) => {
    const normalized = question.trim();
    const next = [
      { text: normalized, at: Date.now() },
      ...items.filter((item) => item?.text?.toLowerCase() !== normalized.toLowerCase()),
    ].slice(0, QUESTION_MEMORY_LIMIT);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(QUESTION_MEMORY_KEY, JSON.stringify(next));
      } catch {
        // Ignore private-mode or storage quota failures; prompt history still works in memory.
      }
    }
    return next;
  });
}

export function useComposerController({
  convex,
  ask,
  quota,
  isAuthed,
  events,
  onResult,
  textareaRef,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [aiMode, setAiMode] = useState(true);
  const [promptHistory, setPromptHistory] = useState([]);
  const [questionMemory, setQuestionMemory] = useState(loadQuestionMemory);
  const [historyIndex, setHistoryIndex] = useState(null);

  const agentBlocked = isAuthed && quota != null && !quota.unlimited && (quota.remaining ?? 0) <= 0;
  const canUseAgent = isAuthed && !agentBlocked;
  const agentMode = aiMode && canUseAgent;
  const hasThread = messages.length > 0 || thinking;

  const resetTextarea = useCallback(() => {
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [textareaRef]);

  const submit = useCallback(
    async (text) => {
      const q = (text ?? input).trim();
      if (!q || thinking) return;

      setInput("");
      setHistoryIndex(null);
      setPromptHistory((items) => {
        const next = items[items.length - 1] === q ? items : [...items, q];
        return next.slice(-20);
      });
      rememberQuestion(q, setQuestionMemory);
      resetTextarea();
      setMessages((current) => [...current, { role: "user", text: q, id: `${Date.now()}u` }]);
      setThinking(true);

      try {
        const inputReaction = deriveMapReaction({ question: q, events });
        if (inputReaction) {
          onResult(inputReaction.eventIds, inputReaction.scope, { focusIso: inputReaction.focusIso });
        }


        const wantsBrief = /\b(brief|briefing|what changed|changed since|morning brief)\b/i.test(q);
        if (agentMode && wantsBrief) {
          const scopeType = inputReaction?.regionParam ? "region" : "global";
          const brief = await convex.mutation(anyApi.briefs.generate, {
            scopeType,
            scopeValue: inputReaction?.regionParam ?? undefined,
            windowHours: /yesterday|24h|24 hours/i.test(q) ? 24 : 168,
          });
          const body = [
            `### ${brief.title}`,
            brief.summary,
            ...(brief.sections ?? []).map((section) => `**${section.title}.** ${section.body}`),
          ].join("\n\n");
          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              id: `${Date.now()}a`,
              reply: body,
              citations: brief.citations,
              scope: inputReaction?.scope,
              agent: true,
            },
          ]);
          return;
        }
        if (agentMode) {
          const res = await ask({
            text: q,
            region: inputReaction?.regionParam ?? undefined,
          });
          const responseReaction =
            deriveMapReaction({ question: q, answer: res.answer, citations: res.citations, events }) ?? inputReaction;
          if (responseReaction) {
            onResult(responseReaction.eventIds, responseReaction.scope, { focusIso: responseReaction.focusIso });
          }
          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              id: `${Date.now()}a`,
              reply: res.answer,
              citations: res.citations,
              scope: responseReaction?.scope,
              agent: true,
            },
          ]);
          return;
        }

        const parsed = await convex.query(anyApi.events.intentSearch, { text: q });
        const responseReaction = deriveMapReaction({ question: q, answer: parsed.reply, events }) ?? inputReaction;
        const eventIds = responseReaction?.source === "semantic" ? responseReaction.eventIds : parsed.eventIds;
        const scope = responseReaction?.source === "semantic" ? responseReaction.scope : parsed.scope;
        if (eventIds !== undefined && eventIds !== null) {
          onResult(eventIds, scope, { focusIso: responseReaction?.focusIso });
        }
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            id: `${Date.now()}a`,
            reply: parsed.reply,
            scope: parsed.scope,
            events: parsed.topEvents,
            regions: parsed.regions,
            anomalies: parsed.anomalies,
            facets: parsed.facets,
          },
        ]);
      } catch (err) {
        const msg = String(err?.message || err);
        const isQuota = msg.includes("QA_QUOTA_EXCEEDED");
        const friendly = isQuota
          ? "You've reached your QA quota for this period. Upgrade to Pro for a higher limit."
          : msg.includes("AI_BAD_QA_OUTPUT")
            ? "The model couldn't produce a grounded, cited answer for that. Try a narrower question."
            : "Something went wrong reaching the assistant. Try again.";
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            id: `${Date.now()}a`,
            reply: friendly,
            tone: "error",
            needAuth: isQuota,
          },
        ]);
      } finally {
        setThinking(false);
      }
    },
    [agentMode, ask, convex, events, input, onResult, resetTextarea, thinking],
  );

  const clearThread = useCallback(() => {
    setMessages([]);
    onResult(null, null);
  }, [onResult]);

  const growTextarea = useCallback((event) => {
    setInput(event.target.value);
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(144, event.target.scrollHeight)}px`;
  }, []);

  const onKeyDown = useCallback(
    (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
        return;
      }

      if (event.key === "Escape") {
        event.currentTarget.blur();
        return;
      }

      if (event.key === "ArrowUp" && !input && promptHistory.length) {
        event.preventDefault();
        const nextIndex = historyIndex == null ? promptHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIndex);
        setInput(promptHistory[nextIndex]);
        return;
      }

      if (event.key === "ArrowDown" && historyIndex != null) {
        event.preventDefault();
        const nextIndex = historyIndex + 1;
        if (nextIndex >= promptHistory.length) {
          setHistoryIndex(null);
          setInput("");
        } else {
          setHistoryIndex(nextIndex);
          setInput(promptHistory[nextIndex]);
        }
      }
    },
    [historyIndex, input, promptHistory, submit],
  );

  return useMemo(
    () => ({
      messages,
      input,
      setInput,
      thinking,
      aiMode,
      setAiMode,
      agentMode,
      canUseAgent,
      agentBlocked,
      hasThread,
      submit,
      clearThread,
      onKeyDown,
      growTextarea,
      questionMemory,
    }),
    [
      agentBlocked,
      agentMode,
      aiMode,
      canUseAgent,
      clearThread,
      growTextarea,
      hasThread,
      input,
      messages,
      onKeyDown,
      questionMemory,
      submit,
      thinking,
    ],
  );
}
