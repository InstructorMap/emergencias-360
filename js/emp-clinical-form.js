/* EMP | Historia clínica prehospitalaria por incidente */
(function(){
'use strict';
const $=s=>document.querySelector(s);
const fields=[
['Despacho y atención',[['incident_number','Incidente N°'],['date','Fecha'],['received_time','Hora recepción'],['arrival_time','Hora arribo'],['call_received','Recibe llamada'],['mobile','Móvil N°'],['base','Base'],['reason','Motivo'],['dispatch_type','Código N/R/A/V']]],
['Paciente',[['name','Nombre y apellido'],['address','Domicilio'],['age','Edad'],['sex','Sexo'],['dni','DNI'],['insurance','Obra social'],['email','Correo electrónico'],['phone','Teléfono']]],
['Lugar y tipo de incidente',[['place','Lugar (vía pública/domicilio/otro)'],['incident_type','Tipo (accidente, deporte, corte, explosión, dolor, violencia, otro)'],['police','Intervención policial'],['fire','Intervención bomberos']]],
['Atención prehospitalaria',[['mobility','Estado: activo / inmóvil / deambula / atrapado'],['bp','Tensión arterial'],['pulse','Frecuencia cardíaca'],['resp_rate','Frecuencia respiratoria'],['oxygen','Saturación O₂ (%)'],['temp','Temperatura (°C)'],['glucose','Glucemia'],['capillary','Relleno capilar'],['resp_exam','Respiratorio'],['abdomen','Abdomen'],['circulation','Circulación'],['neurological','Neurológico / pérdida de conocimiento'],['lesions','Descripción de lesiones'],['diagnosis','Diagnóstico presuntivo']]],
['Evolución y tratamiento',[['observations','Observaciones / tratamiento realizado'],['supplies','Insumos utilizados']]],
['Destino y traslado',[['disposition','Destino: domicilio / no encontrado / otro móvil / hospital / sanatorio'],['transport','Traslado: sí / no'],['receiving_institution','Institución receptora'],['receiving_staff','Profesional receptor']]],
['Constancias',[['police_station','Comisaría / intervención policial'],['officer','Oficial a cargo'],['officer_id','LP / identificación'],['refusal','Negativa de atención o traslado: circunstancias y explicación de riesgos'],['consent','Aceptación / conformidad del paciente o responsable'],['crew','Personal actuante: médico, TEM, conductor']]]
];
const signNames=[['patient','Paciente / familiar / responsable'],['receiver','Profesional o institución receptora'],['refusal','Negativa de atención o traslado'],['medic','Médico'],['tem','Técnico en emergencias'],['driver','Conductor']];
let activeId=null,loaded=null,dirty=false;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function canvasPad(canvas,body=false){
 const ctx=canvas.getContext('2d');canvas.width=body?700:550;canvas.height=body?440:145;
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
 if(body){
   ctx.strokeStyle='#94a3b8';ctx.lineWidth=2;
   for(let i=0;i<4;i++){const x=85+i*170,y=24;ctx.beginPath();ctx.ellipse(x,y+32,19,28,0,0,Math.PI*2);ctx.moveTo(x-24,y+65);ctx.lineTo(x-37,y+160);ctx.lineTo(x-24,y+192);ctx.moveTo(x+24,y+65);ctx.lineTo(x+37,y+160);ctx.lineTo(x+24,y+192);ctx.moveTo(x-24,y+65);ctx.quadraticCurveTo(x,y+55,x+24,y+65);ctx.lineTo(x+18,y+202);ctx.lineTo(x+12,y+355);ctx.moveTo(x-24,y+65);ctx.lineTo(x-18,y+202);ctx.lineTo(x-12,y+355);ctx.moveTo(x-18,y+202);ctx.lineTo(x+18,y+202);ctx.stroke();
   ctx.fillStyle='#475569';ctx.font='14px sans-serif';ctx.fillText(['Frente','Posterior','Lateral D','Lateral I'][i],x-35,425);}
 }
 ctx.strokeStyle='#b91c1c';ctx.lineWidth=3;ctx.lineCap='round';
 let drawing=false,last=null;
 const pos=e=>{const b=canvas.getBoundingClientRect();return{x:(e.clientX-b.left)*canvas.width/b.width,y:(e.clientY-b.top)*canvas.height/b.height};};
 canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);drawing=true;last=pos(e);});
 canvas.addEventListener('pointermove',e=>{if(!drawing)return;const next=pos(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(next.x,next.y);ctx.stroke();last=next;dirty=true;});
 canvas.addEventListener('pointerup',()=>drawing=false);
 canvas.addEventListener('pointercancel',()=>drawing=false);
 return ()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);if(body){ctx.strokeStyle='#94a3b8';ctx.lineWidth=2;for(let i=0;i<4;i++){const x=85+i*170,y=24;ctx.beginPath();ctx.ellipse(x,y+32,19,28,0,0,Math.PI*2);ctx.moveTo(x-24,y+65);ctx.lineTo(x-37,y+160);ctx.lineTo(x-24,y+192);ctx.moveTo(x+24,y+65);ctx.lineTo(x+37,y+160);ctx.lineTo(x+24,y+192);ctx.moveTo(x-24,y+65);ctx.quadraticCurveTo(x,y+55,x+24,y+65);ctx.lineTo(x+18,y+202);ctx.lineTo(x+12,y+355);ctx.moveTo(x-18,y+202);ctx.lineTo(x+18,y+202);ctx.stroke();ctx.fillStyle='#475569';ctx.font='14px sans-serif';ctx.fillText(['Frente','Posterior','Lateral D','Lateral I'][i],x-35,425);}}ctx.strokeStyle='#b91c1c';ctx.lineWidth=3;};
}
function loadImage(canvas,data){if(!data)return;const img=new Image();img.onload=()=>{const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(img,0,0,canvas.width,canvas.height);};img.src=data;}
async function open(incident){
 const store=window.E360Store,db=store?._getState()?.supabase;
 if(!db){alert('Iniciá sesión para completar la historia.');return;}
 activeId=incident.id;const panel=$('#empClinicalPanel');panel.hidden=false;panel.scrollIntoView({behavior:'smooth'});
 $('#empClinicalIncident').textContent='Incidente '+incident.id;
 const {data,error}=await db.from('emp_clinical_forms').select('*').eq('incident_id',incident.id).maybeSingle();
 if(error){alert('No se pudo cargar la ficha: '+error.message);return;}
 loaded=data;const values=data?.form_data||{};
 for(const field of panel.querySelectorAll('[data-hc]'))field.value=values[field.dataset.hc]||'';
 if(!data){
  const presets={incident_number:incident.id,date:new Date().toLocaleDateString('es-AR'),mobile:incident.assignedUnitId||'',base:incident.baseId||'',dni:incident.profileDni||'',address:incident.manualAddress||'',reason:incident.clinicalNotes||''};
  for(const [k,v] of Object.entries(presets)){const input=panel.querySelector('[data-hc="'+k+'"]');if(input)input.value=v;}
 }
 for(const canvas of panel.querySelectorAll('canvas[data-pad]')){canvas._clear();loadImage(canvas,canvas.dataset.pad==='body'?data?.lesion_drawing:data?.signatures?.[canvas.dataset.pad]);}
 $('#empClinicalStatus').textContent=data?'Ficha guardada · '+new Date(data.updated_at).toLocaleString('es-AR'):'Ficha nueva sin guardar';
 dirty=false;
}
async function save(){
 if(!activeId)return;const db=window.E360Store?._getState()?.supabase;
 const btn=$('#empClinicalSave');btn.disabled=true;
 try{
  const form_data={};for(const n of document.querySelectorAll('#empClinicalPanel [data-hc]'))form_data[n.dataset.hc]=n.value;
  const body=$('#empPadBody').toDataURL('image/png');
  const signatures={};for(const c of document.querySelectorAll('#empClinicalPanel canvas[data-pad]:not([data-pad="body"])'))signatures[c.dataset.pad]=c.toDataURL('image/png');
  const session=(await db.auth.getUser()).data.user;
  if(!session)throw new Error('Sesión caducada');
  const payload={incident_id:activeId,form_data,lesion_drawing:body,signatures,author_user_id:loaded?.author_user_id||session.id,updated_at:new Date().toISOString()};
  const {data,error}=await db.from('emp_clinical_forms').upsert(payload,{onConflict:'incident_id'}).select().single();
  if(error)throw error;
  loaded=data;dirty=false;$('#empClinicalStatus').textContent='Guardado correctamente · '+new Date().toLocaleString('es-AR');
 }catch(e){alert('No se pudo guardar la historia: '+(e.message||e));}
 finally{btn.disabled=false;}
}
function init(){
 const main=$('main');if(!main||$('#empClinicalPanel'))return;
 const panel=el('section','admin-card');panel.id='empClinicalPanel';panel.hidden=true;panel.style.cssText='padding:18px;margin:20px 0;background:#102a47;color:#fff;border:1px solid #476787;border-radius:14px';
 const h=el('h2',null,'Historia clínica prehospitalaria de emergencia · EMP 107');
 const sub=el('p');sub.id='empClinicalIncident';
 const note=el('p',null,'Formulario asistencial asociado al incidente. Las firmas son trazos manuscritos electrónicos; no son firmas digitales certificadas.');
 panel.append(h,sub,note);
 for(const [heading,items] of fields){
  const section=el('fieldset');section.style.cssText='border:1px solid #476787;border-radius:9px;padding:12px;margin:14px 0';
  const legend=el('legend',null,heading);legend.style.fontWeight='700';section.append(legend);
  const grid=el('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px';
  for(const [key,label] of items){const wrap=el('label');wrap.style.cssText='display:flex;flex-direction:column;gap:5px;font-size:13px';wrap.append(document.createTextNode(label));
   const input=['observations','lesions','refusal','consent','supplies'].includes(key)?el('textarea'):el('input');
   input.dataset.hc=key;input.style.cssText='width:100%;box-sizing:border-box;padding:10px;background:#fff;color:#172338;border-radius:7px;border:1px solid #b6c5d4';if(input.tagName==='TEXTAREA')input.rows=3;
   input.addEventListener('input',()=>dirty=true);wrap.append(input);grid.append(wrap);}
  section.append(grid);panel.append(section);
 }
 const drawing=el('fieldset');drawing.style.cssText='border:1px solid #476787;padding:12px;border-radius:9px';
 drawing.append(el('legend',null,'Mapa corporal · Marcar lesiones con el dedo o lápiz'));
 const body=el('canvas');body.id='empPadBody';body.dataset.pad='body';body.style.cssText='width:100%;max-width:700px;background:white;touch-action:none;border-radius:8px;display:block';
 drawing.append(body);const clearBody=el('button',null,'Limpiar dibujo');clearBody.type='button';clearBody.onclick=()=>{body._clear();dirty=true;};drawing.append(clearBody);panel.append(drawing);
 const signatures=el('fieldset');signatures.style.cssText='border:1px solid #476787;padding:12px;margin-top:14px;border-radius:9px';
 signatures.append(el('legend',null,'Firmas manuscritas en pantalla'));
 for(const [key,label] of signNames){const wrap=el('div');wrap.style.cssText='margin:14px 0';wrap.append(el('p',null,label));const c=el('canvas');c.dataset.pad=key;c.style.cssText='width:100%;max-width:550px;height:145px;background:white;touch-action:none;display:block;border-radius:8px';wrap.append(c);const b=el('button',null,'Borrar firma');b.type='button';b.onclick=()=>{c._clear();dirty=true;};wrap.append(b);signatures.append(wrap);}
 panel.append(signatures);
 const status=el('p');status.id='empClinicalStatus';status.setAttribute('role','status');
 const saveBtn=el('button','btn-primary','Guardar historia y firmas');saveBtn.id='empClinicalSave';saveBtn.type='button';saveBtn.onclick=save;
 const closeBtn=el('button','btn-secondary','Cerrar formulario');closeBtn.type='button';closeBtn.onclick=()=>{if(dirty&&!confirm('Hay cambios sin guardar. ¿Cerrar?'))return;panel.hidden=true;};
 panel.append(status,saveBtn,closeBtn);main.append(panel);
 for(const canvas of panel.querySelectorAll('canvas[data-pad]'))canvas._clear=canvasPad(canvas,canvas.dataset.pad==='body');
}
window.EMPClinicalForm={open};
document.addEventListener('DOMContentLoaded',init);
})();