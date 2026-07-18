/**
 * 999.1363 — vendor drift guard (juggler). src/vendor/bug-reporter-widget is
 * a COPY of bug-reporter-service/shared/widget/dist (CRA cannot consume the
 * symlinked package's JSX/peer deps). Pins the copy to the source of truth so
 * a forgotten scripts/sync-widget.sh fails juggler's suite.
 *
 * Skips (with a loud warning) when the bug-reporter-service checkout is not
 * present next to this repo (e.g. an isolated CI checkout).
 */
const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '../../../vendor/bug-reporter-widget');
const SOURCE = path.join(
  __dirname,
  '../../../../../../bug-reporter-service/shared/widget/dist'
);

const FILES = ['FeedbackDialog.js', 'FeedbackButton.js', 'AnnotationCanvas.js', 'feedbackMachine.js', 'widget.css'];

const sourcePresent = fs.existsSync(SOURCE);

(sourcePresent ? describe : describe.skip)('vendored bug-reporter widget matches dist', () => {
  test.each(FILES)('%s is byte-identical to bug-reporter-service dist', (f) => {
    expect(fs.readFileSync(path.join(VENDOR, f), 'utf8')).toBe(
      fs.readFileSync(path.join(SOURCE, f), 'utf8')
    );
  });
});

if (!sourcePresent) {
  // eslint-disable-next-line no-console
  console.warn('[vendorDrift] bug-reporter-service checkout not found — drift check skipped');
  test('vendor files exist even without the source checkout', () => {
    FILES.forEach((f) => expect(fs.existsSync(path.join(VENDOR, f))).toBe(true));
  });
}
