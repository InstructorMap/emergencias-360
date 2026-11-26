(function () {
  'use strict';
  const panel = document.getElementById('empIncidentOperator');
  const output = panel.querySelector('output');
  const list = panel.querySelector('select');
  const buttons = Object.fromEntries(Array.from(panel.querySelectorAll('button'), b => [b.dataset.action,b]));
  buttons.supervise = document.createElement('button');
  buttons.supervise.type = 'button';
  buttons.supervise.textContent = 'Asumir como supervisor';
  buttons.supervise.hidden = true;
  buttons.claim.after(buttons.supervise);
  let id, revision, owner, busy = false, sequence = 0;
  const client = () => window.E360Store._getState().supabase;

  function reset() {
    for (const b of Object.values(buttons)) b.hidden = true;
    list.hidden = true;
    list.replaceChildren();
    owner = null;
    revision = null;
  }

  async function refresh(action = 'view') {
    if (!id || busy || (action === 'view' && document.hidden)) return;
    const request = ++sequence;
    const target = list.value;
    busy = true;
    for (const b of Object.values(buttons)) b.disabled = true;
    try {
      const {data,error} = await client().rpc('e360_incident_operator',{
        p_incident:id,p_action:action,p_revision:revision,p_target:action === 'transfer' ? target : null
      });
      if (request !== sequence) return;
      if (error) throw error;
      output.textContent = data.assigned ? (data.name || 'Operador asignado') + (data.mine ? ' (vos)' : '') : 'Sin asignar';
      buttons.claim.hidden = data.assigned;
      buttons.release.hidden = !data.mine;
      buttons.supervise.hidden = !data.can_supervise;
      revision = data.revision;
      if (data.mine && (owner !== revision || !list.options.length)) {
        const candidates = await client().rpc('e360_transfer_candidates');
        if (request !== sequence) return;
        if (candidates.error) throw candidates.error;
        list.replaceChildren(new Option('Elegir destinatario',''));
        for (const person of candidates.data) list.add(new Option(person.nombre || 'Operador',person.user_id));
      }
      owner = revision;
      list.hidden = buttons.transfer.hidden = !data.mine || list.options.length < 2;
    } catch (e) {
      if (request !== sequence) return;
      reset();
      output.textContent = e.message || 'No se pudo consultar el responsable';
    } finally {
      if (request === sequence) {
        busy = false;
        for (const b of Object.values(buttons)) b.disabled = false;
        buttons.transfer.disabled = !list.value;
      }
    }
  }

  buttons.supervise.onclick = () => {
    if (window.confirm('¿Asumir la responsabilidad de este incidente en reemplazo del operador actual?')) refresh('supervise');
  };
  buttons.claim.onclick = () => refresh('claim');
  buttons.release.onclick = () => refresh('release');
  buttons.transfer.onclick = () => { if (list.value) refresh('transfer'); };
  list.onchange = () => { buttons.transfer.disabled = busy || !list.value; };
  window.EMPOperatorPanel = {select(incident) {
    const next = incident && !['CERRADA','CANCELADA'].includes(incident.status) ? incident.id : null;
    if (next === id) return;
    id = next;
    ++sequence;
    busy = false;
    reset();
    panel.hidden = !id;
    output.textContent = id ? 'Consultando…' : '';
    void refresh();
  }};
  setInterval(() => refresh(),10000);
})();
