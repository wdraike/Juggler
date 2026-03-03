/**
 * AI Controller — Gemini-powered natural language task commands
 */

const db = require('../db');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function callGemini(prompt, systemPrompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const payload = {
    contents: [
      { role: 'user', parts: [{ text: systemPrompt + '\n\n---\nUser request:\n' + prompt }] }
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 8192
    }
  };

  const resp = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
    return data.candidates[0].content.parts.map(p => p.text || '').join('');
  }
  throw new Error('Unexpected Gemini response structure');
}

exports.handleCommand = async (req, res) => {
  try {
    const userId = req.user.id;
    const { command, tasks, statuses, config } = req.body;

    if (!command || !command.trim()) {
      return res.status(400).json({ error: 'No command provided' });
    }

    // Build system prompt (same structure as original JSX)
    const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Build task lines
    const taskLines = (tasks || []).map(t => {
      var st = (statuses || {})[t.id] || 'open';
      var deps = t.dependsOn || [];
      return t.id + '|' + (t.date || 'TBD') + '|' + (t.time || '') + '|' + st + '|' + (t.project || '') + '|' + t.text + '|' + (t.where || '') + '|' + (t.when || '') + '|' + (t.pri || '') + (t.habit ? '|habit' : '') + '|' + (t.dur || 30) + 'm' + (t.due ? '|due:' + t.due : '') + (t.startAfter ? '|start:' + t.startAfter : '') + (deps.length ? '|deps:' + deps.join(',') : '');
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

    const sysPrompt = 'You are an AI assistant embedded in a task tracker called Juggler. Today is ' + todayStr + '. Respond with ONLY valid JSON (no markdown, no code fences).\n\nOpen tasks (id|date|time|status|project|text|where|when|pri|dur|due|start|deps):\n' + taskLines + '\n\nLocation: ' + schedTemplateStr + '\n\nCurrent config:\n- Locations: ' + locations.map(function(l) { return l.id + '(' + l.name + ')'; }).join(', ') + '\n- Tools: ' + tools.map(function(t) { return t.id + '(' + t.name + ')'; }).join(', ') + '\n- Tool matrix: ' + JSON.stringify(toolMatrix) + '\n- Time blocks (per day): ' + DAY_NAMES.map(function(dn) { var bl = timeBlocks[dn] || []; return dn + ': ' + bl.map(function(b) { return b.tag + '@' + (b.loc || 'home') + '(' + Math.floor(b.start / 60) + '-' + Math.floor(b.end / 60) + ')'; }).join(','); }).join('; ') + '\n\nJSON format: {"ops":[...],"msg":"summary"}\nTask ops:\n- {"op":"status","id":"ID","value":"done|cancel|wip|open|skip|"}\n- {"op":"edit","id":"ID","fields":{"date":"M/D","time":"H:MM AM/PM","dur":60,"due":"M/D","startAfter":"M/D","when":"morning,biz","pri":"P1","habit":true,"dependsOn":["t01","t02"]}}\n- {"op":"add","task":{"id":"ai001","date":"M/D","day":"Mon","text":"desc","time":"H:MM AM/PM","project":"X","pri":"P2","where":"anywhere","when":"anytime","dayReq":"any","section":"","notes":"","dur":30,"due":"","startAfter":"","habit":false,"dependsOn":[]}}\n- {"op":"delete","id":"ID"}\nConfig ops:\n- {"op":"set_weekly","day":"Mon","location":"work"} (sets biz+lunch blocks)\n- {"op":"set_block_loc","day":"Mon","blockTag":"morning","location":"home"} (set one block)\n- {"op":"add_location","id":"gym","name":"Gym","icon":"\\ud83c\\udfcb\\ufe0f"}\n- {"op":"add_tool","id":"tablet","name":"Tablet","icon":"\\ud83d\\udcf1"}\n- {"op":"set_tool_matrix","location":"home","tools":["phone","personal_pc"]}\n- {"op":"set_blocks","day":"Mon","blocks":[{"id":"b1","tag":"morning","name":"Morning","start":360,"end":480,"color":"#F59E0B","icon":"\\u2600\\ufe0f"}]}\n- {"op":"clone_blocks","from":"Mon","to":["Tue","Wed","Thu","Fri"]}\nDependencies: dependsOn is an array of task IDs that must be completed before this task can start.\nOnly include needed ops. dur is in minutes. Due dates are HARD deadlines. startAfter delays scheduling until that date. Keep msg short.';

    // Sanitize user input
    var safeCmd = command.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2014/g, '--').replace(/\u2013/g, '-').replace(/\u2026/g, '...');

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
        return res.status(422).json({ error: 'Bad JSON from AI', raw: cleaned.substring(0, 500) });
      }
    }

    res.json({ ops: result.ops || [], msg: result.msg || 'Done.' });
  } catch (err) {
    console.error('AI command error:', err);
    res.status(500).json({ error: err.message || 'AI command failed' });
  }
};
