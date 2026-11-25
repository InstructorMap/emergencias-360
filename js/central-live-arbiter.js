(function(){
'use strict';
const waiting=new Map();let current=null;
function choose(){
 if(current)return;
 const entries=[...waiting.values()].sort((a,b)=>a.rank-b.rank||a.at-b.at);
 const item=entries[0];if(!item)return;
 waiting.delete(item.id);current=item;item.audio.muted=false;
 const p=item.audio.play();if(p)p.catch(()=>{});
}
window.E360LiveArbiter={
 request(id,audio){
 if(!id||!audio)return;
 if(current?.id===id){audio.muted=false;return;}
 audio.muted=true;
 const inc=window.E360Store.getIncidentById(id);
 waiting.set(id,{id,audio,rank:inc?.priority==='ROJO'?0:1,at:Date.now()});
 choose();
 },
 release(id){
 waiting.delete(id);
 if(current?.id===id){current.audio.muted=true;current=null;choose();}
 }
};
})();