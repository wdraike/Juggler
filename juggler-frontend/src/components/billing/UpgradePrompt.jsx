/**
 * UpgradePrompt — shown when a user hits a plan limit or needs a subscription.
 * Listens for 'subscription:required' and 'plan:limit-reached' events.
 */

import React, { useState, useEffect } from 'react';
import { getTheme } from '../../theme/colors';
import apiClient from '../../services/apiClient';

var BILLING_URL = process.env.REACT_APP_BILLING_URL || 'http://localhost:3003';

var LIMIT_MESSAGES = {
  'limits.active_tasks': { title: 'Task Limit Reached', desc: 'You\'ve reached the maximum number of active tasks on your plan.' },
  'limits.habit_templates': { title: 'Habit Limit Reached', desc: 'You\'ve reached the maximum number of recurring habits on your plan.' },
  'limits.projects': { title: 'Project Limit Reached', desc: 'You\'ve reached the maximum number of projects on your plan.' },
  'limits.locations': { title: 'Location Limit Reached', desc: 'You\'ve reached the maximum number of locations on your plan.' },
  'limits.schedule_templates': { title: 'Schedule Template Limit', desc: 'You\'ve reached the maximum number of schedule templates on your plan.' },
  'ai_commands_per_month': { title: 'AI Commands Used Up', desc: 'You\'ve used all your AI commands for this month.' },
  'data.export': { title: 'Export Not Available', desc: 'Data export is available on Pro and Premium plans.' },
  'data.mcp_access': { title: 'MCP Access Not Available', desc: 'MCP integration is available on Pro and Premium plans.' },
  'scheduling.dependencies': { title: 'Dependencies Not Available', desc: 'Task dependencies are available on Pro and Premium plans.' },
  'scheduling.travel_time': { title: 'Travel Time Not Available', desc: 'Travel time buffers are available on Pro and Premium plans.' },
  'calendar.auto_sync': { title: 'Auto Sync Not Available', desc: 'Automatic calendar sync is available on Pro and Premium plans.' },
  'ai.natural_language_commands': { title: 'AI Commands Not Available', desc: 'AI commands are available on paid plans.' },
  'ai.bulk_project_creation': { title: 'Bulk Project Creation', desc: 'AI bulk project creation is available on the Premium plan.' }
};

export default function UpgradePrompt({ darkMode }) {
  var [show, setShow] = useState(false);
  var [detail, setDetail] = useState(null);
  var theme = getTheme(darkMode);

  useEffect(function() {
    function handleRequired(e) {
      setDetail({ type: 'subscription', product: e.detail?.product || 'juggler' });
      setShow(true);
    }
    function handleLimit(e) {
      setDetail({ type: 'limit', ...e.detail });
      setShow(true);
    }
    window.addEventListener('subscription:required', handleRequired);
    window.addEventListener('plan:limit-reached', handleLimit);

    // Proactive check on mount — gate if no subscription
    apiClient.get('/my-plan').catch(function(err) {
      if (err.response?.status === 402) {
        setDetail({ type: 'subscription', product: 'juggler' });
        setShow(true);
      }
    });

    return function() {
      window.removeEventListener('subscription:required', handleRequired);
      window.removeEventListener('plan:limit-reached', handleLimit);
    };
  }, []);

  if (!show || !detail) return null;

  var title = 'Upgrade Your Plan';
  var desc = 'Upgrade to unlock more features and higher limits.';
  var extra = null;

  if (detail.type === 'subscription') {
    title = 'Subscription Required';
    desc = 'You need an active subscription to use StriveRS. Start with a free trial to get full access.';
  }

  if (detail.type === 'limit') {
    var key = detail.limit_key || detail.feature || '';
    var msg = LIMIT_MESSAGES[key];
    if (msg) {
      title = msg.title;
      desc = msg.desc;
    }
    if (detail.current_count !== undefined && detail.limit !== undefined) {
      extra = 'Currently using ' + detail.current_count + ' of ' + detail.limit + '.';
    }
    if (detail.resets_at) {
      var resetDate = new Date(detail.resets_at);
      extra = (extra ? extra + ' ' : '') + 'Resets ' + resetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '.';
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }} onClick={function() { if (detail?.type !== 'subscription') setShow(false); }}>
      <div style={{
        background: theme.bgSecondary, borderRadius: 12, padding: 32,
        maxWidth: 420, width: '90%', textAlign: 'center',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
      }} onClick={function(e) { e.stopPropagation(); }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>
          {detail.type === 'limit' && detail.code === 'USAGE_LIMIT_REACHED' ? '\u23F0' : '\u26A1'}
        </div>
        <h2 style={{ color: theme.text, margin: '0 0 8px', fontSize: 20, fontFamily: "'Playfair Display', serif" }}>
          {title}
        </h2>
        <p style={{ color: theme.textMuted, margin: '0 0 8px', fontSize: 14, lineHeight: 1.5 }}>
          {desc}
        </p>
        {extra && (
          <p style={{ color: theme.accent, margin: '0 0 20px', fontSize: 13, fontWeight: 600 }}>
            {extra}
          </p>
        )}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
          <button
            onClick={function() { window.open(BILLING_URL + '/plans?product=juggler', '_blank'); setShow(false); }}
            style={{
              padding: '10px 24px', borderRadius: 6, border: 'none',
              background: theme.accent, color: '#fff', fontSize: 14,
              fontWeight: 600, cursor: 'pointer'
            }}
          >
            View Plans
          </button>
          {detail.type !== 'subscription' && (
            <button
              onClick={function() { setShow(false); }}
              style={{
                padding: '10px 24px', borderRadius: 6,
                border: '1px solid ' + theme.border, background: 'transparent',
                color: theme.textMuted, fontSize: 14, cursor: 'pointer'
              }}
            >
              Not Now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
