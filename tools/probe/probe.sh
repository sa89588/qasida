#!/usr/bin/env bash
# One-off: which book libraries answer from GitHub's servers, and how their pages look.
set -u
mkdir -p out
UA="Mozilla/5.0 (compatible; qasida-books/1.0; +https://github.com/sa89588/qasida)"
i=0
while read -r url; do
  [ -z "$url" ] && continue
  i=$((i+1))
  code=$(curl -sS -L -A "$UA" -m 25 -o "out/$i.body" -w "%{http_code} %{content_type} %{url_effective}" "$url" 2>"out/$i.err")
  echo "$i | $url | $code | $(wc -c < out/$i.body 2>/dev/null)" >> out/index.txt
  gzip -c "out/$i.body" > "out/$i.gz"; rm -f "out/$i.body"
done < tools/probe/urls.txt
