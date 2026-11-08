# s7-lab

If you forget everything tomorrow, just type this one command in any terminal to see all commands:
```bash
# Ubuntu / Linux / Windows CMD:
curl -sL https://arxec-lab.vercel.app

# Windows PowerShell (use curl.exe or irm):
curl.exe -sL https://arxec-lab.vercel.app
irm https://arxec-lab.vercel.app
```

Or launch the full tool directly in 1 line:
```bash
curl -sL arxec-lab.vercel.app/s7 -o s7 && bash s7
```

---

Terminal reference for all 8 S7 Cyber Security Lab experiments + Vercel/Cloudflare AI proxy.
No Python or extra packages required (`s7` uses pure Bash on Linux; `s7.ps1` uses native PowerShell on Windows).

## Commands

**Ubuntu / Linux:**
```bash
./s7                 # Interactive menu (Up/Down arrows or 1-8, c=cmds-only, s=search, a=AI, h=help)
./s7 help            # Show help & keybindings
./s7 7               # Full step-by-step instructions + commands for Exp 7
./s7 c 7             # Commands-Only mode for Exp 7 (only commands & payloads)
./s7 list            # List all 8 experiments
./s7 s hydra         # Search across all experiments
./s7 ai "question"   # Ask AI via proxy or free-tier fallback
./s7 cfg             # Configure Vercel / Cloudflare proxy URLs
```

**Windows PowerShell:**
```powershell
.\s7.ps1             # Interactive menu
.\s7.ps1 help        # Show help & keybindings
.\s7.ps1 7           # Full instructions + commands for Exp 7
.\s7.ps1 c 7         # Commands-Only mode for Exp 7
.\s7.ps1 s hydra     # Search
.\s7.ps1 ai "query"  # Ask AI
```

## Interactive Navigation Keys

Inside `./s7`:
- **`↑`/`↓` + `Enter`** (or **`1`–`8`**) — Open an experiment
- **`c`** — Switch to **Commands-Only** view
- **`f`** — Switch to **Full Instructions** view
- **`n`** / **`p`** — Next / Previous experiment
- **`s`** — Search keyword
- **`a`** — Ask AI
- **`h`** — Help
- **`b`** — Back to menu
- **`q`** — Quit

## Deploy Proxy (Vercel / Cloudflare)

```bash
./deploy.sh
./s7 cfg --vercel https://your-app.vercel.app --cloudflare https://your-worker.workers.dev
```
