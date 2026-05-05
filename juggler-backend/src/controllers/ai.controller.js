/**
 * AI Controller — Gemini-powered natural language task commands
 *
 * Supports two backends:
 *   1. Vertex AI (USE_VERTEX_AI=true) — GCP service account, no rate limits
 *   2. Gemini API (default) — API key, has rate limits
 *
 * Per-user throttle:
 *   - 2 requests/minute (enforced by express-rate-limit in routes/ai.routes.js)
 *   - 50 requests/day  (enforced here via ai_command_log table)
 */

const db = require('../db');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const USE_VERTEX_AI = process.env.USE_VERTEX_AI === 'true';
const AI_DAILY_LIMIT = 50;

let _genAIClient = null;

function getGenAIClient() {
  if (_genAIClient) return _genAIClient;

  const { GoogleGenAI } = require('@google/genai');

  if (USE_VERTEX_AI) {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.VERTEX_AI_LOCATION || 'us-central1';
    if (!project) throw new Error('GOOGLE_CLOUD_PROJECT required for Vertex AI');
    _genAIClient = new GoogleGenAI({ vertexai: true, project, location });
    console.log('🤖 Juggler AI: Using Vertex AI (project:', project + ')');
  } else {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
    _genAIClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    console.log('🤖 Juggler AI: Using Gemini API with API key');
  }

  return _genAIClient;
}

async function callGemini(prompt, systemPrompt) {
  const client = getGenAIClient();

  const result = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: systemPrompt + '\n\n---\nUser request:\n' + prompt,
    config: {
      temperature: 0.2,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 8192
    }
  });

  if (result.text) {
    return result.text;
  }

  if (result.candidates?.[0]?.content?.parts) {
    return result.candidates[0].content.parts.map(p => p.text || '').join('');
  }

  throw new Error('Unexpected Gemini response structure');
}

/**
 * Check and record the per-user daily AI command quota.
 * Returns { allowed: true } or { allowed: false, remaining: 0 }.
 * Inserts a log row when allowed — counts the attempt regardless of Gemini outcome.
 */
async function checkAndLogDailyQuota(userId) {
  var windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  var row = await db('ai_command_log')
    .where('user_id', userId)
    .where('created_at', '>=', windowStart)
    .count('id as cnt')
    .first();
  var count = Number(row && row.cnt) || 0;
  if (count >= AI_DAILY_LIMIT) {
    return { allowed: false };
  }
  await db('ai_command_log').insert({ user_id: userId });
  return { allowed: true };
}

exports.handleCommand = async (req, res) => {
  try {
    const userId = req.user.id;
    const { command, tasks, statuses, config } = req.body;

    if (!command || !command.trim()) {
      return res.status(400).json({ error: 'No command provided' });
    }

    // Daily quota check (2/min handled by route-level rate limiter)
    var quota = await checkAndLogDailyQuota(userId);
    if (!quota.allowed) {
      return res.status(429).json({ error: 'Daily AI limit reached (' + AI_DAILY_LIMIT + '/day). Try again tomorrow.' });
    }

    // Build system prompt (same structure as original JSX)
    const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Build task lines
    const taskLines = (tasks || []).map(t => {
      var st = (statuses || {})[t.id] || 'open';
      var deps = t.dependsOn || [];
      return t.id + '|' + (t.date || 'TBD') + '|' + (t.time || '') + '|' + st + '|' + (t.project || '') + '|' + t.text + '|' + (t.where || '') + '|' + (t.when || '') + '|' + (t.pri || '') + (t.recurring ? '|recurring' : '') + '|' + (t.dur || 30) + 'm' + (t.deadline ? '|deadline:' + t.deadline : '') + (t.startAfter ? '|start:' + t.startAfter : '') + (deps.length ? '|deps:' + deps.join(',') : '');
    }).join('\n');

    // Build schedule info
    var locSchedules = (config && config.locSchedules) || {};
    var locScheduleDefaults = (config && config.locScheduleDefaults) || {};
    var locScheduleOverrides = (config && config.locScheduleOverrides) || {};
    var timeBlocks = (config && config.timeBlocks) || {};
    var locations = (config && config.locations) || [];
    var tools = (config && config.tools) || [];
    var toolMatrix = (config && config.toolMatrix) || {};

    var schedTemplateStr = 'Schedule templates: ' + Object.keys(locSchedules).map(function(k) { var t = locSchedules[k]; return k + ' (' + t.name + ')' + (t.system ? ' [system]' : ''); }).join(', ');
    schedTemplateStr += '. Day defaults: ' + DAY_NAMES.map(function(d) { return d + '=' + (locScheduleDefaults[d] || 'weekday'); }).join(', ');
    var ovKeys = Object.keys(locScheduleOverrides);
    if (ovKeys.length > 0) schedTemplateStr += '. Overrides: ' + ovKeys.map(function(dk) { return dk + '=' + locScheduleOverrides[dk]; }).join(', ');

    // Scope constraint prepended — must appear before all other instructions so
    // the model sees it first and treats it as the highest-priority rule.
    const scopeConstraint = 'SCOPE RESTRICTION — HIGHEST PRIORITY RULE: You are ONLY a Juggler task management assistant. You may ONLY perform operations that are supported by the JSON ops format below (add/edit/delete tasks, set status, configure schedule, manage locations/tools/blocks). You MUST NOT answer general questions, provide information, write code, do math, summarize web content, or help with anything unrelated to managing the user\'s Juggler tasks and schedule. If the user\'s request cannot be fulfilled with the available ops, respond with ONLY this JSON and nothing else: {"ops":[],"msg":"I can only help with Juggler tasks and scheduling. Try: \'add a task to buy milk\', \'mark email task done\', or \'reschedule my afternoon tasks\'.","unsupported":true}\n\n';

    const sysPrompt = scopeConstraint + 'You are an AI assistant embedded in a task tracker called Juggler. Today is ' + todayStr + '. Respond with ONLY valid JSON (no markdown, no code fences).\n\nOpen tasks (id|date|time|status|project|text|where|when|pri|dur|due|start|deps):\n' + taskLines + '\n\nLocation: ' + schedTemplateStr + '\n\nCurrent config:\n- Locations: ' + locations.map(function(l) { return l.id + '(' + l.name + ')'; }).join(', ') + '\n- Tools: ' + tools.map(function(t) { return t.id + '(' + t.name + ')'; }).join(', ') + '\n- Tool matrix: ' + JSON.stringify(toolMatrix) + '\n- Time blocks (per day): ' + DAY_NAMES.map(function(dn) { var bl = timeBlocks[dn] || []; return dn + ': ' + bl.map(function(b) { return b.tag + '@' + (b.loc || 'home') + '(' + Math.floor(b.start / 60) + '-' + Math.floor(b.end / 60) + ')'; }).join(','); }).join('; ') + '\n\nJSON format: {"ops":[...],"msg":"summary"}\nTask ops:\n- {"op":"status","id":"ID","value":"done|cancel|wip|open|skip|"}\n- {"op":"edit","id":"ID","fields":{"date":"M/D","time":"H:MM AM/PM","dur":60,"due":"M/D","startAfter":"M/D","when":"morning,biz","pri":"P1","recurring":true,"dependsOn":["t01","t02"]}}\n- {"op":"add","task":{"id":"ai001","date":"M/D","day":"Mon","text":"desc","time":"H:MM AM/PM","project":"X","pri":"P2","where":"anywhere","when":"anytime","dayReq":"any","section":"","notes":"","dur":30,"due":"","startAfter":"","recurring":false,"dependsOn":[]}}\n- {"op":"delete","id":"ID"}\nConfig ops:\n- {"op":"set_weekly","day":"Mon","location":"work"} (sets biz+lunch blocks)\n- {"op":"set_block_loc","day":"Mon","blockTag":"morning","location":"home"} (set one block)\n- {"op":"add_location","id":"gym","name":"Gym","icon":"\\ud83c\\udfcb\\ufe0f"}\n- {"op":"add_tool","id":"tablet","name":"Tablet","icon":"\\ud83d\\udcf1"}\n- {"op":"set_tool_matrix","location":"home","tools":["phone","personal_pc"]}\n- {"op":"set_blocks","day":"Mon","blocks":[{"id":"b1","tag":"morning","name":"Morning","start":360,"end":480,"color":"#F59E0B","icon":"\\u2600\\ufe0f"}]}\n- {"op":"clone_blocks","from":"Mon","to":["Tue","Wed","Thu","Fri"]}\nDependencies: dependsOn is an array of task IDs that must be done before this task can start.\nOnly include needed ops. dur is in minutes. Due dates are HARD deadlines. startAfter delays scheduling until that date. Keep msg short.\n\n## Project Creation\nWhen the user asks to create a project, plan, or breakdown:\n1. Create multiple tasks with the SAME project name using "add" ops\n2. Use temporary IDs like ai001, ai002, ai003 etc.\n3. Link tasks with dependsOn referencing these temp IDs. Example: ai003.dependsOn=["ai001","ai002"] means ai003 cannot start until ai001 and ai002 are done.\n4. Set realistic durations (dur in minutes), priorities (P1=critical, P2=important, P3=normal, P4=low), and reasonable date ranges\n5. Leave date as "" and time as "" to let the scheduler place them automatically\n6. Structure as a proper dependency chain: early tasks have no deps, later tasks depend on earlier ones\n7. Include a due date on the final milestone task if the user specifies a deadline\n\nExample — "create a project to launch a website":\n{"ops":[\n{"op":"add","task":{"id":"ai001","date":"","day":"","text":"Design wireframes","time":"","project":"Website Launch","pri":"P1","where":"anywhere","when":"morning,lunch,afternoon,evening,night","dayReq":"any","section":"","notes":"","dur":120,"due":"","startAfter":"","recurring":false,"dependsOn":[]}},\n{"op":"add","task":{"id":"ai002","date":"","day":"","text":"Write copy and content","time":"","project":"Website Launch","pri":"P2","where":"anywhere","when":"morning,lunch,afternoon,evening,night","dayReq":"any","section":"","notes":"","dur":90,"due":"","startAfter":"","recurring":false,"dependsOn":[]}},\n{"op":"add","task":{"id":"ai003","date":"","day":"","text":"Build frontend","time":"","project":"Website Launch","pri":"P1","where":"anywhere","when":"morning,lunch,afternoon,evening,night","dayReq":"any","section":"","notes":"","dur":240,"due":"","startAfter":"","recurring":false,"dependsOn":["ai001"]}},\n{"op":"add","task":{"id":"ai004","date":"","day":"","text":"Integrate content","time":"","project":"Website Launch","pri":"P2","where":"anywhere","when":"morning,lunch,afternoon,evening,night","dayReq":"any","section":"","notes":"","dur":60,"due":"","startAfter":"","recurring":false,"dependsOn":["ai002","ai003"]}},\n{"op":"add","task":{"id":"ai005","date":"","day":"","text":"Test and QA","time":"","project":"Website Launch","pri":"P1","where":"anywhere","when":"morning,lunch,afternoon,evening,night","dayReq":"any","section":"","notes":"","dur":90,"due":"","startAfter":"","recurring":false,"dependsOn":["ai004"]}},\n{"op":"add","task":{"id":"ai006","date":"","day":"","text":"Deploy to production","time":"","project":"Website Launch","pri":"P1","where":"anywhere","when":"morning,lunch,afternoon,evening,night","dayReq":"any","section":"","notes":"","dur":30,"due":"","startAfter":"","recurring":false,"dependsOn":["ai005"]}}\n],"msg":"Created Website Launch project with 6 linked tasks"}';

    // Sanitize user input
    var safeCmd = command.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—/g, '--').replace(/–/g, '-').replace(/…/g, '...');

    const raw = await callGemini(safeCmd, sysPrompt);

    // Parse JSON from response
    var cleaned = raw.replace(/```json|```/g, '').trim();
    var result;
    try {
      result = JSON.parse(cleaned);
    } catch (pe) {
      var jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { result = JSON.parse(jsonMatch[0]); } catch (pe2) { /* fall through */ }
      }
      if (!result) {
        return res.status(422).json({ error: 'Bad JSON from AI', raw: cleaned.substring(0, 500).replace(/[<>&"']/g, '') });
      }
    }

    // Model flagged the request as outside Juggler scope
    if (result.unsupported) {
      return res.json({ ops: [], msg: result.msg || 'That request is outside what I can help with in Juggler.', unsupported: true });
    }

    res.json({ ops: result.ops || [], msg: result.msg || 'Done.' });
  } catch (err) {
    console.error('AI command error:', err);
    res.status(500).json({ error: err.message || 'AI command failed' });
  }
};
