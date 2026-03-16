import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getArticleTextPreview, normalizeArticleText } from '../utils/articleText';

const ExpandableText = ({
  text,
  collapsedLength = 220,
  className = '',
  textClassName = '',
  buttonClassName = ''
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const normalizedText = useMemo(() => normalizeArticleText(text), [text]);
  const preview = useMemo(
    () => getArticleTextPreview(normalizedText, collapsedLength),
    [collapsedLength, normalizedText]
  );

  useEffect(() => {
    setExpanded(false);
  }, [normalizedText, collapsedLength]);

  if (!normalizedText) {
    return null;
  }

  const resolvedText = expanded ? normalizedText : preview.text;
  const canExpand = preview.truncated;

  return (
    <div className={`expandable-text ${className}`.trim()}>
      <p className={`expandable-text-copy ${textClassName}`.trim()}>
        {resolvedText}
      </p>
      {canExpand && (
        <button
          type="button"
          className={`expandable-text-toggle ${buttonClassName}`.trim()}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
        >
          {expanded ? t('article.showLess') : t('article.readMore')}
        </button>
      )}
    </div>
  );
};

export default ExpandableText;
