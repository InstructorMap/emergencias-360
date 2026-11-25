(function(){
'use strict';
function mount(){
 const host=document.getElementById('empCommsConsole');if(!host)return;
 const state=host.querySelector('.comms-state'),volume=host.querySelector('.comms-volume'),alarm=host.querySelector('.comms-alarm'),history=host.querySelector('.comms-history');
 let last='',events=[],owner=null,loading=false;
 const radio=host.querySelector('.comms-radio-volume'),alarms=host.querySelector('.comms-alarm-volume');
 async function restore(){if(loading)return;loading=true;try{const sb=window.E360Store._getState().supabase;if(!sb)return;const {data}=await sb.auth.getSession();const id=data?.session?.user?.id||null;if(id===owner)return;owner=id;last='';events=[];try{if(owner)events=JSON.parse(localStorage.getItem('emp-comms-history:'+owner)||'[]');}catch(_){}history.replaceChildren();}finally{loading=false;}}
 function save(){if(owner)try{localStorage.setItem('emp-comms-history:'+owner,JSON.stringify(events));}catch(_){} }
 function setText(n,t){if(n.textContent!==t)n.textContent=t;}
 function update(){
 const d=window.E360PTT?.debug?.()||{},group=!!window.E360GroupRadioBusy;
 const label=group?'PTT grupal/general en curso':window.E360IndividualRadioConnecting?'Conectando PTT':d.pressing?'Transmitiendo':d.initialized?'Canal individual abierto':'Radio sin conexión';
 setText(state,label);
 setText(host.querySelector('.comms-channel'),d.incidentId?'Incidente '+d.incidentId:'Sin canal individual');
 setText(host.querySelector('.comms-network'),navigator.onLine?'Red del dispositivo disponible':'Dispositivo sin conexión');
 setText(host.querySelector('.comms-ice'),d.pcIceState&&d.pcIceState!=='none'?'ICE: '+d.pcIceState:'ICE: sin sesión activa');
 if(label!==last){last=label;events.unshift(new Date().toLocaleString('es-AR')+' · '+label);events=events.slice(0,100);save();history.replaceChildren(...events.map(t=>{const li=document.createElement('li');li.textContent=t;return li;}));}
 window.E360PTT?.setReceiveVolume?.(Number(radio.value)/100);window.E360SetGroupVolume?.(Number(radio.value)/100);window.E360SetAlarmVolume?.(Number(alarms.value)/100);
 const player=document.querySelector('#empAudioQueue audio');if(player)player.volume=Number(volume.value)/100;
 }
 [volume,radio,alarms].forEach(v=>v.addEventListener('input',update));
 alarm.addEventListener('click',()=>{const target=document.querySelector('#empAudioQueue');target?.scrollIntoView({block:'nearest'});});
 host.querySelector('.comms-unlock').onclick=async()=>{const ok=await window.E360PTT?.unlockAudio?.();setText(host.querySelector('.comms-feedback'),ok?'Audio individual habilitado':'Sin audio remoto disponible');};
 restore().then(update);setInterval(()=>restore().then(update),1000);
}
document.addEventListener('DOMContentLoaded',mount);
})();