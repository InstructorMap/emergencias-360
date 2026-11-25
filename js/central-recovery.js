(function(){
'use strict';
const Store=window.E360Store;
function mount(){
 const host=document.getElementById('empRecovery');if(!host)return;
 const out=host.querySelector('output'),btn=host.querySelector('button');
 let timer=null,busy=false,attempt=0,last=0,epoch=0;
 const delays=[2,5,10,20,30,60];
 function show(t){out.textContent=t;}
 function schedule(seconds){clearTimeout(timer);timer=setTimeout(run,seconds*1000);}
 async function run(){
 if(busy)return;
 if(!navigator.onLine){show('Sin red · datos pueden estar desactualizados');return;}
 if(document.hidden||!Store.isStaff()){show('En espera de sesión operativa visible');schedule(10);return;}
 busy=true;btn.disabled=true;const token=epoch;show('Sincronizando incidentes y flota…');
 try{
 await Store.refreshIncidentsNow(true);
 await Store.refreshFleet();
 if(token!==epoch||!navigator.onLine)throw Error('Conexión interrumpida');
 last=Date.now();attempt=0;show('Sincronización confirmada: '+new Date(last).toLocaleTimeString('es-AR'));schedule(30);
 }catch(e){const wait=delays[Math.min(attempt++,delays.length-1)];show('Sincronización no confirmada · reintento en '+wait+' s');if(navigator.onLine)schedule(wait);}
 finally{busy=false;btn.disabled=false;}
 }
 function wake(){clearTimeout(timer);attempt=0;if(busy){schedule(2);return;}run();}
 window.addEventListener('offline',()=>{epoch++;clearTimeout(timer);show('Sin red · datos pueden estar desactualizados');});
 window.addEventListener('online',wake);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake();});
 btn.onclick=wake;
 run();
}
document.addEventListener('DOMContentLoaded',mount);
})();