/**
 * useCalSyncState — extracts all calendar-sync state + effects from AppLayout.
 *
 * Owns: provider auto-sync flags, last-synced timestamps, syncing spinners,
 * calSyncProgress (SSE), schedulerRunning/Ready, and the single-flight
 * schedule-run kick. Mount effects: OAuth redirect toasts, provider status
 * fetch, auto-sync polling, SSE listeners for sync:progress / schedule:running.
 *
 * @param {Function} showToast   toast function from useToast
 * @param {Function} loadPlacements  reload placements after a schedule run
 * @param {Object}   config           useConfig result (calSyncSettings, etc.)
 * @param {React.RefObject} editingRef  ref to {current: boolean} — suspends
 *        background syncs while editing UI is open
 * @returns {Object} all state + the kickScheduleRun function
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../services/apiClient';

export default function useCalSyncState(showToast, loadPlacements, config, editingRef) {
  // ── Schedule-run single-flight (999.1242) ──
  var scheduleRunInFlightRef = useRef(false);
  var [schedulerReady, setSchedulerReady] = useState(false);
  var [schedulerRunning, setSchedulerRunning] = useState(false);

  var kickScheduleRun = useCallback(function kick(isRetry) {
    if (scheduleRunInFlightRef.current) return Promise.resolve(null); // single-flight
    scheduleRunInFlightRef.current = true;
    return apiClient.post('/schedule/run').then(function(res) {
      scheduleRunInFlightRef.current = false;
      if (res.data?.dayPlacements) {
        loadPlacements();
      }
      return res;
    }).catch(function(err) {
      scheduleRunInFlightRef.current = false;
      var status = err && err.response && err.response.status;
      if (status === 409 && !isRetry) {
        var retryAfterSec = (err.response.data && err.response.data.retryAfter) || 30;
        setTimeout(function() { kick(true); }, retryAfterSec * 1000);
      } else {
        showToast('Schedule refresh failed — showing the last saved schedule', 'error');
      }
      return null;
    });
  }, [loadPlacements, showToast]);

  // ── Provider sync state ──
  var [gcalAutoSync, setGcalAutoSync] = useState(false);
  var [gcalLastSyncedAt, setGcalLastSyncedAt] = useState(null);
  var [gcalSyncing, setGcalSyncing] = useState(false);
  var [msftCalAutoSync, setMsftCalAutoSync] = useState(false);
  var [msftCalLastSyncedAt, setMsftCalLastSyncedAt] = useState(null);
  var [msftCalSyncing, setMsftCalSyncing] = useState(false);
  var [appleCalAutoSync, setAppleCalAutoSync] = useState(false);
  var [appleCalLastSyncedAt, setAppleCalLastSyncedAt] = useState(null);
  var [appleCalSyncing, setAppleCalSyncing] = useState(false);
  var [appleCalConnected, setAppleCalConnected] = useState(null);
  var [calSyncProgress, setCalSyncProgress] = useState(null); // { phase, detail, pct, provider, calendar }

  // ── Kick schedule run after first weather refresh ──
  var weatherRefreshedRef = useRef(false);
  function setWeatherRefreshedAndKick(refreshed) {
    if (!refreshed) return;
    if (weatherRefreshedRef.current) return;
    weatherRefreshedRef.current = true;
    kickScheduleRun();
  }
  // The parent passes weatherRefreshed; we watch it via an effect.
  // (Kept as a method so the parent can call it directly if preferred.)

  // ── OAuth redirect toasts (gcal=connected / msftcal=connected) ──
  useEffect(function() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('gcal') === 'connected') {
      showToast('Google Calendar connected!', 'success');
      params.delete('gcal');
      var newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl);
      if (window.opener) {
        window.opener.postMessage('gcal-connected', '*');
        window.close();
      }
    }
    if (params.get('msftcal') === 'connected') {
      showToast('Microsoft Calendar connected!', 'success');
      params.delete('msftcal');
      var newUrl2 = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl2);
      if (window.opener) {
        window.opener.postMessage('msftcal-connected', '*');
        window.close();
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch GCal + MsftCal + AppleCal status on mount ──
  useEffect(function() {
    apiClient.get('/gcal/status')
      .then(function(r) {
        setGcalAutoSync(!!r.data.autoSync);
        setGcalLastSyncedAt(r.data.lastSyncedAt || null);
        if (r.data.tokenExpired) {
          showToast('Google Calendar connection expired. Please reconnect in Calendar Sync settings.', 'error');
        }
      })
      .catch(function() { /* not connected */ });
    apiClient.get('/msft-cal/status')
      .then(function(r) {
        setMsftCalAutoSync(!!r.data.autoSync);
        setMsftCalLastSyncedAt(r.data.lastSyncedAt || null);
        if (r.data.tokenExpired) {
          showToast('Microsoft Calendar connection expired. Please reconnect in Calendar Sync settings.', 'error');
        }
      })
      .catch(function() { /* not connected */ });
    apiClient.get('/apple-cal/status')
      .then(function(r) {
        setAppleCalConnected(!!r.data.connected);
        setAppleCalAutoSync(!!r.data.autoSync);
        setAppleCalLastSyncedAt(r.data.lastSyncedAt || null);
      })
      .catch(function() { setAppleCalConnected(false); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Combined calendar auto-sync polling ──
  // Waits for initial scheduler run to complete before starting any external syncs.
  var gcalFreq = ((config.calSyncSettings || {}).gcal || {}).frequency || 0;
  var msftFreq = ((config.calSyncSettings || {}).msft || {}).frequency || 0;
  var appleFreq = ((config.calSyncSettings || {}).apple || {}).frequency || 0;
  useEffect(function() {
    var gcalAuto = gcalAutoSync || gcalFreq > 0;
    var msftAuto = msftCalAutoSync || msftFreq > 0;
    var appleAuto = appleCalAutoSync || appleFreq > 0;
    if (!gcalAuto && !msftAuto && !appleAuto) return;
    if (!schedulerReady) return;

    function runFullSync() {
      setGcalSyncing(true);
      setMsftCalSyncing(true);
      setAppleCalSyncing(true);
      apiClient.post('/cal/sync?trigger=auto').then(function(r) {
        var errors = r.data.errors || [];
        var hasTokenExpiry = errors.some(function(e) { return e.tokenExpired; });
        var nonTokenErrors = errors.filter(function(e) { return !e.tokenExpired; });

        if (hasTokenExpiry) {
          showToast('Calendar connection expired. Please reconnect in Calendar Sync settings.', 'error');
        } else if (nonTokenErrors.length > 0) {
          showToast('Calendar sync completed with ' + nonTokenErrors.length + ' error(s). Open Calendar Sync for details.', 'error');
        }

        // Only update last-synced timestamp if there were no errors
        if (errors.length === 0) {
          var now = new Date().toISOString();
          if (gcalAutoSync) setGcalLastSyncedAt(now);
          if (msftCalAutoSync) setMsftCalLastSyncedAt(now);
          if (appleCalAutoSync) setAppleCalLastSyncedAt(now);
        }
        // Intentionally no loadTasks() here: the backend emits
        // tasks:changed / schedule:changed over SSE when cal-sync touches
        // rows, and the surgical handlers in useTaskState apply the
        // deltas without re-dispatching INIT. The old full refresh here
        // was legacy from before the SSE pipeline existed.
      }).catch(function(e) {
        if (e.response?.status === 409) {
          // Lock held — skip silently, the interval will retry later
          return;
        }
        var hasTokenExpiry = e.response?.data?.errors?.some(function(err) { return err.tokenExpired; });
        if (hasTokenExpiry) {
          showToast('Calendar connection expired. Please reconnect in Calendar Sync settings.', 'error');
        } else {
          var msg = e.response?.data?.error || e.message;
          showToast('Calendar sync failed: ' + (msg || 'unknown error'), 'error');
        }
      }).finally(function() {
        setGcalSyncing(false);
        setMsftCalSyncing(false);
        setAppleCalSyncing(false);
      });
    }

    function checkAndSync() {
      if (editingRef.current) return;

      // Lightweight check first — only full sync if something changed
      apiClient.get('/cal/has-changes').then(function(r) {
        if (r.data.hasChanges) {
          runFullSync();
        }
      }).catch(function() {
        // If the check fails, fall back to a full sync
        runFullSync();
      });
    }

    // Initial sync on load (full sync to catch up)
    var initialTimer = setTimeout(runFullSync, 5000);
    // Use the shortest active provider frequency for the poll interval
    var activeFreqs = [];
    if (gcalAuto && gcalFreq > 0) activeFreqs.push(gcalFreq);
    if (msftAuto && msftFreq > 0) activeFreqs.push(msftFreq);
    if (appleAuto && appleFreq > 0) activeFreqs.push(appleFreq);
    var intervalMs = activeFreqs.length > 0 ? Math.min.apply(null, activeFreqs) * 1000 : 2 * 60 * 1000;
    var intervalId = setInterval(checkAndSync, intervalMs);

    return function() {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [gcalAutoSync, msftCalAutoSync, appleCalAutoSync, schedulerReady, gcalFreq, msftFreq, appleFreq]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Listen for sync:progress SSE events ──
  useEffect(function() {
    var attached = null;
    function handleSyncProgress(e) {
      try {
        var data = JSON.parse(e.data);
        setCalSyncProgress(data);
        // Toast on fetch completion (shows event count per provider)
        if (data.phase === 'fetch' && data.detail && data.detail.indexOf('Fetched') >= 0) {
          var fetchLabel = data.provider === 'gcal' ? 'Google' : data.provider === 'msft' ? 'Microsoft' : data.provider === 'apple' ? 'Apple' : 'Calendar';
          showToast(fetchLabel + ': ' + data.detail, 'info');
        }
        // Toast on completion with summary
        if (data.phase === 'done') {
          showToast(data.detail || 'Sync complete', 'success');
          setTimeout(function() { setCalSyncProgress(null); }, 2000);
        }
      } catch (err) { /* ignore */ }
    }
    // Poll until the event source appears (created asynchronously by useTaskState)
    var poll = setInterval(function() {
      var es = window.__jugglerEventSource;
      if (es && !attached) {
        attached = es;
        es.addEventListener('sync:progress', handleSyncProgress);
        clearInterval(poll);
      }
    }, 500);
    // Also check immediately
    var es = window.__jugglerEventSource;
    if (es) {
      attached = es;
      es.addEventListener('sync:progress', handleSyncProgress);
      clearInterval(poll);
    }
    return function() {
      clearInterval(poll);
      if (attached) attached.removeEventListener('sync:progress', handleSyncProgress);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Listen for schedule:running / schedule:changed SSE events ──
  useEffect(function() {
    var attached = null;
    function handleRunning() { setSchedulerRunning(true); }
    function handleChanged() { setSchedulerRunning(false); }
    function attach(es) {
      es.addEventListener('schedule:running', handleRunning);
      es.addEventListener('schedule:changed', handleChanged);
    }
    var poll = setInterval(function() {
      var es = window.__jugglerEventSource;
      if (es && !attached) {
        attached = es;
        attach(es);
        clearInterval(poll);
      }
    }, 500);
    var es = window.__jugglerEventSource;
    if (es) { attached = es; attach(es); clearInterval(poll); }
    return function() {
      clearInterval(poll);
      if (attached) {
        attached.removeEventListener('schedule:running', handleRunning);
        attached.removeEventListener('schedule:changed', handleChanged);
      }
    };
  }, []);

  return {
    // schedule run
    kickScheduleRun,
    schedulerReady,
    setSchedulerReady,
    schedulerRunning,
    // gcal
    gcalAutoSync, setGcalAutoSync,
    gcalLastSyncedAt, setGcalLastSyncedAt,
    gcalSyncing, setGcalSyncing,
    // msft
    msftCalAutoSync, setMsftCalAutoSync,
    msftCalLastSyncedAt, setMsftCalLastSyncedAt,
    msftCalSyncing, setMsftCalSyncing,
    // apple
    appleCalAutoSync, setAppleCalAutoSync,
    appleCalLastSyncedAt, setAppleCalLastSyncedAt,
    appleCalSyncing, setAppleCalSyncing,
    appleCalConnected, setAppleCalConnected,
    // progress
    calSyncProgress, setCalSyncProgress,
    // weather-kick helper
    setWeatherRefreshedAndKick,
  };
}