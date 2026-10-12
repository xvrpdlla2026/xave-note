import urllib.request, urllib.parse, ssl, re
ctx = ssl.create_default_context()
queries = [
  'profitable small business philippines 10k capital solo',
  'online small business philippines no vehicle low capital',
  'digital products sell philippines web developer 2025',
  'micro reselling philippines facebook marketplace',
  'passive income philippines solo entrepreneur',
  'home based business philippines small space',
  'freelance web development philippines rates',
  'print on demand philippines capital',
  'virtual assistant services philippines rates',
  'website maintenance services philippines pricing'
]
for q in queries:
    url = 'https://html.duckduckgo.com/html/?q=' + urllib.parse.quote(q)
    try:
        data = urllib.request.urlopen(url, timeout=20, context=ctx).read().decode('utf-8', 'ignore')
        print('=== QUERY:', q)
        print()
        # Extract snippets
        matches = re.findall(r'<a[^>]*class=["\']result__a["\'][^>]*>(.*?)</a>', data)
        for i, snippet in enumerate(matches[:8]):
            snippet_clean = re.sub(r'<[^>]+>', '', snippet)
            snippet_clean = snippet_clean.replace('&#39;', "'").replace('&quot;', '"')
            snippet_clean = snippet_clean[:250].strip()
            if snippet_clean and len(snippet_clean) > 3:
                print(f"  [{i+1}] {snippet_clean}")
        print()
    except Exception as e:
        print('QUERY FAILED:', q, '->', e)
