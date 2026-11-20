(function(){'use strict';
function activate(name){
 document.querySelectorAll('[data-tac-view]').forEach(n=>{const yes=n.dataset.tacView===name;n.classList.toggle('is-active',yes);n.hidden=!yes;});
 document.querySelectorAll('[data-tac-tab]').forEach(n=>{const yes=n.dataset.tacTab===name;n.classList.toggle('is-active',yes);if(yes)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});
 document.querySelectorAll('.tac-bottom [data-tac-jump]').forEach(n=>n.classList.toggle('is-active',n.dataset.tacJump===name));
 window.scrollTo({top:0,behavior:'smooth'});
}
window.EMPGuardiaTactical={activate};
document.addEventListener('DOMContentLoaded',()=>{
 document.querySelectorAll('[data-tac-tab],[data-tac-jump]').forEach(b=>b.addEventListener('click',()=>activate(b.dataset.tacTab||b.dataset.tacJump)));
 activate('operacion');
});
})();