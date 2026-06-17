const express = require('express');
const router = express.Router();
const taskController = require('../controllers/task.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { checkTaskOrRecurringLimit, checkBatchTaskLimits } = require('../middleware/entity-limits');
const { requireFeature } = require('../middleware/feature-gate');
const { validate } = require('../middleware/validate');
const { taskCreateSchema, taskUpdateSchema } = require('../schemas/task.schema');
const aiEnrichment = require('../slices/ai-enrichment/facade');
const AI_USE_CASES = require('../constants/ai-use-cases');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('task.routes');

router.use(authenticateJWT, resolvePlanFeatures);

router.get('/', taskController.getAllTasks);
router.get('/version', taskController.getVersion);
router.get('/disabled', taskController.getDisabledTasks);
router.get('/search', taskController.searchTasks);

/**
 * GET /api/tasks/suggest-icon?text=<task text>
 *
 * Asks Gemini Flash for a single emoji icon that best represents the task.
 * Always succeeds — returns { icon: null } on any error or invalid response.
 * Validates that the returned value is a single emoji (<=4 chars, non-ASCII).
 */
router.get('/suggest-icon', async (req, res) => {
  try {
    const text = (req.query.text || '').trim();
    if (!text) {
      return res.json({ icon: null });
    }

    const prompt = 'Reply with exactly one emoji that best represents this task. No text, punctuation, or explanation — just the emoji.\n\nTask: ' + text;

    const result = await aiEnrichment.generate(
      prompt,
      { temperature: 0.4, maxOutputTokens: 16 },
      { useCase: AI_USE_CASES.EMOJI_SUGGEST, userId: req.user?.id || null },
    );

    let raw = '';
    if (result.text) {
      raw = result.text.trim();
    } else if (result.candidates?.[0]?.content?.parts) {
      raw = result.candidates[0].content.parts.map(p => p.text || '').join('').trim();
    }

    // Validate: must be non-empty, non-ASCII (emoji), and <= 4 chars (covers multi-codepoint emoji)
    if (!raw || raw.length > 4 || !/\P{ASCII}/u.test(raw)) {
      return res.json({ icon: null });
    }

    return res.json({ icon: raw });
  } catch (err) {
    logger.error('suggest-icon error:', err.message || err);
    return res.json({ icon: null });
  }
});

router.get('/:id', taskController.getTask);
router.post('/', requireFeature('tasks.create'), checkTaskOrRecurringLimit, validate(taskCreateSchema), taskController.createTask);
router.post('/batch', requireFeature('tasks.create'), checkBatchTaskLimits, taskController.batchCreateTasks);
router.put('/batch', taskController.batchUpdateTasks);
router.put('/:id/status', taskController.updateTaskStatus);
router.put('/:id/re-enable', taskController.reEnableTask);
router.post('/:id/take-ownership', taskController.takeOwnership);
router.put('/:id', validate(taskUpdateSchema), taskController.updateTask);
router.delete('/:id', taskController.deleteTask);

module.exports = router;
