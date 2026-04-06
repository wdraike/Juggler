/**
 * usePlanInfo — fetches plan name, features, and usage from /api/my-plan.
 * Refreshes on mount and when plan:limit-reached fires (to update counts).
 */

import { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';

const LABELS = {
  'limits.active_tasks': 'Tasks',
  'limits.recurring_templates': 'Recurrings',
  'limits.projects': 'Projects',
  'limits.locations': 'Locations',
  'limits.schedule_templates': 'Schedule Templates',
  'limits.ai_commands_per_month': 'AI Commands',
  'calendar.max_providers': 'Calendar Providers'
};

export default function usePlanInfo() {
  var [planName, setPlanName] = useState('');
  var [features, setFeatures] = useState(null);
  var [usage, setUsage] = useState({});
  var [loading, setLoading] = useState(true);
  var [hasSubscription, setHasSubscription] = useState(false);
  var [disabledItems, setDisabledItems] = useState(0);

  var [trialInfo, setTrialInfo] = useState(null);

  var load = useCallback(function() {
    apiClient.get('/my-plan').then(function(res) {
      setPlanName(res.data.plan_name || res.data.plan_id || 'Free');
      setFeatures(res.data.features);
      setUsage(res.data.usage || {});
      setDisabledItems(res.data.disabled_items || 0);
      setHasSubscription(true);
      if (res.data.trial_end && res.data.subscription_status === 'trialing') {
        var trialEnd = new Date(res.data.trial_end);
        var daysLeft = Math.max(0, Math.round((trialEnd - new Date()) / (1000 * 60 * 60 * 24)));
        setTrialInfo({ daysLeft: daysLeft, endsAt: res.data.trial_end });
      } else {
        setTrialInfo(null);
      }
      setLoading(false);
    }).catch(function(err) {
      if (err.response?.status === 402) {
        var errorData = err.response?.data || {};
        window.dispatchEvent(new CustomEvent('subscription:required', {
          detail: {
            plans_url: errorData.plans_url,
            message: errorData.message,
          }
        }));
      }
      setLoading(false);
    });
  }, []);

  useEffect(function() {
    load();
    // Refresh after a limit is hit (counts may have changed)
    function onLimitHit() { setTimeout(load, 1000); }
    window.addEventListener('plan:limit-reached', onLimitHit);
    // Refresh every 5 minutes
    var interval = setInterval(load, 5 * 60 * 1000);
    return function() {
      window.removeEventListener('plan:limit-reached', onLimitHit);
      clearInterval(interval);
    };
  }, [load]);

  // Build a structured usage summary
  var usageSummary = [];
  Object.keys(usage).forEach(function(key) {
    var u = usage[key];
    usageSummary.push({
      key: key,
      label: LABELS[key] || key.split('.').pop().replace(/_/g, ' '),
      used: u.used,
      limit: u.limit,
      unlimited: u.unlimited,
      resets_at: u.resets_at,
      pct: u.unlimited ? 0 : (u.limit > 0 ? Math.round((u.used / u.limit) * 100) : 0),
      nearLimit: !u.unlimited && u.limit > 0 && u.used >= u.limit * 0.8,
      atLimit: !u.unlimited && u.limit > 0 && u.used >= u.limit
    });
  });

  return { planName, features, usage, usageSummary, trialInfo, loading, hasSubscription, disabledItems, refresh: load };
}
