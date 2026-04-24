import { useState, useEffect } from 'react';

// Tablet-and-narrower breakpoint. Controls whether the header collapses its
// right-side button bank into an overflow menu (the same pattern useIsMobile
// triggers at 600px, but earlier so narrow laptops / tablets don't cram the
// header into a single unreadable row).
//
// 1100px catches most landscape tablets and narrow-laptop windows. Full
// desktop layout only shows above that.
var QUERY = '(max-width: 1100px)';

export default function useIsCompact() {
  var [isCompact, setIsCompact] = useState(function() {
    return window.matchMedia(QUERY).matches;
  });

  useEffect(function() {
    var mql = window.matchMedia(QUERY);
    function handler(e) { setIsCompact(e.matches); }
    mql.addEventListener('change', handler);
    return function() { mql.removeEventListener('change', handler); };
  }, []);

  return isCompact;
}
