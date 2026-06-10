/**
 * TimeBlock — a parsed entry of a task's `when` column (Phase H3 / W2).
 * PURE — zero infra requires.
 *
 * CHARACTERIZED from the controller's `when` handling (`validateTaskInput`
 * ~745-771): `when` is a comma-separated list whose parts are trimmed and
 * non-empty-filtered:
 *
 *     String(body.when).split(',').map(s => s.trim()).filter(Boolean)
 *
 * Each part is either a known keyword (VALID_WHEN_KEYWORDS = '', 'fixed',
 * 'allday', 'anytime') or a custom time-block tag (any non-empty string ≤ 30
 * chars — the controller only rejects parts longer than 30 chars). TimeBlock
 * models ONE such tag. {@link TimeBlock.parseWhen} reproduces the controller's
 * split/trim/filter EXACTLY so the parsed list matches the validator's view.
 *
 * Invariant: a tag is a non-empty string ≤ 30 chars (the controller's only `when`
 * constraint — "tag names must be 30 characters or less"). No reshaping of the
 * stored `when` string happens here; TimeBlock is a read-side convenience.
 */

'use strict';

// Verbatim from validateTaskInput. Note: 'allday'/'anytime' here are the `when`
// keywords (distinct from the placement_mode enum 'all_day'/'anytime').
var VALID_WHEN_KEYWORDS = Object.freeze(['', 'fixed', 'allday', 'anytime']);
var MAX_TAG_LENGTH = 30;

/**
 * @param {string} tag A single time-block tag (a keyword or a custom block name).
 * @throws {Error} if `tag` is not a non-empty string ≤ 30 chars (the controller's
 *   only `when`-part constraint).
 */
function TimeBlock(tag) {
  if (typeof tag !== 'string' || tag.length === 0) {
    throw new Error('TimeBlock tag must be a non-empty string, got: ' + JSON.stringify(tag));
  }
  if (tag.length > MAX_TAG_LENGTH) {
    throw new Error('TimeBlock tag must be ' + MAX_TAG_LENGTH + ' characters or less, got length ' + tag.length);
  }
  this.tag = tag;
  Object.freeze(this);
}

/** The known `when` keywords (closed set). @type {ReadonlyArray<string>} */
TimeBlock.VALID_WHEN_KEYWORDS = VALID_WHEN_KEYWORDS;
/** @type {number} */
TimeBlock.MAX_TAG_LENGTH = MAX_TAG_LENGTH;

/**
 * @returns {boolean} whether this tag is one of the known `when` keywords
 *   (vs. a custom time-block name).
 */
TimeBlock.prototype.isKeyword = function isKeyword() {
  return VALID_WHEN_KEYWORDS.indexOf(this.tag) !== -1;
};

/** @returns {string} the raw tag. */
TimeBlock.prototype.toString = function toString() {
  return this.tag;
};

/**
 * @param {*} other
 * @returns {boolean}
 */
TimeBlock.prototype.equals = function equals(other) {
  return other instanceof TimeBlock && other.tag === this.tag;
};

/**
 * Parse a `when` column value into an ordered list of non-empty tag strings —
 * VERBATIM the controller's split/trim/filter (validateTaskInput ~765). Returns
 * `[]` for null/undefined/empty. Does NOT throw on over-length parts (mirrors the
 * controller, which only *flags* them in validation, never throws here).
 * @param {?string} when
 * @returns {string[]} the parsed tag strings.
 */
TimeBlock.parseWhen = function parseWhen(when) {
  if (when === undefined || when === null) return [];
  return String(when).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
};

/**
 * Factory. Returns the input unchanged if it is already a TimeBlock.
 * @param {(TimeBlock|string)} tag
 * @returns {TimeBlock}
 */
TimeBlock.from = function from(tag) {
  if (tag instanceof TimeBlock) return tag;
  return new TimeBlock(tag);
};

module.exports = TimeBlock;
