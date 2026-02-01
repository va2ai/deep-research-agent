/**
 * Cloudflare Worker: Upgraded Deep Research Agent API
 *
 * Routes:
 * - POST /research
 *   body: { "question": "..." , "options": { ...optional overrides... } }
 *
 * Env vars:
 * - OPENAI_API_KEY (required)
 * - OPENAI_MODEL (optional, default "gpt-5")
 *
 * Optional overrides in request body.options:
 * - maxSearchRounds (default 4)
 * - maxFacts (default 18)
 * - minNewFactsPerRound (default 2)
 * - webContextSize ("low"|"medium"|"high", default "medium")
 * - forceDomains (array of domain suffixes, e.g. [".gov", ".edu", "openai.com"]) // optional filter
 */

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Basic CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      if (url.pathname === "/health") {
        return json({ ok: true, service: "deep-research-agent" }, 200);
      }

      if (url.pathname === "/docs" || url.pathname === "/") {
        return new Response(docsHtml(), {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      // Cancel a background response
      const cancelMatch = url.pathname.match(/^\/cancel\/(.+)$/);
      if (cancelMatch && request.method === "POST") {
        if (!validateApiKey(request, env)) {
          return json({ error: "Unauthorized. Valid X-API-Key header required." }, 401);
        }

        const responseId = cancelMatch[1];
        const cancelResp = await fetch(`https://api.openai.com/v1/responses/${responseId}/cancel`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        });

        const cancelData = await cancelResp.json();
        return json({
          ok: cancelResp.ok,
          response_id: responseId,
          status: cancelData.status,
          data: cancelData,
        }, cancelResp.ok ? 200 : cancelResp.status);
      }

      // Get status of a background response
      const statusMatch = url.pathname.match(/^\/status\/(.+)$/);
      if (statusMatch && request.method === "GET") {
        if (!validateApiKey(request, env)) {
          return json({ error: "Unauthorized. Valid X-API-Key header required." }, 401);
        }

        const responseId = statusMatch[1];
        const statusResp = await fetch(`https://api.openai.com/v1/responses/${responseId}`, {
          headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          },
        });

        const statusData = await statusResp.json();
        return json({
          ok: statusResp.ok,
          response_id: responseId,
          status: statusData.status,
          data: statusData,
        }, statusResp.ok ? 200 : statusResp.status);
      }

      // Resume/poll a background response until completion
      const resumeMatch = url.pathname.match(/^\/research\/(resp_[a-zA-Z0-9_]+)$/);
      if (resumeMatch && request.method === "GET") {
        if (!validateApiKey(request, env)) {
          return json({ error: "Unauthorized. Valid X-API-Key header required." }, 401);
        }

        const responseId = resumeMatch[1];
        const result = await handleResumeResponse({ responseId, env });
        return json(result, result.ok ? 200 : (result.status_code || 500));
      }

      if (url.pathname === "/research" && request.method === "POST") {
        // Validate API key for research endpoint
        if (!validateApiKey(request, env)) {
          return json({ error: "Unauthorized. Valid X-API-Key header required." }, 401);
        }

        const body = await safeJson(request);
        if (!body || typeof body.question !== "string" || !body.question.trim()) {
          return json({ error: "Missing required field: question (string)" }, 400);
        }

        const question = body.question.trim();
        const options = body.options || {};

        const cfg = {
          // Model settings
          model: options.model || env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: clampFloat(options.temperature, 0, 2, null),
          top_p: clampFloat(options.top_p, 0, 1, null),
          max_output_tokens: options.max_output_tokens ? clampInt(options.max_output_tokens, 1, 128000) : null,

          // Reasoning settings (for o1/o3 models)
          reasoning_effort: normalizeReasoningEffort(options.reasoning_effort),

          // Instructions/system prompt
          instructions: typeof options.instructions === "string" ? options.instructions : null,

          // Research agent settings
          maxSearchRounds: clampInt(options.maxSearchRounds ?? 4, 1, 10),
          maxFacts: clampInt(options.maxFacts ?? 18, 5, 50),
          minNewFactsPerRound: clampInt(options.minNewFactsPerRound ?? 2, 0, 10),

          // Web search settings
          webContextSize: normalizeWebContextSize(options.webContextSize ?? "medium"),
          forceDomains: Array.isArray(options.forceDomains) ? options.forceDomains : null,
          userLocation: normalizeUserLocation(options.userLocation),

          // Storage
          store: options.store !== false,

          // Deep research options (for o3-deep-research, o4-mini-deep-research)
          background: options.background === true,
          codeInterpreter: options.codeInterpreter === true,
          maxToolCalls: options.maxToolCalls ? clampInt(options.maxToolCalls, 1, 1000) : null,
          reasoningSummary: normalizeReasoningSummary(options.reasoningSummary),

          // Retry settings for API calls
          maxRetries: clampInt(options.maxRetries ?? 3, 0, 5),
        };

        if (!env.OPENAI_API_KEY) {
          return json({ error: "OPENAI_API_KEY not configured in Worker environment" }, 500);
        }

        const result = await deepResearchAgent({
          question,
          cfg,
          env,
        });

        return json(result, 200);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json(
        {
          error: err?.message || String(err),
          stack: err?.stack || null,
        },
        500
      );
    }
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  };
}

function validateApiKey(request, env) {
  const apiKey = request.headers.get("X-API-Key");
  if (!env.RECRUITER_API_KEY) {
    // If no key is configured, allow all requests (dev mode)
    return true;
  }
  return apiKey === env.RECRUITER_API_KEY;
}

function docsHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Deep Research Agent API</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 900px; margin: 0 auto; padding: 2rem; background: #f9fafb; }
    h1 { color: #1a1a2e; margin-bottom: 0.5rem; }
    h2 { color: #16213e; margin: 2rem 0 1rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    h3 { color: #0f3460; margin: 1.5rem 0 0.5rem; }
    p { margin-bottom: 1rem; }
    code { background: #e5e7eb; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
    pre { background: #1a1a2e; color: #e5e7eb; padding: 1rem; border-radius: 8px; overflow-x: auto; margin: 1rem 0; }
    pre code { background: none; padding: 0; }
    .endpoint { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin: 1rem 0; }
    .method { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 4px; font-weight: bold; font-size: 0.85rem; margin-right: 0.5rem; }
    .post { background: #10b981; color: white; }
    .get { background: #3b82f6; color: white; }
    .path { font-family: monospace; font-size: 1.1rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #e5e7eb; }
    th { background: #f3f4f6; font-weight: 600; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-left: 0.5rem; }
    .required { background: #fecaca; color: #991b1b; }
    .optional { background: #d1fae5; color: #065f46; }
    .subtitle { color: #6b7280; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <h1>Deep Research Agent API</h1>
  <p class="subtitle">AI-powered multi-round web research with fact extraction, synthesis, and validation.</p>

  <h2>Endpoints</h2>

  <div class="endpoint">
    <p><span class="method get">GET</span><span class="path">/health</span></p>
    <p>Health check endpoint.</p>
    <h3>Response</h3>
    <pre><code>{ "ok": true, "service": "deep-research-agent" }</code></pre>
  </div>

  <div class="endpoint">
    <p><span class="method get">GET</span><span class="path">/research/:responseId</span></p>
    <p>Resume polling for a background deep research job. Use this to check on jobs that failed due to rate limits or timeouts.</p>
    <h3>Path Parameters</h3>
    <table>
      <tr><th>Parameter</th><th>Description</th></tr>
      <tr><td><code>responseId</code></td><td>The response_id returned from the initial POST /research call (e.g., resp_abc123)</td></tr>
    </table>
    <h3>Authentication</h3>
    <p>Requires <code>X-API-Key</code> header.</p>
    <h3>Behavior</h3>
    <ul style="margin-left: 1.5rem;">
      <li>If the job is <strong>completed</strong>: Returns the full answer immediately</li>
      <li>If the job is <strong>in_progress/queued</strong>: Polls until complete (max 30 min)</li>
      <li>If the job <strong>failed</strong>: Returns error details</li>
      <li>If <strong>rate limited</strong> during polling: Returns with instructions to retry later</li>
    </ul>
    <h3>Example</h3>
    <pre><code>curl -H "X-API-Key: YOUR_KEY" \\
  "https://deep-research-agent.vetapp.workers.dev/research/resp_abc123"</code></pre>
    <h3>Response</h3>
    <pre><code>{
  "ok": true,
  "answer": "...",
  "response_id": "resp_abc123",
  "mode": "deep_research",
  "raw_response": { ... },
  "trace": [ ... ]
}</code></pre>
  </div>

  <div class="endpoint">
    <p><span class="method post">POST</span><span class="path">/research</span></p>
    <p>Execute a deep research query with multi-round web search, fact extraction, and validated synthesis.</p>

    <h3>Request Body</h3>
    <table>
      <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      <tr><td><code>question</code><span class="badge required">required</span></td><td>string</td><td>The research question to answer</td></tr>
      <tr><td><code>options</code><span class="badge optional">optional</span></td><td>object</td><td>Configuration overrides (see below)</td></tr>
    </table>

    <h3>Model Options</h3>
    <table>
      <tr><th>Option</th><th>Type</th><th>Default</th><th>Description</th></tr>
      <tr><td><code>model</code></td><td>string</td><td>"gpt-4o-mini"</td><td>OpenAI model (o3-deep-research, o4-mini-deep-research, gpt-5.2, gpt-4.1, gpt-4o, o3, etc.)</td></tr>
      <tr><td><code>temperature</code></td><td>number</td><td>null</td><td>Sampling temperature (0-2)</td></tr>
      <tr><td><code>top_p</code></td><td>number</td><td>null</td><td>Nucleus sampling (0-1)</td></tr>
      <tr><td><code>max_output_tokens</code></td><td>number</td><td>null</td><td>Max tokens to generate (1-128000)</td></tr>
      <tr><td><code>reasoning_effort</code></td><td>string</td><td>null</td><td>For o1/o3 models: "low", "medium", or "high"</td></tr>
      <tr><td><code>instructions</code></td><td>string</td><td>null</td><td>System instructions/prompt</td></tr>
      <tr><td><code>store</code></td><td>boolean</td><td>true</td><td>Whether to store response in OpenAI</td></tr>
      <tr><td><code>maxRetries</code></td><td>number</td><td>3</td><td>Max retry attempts for failed API calls (0-5)</td></tr>
    </table>

    <h3>Deep Research Options (o3-deep-research, o4-mini-deep-research)</h3>
    <table>
      <tr><th>Option</th><th>Type</th><th>Default</th><th>Description</th></tr>
      <tr><td><code>background</code></td><td>boolean</td><td>false</td><td>Run in background mode (recommended for long tasks)</td></tr>
      <tr><td><code>codeInterpreter</code></td><td>boolean</td><td>false</td><td>Enable Python code execution for data analysis</td></tr>
      <tr><td><code>maxToolCalls</code></td><td>number</td><td>null</td><td>Max tool calls before returning (1-1000)</td></tr>
      <tr><td><code>reasoningSummary</code></td><td>string</td><td>null</td><td>Reasoning summary: "auto", "concise", or "detailed"</td></tr>
    </table>
    <p style="font-size:0.9rem;color:#6b7280;margin:0.5rem 0 1rem;">Deep research models can analyze hundreds of sources and take 10-30+ minutes. Use background mode to prevent timeouts.</p>

    <h3>Research Agent Options</h3>
    <table>
      <tr><th>Option</th><th>Type</th><th>Default</th><th>Description</th></tr>
      <tr><td><code>maxSearchRounds</code></td><td>number</td><td>4</td><td>Max search iterations (1-10)</td></tr>
      <tr><td><code>maxFacts</code></td><td>number</td><td>18</td><td>Max facts to collect (5-50)</td></tr>
      <tr><td><code>minNewFactsPerRound</code></td><td>number</td><td>2</td><td>Min new facts per round before stagnation (0-10)</td></tr>
    </table>

    <h3>Web Search Options</h3>
    <table>
      <tr><th>Option</th><th>Type</th><th>Default</th><th>Description</th></tr>
      <tr><td><code>webContextSize</code></td><td>string</td><td>"medium"</td><td>Search depth: "low", "medium", or "high"</td></tr>
      <tr><td><code>forceDomains</code></td><td>array</td><td>null</td><td>Restrict sources to specific domains (e.g., [".gov", ".edu"])</td></tr>
      <tr><td><code>userLocation</code></td><td>object</td><td>null</td><td>Location for localized results (see below)</td></tr>
    </table>

    <h3>User Location Object</h3>
    <table>
      <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      <tr><td><code>country</code></td><td>string</td><td>ISO 2-letter country code (e.g., "US", "GB")</td></tr>
      <tr><td><code>city</code></td><td>string</td><td>City name (e.g., "San Francisco")</td></tr>
      <tr><td><code>region</code></td><td>string</td><td>State/region (e.g., "California")</td></tr>
      <tr><td><code>timezone</code></td><td>string</td><td>IANA timezone (e.g., "America/Los_Angeles")</td></tr>
    </table>

    <h3>Authentication</h3>
    <p>This endpoint requires an API key. Include it in the <code>X-API-Key</code> header.</p>

    <h3>Example Request</h3>
    <pre><code>curl -X POST "https://deep-research-agent.vetapp.workers.dev/research" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{
    "question": "What is the OpenAI Responses API?",
    "options": {
      "model": "gpt-4o",
      "temperature": 0.7,
      "maxSearchRounds": 3,
      "maxFacts": 12,
      "webContextSize": "medium",
      "forceDomains": ["openai.com", ".edu"],
      "userLocation": { "country": "US" }
    }
  }'</code></pre>

    <h3>Response</h3>
    <table>
      <tr><th>Field</th><th>Description</th></tr>
      <tr><td><code>ok</code></td><td>Success boolean</td></tr>
      <tr><td><code>question</code></td><td>Original question</td></tr>
      <tr><td><code>answer</code></td><td>Synthesized answer with [F#] citations</td></tr>
      <tr><td><code>fact_table</code></td><td>Array of extracted facts with URLs, confidence, and quality scores</td></tr>
      <tr><td><code>conflicts</code></td><td>Detected conflicting claims between sources</td></tr>
      <tr><td><code>plan</code></td><td>Research plan with queries and stop conditions</td></tr>
      <tr><td><code>validation</code></td><td>Validation results and any issues found</td></tr>
      <tr><td><code>trace</code></td><td>Execution trace for debugging</td></tr>
      <tr><td><code>startedAt</code> / <code>finishedAt</code></td><td>Timestamps</td></tr>
    </table>
  </div>

  <h2>Source Quality Scoring</h2>
  <table>
    <tr><th>Score</th><th>Source Types</th></tr>
    <tr><td>5</td><td>.gov, .edu domains</td></tr>
    <tr><td>4</td><td>Standards bodies (IETF, W3C, ISO), official docs, academic publishers</td></tr>
    <tr><td>3</td><td>Reference sites (Wikipedia, Britannica)</td></tr>
    <tr><td>2</td><td>Blogs, general websites</td></tr>
    <tr><td>1</td><td>Social media (X, Reddit, TikTok)</td></tr>
  </table>

  <h2>Pipeline Stages</h2>
  <ol style="margin-left: 1.5rem;">
    <li><strong>Planner</strong> - Generates 6-10 search queries and stop conditions</li>
    <li><strong>Web Search</strong> - Multi-round searches using OpenAI's web_search tool</li>
    <li><strong>Fact Extraction</strong> - Extracts atomic, verifiable facts with confidence scores</li>
    <li><strong>Synthesis</strong> - Combines facts into a coherent answer with citations</li>
    <li><strong>Validation</strong> - Verifies all claims are supported by extracted facts</li>
  </ol>

</body>
</html>`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function safeJson(request) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeWebContextSize(v) {
  const s = String(v || "").toLowerCase();
  if (s === "low" || s === "medium" || s === "high") return s;
  return "medium";
}

function clampFloat(v, min, max, defaultVal) {
  if (v === null || v === undefined) return defaultVal;
  const n = Number(v);
  if (!Number.isFinite(n)) return defaultVal;
  return Math.max(min, Math.min(max, n));
}

function normalizeReasoningEffort(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s === "low" || s === "medium" || s === "high") return s;
  return null;
}

function normalizeReasoningSummary(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s === "auto" || s === "concise" || s === "detailed") return s;
  return null;
}

function isDeepResearchModel(model) {
  return model && model.includes("deep-research");
}

/**
 * Retry with exponential backoff for transient failures
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Max retry attempts (default: 3)
 * @param {number} options.baseDelayMs - Base delay in ms (default: 1000)
 * @param {Function} options.shouldRetry - Function to check if error is retryable
 */
async function retryWithBackoff(fn, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      // For OpenAI responses, check if it's a retryable error response
      if (result && !result.ok && shouldRetry(result)) {
        lastError = result;
        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }
      }
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && shouldRetry({ error: err })) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  return lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determines if an error/response should trigger a retry
 * Retries on: rate limits (429), server errors (5xx), network errors
 */
function defaultShouldRetry(result) {
  if (!result) return false;

  // HTTP status-based retry
  const status = result.status;
  if (status === 429) return true; // Rate limited
  if (status >= 500 && status < 600) return true; // Server errors

  // Network/fetch errors
  if (result.error instanceof Error) {
    const msg = result.error.message?.toLowerCase() || '';
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('econnreset')) {
      return true;
    }
  }

  return false;
}

function normalizeUserLocation(v) {
  if (!v || typeof v !== "object") return null;
  const loc = { type: "approximate" };
  if (v.country && typeof v.country === "string") loc.country = v.country.toUpperCase().slice(0, 2);
  if (v.city && typeof v.city === "string") loc.city = v.city;
  if (v.region && typeof v.region === "string") loc.region = v.region;
  if (v.timezone && typeof v.timezone === "string") loc.timezone = v.timezone;
  return Object.keys(loc).length > 1 ? loc : null;
}

function buildWebSearchTool(cfg, contextSize) {
  // Deep research models only support "medium" context size
  const size = isDeepResearchModel(cfg.model) ? "medium" : (contextSize || cfg.webContextSize || "medium");
  const tool = {
    type: "web_search_preview",
    search_context_size: size,
  };
  if (cfg.userLocation) {
    tool.user_location = cfg.userLocation;
  }
  return tool;
}

function buildPayloadOptions(cfg) {
  const opts = {};
  if (cfg.temperature !== null) opts.temperature = cfg.temperature;
  if (cfg.top_p !== null) opts.top_p = cfg.top_p;
  if (cfg.max_output_tokens !== null) opts.max_output_tokens = cfg.max_output_tokens;
  if (cfg.instructions) opts.instructions = cfg.instructions;
  if (cfg.store === false) opts.store = false;

  // Reasoning options
  if (cfg.reasoning_effort || cfg.reasoningSummary) {
    opts.reasoning = {};
    if (cfg.reasoning_effort) opts.reasoning.effort = cfg.reasoning_effort;
    if (cfg.reasoningSummary) opts.reasoning.summary = cfg.reasoningSummary;
  }

  // Deep research options
  if (isDeepResearchModel(cfg.model)) {
    if (cfg.background) opts.background = true;
    // Default to 50 tool calls to avoid rate limits (can be overridden)
    opts.max_tool_calls = cfg.maxToolCalls || 50;
  }

  return opts;
}

function buildTools(cfg, contextSize) {
  const tools = [buildWebSearchTool(cfg, contextSize || cfg.webContextSize)];

  // Add code interpreter for deep research models if enabled
  if (isDeepResearchModel(cfg.model) && cfg.codeInterpreter) {
    tools.push({
      type: "code_interpreter",
      container: { type: "auto" }
    });
  }

  return tools;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function sliceJsonBlock(text) {
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i !== -1 && j !== -1 && j > i) return text.slice(i, j + 1);
  return text;
}

function domainQualityScore(url) {
  const u = (url || "").toLowerCase();

  // Highest trust
  if (u.endsWith(".gov") || u.includes(".gov/")) return 5;
  if (u.endsWith(".edu") || u.includes(".edu/")) return 5;

  // Strong doc/spec signals
  const docSignals = ["standards", "ietf.org", "iso.org", "w3.org", "docs.", "developer.", "api-reference"];
  if (docSignals.some((x) => u.includes(x))) return 4;

  // Academic/research
  const researchSignals = ["acm.org", "ieee.org", "nature.com", "science.org", "arxiv.org"];
  if (researchSignals.some((x) => u.includes(x))) return 4;

  // Reference
  const okSignals = ["wikipedia.org", "britannica.com"];
  if (okSignals.some((x) => u.includes(x))) return 3;

  // Blogs
  const lowSignals = ["medium.com", "substack.com", "blogspot", "wordpress"];
  if (lowSignals.some((x) => u.includes(x))) return 2;

  // Social
  const veryLow = ["x.com", "twitter.com", "reddit.com", "tiktok.com"];
  if (veryLow.some((x) => u.includes(x))) return 1;

  return 2;
}

function dedupeFacts(facts) {
  const seen = new Set();
  const out = [];
  for (const f of facts) {
    const key = (f.fact || "").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function normalizeUrl(url) {
  return (url || "").trim();
}

function urlAllowedByForceDomains(url, forceDomains) {
  if (!forceDomains || forceDomains.length === 0) return true;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return forceDomains.some((d) => {
      const dd = String(d).toLowerCase().trim();
      if (!dd) return false;
      if (dd.startsWith(".")) return host.endsWith(dd);
      return host === dd || host.endsWith("." + dd);
    });
  } catch {
    return false;
  }
}

/**
 * OpenAI Responses API call for Workers (fetch-based)
 * Includes automatic retry with exponential backoff for transient failures
 */
async function openaiResponsesCreate({ env, payload, maxRetries = 3 }) {
  return retryWithBackoff(
    async () => {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        // keep raw
      }

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: data || { raw: text },
        };
      }

      return { ok: true, status: res.status, data };
    },
    { maxRetries }
  );
}

/**
 * Extracts text from Responses API output.
 * Works with common Responses shapes:
 * - output_text field (sometimes present)
 * - output array with content items
 */
function extractText(respData) {
  if (!respData) return "";

  if (typeof respData.output_text === "string" && respData.output_text) {
    return respData.output_text;
  }

  const out = Array.isArray(respData.output) ? respData.output : [];
  const chunks = [];

  for (const item of out) {
    const content = item?.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if ((c.type === "output_text" || c.type === "text") && c.text) chunks.push(c.text);
      }
    } else if (typeof content === "string") {
      chunks.push(content);
    }
  }

  return chunks.join("\n").trim();
}

async function planner({ question, cfg, env }) {
  const prompt = `
You are a research planner. Create a web research plan for the user question.

User question:
${question}

Return VALID JSON ONLY with this schema:
{
  "queries": ["..."],
  "preferred_source_types": ["official docs", "gov/edu", "standards/specs", "peer-reviewed", "reputable news"],
  "must_answer": ["..."],
  "avoid": ["low-quality blogs", "social posts unless corroborated"],
  "stop_when": {
    "min_distinct_sources": 3,
    "min_facts": 8,
    "no_new_facts_rounds": 2
  }
}

Rules:
- 6 to 10 queries.
- Queries should be specific and varied.
- Put the most important query first.
`.trim();

  const payload = {
    model: cfg.model,
    input: prompt,
    tools: buildTools(cfg, "low"),
    ...buildPayloadOptions(cfg),
  };

  const resp = await openaiResponsesCreate({ env, payload, maxRetries: cfg.maxRetries });
  if (!resp.ok) throw new Error(`OpenAI planner error: ${JSON.stringify(resp.error)}`);

  const text = extractText(resp.data);
  const plan = safeJsonParse(sliceJsonBlock(text)) || {
    queries: [question],
    preferred_source_types: ["official docs", "gov/edu", "standards/specs", "peer-reviewed", "reputable news"],
    must_answer: ["Answer the question with citations"],
    avoid: ["low-quality blogs", "social posts unless corroborated"],
    stop_when: { min_distinct_sources: 3, min_facts: 8, no_new_facts_rounds: 2 },
  };

  return plan;
}

async function webSearch({ query, cfg, env }) {
  // NOTE: This relies on the built-in "web_search" tool via Responses.
  const payload = {
    model: cfg.model,
    input: `Search for: ${query}\n\nAfter searching, provide a structured summary of what you found. For each piece of information, include the source URL.`,
    tools: buildTools(cfg),
    ...buildPayloadOptions(cfg),
  };

  const resp = await openaiResponsesCreate({ env, payload, maxRetries: cfg.maxRetries });
  if (!resp.ok) throw new Error(`OpenAI web_search error: ${JSON.stringify(resp.error)}`);

  // Extract both text response and web search results
  const textResponse = extractText(resp.data);
  const webResults = extractWebSearchResults(resp.data);

  // Combine text response with structured web search results
  let snippetsText = textResponse;
  if (webResults.length > 0) {
    snippetsText += "\n\n--- Web Search Results ---\n";
    for (const result of webResults) {
      snippetsText += `\nSource: ${result.url}\nTitle: ${result.title || 'Unknown'}\nSnippet: ${result.snippet || result.text || ''}\n`;
    }
  }

  return {
    response_id: resp.data.id || null,
    snippetsText,
    raw: resp.data,
  };
}

/**
 * Extracts web search results from Responses API output.
 * Looks for web_search_call items in the output array.
 */
function extractWebSearchResults(respData) {
  const results = [];
  if (!respData || !Array.isArray(respData.output)) return results;

  for (const item of respData.output) {
    // Check for web_search_call type
    if (item.type === "web_search_call" && Array.isArray(item.results)) {
      for (const r of item.results) {
        if (r.url) {
          results.push({
            url: r.url,
            title: r.title || null,
            snippet: r.snippet || r.text || null,
          });
        }
      }
    }

    // Also check content array for search results
    if (Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === "web_search_call" && Array.isArray(c.results)) {
          for (const r of c.results) {
            if (r.url) {
              results.push({
                url: r.url,
                title: r.title || null,
                snippet: r.snippet || r.text || null,
              });
            }
          }
        }
      }
    }
  }

  return results;
}

async function extractFacts({ question, snippets, cfg, env }) {
  const prompt = `
You are a careful fact extractor. Use ONLY the provided snippets.

User question:
${question}

Snippets:
${snippets}

Return VALID JSON ONLY with this schema:
{
  "facts": [
    {
      "fact": "one precise factual statement",
      "url": "source url",
      "title": "source title if available",
      "date": "publication date if available else null",
      "confidence": 1
    }
  ],
  "conflicts": [
    {
      "topic": "what conflicts",
      "claim_a": "short claim",
      "source_a": "url",
      "claim_b": "short claim",
      "source_b": "url"
    }
  ]
}

Rules:
- Facts must be atomic and verifiable.
- Skip opinions/speculation.
- confidence: 1-5 based on snippet clarity + authority.
- Do not invent titles/dates if absent.
`.trim();

  const payload = {
    model: cfg.model,
    input: prompt,
    tools: buildTools(cfg, "low"),
    ...buildPayloadOptions(cfg),
  };

  const resp = await openaiResponsesCreate({ env, payload, maxRetries: cfg.maxRetries });
  if (!resp.ok) throw new Error(`OpenAI extractFacts error: ${JSON.stringify(resp.error)}`);

  const text = extractText(resp.data);
  return safeJsonParse(sliceJsonBlock(text)) || { facts: [], conflicts: [] };
}

async function synthesize({ question, facts, conflicts, cfg, env }) {
  const factLines = facts.map((f, idx) => `[F${idx + 1}] ${f.fact} (src: ${f.url})`).join("\n");
  const conflictsBlock = JSON.stringify(conflicts || [], null, 2);

  const prompt = `
You are a deep research synthesizer.
Answer the user's question using ONLY the provided facts.
Cite evidence inline with [F#] markers.

User question:
${question}

Facts:
${factLines}

Conflicts:
${conflictsBlock}

Write the best possible answer:
- Use short, direct sections.
- If sources conflict, say so explicitly and cite both.
- Do not add facts not present above.
`.trim();

  const payload = {
    model: cfg.model,
    input: prompt,
    tools: buildTools(cfg, "low"),
    ...buildPayloadOptions(cfg),
  };

  const resp = await openaiResponsesCreate({ env, payload, maxRetries: cfg.maxRetries });
  if (!resp.ok) throw new Error(`OpenAI synthesize error: ${JSON.stringify(resp.error)}`);

  return extractText(resp.data);
}

async function validate({ question, facts, draft, cfg, env }) {
  const factLines = facts.map((f, idx) => `[F${idx + 1}] ${f.fact} (src: ${f.url})`).join("\n");

  const prompt = `
You are a strict validator.

User question:
${question}

Allowed evidence (facts):
${factLines}

Draft answer:
${draft}

Task:
1) Identify any claim in the draft that is not supported by the facts.
2) If unsupported claims exist, rewrite the answer to remove/adjust them.
3) Keep citations inline like [F#] after the sentence they support.

Return VALID JSON ONLY:
{
  "ok": true,
  "issues": ["..."],
  "revised_answer": "..."
}
`.trim();

  const payload = {
    model: cfg.model,
    input: prompt,
    tools: buildTools(cfg, "low"),
    ...buildPayloadOptions(cfg),
  };

  const resp = await openaiResponsesCreate({ env, payload, maxRetries: cfg.maxRetries });
  if (!resp.ok) throw new Error(`OpenAI validate error: ${JSON.stringify(resp.error)}`);

  const text = extractText(resp.data);
  return safeJsonParse(sliceJsonBlock(text)) || { ok: false, issues: ["Validator JSON parse failed"], revised_answer: draft };
}

async function runDeepResearchModel({ question, cfg, env }) {
  // Deep research models handle everything internally - just send the question
  const startedAt = new Date().toISOString();
  const trace = [];

  const prompt = `Research and answer this question thoroughly with citations:\n\n${question}`;

  const payload = {
    model: cfg.model,
    input: prompt,
    tools: buildTools(cfg),
    ...buildPayloadOptions(cfg),
  };

  trace.push({ phase: "request", model: cfg.model, background: cfg.background });

  const resp = await openaiResponsesCreate({ env, payload });

  if (!resp.ok) {
    throw new Error(`OpenAI deep research error: ${JSON.stringify(resp.error)}`);
  }

  trace.push({ phase: "initial_response", status: resp.data.status, id: resp.data.id });

  // Handle background mode - need to poll for completion
  if (cfg.background && (resp.data.status === "in_progress" || resp.data.status === "queued")) {
    trace.push({ phase: "background", response_id: resp.data.id, status: "in_progress" });

    // Poll for completion (max 30 minutes for deep research)
    const maxWait = 30 * 60 * 1000; // 30 minutes
    const pollInterval = 5000; // 5 seconds
    const startPoll = Date.now();

    let result = resp.data;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    while ((result.status === "in_progress" || result.status === "queued") && (Date.now() - startPoll) < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval));

      try {
        const pollResp = await fetch(`https://api.openai.com/v1/responses/${result.id}`, {
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        });

        if (!pollResp.ok) {
          const errData = await pollResp.json().catch(() => ({}));

          // Handle rate limit - wait and retry
          if (pollResp.status === 429) {
            consecutiveErrors++;
            const retryAfter = parseInt(pollResp.headers.get("retry-after") || "5", 10);
            trace.push({ phase: "rate_limit", retryAfter, attempt: consecutiveErrors });

            if (consecutiveErrors >= maxConsecutiveErrors) {
              throw new Error(`Rate limit exceeded after ${maxConsecutiveErrors} retries`);
            }

            await new Promise(r => setTimeout(r, retryAfter * 1000));
            continue;
          }

          throw new Error(`Polling error: ${JSON.stringify(errData)}`);
        }

        consecutiveErrors = 0; // Reset on success
        result = await pollResp.json();
        trace.push({ phase: "poll", status: result.status, elapsed: Math.round((Date.now() - startPoll) / 1000) });
      } catch (err) {
        if (err.message.includes("Rate limit")) throw err;
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) throw err;
        trace.push({ phase: "poll_error", error: err.message, attempt: consecutiveErrors });
      }
    }

    if (result.status === "in_progress" || result.status === "queued") {
      throw new Error("Deep research timed out after 30 minutes");
    }

    resp.data = result;
  }

  // Handle failed status
  if (resp.data.status === "failed") {
    const errorInfo = resp.data.error || {};
    trace.push({ phase: "failed", error: errorInfo });

    return {
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      question,
      config: cfg,
      error: errorInfo.message || "Deep research failed",
      error_code: errorInfo.code || "unknown",
      mode: "deep_research",
      response_id: resp.data.id,
      raw_response: resp.data,
      trace,
    };
  }

  const answer = extractText(resp.data);
  trace.push({ phase: "complete", answerLen: answer.length, finalStatus: resp.data.status });

  return {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    question,
    config: cfg,
    answer,
    mode: "deep_research",
    response_id: resp.data.id,
    raw_response: resp.data,
    trace,
  };
}

/**
 * Resume polling for an existing background response.
 * Polls until the response is completed or failed.
 */
async function handleResumeResponse({ responseId, env }) {
  const startedAt = new Date().toISOString();
  const trace = [];

  // Fetch current status
  const initialResp = await fetch(`https://api.openai.com/v1/responses/${responseId}`, {
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
  });

  if (!initialResp.ok) {
    const err = await initialResp.json().catch(() => ({}));
    return {
      ok: false,
      error: err.error?.message || `Failed to fetch response: ${initialResp.status}`,
      response_id: responseId,
      status_code: initialResp.status,
    };
  }

  let result = await initialResp.json();
  trace.push({ phase: "resume", status: result.status, response_id: responseId });

  // If already completed or failed, return immediately
  if (result.status === "completed") {
    const answer = extractText(result);
    return {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      answer,
      mode: "deep_research",
      response_id: responseId,
      raw_response: result,
      trace,
    };
  }

  if (result.status === "failed") {
    const errorInfo = result.error || {};
    return {
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: errorInfo.message || "Deep research failed",
      error_code: errorInfo.code || "unknown",
      mode: "deep_research",
      response_id: responseId,
      raw_response: result,
      trace,
    };
  }

  if (result.status === "cancelled") {
    return {
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: "Research was cancelled",
      mode: "deep_research",
      response_id: responseId,
      raw_response: result,
      trace,
    };
  }

  // Poll for completion (max 30 minutes)
  if (result.status === "in_progress" || result.status === "queued") {
    trace.push({ phase: "polling", status: result.status });

    const maxWait = 30 * 60 * 1000; // 30 minutes
    const pollInterval = 5000; // 5 seconds
    const startPoll = Date.now();
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    while ((result.status === "in_progress" || result.status === "queued") && (Date.now() - startPoll) < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval));

      try {
        const pollResp = await fetch(`https://api.openai.com/v1/responses/${responseId}`, {
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        });

        if (!pollResp.ok) {
          const errData = await pollResp.json().catch(() => ({}));

          // Handle rate limit
          if (pollResp.status === 429) {
            consecutiveErrors++;
            const retryAfter = parseInt(pollResp.headers.get("retry-after") || "10", 10);
            trace.push({ phase: "rate_limit", retryAfter, attempt: consecutiveErrors });

            if (consecutiveErrors >= maxConsecutiveErrors) {
              return {
                ok: false,
                error: `Rate limit exceeded after ${maxConsecutiveErrors} retries. Use GET /research/${responseId} to resume later.`,
                response_id: responseId,
                status: result.status,
                trace,
              };
            }

            await new Promise(r => setTimeout(r, retryAfter * 1000));
            continue;
          }

          throw new Error(`Polling error: ${JSON.stringify(errData)}`);
        }

        consecutiveErrors = 0;
        result = await pollResp.json();
        trace.push({ phase: "poll", status: result.status, elapsed: Math.round((Date.now() - startPoll) / 1000) });
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          return {
            ok: false,
            error: err.message,
            response_id: responseId,
            status: result.status,
            trace,
          };
        }
        trace.push({ phase: "poll_error", error: err.message, attempt: consecutiveErrors });
      }
    }

    // Check final status after polling
    if (result.status === "in_progress" || result.status === "queued") {
      return {
        ok: false,
        error: "Polling timed out after 30 minutes. Use GET /research/" + responseId + " to resume later.",
        response_id: responseId,
        status: result.status,
        trace,
      };
    }
  }

  // Return based on final status
  if (result.status === "completed") {
    const answer = extractText(result);
    trace.push({ phase: "complete", answerLen: answer.length });
    return {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      answer,
      mode: "deep_research",
      response_id: responseId,
      raw_response: result,
      trace,
    };
  }

  if (result.status === "failed") {
    const errorInfo = result.error || {};
    trace.push({ phase: "failed", error: errorInfo });
    return {
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: errorInfo.message || "Deep research failed",
      error_code: errorInfo.code || "unknown",
      mode: "deep_research",
      response_id: responseId,
      raw_response: result,
      trace,
    };
  }

  // Unknown status
  return {
    ok: false,
    error: `Unknown status: ${result.status}`,
    response_id: responseId,
    status: result.status,
    raw_response: result,
    trace,
  };
}

async function deepResearchAgent({ question, cfg, env }) {
  // Use direct deep research mode for deep research models
  if (isDeepResearchModel(cfg.model)) {
    return runDeepResearchModel({ question, cfg, env });
  }

  const trace = [];
  const startedAt = new Date().toISOString();

  const plan = await planner({ question, cfg, env });
  trace.push({ phase: "plan", plan });

  const queries = Array.isArray(plan.queries) ? plan.queries.slice(0, 10) : [question];

  const stop = plan.stop_when || {};
  const minSources = Number(stop.min_distinct_sources || 3);
  const minFacts = Number(stop.min_facts || 8);
  const noNewRoundsLimit = Number(stop.no_new_facts_rounds || 2);

  let allFacts = [];
  let allConflicts = [];
  const seenUrls = new Set();
  let noNewRounds = 0;

  for (let round = 1; round <= cfg.maxSearchRounds; round++) {
    const q = queries[(round - 1) % Math.max(1, queries.length)];

    const search = await webSearch({ query: q, cfg, env });
    trace.push({ phase: "search", round, query: q, response_id: search.response_id, snippetsLen: search.snippetsText?.length || 0 });

    const extracted = await extractFacts({ question, snippets: search.snippetsText, cfg, env });
    let roundFacts = extracted.facts || [];
    const roundConflicts = extracted.conflicts || [];
    const rawFactCount = roundFacts.length;

    // Normalize + score + optional domain filter
    roundFacts = roundFacts
      .map((f) => {
        const url = normalizeUrl(f.url);
        const source_quality = domainQualityScore(url);
        let confidence = Number(f.confidence || 1);

        if (source_quality <= 2 && confidence > 3) confidence = 3;

        return {
          fact: f.fact,
          url,
          title: f.title || null,
          date: f.date || null,
          confidence,
          source_quality,
        };
      })
      .filter((f) => f.fact && f.url && Number(f.confidence) >= 2)
      .filter((f) => urlAllowedByForceDomains(f.url, cfg.forceDomains));

    const before = allFacts.length;
    allFacts = dedupeFacts(allFacts.concat(roundFacts));
    const newFacts = allFacts.length - before;

    for (const f of allFacts) {
      if (f.url) seenUrls.add(f.url);
    }

    if (roundConflicts.length) allConflicts = allConflicts.concat(roundConflicts);

    trace.push({
      phase: "extract",
      round,
      rawFactCount,
      filteredFactCount: roundFacts.length,
      newFacts,
      totalFacts: allFacts.length,
      distinctSources: seenUrls.size,
    });

    if (newFacts < cfg.minNewFactsPerRound) noNewRounds++;
    else noNewRounds = 0;

    if (allFacts.length >= cfg.maxFacts) {
      trace.push({ phase: "stop", reason: "max_facts_reached" });
      break;
    }

    if (seenUrls.size >= minSources && allFacts.length >= minFacts) {
      trace.push({ phase: "stop", reason: "coverage_reached" });
      break;
    }

    if (noNewRounds >= noNewRoundsLimit) {
      trace.push({ phase: "stop", reason: "stagnation" });
      break;
    }
  }

  // Prefer high-quality/high-confidence facts first
  allFacts.sort((a, b) => (b.source_quality - a.source_quality) || (b.confidence - a.confidence));

  const draft = await synthesize({ question, facts: allFacts, conflicts: allConflicts, cfg, env });
  trace.push({ phase: "draft", draftLen: draft.length });

  const validation = await validate({ question, facts: allFacts, draft, cfg, env });
  trace.push({ phase: "validate", validation });

  const answer = validation.ok ? draft : (validation.revised_answer || draft);

  const factTable = allFacts.map((f, idx) => ({
    id: `F${idx + 1}`,
    fact: f.fact,
    url: f.url,
    title: f.title,
    date: f.date,
    confidence: f.confidence,
    source_quality: f.source_quality,
  }));

  return {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    question,
    config: cfg,
    plan,
    fact_table: factTable,
    conflicts: allConflicts,
    answer,
    validation,
    trace,
  };
}
