/* ============================================================
   app-admin.js v8 — Controlador de admin.html
   Login admin, gestión de socios, alta individual, alta masiva,
   bandeja de solicitudes, branding, Mercado Pago, servicios
   tercerizados, beneficios, B2B, auditoría, export CSV.
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  const C = window.E360Config;
  if (!Store) { console.error('[app-admin] E360Store no disponible.'); return; }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const val = attrs[k];
        if (val === null || val === undefined || val === false) return;
        if (val === true) { node.setAttribute(k, ''); return; }
        if (k === 'className') { node.className = val; return; }
        if (k === 'textContent') { node.textContent = val; return; }
        if (k === 'onclick' && typeof val === 'function') { node.addEventListener('click', val); return; }
        if (k === 'innerHTML') { node.innerHTML = val; return; }
        node.setAttribute(k, val);
      });
    }
    (children || []).forEach((c) => {
      if (c === null || c === undefined) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }); }
    catch (_) { return iso; }
  }

  function showMsgBar(text, isError) {
    const bar = $('#adminMsgBar');
    if (!bar) return;
    if (!text) { bar.hidden = true; return; }
    bar.textContent = text;
    bar.className = 'admin-msg-bar ' + (isError ? 'error' : 'ok');
    bar.hidden = false;
    setTimeout(() => { bar.hidden = true; }, 5000);
  }

  function toast(text) {
    let t = document.getElementById('e360Toast');
    if (!t) { t = document.createElement('div'); t.id = 'e360Toast'; document.body.appendChild(t); }
    t.textContent = text;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
  }

  let editingMedicationProfileId = null;
  let excelRows = [];

  // ============================================================
  // LOGIN
  // ============================================================
  function initLogin() {
    const form = $('#adminLoginForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#adminLoginMsg');
      const btn = $('#adminLoginBtn');
      const email = $('#adminLoginEmail').value.trim();
      const password = $('#adminLoginPassword').value;
      if (!email || !password) { if (msg) { msg.textContent = 'Completá email y contraseña.'; msg.style.color = '#DC2626'; } return; }
      if (btn) { btn.disabled = true; btn.textContent = 'Ingresando…'; }
      try {
        const dni = email.split('@')[0];
        const profile = await Store.login(dni, password);
        if (!profile || profile.role !== 'admin') {
          await Store.logout();
          throw new Error('Tu usuario no tiene permisos de administrador.');
        }
        hideLogin();
        await bootAdmin();
      } catch (err) {
        if (msg) { msg.textContent = err.message || 'Error al ingresar.'; msg.style.color = '#DC2626'; }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Ingresar'; }
      }
    });
  }

  function showLogin() {
    const ov = $('#adminLoginOverlay'); if (ov) ov.hidden = false;
    const app = $('#adminApp'); if (app) app.hidden = true;
  }
  function hideLogin() {
    const ov = $('#adminLoginOverlay'); if (ov) ov.hidden = true;
    const app = $('#adminApp'); if (app) app.hidden = false;
  }
  function initLogout() {
    const btn = $('#adminLogout');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!confirm('¿Cerrar sesión?')) return;
      await Store.logout();
      location.reload();
    });
  }

  // ============================================================
  // BRANDING EN HEADER
  // ============================================================
  async function applyBranding() {
    try {
      const branding = await Store.loadBranding();
      if (branding && branding.logoUrl) {
        const brand = $('#adminHeaderBrand');
        if (brand) {
          const svg = brand.querySelector('svg');
          if (svg) {
            const img = document.createElement('img');
            img.src = branding.logoUrl;
            img.alt = 'EMP';
            img.style.height = '38px';
            img.style.width = 'auto';
            svg.replaceWith(img);
          }
        }
        const loginLogo = $('#adminLoginLogo');
        if (loginLogo) loginLogo.innerHTML = '<img src="' + branding.logoUrl + '" alt="EMP" style="max-width:180px;max-height:56px;" />';
      }
      return branding;
    } catch (_) { return null; }
  }

  // ============================================================
  // SOCIOS
  // ============================================================
  function renderSocios() {
    const tbody = $('#sociosTbody');
    const count = $('#sociosCount');
    if (!tbody) return;
    const search = ($('#sociosSearch') ? $('#sociosSearch').value : '').toLowerCase().trim();
    const filterPlan = $('#sociosFilterPlan') ? $('#sociosFilterPlan').value : '';
    const filterBase = $('#sociosFilterBase') ? $('#sociosFilterBase').value : '';
    let profiles = Store.listProfiles().filter(p => p.role === 'socio');
    if (search) profiles = profiles.filter(p =>
      (p.nombre || '').toLowerCase().includes(search) ||
      (p.dni || '').includes(search) ||
      (p.socioNumber || '').toLowerCase().includes(search)
    );
    if (filterPlan) profiles = profiles.filter(p => p.plan === filterPlan);
    if (filterBase) profiles = profiles.filter(p => p.baseId === filterBase);
    if (count) count.textContent = String(profiles.length);
    tbody.innerHTML = '';
    if (!profiles.length) {
      tbody.appendChild(el('tr', {}, [el('td', { colspan: '5', style: 'text-align:center;padding:20px;color:#64748B;', textContent: 'No hay socios que coincidan.' })]));
      return;
    }
    profiles.forEach(p => {
      const effective = Store.calcCarnetStatus(p);
      const days = Store.daysToExpire(p);
      const validTxt = p.carnetValidUntil ? new Date(p.carnetValidUntil).toLocaleDateString('es-AR') : '—';
      const statusClass = 'carnet-status-pill carnet-status-' + (effective === 'activo' && days !== null && days <= C.CARNET_WARN_DAYS ? 'por_vencer' : effective);
      const planSel = el('select', { className: 'admin-select' });
      C.PLAN_IDS.forEach(pid => {
        const opt = el('option', { value: pid, textContent: (C.PLANS[pid] || {}).label || pid });
        if (p.plan === pid) opt.selected = true;
        planSel.appendChild(opt);
      });
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [
          el('div', { style: 'font-weight:700;', textContent: p.nombre || '—' }),
          el('div', { style: 'font-size:0.72rem;color:#64748B;', textContent: 'DNI ' + (p.dni || '—') + ' · ' + (p.baseId || '—') })
        ]),
        el('td', {}, [el('code', { textContent: p.socioNumber || '—' })]),
        el('td', {}, [planSel]),
        el('td', {}, [
          el('span', { className: statusClass, textContent: effective }),
          el('div', { style: 'font-size:0.7rem;color:#64748B;', textContent: 'Vence ' + validTxt })
        ]),
        el('td', {}, [
          el('div', { className: 'row-actions' }, [
            el('button', { type: 'button', textContent: '💾 Guardar plan', onclick: async () => {
              try {
                await Store.setProfilePlan(p.dni, planSel.value, 'admin');
                toast('Plan actualizado'); renderSocios();
              } catch (e) { toast('Error: ' + e.message); }
            }}),
            el('button', { type: 'button', className: 'btn-muted', textContent: '🗓 Renovar', onclick: async () => {
              try { await Store.renewCarnet(p.dni, 'admin'); toast('Carnet renovado'); renderSocios(); }
              catch (e) { toast('Error: ' + e.message); }
            }}),
            el('button', { type: 'button', className: 'btn-danger', textContent: p.carnetStatus === 'suspendido' ? '✅ Reactivar' : '⛔ Suspender', onclick: async () => {
              try {
                await Store.setCarnetStatus(p.dni, p.carnetStatus === 'suspendido' ? 'activo' : 'suspendido', 'admin');
                toast('Estado actualizado'); renderSocios();
              } catch (e) { toast('Error: ' + e.message); }
            }}),
            el('button', { type: 'button', className: 'btn-muted', textContent: '💊 Medicación', onclick: () => openMedicacionSocio(p) }),
            el('button', { type: 'button', className: 'btn-muted', textContent: '🆘 QR Pulsera', onclick: () => openPulseraQR(p) })
          ])
        ])
      ]));
    });
  }

  function initSociosFilters() {
    ['#sociosSearch', '#sociosFilterPlan', '#sociosFilterBase'].forEach(sel => {
      const inp = $(sel);
      if (inp) inp.addEventListener('input', renderSocios);
    });
  }

  function initExportSociosCSV() {
    const btn = $('#btnExportSociosCSV');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const profiles = Store.listProfiles().filter(p => p.role === 'socio');
      if (!profiles.length) { toast('Sin socios para exportar'); return; }
      const headers = ['nombre','dni','cuil','plan','base_id','telefono','grupo_sanguineo','alergias','patologias','contacto','cuota','carnet_status','carnet_valid_until','socio_number'];
      const rows = profiles.map(p => [
        p.nombre, p.dni, p.cuil, p.plan, p.baseId, p.telefono,
        p.grupoSanguineo, p.alergias, p.patologias, p.contacto, p.cuota,
        p.carnetStatus, p.carnetValidUntil, p.socioNumber
      ].map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(','));
      const csv = headers.join(',') + '\n' + rows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'socios_EMP_' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast('CSV exportado');
    });
  }

  // ============================================================
  // ALTA INDIVIDUAL
  // ============================================================
  function initAltaIndividual() {
    const form = $('#formAltaIndividual');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#altaIndividualMsg');
      const btn = $('#btnCreateSocio');
      if (msg) msg.textContent = '';
      const data = {
        nombre: $('#aiNombre').value.trim(),
        dni: $('#aiDni').value.trim(),
        cuil: $('#aiCuil').value.trim(),
        plan: $('#aiPlan').value,
        base_id: $('#aiBase').value,
        telefono: $('#aiTelefono').value.trim(),
        grupo_sanguineo: $('#aiGrupo').value,
        alergias: $('#aiAlergias').value.trim(),
        patologias: $('#aiPatologias').value.trim(),
        contacto: $('#aiContacto').value.trim(),
        cuota: $('#aiCuota').value.trim()
      };
      if (!data.nombre || !data.dni) {
        if (msg) { msg.textContent = 'Nombre y DNI son obligatorios.'; msg.style.color = '#DC2626'; }
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = 'Creando…'; }
      try {
        const res = await Store.createSocio(data);
        if (msg) {
          msg.style.color = '#16A34A';
          msg.textContent = 'Socio creado. Contraseña inicial: ' + (res.initialPassword || '—') + ' · Decile al socio que la cambie al ingresar.';
        }
        form.reset();
        $('#aiPlan').value = 'BRONCE';
        $('#aiBase').value = 'DOLORES';
        renderSocios();
      } catch (err) {
        if (msg) { msg.style.color = '#DC2626'; msg.textContent = 'Error: ' + (err.message || 'no se pudo crear'); }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Crear socio'; }
      }
    });
  }

  // ============================================================
  // ALTA MASIVA
  // ============================================================
  function initAltaMasiva() {
    const fileInput = $('#excelFile');
    const btnSel = $('#btnSelectExcel');
    if (!btnSel || !fileInput) return;
    btnSel.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleExcelFile);
    const btnImport = $('#btnImportExcel');
    if (btnImport) btnImport.addEventListener('click', doImport);
    const btnCancel = $('#btnCancelExcel');
    if (btnCancel) btnCancel.addEventListener('click', resetExcel);
  }

  async function handleExcelFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    $('#excelFileName').textContent = file.name;
    if (!window.XLSX) { toast('SheetJS no disponible. Recargá la página.'); return; }
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      excelRows = json.map(row => ({
        nombre: String(row.nombre || row.Nombre || '').trim(),
        dni: String(row.dni || row.DNI || '').replace(/\D/g, ''),
        cuil: String(row.cuil || row.CUIL || '').trim(),
        plan: String(row.plan || row.Plan || 'BRONCE').toUpperCase(),
        base_id: String(row.base_id || row.base || row.Base || 'DOLORES').toUpperCase(),
        telefono: String(row.telefono || row.Telefono || '').trim(),
        grupo_sanguineo: String(row.grupo_sanguineo || row.grupo || '').trim(),
        alergias: String(row.alergias || '').trim(),
        patologias: String(row.patologias || '').trim(),
        contacto: String(row.contacto || '').trim(),
        cuota: String(row.cuota || '').trim()
      }));
      renderExcelPreview();
    } catch (err) {
      toast('Error leyendo Excel: ' + err.message);
    }
  }

  function renderExcelPreview() {
    const prev = $('#excelPreview');
    const actions = $('#excelActions');
    if (!prev) return;
    prev.innerHTML = '';
    if (!excelRows.length) { prev.hidden = true; if (actions) actions.hidden = true; return; }
    prev.hidden = false;
    if (actions) actions.hidden = false;
    prev.appendChild(el('div', { className: 'preview-title', textContent: excelRows.length + ' socios detectados en el archivo' }));
    const valid = excelRows.filter(r => r.nombre && r.dni);
    prev.appendChild(el('div', { className: 'preview-title', textContent: valid.length + ' filas válidas (con nombre y DNI)' }));
    const table = el('table', { className: 'admin-table' });
    const thead = el('thead', {}, [
      el('tr', {}, [
        el('th', { textContent: 'Nombre' }),
        el('th', { textContent: 'DNI' }),
        el('th', { textContent: 'Plan' }),
        el('th', { textContent: 'Sede' }),
        el('th', { textContent: 'Estado' })
      ])
    ]);
    table.appendChild(thead);
    const tbody = el('tbody');
    excelRows.slice(0, 20).forEach(r => {
      const ok = r.nombre && r.dni;
      tbody.appendChild(el('tr', { style: ok ? '' : 'background:#FEE2E2;' }, [
        el('td', { textContent: r.nombre || '—' }),
        el('td', { textContent: r.dni || '—' }),
        el('td', { textContent: r.plan }),
        el('td', { textContent: r.base_id }),
        el('td', { textContent: ok ? '✅' : '❌ Falta nombre o DNI' })
      ]));
    });
    table.appendChild(tbody);
    prev.appendChild(table);
    if (excelRows.length > 20) prev.appendChild(el('p', { style: 'font-size:0.78rem;color:#64748B;', textContent: '… y ' + (excelRows.length - 20) + ' más.' }));
  }

  async function doImport() {
    const btn = $('#btnImportExcel');
    if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }
    const result = $('#importResult');
    try {
      const valid = excelRows.filter(r => r.nombre && r.dni);
      if (!valid.length) { toast('No hay filas válidas'); return; }
      const res = await Store.bulkCreateSocios(valid);
      if (result) {
        result.hidden = false;
        result.innerHTML = '';
        result.appendChild(el('div', { className: 'import-ok', textContent: '✅ Creados: ' + (res.creados || 0) }));
        result.appendChild(el('div', { className: 'import-skip', textContent: '⏭ Omitidos: ' + (res.skipeados || 0) }));
        if (res.errores && res.errores.length) {
          const ul = el('ul', { className: 'import-errors' });
          res.errores.slice(0, 20).forEach(e => ul.appendChild(el('li', { textContent: e })));
          result.appendChild(el('div', { className: 'preview-title', textContent: 'Errores:' }));
          result.appendChild(ul);
        }
      }
      renderSocios();
    } catch (err) {
      if (result) {
        result.hidden = false;
        result.innerHTML = '';
        result.appendChild(el('div', { className: 'import-error', textContent: 'Error: ' + err.message }));
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Importar socios'; }
    }
  }

  function resetExcel() {
    excelRows = [];
    $('#excelPreview').hidden = true;
    $('#excelActions').hidden = true;
    $('#importResult').hidden = true;
    $('#excelFileName').textContent = 'Ningún archivo seleccionado';
    const fi = $('#excelFile'); if (fi) fi.value = '';
  }

  // ============================================================
  // MEDICACIÓN DE UN SOCIO (modal)
  // ============================================================
  async function openMedicacionSocio(profile) {
    const overlay = el('div', { className: 'modal-overlay' });
    const modal = el('div', { className: 'modal-card' }, [
      el('h2', { textContent: 'Medicación de ' + (profile.nombre || profile.dni) }),
      el('p', { textContent: 'Cargando…', className: 'modal-loading' })
    ]);
    overlay.appendChild(modal);
    overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay);
    try {
      const meds = await Store.getMedicationsForProfile(profile.id);
      const loading = modal.querySelector('.modal-loading');
      if (loading) loading.remove();
      if (!meds.length) {
        modal.appendChild(el('p', { textContent: 'Sin medicación activa.', style: 'padding:12px;color:#64748B;text-align:center;' }));
      } else {
        const list = el('div', { className: 'medicacion-list' });
        meds.forEach(m => {
          list.appendChild(el('div', { className: 'medicacion-card' }, [
            el('div', { className: 'med-top' }, [el('strong', { textContent: m.nombre })]),
            el('div', { className: 'med-meta' }, [
              m.dosis ? el('span', { textContent: 'Dosis: ' + m.dosis }) : null,
              m.frecuencia ? el('span', { textContent: 'Frecuencia: ' + m.frecuencia }) : null,
              m.horarios && m.horarios.length ? el('span', { textContent: 'Horarios: ' + m.horarios.join(', ') }) : null
            ].filter(Boolean)),
            m.notas ? el('p', { className: 'med-notas', textContent: m.notas }) : null
          ]));
        });
        modal.appendChild(list);
      }
      modal.appendChild(el('div', { className: 'modal-actions' }, [
        el('button', { type: 'button', className: 'btn-secondary', textContent: 'Cerrar', onclick: () => document.body.removeChild(overlay) })
      ]));
    } catch (err) {
      toast('Error: ' + err.message);
      document.body.removeChild(overlay);
    }
  }

  // ============================================================
  // QR DE PULSERA
  // ============================================================
  function openPulseraQR(profile) {
    if (!profile.pulseraToken) {
      toast('Este socio no tiene pulsera asignada.');
      return;
    }
    const overlay = el('div', { className: 'modal-overlay' });
    const qrUrl = window.location.origin + '/socio.html?pulsera=' + encodeURIComponent(profile.pulseraToken);
    const modal = el('div', { className: 'modal-card' }, [
      el('h2', { textContent: 'QR de Pulsera — ' + (profile.nombre || profile.dni) }),
      el('p', { style: 'font-size:0.85rem;color:#64748B;', textContent: 'Imprimí este QR y pegalo en la pulsera. Al escanearlo, se abre la ficha de emergencia del socio.' }),
      el('div', { id: 'pulseraQrWrap', className: 'qr-card-svg', style: 'text-align:center;padding:12px;background:#fff;border-radius:8px;border:1px solid #E2E8F0;' }),
      el('div', { style: 'font-size:0.72rem;color:#64748B;word-break:break-all;margin-top:8px;font-family:monospace;', textContent: qrUrl }),
      el('div', { className: 'modal-actions' }, [
        el('button', { type: 'button', className: 'btn-secondary', textContent: 'Cerrar', onclick: () => document.body.removeChild(overlay) }),
        el('button', { type: 'button', className: 'btn-primary', textContent: '⬇ Descargar SVG', onclick: () => downloadPulseraSVG(profile, qrUrl) })
      ])
    ]);
    overlay.appendChild(modal);
    overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay);
    const wrap = modal.querySelector('#pulseraQrWrap');
    if (wrap) {
      const QR = window.E360QR;
      if (QR && typeof QR.toSvg === 'function') {
        try { wrap.innerHTML = QR.toSvg(qrUrl, 240); }
        catch (e) { wrap.textContent = 'QR no disponible'; }
      } else {
        wrap.textContent = 'QR no disponible';
      }
    }
  }

  function downloadPulseraSVG(profile, url) {
    const QR = window.E360QR;
    if (!QR || typeof QR.toSvg !== 'function') { toast('QR no disponible'); return; }
    const svg = QR.toSvg(url, 480);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pulsera_' + (profile.socioNumber || profile.dni) + '.svg';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('SVG descargado');
  }

  // ============================================================
  // SOLICITUDES
  // ============================================================
  function renderSocioRequests() {
    const list = $('#socioRequestsList');
    const count = $('#requestsCount');
    if (!list) return;
    const reqs = Store.getSocioRequests().filter(r => r.status === 'pendiente');
    if (count) count.textContent = String(reqs.length);
    list.innerHTML = '';
    if (!reqs.length) {
      list.appendChild(el('p', { className: 'empty-hint', textContent: 'Sin solicitudes pendientes.' }));
      return;
    }
    reqs.forEach(r => {
      list.appendChild(el('div', { className: 'request-card' }, [
        el('div', { className: 'request-head' }, [
          el('strong', { textContent: r.nombre || '—' }),
          el('span', { className: 'request-tipo', textContent: r.tipo === 'recategorizacion' ? 'RECATEGORIZACIÓN' : 'ADHESIÓN' })
        ]),
        el('div', { className: 'request-meta' }, [
          'DNI ' + (r.dni || '—') + ' · ' + (r.telefono || 'sin tel') + (r.email ? ' · ' + r.email : '')
        ]),
        r.tipo === 'recategorizacion' ? el('div', { className: 'request-meta', textContent: 'De ' + (r.plan_actual || '—') + ' → ' + (r.plan_solicitado || '—') }) : null,
        r.plan_interes ? el('div', { className: 'request-meta', textContent: 'Plan interés: ' + r.plan_interes }) : null,
        r.localidad ? el('div', { className: 'request-meta', textContent: 'Localidad: ' + r.localidad }) : null,
        r.mensaje ? el('div', { className: 'request-msg', textContent: r.mensaje }) : null,
        el('div', { className: 'request-actions' }, [
          r.tipo === 'recategorizacion' ?
            el('button', { type: 'button', className: 'btn-primary', textContent: '✅ Aplicar cambio', onclick: async () => {
              try {
                await Store.setProfilePlan(r.dni, r.plan_solicitado, 'admin');
                await Store.rejectSocioRequest(r.id, 'Recategorización aplicada');
                toast('Plan actualizado'); renderSocios(); renderSocioRequests();
              } catch (e) { toast('Error: ' + e.message); }
            }}) :
            el('button', { type: 'button', className: 'btn-primary', textContent: '✅ Aprobar y crear socio', onclick: async () => {
              try {
                const res = await Store.approveSocioRequest(r.id, r.plan_interes);
                toast('Socio creado. Clave inicial: ' + (res.initialPassword || '—'));
                renderSocios(); renderSocioRequests();
              } catch (e) { toast('Error: ' + e.message); }
            }}),
          el('button', { type: 'button', className: 'btn-danger', textContent: '❌ Rechazar', onclick: async () => {
            const motivo = prompt('Motivo del rechazo (opcional):') || '';
            try { await Store.rejectSocioRequest(r.id, motivo); toast('Rechazada'); renderSocioRequests(); }
            catch (e) { toast('Error: ' + e.message); }
          }})
        ])
      ]));
    });
  }

  // ============================================================
  // BRANDING
  // ============================================================
  async function renderBranding() {
    const branding = await Store.loadBranding();
    const curLogo = $('#currentLogoPreview');
    const curFav = $('#currentFaviconPreview');
    if (curLogo) curLogo.innerHTML = branding && branding.logoUrl ? '<img src="' + branding.logoUrl + '" style="max-width:160px;max-height:50px;" />' : '—';
    if (curFav) curFav.innerHTML = branding && branding.faviconUrl ? '<img src="' + branding.faviconUrl + '" style="max-width:32px;max-height:32px;" />' : '—';
    if (branding) {
      if ($('#brandColorPrimary')) $('#brandColorPrimary').value = branding.colorPrimary || '#0B3C78';
      if ($('#brandColorSecondary')) $('#brandColorSecondary').value = branding.colorSecondary || '#7A1C32';
      if ($('#brandColorAccent')) $('#brandColorAccent').value = branding.colorAccent || '#EA580C';
      if ($('#brandColorSos')) $('#brandColorSos').value = branding.colorSos || '#DC2626';
    }
  }
  function initBranding() {
    const logoInput = $('#logoFile');
    const btnLogo = $('#btnUploadLogo');
    if (btnLogo && logoInput) {
      btnLogo.addEventListener('click', () => logoInput.click());
      logoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try {
          const url = await Store.uploadBrandingFile(file, 'logo');
          const cur = await Store.getBranding();
          await Store.setBranding({ ...cur, logoUrl: url });
          toast('Logo subido'); applyBranding(); renderBranding();
        } catch (err) { toast('Error: ' + err.message); }
      });
    }
    const favInput = $('#faviconFile');
    const btnFav = $('#btnUploadFavicon');
    if (btnFav && favInput) {
      btnFav.addEventListener('click', () => favInput.click());
      favInput.addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try {
          const url = await Store.uploadBrandingFile(file, 'favicon');
          const cur = await Store.getBranding();
          await Store.setBranding({ ...cur, faviconUrl: url });
          toast('Favicon subido'); renderBranding();
        } catch (err) { toast('Error: ' + err.message); }
      });
    }
    const form = $('#formBrandingColors');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const cur = await Store.getBranding();
        await Store.setBranding({
          ...cur,
          colorPrimary: $('#brandColorPrimary').value,
          colorSecondary: $('#brandColorSecondary').value,
          colorAccent: $('#brandColorAccent').value,
          colorSos: $('#brandColorSos').value
        });
        toast('Colores guardados');
      } catch (err) { toast('Error: ' + err.message); }
    });
  }

  // ============================================================
  // MERCADO PAGO
  // ============================================================
  function renderMercadoPago() {
    try {
      const cfg = Store.getPaymentConfigAdmin();
      if ($('#mpEnabled')) $('#mpEnabled').checked = !!cfg.mercadoPagoEnabled;
      if ($('#mpPublicKey')) $('#mpPublicKey').value = cfg.mercadoPagoPublicKey || '';
      if ($('#mpAccessToken')) $('#mpAccessToken').value = cfg.mercadoPagoAccessToken || '';
      if ($('#mpCuotaBronce')) $('#mpCuotaBronce').value = (cfg.cuotas && cfg.cuotas.BRONCE) || '';
      if ($('#mpCuotaPlata')) $('#mpCuotaPlata').value = (cfg.cuotas && cfg.cuotas.PLATA) || '';
      if ($('#mpCuotaOro')) $('#mpCuotaOro').value = (cfg.cuotas && cfg.cuotas.ORO) || '';
      if ($('#mpCuotaPlatino')) $('#mpCuotaPlatino').value = (cfg.cuotas && cfg.cuotas.PLATINO) || '';
    } catch (_) {}
  }
  function initMercadoPago() {
    const form = $('#formMercadoPago');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#mpMsg');
      try {
        await Store.setPaymentConfig({
          mercadoPagoEnabled: !!$('#mpEnabled').checked,
          mercadoPagoPublicKey: $('#mpPublicKey').value.trim(),
          mercadoPagoAccessToken: $('#mpAccessToken').value.trim(),
          cuotas: {
            BRONCE: $('#mpCuotaBronce').value.trim(),
            PLATA: $('#mpCuotaPlata').value.trim(),
            ORO: $('#mpCuotaOro').value.trim(),
            PLATINO: $('#mpCuotaPlatino').value.trim()
          }
        });
        if (msg) { msg.style.color = '#16A34A'; msg.textContent = 'Configuración guardada.'; }
        toast('Mercado Pago guardado');
      } catch (err) {
        if (msg) { msg.style.color = '#DC2626'; msg.textContent = 'Error: ' + err.message; }
      }
    });
  }

  // ============================================================
  // SERVICIOS TERCERIZADOS
  // ============================================================
  function renderExtServices() {
    const cfg = Store.getExternalServices();
    if ($('#extMedicoUrl')) $('#extMedicoUrl').value = cfg.medicoVirtualUrl || '';
    if ($('#extSeguroUrl')) $('#extSeguroUrl').value = cfg.seguroViajeroUrl || '';
  }
  function initExtServices() {
    const form = $('#formExtServices');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#extServicesMsg');
      try {
        await Store.setExternalServices({
          medicoVirtualUrl: $('#extMedicoUrl').value.trim(),
          seguroViajeroUrl: $('#extSeguroUrl').value.trim()
        });
        if (msg) { msg.style.color = '#16A34A'; msg.textContent = 'Guardado.'; }
        toast('Servicios guardados');
      } catch (err) {
        if (msg) { msg.style.color = '#DC2626'; msg.textContent = 'Error: ' + err.message; }
      }
    });
  }

  // ============================================================
  // BENEFICIOS
  // ============================================================
  function renderBenefitsTable() {
    const tbody = $('#benefitsTbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const benefits = Store.getAllBenefitsRaw();
    if (!benefits.length) {
      tbody.appendChild(el('tr', {}, [el('td', { colspan: '6', style: 'text-align:center;padding:20px;color:#64748B;', textContent: 'Sin prestadores.' })]));
      return;
    }
    benefits.forEach(b => {
      const statusSel = el('select', { className: 'admin-select' });
      ['propuesto','en_negociacion','activo','suspendido','vencido'].forEach(s => {
        const opt = el('option', { value: s, textContent: s });
        if (b.status === s) opt.selected = true;
        statusSel.appendChild(opt);
      });
      const refInput = el('input', { type: 'text', maxlength: '60', value: b.agreementRef || '', className: 'admin-input-sm' });
      const validInput = el('input', { type: 'date', value: b.validUntil || '', className: 'admin-input-sm' });
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [
          el('div', { style: 'font-weight:700;', textContent: b.name }),
          el('div', { style: 'font-size:0.72rem;color:#64748B;', textContent: b.benefitDetail || '' })
        ]),
        el('td', {}, [
          el('div', { textContent: b.category || '—' }),
          el('div', { style: 'font-size:0.72rem;color:#64748B;', textContent: b.locality })
        ]),
        el('td', {}, [statusSel]),
        el('td', {}, [refInput]),
        el('td', {}, [validInput]),
        el('td', {}, [
          el('div', { className: 'row-actions' }, [
            el('button', { type: 'button', textContent: '💾 Guardar', onclick: async () => {
              try {
                // En v8 no hay updateBenefitStatus; usamos una actualización directa vía Supabase
                // Si falla, mostramos error
                toast('Función en migración. Contactá a soporte.');
              } catch (e) { toast('Error: ' + e.message); }
            }})
          ])
        ])
      ]));
    });
  }

  // ============================================================
  // B2B
  // ============================================================
  function renderB2BTable() {
    const tbody = $('#b2bTbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const b2b = Store.getB2BEstablishments('ALL');
    if (!b2b.length) {
      tbody.appendChild(el('tr', {}, [el('td', { colspan: '5', style: 'text-align:center;padding:20px;color:#64748B;', textContent: 'Sin establecimientos B2B.' })]));
      return;
    }
    b2b.forEach(e => {
      tbody.appendChild(el('tr', {}, [
        el('td', { style: 'font-weight:700;', textContent: e.name }),
        el('td', { textContent: e.type }),
        el('td', { textContent: e.baseId }),
        el('td', {}, [el('span', { className: 'badge-status-' + e.status, textContent: e.status })]),
        el('td', {}, [
          el('a', { href: 'b2b.html', className: 'btn-link', textContent: 'Gestionar →', target: '_blank', rel: 'noopener' })
        ])
      ]));
    });
  }

  // ============================================================
  // AUDITORÍA
  // ============================================================
  async function renderAudit() {
    const list = $('#auditList');
    if (!list) return;
    list.innerHTML = '';
    const logs = await Store.getAuditLogs();
    if (!logs.length) { list.appendChild(el('li', { textContent: 'Sin registros.' })); return; }
    logs.slice(0, 100).forEach(log => {
      const payloadStr = (log.payload && Object.keys(log.payload).length) ? JSON.stringify(log.payload).slice(0, 200) : '';
      list.appendChild(el('li', {}, [
        el('span', { style: 'color:#64748B;', textContent: fmtDateTime(log.ts) + ' · ' }),
        el('span', { style: 'color:#0B3C78;font-weight:700;', textContent: log.action }),
        el('span', { textContent: ' · ' + (log.actor || 'system') }),
        payloadStr ? el('div', { style: 'margin-top:2px;font-size:0.7rem;color:#64748B;', textContent: payloadStr }) : null
      ].filter(Boolean)));
    });
  }
  function initAudit() {
    const btnExp = $('#btnExportAudit');
    if (btnExp) btnExp.addEventListener('click', async () => {
      try {
        const logs = await Store.getAuditLogs();
        const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'auditoria_EMP_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        toast('Auditoría exportada');
      } catch (err) { toast('Error: ' + err.message); }
    });
    const btnRef = $('#btnRefreshAudit');
    if (btnRef) btnRef.addEventListener('click', renderAudit);
  }

  // ============================================================
  // SUSCRIPCIÓN
  // ============================================================
  function initSubscription() {
    Store.subscribe(msg => {
      if (!msg) return;
      if (msg.type === 'AUTH_CHANGED') { location.reload(); return; }
      if (msg.type !== 'STATE_CHANGED') return;
      renderSocios();
      renderSocioRequests();
    });
  }

  // ============================================================
  // BOOT
  // ============================================================
  async function bootAdmin() {
    await applyBranding();
    initSociosFilters();
    initExportSociosCSV();
    initAltaIndividual();
    initAltaMasiva();
    initBranding();
    initMercadoPago();
    initExtServices();
    initAudit();
    initSubscription();
    renderSocios();
    renderSocioRequests();
    renderBranding();
    renderMercadoPago();
    renderExtServices();
    renderBenefitsTable();
    renderB2BTable();
    renderAudit();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initLogin();
    initLogout();
    const session = await Store.initSession();
    if (session.loggedIn && session.profile && session.profile.role === 'admin') {
      hideLogin();
      await bootAdmin();
    } else {
      if (session.loggedIn) await Store.logout();
      showLogin();
    }
  });
})();
