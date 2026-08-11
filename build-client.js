#!/usr/bin/env node
/*
 * build-client.js — ServicePro per-client build & deploy tool
 *
 * Usage:
 *   node build-client.js "Client Name" <trades> [domain] [--no-push]
 *
 *   trades  : comma-separated keys: locksmith,plumbing,hvac,towing,electric,pest,garage,tree,pool
 *   domain  : optional custom domain (writes CNAME + enables Pages on it)
 *   --no-push: build the HTML only, do NOT create/push a repo (for testing)
 *
 * Examples:
 *   node build-client.js "Frantz Locksmith" locksmith
 *   node build-client.js "Johnson Plumbing" plumbing plumbjohnson.com
 *   node build-client.js "ABC Multi-Service" locksmith,plumbing,hvac abcmulti.com
 *
 * What it does:
 *   1. Loads master index.html (this repo's live app)
 *   2. Keeps ONLY the purchased trades (strips others from trades/tradeFlows/HTML buttons/flows)
 *   3. Injects client name, license key, verification hash (var LICENSE)
 *   4. Fixes the empty-subs crash for trades without sub-flows
 *   5. Minifies the JS (obfuscation via comment-strip + compaction)
 *   6. Creates a GitHub Pages repo, pushes, enables Pages, optional CNAME
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- Config ----------
const MASTER = path.join(__dirname, 'index.html');   // master app
const REPO_PREFIX = 'ServicePro-';                   // client repo prefix
const GITHUB_USER = 'FrantzEnterprise';
const VALID_TRADES = ['locksmith','plumbing','hvac','towing','electric','pest','garage','tree','pool'];

function readToken(){
  const gc = path.join(process.env.HOME || '.', '.git-credentials');
  try {
    const raw = fs.readFileSync(gc, 'utf8');
    const m = raw.match(/FrantzEnterprise:([^@]+)@github\.com/);
    if (m) return m[1].trim();
  } catch(e){}
  return '';
}

// ---------- Balanced-brace JS parsing ----------
// These operate on the JS source as a strict, non-nested-JSON-strings-tolerant
// parser. The master uses object literals; nested {} only appear in values
// (subs arrays) or strings. We skip over strings so braces inside them don't
// confuse the depth count.

function extractBalanced(text, start){
  let depth = 0, i = start, inStr = false, strCh = '';
  while (i < text.length){
    const c = text[i];
    if (inStr){
      if (c === '\\'){ i += 2; continue; }
      if (c === strCh) inStr = false;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`'){ inStr = true; strCh = c; }
    else if (c === '{') depth++;
    else if (c === '}'){
      depth--;
      if (depth === 0) return i + 1;   // exclusive end
    }
    i++;
  }
  return text.length;
}

function findVar(js, varName){
  const m = js.match(new RegExp('var\\s+' + varName + '\\s*=\\s*'));
  if (!m) return null;
  const vstart = js.indexOf('{', m.index + m[0].length);
  const vend = extractBalanced(js, vstart);
  return { mstart: m.index, vstart, vend };
}

function replaceVar(js, varName, newValue){
  const r = findVar(js, varName);
  if (!r) return js;
  return js.slice(0, r.mstart) + 'var ' + varName + '=' + newValue + ';' + js.slice(r.vend);
}

function extractEntries(js, varName){
  const r = findVar(js, varName);
  if (!r) return [];
  const { vstart, vend } = r;
  const entries = [];
  let i = vstart + 1;
  while (i < vend - 1){
    const km = js.slice(i).match(/^\s*([a-z0-9_]+)\s*:/);
    if (!km) break;
    const key = km[1];
    const brace = js.indexOf('{', i + km[0].length);
    const bent = extractBalanced(js, brace);
    entries.push({ key, value: key + ':' + js.slice(brace, bent) });
    i = bent;
    while (i < js.length && ' ,\n\t'.includes(js[i])) i++;
    if (js[i] === '}') break;
  }
  return entries;
}

// ---------- Minify / obfuscate ----------
function minifyJS(js){
  let out = '', inStr = false, strCh = '', i = 0;
  while (i < js.length){
    const c = js[i], n = js[i+1];
    if (inStr){
      out += c;
      if (c === '\\'){ out += n || ''; i += 2; continue; }
      if (c === strCh){ inStr = false; }
      i++; continue;
    }
    if (c === '/' && n === '/'){ while (i < js.length && js[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*'){ i += 2; while (i < js.length && !(js[i]==='*' && js[i+1]==='/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`'){ inStr = true; strCh = c; out += c; i++; continue; }
    if (/\s/.test(c)){ out += ' '; while (i < js.length && /\s/.test(js[i])) i++; continue; }
    out += c; i++;
  }
  return out;
}

// ---------- Build one client ----------
function buildClient(clientName, trades, noPush){
  // ---- 1. load master ----
  const html0 = fs.readFileSync(MASTER, 'utf8');
  const jsStart = html0.indexOf('<script>') + 8;
  const jsEnd = html0.lastIndexOf('</script>');
  let js = html0.slice(jsStart, jsEnd);

  // ---- 2. filter trades object ----
  const tb = extractEntries(js, 'trades');
  const kept = tb.filter(e => trades.includes(e.key)).map(e => e.value);
  js = replaceVar(js, 'trades', '{' + kept.join(',') + '}');
  js = js.replace(/}}\s*;/, '}};');  // clear double semicolon if any

  // ---- 3. flows: only locksmith has real content today ----
  if (!trades.includes('locksmith')){
    js = js.replace(/lt=trades\.locksmith[^\n]*\n/, '');   // drop locksmith wiring
    js = replaceVar(js, 'flows', '{}');
  }

  // ---- 4. default trade references -> first purchased ----
  const first = trades[0];
  js = js.replace(/var currentTrade="[^"]+"/, 'var currentTrade="' + first + '"');
  js = js.replace(/selectTrade\('locksmith'\)/g, "selectTrade('" + first + "')");

  // ---- 5. licensing ----
  const licenseKey = 'SP-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const vhSource = clientName + '|' + licenseKey + '|' + trades.slice().sort().join(',');
  const vh = crypto.createHash('sha256').update(vhSource).digest('hex').slice(0,16);
  const cname = clientName.replace(/'/g, "\\'");
  const licenseBlock = 'var LICENSE={client:"' + cname + '",key:"' + licenseKey +
    '",trades:["' + trades.join('","') + '"],vh:"' + vh + '"};';
  // inject at top of script (before SETTINGS header comment)
  js = js.replace(/\/\* =+[\s\S]*?SETTINGS & SETUP[\s\S]*?=+ \*\//,
    licenseBlock + '\n/* == SETTINGS & SETUP == */', 1);

  // ---- 6. fix empty-subs crash for trades without sub-flows ----
  js = js.replace("currentSub=t&&t.subs?t.subs[0].key:'resi';",
                  "currentSub=t&&t.subs&&t.subs.length?t.subs[0].key:'resi';");
  js = js.replace("if(t&&t.subs){t.subs.forEach",
                  "if(t&&t.subs&&t.subs.length){t.subs.forEach");
  // graceful "coming soon" for trades with no flow content
  js = js.replace(
    'function startFlow(key){state[key]={answers:{},step:0,started:true};renderStep(key);}',
    'function startFlow(key){if(!flows[key]){showPlaceholder(key);return;}state[key]={answers:{},step:0,started:true};renderStep(key);}'
  );
  const ph = [
    'function showPlaceholder(key){',
    '  var el=document.getElementById(key+"Main")||document.getElementById("mainSection")||document.body;',
    "  el.innerHTML='<div style=\"text-align:center;padding:40px 16px;color:var(--muted)\"><h3>This service is coming soon</h3><p>The web request form for this trade is being set up. Please call us directly.</p></div>';",
    '}\n'
  ].join('\n');
  js = js.replace('function startFlow(', ph + 'function startFlow(');

  // ---- 7. filter HTML trade buttons ----
  let html = html0;
  html = html.replace(/(<div class="trade-btn[^>]*data-trade=")([^"]+)("[^>]*>[^<]*<\/div>)/g,
    (m, pre, trade, post) => trades.includes(trade) ? m : '');
  // normalize active class: strip all, add to first purchased
  html = html.replace(/(class="trade-btn)(\s+active)?([^"]*)"/g, '$1$3"');
  html = html.replace(new RegExp('(<div class="trade-btn)([^>]*data-trade="' + first + '")'),
    '$1 active$2');

  // ---- 8. assemble ----
  const jsStart2 = html.indexOf('<script>') + 8;
  const jsEnd2 = html.lastIndexOf('</script>');
  const jsMin = minifyJS(js);
  const out = html.slice(0, jsStart2) + jsMin + html.slice(jsEnd2);
  const outFile = path.join(__dirname, slugify(clientName) + '.html');
  fs.writeFileSync(outFile, out);

  console.log('Logo flow built.');
  console.log('  file      : ' + outFile);
  console.log('  license   : ' + licenseKey);
  console.log('  verify h  : ' + vh);
  console.log('  trades    : ' + trades.join(', '));
  console.log('  size      : ' + out.length + ' bytes (master ' + html0.length + ')');

  // sanity: leftover locksmith wiring
  const jsChk = out.slice(jsStart2, jsEnd2 === -1 ? out.length : out.lastIndexOf('</script>') );
  if (!trades.includes('locksmith')){
    const leftovers = (jsChk.match(/locksmith/g) || []).filter(x => true);
    console.log('  locksmith refs in JS: ' + leftovers.length + ' (comments ok)');
  }

  if (noPush){
    console.log('\n(--no-push) Build only. Repo NOT created/pushed.');
    return;
  }

  // ---- 9. deploy ----
  deployRepo(clientName, out, domainOf(clientName), js);
}

function slugify(name){
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function domainOf(){ return ''; }  // placeholder; domain passed separately

function api(method, url, body){
  const tok = readToken();
  const res = execSync(
    `curl -s -X ${method} -H "Authorization: Bearer ${tok}" ` +
    `-H "Accept: application/vnd.github+json" ` +
    (body ? `-d @- ` : '') + `"${url}"`,
    { input: body ? JSON.stringify(body) : undefined, maxBuffer: 10*1024*1024, encoding: 'utf8' }
  );
  return JSON.parse(res);
}

function deployRepo(clientName, outFile, domain, jsForCname){
  const repo = REPO_PREFIX + slugify(clientName);
  const tok = readToken();
  console.log('\nCreating repo ' + GITHUB_USER + '/' + repo + ' ...');
  const created = api('POST', 'https://api.github.com/user/repos', {
    name: repo, private: false, auto_init: true,
    description: 'ServicePro client site for ' + clientName + (domain ? ' (' + domain + ')' : '')
  });
  if (created && created.full_name) console.log('  repo created');
  else console.log('  (repo may already exist — will push anyway)');

  // push
  const tmp = fs.mkdtempSync('/tmp/sp-build-');
  try {
    execSync('cd "' + tmp + '" && git init -q && git config user.email "build@servicepro.local" && git config user.name "ServicePro Build"', {stdio:'inherit'});
    fs.copyFileSync(outFile, path.join(tmp, 'index.html'));
    if (domain) fs.writeFileSync(path.join(tmp, 'CNAME'), domain);
    execSync('cd "' + tmp + '" && git add -A && git commit -qm "ServicePro build for ' + clientName + '"', {stdio:'inherit'});
    execSync('cd "' + tmp + '" && git branch -M main && git remote add origin "https://' + GITHUB_USER + ':' + tok + '@github.com/' + GITHUB_USER + '/' + repo + '.git" && git push -u origin main -f', {stdio:'inherit'});
    console.log('  pushed to main');
  } finally {
    fs.rmSync(tmp, {recursive:true, force:true});
  }

  // enable Pages
  const pages = api('POST', 'https://api.github.com/repos/' + GITHUB_USER + '/' + repo + '/pages', {
    source: { branch: 'main', path: '/' }
  });
  if (pages && pages.html_url) console.log('  Pages enabled: ' + pages.html_url);
  else console.log('  (Pages enable note: ' + JSON.stringify(pages && pages.errors || pages && pages.message || 'see above') + ')');

  const url = domain ? 'https://' + domain : 'https://' + GITHUB_USER + '.github.io/' + repo + '/';
  console.log('\n=== DONE ===');
  console.log('Client     : ' + clientName);
  console.log('Repo       : https://github.com/' + GITHUB_USER + '/' + repo);
  console.log('Live URL   : ' + url);
  if (domain) console.log('DNS: point ' + domain + ' (CNAME) -> ' + GITHUB_USER + '.github.io');
}

function main(){
  const args = process.argv.slice(2);
  const noPush = args.includes('--no-push');
  const cleanArgs = args.filter(a => a !== '--no-push');
  if (cleanArgs.length < 2){
    console.log('Usage: node build-client.js "Client Name" <trades> [domain] [--no-push]');
    console.log('  trades: ' + VALID_TRADES.join(','));
    process.exit(1);
  }
  const clientName = cleanArgs[0];
  const trades = cleanArgs[1].split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const domain = cleanArgs[2] || '';
  const tok = readToken();

  trades.forEach(t => {
    if (!VALID_TRADES.includes(t)){ console.error('ERROR: unknown trade "' + t + '". Valid: ' + VALID_TRADES.join(',')); process.exit(1); }
  });
  if (trades.length === 0){ console.error('ERROR: no trades given'); process.exit(1); }
  if (!fs.existsSync(MASTER)){ console.error('ERROR: master index.html not found at ' + MASTER); process.exit(1); }
  if (!tok){ console.error('ERROR: no GitHub token in ~/.git-credentials'); process.exit(1); }

  buildClient(clientName, trades, noPush);
}

main();
