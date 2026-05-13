import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SignedIn, SignedOut } from './auth';
import useBookmarks from '../hooks/useBookmarks';

/**
 * BookmarkButton — toggle bookmark on a news item.
 * Shows filled icon when bookmarked, outline when not.
 * Unauthenticated users are navigated to /login with a returnUrl.
 */
export default function BookmarkButton({ story, className = '' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isBookmarked, toggleBookmark, needsAuth } = useBookmarks();
  const bookmarked = isBookmarked(story?.id);

  const handleToggle = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!story) return;
    try {
      await toggleBookmark(story);
    } catch {
      // silently ignore — the InstantDB query will auto-update
    }
  };

  return (
    <>
      <SignedIn>
        <button
          type="button"
          className={`bookmark-btn${bookmarked ? ' is-bookmarked' : ''}${className ? ` ${className}` : ''}`}
          onClick={handleToggle}
          aria-label={bookmarked ? 'Unbookmark story' : 'Bookmark story'}
          title={bookmarked ? 'Unbookmark' : 'Bookmark'}
          data-bookmarked={bookmarked || undefined}
        >
          <Bookmark size={14} fill={bookmarked ? 'currentColor' : 'none'} aria-hidden />
        </button>
      </SignedIn>
      <SignedOut>
        <button
          type="button"
          className={`bookmark-btn${className ? ` ${className}` : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const returnUrl = encodeURIComponent(location.pathname + location.search);
            navigate(`/login?returnUrl=${returnUrl}`);
          }}
          aria-label={t('bookmarks.signInToBookmark')}
          title={t('bookmarks.signInToBookmark')}
        >
          <Bookmark size={14} fill="none" aria-hidden />
        </button>
      </SignedOut>
    </>
  );
}
