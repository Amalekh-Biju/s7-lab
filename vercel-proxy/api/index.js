/**
 * S7 Lab — Vercel Serverless AI & Internet Proxy
 * Relays terminal requests from college/restricted networks to Gemini, Groq, OpenAI, or OpenRouter,
 * with built-in live Internet Search Grounding (Google Search Grounding + DuckDuckGo/Wikipedia fallback).
 *
 * Works both on Vercel Serverless Functions AND as a standalone Node.js server (`node api/index.js`).
 */

const fs = require("fs");
const path = require("path");

// Load .env if present
for (const p of [path.join(__dirname, "../.env"), path.join(__dirname, "../../.env")]) {
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Proxy-Secret, X-API-Key, X-Provider",
};

async function fetchWebContext(query) {
  const results = [];
  const sources = [];
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const ddgResp = await fetch(ddgUrl, { headers: { "User-Agent": "S7-Lab-Proxy/1.0" } });
    if (ddgResp.ok) {
      const ddg = await ddgResp.json();
      if (ddg.AbstractText) {
        results.push(`Summary: ${ddg.AbstractText}`);
        if (ddg.AbstractURL) sources.push(ddg.AbstractURL);
      }
      if (Array.isArray(ddg.RelatedTopics)) {
        for (const t of ddg.RelatedTopics.slice(0, 4)) {
          if (t.Text) results.push(`- ${t.Text}`);
          if (t.FirstURL) sources.push(t.FirstURL);
        }
      }
    }
  } catch (_) {}

  try {
    const htmlResp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
      },
    });
    if (htmlResp.ok) {
      const html = await htmlResp.text();
      const snippetRegex = /class="result__snippet[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      let count = 0;
      while ((match = snippetRegex.exec(html)) !== null && count < 5) {
        const clean = match[1].replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim();
        if (clean) {
          results.push(`Web Snippet: ${clean}`);
          count++;
        }
      }
    }
  } catch (_) {}

  return {
    contextText: results.length > 0 ? `Live Web Search Results:\n${results.join("\n")}` : "",
    sources: [...new Set(sources)].slice(0, 5),
  };
}

// Free-tier model cascade: starts with the lightest/highest-quota Flash-Lite model
// and automatically falls back if any model hits a free-tier rate limit (429).
const FREE_TIER_GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemma-4-26b-a4b-it",
];

async function callGemini({ apiKey, model, prompt, system, history }) {
  const candidateModels = model ? [model, ...FREE_TIER_GEMINI_MODELS.filter((m) => m !== model)] : FREE_TIER_GEMINI_MODELS;

  const contents = [];
  if (Array.isArray(history)) {
    for (const h of history) {
      if (!h || !h.content) continue;
      contents.push({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: String(h.content) }],
      });
    }
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });

  const lastErrors = [];
  for (const modelName of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const isGemma = modelName.startsWith("gemma-");
    const body = isGemma
      ? {
          contents: [
            ...(system ? [{ role: "user", parts: [{ text: `System Instruction:\n${system}` }] }] : []),
            ...contents,
          ],
        }
      : {
          contents,
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      const data = await resp.json();
      const candidate = (data.candidates && data.candidates[0]) || {};
      const parts = (candidate.content && candidate.content.parts) || [];
      const textParts = parts.filter((p) => !p.thought).map((p) => p.text || "");
      const reply = (textParts.length ? textParts : parts.map((p) => p.text || "")).join("\n").trim();
      return { reply, provider: `gemini (${modelName})`, sources: [] };
    }

    const errText = await resp.text();
    lastErrors.push(`${modelName} -> HTTP ${resp.status}: ${errText.slice(0, 150)}`);
  }

  throw new Error(lastErrors.join(" | "));
}

async function callOpenAICompatible({ endpoint, apiKey, model, prompt, system, history, providerLabel }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  if (Array.isArray(history)) {
    for (const h of history) {
      if (h && h.content) {
        messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: String(h.content) });
      }
    }
  }
  messages.push({ role: "user", content: prompt });

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`${providerLabel} HTTP ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const reply = data.choices?.[0]?.message?.content || "";
  return { reply, provider: `${providerLabel} (${model})`, sources: [] };
}

async function handleAIRequest(reqBody, env, reqHeaders) {
  const prompt = (reqBody.prompt || reqBody.q || "").trim();
  if (!prompt) {
    return { error: "Missing 'prompt' in request body.", status: 400 };
  }

  const search = reqBody.search !== false;
  let system =
    reqBody.system ||
    "You are a concise, terminal-friendly Cyber Security Lab Assistant for Ubuntu Linux and PowerShell. Provide copy-paste ready commands and short bullet points.";
  const history = reqBody.history || [];
  const requestedProvider = (reqBody.provider || reqHeaders["x-provider"] || "auto").toLowerCase();
  const passKey = reqHeaders["x-api-key"] || reqBody.api_key || "";

  let webSources = [];
  if (search) {
    const webData = await fetchWebContext(prompt);
    if (webData.contextText) {
      system += `\n\n${webData.contextText}`;
      webSources = webData.sources;
    }
  }

  const geminiKey =
    (requestedProvider === "gemini" && passKey) ||
    env.GEMINI_API_KEY ||
    (passKey.startsWith("AIza") || passKey.startsWith("AQ.") ? passKey : "");
  const groqKey = (requestedProvider === "groq" && passKey) || env.GROQ_API_KEY || (passKey.startsWith("gsk_") ? passKey : "");
  const openaiKey = (requestedProvider === "openai" && passKey) || env.OPENAI_API_KEY || (passKey.startsWith("sk-") && !passKey.startsWith("sk-or-") ? passKey : "");
  const openrouterKey = (requestedProvider === "openrouter" && passKey) || env.OPENROUTER_API_KEY || (passKey.startsWith("sk-or-") ? passKey : "");

  const attempts = [];

  if ((requestedProvider === "auto" || requestedProvider === "gemini") && geminiKey) {
    attempts.push(() =>
      callGemini({
        apiKey: geminiKey,
        model: reqBody.model || env.GEMINI_MODEL || "gemini-3.5-flash-lite",
        prompt,
        system,
        history,
      })
    );
  }
  if ((requestedProvider === "auto" || requestedProvider === "groq") && groqKey) {
    attempts.push(() =>
      callOpenAICompatible({
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        apiKey: groqKey,
        model: reqBody.model || env.GROQ_MODEL || "llama-3.3-70b-versatile",
        prompt,
        system,
        history,
        providerLabel: "groq",
      })
    );
  }
  if ((requestedProvider === "auto" || requestedProvider === "openai") && openaiKey) {
    attempts.push(() =>
      callOpenAICompatible({
        endpoint: "https://api.openai.com/v1/chat/completions",
        apiKey: openaiKey,
        model: reqBody.model || env.OPENAI_MODEL || "gpt-4o-mini",
        prompt,
        system,
        history,
        providerLabel: "openai",
      })
    );
  }
  if ((requestedProvider === "auto" || requestedProvider === "openrouter") && openrouterKey) {
    attempts.push(() =>
      callOpenAICompatible({
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: openrouterKey,
        model: reqBody.model || env.OPENROUTER_MODEL || "google/gemini-2.5-flash",
        prompt,
        system,
        history,
        providerLabel: "openrouter",
      })
    );
  }

  if (attempts.length === 0) {
    if (webSources.length > 0 || system.includes("Live Web Search Results:")) {
      const webPart = system.split("Live Web Search Results:\n")[1] || "";
      return {
        data: {
          reply: `[Web Search Results Only — Set GEMINI_API_KEY or GROQ_API_KEY for full AI synthesis]\n\n${webPart}`,
          provider: "duckduckgo-web-search",
          sources: webSources,
        },
        status: 200,
      };
    }
    return {
      error:
        "No API key configured on Vercel server or passed in X-API-Key header. Set GEMINI_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in Vercel Environment Variables.",
      status: 500,
    };
  }

  const errors = [];
  for (const fn of attempts) {
    try {
      const res = await fn();
      res.sources = [...new Set([...(res.sources || []), ...webSources])].slice(0, 5);
      return { data: res, status: 200 };
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }

  return { error: `All upstream AI providers failed: ${errors.join(" | ")}`, status: 502 };
}

module.exports = async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.setHeader(k, v);
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  const baseUrl = `${proto}://${host}`;
  const parsedUrl = new URL(req.url || "/", baseUrl);
  const path = parsedUrl.pathname;

  if (process.env.PROXY_SECRET) {
    const clientSecret = req.headers["x-proxy-secret"] || parsedUrl.searchParams.get("secret") || "";
    if (clientSecret !== process.env.PROXY_SECRET) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Unauthorized: Invalid X-Proxy-Secret" }));
    }
  }

  if (path === "/" || path === "/help" || path === "/health" || path === "/api/health") {
    const helpText = [
      "======================================================================",
      " S7 CYBER SECURITY LAB — VERCEL AI PROXY SERVER (ONLINE)",
      "======================================================================",
      "",
      "1. Ubuntu / Linux Terminal (curl):",
      `   curl -s "${baseUrl}/ask?q=nmap+flags+for+os+detection"`,
      `   curl -s "${baseUrl}/ask" -d "wpscan enumerate users and plugins"`,
      "",
      "2. Windows PowerShell:",
      `   irm "${baseUrl}/ask?q=sqlmap+dump+users+table"`,
      "",
      "3. S7 Lab CLI (Python or PowerShell):",
      `   python3 s7.py config --vercel ${baseUrl}`,
      `   python3 s7.py ask "explain blind sqli in dvwa"`,
      "======================================================================",
    ].join("\n");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(helpText + "\n");
  }

  // Parse request body if not already parsed by Vercel runtime
  let body = req.body;
  if (!body && req.method === "POST") {
    body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (_) {
          resolve(data);
        }
      });
    });
  }

  if (path === "/api/chat" && req.method === "POST") {
    const jsonBody = typeof body === "object" && body !== null ? body : {};
    const result = await handleAIRequest(jsonBody, process.env, req.headers);
    res.statusCode = result.status || 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (result.error) {
      return res.end(JSON.stringify({ error: result.error }));
    }
    return res.end(JSON.stringify(result.data));
  }

  if (path === "/ask" || path === "/api/ask") {
    let prompt = parsedUrl.searchParams.get("q") || "";
    if (!prompt && req.method === "POST") {
      if (typeof body === "string") prompt = body;
      else if (body && typeof body === "object") prompt = body.prompt || body.q || "";
    }
    const result = await handleAIRequest({ prompt, search: true }, process.env, req.headers);
    res.statusCode = result.status || 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    if (result.error) {
      return res.end(`[ERROR] ${result.error}\n`);
    }
    return res.end(`${result.data.reply}\n`);
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.end("Not Found. Try /help, /ask?q=..., or POST /api/chat\n");
};

// Allow running directly with `node vercel-proxy/api/index.js` for local testing
if (require.main === module) {
  const http = require("http");
  const port = process.env.PORT || 8787;
  const server = http.createServer((req, res) => module.exports(req, res));
  server.listen(port, () => {
    console.log(`S7 Local Proxy Test Server listening on http://127.0.0.1:${port}`);
  });
}
