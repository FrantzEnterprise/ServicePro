import re, subprocess, tempfile, os
with open('/tmp/lockpro/index.html') as f:
    h = f.read()

js = h
rx = js.find('function renderStep')
rend = js.find('\nfunction', rx+1)
region = js[rx:rend]

# Old: ne.innerHTML=bb+'<button class="primary" onclick="answerInput(\''+key+'\')">Continue →</button>';
m = re.search(r"ne\.innerHTML=bb\+'.*answerInput.*Continue .*?;", region)
if m:
    line = m.group(0)
    # Insert navBtn declaration before assigning ne.innerHTML
    # We need: var navBtn=step.upload?'finishUpload(\''+key+'\')':'answerInput(\''+key+'\')';
    # But this is inside a string context in JS. The var declaration goes in JS code:
    old_full = "else{var bb=s.step>0?'<button onclick=\"back(\\''+key+'\\')\">← Back</button>':'';ne.innerHTML=" + line
    new_full = "else{var bb=s.step>0?'<button onclick=\"back(\\''+key+'\\')\">← Back</button>':'';var navBtn=step.upload?'finishUpload(\\''+key+'\\')':'answerInput(\\''+key+'\\')';ne.innerHTML=" + line.replace(
        "onclick=\"answerInput(\\''+key+'\\')\">Continue",
        "onclick=\"'+navBtn+'\">Continue")
    if old_full in js:
        js = js.replace(old_full, new_full)
        print('Nav fixed with navBtn')
    else:
        print('old_full not found, trying line-only replace')
        # Just add navBtn var before ne.innerHTML within if(step.opts)...else block
        # Simpler: replace the onclick part AND add var before ne.innerHTML
        if line in js:
            js = js.replace(line, "var navBtn=step.upload?'finishUpload(\\''+key+'\\')':'answerInput(\\''+key+'\\')';" + line.replace(
                "onclick=\"answerInput(\\''+key+'\\')\">Continue",
                "onclick=\"'+navBtn+'\">Continue"))
            print('Nav fixed (line replace)')

# Verify
script_start = js.find('<script>')+8
script_end = js.rfind('</script>')
js_only = js[script_start:script_end]
with tempfile.NamedTemporaryFile(suffix='.js', mode='w', delete=False) as f:
    f.write(js_only)
    tn = f.name
r = subprocess.run(['node', '--check', tn], capture_output=True, text=True, timeout=10)
print(f'JS valid: {r.returncode == 0}')
if r.returncode != 0:
    print(r.stderr[:400])
os.unlink(tn)

with open('/tmp/lockpro/index.html', 'w') as f:
    f.write(js)
print('Saved')
