/**
 * S7 Lab — Cloudflare Worker AI & Internet Proxy
 * Relays terminal requests from college/restricted networks to Gemini, Groq, OpenAI, or OpenRouter,
 * with built-in live Internet Search Grounding (Google Search Grounding + DuckDuckGo/Wikipedia fallback).
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Proxy-Secret, X-API-Key, X-Provider",
};

async function fetchWebContext(query) {
  const results = [];
  const sources = [];
  try {
    // 1. DuckDuckGo Instant Answer API
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
    // 2. DuckDuckGo HTML Lite scrape for live web snippets
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
      // Filter out internal thought parts if present
      const textParts = parts.filter((p) => !p.thought).map((p) => p.text || "");
      const reply = (textParts.length ? textParts : parts.map((p) => p.text || "")).join("\n").trim();
      return { reply, provider: `gemini (${modelName})`, sources: [] };
    }

    const errText = await resp.text();
    lastErrors.push(`${modelName} -> HTTP ${resp.status}: ${errText.slice(0, 150)}`);
    // Continue to next free-tier model on 429 (quota) or 404/503
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

async function handleAIRequest(reqBody, env, headers) {
  const prompt = (reqBody.prompt || reqBody.q || "").trim();
  if (!prompt) {
    return { error: "Missing 'prompt' in request body.", status: 400 };
  }

  const search = reqBody.search !== false;
  let system =
    reqBody.system ||
    "You are a concise, terminal-friendly Cyber Security Lab Assistant for Ubuntu Linux and PowerShell. Provide copy-paste ready commands and short bullet points.";
  const history = reqBody.history || [];
  const requestedProvider = (reqBody.provider || headers.get("x-provider") || "auto").toLowerCase();
  const passKey = headers.get("x-api-key") || reqBody.api_key || "";

  // Perform server-side web context enrichment if search is enabled
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
  if ((requestedProvider === "auto" || requestedProvider === "cf-ai") && env.AI) {
    attempts.push(async () => {
      const cfModel = reqBody.model || "@cf/meta/llama-3.1-8b-instruct";
      const messages = [{ role: "system", content: system }];
      if (Array.isArray(history)) {
        for (const h of history) {
          if (h && h.content) {
            messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: String(h.content) });
          }
        }
      }
      messages.push({ role: "user", content: prompt });
      const res = await env.AI.run(cfModel, { messages });
      return {
        reply: res.response || JSON.stringify(res),
        provider: `cloudflare-workers-ai (${cfModel})`,
        sources: [],
      };
    });
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
        "No API key configured on proxy server or passed in X-API-Key header. Set GEMINI_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in your Cloudflare/Vercel environment.",
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Optional Proxy Secret check
    if (env.PROXY_SECRET) {
      const clientSecret = request.headers.get("x-proxy-secret") || url.searchParams.get("secret") || "";
      if (clientSecret !== env.PROXY_SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized: Invalid X-Proxy-Secret" }), {
          status: 401,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    if (path === "/" || path === "/help" || path === "/health") {
      const helpText = [
        "======================================================================",
        " S7 CYBER SECURITY LAB — CLOUDFLARE AI PROXY SERVER (ONLINE)",
        "======================================================================",
        "",
        "1. Ubuntu / Linux Terminal (curl):",
        `   curl -s "${url.origin}/ask?q=nmap+flags+for+os+detection"`,
        `   curl -s "${url.origin}/ask" -d "wpscan enumerate users and plugins"`,
        "",
        "2. Windows PowerShell:",
        `   irm "${url.origin}/ask?q=sqlmap+dump+users+table"`,
        "",
        "3. S7 Lab CLI (Python or PowerShell):",
        `   python3 s7.py config --cloudflare ${url.origin}`,
        `   python3 s7.py ask "explain blind sqli in dvwa"`,
        "======================================================================",
      ].join("\n");
      return new Response(helpText + "\n", {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (path === "/api/chat" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (_) {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      const result = await handleAIRequest(body, env, request.headers);
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status || 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(result.data), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (path === "/ask") {
      let prompt = url.searchParams.get("q") || "";
      if (!prompt && request.method === "POST") {
        const contentType = request.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const j = await request.json().catch(() => ({}));
          prompt = j.prompt || j.q || "";
        } else {
          prompt = await request.text();
        }
      }
      const result = await handleAIRequest({ prompt, search: true }, env, request.headers);
      if (result.error) {
        return new Response(`[ERROR] ${result.error}\n`, {
          status: result.status || 500,
          headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      return new Response(`${result.data.reply}\n`, {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not Found. Try /help, /ask?q=..., or POST /api/chat\n", {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
