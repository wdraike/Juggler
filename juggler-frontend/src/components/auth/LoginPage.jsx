/**
 * LoginPage — Raike & Sons branded landing page
 */

import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from './AuthProvider';

var FEATURES = [
  { icon: '\uD83C\uDFAF', title: 'Auto-Scheduling', desc: 'Drop in your tasks. We find the slots. Priorities, deadlines, locations \u2014 handled.' },
  { icon: '\uD83C\uDFE0', title: 'Location-Aware', desc: 'Home, office, gym. We know where your tools are and schedule accordingly.' },
  { icon: '\u2702\uFE0F', title: 'Smart Splitting', desc: 'Big task? We slice it into chunks across your free time. No more staring at a 4-hour block.' },
  { icon: '\uD83D\uDD17', title: 'Dependencies', desc: 'Task B waits for Task A. Link them. We respect the chain.' },
  { icon: '\uD83D\uDCC5', title: 'Calendar Sync', desc: 'Two-way sync with Google and Microsoft. One source of truth.' },
  { icon: '\uD83E\uDD16', title: 'AI Commands', desc: 'Type \u201Cwfh tomorrow\u201D or \u201Cmove groceries to Friday.\u201D We speak human.' },
  { icon: '\uD83D\uDD0C', title: 'MCP Integration', desc: 'Connect Claude or Cursor directly to your tasks. Your AI manages your schedule through conversation.' },
];

var STEPS = [
  { num: '1', title: 'Add your tasks', desc: 'Name it, set a duration, pick a priority. We fill in the rest.' },
  { num: '2', title: 'We schedule it', desc: 'Automatic. Every flexible task lands in the best available slot.' },
  { num: '3', title: 'Cruise through your day', desc: 'Check things off, drag to adjust, let habits auto-repeat.' },
];

var VIEWS = [
  { icon: '1', label: 'Day', desc: 'Timeline grid' },
  { icon: '3', label: '3-Day', desc: 'Side-by-side' },
  { icon: '7', label: 'Week', desc: 'Full week' },
  { icon: 'M', label: 'Month', desc: 'Date grid' },
  { icon: '\u2261', label: 'List', desc: 'Flat list' },
  { icon: 'P', label: 'Priority', desc: 'Kanban' },
];

function GoldRule() {
  return (
    <hr style={{
      border: 'none', height: 1, margin: '3rem 0',
      background: 'linear-gradient(to right, transparent, #C8942A 20%, #C8942A 80%, transparent)',
      opacity: 0.5
    }} />
  );
}

export default function LoginPage() {
  var { login } = useAuth();
  var [loginError, setLoginError] = React.useState(null);

  function handleLogin(credentialResponse) {
    setLoginError(null);
    login(credentialResponse.credential).catch(function(err) {
      console.error('Login failed:', err);
      setLoginError(err?.response?.data?.message || err.message || 'Login failed');
    });
  }

  function handleLoginError() {
    setLoginError('Google sign-in failed. Check your connection.');
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F5F0E8',
      fontFamily: "'Inter', system-ui, sans-serif",
      color: '#2C2B28',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <style>{`
        @keyframes rsFadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .rs-feature:hover { border-color: #C8942A !important; transform: translateY(-3px); box-shadow: 0 8px 24px rgba(26,43,74,0.1) !important; }
        .rs-step:hover { border-top-color: #C8942A !important; transform: translateY(-3px); box-shadow: 0 8px 24px rgba(26,43,74,0.1) !important; }
        .rs-view:hover { background: #1A2B4A !important; color: #FDFAF5 !important; }
        .rs-feature, .rs-step { transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.2s !important; }
      `}</style>

      {/* Parchment texture overlay */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 0.035,
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'repeat', backgroundSize: '200px 200px'
      }} />

      {/* Login corner */}
      <div style={{
        position: 'fixed', top: 0, right: 0, zIndex: 50,
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <GoogleLogin
          onSuccess={handleLogin}
          onError={handleLoginError}
          theme="outline"
          size="medium"
          text="signin"
          shape="rectangular"
        />
      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 820, margin: '0 auto', padding: '0 24px' }}>

        {/* Hero */}
        <div style={{
          textAlign: 'center', paddingTop: 80, paddingBottom: 32,
          animation: 'rsFadeUp 0.6s ease-out', position: 'relative'
        }}>
          {/* Decorative background letter */}
          <div style={{
            position: 'absolute', fontFamily: "'Playfair Display', serif",
            fontSize: '40vw', fontWeight: 700, color: '#1A2B4A', opacity: 0.025,
            top: '-10%', right: '-5%', lineHeight: 1, pointerEvents: 'none', userSelect: 'none'
          }}>R</div>

          {/* Est badge — stamp style */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.4em',
            fontFamily: "'Inter', sans-serif",
            fontSize: 10, fontWeight: 700,
            letterSpacing: '0.2em', textTransform: 'uppercase',
            color: '#C8942A',
            border: '1.5px solid #C8942A',
            padding: '4px 14px',
            borderRadius: 1, opacity: 0.85,
            marginBottom: 24
          }}>Est. 2025</div>

          {/* Logo wordmark */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, color: '#1A2B4A', fontSize: 48, letterSpacing: '-0.01em' }}>Raike</span>
            <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 300, color: '#C8942A', fontSize: 60, lineHeight: 1, margin: '0 2px' }}>&amp;</span>
            <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400, color: '#1A2B4A', fontSize: 48, letterSpacing: '-0.01em' }}>Sons</span>
          </div>

          {/* Gold rule */}
          <div style={{ width: '100%', height: 1, background: '#C8942A', opacity: 0.4, margin: '8px 0 6px' }} />

          {/* Tagline */}
          <p style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontStyle: 'italic', fontSize: 14,
            fontWeight: 300, color: '#9E6B3B',
            letterSpacing: '0.08em',
            marginBottom: 4
          }}>
            Old school hustle. New school AI.
          </p>

          {/* Est text */}
          <div style={{
            fontFamily: "'Inter', sans-serif", fontSize: 9, fontWeight: 600,
            letterSpacing: '0.3em', textTransform: 'uppercase',
            color: '#C8942A', opacity: 0.7, marginBottom: 20
          }}>Est. 2025</div>

          {/* Ornamental divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px auto', maxWidth: 300 }}>
            <span style={{ flex: 1, height: 1, background: '#C8942A', opacity: 0.4 }} />
            <span style={{ fontSize: '0.5rem', color: '#C8942A', letterSpacing: 4 }}>&#x25C6;</span>
            <span style={{ flex: 1, height: 1, background: '#C8942A', opacity: 0.4 }} />
          </div>

          {/* Product name */}
          <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <span style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 28, fontWeight: 700, color: '#1A2B4A', letterSpacing: '-0.02em'
            }}>Strive<span style={{ color: '#C8942A' }}>RS</span></span>
          </div>

          {/* Product tagline */}
          <p style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontStyle: 'italic', fontSize: 18,
            fontWeight: 300, color: '#C8942A',
            letterSpacing: '0.02em',
            marginBottom: 20
          }}>
            Never stops striving.
          </p>

          <p style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 15, color: '#5C5A55', maxWidth: 500, margin: '0 auto 28px',
            lineHeight: 1.7
          }}>
            Tell us what you need to do, where you'll be, and when you're free.
            StriveRS never stops &mdash; priorities first, constraints respected, zero overlap.
          </p>

          {/* CTA — gold accent button */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#C8942A', borderRadius: 2, padding: '10px 24px',
            fontSize: 13, color: '#1A2B4A', fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            fontFamily: "'Inter', sans-serif",
            border: '1.5px solid #C8942A', cursor: 'pointer'
          }}>
            <span>Put us to work</span>
            <span style={{ fontSize: 16 }}>&#x2197;</span>
          </div>
        </div>

        <GoldRule />

        {/* How it works */}
        <div style={{ marginBottom: 16, animation: 'rsFadeUp 0.6s ease-out 0.15s both' }}>
          <div style={{
            fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 600,
            letterSpacing: '0.25em', textTransform: 'uppercase',
            color: '#C8942A', textAlign: 'center', marginBottom: 12
          }}>How it works</div>
          <h2 style={{
            textAlign: 'center', fontFamily: "'EB Garamond', serif",
            fontSize: 28, fontWeight: 500, marginBottom: 32, color: '#1A2B4A'
          }}>
            Three steps. That's the whole thing.
          </h2>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 20
          }}>
            {STEPS.map(function(step) {
              return (
                <div key={step.num} className="rs-step" style={{
                  background: '#FDFAF5', borderRadius: 2, padding: '28px 24px',
                  border: '1px solid #E8E0D0', borderTop: '3px solid #E8E0D0',
                  textAlign: 'center', position: 'relative'
                }}>
                  <div style={{
                    position: 'absolute', top: -8, right: -4, fontSize: 64, fontWeight: 900,
                    fontFamily: "'Playfair Display', serif",
                    color: '#1A2B4A', opacity: 0.04, lineHeight: 1
                  }}>{step.num}</div>
                  <div style={{
                    fontFamily: "'EB Garamond', serif",
                    fontSize: 18, fontWeight: 500, color: '#1A2B4A', marginBottom: 8
                  }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: '#5C5A55', lineHeight: 1.6 }}>{step.desc}</div>
                </div>
              );
            })}
          </div>
        </div>

        <GoldRule />

        {/* Features grid */}
        <div style={{ marginBottom: 16, animation: 'rsFadeUp 0.6s ease-out 0.3s both' }}>
          <div style={{
            fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 600,
            letterSpacing: '0.25em', textTransform: 'uppercase',
            color: '#C8942A', textAlign: 'center', marginBottom: 12
          }}>Features</div>
          <h2 style={{
            textAlign: 'center', fontFamily: "'EB Garamond', serif",
            fontSize: 28, fontWeight: 500, marginBottom: 8, color: '#1A2B4A'
          }}>
            Everything lands in the right slot
          </h2>
          <p style={{ textAlign: 'center', fontSize: 14, color: '#5C5A55', marginBottom: 32 }}>
            No dragging things around for an hour. We do the hard part.
          </p>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16
          }}>
            {FEATURES.map(function(f) {
              return (
                <div key={f.title} className="rs-feature" style={{
                  background: '#FDFAF5', borderRadius: 2, padding: '22px 20px',
                  border: '1px solid #E8E0D0',
                  display: 'flex', gap: 14, alignItems: 'flex-start'
                }}>
                  <div style={{
                    fontSize: 24, flexShrink: 0, width: 44, height: 44,
                    background: '#F5F0E8', borderRadius: 2,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '1px solid #E8E0D0'
                  }}>{f.icon}</div>
                  <div>
                    <div style={{
                      fontFamily: "'EB Garamond', serif",
                      fontSize: 16, fontWeight: 500, color: '#1A2B4A', marginBottom: 4
                    }}>{f.title}</div>
                    <div style={{ fontSize: 12, color: '#5C5A55', lineHeight: 1.6 }}>{f.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <GoldRule />

        {/* MCP Integration highlight — navy section with texture */}
        <div style={{ marginBottom: 16, animation: 'rsFadeUp 0.6s ease-out 0.38s both' }}>
          <div style={{
            background: '#1A2B4A', borderRadius: 2, padding: '36px 32px',
            border: '1px solid #2E4A7A', position: 'relative', overflow: 'hidden'
          }}>
            {/* Navy texture */}
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.05,
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
              backgroundRepeat: 'repeat', backgroundSize: '200px 200px'
            }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{
                fontFamily: "'Inter', sans-serif", fontSize: 9, fontWeight: 700,
                letterSpacing: '0.3em', textTransform: 'uppercase',
                color: '#C8942A', marginBottom: 12
              }}>Game Changer</div>
              <h3 style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 24, fontWeight: 700, color: '#FDFAF5', marginBottom: 12
              }}>MCP Integration</h3>
              <p style={{ fontSize: 14, color: '#E8E0D0', lineHeight: 1.7, marginBottom: 20, maxWidth: 520, opacity: 0.9 }}>
                Connect Claude, Cursor, or any MCP-compatible AI directly to StriveRS.
                Your AI assistant can create tasks, run the scheduler, check your schedule, and manage
                your entire day &mdash; all through natural conversation.
              </p>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12
              }}>
                {[
                  { label: 'Create & update tasks', detail: 'Add tasks with priorities, durations, dependencies, and deadlines' },
                  { label: 'Run the scheduler', detail: 'Trigger auto-scheduling and see what landed where' },
                  { label: 'Query your schedule', detail: 'Ask what\u2019s on today, what\u2019s unplaced, what\u2019s blocked' },
                  { label: 'Manage projects', detail: 'List projects, filter tasks, batch operations' },
                ].map(function(item) {
                  return (
                    <div key={item.label} style={{
                      background: 'rgba(255,255,255,0.06)', borderRadius: 2,
                      padding: '14px 16px', border: '1px solid rgba(200,148,42,0.2)'
                    }}>
                      <div style={{
                        fontFamily: "'EB Garamond', serif",
                        fontSize: 14, fontWeight: 500, color: '#E8C878', marginBottom: 4
                      }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: '#B0A898', lineHeight: 1.5 }}>{item.detail}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{
                marginTop: 20, fontSize: 12, color: '#8A8070',
                fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic'
              }}>
                Works with Claude Code, Claude Desktop, Cursor, and any tool that speaks MCP.
              </div>
            </div>
          </div>
        </div>

        <GoldRule />

        {/* Views showcase */}
        <div style={{ marginBottom: 16, animation: 'rsFadeUp 0.6s ease-out 0.45s both' }}>
          <h2 style={{
            textAlign: 'center', fontFamily: "'EB Garamond', serif",
            fontSize: 28, fontWeight: 500, marginBottom: 8, color: '#1A2B4A'
          }}>
            Six ways to see your life
          </h2>
          <p style={{ textAlign: 'center', fontSize: 14, color: '#5C5A55', marginBottom: 28 }}>
            Timeline, kanban, calendar, list &mdash; pick what fits your brain.
          </p>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center'
          }}>
            {VIEWS.map(function(v) {
              return (
                <div key={v.label} className="rs-view" style={{
                  background: '#FDFAF5', borderRadius: 2, padding: '14px 20px',
                  border: '1px solid #E8E0D0',
                  textAlign: 'center', minWidth: 110,
                  transition: 'all 0.2s', cursor: 'default'
                }}>
                  <div style={{
                    fontSize: 22, fontWeight: 800, marginBottom: 2,
                    fontFamily: "'Playfair Display', serif", color: '#1A2B4A'
                  }}>{v.icon}</div>
                  <div style={{
                    fontFamily: "'EB Garamond', serif",
                    fontSize: 14, fontWeight: 500, marginBottom: 2
                  }}>{v.label}</div>
                  <div style={{ fontSize: 10, color: '#5C5A55' }}>{v.desc}</div>
                </div>
              );
            })}
          </div>
        </div>

        <GoldRule />

        {/* Schedule templates highlight — engraving double-border card */}
        <div style={{ marginBottom: 16, animation: 'rsFadeUp 0.6s ease-out 0.5s both' }}>
          <div style={{
            background: '#FDFAF5', borderRadius: 2, padding: '36px 32px',
            border: '1px solid #C8942A',
            boxShadow: 'inset 0 0 0 4px #F5F0E8, inset 0 0 0 5px #C8942A',
            display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap',
            position: 'relative'
          }}>
            {/* Corner ornaments */}
            <span style={{ position: 'absolute', top: 8, left: 10, color: '#C8942A', fontSize: 9, opacity: 0.6 }}>{'\u2726'}</span>
            <span style={{ position: 'absolute', bottom: 8, right: 10, color: '#C8942A', fontSize: 9, opacity: 0.6 }}>{'\u2726'}</span>
            <div style={{ flex: '1 1 280px' }}>
              <h3 style={{
                fontFamily: "'EB Garamond', serif",
                fontSize: 22, fontWeight: 500, marginBottom: 8, color: '#1A2B4A'
              }}>Paint your schedule</h3>
              <p style={{ fontSize: 13, color: '#5C5A55', lineHeight: 1.7 }}>
                Define templates for weekdays, weekends, or one-off days. Drag block edges to resize.
                Paint locations with a brush &mdash; home in the morning, office after lunch, gym in the evening.
                The scheduler matches tasks to wherever you'll actually be.
              </p>
            </div>
            <div style={{ flex: '0 0 auto', display: 'flex', gap: 6 }}>
              {[
                { label: 'AM', color: '#1A2B4A', icon: '\uD83C\uDFE0', h: 44 },
                { label: 'Lunch', color: '#9E6B3B', icon: '\uD83C\uDF55', h: 20 },
                { label: 'PM', color: '#2E4A7A', icon: '\uD83C\uDFE2', h: 44 },
                { label: 'Eve', color: '#5C5A55', icon: '\uD83C\uDFCB\uFE0F', h: 28 },
              ].map(function(b) {
                return (
                  <div key={b.label} style={{
                    width: 50, height: b.h * 2, background: b.color + '12',
                    borderRadius: 2, border: '1.5px solid ' + b.color + '30',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', gap: 2
                  }}>
                    <span style={{ fontSize: 18 }}>{b.icon}</span>
                    <span style={{ fontSize: 8, fontWeight: 600, color: b.color, fontFamily: "'Inter', sans-serif" }}>{b.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <GoldRule />

        {/* Product pairing */}
        <div style={{ marginBottom: 16, animation: 'rsFadeUp 0.6s ease-out 0.55s both' }}>
          <div style={{
            fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 600,
            letterSpacing: '0.25em', textTransform: 'uppercase',
            color: '#C8942A', textAlign: 'center', marginBottom: 12
          }}>The Family</div>
          <h2 style={{
            textAlign: 'center', fontFamily: "'Playfair Display', serif",
            fontSize: 24, fontWeight: 700, marginBottom: 4, color: '#1A2B4A'
          }}>
            StriveRS keeps you moving.
          </h2>
          <h2 style={{
            textAlign: 'center', fontFamily: "'Playfair Display', serif",
            fontSize: 24, fontWeight: 700, marginBottom: 4, color: '#1A2B4A'
          }}>
            ClimbRS gets you rising.
          </h2>
          <p style={{
            textAlign: 'center', fontFamily: "'Cormorant Garamond', serif",
            fontStyle: 'italic', fontSize: 15, color: '#C8942A', marginBottom: 24
          }}>
            RS = Raike &amp; Sons. Always.
          </p>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16
          }}>
            {/* StriveRS */}
            <div style={{
              background: '#FDFAF5', borderRadius: 2, padding: '28px 24px',
              border: '1px solid #E8E0D0', borderTop: '3px solid #9E6B3B'
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                <span style={{
                  fontFamily: "'Playfair Display', serif",
                  fontSize: 22, fontWeight: 700, color: '#9E6B3B'
                }}>Strive<span style={{ color: '#1A2B4A' }}>RS</span></span>
                <span style={{
                  fontFamily: "'Inter', sans-serif", fontSize: 9,
                  fontWeight: 600, letterSpacing: '0.15em',
                  textTransform: 'uppercase', color: '#9E6B3B',
                  border: '1px solid #9E6B3B', padding: '1px 6px', borderRadius: 1
                }}>Strive</span>
              </div>
              <div style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontStyle: 'italic', fontSize: 14, color: '#C8942A', marginBottom: 12
              }}>Never stops striving.</div>
              <p style={{ fontSize: 13, color: '#5C5A55', lineHeight: 1.6 }}>
                AI task manager that never sits still. Tasks dispatched, priorities managed,
                nothing piling up. Built for people who don't sit still.
              </p>
              <div style={{
                marginTop: 12, fontFamily: "'Inter', sans-serif",
                fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: '#9E6B3B'
              }}>Available now</div>
            </div>
            {/* ClimbRS */}
            <div style={{
              background: '#FDFAF5', borderRadius: 2, padding: '28px 24px',
              border: '1px solid #E8E0D0', borderTop: '3px solid #C8942A'
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                <span style={{
                  fontFamily: "'Playfair Display', serif",
                  fontSize: 22, fontWeight: 700, color: '#C8942A'
                }}>Climb<span style={{ color: '#1A2B4A' }}>RS</span></span>
                <span style={{
                  fontFamily: "'Inter', sans-serif", fontSize: 9,
                  fontWeight: 600, letterSpacing: '0.15em',
                  textTransform: 'uppercase', color: '#C8942A',
                  border: '1px solid #C8942A', padding: '1px 6px', borderRadius: 1
                }}>Climbers</span>
              </div>
              <div style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontStyle: 'italic', fontSize: 14, color: '#C8942A', marginBottom: 12
              }}>Always climbing.</div>
              <p style={{ fontSize: 13, color: '#5C5A55', lineHeight: 1.6 }}>
                AI career tool that takes your raw experience and shapes it into something
                that gets you in the room. Raw experience. Refined results.
              </p>
              <div style={{
                marginTop: 12, fontFamily: "'Inter', sans-serif",
                fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: '#C8942A'
              }}>Coming soon</div>
            </div>
          </div>
        </div>

        <GoldRule />

        {/* Bottom CTA */}
        <div style={{
          textAlign: 'center', paddingBottom: 32,
          animation: 'rsFadeUp 0.6s ease-out 0.6s both'
        }}>
          <h2 style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 28, fontWeight: 700, color: '#1A2B4A', marginBottom: 8
          }}>
            Don't sit still. Neither do we.
          </h2>
          <p style={{ fontSize: 14, color: '#5C5A55', marginBottom: 24 }}>
            Free to use. Sign in with Google and put your StriveRS to work.
          </p>
          <div style={{ display: 'inline-block' }}>
            <GoogleLogin
              onSuccess={handleLogin}
              onError={handleLoginError}
              theme="filled_blue"
              size="large"
              text="signin_with"
              shape="rectangular"
            />
          </div>
          {loginError && (
            <div style={{
              marginTop: 16, padding: '10px 20px', background: '#FEE2E2',
              border: '1px solid #8B2635', borderRadius: 2, color: '#8B2635',
              fontSize: 13, maxWidth: 400, margin: '16px auto 0'
            }}>
              {loginError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          textAlign: 'center', paddingBottom: 32, fontSize: 11, color: '#5C5A55'
        }}>
          <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, color: '#9E6B3B' }}>Raike</span>
          <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', color: '#C8942A', fontSize: 13 }}> &amp; </span>
          <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400, color: '#9E6B3B' }}>Sons</span>
          <span style={{ margin: '0 8px', color: '#E8E0D0' }}>&mdash;</span>
          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#C8942A' }}>Est. 2025</span>
        </div>

      </div>
    </div>
  );
}
