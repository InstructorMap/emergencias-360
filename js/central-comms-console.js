(function(){
'use strict';
function mount(){
 const host=document.getElementById('empCommsConsole');if(!host)return;
 const state=host.querySelector('.comms-state'),volume=host.querySelector('.comms-volume'),alarm=host.querySelector('.comms-alarm'),history=host.querySelector('.comms-history');
 let last='',events=[];
 function setText(n,t){if(n.textContent!==t)n.textContent=t;}
 function update(){
 const d=window.E360PTT?.debug?.()||{},group=!!window.E360GroupRadioBusy;
 const label=group?'PTT grupal/general en curso':window.E360IndividualRadioConnecting?'Conectando PTT':d.pressing?'Transmitiendo':d.initialized?'Canal individual abierto':'Radio sin conexión';
 setText(state,label);
 setText(host.querySelector('.comms-channel'),d.incidentId?'Incidente '+d.incidentId:'Sin canal individual');
 setText(host.querySelector('.comms-network'),navigator.onLine?'Red del dispositivo disponible':'Dispositivo sin conexión');
 setText(host.querySelector('.comms-ice'),d.pcIceState&&d.pcIceState!=='none'?'ICE: '+d.pcIceState:'ICE: sin sesión activa');
 if(label!==last){last=label;events.unshift(new Date().toLocaleTimeString('es-AR')+' · '+label);events=events.slice(0,20);history.replaceChildren(...events.map(t=>{const li=document.createElement('li');li.textContent=t;return li;}));}
 const player=document.querySelector('#empAudioQueue audio');if(player)player.volume=Number(volume.value)/100;
 }
 volume.addEventListener('input',update);
 alarm.addEventListener('click',()=>{const target=document.querySelector('#empAudioQueue');target?.scrollIntoView({block:'nearest'});});
 host.querySelector('.comms-unlock').onclick=async()=>{const ok=await window.E360PTT?.unlockAudio?.();setText(host.querySelector('.comms-feedback'),ok?'Audio individual habilitado':'Sin audio remoto disponible');};
 update();setInterval(update,1000);
}
document.addEventListener('DOMContentLoaded',mount);
})();