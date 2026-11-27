/* EMP: tema compartido en todos los portales, sin dependencia de Supabase. */
(function(){
 'use strict';
 var KEY='e360_theme';
 function saved(){try{return localStorage.getItem(KEY)||localStorage.getItem('e360_guardia_theme')||'dark';}catch(_){return 'dark';}}
 function apply(theme){
  var mode=theme==='light'?'light':'dark';
  document.documentElement.setAttribute('data-theme',mode);
  if(document.documentElement.hasAttribute('data-theme-root'))document.documentElement.classList.toggle('theme-dark',mode==='dark');
  if(document.body){document.body.setAttribute('data-theme',mode);document.body.classList.toggle('theme-dark',mode==='dark');document.body.classList.toggle('theme-light',mode==='light');}
  var meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=mode==='light'?'#eef3f9':'#080e1c';
  var btn=document.getElementById('empGlobalTheme');if(btn){btn.textContent=mode==='light'?'☾ Tema oscuro':'☀ Tema claro';btn.setAttribute('aria-label',mode==='light'?'Activar tema oscuro':'Activar tema claro');btn.setAttribute('aria-pressed',String(mode==='light'));}
 }
 function choose(mode){
  apply(mode);
  try{localStorage.setItem(KEY,mode);localStorage.setItem('e360_guardia_theme',mode);}catch(_){}
 }
 function boot(){
  apply(saved());
  if(document.getElementById('btnThemeToggle')){
   // Guardia ya tiene un interruptor táctil propio. Se sincroniza la preferencia.
   var guardia=document.getElementById('btnThemeToggle');
   guardia.addEventListener('click',function(){setTimeout(function(){choose(document.documentElement.getAttribute('data-theme'));},0);});
   return;
  }
  var btn=document.getElementById('empGlobalTheme');
  if(!btn){btn=document.createElement('button');btn.id='empGlobalTheme';btn.className='emp-theme-switch';btn.type='button';document.body.appendChild(btn);}
  btn.addEventListener('click',function(){choose(document.documentElement.getAttribute('data-theme')==='light'?'dark':'light');});
  apply(saved());
 }
 // Evita destellos de tema incorrecto al cargar.
 apply(saved());
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
 window.addEventListener('storage',function(e){if(e.storageArea===localStorage && (e.key===KEY || e.key===null))apply(saved());});
})();
