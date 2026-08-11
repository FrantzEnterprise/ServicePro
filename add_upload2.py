"""Add optional photo upload + video link step to all flows - CORRECTED insertion"""
import re, subprocess, tempfile, os

with open('/tmp/lockpro/index.html') as f:
    h = f.read()

js = h

# ---- 1. Insert upload step before each steps-closing bracket ----
# Target: the ']' that is immediately followed by ',build:function'
# m.start() gives the position of ']' in '],build:function'
markers = [m.start() for m in re.finditer(r'\],\s*build:function', js)]
print('Found steps-closing brackets:', len(markers))
assert len(markers) >= 4, "Expected at least 4 flows"

upload_step = ",{upload:true,key:'media'}"
for pos in reversed(markers[:4]):
    # The ']' at 'pos' is the steps-closing bracket. Insert BEFORE it.
    js = js[:pos] + upload_step + js[pos:]

print('Inserted upload step into 4 flows correctly')

# ---- 2. Add upload branch in renderStep ----
upload_branch = """
  else if(step.upload){
    oe.style.display='none';ie.style.display='block';
    var stored=s.answers.media||{photos:[],video:''};
    ie.innerHTML='<div style="margin:4px 0"><label style="font-size:13px;color:var(--muted);display:block;margin-bottom:6px">Add photos (optional) - tap to attach up to 3 images</label><input type="file" id="'+key+'FileInput" accept="image/*" multiple style="display:none" onchange="handleFiles(\\''+key+'\\',this)"><button class="flow-btn" style="width:100%;margin-bottom:6px" onclick="document.getElementById(\\''+key+'FileInput\\').click()">\\ud83d\\udcf7 Attach Photos ('+stored.photos.length+'/3)</button><div id="'+key+'Thumbs" style="display:flex;flex-wrap:wrap;gap:6px">'+stored.photos.map(function(p){return '<img src="'+p.data+'" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">';}).join('')+'</div></div><div style="margin:8px 0"><label style="font-size:13px;color:var(--muted);display:block;margin-bottom:6px">Or paste a video link (optional)</label><input type="text" id="'+key+'VideoLink" placeholder="https://youtube.com/watch?v=... or iCloud link" value="'+stored.video+'" style="width:100%;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:8px;font-size:13px"></div><p style="color:var(--muted);font-size:11px;margin-bottom:4px">Photos &amp; video optional - you can skip and just send the request.</p>';
  }
"""

nav_marker = "if(step.opts){ne.innerHTML='';}"
nav_pos = js.find(nav_marker, js.find('function renderStep'))
if nav_pos > 0:
    js = js[:nav_pos] + upload_branch + '\n  ' + js[nav_pos:]
    print('Added upload branch to renderStep')

# ---- 3. Update nav so upload step's Continue calls finishUpload ----
old_nav = "ne.innerHTML=bb+'<button class=\"primary\" onclick=\"answerInput"
new_nav = "var navBtn=step.upload?'finishUpload(\\''+key+'\\')':'answerInput(\\''+key+'\\')';ne.innerHTML=bb+'<button class=\"primary\" onclick=\"'+navBtn+'"
if old_nav in js:
    js = js.replace(old_nav, new_nav)
    print('Nav button now routes upload step to finishUpload')
else:
    print('WARNING: nav pattern not found')

# ---- 4. Add helpers ----
helpers = """
function handleFiles(key,input){
  var f=flows[key],s=state[key];s.answers.media=s.answers.media||{photos:[],video:''};
  var files=[].slice.call(input.files||[]).slice(0,3);
  var stored=s.answers.media.photos||[];var remaining=3-stored.length;
  if(files.length>remaining){alert('You can attach up to 3 photos total.');}
  files=files.slice(0,remaining);
  files.forEach(function(file){
    var reader=new FileReader();
    reader.onload=function(e){
      var img=new Image();
      img.onload=function(){
        var maxW=640,maxH=480;var w=img.width,h=img.height;
        if(w>maxW){h=h*maxW/w;w=maxW;}
        if(h>maxH){w=w*maxH/h;h=maxH;}
        var canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        var dataURL=canvas.toDataURL('image/jpeg',0.7);
        stored.push({data:dataURL});s.answers.media.photos=stored;
        renderStep(key);
        var re=document.getElementById(key+'FileInput');if(re)re.value='';
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
function finishUpload(key){
  var f=flows[key],s=state[key];
  s.answers.media=s.answers.media||{photos:[],video:''};
  var vl=document.getElementById(key+'VideoLink');
  if(vl)s.answers.media.video=vl.value.trim();
  s.step++;if(s.step>=f.steps.length)showResult(key);else renderStep(key);
}

"""
ans_pos = js.find('function answer(')
if ans_pos > 0:
    js = js[:ans_pos] + helpers + js[ans_pos:]
    print('Added helpers (handleFiles, finishUpload)')

# ---- 5. Append media to message in showResult ----
old_msg = "var f=flows[key],s=state[key],msg=f.build(s.answers),el="
new_msg = "var f=flows[key],s=state[key],msg=f.build(s.answers);var media=s.answers.media||{};if(media.photos&&media.photos.length){msg+='\\n\\nPHOTOS:\\n';media.photos.forEach(function(p){msg+=p.data+'\\n';});}if(media.video){msg+='\\n\\nVIDEO LINK: '+media.video+'\\n';}var el="
if old_msg in js:
    js = js.replace(old_msg, new_msg)
    print('showResult appends media to message')
else:
    print('WARNING: showResult msg pattern not found')

# ---- Verify ----
# Check upload step is at TOP level of steps[], not inside opts
import re as re2
for mm in re2.finditer(r'placeholder:\'[^\']*\'}\],\{upload:true', js):
    print('UPLOAD STEP CORRECTLY AFTER LAST INPUT STEP:', 'YES' if mm else '')
# Ensure no upload step inside opts arrays (followed by ],key:' not ]},build)
inside_opts = re2.findall(r'"(?:Can schedule|Other)"\s*,\s*\{upload:true', js)
print('Upload step (wrongly) inside opts array:', len(inside_opts))

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
print('Saved. Size:', len(js))
