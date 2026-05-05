const express = require('express');
const router = express.Router();
const taskController = require('../controllers/task.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { checkTaskOrRecurringLimit, checkBatchTaskLimits } = require('../middleware/entity-limits');

router.use(authenticateJWT, resolvePlanFeatures);

router.get('/', taskController.getAllTasks);
router.get('/version', taskController.getVersion);
router.get('/disabled', taskController.getDisabledTasks);

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

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
    const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const USE_VERTEX_AI = process.env.USE_VERTEX_AI === 'true';

    const { GoogleGenAI } = require('@google/genai');
    let client;
    if (USE_VERTEX_AI) {
      const project = process.env.GOOGLE_CLOUD_PROJECT;
      const location = process.env.VERTEX_AI_LOCATION || 'us-central1';
      if (!project) return res.json({ icon: null });
      client = new GoogleGenAI({ vertexai: true, project, location });
    } else {
      if (!GEMINI_API_KEY) return res.json({ icon: null });
      client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    }

    const prompt = 'Reply with exactly one emoji that best represents this task. No text, punctuation, or explanation — just the emoji.\n\nTask: ' + text;

    const result = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: { temperature: 0.4, maxOutputTokens: 16 }
    });

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
    console.error('suggest-icon error:', err.message || err);
    return res.json({ icon: null });
  }
});

router.get('/:id', taskController.getTask);
router.post('/', checkTaskOrRecurringLimit, taskController.createTask);
router.post('/batch', checkBatchTaskLimits, taskController.batchCreateTasks);
router.put('/batch', taskController.batchUpdateTasks);
router.put('/:id/status', taskController.updateTaskStatus);
router.put('/:id/re-enable', taskController.reEnableTask);
router.put('/:id/unpin', taskController.unpinTask);
router.put('/:id', taskController.updateTask);
router.delete('/:id', taskController.deleteTask);

module.exports = router;
