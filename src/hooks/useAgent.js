import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSubscriptionStore from '../stores/subscriptionStore';
import useFilterStore from '../stores/filterStore';
import {
  listQaConversations,
  createQaConversation,
  fetchQaMessages,
  sendQaMessage,
  archiveQaConversation,
} from '../services/backendService.js';

const STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  SENDING: 'sending',
  ERROR: 'error',
  QUOTA_EXCEEDED: 'quota_exceeded',
  NOT_CONFIGURED: 'not_configured',
});

function optimisticMessage(content) {
  return {
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'user',
    content,
    citations: null,
    createdAt: Date.now(),
    optimistic: true,
  };
}

/**
 * useAgent — single source of truth for the sidebar drawer.
 *
 * Owns: active conversation id, conversation list, message list per id,
 * sending state, the most recent error / quota state, and a memory-cached
 * map of messages per conversation so flicking between recent threads is
 * snappy.
 */
export default function useAgent() {
  const isAuthenticated = useSubscriptionStore((s) => s.isAuthenticated);
  // Atomic selectors (Zustand v5 uses Object.is for equality, so returning
  // a fresh object from one selector would trigger an infinite re-render).
  const entityFilterIso = useFilterStore((s) => s.entityFilter?.iso || null);
  const dateWindow = useFilterStore((s) => s.dateWindow);
  const currentFilters = useMemo(
    () => ({ region: entityFilterIso, timeWindowHours: filtersWindowHours(dateWindow) }),
    [entityFilterIso, dateWindow],
  );

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messagesById, setMessagesById] = useState({});
  const [status, setStatus] = useState(STATUS.IDLE);
  const [error, setError] = useState(null);
  const [quota, setQuota] = useState(null);
  const cacheRef = useRef({});

  // Refresh conversation list when auth flips on.
  useEffect(() => {
    if (!isAuthenticated) {
      setConversations([]);
      setActiveId(null);
      setMessagesById({});
      cacheRef.current = {};
      return;
    }
    setStatus(STATUS.LOADING);
    listQaConversations()
      .then(({ conversations: list = [] }) => {
        setConversations(list);
        if (list[0]) setActiveId(list[0].id);
        setStatus(STATUS.IDLE);
      })
      .catch((err) => {
        setError(err);
        setStatus(STATUS.ERROR);
      });
  }, [isAuthenticated]);

  // Lazy-load messages when the active conversation changes.
  useEffect(() => {
    if (!isAuthenticated || !activeId) return;
    if (cacheRef.current[activeId]) {
      setMessagesById((prev) => ({ ...prev, [activeId]: cacheRef.current[activeId] }));
      return;
    }
    let cancelled = false;
    fetchQaMessages(activeId)
      .then(({ messages = [] }) => {
        if (cancelled) return;
        cacheRef.current[activeId] = messages;
        setMessagesById((prev) => ({ ...prev, [activeId]: messages }));
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => { cancelled = true; };
  }, [isAuthenticated, activeId]);

  const newConversation = useCallback(async ({ title = '', useCurrentFilters = false } = {}) => {
    setStatus(STATUS.LOADING);
    setError(null);
    try {
      const { conversation } = await createQaConversation({ title, useCurrentFilters });
      setConversations((prev) => [conversation, ...prev]);
      setActiveId(conversation.id);
      cacheRef.current[conversation.id] = [];
      setMessagesById((prev) => ({ ...prev, [conversation.id]: [] }));
      setStatus(STATUS.IDLE);
      return conversation;
    } catch (err) {
      setError(err);
      setStatus(STATUS.ERROR);
      throw err;
    }
  }, []);

  const selectConversation = useCallback((id) => {
    setActiveId(id);
    setError(null);
    setStatus(STATUS.IDLE);
  }, []);

  const archive = useCallback(async (id) => {
    try { await archiveQaConversation(id); }
    catch (err) { /* swallow — list refreshes next */ }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    delete cacheRef.current[id];
    setMessagesById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (activeId === id) setActiveId((prev) => {
      const remaining = conversations.filter((c) => c.id !== id);
      return remaining[0]?.id || null;
    });
  }, [activeId, conversations]);

  const send = useCallback(async (content) => {
    const cleanContent = String(content || '').trim();
    if (!cleanContent) return;

    let convoId = activeId;
    if (!convoId) {
      const created = await newConversation({ useCurrentFilters: false });
      convoId = created.id;
    }

    setStatus(STATUS.SENDING);
    setError(null);
    const tempUser = optimisticMessage(cleanContent);
    const currentList = cacheRef.current[convoId] || [];
    cacheRef.current[convoId] = [...currentList, tempUser];
    setMessagesById((prev) => ({ ...prev, [convoId]: cacheRef.current[convoId] }));

    const useCurrentFilters = Boolean(
      conversations.find((c) => c.id === convoId)?.useCurrentFilters,
    );

    try {
      const result = await sendQaMessage(convoId, {
        content: cleanContent,
        useCurrentFilters,
        filters: useCurrentFilters ? currentFilters : undefined,
      });
      const { userMessage, assistantMessage, quota: q } = result;
      const newList = (cacheRef.current[convoId] || [])
        .filter((m) => m.id !== tempUser.id)
        .concat([userMessage, assistantMessage].filter(Boolean));
      cacheRef.current[convoId] = newList;
      setMessagesById((prev) => ({ ...prev, [convoId]: newList }));
      if (q) setQuota(q);
      // Bump the conversation's lastMessageAt locally for ordering.
      setConversations((prev) => prev.map((c) => (
        c.id === convoId
          ? { ...c, lastMessageAt: Date.now(), messageCount: (c.messageCount || 0) + 2 }
          : c
      )));
      setStatus(STATUS.IDLE);
    } catch (err) {
      // Roll back the optimistic message.
      cacheRef.current[convoId] = (cacheRef.current[convoId] || []).filter((m) => m.id !== tempUser.id);
      setMessagesById((prev) => ({ ...prev, [convoId]: cacheRef.current[convoId] }));

      if (err?.status === 429 && err?.payload?.code === 'QUOTA_EXCEEDED') {
        setQuota(err.payload.quota || null);
        setStatus(STATUS.QUOTA_EXCEEDED);
        return;
      }
      if (err?.status === 503 && err?.payload?.code === 'AI_NOT_CONFIGURED') {
        setStatus(STATUS.NOT_CONFIGURED);
        setError(err);
        return;
      }
      setError(err);
      setStatus(STATUS.ERROR);
    }
  }, [activeId, conversations, currentFilters, newConversation]);

  const setUseCurrentFilters = useCallback((value) => {
    if (!activeId) return;
    setConversations((prev) => prev.map((c) => (
      c.id === activeId ? { ...c, useCurrentFilters: Boolean(value) } : c
    )));
  }, [activeId]);

  return {
    isAuthenticated,
    conversations,
    activeId,
    messages: activeId ? (messagesById[activeId] || []) : [],
    status,
    error,
    quota,
    newConversation,
    selectConversation,
    archive,
    send,
    setUseCurrentFilters,
    STATUS,
  };
}

function filtersWindowHours(dateWindow) {
  if (!dateWindow) return 168;
  if (typeof dateWindow === 'string') {
    const m = /^(\d+)([hd])$/i.exec(dateWindow);
    if (m) {
      const n = Number(m[1]);
      return m[2].toLowerCase() === 'd' ? n * 24 : n;
    }
  }
  return 168;
}
