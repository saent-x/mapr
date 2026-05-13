import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, MessageSquarePlus, Trash2, X } from 'lucide-react';

function shortTitle(t, conversation) {
  return conversation?.title || t('agent.untitled');
}

export default function AgentSidebarHeader({
  conversations,
  activeConversation,
  onClose,
  onNewChat,
  onSelectConversation,
  onArchiveConversation,
}) {
  const { t } = useTranslation();
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <header className="agent-sidebar-header">
      <button
        type="button"
        className="agent-history-toggle"
        onClick={() => setHistoryOpen((v) => !v)}
        aria-expanded={historyOpen}
        aria-label={t('agent.historyHeader')}
        data-testid="agent-history-toggle"
      >
        <span className="agent-sidebar-title">{shortTitle(t, activeConversation)}</span>
        <ChevronDown size={11} aria-hidden style={{ transform: historyOpen ? 'rotate(180deg)' : 'none' }} />
      </button>
      <div className="agent-sidebar-header-actions">
        <button
          type="button"
          className="agent-icon-btn"
          onClick={onNewChat}
          aria-label={t('agent.newChat')}
          title={t('agent.newChat')}
          data-testid="agent-new-chat"
        >
          <MessageSquarePlus size={13} aria-hidden />
        </button>
        <button
          type="button"
          className="agent-icon-btn"
          onClick={onClose}
          aria-label={t('common.close', 'Close')}
          title={t('common.close', 'Close')}
          data-testid="agent-close"
        >
          <X size={13} aria-hidden />
        </button>
      </div>

      {historyOpen && (
        <ul className="agent-history-list" role="listbox" data-testid="agent-history-list">
          {conversations.length === 0 && (
            <li className="agent-history-empty">{t('agent.noConversations')}</li>
          )}
          {conversations.map((c) => {
            const isActive = activeConversation?.id === c.id;
            return (
              <li key={c.id} className={`agent-history-item${isActive ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className="agent-history-item-main"
                  onClick={() => { onSelectConversation(c.id); setHistoryOpen(false); }}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="agent-history-item-title">{c.title || t('agent.untitled')}</span>
                  <span className="agent-history-item-meta mono micro">
                    {(c.messageCount || 0)} msgs
                  </span>
                </button>
                <button
                  type="button"
                  className="agent-icon-btn agent-history-item-archive"
                  onClick={() => onArchiveConversation(c.id)}
                  aria-label={t('agent.archiveConversation')}
                  title={t('agent.archiveConversation')}
                >
                  <Trash2 size={10} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </header>
  );
}
