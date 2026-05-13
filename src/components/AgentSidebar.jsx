import React, { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useUIStore from '../stores/uiStore';
import useAgent from '../hooks/useAgent';
import AgentSidebarHeader from './agent/AgentSidebarHeader.jsx';
import AgentMessageList from './agent/AgentMessageList.jsx';
import AgentComposer from './agent/AgentComposer.jsx';

export default function AgentSidebar() {
  const { t } = useTranslation();
  const isOpen = useUIStore((s) => s.agentSidebarOpen);
  const setOpen = useUIStore((s) => s.setAgentSidebarOpen);

  const agent = useAgent();
  const activeConversation = agent.conversations.find((c) => c.id === agent.activeId) || null;
  const useCurrentFilters = Boolean(activeConversation?.useCurrentFilters);

  // Escape closes; Cmd/Ctrl+K toggles open/close from anywhere.
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!isOpen);
        return;
      }
      if (isOpen && e.key === 'Escape') {
        // Don't swallow Escape when focus is in a text field that already
        // has its own Escape handling (e.g. search inputs in NewsPanel).
        const tag = (document.activeElement?.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          if (e.target?.dataset?.agentEscape !== 'allow') return;
        }
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, setOpen]);

  const handleSend = useCallback((text) => agent.send(text), [agent]);
  const handleToggleFilters = useCallback((v) => agent.setUseCurrentFilters(v), [agent]);

  // Render nothing when closed AFTER the global keydown effect above is
  // installed (it runs regardless of isOpen so Cmd+K opens the drawer
  // even when collapsed).
  if (!isOpen) return null;

  return (
    <>
      <div
        className="agent-backdrop"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <aside
        className="agent-sidebar"
        role="dialog"
        aria-modal="false"
        aria-label={t('agent.title')}
        data-testid="agent-sidebar"
      >
        <AgentSidebarHeader
          conversations={agent.conversations}
          activeConversation={activeConversation}
          onClose={() => setOpen(false)}
          onNewChat={() => agent.newConversation()}
          onSelectConversation={agent.selectConversation}
          onArchiveConversation={agent.archive}
        />

        {!agent.isAuthenticated ? (
          <div className="agent-empty">
            <div className="mono micro">{t('agent.signInRequiredTitle')}</div>
            <p>{t('agent.signInRequiredBody')}</p>
            <Link to="/account" className="btn primary" onClick={() => setOpen(false)}>
              {t('agent.signIn')}
            </Link>
          </div>
        ) : (
          <>
            <AgentMessageList
              messages={agent.messages}
              status={agent.status}
              error={agent.error}
            />
            <AgentComposer
              onSend={handleSend}
              disabled={agent.status === 'sending'}
              quotaExceeded={agent.status === agent.STATUS.QUOTA_EXCEEDED}
              notConfigured={agent.status === agent.STATUS.NOT_CONFIGURED}
              useCurrentFilters={useCurrentFilters}
              onToggleFilters={handleToggleFilters}
              quota={agent.quota}
            />
          </>
        )}
      </aside>
    </>
  );
}
