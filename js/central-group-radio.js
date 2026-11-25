(function(){
'use strict';
const Store=window.E360Store;
let sessions=[],stream=null,busy=false,held=false,starting=null,stopping=false;
const active=()=>Store.getIncidents('ALL').filter(i=>i.assignedUnitId&&['EN_CAMINO','EN_ESCENA'].includes(i.status));
const selected=new Set();
function cleanup(){sessions.forEach(s=>s.radio.destroy());sessions=[];if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;}
function mount(){
 const host=document.getElementById('empGroupRadio');if(!host||host.hidden)return;
 const mode=host.querySelector('select'),list=host.querySelector('.group-targets'),status=host.querySelector('output'),talk=host.querySelector('.group-talk');
 function refresh(){
 const rows=active(),sig=JSON.stringify(rows.map(i=>[i.id,i.assignedUnitId]));
 if(list.dataset.sig===sig)return;list.dataset.sig=sig;list.replaceChildren();
 rows.forEach(i=>{const l=document.createElement('label'),b=document.createElement('input');b.type='checkbox';b.checked=selected.has(i.id);b.onchange=()=>b.checked?selected.add(i.id):selected.delete(i.id);l.append(b,document.createTextNode(' '+i.assignedUnitId+' · '+i.id));list.append(l);});
 }
 function targets(){return active().filter(i=>mode.value==='all'||selected.has(i.id));}
 async function stop(){
 held=false;if(stopping)return;stopping=true;
 try{if(starting)await starting;const sb=Store._getState().supabase;await Promise.allSettled(sessions.map(s=>s.radio.stopTalking(sb)));status.textContent='Transmisión finalizada; recepción no confirmada.';}
 finally{cleanup();busy=false;window.E360GroupRadioBusy=false;stopping=false;mode.disabled=false;talk.textContent='Mantener para transmitir';}
 }
 async function start(e){
 e.preventDefault();if(busy||e.button!==0)return;
 if(window.E360PTT?.isReady()){status.textContent='Desconectá primero el PTT individual.';return;}
 const rows=targets();if(!rows.length){status.textContent='Seleccioná móviles operativos.';return;}
 busy=true;window.E360GroupRadioBusy=true;held=true;mode.disabled=true;talk.setPointerCapture(e.pointerId);
 status.textContent='Preparando '+rows.length+' canales…';
 starting=(async()=>{try{
 stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
 if(!held)return;
 const sb=Store._getState().supabase;
 const results=await Promise.allSettled(rows.map(async i=>{const radio=window.E360CreateRadio(stream);sessions.push({radio,id:i.id});if(!await radio.init(sb,i.id,'central'))throw Error('Canal no disponible');}));
 if(results.some(r=>r.status==='rejected'))throw Error('No se pudieron preparar todos los canales');
 if(!held)return;
 const sent=await Promise.allSettled(sessions.map(s=>s.radio.startTalking(sb)));
 status.textContent=sent.filter(r=>r.status==='fulfilled').length+'/'+rows.length+' transmisiones iniciadas; recepción no confirmada.';
 }catch(err){status.textContent=err.message;held=false;cleanup();}})();
 await starting;starting=null;if(!held&&!stopping){cleanup();busy=false;window.E360GroupRadioBusy=false;mode.disabled=false;}
 }
 talk.addEventListener('pointerdown',start);['pointerup','pointercancel','lostpointercapture'].forEach(t=>talk.addEventListener(t,()=>{if(busy)stop();}));
 window.addEventListener('blur',()=>{if(busy)stop();});window.addEventListener('beforeunload',cleanup);
 refresh();setInterval(refresh,3000);
}
document.addEventListener('DOMContentLoaded',mount);
})();