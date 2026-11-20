(function(){'use strict';
function activate(name){
 const home=document.getElementById('tacHome'),head=document.getElementById('tacWorkHeader'),nav=document.querySelector('.tac-nav'),bottom=document.querySelector('.tac-bottom');
 const isHome=name==='inicio';
 if(home)home.hidden=!isHome;
 if(head)head.hidden=isHome;
 if(nav)nav.hidden=isHome;
 if(bottom)bottom.hidden=isHome;
 document.querySelectorAll('[data-tac-view]').forEach(n=>{const yes=!isHome&&n.dataset.tacView===name;n.classList.toggle('is-active',yes);n.hidden=!yes;});
 document.querySelectorAll('[data-tac-tab]').forEach(n=>{const yes=n.dataset.tacTab===name;n.classList.toggle('is-active',yes);if(yes)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});
 document.querySelectorAll('.tac-bottom [data-tac-jump]').forEach(n=>n.classList.toggle('is-active',n.dataset.tacJump===name));
 window.scrollTo({top:0,behavior:'instant'});
}
window.EMPGuardiaTactical={activate};
document.addEventListener('DOMContentLoaded',()=>{
 document.querySelectorAll('[data-tac-tab],[data-tac-jump],[data-tac-enter]').forEach(b=>b.addEventListener('click',()=>activate(b.dataset.tacTab||b.dataset.tacJump||b.dataset.tacEnter)));
 const head=document.getElementById('tacWorkHeader');if(head){const back=document.createElement('button');back.type='button';back.className='tac-back-home';back.textContent='← Menú principal';back.onclick=()=>activate('inicio');head.prepend(back);}
 activate('inicio');
});
})();