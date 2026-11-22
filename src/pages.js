// The two small standalone pages: first-run setup and login.
export function authPage(kind) {
  const setup = kind === 'setup';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${setup ? 'Set up' : 'Sign in'} · Linkpage</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem;background:#020617;color:#e2e8f0;font:16px/1.5 system-ui,sans-serif}
body::before{content:"";position:fixed;inset:0;background:radial-gradient(50vmax 50vmax at 0 0,rgba(148,253,248,.13),transparent 70%),radial-gradient(60vmax 60vmax at 100% 100%,rgba(59,130,246,.15),transparent 70%)}
form{position:relative;width:100%;max-width:26rem;padding:2rem;border-radius:24px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(24px);box-shadow:0 20px 60px -20px #000}
h1{margin:0 0 .3rem;font-size:1.6rem}p{margin:0 0 1.4rem;color:#94a3b8;font-size:.95rem}
label{display:block;margin:0 0 1rem;font-weight:600;font-size:.9rem}small{display:block;font-weight:400;color:#94a3b8;margin-top:.25rem}
input{display:block;width:100%;margin-top:.35rem;padding:.8rem .9rem;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(2,6,23,.6);color:#fff;font:inherit}
input:focus{outline:2px solid #94fdf8;outline-offset:1px}
button{width:100%;margin-top:.4rem;padding:.9rem;border:0;border-radius:12px;background:#94fdf8;color:#020617;font:700 1rem system-ui;cursor:pointer}
button:disabled{opacity:.6}#err{min-height:1.4rem;margin-top:.8rem;color:#fca5a5;font-size:.9rem}
</style></head><body>
<form id="f" autocomplete="on">
<h1>${setup ? 'Welcome 👋' : 'Sign in'}</h1>
<p>${setup ? 'Create your admin account. The setup code is printed in your server logs (docker compose logs linkpage).' : 'Sign in to edit your link page.'}</p>
${setup ? '<label>Setup code<input name="code" required autocomplete="off" autocapitalize="off" spellcheck="false"></label>' : ''}
<label>Username<input name="username" required minlength="3" maxlength="40" autocomplete="username" autocapitalize="off"></label>
<label>Password${setup ? '<small>At least 10 characters. A few random words works great.</small>' : ''}<input name="password" type="password" required ${setup ? 'minlength="10"' : ''} autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
${setup ? '<label>Repeat password<input name="password2" type="password" required autocomplete="new-password"></label>' : ''}
<button>${setup ? 'Create account' : 'Sign in'}</button><div id="err" role="alert"></div>
</form>
<script>
var f=document.getElementById('f'),err=document.getElementById('err');
f.addEventListener('submit',function(e){e.preventDefault();err.textContent='';var d={};new FormData(f).forEach(function(v,k){d[k]=v});
if(d.password2!==undefined&&d.password!==d.password2){err.textContent='The two passwords do not match.';return}
var b=f.querySelector('button');b.disabled=true;
fetch('/auth/${kind}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})
.then(function(r){return r.json().catch(function(){return{}}).then(function(j){return[r,j]})})
.then(function(x){if(x[0].ok){location.href='/admin'}else{err.textContent=x[1].error||'Something went wrong';b.disabled=false}})
.catch(function(){err.textContent='Could not reach the server.';b.disabled=false});});
</script></body></html>`;
}
