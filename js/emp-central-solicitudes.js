/* EMP Central — bandeja independiente de solicitudes no SOS */
(function(){
'use strict';
const Store=window.E360Store;
const root=document.getElementById('empServiceInbox');
if(!root||!Store)return;
const statuses=['RECIBIDA','EN_EVALUACION','CONFIRMADA','UNIDAD_ASIGNADA','EN_CURSO','FINALIZADA','CANCELADA','RECHAZADA'];
const names={consulta:'Consulta médica',domicilio:'Visita domiciliaria',traslado:'Traslado programado'};
function node(tag,text,cls){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;}
function date(s){return s?new Date(s).toLocaleString('es-AR'):'—';}
function detail(r){
 const d=r.datos||{};return Object.entries(d).filter(([k,v])=>v).map(([k,v])=>k+': '+String(v)).join(' · ');
}
let loading=false;
async function refresh(){
 if(loading||document.getElementById('centralApp')?.hidden)return;
 loading=true;
 try{
  const records=await Store.getServiceRequests();
  root.replaceChildren();
  root.appendChild(node('h2','Solicitudes asistenciales · '+records.filter(r=>r.estado==='RECIBIDA').length+' nuevas'));
  const bar=node('div',undefined,'emp-service-toolbar');const reload=node('button','Actualizar');reload.type='button';reload.onclick=refresh;bar.appendChild(reload);root.appendChild(bar);
  if(!records.length){root.appendChild(node('p','No hay solicitudes asistenciales registradas.'));return;}
  for(const r of records){
   const card=node('article',undefined,'emp-service-card');
   card.appendChild(node('h3',(names[r.tipo]||r.tipo)+' · '+r.estado));
   card.appendChild(node('p','Ingresó: '+date(r.created_at)+(r.fecha_traslado?' · Traslado: '+date(r.fecha_traslado):'')));
   card.appendChild(node('p',detail(r)));
   card.appendChild(node('p','Solicitud: '+r.id));
   const sel=node('select');sel.setAttribute('aria-label','Estado de solicitud');
   statuses.forEach(st=>{const o=node('option',st);o.value=st;sel.appendChild(o);});sel.value=r.estado;
   const note=node('textarea');note.placeholder='Observaciones de Central';note.value=r.observaciones_central||'';note.maxLength=1000;note.rows=2;
   const save=node('button','Guardar estado');save.type='button';
   const msg=node('p','');msg.setAttribute('role','status');
   save.onclick=async()=>{
    save.disabled=true;msg.textContent='Guardando…';
    try{await Store.updateServiceRequest(r.id,{estado:sel.value,observaciones_central:note.value.trim()});msg.textContent='Estado guardado.';}
    catch(e){msg.textContent='Error: '+(e.message||e);}
    finally{save.disabled=false;}
   };
   card.append(sel,note,save,msg);root.appendChild(card);
  }
 }catch(e){root.replaceChildren(node('h2','Solicitudes asistenciales'),node('p','No se pudo consultar la bandeja: '+(e.message||e)));}
 finally{loading=false;}
}
const btn=document.getElementById('centralServicesShortcut');
if(btn)btn.addEventListener('click',()=>{root.scrollIntoView({behavior:'smooth',block:'start'});refresh();});
setInterval(refresh,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setTimeout(refresh,1800);
})();
