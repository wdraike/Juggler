/**
 * CalendarEvent — plain domain entity for a normalized calendar event.
 *
 * Mirrors the "Event Object Shape" in src/slices/calendar/README.md. This is a
 * tolerant value carrier: it MUST accept every shape the existing provider
 * adapters (gcal/msft/apple) already produce without throwing. Adapters emit
 * extra provider-specific fields (Apple: `_url`/`_etag`; MSFT:
 * `isCancelled`/`eventType`/`seriesMasterId`) — those are preserved on the
 * instance so no information is lost during the refactor.
 *
 * Construction is non-throwing for the known adapter shapes. The only hard
 * validation is the field TYPES when present; missing fields default to the
 * same values the adapters' normalizeEvent() use, so behavior is preserved.
 */

/**
 * @param {Object} [props]
 * @param {string} [props.id]
 * @param {string} [props.title]
 * @param {string} [props.description]
 * @param {string} [props.startDateTime]
 * @param {string} [props.endDateTime]
 * @param {?string} [props.startTimezone]
 * @param {boolean} [props.isAllDay]
 * @param {number} [props.durationMinutes]
 * @param {?string} [props.lastModified]
 * @param {boolean} [props.isTransparent]
 * @param {?string} [props.eventUrl]
 * @param {?string} [props.calendarId]
 * @param {*} [props._raw]
 */
function CalendarEvent(props) {
  var p = props || {};

  this.id = p.id != null ? String(p.id) : '';
  this.title = p.title != null ? p.title : '(No title)';
  this.description = p.description != null ? p.description : '';
  this.startDateTime = p.startDateTime != null ? p.startDateTime : '';
  this.endDateTime = p.endDateTime != null ? p.endDateTime : '';
  this.startTimezone = p.startTimezone != null ? p.startTimezone : null;
  this.isAllDay = !!p.isAllDay;
  this.durationMinutes = typeof p.durationMinutes === 'number' ? p.durationMinutes : 30;
  this.lastModified = p.lastModified != null ? p.lastModified : null;
  this.isTransparent = !!p.isTransparent;
  // Apple normalizes via `_url`; fall back to it when no eventUrl is present.
  this.eventUrl = p.eventUrl != null ? p.eventUrl : (p._url != null ? p._url : null);
  this.calendarId = p.calendarId != null ? p.calendarId
    : (p._calendarId != null ? p._calendarId : null);
  this._raw = p._raw != null ? p._raw : null;

  // Preserve provider-specific extras so no data is dropped (behavior-preserving).
  if (p._url != null) this._url = p._url;
  if (p._etag != null) this._etag = p._etag;
  if (p.isCancelled != null) this.isCancelled = !!p.isCancelled;
  if (p.eventType != null) this.eventType = p.eventType;
  if (p.seriesMasterId != null) this.seriesMasterId = p.seriesMasterId;
}

/**
 * Factory. Returns the input unchanged if it is already a CalendarEvent.
 * @param {Object} props
 * @returns {CalendarEvent}
 */
CalendarEvent.from = function from(props) {
  if (props instanceof CalendarEvent) return props;
  return new CalendarEvent(props);
};

module.exports = CalendarEvent;
