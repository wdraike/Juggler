/**
 * FeedbackDialog — multi-step feedback form for Juggler (StriveRS)
 *
 * Three steps: Details -> Screenshot (optional) -> Review & Submit
 * Uses Juggler's inline style pattern (no MUI).
 * Submits to bug-reporter-service via shared client.
 */

import React, { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import { useAuth } from '../auth/AuthProvider';
import { createBugReporterClient } from 'bug-reporter-client';
import AnnotationCanvas from './AnnotationCanvas';

var bugReporter = createBugReporterClient({
  baseUrl: '/api',
  getToken: function() { return localStorage.getItem('token'); },
  sourceApp: 'juggler'
});

var TYPES = [
  { value: 'bug', label: 'Bug Report' },
  { value: 'feature', label: 'Feature Request' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' }
];

export default function FeedbackDialog({ open, onClose, darkMode, theme }) {
  var { user } = useAuth();
  var dialogRef = useRef(null);

  // Form state
  var [type, setType] = useState('bug');
  var [subject, setSubject] = useState('');
  var [description, setDescription] = useState('');
  var [email, setEmail] = useState(user ? user.email || '' : '');

  // Screenshot state
  var [screenshot, setScreenshot] = useState(null);
  var [showAnnotation, setShowAnnotation] = useState(false);
  var [capturing, setCapturing] = useState(false);

  // Submission state
  var [submitting, setSubmitting] = useState(false);
  var [error, setError] = useState(null);
  var [success, setSuccess] = useState(false);

  // Stepper
  var [step, setStep] = useState(0);
  var steps = ['Details', 'Screenshot (Optional)', 'Review & Submit'];

  useEffect(function() {
    if (user && user.email) setEmail(user.email);
  }, [user]);

  useEffect(function() {
    if (!open) {
      setTimeout(function() {
        setType('bug');
        setSubject('');
        setDescription('');
        setEmail(user ? user.email || '' : '');
        setScreenshot(null);
        setShowAnnotation(false);
        setError(null);
        setSuccess(false);
        setStep(0);
      }, 300);
    }
  }, [open, user]);

  // Close on backdrop click
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget && !success) {
      onClose();
    }
  }

  // Close on Escape
  useEffect(function() {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape' && !success) onClose();
    }
    document.addEventListener('keydown', handleKey);
    return function() { document.removeEventListener('keydown', handleKey); };
  }, [open, success, onClose]);

  async function handleCaptureScreenshot() {
    try {
      setCapturing(true);
      setError(null);

      // Hide dialog
      if (dialogRef.current) dialogRef.current.style.display = 'none';
      var backdrop = document.getElementById('feedback-backdrop');
      if (backdrop) backdrop.style.display = 'none';

      await new Promise(function(r) { setTimeout(r, 100); });

      var canvas = await html2canvas(document.body, {
        useCORS: true, logging: false,
        scale: window.devicePixelRatio || 1,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
      });

      // Show dialog again
      if (dialogRef.current) dialogRef.current.style.display = '';
      if (backdrop) backdrop.style.display = '';

      setScreenshot(canvas.toDataURL('image/png'));
      setShowAnnotation(true);
    } catch (err) {
      console.error('Error capturing screenshot:', err);
      setError('Failed to capture screenshot. You can still submit without it.');
      if (dialogRef.current) dialogRef.current.style.display = '';
      var backdrop2 = document.getElementById('feedback-backdrop');
      if (backdrop2) backdrop2.style.display = '';
    } finally {
      setCapturing(false);
    }
  }

  async function handleSubmit() {
    try {
      setSubmitting(true);
      setError(null);

      if (!subject.trim() || subject.length < 3) {
        setError('Please provide a subject (at least 3 characters)');
        setSubmitting(false);
        return;
      }
      if (!description.trim() || description.length < 10) {
        setError('Please provide a description (at least 10 characters)');
        setSubmitting(false);
        return;
      }
      if (!email || !email.includes('@')) {
        setError('Please provide a valid email address');
        setSubmitting(false);
        return;
      }

      var result = await bugReporter.submitFeedback({
        type: type,
        subject: subject.trim(),
        description: description.trim(),
        email: email.trim(),
        screenshot: screenshot || undefined,
        user: user,
      });

      console.log('Feedback submitted:', result.feedback_id);
      setSuccess(true);
      setTimeout(function() { onClose(); }, 2000);
    } catch (err) {
      console.error('Error submitting feedback:', err);
      setError(err.message || 'Failed to submit feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleAnnotationComplete(annotatedScreenshot) {
    setScreenshot(annotatedScreenshot);
    setShowAnnotation(false);
    setStep(2); // Move to review
  }

  function handleNext() {
    if (step === 0) {
      if (!subject.trim() || !description.trim() || !email.trim()) {
        setError('Please fill in all required fields');
        return;
      }
    }
    setError(null);
    setStep(function(s) { return Math.min(s + 1, steps.length - 1); });
  }

  function handleBack() {
    setStep(function(s) { return Math.max(s - 1, 0); });
  }

  if (!open) return null;

  var inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 4,
    border: '1px solid ' + theme.inputBorder, background: theme.inputBg,
    color: theme.inputText, fontSize: 14, fontFamily: "'Inter', sans-serif",
    boxSizing: 'border-box', outline: 'none'
  };

  var labelStyle = {
    display: 'block', fontSize: 13, fontWeight: 600,
    color: theme.textSecondary, marginBottom: 4, fontFamily: "'Inter', sans-serif"
  };

  var btnPrimary = {
    border: 'none', borderRadius: 4, padding: '10px 20px',
    background: theme.accent, color: '#1A2B4A', fontSize: 14,
    fontWeight: 600, cursor: submitting ? 'wait' : 'pointer',
    fontFamily: "'Inter', sans-serif", opacity: submitting ? 0.7 : 1
  };

  var btnSecondary = {
    border: '1px solid ' + theme.border, borderRadius: 4, padding: '10px 20px',
    background: 'transparent', color: theme.text, fontSize: 14,
    cursor: 'pointer', fontFamily: "'Inter', sans-serif"
  };

  return (
    <>
      {/* Backdrop */}
      <div id="feedback-backdrop" onClick={handleBackdropClick} style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.5)', zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {/* Dialog */}
        <div ref={dialogRef} style={{
          background: theme.bgSecondary, border: '1px solid ' + theme.border,
          borderRadius: 8, width: '90%', maxWidth: 640, maxHeight: '90vh',
          overflow: 'auto', boxShadow: '0 8px 32px ' + theme.shadow,
          zIndex: 10001
        }} onClick={function(e) { e.stopPropagation(); }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid ' + theme.border
          }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: theme.text, fontFamily: "'Inter', sans-serif" }}>
              Report an Issue
            </span>
            {!success && (
              <button onClick={onClose} style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: theme.textMuted, fontSize: 20, padding: 4
              }} title="Close">&#x2715;</button>
            )}
          </div>

          {/* Content */}
          <div style={{ padding: '16px 20px' }}>
            {/* Error */}
            {error && (
              <div style={{
                padding: '10px 14px', marginBottom: 16, borderRadius: 4,
                background: theme.redBg, color: theme.redText, fontSize: 13,
                border: '1px solid ' + theme.redBorder
              }}>
                {error}
                <button onClick={function() { setError(null); }} style={{
                  float: 'right', border: 'none', background: 'transparent',
                  cursor: 'pointer', color: theme.redText, fontSize: 14
                }}>&#x2715;</button>
              </div>
            )}

            {/* Stepper */}
            {!success && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {steps.map(function(label, i) {
                  var isActive = i === step;
                  var isDone = i < step;
                  return (
                    <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', margin: '0 auto 4px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 600, fontFamily: "'Inter', sans-serif",
                        background: isActive ? theme.accent : isDone ? theme.success : theme.bgTertiary,
                        color: isActive ? '#1A2B4A' : isDone ? '#fff' : theme.textMuted
                      }}>
                        {isDone ? '\u2713' : i + 1}
                      </div>
                      <div style={{ fontSize: 11, color: isActive ? theme.text : theme.textMuted, fontFamily: "'Inter', sans-serif" }}>
                        {label}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Success */}
            {success && (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>{'\u2705'}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: theme.text, marginBottom: 8, fontFamily: "'Inter', sans-serif" }}>
                  Thank you for your feedback!
                </div>
                <div style={{ fontSize: 14, color: theme.textMuted, fontFamily: "'Inter', sans-serif" }}>
                  We've received your submission and will review it shortly.
                </div>
              </div>
            )}

            {/* Step 0: Details */}
            {!success && step === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Type</label>
                  <select value={type} onChange={function(e) { setType(e.target.value); }}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    {TYPES.map(function(t) {
                      return <option key={t.value} value={t.value}>{t.label}</option>;
                    })}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Subject</label>
                  <input type="text" value={subject} onChange={function(e) { setSubject(e.target.value); }}
                    placeholder="Brief description of the issue..." maxLength={255} style={inputStyle} />
                  <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2, textAlign: 'right' }}>{subject.length}/255</div>
                </div>
                <div>
                  <label style={labelStyle}>Description</label>
                  <textarea value={description} onChange={function(e) { setDescription(e.target.value); }}
                    placeholder="What happened? What did you expect to happen?"
                    rows={6} style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                <div>
                  <label style={labelStyle}>Email</label>
                  <input type="email" value={email} onChange={function(e) { setEmail(e.target.value); }}
                    placeholder="your@email.com" style={inputStyle} />
                  <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>We'll use this to follow up on your feedback</div>
                </div>
              </div>
            )}

            {/* Step 1: Screenshot */}
            {!success && step === 1 && (
              <div>
                {showAnnotation && screenshot ? (
                  <AnnotationCanvas
                    screenshot={screenshot}
                    onComplete={handleAnnotationComplete}
                    onCancel={function() { setShowAnnotation(false); setScreenshot(null); }}
                    theme={theme}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <div style={{ fontSize: 14, color: theme.text, marginBottom: 8, fontFamily: "'Inter', sans-serif" }}>
                      Adding a screenshot helps us understand the issue better.
                    </div>
                    <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 20, fontFamily: "'Inter', sans-serif" }}>
                      You can annotate the screenshot to highlight specific areas.
                    </div>

                    {screenshot && !showAnnotation ? (
                      <div>
                        <img src={screenshot} alt="Screenshot preview" style={{
                          maxWidth: '100%', maxHeight: 300, border: '1px solid ' + theme.border,
                          borderRadius: 4, marginBottom: 12
                        }} />
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                          <button onClick={function() { setShowAnnotation(true); }} style={btnSecondary}>Edit Screenshot</button>
                          <button onClick={function() { setScreenshot(null); }} style={{ ...btnSecondary, color: theme.error, borderColor: theme.error }}>Remove</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={handleCaptureScreenshot} disabled={capturing} style={btnPrimary}>
                        {capturing ? 'Capturing...' : 'Capture Screenshot'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Review */}
            {!success && step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{
                  padding: '10px 14px', borderRadius: 4,
                  background: theme.blueBg, color: theme.blueText, fontSize: 13,
                  border: '1px solid ' + theme.blueBorder
                }}>
                  Please review your feedback before submitting.
                </div>
                <div>
                  <div style={{ fontSize: 12, color: theme.textMuted, fontFamily: "'Inter', sans-serif" }}>Type:</div>
                  <div style={{ fontSize: 14, color: theme.text, fontFamily: "'Inter', sans-serif" }}>{type.toUpperCase()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: theme.textMuted }}>Subject:</div>
                  <div style={{ fontSize: 14, color: theme.text }}>{subject}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: theme.textMuted }}>Description:</div>
                  <div style={{ fontSize: 14, color: theme.text, whiteSpace: 'pre-wrap' }}>{description}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: theme.textMuted }}>Email:</div>
                  <div style={{ fontSize: 14, color: theme.text }}>{email}</div>
                </div>
                {screenshot && (
                  <div>
                    <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>Screenshot:</div>
                    <img src={screenshot} alt="Screenshot" style={{
                      maxWidth: '100%', maxHeight: 200, border: '1px solid ' + theme.border, borderRadius: 4
                    }} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {!success && !showAnnotation && (
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 8,
              padding: '12px 20px', borderTop: '1px solid ' + theme.border
            }}>
              <button onClick={onClose} disabled={submitting} style={btnSecondary}>Cancel</button>
              {step > 0 && (
                <button onClick={handleBack} disabled={submitting} style={btnSecondary}>Back</button>
              )}
              {step < steps.length - 1 ? (
                <button onClick={handleNext} disabled={submitting || capturing} style={btnPrimary}>Next</button>
              ) : (
                <button onClick={handleSubmit} disabled={submitting} style={btnPrimary}>
                  {submitting ? 'Submitting...' : 'Submit Feedback'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
