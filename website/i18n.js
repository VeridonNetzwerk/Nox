/* NOX i18n Engine */
const NOX_RTL = ['ar','he','fa'];

const NOX_COUNTRY_LANG = {
  DE:'de',AT:'de',CH:'de',LI:'de',
  US:'en',GB:'en',AU:'en',CA:'en',IE:'en',NZ:'en',
  ES:'es',MX:'es',AR:'es',CO:'es',CL:'es',PE:'es',VE:'es',UY:'es',
  FR:'fr',BE:'fr',LU:'fr',MC:'fr',
  IT:'it',SM:'it',VA:'it',
  PT:'pt',BR:'pt',AO:'pt',MZ:'pt',
  RU:'ru',BY:'ru',KZ:'ru',KG:'ru',
  JP:'ja',
  CN:'zh',HK:'zh',TW:'zh',SG:'zh',
  SA:'ar',AE:'ar',EG:'ar',MA:'ar',DZ:'ar',TN:'ar',LY:'ar',JO:'ar',LB:'ar',SY:'ar',IQ:'ar',KW:'ar',QA:'ar',BH:'ar',OM:'ar',YE:'ar',
  KR:'ko',
  NL:'nl',BE:'nl',
  PL:'pl',
  TR:'tr',
  SE:'sv',
  IN:'hi',
  IL:'he',
  CZ:'cs',
  DK:'da',
  FI:'fi',
  GR:'el',
  HU:'hu',
  ID:'id',
  NO:'nb',
  RO:'ro',
  TH:'th',
  VN:'vi',
  UA:'uk'
};

function nox_detectLang(cb){
  const saved = localStorage.getItem('nox-lang');
  if(saved && NOX_I18N[saved]){ cb(saved); return; }

  let resolved = false;
  const done = (lang)=>{ if(!resolved){ resolved=true; cb(lang); } };

  const tryBrowser = ()=>{
    const bl = (navigator.language||'en').slice(0,2).toLowerCase();
    done(NOX_I18N[bl]?bl:'en');
  };

  const applyCountry = (cc)=>{
    const lang = NOX_COUNTRY_LANG[cc];
    if(lang && NOX_I18N[lang]) done(lang);
    else tryBrowser();
  };

  fetch('https://get.geojs.io/v1/ip/country.json')
    .then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(d=>applyCountry((d.country||'').toUpperCase()))
    .catch(()=>{
      fetch('https://ipwho.is/')
        .then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); })
        .then(d=>{
          if(!d.success) throw new Error('ipwho failed');
          applyCountry((d.country_code||'').toUpperCase());
        })
        .catch(()=>{
          fetch('https://ipapi.co/json/')
            .then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); })
            .then(d=>applyCountry((d.country_code||'').toUpperCase()))
            .catch(()=>tryBrowser());
        });
    });
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
