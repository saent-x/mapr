/**
 * server/qa/conversations.js — InstantDB-backed chat persistence for the
 * AI Q&A sidebar.
 *
 * Conversations are owned by a user (via the userQaConversations link);
 * messages reference the conversation by id and are written exclusively
 * by the server (qaMessages has no client write perms — see
 * instant.perms.ts).
 */

import { id as instantId } from '@instantdb/admin';
import { getInstantDb } from '../auth.js';

const DEFAULT_TITLE = 'New conversation';
const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 8000;
const VALID_ROLES = new Set(['user', 'assistant']);

function now() { return Date.now(); }

function trimTitle(raw) {
  const cleaned = String(raw || '').trim().slice(0, MAX_TITLE_LENGTH);
  return cleaned || DEFAULT_TITLE;
}

// NOTE on $users links: the InstantDB admin SDK silently no-ops
// `db.tx.qaConversations[id].link({ owner: userId })` when the linked
// namespace is `$users`, and the inverse `'owner.id': user.id` filter
// can't traverse into `$users` from the qaConversations side. We must
// (1) write the link from the `$users` side and (2) read via the
// reverse `$users.qaConversations` traversal for the link to be honored.

/**
 * Create a new conversation linked to the user. Returns the persisted row.
 */
export async function createConversation({ user, title, useCurrentFilters = false }) {
  if (!user?.id) throw Object.assign(new Error('user required'), { statusCode: 401 });
  const db = getInstantDb();
  const conversationId = instantId();
  const ts = now();
  const rec = {
    title: trimTitle(title),
    createdAt: ts,
    updatedAt: ts,
    archived: false,
    lastMessageAt: ts,
    messageCount: 0,
    useCurrentFilters: Boolean(useCurrentFilters),
  };
  await db.transact([
    db.tx.qaConversations[conversationId].update(rec),
    db.tx.$users[user.id].link({ qaConversations: conversationId }),
  ]);
  return { id: conversationId, ...rec };
}

/**
 * List the user's conversations, newest first.
 * Includes the archived ones only when `archived: true` is passed.
 */
export async function listConversations({ user, archived = false, limit = 50 } = {}) {
  if (!user?.id) throw Object.assign(new Error('user required'), { statusCode: 401 });
  const db = getInstantDb();
  const result = await db.query({
    $users: {
      qaConversations: {
        $: { where: { archived: Boolean(archived) } },
      },
      $: { where: { id: user.id } },
    },
  });
  const rows = result?.$users?.[0]?.qaConversations || [];
  return rows
    .slice()
    .sort((a, b) => (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0))
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastMessageAt: row.lastMessageAt || null,
      messageCount: row.messageCount || 0,
      useCurrentFilters: Boolean(row.useCurrentFilters),
      archived: Boolean(row.archived),
    }));
}

/**
 * Fetch a single conversation by id and verify it belongs to the user.
 */
export async function getConversation({ user, conversationId }) {
  if (!user?.id) throw Object.assign(new Error('user required'), { statusCode: 401 });
  if (!conversationId) throw Object.assign(new Error('conversationId required'), { statusCode: 400 });
  const db = getInstantDb();
  const result = await db.query({
    $users: {
      qaConversations: { $: { where: { id: conversationId } } },
      $: { where: { id: user.id } },
    },
  });
  const row = result?.$users?.[0]?.qaConversations?.[0];
  if (!row) throw Object.assign(new Error('conversation not found'), { statusCode: 404 });
  return row;
}

/**
 * Append a message to a conversation. Bumps lastMessageAt + messageCount
 * on the parent conversation in the same transaction.
 */
export async function appendMessage({
  user, conversationId, role, content, citations = null,
  modelUsed = null, tokensIn = null, tokensOut = null,
}) {
  if (!VALID_ROLES.has(role)) {
    throw Object.assign(new Error(`invalid role ${role}`), { statusCode: 400 });
  }
  const cleanContent = String(content || '').slice(0, MAX_CONTENT_LENGTH);
  if (!cleanContent) {
    throw Object.assign(new Error('content required'), { statusCode: 400 });
  }
  // Ownership check.
  const parent = await getConversation({ user, conversationId });

  const db = getInstantDb();
  const messageId = instantId();
  const ts = now();
  const messageRec = {
    conversationId,
    role,
    content: cleanContent,
    createdAt: ts,
  };
  if (citations) messageRec.citations = citations;
  if (modelUsed) messageRec.modelUsed = modelUsed;
  if (tokensIn != null) messageRec.tokensIn = tokensIn;
  if (tokensOut != null) messageRec.tokensOut = tokensOut;

  await db.transact([
    db.tx.qaMessages[messageId].update(messageRec),
    db.tx.qaConversations[conversationId].update({
      lastMessageAt: ts,
      messageCount: (parent.messageCount || 0) + 1,
      updatedAt: ts,
    }),
  ]);
  return { id: messageId, ...messageRec };
}

/**
 * Read the messages of a conversation, ascending by createdAt.
 */
export async function readMessages({ user, conversationId, limit = 100 }) {
  await getConversation({ user, conversationId });
  const db = getInstantDb();
  const result = await db.query({
    qaMessages: {
      $: { where: { conversationId }, limit },
    },
  });
  const rows = result?.qaMessages || [];
  return rows
    .slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      role: row.role,
      content: row.content,
      citations: row.citations || null,
      modelUsed: row.modelUsed || null,
      createdAt: row.createdAt,
    }));
}

/**
 * Archive a conversation (soft delete). Returns true when a row was
 * updated, false otherwise.
 */
export async function archiveConversation({ user, conversationId }) {
  try { await getConversation({ user, conversationId }); }
  catch (err) {
    if (err?.statusCode === 404) return false;
    throw err;
  }
  const db = getInstantDb();
  await db.transact(
    db.tx.qaConversations[conversationId].update({
      archived: true,
      updatedAt: now(),
    }),
  );
  return true;
}

/**
 * Update the conversation title — called after the title-generation
 * background job decides on something better than "New conversation".
 */
export async function setConversationTitle({ user, conversationId, title }) {
  await getConversation({ user, conversationId });
  const db = getInstantDb();
  await db.transact(
    db.tx.qaConversations[conversationId].update({
      title: trimTitle(title),
      updatedAt: now(),
    }),
  );
}

/**
 * Toggle the "Use current page filters" sticky setting for a conversation.
 */
export async function setConversationUseFilters({ user, conversationId, value }) {
  await getConversation({ user, conversationId });
  const db = getInstantDb();
  await db.transact(
    db.tx.qaConversations[conversationId].update({
      useCurrentFilters: Boolean(value),
      updatedAt: now(),
    }),
  );
}

/**
 * Count the user's user-role messages in the trailing `days` days.
 * Used for quota enforcement before each LLM call.
 */
export async function userMessageCountInLastDays({ user, days = 30 }) {
  if (!user?.id) throw Object.assign(new Error('user required'), { statusCode: 401 });
  const db = getInstantDb();
  const cutoff = now() - days * 24 * 3600 * 1000;
  // Pull the user's conversations (via $users reverse traversal — see the
  // top-of-file note on why forward `'owner.id'` filters don't work) plus
  // user-role messages, then apply the time + ownership cutoff locally.
  // The createdAt cutoff is intentionally local rather than a server-side
  // `$gte` filter: that operator requires `qaMessages.createdAt` to be
  // indexed in the live DB, which isn't guaranteed in every environment,
  // and the per-user dataset is tiny (capped by the quota itself).
  const result = await db.query({
    $users: {
      qaConversations: {},
      $: { where: { id: user.id } },
    },
    qaMessages: {
      $: { where: { role: 'user' } },
    },
  });
  const ownedIds = new Set((result?.$users?.[0]?.qaConversations || []).map((c) => c.id));
  return (result?.qaMessages || []).filter(
    (m) => ownedIds.has(m.conversationId) && (m.createdAt || 0) >= cutoff,
  ).length;
}

export const __test__ = { trimTitle, MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH, DEFAULT_TITLE };
