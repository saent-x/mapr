import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';

export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="not-found-page" role="main" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      gap: 16,
      padding: 32,
      textAlign: 'center',
    }}>
      <Compass size={32} aria-hidden style={{ color: 'var(--ink-2)' }} />
      <h1 style={{ fontSize: 'var(--fs-3)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
        {t('notFound.title', '404 — NO SIGNAL')}
      </h1>
      <p style={{ color: 'var(--ink-2)', maxWidth: 420 }}>
        {t('notFound.description', 'This route does not exist or has been moved.')}
      </p>
      <Link to="/" className="btn-primary">
        {t('notFound.returnHome', 'Return to dashboard')}
      </Link>
    </div>
  );
}
