"""Add optional photo upload + video link step to all flows"""
import re, subprocess, tempfile, os

with open('/tmp/lockpro/index.html') as f:
    h = f.read()

js = h

# ---- 1. Insert upload step into each flow's steps array ----
markers = [m.start() for m in re.finditer(r'\]\s*,\s*build:function', js)]
insert_targets = markers[:4]  # resi, comm, auto, safe
upload_step = ",{upload:true,key:'media'}"
for pos in reversed(insert_targets):
    bracket = js.rfind(']', 0, pos)
    js = js[:bracket] + upload_step + js[bracket:]
print('Inserted upload step into 4 flows')

# ---- 2. Add upload branch in renderStep ----
# Add step.upload handling. We need:
#  - Show upload UI in mainQ area (or a dedicated area)
#  - Nav shows Continue button -> finishUpload(key)
# Insert a new branch right after the input branch (after the setTimeout focus block)

upload_branch = """
  else if(step.upload){
    oe.style.display='none';ie.style.display='block';
    var stored=s.answers.media||{photos:[],video:''};
    ie.innerHTML='<div style="margin:4px 0"><label style="font-size:13px;color:var(--muted);display:block;margin-bottom:6px">Add photos (optional) - tap to attach up to 3 images</label><input type="file" id="'+key+'FileInput" accept="image/*" multiple style="display:none" onchange="handleFiles(\\''+key+'\\',this)"><button class="flow-btn" style="width:100%;margin-bottom:6px" onclick="document.getElementById(\\''+key+'FileInput\\').click()">\\ud83d\\udcf7 Attach Photos ('+stored.photos.length+'/3)</button><div id="'+key+'Thumbs" style="display:flex;flex-wrap:wrap;gap:6px">'+stored.photos.map(function(p){return '<img src="'+p.data+'" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">';}).join('')+'</div></div><div style="margin:8px 0"><label style="font-size:13px;color:var(--muted);display:block;margin-bottom:6px">Or paste a video link (optional)</label><input type="text" id="'+key+'VideoLink" placeholder="https://youtube.com/watch?v=... or iCloud link" value="'+stored.video+'" style="width:100%;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:8px;font-size:13px"></div><p style="color:var(--muted);font-size:11px;margin-bottom:4px">Photos &amp; video optional - you can skip and just send the request.</p>';
  }
"""

# Insert upload branch after the input branch's focus timeout, before the closing '}'
# Find the input branch ending
input_end_marker = "{var el=document.getElementById(key+'InputField');if(el)el.focus();},50);"
input_pos = js.find(input_end_marker)
if input_pos > 0:
    # Insert after the closing brace of the else-if input block
    # The structure: ...},50);\n  }\n  if(step.opts){ne.innerHTML='';}
    insert_at = js.find('}', input_pos) + 1  # closing brace of setTimeout line's block? careful
    # Safer: find the '\n  }\n  if(step.opts)' after input_pos
    nav_marker = "if(step.opts){ne.innerHTML='';}"
    nav_pos = js.find(nav_marker, input_pos)
    # Insert upload_branch right before nav_marker
    js = js[:nav_pos] + upload_branch + '\n  ' + js[nav_pos:]
    print('Added upload branch to renderStep')

# ---- 3. Update the nav condition to treat upload step like input (show Continue) ----
# Current: if(step.opts){ne.innerHTML='';}else{...Continue...}
# upload step has no opts, so it already falls to the else branch showing Continue
# But answerInput won't work for upload - it reads key+'InputField'. We need finishUpload.
# Change the Continue button to call finishUpload for upload steps.
old_nav = "if(step.opts){ne.innerHTML='';}else{var bb=s.step>0?'<button onclick=\"back(\\''+key+'\\')\">\\u2190 Back</button>':'';ne.innerHTML=bb+'<button class=\"primary\" onclick=\"answerInput(\\''+key+'\\')\">Continue \\u2192</button>';}"
new_nav = "if(step.opts){ne.innerHTML='';}else{var bb=s.step>0?'<button onclick=\"back(\\''+key+'\\')\">\\u2190 Back</button>':'';var navBtn=step.upload?'finishUpload(\\''+key+'\\')':'answerInput(\\''+key+'\\')';ne.innerHTML=bb+'<button class=\"primary\" onclick=\"'+navBtn+'\">Continue \\u2192</button>';}"
if old_nav in js:
    js = js.replace(old_nav, new_nav)
    print('Updated nav button for upload step')
else:
    print('WARNING: nav pattern not found - will check JS validity later')

# ---- 4. Add helper functions: handleFiles, finishUpload ----
# Insert before 'function answer('
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
    print('Added helper functions (handleFiles, finishUpload)')

# ---- 5. Append media to message in showResult ----
# showResult builds msg=f.build(s.answers). Append media section.
# Find the line: var f=flows[key],s=state[key],msg=f.build(s.answers)
old_msg = "var f=flows[key],s=state[key],msg=f.build(s.answers),el="
new_msg = "var f=flows[key],s=state[key],msg=f.build(s.answers);var media=s.answers.media||{};if(media.photos&&media.photos.length){msg+='\\n\\nPHOTOS:\\n';media.photos.forEach(function(p){msg+=p.data+'\\n';});}if(media.video){msg+='\\n\\nVIDEO LINK: '+media.video+'\\n';}var el="
if old_msg in js:
    js = js.replace(old_msg, new_msg)
    print('showResult now appends media to message')
else:
    print('WARNING: showResult msg pattern not found')

# ---- Verify JS ----
# Extract script content
script_start = js.find('<script>')+8
script_end = js.rfind('</script>')
js_only = js[script_start:script_end]
with tempfile.NamedTemporaryFile(suffix='.js', mode='w', delete=False) as f:
    f.write(js_only)
    tn = f.name
r = subprocess.run(['node', '--check', tn], capture_output=True, text=True, timeout=10)
print(f'\nJS valid: {r.returncode == 0}')
if r.returncode != 0:
    print(r.stderr[:500])
os.unlink(tn)

with open('/tmp/lockpro/index.html', 'w') as f:
    f.write(js)
print('Saved. Size:', len(js))
