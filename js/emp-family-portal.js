(function(){'use strict';
const cfg=window.E360SupabaseConfig;
const client=window.supabase.createClient(cfg.URL,cfg.ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
const $=id=>document.getElementById(id),auth=$('authPanel'),app=$('appPanel');
function msg(id,text){$(id).textContent=text;}
function elem(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
function button(text,fn){const b=elem('button',text);b.type='button';b.onclick=fn;return b;}
async function render(){
 const {data:{user},error}=await client.auth.getUser();
 auth.classList.toggle('hidden',!!user);app.classList.toggle('hidden',!user);
 if(!user){if(error)msg('authMessage','Iniciá sesión para continuar.');return;}
 $('currentEmail').textContent=user.email||'Cuenta familiar';
 await refresh();
}
let currentEvents=[];
function clear(id){$(id).replaceChildren();}
function empty(id,text){$(id).appendChild(Object.assign(elem('p',text),{className:'empty'}));}
function eventCard(ev){
 const card=elem('article');card.className='event-card';
 const type=elem('span',ev.tipo);type.className='event-type';card.appendChild(type);
 card.appendChild(elem('strong',ev.titulo+' · '+ev.socio));
 card.appendChild(elem('div','Estado: '+ev.estado));
 const d=elem('div',new Date(ev.fecha).toLocaleString('es-AR'));d.className='event-date';card.appendChild(d);
 if(ev.accion){card.appendChild(elem('p',ev.accion==='CONTACTARE'?'✓ Voy a contactar al socio':'✓ Estoy al tanto'));return card;}
 const actions=elem('div');actions.className='actions';
 for(const [action,label] of [['VISTO','Estoy al tanto'],['CONTACTARE','Voy a contactarlo']]){
  actions.appendChild(button(label,async function(){
   this.disabled=true;
   const {error}=await client.from('emp_family_acknowledgements').insert({family_user_id:(await client.auth.getUser()).data.user.id,contact_id:ev.contact_id,event_key:ev.event_key,action});
   if(error){msg('appMessage','No se pudo registrar: '+error.message);this.disabled=false;return;}
   await refresh();
  }));
 }
 card.appendChild(actions);return card;
}
function renderEvents(id,events,emptyText){
 clear(id);if(!events.length){empty(id,emptyText);return;}
 for(const ev of events)$(id).appendChild(eventCard(ev));
}
async function refresh(){
 msg('appMessage','Actualizando información...');
 try{
  const [{data:inv,error:ie},{data:feed,error:fe}]=await Promise.all([
   client.rpc('emp_family_my_invitations'),client.rpc('emp_family_feed')
  ]);
  if(ie)throw ie;if(fe)throw fe;
  const links=feed?.links||[];currentEvents=feed?.events||[];
  $('linkedCount').textContent=String(links.length);
  $('newCount').textContent=String(currentEvents.filter(e=>!e.accion).length);
  clear('linked');
  if(!links.length)empty('linked','Todavía no hay socios vinculados.');
  for(const l of links){
   const c=elem('article');c.className='person-card';c.appendChild(elem('strong',l.nombre));
   c.appendChild(elem('span','Avisos: '+[l.sos?'SOS':null,l.asistencia?'Asistencia':null,l.medicacion?'Medicación':null].filter(Boolean).join(' · ')));
   $('linked').appendChild(c);
  }
  clear('invitations');
  if(!inv?.length)empty('invitations','No hay invitaciones pendientes.');
  for(const item of inv||[]){
   const c=elem('article');c.className='invite';c.appendChild(elem('strong',item.owner_display));
   c.appendChild(elem('p','Vínculo: '+item.relacion));
   c.appendChild(button('Aceptar vinculación',async function(){
    if(!confirm('¿Aceptás esta vinculación?'))return;this.disabled=true;
    const {data,error}=await client.rpc('emp_family_accept_invitation',{p_id:item.id});
    if(error||!data){msg('appMessage',error?.message||'Invitación no disponible');this.disabled=false;return;}await refresh();
   }));$('invitations').appendChild(c);
  }
  renderEvents('recentEvents',currentEvents.slice(0,4),'Sin novedades recientes.');
  renderEvents('sosEvents',currentEvents.filter(e=>e.tipo==='SOS'),'No hay alertas SOS recientes.');
  renderEvents('medEvents',currentEvents.filter(e=>e.tipo==='MEDICACION'),'No hay tomas sin confirmar registradas.');
  renderEvents('assistEvents',currentEvents.filter(e=>e.tipo==='ASISTENCIA'),'No hay solicitudes de asistencia recientes.');
  msg('appMessage','');
 }catch(e){msg('appMessage','No se pudieron actualizar los datos: '+e.message);}
}
document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{
 const target=b.dataset.section;
 document.querySelectorAll('[data-section]').forEach(x=>x.classList.toggle('active',x===b));
 document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('hidden',x.dataset.view!==target));
 window.scrollTo({top:0,behavior:'smooth'});
});

$('loginForm').onsubmit=async e=>{
 e.preventDefault();const email=$('email').value.trim(),password=$('password').value;
 msg('authMessage','Ingresando...');
 const {error}=await client.auth.signInWithPassword({email,password});
 if(error){msg('authMessage',error.message==='Email not confirmed'?'La cuenta todavía no está habilitada. Contactá a EMP para activarla.':error.message);return;}
 msg('authMessage','');await render();
};
$('registerBtn').onclick=async()=>{
 const email=$('email').value.trim(),password=$('password').value;
 if(!email||password.length<6){msg('authMessage','Ingresá un correo válido y una contraseña de al menos 6 caracteres.');return;}
 msg('authMessage','Registrando cuenta...');
 const {data,error}=await client.auth.signUp({email,password,emailRedirectTo:new URL('familiar.html',location.href).href});
 msg('authMessage',error?'No se pudo registrar: '+error.message:(data.session?'Cuenta creada. Revisá las invitaciones.':'Revisá tu correo para confirmar la cuenta antes de ingresar.'));
 if(data.session)await render();
};
$('logoutBtn').onclick=async()=>{await client.auth.signOut();await render();};
$('refreshBtn').onclick=refresh;
client.auth.onAuthStateChange(()=>{setTimeout(render,0);});\nsetInterval(()=>{if(!document.hidden&&!app.classList.contains('hidden'))refresh();},30000);
render();
})();