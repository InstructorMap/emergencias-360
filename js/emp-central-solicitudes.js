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
let initialized=false;
const known=new Set(), alerted=new Set();
function notifyNew(records){
 const incoming=records.filter(r=>r.estado==='RECIBIDA'&&!r.incident_id);
 if(!initialized){records.forEach(r=>known.add(r.id));initialized=true;return;}
 let fresh=false;
 for(const r of records){if(!known.has(r.id)){known.add(r.id);if(r.estado==='RECIBIDA'&&!r.incident_id){alerted.add(r.id);fresh=true;}}}
 for(const id of Array.from(alerted))if(!incoming.some(r=>r.id===id))alerted.delete(id);
 if(fresh&&document.getElementById('btnEmergencySound')?.getAttribute('aria-pressed')==='true'){
  const choice=Number(document.getElementById('empAlarmChoice')?.value||0);
  const files=['01_Alarma_Central_Clasica.wav','02_Sirena_Ascendente.wav','03_Alerta_Triple_Despacho.wav'];
  const audio=new Audio('assets/audio/'+(files[choice]||files[0]));
  audio.play().catch(err=>console.warn('[Central solicitudes] Audio requiere activación:',err));
 }
}
function renderNewAlert(){
 let alert=document.getElementById('empServiceNewAlert');
 if(!alert){alert=node('div',undefined,'emp-service-new-alert');alert.id='empServiceNewAlert';alert.setAttribute('role','alert');root.parentElement.insertBefore(alert,root);}
 alert.replaceChildren();
 if(!alerted.size){alert.hidden=true;return;}
 alert.hidden=false;
 alert.appendChild(node('strong','🔔 '+alerted.size+' solicitud(es) asistencial(es) nueva(s) '));
 const view=node('button','Ver y silenciar aviso');view.type='button';view.onclick=()=>{alerted.clear();renderNewAlert();root.scrollIntoView({behavior:'smooth',block:'start'});};
 alert.appendChild(view);
}

async function refresh(){
 if(loading||document.getElementById('centralApp')?.hidden)return;
 loading=true;
 try{
  const records=await Store.getServiceRequests();
  notifyNew(records);
  renderNewAlert();
  root.replaceChildren();
  root.appendChild(node('h2','Solicitudes asistenciales · '+records.filter(r=>r.estado==='RECIBIDA').length+' nuevas'));
  const bar=node('div',undefined,'emp-service-toolbar');const reload=node('button','Actualizar');reload.type='button';reload.onclick=async()=>{reload.disabled=true;reload.textContent='Actualizando…';await refresh();reload.disabled=false;reload.textContent='Actualizar';};bar.appendChild(reload);root.appendChild(bar);
  if(!records.length){root.appendChild(node('p','No hay solicitudes asistenciales registradas.'));return;}
  for(const r of records){
   const card=node('article',undefined,'emp-service-card');
   card.appendChild(node('h3',(names[r.tipo]||r.tipo)+' · '+r.estado));
   card.appendChild(node('p','Ingresó: '+date(r.created_at)+(r.fecha_traslado?' · Traslado: '+date(r.fecha_traslado):'')));
   card.appendChild(node('p',detail(r)));
   card.appendChild(node('p','Solicitud: '+r.id));
   const promotion=node('button',r.incident_id?'Ver incidente operativo':'Pasar a incidentes / asignar unidad');
   promotion.type='button';
   promotion.onclick=async()=>{
    promotion.disabled=true;
    try{
     const incidentId=r.incident_id||await Store.promoteServiceRequest(r.id);
     const base=document.getElementById('centralBaseSelector');if(base){base.value='ALL';base.dispatchEvent(new Event('change',{bubbles:true}));}
     const active=document.querySelector('.btn-incident-filter[data-filter="active"]');if(active)active.click();
     const items=Array.from(document.querySelectorAll('#incidentList li'));
     const target=items.find(x=>x.querySelector('.card-id')?.textContent===String(incidentId));
     if(target)target.click();
     else document.getElementById('incidentQueueTitle')?.focus();
     msg.textContent='Incidente operativo: '+incidentId;
     await refresh();
    }catch(e){msg.textContent='No se pudo crear el incidente: '+(e.message||e);}
    finally{promotion.disabled=false;}
   };
   card.appendChild(promotion);
   if(r.incident_id)card.appendChild(node('p','Incidente vinculado: '+r.incident_id));
   const sel=node('select');sel.setAttribute('aria-label','Estado de solicitud');
   statuses.forEach(st=>{const o=node('option',st);o.value=st;sel.appendChild(o);});sel.value=r.estado;
   const note=node('textarea');note.placeholder='Observaciones de Central';note.value=r.observaciones_central||'';note.maxLength=1000;note.rows=2;
   const save=node('button','Guardar estado');save.type='button';
   const msg=node('p','');msg.setAttribute('role','status');
   save.onclick=async()=>{
    save.disabled=true;msg.textContent='Guardando…';
    try{await Store.updateServiceRequest(r.id,{estado:sel.value,observaciones_central:note.value.trim()});if(sel.value==='CONFIRMADA'&&!r.incident_id){const id=await Store.promoteServiceRequest(r.id);msg.textContent='Confirmada y enviada a incidentes: '+id+'. Ya podés asignar unidad.';}else{msg.textContent='Estado guardado.';}await refresh();}
    catch(e){msg.textContent='Error: '+(e.message||e);}
    finally{save.disabled=false;}
   };
   card.append(sel,note,save,msg);root.appendChild(card);
  }
 }catch(e){root.replaceChildren(node('h2','Solicitudes asistenciales'),node('p','No se pudo consultar la bandeja: '+(e.message||e)));}
 finally{loading=false;}
}
const btn=document.getElementById('centralServicesShortcut');
if(btn)btn.addEventListener('click',refresh);
setInterval(refresh,10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setTimeout(refresh,1800);
})();
