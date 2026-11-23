/* EMP Triaje socio v1 — módulo aislado; no altera SOS, Guardia ni Central. */
(function(){
'use strict';
const $=s=>document.querySelector(s);
const base='assets/socio/triage/';
const images={consulta:'01_consulta_medica.webp',domicilio:'02_visita_domiciliaria.webp',evaluacion:'05_evaluacion_sintomas.webp',rojo:'06_prioridad_roja.webp',amarillo:'07_prioridad_amarilla.webp',verde:'08_prioridad_verde.webp'};
function img(name){return '<img src="'+base+images[name]+'" alt="" loading="lazy">';}
const questions=[
 {id:'motivo',label:'¿Cuál es el motivo principal de la consulta?',type:'select',opts:['','Fiebre','Dolor','Malestar general','Síntomas respiratorios','Control de salud','Seguimiento de tratamiento','Otro']},
 {id:'detalle',label:'Contanos brevemente qué sucede',type:'textarea'},
 {id:'inicio',label:'¿Cuándo comenzaron los síntomas?',type:'select',opts:['','Hoy','Hace 1 a 3 días','Hace más de 3 días','No tengo síntomas, solicito un control']},
 {id:'empeora',label:'¿El problema está empeorando?',type:'select',opts:['','Sí','No','No estoy seguro/a']},
 {id:'alarma',label:'¿Hay dificultad importante para respirar, dolor fuerte de pecho, pérdida de conciencia, convulsiones, sangrado abundante o signos de ACV?',type:'select',opts:['','Sí','No','No estoy seguro/a']}
];
function field(q){const id='tr-'+q.id;return '<label for="'+id+'">'+q.label+(q.id==='detalle'?' (opcional)':'')+'</label>'+(q.type==='textarea'?'<textarea id="'+id+'" rows="3" maxlength="450"></textarea>':'<select id="'+id+'" required>'+q.opts.map((v,i)=>'<option value="'+v+'">'+(i===0?'Seleccioná una opción':v)+'</option>').join('')+'</select>');}
function boot(){
 const host=$('#empTriaje');if(!host)return;
 host.innerHTML='<div class="tr-head"><h2>Solicitar asistencia médica</h2><p>Para consultas y visitas domiciliarias. Ante una emergencia, utilizá SOS o llamá a EMP.</p></div><div class="tr-types"><button type="button" data-kind="consulta">'+img('consulta')+'<span>Consulta médica</span></button><button type="button" data-kind="domicilio">'+img('domicilio')+'<span>Visita domiciliaria</span></button></div><form id="tr-form" hidden>'+img('evaluacion')+'<h3>Evaluación inicial</h3>'+questions.map(field).join('')+'<label for="tr-telefono">Teléfono de contacto</label><input id="tr-telefono" type="tel" maxlength="30" required><button type="submit">Evaluar solicitud</button></form><div id="tr-result" role="status" aria-live="polite"></div>';
 let kind='';
 host.querySelectorAll('[data-kind]').forEach(b=>b.addEventListener('click',()=>{kind=b.dataset.kind;host.querySelectorAll('[data-kind]').forEach(x=>x.classList.toggle('selected',x===b));$('#tr-form').hidden=false;$('#tr-result').innerHTML='';$('#tr-form').scrollIntoView({behavior:'smooth',block:'nearest'});}));
 $('#tr-form').addEventListener('submit',e=>{
  e.preventDefault();
  const val=id=>$('#tr-'+id).value.trim();
  const p=window.E360Store&&window.E360Store.getActiveProfile?window.E360Store.getActiveProfile():null;
  if(!p){$('#tr-result').textContent='Iniciá sesión como socio para continuar.';return;}
  const alarm=val('alarma');
  const red=alarm!=='No';
  const yellow=!red&&(val('empeora')!=='No'||val('inicio')==='Hoy');
  const priority=red?'rojo':yellow?'amarillo':'verde';
  const result=$('#tr-result');result.replaceChildren();
  const picture=document.createElement('img');picture.src=base+images[priority];picture.alt='';result.appendChild(picture);
  const h=document.createElement('h3');h.textContent=red?'Posible emergencia: pedí ayuda ahora':yellow?'Consulta que requiere valoración prioritaria':'Consulta para evaluación y programación';result.appendChild(h);
  const msg=document.createElement('p');msg.textContent=red?'Los síntomas referidos pueden requerir atención inmediata. No esperes ni completes otros formularios.': 'Clasificación orientativa: debe ser confirmada por personal sanitario de EMP. La solicitud todavía no fue enviada.';result.appendChild(msg);
  if(red){const sos=document.createElement('button');sos.type='button';sos.textContent='Ir al SOS';sos.onclick=()=>{const tab=document.querySelector('#nav-sos');if(tab)tab.click();};result.appendChild(sos);}
  const phone=document.createElement('a');phone.href='tel:2245444600';phone.textContent='Llamar a EMP: 2245-444600';result.appendChild(phone);
  if(!red){const note=document.createElement('p');note.textContent='El formulario de triaje está preparado para integrar la recepción de solicitudes en Central. Por seguridad, hasta habilitar ese circuito, coordiná la atención por teléfono.';result.appendChild(note);}
  result.scrollIntoView({behavior:'smooth',block:'nearest'});
 });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();