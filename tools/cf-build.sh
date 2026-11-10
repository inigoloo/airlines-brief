#!/bin/sh
# Cloudflare Pages build: copies only the public files to dist/ (the API lives in functions/, the sources stay private).
set -e
rm -rf dist && mkdir -p dist
cp index.html shim.js robots.txt dist/
cp -r data img dist/
cat > dist/_headers <<'H'
/*
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: strict-origin-when-cross-origin
/data/*
  Cache-Control: public, max-age=0, must-revalidate
H
cat > dist/_redirects <<'R'
/_blob/:id /img/:id.jpg 200
R
echo "dist/ listo: $(find dist -type f | wc -l) archivos"
