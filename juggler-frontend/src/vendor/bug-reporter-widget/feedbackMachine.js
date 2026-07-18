/**
 * feedbackMachine — framework-free state machine for the shared feedback
 * widget (999.1363). Both host widgets (RO MUI shell, juggler plain shell)
 * drive their UI from this via useReducer(transition, initialState(...)).
 *
 * Owns: step flow, dirty tracking, the dismissal ruling (ESC/backdrop/button
 * close only an untouched form; dirty asks confirm-discard; success always
 * closes; dismissal ignored while submitting/annotating/capturing), submit
 * validation (the rules both hosts already share: subject >=3, description
 * >=10, email must contain '@'), late-prefill rebaselining, annotation and
 * capture detours. Does NOT own: rendering, screenshot capture I/O, the
 * fetch client — hosts drive those and report back via events.
 *
 * Closing does NOT wipe the form — hosts animate the dialog out and the
 * content must stay visible until unmount. OPEN performs the reset.
 */

const STEPS = { DETAILS: 0, SCREENSHOT: 1, REVIEW: 2 };
const LAST_STEP = STEPS.REVIEW;

const SUBJECT_MIN = 3;
const DESCRIPTION_MIN = 10;

function blankForm(prefill) {
  return {
    type: 'bug',
    subject: '',
    description: '',
    email: (prefill && prefill.email) || '',
  };
}

function initialState(prefill) {
  const form = blankForm(prefill);
  return {
    status: 'closed', // closed | editing | capturing | annotating | submitting | success
    step: STEPS.DETAILS,
    form,
    initialForm: { ...form },
    screenshot: null,
    error: null,
    validationError: null,
    confirmDiscard: false,
  };
}

function isDirty(state) {
  if (state.screenshot) return true;
  return Object.keys(state.form).some((k) => state.form[k] !== state.initialForm[k]);
}

// Step-0 gate — both hosts require all three fields present before leaving Details.
function canNext(state) {
  if (state.step !== STEPS.DETAILS) return state.step < LAST_STEP;
  return (
    state.form.subject.trim().length > 0 &&
    state.form.description.trim().length > 0 &&
    state.form.email.trim().length > 0
  );
}

// Submit gate — the validation both hosts implemented separately, consolidated.
function submitValidationError(state) {
  if (state.form.subject.trim().length < SUBJECT_MIN) {
    return `Subject must be at least ${SUBJECT_MIN} characters.`;
  }
  if (state.form.description.trim().length < DESCRIPTION_MIN) {
    return `Description must be at least ${DESCRIPTION_MIN} characters.`;
  }
  if (!state.form.email.includes('@')) {
    return 'A valid email address is required.';
  }
  return null;
}

function canSubmit(state) {
  return (
    state.status === 'editing' &&
    state.step === STEPS.REVIEW &&
    submitValidationError(state) === null
  );
}

function freshOpen(state) {
  return { ...initialState({ email: state.initialForm.email }), status: 'editing' };
}

function close(state) {
  // Form intentionally left intact for the close animation; OPEN resets.
  return { ...state, status: 'closed', confirmDiscard: false };
}

function transition(state, event) {
  switch (event.type) {
    case 'OPEN':
      return freshOpen(state);

    // Late-arriving auth prefill (hosts resolve user email async, often after
    // OPEN). Rebaselines form+initialForm together so an untouched form stays
    // clean under the dismissal ruling — but never overwrites user input.
    case 'PREFILL': {
      const email = event.email || '';
      if (!email || state.form.email === email) return state; // no-op — same reference back
      if (state.form.email !== state.initialForm.email) return state; // user typed — ignore
      return {
        ...state,
        form: { ...state.form, email },
        initialForm: { ...state.initialForm, email },
      };
    }

    case 'CHANGE':
      if (state.status !== 'editing') return state;
      return {
        ...state,
        form: { ...state.form, [event.field]: event.value },
        validationError: null,
      };

    case 'NEXT': {
      if (state.status !== 'editing') return state;
      if (!canNext(state)) {
        return { ...state, validationError: 'Subject, description, and email are required.' };
      }
      return { ...state, step: Math.min(state.step + 1, LAST_STEP), validationError: null };
    }

    case 'BACK':
      if (state.status !== 'editing') return state;
      return { ...state, step: Math.max(state.step - 1, STEPS.DETAILS) };

    case 'SET_SCREENSHOT':
      if (state.status !== 'editing') return state;
      return { ...state, screenshot: event.screenshot };

    case 'CAPTURE_START':
      if (state.status !== 'editing') return state;
      return { ...state, status: 'capturing', error: null };

    case 'CAPTURE_DONE':
      if (state.status !== 'capturing') return state;
      return { ...state, status: 'editing', screenshot: event.screenshot };

    case 'CAPTURE_FAIL':
      if (state.status !== 'capturing') return state;
      return { ...state, status: 'editing', error: event.message };

    case 'ANNOTATE_START':
      if (state.status !== 'editing') return state;
      return { ...state, status: 'annotating' };

    // Both hosts jump straight to Review once annotation completes.
    case 'ANNOTATE_DONE':
      if (state.status !== 'annotating') return state;
      return { ...state, status: 'editing', screenshot: event.screenshot, step: STEPS.REVIEW };

    // Both hosts discard the shot on annotation cancel.
    // ponytail: single cancel semantics; if an edit-existing-screenshot path
    // ever wants keep-on-cancel, add an event flag then.
    case 'ANNOTATE_CANCEL':
      if (state.status !== 'annotating') return state;
      return { ...state, status: 'editing', screenshot: null };

    case 'SUBMIT': {
      if (state.status !== 'editing' || state.step !== STEPS.REVIEW) return state;
      const invalid = submitValidationError(state);
      if (invalid) return { ...state, validationError: invalid };
      return { ...state, status: 'submitting', error: null, validationError: null };
    }

    case 'SUBMIT_OK':
      if (state.status !== 'submitting') return state;
      return { ...state, status: 'success' };

    case 'SUBMIT_FAIL':
      if (state.status !== 'submitting') return state;
      return { ...state, status: 'editing', error: event.message };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    case 'DISMISS': {
      if (state.status === 'submitting' || state.status === 'annotating' || state.status === 'capturing') {
        return state;
      }
      if (state.status === 'closed') return state;
      if (state.status === 'success') return close(state);
      if (isDirty(state)) return { ...state, confirmDiscard: true };
      return close(state);
    }

    case 'CONFIRM_DISCARD':
      if (!state.confirmDiscard) return state;
      return close(state);

    case 'CANCEL_DISCARD':
      return { ...state, confirmDiscard: false };

    default:
      return state;
  }
}

module.exports = {
  STEPS,
  SUBJECT_MIN,
  DESCRIPTION_MIN,
  initialState,
  transition,
  canNext,
  canSubmit,
  isDirty,
};
