import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Bookmark } from 'lucide-react';

const SaveViewDialog = ({ onSave, onClose }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim());
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="save-view-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="save-view-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('savedViews.saveDialogTitle')}>
        <div className="save-view-header">
          <Bookmark size={14} />
          <span className="save-view-title">{t('savedViews.saveDialogTitle')}</span>
          <button className="save-view-close" onClick={onClose} aria-label={t('panel.closePanel')}>
            <X size={14} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="save-view-form">
          <label className="save-view-label" htmlFor="view-name-input">
            {t('savedViews.nameLabel')}
          </label>
          <input
            ref={inputRef}
            id="view-name-input"
            type="text"
            className="save-view-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('savedViews.namePlaceholder')}
            maxLength={60}
            autoComplete="off"
          />
          <div className="save-view-hint">{t('savedViews.hint')}</div>
          <div className="save-view-actions">
            <button type="button" className="save-view-cancel" onClick={onClose}>
              {t('savedViews.cancel')}
            </button>
            <button type="submit" className="save-view-confirm" disabled={!name.trim()}>
              {t('savedViews.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SaveViewDialog;
