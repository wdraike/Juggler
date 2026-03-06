/**
 * LoginPage — whimsical product landing page with corner login
 */

import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from './AuthProvider';

var FEATURES = [
  { icon: '\uD83C\uDFAF', title: 'Auto-Scheduling', desc: 'Drop in your tasks and Juggler finds the perfect slots. Priorities, deadlines, locations \u2014 it handles the Tetris so you don\u2019t have to.' },
  { icon: '\uD83C\uDFE0', title: 'Location-Aware', desc: 'Working from home? The office? Juggler knows which tools live where and schedules accordingly.' },
  { icon: '\u2702\uFE0F', title: 'Smart Splitting', desc: 'Big task? Juggler can slice it into bite-sized chunks across your free time. No more staring at a 4-hour block.' },
  { icon: '\uD83D\uDD17', title: 'Dependencies', desc: 'Task B can\u2019t start until Task A is done? Link them up. Juggler respects the chain.' },
  { icon: '\uD83D\uDCC5', title: 'Google Calendar Sync', desc: 'Two-way sync. Your Juggler tasks appear in Google Calendar and vice versa. One source of truth.' },
  { icon: '\uD83E\uDD16', title: 'AI Commands', desc: 'Type \u201Cwfh tomorrow\u201D or \u201Cmove groceries to Friday.\u201D Juggler speaks human.' },
];

var VIEWS = [
  { icon: '1', label: 'Day', desc: 'Timeline grid with connected cards' },
  { icon: '3', label: '3-Day', desc: 'Side-by-side comparison' },
  { icon: '7', label: 'Week', desc: 'Full week at a glance' },
  { icon: 'M', label: 'Month', desc: 'Drag tasks between dates' },
  { icon: '\u2261', label: 'List', desc: 'Everything, grouped by date' },
  { icon: 'P', label: 'Priority', desc: 'P1\u2013P4 kanban columns' },
];

var STEPS = [
  { num: '1', icon: '\u270F\uFE0F', title: 'Add your tasks', desc: 'Name it, set a duration, pick a priority. That\u2019s it. Juggler fills in the rest.' },
  { num: '2', icon: '\uD83D\uDD04', title: 'Hit Reschedule', desc: 'One click and every flexible task lands in the best available slot.' },
  { num: '3', icon: '\u2705', title: 'Cruise through your day', desc: 'Check things off, drag to adjust, let habits auto-repeat. You\u2019re juggling.' },
];

// Floating emoji decorations
var FLOATERS = [
  { emoji: '\uD83C\uDF1F', top: '8%', left: '6%', size: 28, delay: 0 },
  { emoji: '\uD83C\uDF88', top: '14%', right: '8%', size: 32, delay: 1.2 },
  { emoji: '\u2728', top: '32%', left: '3%', size: 22, delay: 0.6 },
  { emoji: '\uD83C\uDF08', top: '55%', right: '4%', size: 26, delay: 1.8 },
  { emoji: '\uD83C\uDF3F', top: '72%', left: '5%', size: 24, delay: 2.4 },
  { emoji: '\uD83D\uDE80', top: '85%', right: '6%', size: 28, delay: 0.3 },
];

export default function LoginPage() {
  var { login } = useAuth();
  var [loginError, setLoginError] = React.useState(null);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #FEFCE8 0%, #FFF7ED 30%, #FFF1F2 60%, #F0F9FF 100%)',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      color: '#1E293B',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Keyframe animations */}
      <style>{`
        @keyframes jFloat {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-12px) rotate(5deg); }
        }
        @keyframes jBounce {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
        @keyframes jWave {
          0% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
          100% { transform: rotate(-3deg); }
        }
        @keyframes jFadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .j-card:hover { transform: translateY(-4px) !important; box-shadow: 0 12px 32px rgba(0,0,0,0.08) !important; }
        .j-view:hover { background: #3B82F6 !important; color: white !important; transform: scale(1.05); }
      `}</style>

      {/* Floating emoji decorations */}
      {FLOATERS.map(function(f, i) {
        return (
          <div key={i} style={{
            position: 'fixed', top: f.top, left: f.left, right: f.right,
            fontSize: f.size, opacity: 0.35, pointerEvents: 'none', zIndex: 0,
            animation: 'jFloat 4s ease-in-out ' + f.delay + 's infinite'
          }}>{f.emoji}</div>
        );
      })}

      {/* Login corner */}
      <div style={{
        position: 'fixed', top: 0, right: 0, zIndex: 50,
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <GoogleLogin
          onSuccess={async function(credentialResponse) {
            try { setLoginError(null); await login(credentialResponse.credential); }
            catch (err) { console.error('Login failed:', err); setLoginError(err?.response?.data?.message || err.message || 'Login failed'); }
          }}
          onError={function() { setLoginError('Google sign-in failed. Check your connection.'); }}
          theme="outline"
          size="medium"
          text="signin"
          shape="pill"
        />
      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 820, margin: '0 auto', padding: '0 24px' }}>

        {/* Hero */}
        <div style={{
          textAlign: 'center', paddingTop: 80, paddingBottom: 48,
          animation: 'jFadeUp 0.6s ease-out'
        }}>
          <div style={{
            fontSize: 72, marginBottom: 8, lineHeight: 1,
            animation: 'jBounce 2.5s ease-in-out infinite',
            display: 'inline-block'
          }}>&#x1F939;</div>
          <h1 style={{
            fontSize: 48, fontWeight: 800, margin: '0 0 8px',
            background: 'linear-gradient(135deg, #7C3AED, #3B82F6, #10B981)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            letterSpacing: -1
          }}>Juggler</h1>
          <p style={{
            fontSize: 20, color: '#64748B', maxWidth: 480, margin: '0 auto 12px',
            fontWeight: 500, lineHeight: 1.5
          }}>
            The task scheduler that actually schedules.
          </p>
          <p style={{
            fontSize: 15, color: '#94A3B8', maxWidth: 520, margin: '0 auto 32px',
            lineHeight: 1.6
          }}>
            Tell Juggler what you need to do, where you&apos;ll be, and when you&apos;re free.
            It fills in your calendar like a puzzle &mdash; priorities first, constraints respected, zero overlap.
          </p>

          {/* CTA arrow pointing to the corner login */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'white', borderRadius: 20, padding: '10px 24px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
            fontSize: 14, color: '#64748B', fontWeight: 500
          }}>
            <span>Sign in to start juggling</span>
            <span style={{ fontSize: 18 }}>&#x2197;&#xFE0F;</span>
          </div>
        </div>

        {/* How it works */}
        <div style={{
          marginBottom: 56,
          animation: 'jFadeUp 0.6s ease-out 0.15s both'
        }}>
          <h2 style={{ textAlign: 'center', fontSize: 28, fontWeight: 700, marginBottom: 32, color: '#334155' }}>
            Three steps. That&apos;s the whole thing.
          </h2>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220, 1fr))',
            gap: 20
          }}>
            {STEPS.map(function(step) {
              return (
                <div key={step.num} className="j-card" style={{
                  background: 'white', borderRadius: 16, padding: '28px 24px',
                  boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  textAlign: 'center', position: 'relative', overflow: 'hidden'
                }}>
                  <div style={{
                    position: 'absolute', top: -8, right: -4, fontSize: 64, fontWeight: 900,
                    color: '#3B82F6', opacity: 0.06, lineHeight: 1
                  }}>{step.num}</div>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>{step.icon}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#1E293B', marginBottom: 6 }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6 }}>{step.desc}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Features grid */}
        <div style={{
          marginBottom: 56,
          animation: 'jFadeUp 0.6s ease-out 0.3s both'
        }}>
          <h2 style={{ textAlign: 'center', fontSize: 28, fontWeight: 700, marginBottom: 8, color: '#334155' }}>
            Everything lands in the right slot
          </h2>
          <p style={{ textAlign: 'center', fontSize: 14, color: '#94A3B8', marginBottom: 32 }}>
            No dragging things around for an hour. Juggler does the hard part.
          </p>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16
          }}>
            {FEATURES.map(function(f) {
              return (
                <div key={f.title} className="j-card" style={{
                  background: 'white', borderRadius: 14, padding: '22px 20px',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  display: 'flex', gap: 14, alignItems: 'flex-start'
                }}>
                  <div style={{
                    fontSize: 28, flexShrink: 0, width: 44, height: 44,
                    background: '#F0F9FF', borderRadius: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>{f.icon}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1E293B', marginBottom: 4 }}>{f.title}</div>
                    <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>{f.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Views showcase */}
        <div style={{
          marginBottom: 56,
          animation: 'jFadeUp 0.6s ease-out 0.45s both'
        }}>
          <h2 style={{ textAlign: 'center', fontSize: 28, fontWeight: 700, marginBottom: 8, color: '#334155' }}>
            Six ways to see your life
          </h2>
          <p style={{ textAlign: 'center', fontSize: 14, color: '#94A3B8', marginBottom: 28 }}>
            Timeline, kanban, calendar, list &mdash; pick what fits your brain.
          </p>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center'
          }}>
            {VIEWS.map(function(v) {
              return (
                <div key={v.label} className="j-view" style={{
                  background: 'white', borderRadius: 12, padding: '14px 20px',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                  textAlign: 'center', minWidth: 110,
                  transition: 'all 0.2s', cursor: 'default'
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 2, fontFamily: 'monospace' }}>{v.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{v.label}</div>
                  <div style={{ fontSize: 10, color: '#94A3B8' }}>{v.desc}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Schedule templates highlight */}
        <div style={{
          marginBottom: 56,
          animation: 'jFadeUp 0.6s ease-out 0.5s both'
        }}>
          <div className="j-card" style={{
            background: 'white', borderRadius: 20, padding: '36px 32px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.05)',
            transition: 'transform 0.2s, box-shadow 0.2s',
            display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap'
          }}>
            <div style={{ flex: '1 1 280px' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>&#x1F3A8;</div>
              <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: '#1E293B' }}>Paint your schedule</h3>
              <p style={{ fontSize: 13, color: '#64748B', lineHeight: 1.7 }}>
                Define templates for weekdays, weekends, or one-off days. Drag block edges to resize. Paint locations with a brush &mdash; home in the morning, office after lunch, gym in the evening. The scheduler matches tasks to wherever you&apos;ll actually be.
              </p>
            </div>
            <div style={{
              flex: '0 0 auto', display: 'flex', gap: 6,
              animation: 'jWave 3s ease-in-out infinite'
            }}>
              {/* Mini schedule blocks illustration */}
              {[
                { label: 'AM', color: '#3B82F6', icon: '\uD83C\uDFE0', h: 44 },
                { label: 'Lunch', color: '#10B981', icon: '\uD83C\uDF55', h: 20 },
                { label: 'PM', color: '#F59E0B', icon: '\uD83C\uDFE2', h: 44 },
                { label: 'Eve', color: '#8B5CF6', icon: '\uD83C\uDFCB\uFE0F', h: 28 },
              ].map(function(b) {
                return (
                  <div key={b.label} style={{
                    width: 50, height: b.h * 2, background: b.color + '20',
                    borderRadius: 8, border: '2px solid ' + b.color + '40',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', gap: 2
                  }}>
                    <span style={{ fontSize: 18 }}>{b.icon}</span>
                    <span style={{ fontSize: 8, fontWeight: 700, color: b.color }}>{b.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div style={{
          textAlign: 'center', paddingBottom: 64,
          animation: 'jFadeUp 0.6s ease-out 0.6s both'
        }}>
          <div style={{
            fontSize: 44, marginBottom: 16,
            animation: 'jBounce 2s ease-in-out 0.5s infinite',
            display: 'inline-block'
          }}>&#x1F939;</div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#334155', marginBottom: 8 }}>
            Stop planning. Start juggling.
          </h2>
          <p style={{ fontSize: 14, color: '#94A3B8', marginBottom: 24 }}>
            Free to use. Sign in with Google to get started.
          </p>
          <div style={{ display: 'inline-block' }}>
            <GoogleLogin
              onSuccess={async function(credentialResponse) {
                try { setLoginError(null); await login(credentialResponse.credential); }
                catch (err) { console.error('Login failed:', err); setLoginError(err?.response?.data?.message || err.message || 'Login failed'); }
              }}
              onError={function() { setLoginError('Google sign-in failed. Check your connection.'); }}
              theme="filled_blue"
              size="large"
              text="signin_with"
              shape="pill"
            />
          </div>
          {loginError && (
            <div style={{
              marginTop: 16, padding: '10px 20px', background: '#FEF2F2',
              border: '1px solid #FECACA', borderRadius: 10, color: '#DC2626',
              fontSize: 13, maxWidth: 400, margin: '16px auto 0'
            }}>
              {loginError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          textAlign: 'center', paddingBottom: 32,
          fontSize: 11, color: '#CBD5E1'
        }}>
          &#x1F939; Juggler &mdash; made with too much coffee and not enough sleep
        </div>

      </div>
    </div>
  );
}
