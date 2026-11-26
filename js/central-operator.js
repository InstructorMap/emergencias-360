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

(function () {
  'use strict';
  const box = document.createElement('details');
  box.className = 'emp-comms';
  box.innerHTML = `<summary>Relevo de turno</summary>
    <button type="button" data-refresh>Actualizar relevo</button>
    <fieldset><legend>Mis incidentes activos</legend><div data-cases></div>
    <label>Operador entrante <select></select></label>
    <button type="button" data-submit disabled>Entregar seleccionados</button></fieldset>
    <output role="status"></output><details><summary>Mis últimos relevos</summary><ul></ul></details>`;
  document.getElementById('empIncidentOperator').before(box);
  const field = box.querySelector('fieldset'), list = box.querySelector('[data-cases]');
  const target = box.querySelector('select'), submit = box.querySelector('[data-submit]');
  const reload = box.querySelector('[data-refresh]'), status = box.querySelector('output');
  const history = box.querySelector('ul');
  let cases = [], requestId = null, busy = false;
  const rpc = (name,args) => window.E360Store._getState().supabase.rpc(name,args);
  function selected() {
    return Array.from(list.querySelectorAll('input:checked'), node => cases[Number(node.value)]);
  }
  function setBusy(value) {
    busy = value;
    field.disabled = reload.disabled = value;
    submit.disabled = value || !target.value || !selected().length;
  }
  field.addEventListener('change', () => { requestId = null; setBusy(false); });
  async function load(message = '') {
    if (busy) return;
    setBusy(true);
    status.textContent = message || 'Consultando guardia…';
    try {
      const [desk, staff] = await Promise.all([rpc('e360_handover_desk'),rpc('e360_transfer_candidates')]);
      if (desk.error || staff.error) throw desk.error || staff.error;
      cases = desk.data.active;
      list.replaceChildren();
      cases.forEach((item,i) => {
        const row = document.createElement('div'), label = document.createElement('label'), check = document.createElement('input');
        check.type = 'checkbox'; check.value = String(i);
        label.append(check, ' ' + [item.id,item.base,item.status].join(' · '));
        row.append(label); list.append(row);
      });
      target.replaceChildren(new Option('Elegir operador',''));
      for (const p of staff.data) target.add(new Option(p.nombre || 'Operador',p.user_id));
      history.replaceChildren();
      for (const h of desk.data.history) {
        const li = document.createElement('li');
        li.textContent = new Date(h.at).toLocaleString('es-AR') + ' · ' +
          (h.received ? 'Recibido de ' : 'Entregado a ') + h.peer + ' · ' + h.ids.join(', ');
        history.append(li);
      }
      if (!history.children.length) history.textContent = 'Sin relevos registrados.';
      requestId = null;
      status.textContent = message || (!cases.length ? 'No tenés incidentes activos a cargo.' :
        !staff.data.length ? 'No hay otro operador habilitado para recibir el relevo.' : 'Seleccioná los casos que entregás.');
    } catch (e) {
      status.textContent = (message ? message + ' ' : '') + 'No se pudo actualizar el relevo. ' + (e.message || '');
    } finally { setBusy(false); }
  }
  submit.onclick = async () => {
    const items = selected().map(({id,revision,status}) => ({id,revision,status}));
    if (busy || !items.length || !target.value) return;
    if (!window.confirm('¿Entregar ' + items.length + ' incidente(s) a ' + target.selectedOptions[0].textContent + '?')) return;
    setBusy(true);
    let done = false;
    try {
      requestId ||= crypto.randomUUID();
      const res = await rpc('e360_confirm_handover',{p_request:requestId,p_target:target.value,p_items:items});
      if (res.error) throw res.error;
      done = true;
    } catch (e) {
      status.textContent = 'Entrega sin confirmar. ' + (e.message || 'Consultá el historial o reintentá.');
    } finally { setBusy(false); }
    if (done) await load('Relevo registrado. Incidentes entregados: ' + items.length + '.');
  };
  reload.onclick = () => load();
  box.addEventListener('toggle', event => { if (event.target === box && box.open) load(); });
})();
