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
 if(!user){resetNotifications();if(error)msg('authMessage','Iniciá sesión para continuar.');return;}
 $('currentEmail').textContent=user.email||'Cuenta familiar';
 await refresh();
}
let currentEvents=[];

async function diagnoseFamilyNotifications(){
 const result=['Diagnóstico EMP'];
 result.push('Permiso: '+(('Notification' in window)?Notification.permission:'API no disponible'));
 result.push('HTTPS: '+(window.isSecureContext?'sí':'no'));
 result.push('Service Worker: '+('serviceWorker' in navigator?'sí':'no'));
 result.push('Push API: '+('PushManager' in window?'sí':'no'));
 result.push('Pestaña integrada: '+(document.referrer&&/chatgpt|whatsapp|facebook|instagram/i.test(document.referrer)?'posible':'no detectada'));
 if(navigator.permissions&&navigator.permissions.query){
  try{const p=await navigator.permissions.query({name:'notifications'});result.push('Permisos del navegador: '+p.state);}catch(e){result.push('Consulta de permisos: no disponible');}
 }
 try{if('serviceWorker' in navigator){const reg=await navigator.serviceWorker.getRegistration('./');result.push('Worker instalado: '+(reg?'sí':'no'));}}catch(e){result.push('Worker: error de consulta');}
 result.push('Si el permiso sigue default, Chrome está descartando la solicitud. Abrí el menú junto a la dirección → Configuración del sitio → Restablecer permisos; después recargá EMP.');
 notificationStatus(result.join(' | '));
}
async function testFamilyPush(){
 const {data:{session}}=await client.auth.getSession();
 if(!session){notificationStatus('Ingresá con tu cuenta familiar para probar.');return;}
 if(!notificationSupported()||Notification.permission!=='granted'){notificationStatus(permissionHelp());return;}
 notificationStatus('Enviando notificación de prueba...');
 try{
  const res=await fetch(cfg.URL+'/functions/v1/emp-family-push-test',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'apikey':cfg.ANON_KEY,'Content-Type':'application/json'},body:'{}'});
  const body=await res.json();
  if(body.error==='push_not_configured')throw Error('Falta configurar las claves privadas del servidor.');
  if(!res.ok)throw Error(body.error||'Error del servidor');
  notificationStatus('Prueba enviada a '+body.sent+' dispositivo(s). Fallidos: '+body.failed+'.');
 }catch(e){notificationStatus('Prueba no disponible: '+(e instanceof TypeError?'No se pudo conectar con Supabase (red/CORS). No depende del permiso de notificaciones.':e.message));}
}

const VAPID_PUBLIC_KEY='BCqL7Ex19lSGWuigrV-l9Gts40KHu3o4LoG2bWyCRGYTRsWAnocPHco98zg-RvbUGB-Bv1z-gVHUf9WOmoyjqpY';
function urlBase64ToUint8Array(base64String){
 const padding='='.repeat((4-base64String.length%4)%4);
 const raw=atob((base64String+padding).replace(/-/g,'+').replace(/_/g,'/'));
 return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}
async function subscribeFamilyPush(){
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!notificationSupported()){notificationStatus('Push no disponible en este navegador. Probá Chrome o Firefox actualizado en Android.');return;}
 // IMPORTANTE: solicitar permiso antes de cualquier await: Chrome exige activación directa del toque.
 let permission;
 try{permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();}
 catch(e){notificationStatus('Chrome no pudo abrir el permiso: '+e.message);return;}
 if(permission!=='granted'){notificationStatus(permissionHelp());return;}
 try{
  const {data:{user}}=await client.auth.getUser();if(!user){notificationStatus('Iniciá sesión para registrar el dispositivo.');return;}
  localStorage.setItem(notificationPreferenceKey(user.id),'yes');
  notificationState.enabled=true;
  const ready=await navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready);
  let subscription=await ready.pushManager.getSubscription();
  if(!subscription)subscription=await ready.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)});
  const json=subscription.toJSON();
  const {error}=await client.from('emp_family_push_subscriptions').upsert({family_user_id:user.id,endpoint:subscription.endpoint,p256dh:json.keys.p256dh,auth_key:json.keys.auth},{onConflict:'endpoint'});
  if(error)throw error;
  notificationStatus('Teléfono registrado correctamente para push. Ya podés enviar una notificación de prueba.');
 }catch(e){notificationStatus('Permiso concedido, pero falló el registro push: '+e.message);}
}

// Avisos locales: solo mientras el portal está abierto. No son push en segundo plano.
const notificationState={enabled:false,seen:new Set(),ready:false,userId:null};
function notificationSupported(){return 'Notification' in window&&window.isSecureContext;}
function permissionHelp(){
 if(!notificationSupported())return 'Este navegador no admite notificaciones web. Abrí el enlace en Chrome para Android, no dentro de WhatsApp o Facebook.';
 if(Notification.permission==='denied')return 'Notificaciones bloqueadas para este sitio. En Chrome tocá el icono junto a la dirección → Permisos → Notificaciones → Permitir. Si no aparece, abrí Configuración de Android → Apps → Chrome → Notificaciones.';
 return 'Estado: '+Notification.permission+'. Chrome no concedió el permiso. Tocá «Diagnosticar permisos» para revisar la compatibilidad y el bloqueo del navegador.';
}
function notificationStatus(text){const el=$('notificationStatus');if(el)el.textContent=text;}
function notificationPreferenceKey(userId){return 'emp-family-notify-'+userId;}
function resetNotifications(){notificationState.enabled=false;notificationState.ready=false;notificationState.seen.clear();notificationState.userId=null;}
async function enableNotifications(){
 await subscribeFamilyPush();
}
function checkNotifications(events,userId){
 if(notificationState.userId!==userId){notificationState.userId=userId;notificationState.ready=false;notificationState.seen.clear();notificationState.enabled=notificationSupported()&&Notification.permission==='granted'&&localStorage.getItem(notificationPreferenceKey(userId))==='yes';}
 const eligible=events.filter(e=>!e.accion&&['SOS','ASISTENCIA','MEDICACION'].includes(e.tipo));
 const keys=eligible.map(e=>e.contact_id+'|'+e.event_key);
 if(!notificationState.ready){keys.forEach(k=>notificationState.seen.add(k));notificationState.ready=true;return;}
 if(!notificationState.enabled||document.hidden)return;
 for(const ev of eligible){
  const key=ev.contact_id+'|'+ev.event_key;
  if(notificationState.seen.has(key))continue;
  notificationState.seen.add(key);
  try{
   const title=ev.tipo==='SOS'?'EMP: aviso SOS':ev.tipo==='MEDICACION'?'EMP: toma sin confirmar':'EMP: solicitud de asistencia';
   const notice=new Notification(title,{body:'Tenés un aviso nuevo en tu Red Familiar. Ingresá para revisar los detalles.',tag:'emp-family-'+key,icon:'assets/familiar/03_red_familiar.webp'});
   notice.onclick=()=>{window.focus();notice.close();document.querySelector('[data-section=alertas]')?.click();};
  }catch(err){notificationStatus('No se pudo mostrar el aviso del navegador.');}
 }
}

function clear(id){$(id).replaceChildren();}
function empty(id,text){$(id).appendChild(Object.assign(elem('p',text),{className:'empty'}));}
function eventCard(ev){
 const card=elem('article');card.className='event-card'+(ev.tipo==='SOS'?' family-sos-event':'');
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
  const [{data:inv,error:ie},{data:feed,error:fe},{data:due,error:de}]=await Promise.all([
   client.rpc('emp_family_my_invitations'),client.rpc('emp_family_feed'),client.rpc('emp_family_medication_due')
  ]);
  if(ie)throw ie;if(fe)throw fe;if(de)throw de;
  const links=feed?.links||[];
  const recorded=feed?.events||[];
  const generated=Array.isArray(due)?due:[];
  const generatedKeys=new Set(generated.map(e=>e.contact_id+'|'+e.fecha));
  currentEvents=[...recorded.filter(e=>e.tipo!=='MEDICACION'||!generatedKeys.has(e.contact_id+'|'+e.fecha)),...generated].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  $('linkedCount').textContent=String(links.length);
  $('newCount').textContent=String(currentEvents.filter(e=>!e.accion).length);
  const sosPending=currentEvents.filter(e=>e.tipo==='SOS'&&!e.accion);
  const sosBanner=$('familyUrgentBanner');
  if(sosBanner){sosBanner.hidden=!sosPending.length; if(sosPending.length){sosBanner.querySelector('strong').textContent='🚨 '+sosPending.length+' alerta(s) SOS para revisar';sosBanner.querySelector('p').textContent='Avisos recibidos de personas vinculadas. Confirmá que estás al tanto desde Alertas.';}}
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
  const {data:{user:notificationUser}}=await client.auth.getUser();
  if(notificationUser)checkNotifications(currentEvents,notificationUser.id);
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
$('enableFamilyNotifications').onclick=enableNotifications;
$('registerFamilyPush').onclick=subscribeFamilyPush;
$('testFamilyPush').onclick=testFamilyPush;
$('diagnoseFamilyNotifications').onclick=diagnoseFamilyNotifications;
client.auth.onAuthStateChange(()=>{setTimeout(render,0);});
setInterval(()=>{if(!document.hidden&&!app.classList.contains('hidden'))refresh();},30000);
if('serviceWorker' in navigator&&window.isSecureContext){navigator.serviceWorker.register('./sw.js').catch(()=>{});}
render();
})();