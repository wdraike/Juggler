import { useEffect } from 'react';

// Mirrors the resume-optimizer tab-title model (RO src/hooks/useDocumentTitle.js)
// for cross-app consistency (999.103). RO brand = ClimbRS; juggler brand = StriveRS.
const BRAND_SUFFIX = 'StriveRS';
const BRAND_SUFFIX_FULL = 'StriveRS by Raike & Sons';
const HOME_TITLE = `${BRAND_SUFFIX_FULL} — AI Task Manager`;

/**
 * Sets the document (browser tab) title for the current view, in the same
 * format every Raike & Sons app uses:
 *   App views:       "View — StriveRS"
 *   Marketing pages: "Page — StriveRS by Raike & Sons"
 *   Home / no title: "StriveRS by Raike & Sons — AI Task Manager"
 *
 * @param {string} title - the view/page-specific portion (e.g. "Day", "Week")
 * @param {object} [options]
 * @param {boolean} [options.marketing] - use the full brand suffix
 * @param {boolean} [options.exact] - set the title verbatim, no suffix
 */
export default function useDocumentTitle(title, { marketing = false, exact = false } = {}) {
  useEffect(() => {
    if (exact) {
      document.title = title;
    } else if (title) {
      document.title = `${title} — ${marketing ? BRAND_SUFFIX_FULL : BRAND_SUFFIX}`;
    } else {
      document.title = HOME_TITLE;
    }
    return () => {
      document.title = HOME_TITLE;
    };
  }, [title, marketing, exact]);
}
