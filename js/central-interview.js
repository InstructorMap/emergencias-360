(function () {
  'use strict';
  const panel = document.getElementById('callInterview');
  const form = panel.querySelector('form');
  const fields = Array.from(form.querySelectorAll('[name]'));
  const section = form.querySelector('fieldset');
  const reload = form.querySelector('[data-reload]');
  const status = form.querySelector('output');
  const drafts = new Map();
  let incident = null, selection = 0, identity = null, stage = null;

  function answers() {
    return Object.fromEntries(fields.filter(f => f.value.trim()).map(f => [f.name, f.value.trim()]));
  }

  function display(entry) {
    for (const field of fields) field.value = entry.answers[field.name] || '';
    section.disabled = !entry.editable || entry.busy;
    reload.disabled = entry.busy;
    status.textContent = entry.message;
  }

  function saved(data) {
    const stamp = data.recorded_at ? new Date(data.recorded_at).toLocaleString('es-AR') : '';
    const detail = stamp ? 'Guardado el ' + stamp + ' · ' + (data.author_name || 'Operador') + '.' : 'Sin respuestas guardadas.';
    return {...data, dirty:false, busy:false, request:null, message:detail + (data.editable ? '' : ' Solo lectura.')};
  }

  async function request(params) {
    const {data,error} = await window.E360Store._getState().supabase.rpc('e360_call_interview',params);
    if (error) throw error;
    return data;
  }

  async function read(discard = false) {
    if (!incident || !panel.open) return;
    const id = incident;
    const draft = drafts.get(id);
    if (draft && !discard) { stage = draft; display(draft); return; }
    const version = ++selection;
    section.disabled = reload.disabled = true;
    status.textContent = 'Consultando interrogatorio…';
    try {
      const entry = saved(await request({p_incident:id}));
      if (version !== selection) return;
      drafts.delete(id);
      stage = entry;
      display(entry);
    } catch (error) {
      if (version !== selection) return;
      if (draft) { stage = draft; display(draft); }
      reload.disabled = false;
      status.textContent = 'No se pudo leer la ficha. ' + error.message;
    }
  }

  form.addEventListener('input', () => {
    if (!stage || section.disabled) return;
    stage.answers = answers();
    stage.dirty = true;
    stage.request = null;
    drafts.set(incident,stage);
    stage.message = status.textContent = 'Cambios sin guardar.';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!incident || !stage?.dirty || section.disabled) return;
    if (!Object.keys(stage.answers).length) { status.textContent = 'Registrá al menos una respuesta.'; return; }
    const id = incident, entry = stage;
    entry.request ||= crypto.randomUUID();
    entry.busy = true;
    entry.message = 'Guardando…';
    display(entry);
    try {
      const data = await request({p_incident:id,p_answers:entry.answers,p_expected:entry.revision,p_revision:entry.request});
      drafts.delete(id);
      if (stage === entry) { stage = saved(data); display(stage); }
    } catch (error) {
      entry.busy = false;
      entry.message = 'Cambios sin confirmar. ' + error.message;
      if (stage === entry) display(entry);
    }
  });
  reload.onclick = () => {
    if (!stage?.dirty || window.confirm('¿Reemplazar los cambios sin guardar por la ficha del servidor?')) read(true);
  };
  panel.addEventListener('toggle', () => { if (panel.open) read(); });
  window.EMPCallInterview = {select(record) {
    const user = window.E360Store.getUser()?.id;
    if (identity !== user) { drafts.clear(); identity = user; incident = null; }
    const next = user && record ? record.id : null;
    if (next === incident && (next || panel.hidden)) return;
    ++selection;
    incident = next;
    stage = null;
    panel.open = false;
    panel.hidden = !next;
    form.reset();
    section.disabled = true;
    status.textContent = '';
  }};
})();
