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
async function refresh(){
 msg('appMessage','Actualizando...');
 try{
  const [{data:inv,error:ie},{data:linked,error:le}]=await Promise.all([
   client.rpc('emp_family_my_invitations'),
   client.from('emp_family_contacts').select('id,relacion,nivel,aviso_sos,aviso_asistencia,aviso_medicacion,estado_vinculacion').eq('estado_vinculacion','ACEPTADA').eq('activo',true)
  ]);
  if(ie)throw ie;if(le)throw le;
  const pending=$('invitations');pending.replaceChildren();
  if(!inv?.length)pending.appendChild(elem('p','No hay invitaciones pendientes para esta cuenta.'));
  for(const item of inv||[]){
   const card=elem('article');card.className='invite';
   card.appendChild(elem('h3','Invitación de '+item.owner_display));
   card.appendChild(elem('p','Vínculo: '+item.relacion));
   card.appendChild(elem('p','Avisos autorizados: '+[item.aviso_sos?'SOS':null,item.aviso_asistencia?'Asistencia':null,item.aviso_medicacion?'Medicación':null].filter(Boolean).join(', ')));
   card.appendChild(button('Aceptar vinculación',async function(){
    if(!confirm('¿Aceptás vincularte con este socio y recibir los avisos que autorizó?'))return;
    this.disabled=true;
    const {data,error}=await client.rpc('emp_family_accept_invitation',{p_id:item.id});
    if(error||!data){msg('appMessage','No se pudo aceptar: '+(error?.message||'La invitación no está disponible.'));this.disabled=false;return;}
    msg('appMessage','Vinculación aceptada.');await refresh();
   }));pending.appendChild(card);
  }
  const list=$('linked');list.replaceChildren();
  if(!linked?.length)list.appendChild(elem('p','Todavía no tenés socios vinculados.'));
  for(const item of linked||[]){
   const card=elem('article');card.className='invite';
   card.appendChild(elem('h3','Socio vinculado'));
   card.appendChild(elem('p','Tipo de vínculo: '+item.relacion+' · '+item.nivel));
   card.appendChild(elem('p','Permisos: '+[item.aviso_sos?'SOS':null,item.aviso_asistencia?'Asistencia':null,item.aviso_medicacion?'Medicación':null].filter(Boolean).join(', ')));
   list.appendChild(card);
  }
  msg('appMessage','');
 }catch(e){msg('appMessage','No se pudieron consultar las vinculaciones: '+e.message);}
}
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
client.auth.onAuthStateChange(()=>{setTimeout(render,0);});
render();
})();