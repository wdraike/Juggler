/**
 * PlanUsagePanel — shows current plan, usage stats, and upgrade link.
 * Rendered as a dropdown from the header billing button.
 */

import React from 'react';

import { services } from '../../proxy-config';
var BILLING_URL = services.billing.frontend;

function UsageBar({ item, theme }) {
  var pct = item.pct;
  var barColor = item.atLimit ? '#C62828' : item.nearLimit ? '#E65100' : theme.accent;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: theme.text, fontWeight: 500 }}>{item.label}</span>
        <span style={{ color: item.atLimit ? '#C62828' : theme.textMuted, fontWeight: item.atLimit ? 600 : 400 }}>
          {item.unlimited ? item.used : (item.used + ' / ' + item.limit)}
          {item.unlimited && <span style={{ color: theme.accent, marginLeft: 4, fontSize: 10 }}>(unlimited)</span>}
        </span>
      </div>
      {!item.unlimited && (
        <div style={{ height: 4, background: theme.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            width: Math.min(pct, 100) + '%', height: '100%',
            background: barColor, borderRadius: 2, transition: 'width 0.3s'
          }} />
        </div>
      )}
      {item.resets_at && (
        <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
          Resets {new Date(item.resets_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </div>
      )}
    </div>
  );
}

export default function PlanUsagePanel({ planName, usageSummary, trialInfo, loading, theme, onClose, disabledItems, onManageDisabled }) {
  if (loading) {
    return (
      <div style={panelStyle(theme)}>
        <div style={{ padding: 20, textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>Loading...</div>
      </div>
    );
  }

  var nearLimitItems = usageSummary.filter(function(u) { return u.nearLimit && !u.atLimit; });

  return (
    <div style={panelStyle(theme)} onClick={function(e) { e.stopPropagation(); }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid ' + theme.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: theme.text, fontFamily: "'Playfair Display', serif" }}>
            {planName || 'Free'} Plan
          </div>
          <div style={{ fontSize: 11, color: theme.textMuted }}>StriveRS by Raike & Sons</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: 16, padding: 4 }}>&times;</button>
      </div>

      {/* Trial banner */}
      {trialInfo && (
        <div style={{ padding: '10px 16px', background: '#E3F2FD', borderBottom: '1px solid ' + theme.border }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1565C0' }}>
            Free trial — {trialInfo.daysLeft} {trialInfo.daysLeft === 1 ? 'day' : 'days'} remaining
          </div>
          <div style={{ fontSize: 11, color: '#1976D2', marginTop: 2 }}>
            Ends {new Date(trialInfo.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        </div>
      )}

      {/* Near-limit warnings */}
      {nearLimitItems.length > 0 && (
        <div style={{ padding: '8px 16px', background: '#FFF3E0', borderBottom: '1px solid ' + theme.border }}>
          <div style={{ fontSize: 11, color: '#E65100', fontWeight: 600 }}>
            Approaching limit{nearLimitItems.length > 1 ? 's' : ''}: {nearLimitItems.map(function(u) { return u.label; }).join(', ')}
          </div>
        </div>
      )}

      {/* Disabled items banner */}
      {disabledItems > 0 && (
        <div style={{ padding: '8px 16px', background: '#FBE9E7', borderBottom: '1px solid ' + theme.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: '#BF360C', fontWeight: 600 }}>
            {disabledItems} item{disabledItems > 1 ? 's' : ''} disabled due to plan limits
          </div>
          {onManageDisabled && (
            <button
              onClick={onManageDisabled}
              style={{
                background: 'none', border: 'none', color: '#D84315',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0
              }}
            >
              Manage
            </button>
          )}
        </div>
      )}

      {/* Usage bars */}
      <div style={{ padding: '12px 16px', maxHeight: 300, overflowY: 'auto' }}>
        {usageSummary.length === 0 ? (
          <div style={{ color: theme.textMuted, fontSize: 13, textAlign: 'center', padding: 12 }}>No usage data</div>
        ) : (
          usageSummary.map(function(item) {
            return <UsageBar key={item.key} item={item} theme={theme} />;
          })
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid ' + theme.border, display: 'flex', gap: 8 }}>
        <button
          onClick={function() { window.open(BILLING_URL + '/plans', '_blank'); }}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 6, border: 'none',
            background: theme.accent, color: '#fff', fontSize: 12,
            fontWeight: 600, cursor: 'pointer'
          }}
        >
          {planName === 'Free' ? 'Upgrade' : 'Manage Plan'}
        </button>
        <button
          onClick={function() { window.open(BILLING_URL + '/subscriptions', '_blank'); }}
          style={{
            padding: '8px 12px', borderRadius: 6,
            border: '1px solid ' + theme.border, background: 'transparent',
            color: theme.textMuted, fontSize: 12, cursor: 'pointer'
          }}
        >
          Billing
        </button>
      </div>
    </div>
  );
}

function panelStyle(theme) {
  return {
    position: 'absolute', top: '100%', right: 0, marginTop: 4,
    width: 300, background: theme.bgSecondary, borderRadius: 8,
    boxShadow: '0 4px 24px rgba(0,0,0,0.15)', zIndex: 200,
    border: '1px solid ' + theme.border
  };
}
