(function(){
'use strict';
const Store=window.E360Store;
let owner=null;
let rows=[],busy=false,playing=null,generation=0,heard=new Set(),urgent=new Set();
function mount(){
 const host=document.getElementById('empAudioQueue');if(!host)return;
 const list=host.querySelector('.audio-rows'),status=host.querySelector('output'),player=host.querySelector('audio'),next=host.querySelector('.audio-next');
 function persist(){if(!owner)return;try{localStorage.setItem('emp-audio-heard:'+owner,JSON.stringify([...heard].slice(-2000)));}catch(e){status.textContent='No se pudo guardar el estado de escucha local';}}
 const key=m=>String(m.id||m.storage_path);
 const rank=m=>urgent.has(key(m))?0:m.priority==='ROJO'?1:2;
 const sorted=()=>rows.slice().sort((a,b)=>Number(heard.has(key(a)))-Number(heard.has(key(b)))||rank(a)-rank(b)||Date.parse(a.created_at)-Date.parse(b.created_at));
 function draw(){
 const ordered=sorted(),sig=JSON.stringify([ordered.map(m=>[key(m),rank(m),heard.has(key(m)),m.unit,m.uploaded_by]),playing]);
 if(list.dataset.sig===sig)return;list.dataset.sig=sig;list.replaceChildren();
 host.querySelector('.audio-count').textContent=rows.filter(m=>!heard.has(key(m))).length+' pendientes de escucha';
 ordered.forEach(m=>{
 const row=document.createElement('div'),label=document.createElement('span'),play=document.createElement('button'),priority=document.createElement('button');
 label.textContent=(heard.has(key(m))?'Escuchado':'Pendiente')+' · '+m.incident_id+' · Móvil asignado: '+(m.unit||'Sin dato')+' · Autor registrado: '+(m.uploaded_by||'Sin dato')+' · '+new Date(m.created_at).toLocaleTimeString('es-AR');
 play.type=priority.type='button';play.textContent=playing===key(m)?'Reproduciendo':'Escuchar';play.onclick=()=>listen(m);
 priority.textContent=urgent.has(key(m))?'Quitar prioridad':'Priorizar';priority.onclick=()=>{urgent.has(key(m))?urgent.delete(key(m)):urgent.add(key(m));draw();};
 row.append(label,play,priority);list.append(row);
 });
 }
 async function listen(m){
 if(window.E360PTT?.isReady()||window.E360GroupRadioBusy||window.E360IndividualRadioConnecting){status.textContent='Desconectá PTT antes de reproducir grabaciones.';return;}
 const token=++generation;player.pause();playing=null;
 try{const sb=Store._getState().supabase;const {data,error}=await sb.storage.from('incident-media').createSignedUrl(m.storage_path,300);if(error||!data?.signedUrl)throw Error('Audio no disponible');
 if(token!==generation)return;if(window.E360PTT?.isReady()||window.E360GroupRadioBusy||window.E360IndividualRadioConnecting)throw Error('PTT activo');
 player.src=data.signedUrl;playing=key(m);await player.play();status.textContent='Reproduciendo '+m.incident_id;draw();
 }catch(e){if(token===generation){playing=null;status.textContent=e.message;draw();}}
 }
 player.addEventListener('ended',()=>{if(playing){heard.add(playing);persist();}playing=null;draw();});
 player.addEventListener('error',()=>{playing=null;status.textContent='Error de reproducción';draw();});
 next.onclick=()=>{const m=sorted().find(m=>!heard.has(key(m)));if(m)listen(m);};
 window.E360PauseAudioQueue=()=>{generation++;player.pause();player.removeAttribute('src');player.load();playing=null;draw();};
 async function refresh(){
 if(busy)return;const sb=Store._getState().supabase;if(!sb)return;
 const {data:auth}=await sb.auth.getSession();const id=auth?.session?.user?.id;if(!id)return;
 if(owner!==id){window.E360PauseAudioQueue();owner=id;heard=new Set();urgent=new Set();try{heard=new Set(JSON.parse(localStorage.getItem('emp-audio-heard:'+owner)||'[]'));}catch(_){} }
 const incidents=Store.getIncidents('ALL').filter(i=>!['CERRADA','CANCELADA'].includes(i.status));if(!incidents.length){rows=[];draw();return;}
 busy=true;try{const ids=incidents.map(i=>i.id),map=new Map(incidents.map(i=>[String(i.id),i]));const {data,error}=await sb.from('incident_media').select('*').eq('type','audio').in('incident_id',ids).order('created_at',{ascending:false}).limit(100);if(error)throw error;
 rows=(data||[]).map(m=>({...m,unit:map.get(String(m.incident_id))?.assignedUnitId,priority:map.get(String(m.incident_id))?.priority}));draw();
 }catch(e){status.textContent='No se pudo actualizar la bandeja: '+e.message;}finally{busy=false;}
 }
 refresh();setInterval(refresh,5000);
}
document.addEventListener('DOMContentLoaded',mount);
})();