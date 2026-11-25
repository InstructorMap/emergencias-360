(function(){
'use strict';
const Store=window.E360Store;
function mount(){
 const host=document.getElementById('empRecovery');if(!host)return;
 const out=host.querySelector('output'),btn=host.querySelector('button');
 let timer=null,busy=false,attempt=0,last=0,epoch=0;
 const delays=[2,5,10,20,30,60];
 function interruptionKey(){
  const userId=Store.getUser()?.id;
  return userId&&Store.isStaff()?'e360-central-interruptions:'+userId:null;
 }
 function readInterruptions(key){
  try{return JSON.parse(localStorage.getItem(key)||'[]');}catch(_){return [];}
 }
 function recordInterruption(){
  const key=interruptionKey();
  if(!key)return;
  const records=readInterruptions(key);
  if(records.some(row=>!row.recovered_at))return;
  records.push({id:crypto.randomUUID(),interrupted_at:new Date().toISOString()});
  localStorage.setItem(key,JSON.stringify(records));
 }
 async function flushInterruptions(key){
  if(!key||key!==interruptionKey())return;
  const records=readInterruptions(key);
  if(!records.length)return;
  const sb=Store._getState().supabase;
  const recoveredAt=Date.now();
  for(const row of records){
   row.recovered_at ||= new Date(Math.max(recoveredAt,Date.parse(row.interrupted_at))).toISOString();
  }
  localStorage.setItem(key,JSON.stringify(records));
  for(const row of records){
   if(key!==interruptionKey()||!navigator.onLine)return;
   const {error}=await sb.from('e360_central_interruptions').insert(row);
   if(error&&error.code!=='23505')throw error;
   localStorage.setItem(key,JSON.stringify(readInterruptions(key).filter(item=>item.id!==row.id)));
  }
 }
 function markInterrupted(){
  try{recordInterruption();}catch(e){console.warn('[Central] No se pudo guardar la interrupción',e.name);}
 }
 function show(t){out.textContent=t;}
 function schedule(seconds){clearTimeout(timer);timer=setTimeout(run,seconds*1000);}
 async function run(){
 if(busy)return;
 if(!navigator.onLine){markInterrupted();show('Sin red · datos pueden estar desactualizados');return;}
 if(document.hidden||!Store.isStaff()){show('En espera de sesión operativa visible');schedule(10);return;}
 busy=true;btn.disabled=true;const token=epoch,key=interruptionKey();show('Sincronizando incidentes y flota…');
 try{
 await Store.refreshIncidentsNow(true);
 await Store.refreshFleet();
 if(token!==epoch||key!==interruptionKey()||!navigator.onLine)throw Error('Conexión interrumpida');
 last=Date.now();attempt=0;show('Sincronización confirmada: '+new Date(last).toLocaleTimeString('es-AR'));schedule(30);
 try{await flushInterruptions(key);}catch(e){console.warn('[Central] Bitácora pendiente:',e.code||e.name);}
 }catch(e){const wait=delays[Math.min(attempt++,delays.length-1)];show('Sincronización no confirmada · reintento en '+wait+' s');if(navigator.onLine)schedule(wait);}
 finally{busy=false;btn.disabled=false;}
 }
 function wake(){clearTimeout(timer);attempt=0;if(busy){schedule(2);return;}run();}
 window.addEventListener('offline',()=>{epoch++;clearTimeout(timer);markInterrupted();show('Sin red · datos pueden estar desactualizados');});
 window.addEventListener('online',wake);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake();});
 btn.onclick=wake;
 run();
}
document.addEventListener('DOMContentLoaded',mount);
})();