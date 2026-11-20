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
/* Siluetas anatómicas con contorno, articulaciones y referencias óseas.
   El trazo rojo se dibuja en una capa superior del mismo lienzo. */
function drawAnatomy(ctx,w,h){
 ctx.save();ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
 const names=['ANTERIOR','POSTERIOR','LATERAL DER.','LATERAL IZQ.'];
 for(let i=0;i<4;i++){
  const x=87+i*174,flip=i===3?-1:1;
  ctx.save();ctx.translate(x,0);ctx.scale(flip,1);
  ctx.strokeStyle='#667c92';ctx.fillStyle='#e9eff4';ctx.lineWidth=1.5;
  // Cráneo, cuello, cintura escapular, brazos, pelvis y extremidades.
  ctx.beginPath();ctx.ellipse(0,48,i<2?19:15,26,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.beginPath();
  if(i<2){
   ctx.moveTo(-10,73);ctx.lineTo(-12,85);ctx.bezierCurveTo(-29,85,-37,90,-39,105);
   ctx.bezierCurveTo(-42,122,-45,147,-46,164);ctx.lineTo(-40,195);
   ctx.lineTo(-30,195);ctx.lineTo(-29,170);ctx.lineTo(-26,125);
   ctx.bezierCurveTo(-23,156,-26,178,-25,193);
   ctx.bezierCurveTo(-28,209,-28,222,-26,235);
   ctx.lineTo(-24,265);ctx.bezierCurveTo(-23,285,-18,307,-17,325);
   ctx.lineTo(-14,367);ctx.lineTo(-21,386);ctx.quadraticCurveTo(-24,396,-13,397);
   ctx.lineTo(-2,397);ctx.lineTo(-1,370);ctx.lineTo(-2,320);ctx.lineTo(0,270);
   ctx.lineTo(2,320);ctx.lineTo(1,370);ctx.lineTo(2,397);ctx.lineTo(13,397);
   ctx.quadraticCurveTo(24,396,21,386);ctx.lineTo(14,367);ctx.lineTo(17,325);
   ctx.bezierCurveTo(18,307,23,285,24,265);ctx.lineTo(26,235);
   ctx.bezierCurveTo(28,222,28,209,25,193);
   ctx.bezierCurveTo(26,178,23,156,26,125);ctx.lineTo(29,170);
   ctx.lineTo(30,195);ctx.lineTo(40,195);ctx.lineTo(46,164);
   ctx.bezierCurveTo(45,147,42,122,39,105);ctx.bezierCurveTo(37,90,29,85,12,85);
   ctx.lineTo(10,73);ctx.closePath();
  }else{
   ctx.moveTo(-8,73);ctx.lineTo(-9,85);ctx.bezierCurveTo(-22,87,-24,100,-25,117);
   ctx.lineTo(-28,160);ctx.lineTo(-23,194);ctx.lineTo(-14,194);ctx.lineTo(-13,159);
   ctx.lineTo(-12,130);ctx.lineTo(-15,176);ctx.lineTo(-13,217);ctx.lineTo(-15,266);
   ctx.lineTo(-14,320);ctx.lineTo(-12,375);ctx.lineTo(-17,393);ctx.lineTo(-4,395);
   ctx.lineTo(2,375);ctx.lineTo(5,319);ctx.lineTo(8,273);ctx.lineTo(14,320);
   ctx.lineTo(12,375);ctx.lineTo(17,395);ctx.lineTo(28,393);ctx.lineTo(24,375);
   ctx.lineTo(23,319);ctx.lineTo(22,266);ctx.lineTo(18,217);ctx.lineTo(17,176);
   ctx.lineTo(15,130);ctx.lineTo(18,159);ctx.lineTo(19,194);ctx.lineTo(28,194);
   ctx.lineTo(32,160);ctx.lineTo(29,117);ctx.bezierCurveTo(27,100,22,87,9,85);
   ctx.lineTo(8,73);ctx.closePath();
  }
  ctx.fill();ctx.stroke();
  ctx.strokeStyle='#a6b8c7';ctx.lineWidth=1;
  if(i<2){
   ctx.beginPath();ctx.moveTo(-26,109);ctx.quadraticCurveTo(0,131,26,109);ctx.moveTo(0,88);ctx.lineTo(0,252);
   ctx.moveTo(-21,188);ctx.quadraticCurveTo(0,199,21,188);
   ctx.moveTo(-19,245);ctx.quadraticCurveTo(0,255,19,245);ctx.stroke();
   if(i===0){ctx.beginPath();ctx.arc(-12,132,9,0,Math.PI*2);ctx.arc(12,132,9,0,Math.PI*2);ctx.stroke();}
   else{ctx.beginPath();ctx.moveTo(-14,110);ctx.quadraticCurveTo(0,127,0,153);ctx.quadraticCurveTo(0,127,14,110);ctx.stroke();}
  }else{ctx.beginPath();ctx.moveTo(0,102);ctx.quadraticCurveTo(13,150,5,190);ctx.stroke();}
  ctx.restore();
  ctx.fillStyle='#31465c';ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.fillText(names[i],x,422);
 }
 ctx.restore();ctx.strokeStyle='#c32236';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';
}
function canvasPad(canvas,body=false){
 const ctx=canvas.getContext('2d');canvas.width=body?700:550;canvas.height=body?440:145;
 const clear=()=>{if(body)drawAnatomy(ctx,canvas.width,canvas.height);else{ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#183f78';ctx.lineWidth=2.5;ctx.lineCap='round';}};
 clear();let drawing=false,last=null;
 const pos=e=>{const b=canvas.getBoundingClientRect();return{x:(e.clientX-b.left)*canvas.width/b.width,y:(e.clientY-b.top)*canvas.height/b.height};};
 canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);drawing=true;last=pos(e);});
 canvas.addEventListener('pointermove',e=>{if(!drawing)return;const next=pos(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(next.x,next.y);ctx.stroke();last=next;dirty=true;});
 canvas.addEventListener('pointerup',()=>drawing=false);
 canvas.addEventListener('pointercancel',()=>drawing=false);
 return clear;
}
function loadImage(canvas,data){if(!data)return;const img=new Image();img.onload=()=>{const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(img,0,0,canvas.width,canvas.height);};img.src=data;}
async function open(incident){
 const store=window.E360Store,db=store?._getState()?.supabase;
 if(!db){alert('Iniciá sesión para completar la historia.');return;}
 activeId=incident.id;const panel=$('#empClinicalPanel');panel.hidden=false;window.EMPGuardiaTactical?.activate('clinica');$('#tacClinicalEmpty')?.setAttribute('hidden','');showStep(0);panel.scrollIntoView({behavior:'smooth'});
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
let currentStep=0;
function showStep(index){const stages=[...document.querySelectorAll('#empClinicalPanel .hc-stage')];currentStep=Math.max(0,Math.min(index,stages.length-1));stages.forEach((n,i)=>n.classList.toggle('is-active',i===currentStep));document.querySelectorAll('#empClinicalPanel .hc-step').forEach((n,i)=>{n.classList.toggle('is-active',i===currentStep);n.setAttribute('aria-selected',i===currentStep?'true':'false');});const prev=$('#hcPrev'),next=$('#hcNext');if(prev)prev.disabled=currentStep===0;if(next)next.textContent=currentStep===stages.length-1?'Volver al inicio':'Siguiente →';}
function init(){
 const main=$('#tacClinicalMount')||$('main');if(!main||$('#empClinicalPanel'))return;
 const panel=el('section','admin-card');panel.id='empClinicalPanel';panel.hidden=true;panel.style.cssText='padding:18px;margin:20px 0;background:#102a47;color:#fff;border:1px solid #476787;border-radius:14px';
 const h=el('h2',null,'Historia clínica prehospitalaria de emergencia · EMP 107');
 const sub=el('p');sub.id='empClinicalIncident';
 const note=el('p',null,'Formulario asistencial asociado al incidente. Las firmas son trazos manuscritos electrónicos; no son firmas digitales certificadas.');
 panel.append(h,sub,note);
 const stepbar=el('div','hc-stepbar');stepbar.setAttribute('role','tablist');panel.append(stepbar);
 const stages=[];
 for(const [heading,items] of fields){
  const section=el('fieldset');section.style.cssText='border:1px solid #476787;border-radius:9px;padding:12px;margin:14px 0';
  const legend=el('legend',null,heading);legend.style.fontWeight='700';section.append(legend);
  const grid=el('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px';
  for(const [key,label] of items){const wrap=el('label');wrap.style.cssText='display:flex;flex-direction:column;gap:5px;font-size:13px';wrap.append(document.createTextNode(label));
   const input=['observations','lesions','refusal','consent','supplies'].includes(key)?el('textarea'):el('input');
   input.dataset.hc=key;input.style.cssText='width:100%;box-sizing:border-box;padding:10px;background:#fff;color:#172338;border-radius:7px;border:1px solid #b6c5d4';if(input.tagName==='TEXTAREA')input.rows=3;
   input.addEventListener('input',()=>dirty=true);wrap.append(input);grid.append(wrap);}
  section.append(grid);const stage=el('div','hc-stage');stage.append(section);stages.push(stage);
  const step=el('button','hc-step',heading);step.type='button';step.setAttribute('role','tab');step.addEventListener('click',()=>showStep(stages.indexOf(stage)));stepbar.append(step);
 }
 const drawing=el('fieldset');drawing.style.cssText='border:1px solid #476787;padding:12px;border-radius:9px';
 drawing.append(el('legend',null,'Mapa corporal · Marcar lesiones con el dedo o lápiz'));
 const body=el('canvas');body.id='empPadBody';body.dataset.pad='body';body.style.cssText='width:100%;max-width:700px;background:white;touch-action:none;border-radius:8px;display:block';
 drawing.append(body);const clearBody=el('button',null,'Limpiar dibujo');clearBody.type='button';clearBody.onclick=()=>{body._clear();dirty=true;};drawing.append(clearBody);const lesionStage=el('div','hc-stage');lesionStage.append(drawing);stages.push(lesionStage);const lesionTab=el('button','hc-step','Mapa corporal');lesionTab.type='button';lesionTab.onclick=()=>showStep(stages.indexOf(lesionStage));stepbar.append(lesionTab);
 const signatures=el('fieldset');signatures.style.cssText='border:1px solid #476787;padding:12px;margin-top:14px;border-radius:9px';
 signatures.append(el('legend',null,'Firmas manuscritas en pantalla'));
 for(const [key,label] of signNames){const wrap=el('div');wrap.style.cssText='margin:14px 0';wrap.append(el('p',null,label));const c=el('canvas');c.dataset.pad=key;c.style.cssText='width:100%;max-width:550px;height:145px;background:white;touch-action:none;display:block;border-radius:8px';wrap.append(c);const b=el('button',null,'Borrar firma');b.type='button';b.onclick=()=>{c._clear();dirty=true;};wrap.append(b);signatures.append(wrap);}
 const signStage=el('div','hc-stage');signStage.append(signatures);stages.push(signStage);const signTab=el('button','hc-step','Firmas');signTab.type='button';signTab.onclick=()=>showStep(stages.indexOf(signStage));stepbar.append(signTab);
 stages.forEach(stage=>panel.append(stage));
 const controls=el('div','hc-controls');const prev=el('button',null,'← Anterior');prev.id='hcPrev';prev.type='button';prev.onclick=()=>showStep(currentStep-1);const next=el('button',null,'Siguiente →');next.id='hcNext';next.type='button';next.onclick=()=>showStep(currentStep===stages.length-1?0:currentStep+1);controls.append(prev,next);panel.append(controls);
 const status=el('p');status.id='empClinicalStatus';status.setAttribute('role','status');
 const saveBtn=el('button','btn-primary','Guardar historia y firmas');saveBtn.id='empClinicalSave';saveBtn.type='button';saveBtn.onclick=save;
 const closeBtn=el('button','btn-secondary','Cerrar formulario');closeBtn.type='button';closeBtn.onclick=()=>{if(dirty&&!confirm('Hay cambios sin guardar. ¿Cerrar?'))return;panel.hidden=true;$('#tacClinicalEmpty')?.removeAttribute('hidden');};
 panel.append(status,saveBtn,closeBtn);main.append(panel);
 for(const canvas of panel.querySelectorAll('canvas[data-pad]'))canvas._clear=canvasPad(canvas,canvas.dataset.pad==='body');
 showStep(0);
}
window.EMPClinicalForm={open};
document.addEventListener('DOMContentLoaded',init);
})();