import re
with open('/tmp/lockpro/index.html') as f:
    h = f.read()
js = h[h.find('<script>')+8:h.rfind('</script>')]

# Find nav line within renderStep
rx = js.find('function renderStep')
rend = js.find('\nfunction', rx+1)
region = js[rx:rend]

# The nav line: ne.innerHTML=bb+'<button class="primary" onclick="answerInput(\''+key+'\')">Continue →</button>';
m = re.search(r"ne\.innerHTML=bb\+'.*answerInput.*Continue.*?;", region)
if m:
    line = m.group(0)
    print('Found nav line:')
    print(line)
    print()
    # Build replacement using actual unicode arrows from the original
    new_line = line.replace(
        "onclick=\"answerInput(\\''+key+'\\')\">Continue",
        "onclick=\"'+navBtn+'\">Continue"
    )
    print('New line:')
    print(new_line)
else:
    print('NOT FOUND')
