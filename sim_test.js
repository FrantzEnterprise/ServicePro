// Runtime simulation of ServicePro flow with upload step
const fs = require('fs');
const html = fs.readFileSync('/tmp/lockpro/index.html', 'utf8');
let js = html.substring(html.indexOf('<script>')+8, html.lastIndexOf('</script>'));

const elements = new Map();
function makeEl(id) {
  const el = {
    id, innerHTML: '', style: {}, classList: { add(){}, remove(){}, contains(){ return false; } },
    value: '', type: '', checked: false, placeholder: '', min: '', step: '',
    appendChild(){}, focus(){}, click(){}, onchange: null, onclick: null, onkeydown: null,
    textContent: '', files: [], getContext(){ return { drawImage(){} }; }, toDataURL(){ return 'data:image/jpeg;base64,xxx'; },
    width: 100, height: 100,
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    className: ''
  };
  return el;
}

global.document = {
  getElementById(id) { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); },
  createElement(tag) {
    if (tag === 'canvas') return makeEl('canvas');
    if (tag === 'img') { const el = makeEl('img'); Object.defineProperty(el,'src',{set(){ setTimeout(()=>{if(this.onload)this.onload();},0);},get(){return this._s;}}); return el; }
    return makeEl(tag);
  },
  querySelector(){ return null; },
  querySelectorAll(){ return []; },
  documentElement: { style: { setProperty(){} } },
  addEventListener(){},
  body: makeEl('body'),
  head: makeEl('head')
};

global.Image = function(){ this.onload=null; let _s; Object.defineProperty(this,'src',{set(){ setTimeout(()=>{if(this.onload)this.onload();},0);},get(){return _s;}}); this.width=800; this.height=600; };
global.FileReader = function(){ this.readAsDataURL=function(){}; this.onload=null; };
global.alert = (m)=>{};
global.setTimeout = (fn)=>{ try{fn();}catch(e){console.log('setTimeout err:',e.message);} };

// Pre-seed localStorage with settings that have a pinHash so loadSettings avoids setup wizard
const seedSettings = JSON.stringify({
  bizName:'Test', phone:'', email:'', country:'1', accent:'#2563eb', accent2:'#10b981', bg:'#0f172a', bgImg:'', logo:'', fontSize:'16px',
  tabs:{resi:true,comm:true,auto:true,safe:true}, tripFee:65, radius:20, mileageRate:2,
  services:{resi:["Locked out"],comm:[],auto:[],safe:[]},
  pinHash:'00168c00'  // sha256('0000')
});
global.localStorage = { getItem(){return seedSettings;}, setItem(){}, removeItem(){} };

// stub for any location/history usage
global.location = { hash: '', href: '', replace(){}, assign(){} };
global.history = { pushState(){}, replaceState(){}, back(){} };
global.addEventListener = function(){};

let errors = [];
console.error = (e)=>{ errors.push(String(e)); };

try { eval(js); } catch(e) { console.log('EVAL ERROR:', e.message); process.exit(1); }

try {
  console.log('--- Testing resi flow with media step ---');
  console.log('Total resi steps:', flows.resi.steps.length);

  const s = {answers:{}, step:0};
  state.resi = s;
  s.answers.situation='Locked out';
  s.answers.lockType='Deadbolt';
  s.answers.urgency='Yes - locked out now';
  s.answers.name='Test User';
  s.answers.phone='5551234';
  s.answers.address='123 Main St';
  s.step = 6; // media step index

  renderStep('resi');
  console.log('Media step rendered OK');

  const videoEl = document.getElementById('resiVideoLink');
  videoEl.value = 'https://youtube.com/watch?v=abc';

  finishUpload('resi');
  console.log('After finishUpload, step:', s.step, '(should be 7 = steps.length -> showResult)');
  console.log('Media saved:', JSON.stringify(s.answers.media));

// Verify video link appears in the built message by calling showResult directly and inspecting the result element
// The media step was saved as {photos:[],video:'https://youtube.com/watch?v=abc'}
// After finishUpload above, showResult fired. Let's re-call showResult and capture which element gets HTML.
const prevInnerHTML = {};
const orig = document.getElementById;
let sawMedia = false;
// Re-run showResult to inspect
showResult('resi');
// Now check ALL elements for VIDEO LINK
for (const [id, el] of elements.entries()) {
  if (el.innerHTML && el.innerHTML.includes('VIDEO LINK')) { sawMedia = true; console.log('VIDEO LINK found in element:', id); }
}
console.log('  (media/video link present in rendered output):', sawMedia);

  // Test photo upload path
  console.log('\n--- Testing photo upload ---');
  const s2 = {answers:{situation:'x',lockType:'y',urgency:'Today',name:'A',phone:'1',address:'B'}, step:6};
  state.resi = s2;
  renderStep('resi');
  // simulate selecting a file - we can't easily, but verify handleFiles exists and fails gracefully
  const fileInput = document.getElementById('resiFileInput');
  // Set 1 fake file
  const fakeFile = { name:'p.jpg' };
  fileInput.files = [fakeFile];
  try {
    handleFiles('resi', fileInput);
    console.log('handleFiles called without error (photo compressed in background)');
  } catch(e) {
    console.log('handleFiles error:', e.message);
  }

} catch(e) {
  console.log('FLOW TEST ERROR:', e.message);
  console.log(e.stack);
  process.exit(1);
}

console.log('\nConsole errors captured:', errors.length);
if (errors.length) errors.forEach(e=>console.log('  ERR:', e.slice(0,120)));
console.log('\nALL TESTS COMPLETE');
