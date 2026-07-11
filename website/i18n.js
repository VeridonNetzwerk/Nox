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

const NOX_TZ_LANG = {
  'Europe/Berlin':'de','Europe/Vienna':'de','Europe/Zurich':'de','Europe/Luxembourg':'de',
  'Europe/Paris':'fr','Europe/Monaco':'fr','Europe/Brussels':'fr',
  'Europe/Rome':'it','Europe/San_Marino':'it','Europe/Vatican':'it',
  'Europe/Lisbon':'pt','Atlantic/Azores':'pt','Atlantic/Madeira':'pt',
  'Europe/Madrid':'es','Atlantic/Canary':'es','Africa/Casablanca':'es',
  'Europe/Moscow':'ru','Europe/Kaliningrad':'ru','Europe/Samara':'ru',
  'Asia/Tokyo':'ja',
  'Asia/Shanghai':'zh','Asia/Hong_Kong':'zh','Asia/Taipei':'zh','Asia/Singapore':'zh',
  'Asia/Seoul':'ko',
  'Europe/Amsterdam':'nl',
  'Europe/Warsaw':'pl',
  'Europe/Istanbul':'tr',
  'Europe/Stockholm':'sv',
  'Asia/Kolkata':'hi',
  'Asia/Jerusalem':'he',
  'Europe/Prague':'cs',
  'Europe/Copenhagen':'da',
  'Europe/Helsinki':'fi',
  'Europe/Athens':'el',
  'Europe/Budapest':'hu',
  'Asia/Jakarta':'id',
  'Europe/Oslo':'nb',
  'Europe/Bucharest':'ro',
  'Asia/Bangkok':'th',
  'Asia/Ho_Chi_Minh':'vi',
  'Europe/Kyiv':'uk',
  'America/Sao_Paulo':'pt','America/Bahia':'pt',
  'America/Mexico_City':'es',
  'America/Buenos_Aires':'es','America/Argentina/*':'es',
  'America/New_York':'en','America/Chicago':'en','America/Denver':'en','America/Los_Angeles':'en',
  'America/Toronto':'en','America/Vancouver':'en',
  'Europe/London':'en','Europe/Dublin':'en',
  'Australia/Sydney':'en','Australia/Melbourne':'en',
  'Pacific/Auckland':'en',
  'Africa/Cairo':'ar','Africa/Tunis':'ar','Africa/Algiers':'ar',
  'Asia/Riyadh':'ar','Asia/Dubai':'ar','Asia/Qatar':'ar','Asia/Kuwait':'ar','Asia/Bahrain':'ar','Asia/Muscat':'ar',
  'Asia/Baghdad':'ar','Asia/Damascus':'ar','Asia/Beirut':'ar','Asia/Amman':'ar'
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

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const tzLang = NOX_TZ_LANG[tz];
  if(tzLang && NOX_I18N[tzLang]){ done(tzLang); return; }

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
        .catch(()=>tryBrowser());
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
