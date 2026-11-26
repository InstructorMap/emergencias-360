(function () {
  'use strict';
  const panel = document.getElementById('empBaseSupervisors');
  const bases = panel.querySelector('[data-bases]'), history = panel.querySelector('[data-history]');
  const status = panel.querySelector('output');
  const refresh = panel.querySelector('[data-refresh]');
  const baseName = id => id === 'LA_COSTA' ? 'La Costa' : 'Dolores';
  const rpc = (name,args) => window.E360Store._getState().supabase.rpc(name,args);
  let busy = false;
  function lock(value) {
    busy = value;
    refresh.disabled = value;
    for (const field of bases.querySelectorAll('fieldset')) field.disabled = value;
  }
  function renderBase(base,candidates) {
    const field = document.createElement('fieldset'), title = document.createElement('legend');
    const current = document.createElement('p'), label = document.createElement('label');
    const select = document.createElement('select'), save = document.createElement('button');
    title.textContent = baseName(base.base);
    current.textContent = (base.name || 'Sin supervisor') + ' · ' +
      (base.registered ? 'Dispositivo push registrado' : 'Sin dispositivo push registrado');
    select.add(new Option('Elegir supervisor',''));
    for (const p of candidates) select.add(new Option(p.name,p.id));
    select.value = base.staff || '';
    label.append('Supervisor de ' + title.textContent + ' ',select);
    save.type = 'button'; save.textContent = 'Guardar asignación';
    save.disabled = true;
    select.onchange = () => { save.disabled = !select.value || select.value === base.staff; };
    save.onclick = async () => {
      if (busy || !select.value) return;
      lock(true);
      try {
        const {error} = await rpc('e360_admin_set_supervisor',{p_base:base.base,p_staff:select.value,p_expected:base.stamp});
        if (error) throw error;
        await read('Asignación guardada.');
      } catch (e) {
        status.textContent = e.message || 'No se pudo guardar. Actualizá las asignaciones.';
      } finally { lock(false); }
    };
    field.append(title,current,label,save);
    return field;
  }
  async function read(message) {
    const {data,error} = await rpc('e360_admin_supervisors');
    if (error) throw error;
    bases.replaceChildren(...data.bases.map(b => renderBase(b,data.candidates)));
    history.replaceChildren();
    for (const row of data.history) {
      const item = document.createElement('li');
      item.textContent = new Date(row.at).toLocaleString('es-AR') + ' · ' + baseName(row.base) + ' · ' +
        (row.previous || 'Sin asignación') + ' → ' + row.next + ' · Modificó: ' + row.actor;
      history.append(item);
    }
    if (!data.history.length) history.textContent = 'Todavía no se registraron cambios de asignación.';
    status.textContent = message;
  }
  async function load() {
    if (busy) return;
    lock(true);
    try { await read(''); }
    catch (e) { bases.replaceChildren(); history.replaceChildren(); status.textContent = e.message || 'Consulta no disponible.'; }
    finally { lock(false); }
  }
  refresh.onclick = load;
  panel.addEventListener('toggle', e => { if (e.target === panel && panel.open) load(); });
})();
