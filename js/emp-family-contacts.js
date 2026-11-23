/* EMP Cuidado Familiar 360 — Bloque 1: contactos del titular, sin envío de alertas */
(function(){
'use strict';
const root=document.getElementById('empFamilyContacts');if(!root)return;
const store=()=>window.E360Store;
function el(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
function make(tag,props){const e=el(tag);Object.assign(e,props);return e;}
root.innerHTML='<div class="emp-family-title"><img src="assets/familiar/03_red_familiar.webp" alt="" loading="lazy"><div><h2>Mi red familiar</h2><p>Elegí quiénes podrán recibir avisos de EMP. Los contactos se guardan de forma privada; todavía no reciben notificaciones.</p></div></div><form id="empFamilyForm"><label>Nombre del familiar<input name="nombre" required minlength="2" maxlength="120" autocomplete="name"></label><label>Vínculo<select name="relacion"><option>Familiar</option><option>Hijo/a</option><option>Pareja</option><option>Hermano/a</option><option>Cuidador/a</option><option>Persona de confianza</option></select></label><label>Teléfono<input name="telefono" type="tel" required minlength="6" maxlength="35" autocomplete="tel"></label><label>Correo electrónico (opcional)<input name="email" type="email" maxlength="180" autocomplete="email"></label><label>Tipo de contacto<select name="nivel"><option value="emergencia">Contacto de emergencia</option><option value="cuidador">Cuidador autorizado</option><option value="seguimiento">Familiar de seguimiento</option></select></label><fieldset><legend>Qué avisos autorizás</legend><label><input type="checkbox" name="aviso_sos" checked> Emergencias SOS</label><label><input type="checkbox" name="aviso_asistencia"> Consultas, visitas y traslados</label><label><input type="checkbox" name="aviso_medicacion"> Tomas de medicación sin confirmar</label></fieldset><label class="emp-family-consent"><input type="checkbox" name="consentimiento_titular" required> Autorizo a EMP a registrar este contacto y compartir únicamente los avisos seleccionados cuando el familiar acepte su vinculación. Puedo revocar el permiso.</label><button type="submit">Guardar contacto</button></form><p id="empFamilyMessage" role="status" aria-live="polite"></p><h3>Contactos registrados</h3><div id="empFamilyList"></div><button id="empFamilyReload" type="button">Actualizar contactos</button>';
const form=document.getElementById('empFamilyForm'),list=document.getElementById('empFamilyList'),msg=document.getElementById('empFamilyMessage');
async function refresh(){
 try{
  const rows=await store().listFamilyContacts();list.replaceChildren();
  if(!rows.length){list.appendChild(el('p','Todavía no agregaste contactos.'));return;}
  for(const r of rows){
   const card=make('article',{className:'emp-family-contact'});
   card.appendChild(el('strong',r.nombre));
   card.appendChild(el('p',r.relacion+' · '+r.telefono+(r.email?' · '+r.email:'')));
   card.appendChild(el('p',r.activo?'Pendiente de aceptación del familiar · avisos no habilitados':'Acceso revocado'));
   const scopes=[r.aviso_sos?'SOS':null,r.aviso_asistencia?'Asistencia':null,r.aviso_medicacion?'Medicación':null].filter(Boolean);
   card.appendChild(el('small','Permisos solicitados: '+(scopes.join(', ')||'Ninguno')));
   if(r.activo){const b=el('button','Revocar autorización');b.type='button';b.onclick=async()=>{if(!confirm('¿Revocar este contacto?'))return;b.disabled=true;try{await store().revokeFamilyContact(r.id);msg.textContent='Autorización revocada.';await refresh();}catch(e){msg.textContent='Error: '+e.message;b.disabled=false;}};card.appendChild(b);}
   list.appendChild(card);
  }
 }catch(e){list.replaceChildren(el('p','Para administrar tu red familiar, iniciá sesión como socio. '+(e.message||'')));}
}
form.addEventListener('submit',async e=>{
 e.preventDefault();const b=form.querySelector('[type=submit]');b.disabled=true;msg.textContent='Guardando…';
 try{
  const d=new FormData(form);
  const fields={nombre:String(d.get('nombre')).trim(),relacion:String(d.get('relacion')),telefono:String(d.get('telefono')).trim(),email:String(d.get('email')||'').trim()||null,nivel:String(d.get('nivel')),aviso_sos:d.has('aviso_sos'),aviso_asistencia:d.has('aviso_asistencia'),aviso_medicacion:d.has('aviso_medicacion'),consentimiento_titular:d.has('consentimiento_titular')};
  if(!fields.consentimiento_titular)throw Error('Es necesaria tu autorización.');
  await store().addFamilyContact(fields);
  msg.textContent='Contacto registrado. La vinculación sigue pendiente: no se enviarán alertas hasta que el familiar acepte.';
  form.reset();await refresh();
 }catch(err){msg.textContent='No se pudo guardar: '+(err.message||err);}
 finally{b.disabled=false;}
});
document.getElementById('empFamilyReload').onclick=refresh;
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setTimeout(refresh,900);
})();