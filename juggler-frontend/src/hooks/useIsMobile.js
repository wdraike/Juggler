import { useState, useEffect } from 'react';

var QUERY = '(max-width: 600px)';

export default function useIsMobile() {
  var [isMobile, setIsMobile] = useState(function() {
    return window.matchMedia(QUERY).matches;
  });

  useEffect(function() {
    var mql = window.matchMedia(QUERY);
    function handler(e) { setIsMobile(e.matches); }
    mql.addEventListener('change', handler);
    return function() { mql.removeEventListener('change', handler); };
  }, []);

  return isMobile;
}
