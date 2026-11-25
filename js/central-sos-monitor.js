(function(){
'use strict';
const Store=window.E360Store;
function mount(){
 const host=document.getElementById('empSOSMonitor');if(!host)return;
 const list=host.querySelector('.sos-rows'),summary=host.querySelector('output');const nodes=new Map();const alerted=new Set();
 function tick(){
 if(!Store.isStaff()){list.replaceChildren();nodes.clear();summary.textContent='Sin sesión operativa';return;}
 const pending=Store.getIncidents('ALL').filter(i=>i.status==='RECIBIDA_SERVIDOR').sort((a,b)=>{const rank=i=>i.priority==='ROJO'||!i.priority?0:i.priority==='AMARILLO'?1:2;return rank(a)-rank(b)||(Date.parse(a.createdAt)||0)-(Date.parse(b.createdAt)||0);});
 let critical=0;const ids=new Set(pending.map(i=>String(i.id)));
 for(const [id,n] of nodes)if(!ids.has(id)){n.row.remove();nodes.delete(id);}
 pending.forEach((i,index)=>{
 const id=String(i.id),t=Date.parse(i.createdAt),seconds=Number.isFinite(t)?Math.max(0,Math.floor((Date.now()-t)/1000)):null;
 const urgent=i.priority==='ROJO'||!i.priority,limit=urgent?30:60,level=seconds===null?'unknown':seconds>=limit*2?'bad':seconds>=limit?'warn':'ok';if(level==='bad'){critical++;if(Store.isAdmin()&&!alerted.has(id)){alerted.add(id);window.E360SupervisorSOS?.(id);}}
 let n=nodes.get(id);
 if(!n){const row=document.createElement('div'),label=document.createElement('strong'),clock=document.createElement('span'),btn=document.createElement('button');btn.type='button';btn.textContent='Abrir para reconocer';btn.onclick=()=>window.E360OpenPendingSOS?.(i.id);row.append(label,clock,btn);n={row,label,clock};nodes.set(id,n);}
 n.row.dataset.level=level;n.label.textContent=id+' · '+(i.priority||'SIN TRIAGE');
 n.clock.textContent=(seconds===null?'Hora no disponible':seconds+' s sin reconocimiento')+' · '+(level==='bad'?'ESCALAR A RESPONSABLE':level==='warn'?'ATENCIÓN DEMORADA':'Pendiente de operador');
 if(list.children[index]!==n.row)list.insertBefore(n.row,list.children[index]||null);
 });
 const msg=pending.length+' sin reconocimiento humano · '+critical+' requieren escalamiento local'+(Store.isAdmin()?' · Vista administrativa':'');if(summary.textContent!==msg)summary.textContent=msg;
 }
 tick();setInterval(tick,1000);
}
document.addEventListener('DOMContentLoaded',mount);
})();