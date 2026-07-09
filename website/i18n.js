/* NOX i18n Engine */
const NOX_RTL = ['ar','he','fa'];

function nox_detectLang(cb){
  const saved = localStorage.getItem('nox-lang');
  if(saved && NOX_I18N[saved]){ cb(saved); return; }
  const bl = (navigator.language||'en').slice(0,2).toLowerCase();
  if(NOX_I18N[bl]){ cb(bl); return; }
  fetch('https://ipapi.co/json/')
    .then(r=>r.json())
    .then(d=>{
      const cc=(d.languages||'en').split(',')[0].slice(0,2).toLowerCase();
      cb(NOX_I18N[cc]?cc:'en');
    })
    .catch(()=>cb('en'));
}

function nox_applyLang(lang){
  if(!NOX_I18N[lang]) lang='en';
  const t=NOX_I18N[lang];
  document.documentElement.lang=lang;
  document.documentElement.dir=NOX_RTL.includes(lang)?'rtl':'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const k=el.getAttribute('data-i18n');
    if(t[k]!==undefined) el.textContent=t[k];
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el=>{
    const k=el.getAttribute('data-i18n-html');
    if(t[k]!==undefined) el.innerHTML=t[k];
  });
  localStorage.setItem('nox-lang',lang);
  const sel=document.getElementById('lang-select');
  if(sel) sel.value=lang;
  const m=document.querySelector('meta[name="description"]');
  if(m&&t.hero_desc) m.setAttribute('content',t.hero_desc);
}

function nox_buildSwitcher(){
  const c=document.getElementById('lang-switcher');
  if(!c) return;
  c.innerHTML='';
  const sel=document.createElement('select');
  sel.className='lang-select';
  sel.id='lang-select';
  Object.keys(NOX_I18N).forEach(code=>{
    const l=NOX_I18N[code];
    const opt=document.createElement('option');
    opt.value=code;
    opt.textContent=(l._flag||'')+' '+(l._name||code);
    sel.appendChild(opt);
  });
  sel.onchange=()=>nox_applyLang(sel.value);
  c.appendChild(sel);
}

document.addEventListener('DOMContentLoaded',()=>{
  nox_buildSwitcher();
  nox_detectLang(l=>nox_applyLang(l));
});
