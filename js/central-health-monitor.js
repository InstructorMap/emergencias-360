(function(){
'use strict';
const Store=window.E360Store;
function mount(){
 const host=document.getElementById('empHealthMonitor');if(!host)return;
 let server={level:'unknown',text:'Sin comprobar'},running=false,lastSuccess=0;
 const set=(id,level,text)=>{const e=host.querySelector('[data-health="'+id+'"]');if(!e)return;e.dataset.level=level;if(e.textContent!==text)e.textContent=text;};
 const age=t=>Math.max(0,Math.floor((Date.now()-t)/1000));
 function render(){
 set('network',navigator.onLine?'ok':'bad',navigator.onLine?'Red disponible (dispositivo)':'Sin conexión de red');
 set('server',server.level,server.text+(lastSuccess?' · Último éxito hace '+age(lastSuccess)+' s':''));
 const d=window.E360PTT?.debug?.()||{},g=window.E360GroupRadioBusy;
 const failed=['failed','disconnected','closed'].includes(d.pcConnectionState)||['failed','disconnected','closed'].includes(d.pcIceState);
 set('radio',failed?'bad':g?'warn':d.initialized&&d.channelState==='joined'?'ok':'unknown',failed?'PTT: conexión degradada':g?'PTT grupal activo; recepción no confirmada':d.initialized?'PTT individual · señalización '+d.channelState+' · ICE '+d.pcIceState:'PTT sin canal abierto');
 const list=host.querySelector('.health-gps-list');
 const active=Store.getIncidents('ALL').filter(i=>i.assignedUnitId&&['EN_CAMINO','EN_ESCENA','EN_TRASLADO'].includes(i.status));
 const rows=active.map(i=>{const p=i.unitLocation,t=Date.parse(p?.ts),valid=p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180&&Number.isFinite(t)&&t<=Date.now()+60000;const seconds=valid?age(t):null;return {id:i.id,unit:i.assignedUnitId,level:!valid?'unknown':seconds>120?'bad':seconds>45?'warn':'ok',label:!valid?'Sin posición fechada':seconds+' s desde última posición'};});
 const counts=rows.reduce((a,r)=>(a[r.level]=(a[r.level]||0)+1,a),{});
 set('gps',!rows.length?'unknown':counts.bad?'bad':counts.warn||counts.unknown?'warn':'ok',rows.length? (counts.ok||0)+'/'+rows.length+' posiciones recientes':'Sin móviles en misión');
 const sig=JSON.stringify(rows);if(list.dataset.sig!==sig){list.dataset.sig=sig;list.replaceChildren(...rows.map(r=>{const li=document.createElement('li');li.dataset.level=r.level;li.textContent=r.unit+' · '+r.label;return li;}));}
 }
 async function probe(){
 if(running)return;running=true;let timer;
 try{
 const sb=Store._getState().supabase;if(!sb){server={level:'unknown',text:'Servidor sin configurar'};return;}
 if(!navigator.onLine){server={level:'bad',text:'Sin red para consultar servidor'};return;}
 const start=performance.now(),controller=new AbortController();timer=setTimeout(()=>controller.abort(),8000);
 const {data:auth}=await sb.auth.getSession();if(!auth?.session){server={level:'unknown',text:'Sin sesión autenticada'};return;}
 const {error}=await sb.from('incidents').select('id').limit(1).abortSignal(controller.signal);
 if(error)throw error;
 lastSuccess=Date.now();const ms=Math.round(performance.now()-start);server={level:ms>2500?'warn':'ok',text:'Lectura API correcta · '+ms+' ms'};
 }catch(e){server={level:'bad',text:'No se pudo comprobar lectura API'};}finally{clearTimeout(timer);running=false;render();}
 }
 host.querySelector('button').onclick=probe;
 window.addEventListener('online',probe);window.addEventListener('offline',()=>{server={level:'bad',text:'Sin red para consultar servidor'};render();});
 render();probe();setInterval(render,2000);setInterval(probe,30000);
}
document.addEventListener('DOMContentLoaded',mount);
})();