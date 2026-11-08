#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "1) Deploy Vercel Proxy (vercel-proxy/)"
echo "2) Deploy Cloudflare Worker (cloudflare-worker/)"
echo "3) Run local proxy on http://127.0.0.1:8787"
read -r -p "Select [1-3]: " c

case "$c" in
    1)
        cd "$DIR/vercel-proxy" && npx --yes vercel --prod
        read -r -p "Vercel URL: " u
        [ -n "$u" ] && "$DIR/s7" cfg --vercel "$u"
        ;;
    2)
        cd "$DIR/cloudflare-worker" && npx --yes wrangler deploy
        read -r -p "Cloudflare URL: " u
        [ -n "$u" ] && "$DIR/s7" cfg --cloudflare "$u"
        ;;
    3)
        "$DIR/s7" cfg --vercel "http://127.0.0.1:8787"
        node "$DIR/vercel-proxy/api/index.js"
        ;;
esac
