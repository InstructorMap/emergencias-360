/* EMP · Archivo de historias clínicas, Central y Administración */
(function(){
'use strict';
const $=s=>document.querySelector(s);
let records=[],busy=false;
const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
async function download(record,button){
 if(busy)return;busy=true;button.disabled=true;button.textContent='Preparando ZIP…';
 try{
   let result=await window.E360Store.getIncidentExportUrl(record.id);
   if(!result?.url){
     await window.E360Store.generateIncidentExport(record.id);
     result=await window.E360Store.getIncidentExportUrl(record.id);
   }
   if(!result?.url)throw new Error('La exportación no devolvió un archivo. Revisá la función export-incident.');
   const a=document.createElement('a');a.href=result.url;a.target='_blank';a.rel='noopener';a.download=(record.clinical_record_number||'historia')+'.zip';document.body.appendChild(a);a.click();a.remove();
 }catch(err){alert('No se pudo descargar '+record.clinical_record_number+': '+(err.message||err));}
 finally{busy=false;button.disabled=false;button.textContent='⬇ Descargar ZIP';}
}
function init(){
 const header=$('.header-controls'),main=$('main');
 if(!header||!main||$('#empHistoriesPanel'))return;
 const open=make('button','📁 Historias clínicas','btn-secondary');open.type='button';header.prepend(open);
 const panel=make('section',undefined,'admin-card');panel.id='empHistoriesPanel';panel.hidden=true;panel.style.cssText='padding:20px;margin:16px 0;border:1px solid #64748b;border-radius:14px';
 const title=make('h2','Archivo de historias clínicas');const help=make('p','Incidentes cerrados. Buscá por número de historia, incidente, DNI o móvil. Solo usuarios autorizados.');
 const search=make('input');search.type='search';search.placeholder='Buscar historia, DNI, incidente o móvil';search.style.cssText='padding:12px;width:100%;max-width:560px;margin:10px 0';
 const refresh=make('button','Actualizar listado','btn-secondary');refresh.type='button';
 const status=make('p','');status.setAttribute('role','status');
 const list=make('div');list.style.cssText='display:grid;gap:10px;margin-top:12px';
 panel.append(title,help,search,refresh,status,list);main.prepend(panel);
 function render(){
  list.replaceChildren();const q=search.value.toLowerCase().trim();
  const filtered=records.filter(r=>[r.clinical_record_number,r.id,r.profile_dni,r.assigned_unit_id,r.base_id].some(v=>String(v||'').toLowerCase().includes(q)));
  status.textContent=filtered.length+' historias encontradas (últimas '+records.length+' cargadas)';
  for(const r of filtered){
    const row=make('article');row.style.cssText='padding:12px;border:1px solid #64748b;border-radius:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px';
    const info=make('div');info.append(make('strong',r.clinical_record_number),make('p','Incidente '+r.id+' · '+(r.base_id||'')+' · '+new Date(r.created_at).toLocaleDateString('es-AR')+' · Móvil '+(r.assigned_unit_id||'—')));
    const btn=make('button','⬇ Descargar ZIP','btn-primary');btn.type='button';btn.addEventListener('click',()=>download(r,btn));row.append(info,btn);list.append(row);
  }
 }
 async function load(){status.textContent='Consultando historias…';try{records=await window.E360Store.listClinicalHistories(200);render();}catch(e){status.textContent='Error: '+(e.message||e);}}
 open.addEventListener('click',()=>{panel.hidden=!panel.hidden;if(!panel.hidden)load();});
 refresh.addEventListener('click',load);search.addEventListener('input',render);
}
document.addEventListener('DOMContentLoaded',init);
})();