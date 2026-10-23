/* ============================================================
   app-admin.js — Controlador de admin.html
   Organizaciones, gestor contractual, auditoría,
   servicios tercerizados, pagos y gestión de plan por DNI.
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  const C = window.E360Config;
  if (!Store) { console.error('[app-admin] E360Store no disponible.'); return; }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const uiState = { adminName: '' };

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
    try { return new Date(iso).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }); }
    catch (_) { return iso; }
  }

  function showMsg(text, isError) {
    const msg = $('#adminMsg');
    msg.textContent = text || '';
    msg.style.color = isError ? 'var(--color-red)' : 'var(--color-green)';
  }

  function requireAdmin() {
    if (!uiState.adminName) { showMsg('Ingresá tu nombre de administrador en la cabecera antes de operar.', true); return null; }
    return uiState.adminName;
  }

  function initAdminInput() {
    const input = $('#adminInput');
    input.addEventListener('input', () => { uiState.adminName = input.value.trim(); });
  }

  // ============================================================
  // ORGANIZACIONES
  // ============================================================
  function renderOrganizations() {
    const container = $('#orgsContainer'); container.innerHTML = '';
    Store.getOrganizations().forEach((org) => {
      const roleLabel = org.role === 'platform_owner' ? 'Titular / Licenciante Tecnológico' : 'Socio Operativo Inicial';
      container.appendChild(el('div', { style:'background:var(--color-bg); border:1px solid var(--color-border); border-radius:8px; padding:12px; margin-bottom:10px;' }, [
        el('div', { style:'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;' }, [
          el('div', {}, [
            el('strong', { style:'font-size:0.95rem;', textContent: org.name }),
            el('div', { style:'font-size:0.75rem; color:var(--color-text-dim);', textContent: roleLabel })
          ]),
          el('span', { style:'font-size:0.68rem; color:var(--color-text-dim); background:var(--color-surface-2); padding:2px 6px; border-radius:4px;', textContent: org.id })
        ]),
        el('div', { style:'display:flex; gap:16px; flex-wrap:wrap;' }, [
          buildSwitch('Línea A (Emergencias SOS)', org.lineAEnabled, (checked) => {
            const admin = requireAdmin(); if (!admin) return;
            try { Store.updateOrganizationFlags(org.id, checked, org.lineBEnabled, admin); showMsg('Flags actualizados.', false); renderOrganizations(); }
            catch (err) { showMsg('Error: ' + err.message, true); }
          }),
          buildSwitch('Línea B (Red de Beneficios)', org.lineBEnabled, (checked) => {
            const admin = requireAdmin(); if (!admin) return;
            try { Store.updateOrganizationFlags(org.id, org.lineAEnabled, checked, admin); showMsg('Flags actualizados.', false); renderOrganizations(); }
            catch (err) { showMsg('Error: ' + err.message, true); }
          })
        ])
      ]));
    });
  }

  function buildSwitch(label, isChecked, onChange) {
    const wrap = el('label', { style:'display:flex; align-items:center; gap:8px; font-size:0.82rem; cursor:pointer;' });
    const checkbox = el('input', { type: 'checkbox' });
    checkbox.checked = !!isChecked;
    checkbox.addEventListener('change', () => onChange(checkbox.checked));
    wrap.appendChild(checkbox);
    wrap.appendChild(document.createTextNode(label));
    wrap.appendChild(el('span', {
      style: 'font-size:0.7rem; padding:2px 6px; border-radius:4px; background:' + (isChecked ? 'var(--color-green)' : 'var(--color-red)') + '; color:#fff; font-weight:700;',
      textContent: isChecked ? 'HABILITADA' : 'DESHABILITADA'
    }));
    return wrap;
  }

  // ============================================================
  // BENEFICIOS
  // ============================================================
  function semaforoClass(status) { return 'semaforo semaforo-' + status; }

  function renderBenefitsTable() {
    const tbody = $('#benefitsTbody'); tbody.innerHTML = '';
    const benefits = Store.getAllBenefitsRaw();
    if (!benefits.length) {
      tbody.appendChild(el('tr', {}, [el('td', { colspan:'6', style:'text-align:center; padding:20px; color:var(--color-text-dim);', textContent:'No hay prestadores cargados.' })]));
      return;
    }
    benefits.forEach((b) => {
      const statusSelect = el('select', { 'data-role':'status' });
      ['propuesto','en_negociacion','activo','suspendido','vencido'].forEach((s) => {
        const opt = el('option', { value:s, textContent:s });
        if (b.status === s) opt.selected = true;
        statusSelect.appendChild(opt);
      });
      const refInput = el('input', { type:'text', 'data-role':'ref', maxlength:'60', value:b.agreementRef || '', placeholder:'Ej: CONV-2026-001' });
      const validInput = el('input', { type:'date', 'data-role':'valid', value:b.validUntil || '' });
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [
          el('div', { style:'font-weight:700; margin-bottom:2px;', textContent:b.name }),
          el('div', { style:'font-size:0.7rem; color:var(--color-text-dim);', textContent:b.benefitDetail || '' })
        ]),
        el('td', {}, [
          el('div', { textContent:b.category || '—' }),
          el('div', { style:'font-size:0.7rem; color:var(--color-text-dim);', textContent:'Loc: ' + b.locality })
        ]),
        el('td', {}, [
          el('div', { style:'margin-bottom:4px;' }, [ el('span', { className:semaforoClass(b.status) }), el('span', { textContent:b.status }) ]),
          statusSelect
        ]),
        el('td', {}, [refInput]),
        el('td', {}, [validInput]),
        el('td', {}, [
          el('div', { className:'row-actions' }, [
            el('button', { type:'button', textContent:'Guardar', onclick: () => {
              const admin = requireAdmin(); if (!admin) return;
              try {
                Store.updateBenefitStatus(b.id, statusSelect.value, refInput.value.trim(), validInput.value || '', admin);
                showMsg('Prestador actualizado.', false); renderBenefitsTable(); renderAudit();
              } catch (err) { showMsg('Error: ' + err.message, true); }
            }}),
            el('button', { type:'button', className:'btn-muted', textContent:'Ver app socio', onclick: () => window.open('index.html', '_blank', 'noopener') })
          ])
        ])
      ]));
    });
  }

  // ============================================================
  // AUDITORÍA
  // ============================================================
  function renderAudit() {
    const list = $('#auditList'); list.innerHTML = '';
    const logs = Store.getAuditLogs();
    if (!logs.length) { list.appendChild(el('li', { textContent:'Sin registros de auditoría todavía.' })); return; }
    logs.forEach((log) => {
      const payloadStr = (log.payload && Object.keys(log.payload).length) ? JSON.stringify(log.payload) : '';
      list.appendChild(el('li', {}, [
        el('span', { style:'color:var(--color-text-dim);', textContent: fmtDateTime(log.ts) + ' · ' }),
        el('span', { className:'audit-act', textContent: log.action }),
        el('span', { textContent:' · ' + (log.actor || 'system') }),
        payloadStr ? el('div', { style:'margin-top:2px; font-size:0.7rem; color:var(--color-text-dim);', textContent: payloadStr }) : null
      ].filter(Boolean)));
    });
  }

  function initExportAudit() {
    $('#btnExportAudit').addEventListener('click', () => {
      try {
        const logs = Store.getAuditLogs();
        const blob = new Blob([JSON.stringify(logs, null, 2)], { type:'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'e360_auditoria_' + new Date().toISOString().slice(0,19).replace(/[:.]/g,'-') + '.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        showMsg('Auditoría exportada como JSON.', false);
      } catch (err) { showMsg('Error exportando: ' + err.message, true); }
    });
  }

  function initResetDemo() {
    $('#btnResetDemo').addEventListener('click', () => {
      const admin = requireAdmin(); if (!admin) return;
      const confirmed = window.confirm('¿Reiniciar TODA la demo? Se borrarán perfiles, incidentes, convenios, carnet y auditoría.\n\nAcción registrada como "' + admin + '".');
      if (!confirmed) return;
      try {
        Store.clearAndResetDemo(admin);
        showMsg('Demo reiniciada al estado inicial.', false);
        renderOrganizations(); renderBenefitsTable(); renderExternalServicesForm(); renderPaymentForm(); renderPlanManager(); renderAudit();
      } catch (err) { showMsg('Error: ' + err.message, true); }
    });
  }

  // ============================================================
  // SERVICIOS TERCERIZADOS
  // ============================================================
  function renderExternalServicesForm() {
    const cfg = Store.getExternalServicesConfig();
    const medicoInput = $('#extMedicoVirtualUrl'), seguroInput = $('#extSeguroViajeroUrl'), statusEl = $('#extServicesStatus');
    if (!medicoInput || !seguroInput) return;
    if (document.activeElement !== medicoInput) medicoInput.value = cfg.medicoVirtualUrl || '';
    if (document.activeElement !== seguroInput) seguroInput.value = cfg.seguroViajeroUrl || '';
    if (statusEl) {
      if (cfg.updatedAt) { statusEl.textContent = 'Última actualización: ' + fmtDateTime(cfg.updatedAt) + ' · por ' + (cfg.updatedBy || '—'); statusEl.style.color = 'var(--color-text-dim)'; }
      else { statusEl.textContent = 'Sin configurar todavía.'; statusEl.style.color = 'var(--color-text-soft)'; }
    }
  }

  function initExternalServicesForm() {
    const form = $('#extServicesForm'), msg = $('#extServicesMsg'); if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault(); msg.textContent = ''; msg.style.color = '';
      const admin = requireAdmin();
      if (!admin) { msg.style.color = 'var(--color-red)'; msg.textContent = 'Ingresá tu nombre de administrador primero.'; return; }
      try {
        Store.setExternalServicesConfig({ medicoVirtualUrl: $('#extMedicoVirtualUrl').value.trim(), seguroViajeroUrl: $('#extSeguroViajeroUrl').value.trim() }, admin);
        msg.style.color = 'var(--color-green)'; msg.textContent = 'Servicios tercerizados actualizados.';
        renderExternalServicesForm(); renderAudit();
      } catch (err) { msg.style.color = 'var(--color-red)'; msg.textContent = 'Error: ' + err.message; }
    });
    $('#extServicesClear').addEventListener('click', () => {
      const admin = requireAdmin();
      const msg2 = $('#extServicesMsg');
      if (!admin) { msg2.style.color = 'var(--color-red)'; msg2.textContent = 'Ingresá tu nombre de administrador primero.'; return; }
      try { Store.setExternalServicesConfig({ medicoVirtualUrl:'', seguroViajeroUrl:'' }, admin); msg2.style.color = 'var(--color-green)'; msg2.textContent = 'URLs limpiadas.'; renderExternalServicesForm(); renderAudit(); }
      catch (err) { msg2.style.color = 'var(--color-red)'; msg2.textContent = 'Error: ' + err.message; }
    });
  }

  // ============================================================
  // PAGOS
  // ============================================================
  function renderPaymentForm() {
    const cfg = Store.getPaymentConfig();
    const enabled = $('#payMpEnabled'), key = $('#payMpPublicKey'), statusEl = $('#payStatus');
    if (!enabled || !key) return;
    enabled.checked = !!cfg.mercadoPagoEnabled;
    if (document.activeElement !== key) key.value = cfg.mercadoPagoPublicKey || '';
    C.PLAN_IDS.forEach((pid) => {
      const inp = document.getElementById('payCuota' + pid);
      if (inp && document.activeElement !== inp) inp.value = (cfg.cuotas && cfg.cuotas[pid]) || '';
    });
    if (statusEl) {
      if (cfg.updatedAt) { statusEl.textContent = 'Última actualización: ' + fmtDateTime(cfg.updatedAt) + ' · por ' + (cfg.updatedBy || '—'); statusEl.style.color = 'var(--color-text-dim)'; }
      else { statusEl.textContent = 'Sin configurar todavía.'; statusEl.style.color = 'var(--color-text-soft)'; }
    }
  }

  function initPaymentForm() {
    const form = $('#paymentForm'), msg = $('#payMsg'); if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault(); msg.textContent = ''; msg.style.color = '';
      const admin = requireAdmin();
      if (!admin) { msg.style.color = 'var(--color-red)'; msg.textContent = 'Ingresá tu nombre de administrador primero.'; return; }
      const cuotas = {};
      C.PLAN_IDS.forEach((pid) => { cuotas[pid] = (document.getElementById('payCuota' + pid) || {}).value || ''; });
      try {
        Store.setPaymentConfig({
          mercadoPagoEnabled: !!$('#payMpEnabled').checked,
          mercadoPagoPublicKey: $('#payMpPublicKey').value.trim(),
          cuotas
        }, admin);
        msg.style.color = 'var(--color-green)'; msg.textContent = 'Configuración de pagos guardada.';
        renderPaymentForm(); renderAudit();
      } catch (err) { msg.style.color = 'var(--color-red)'; msg.textContent = 'Error: ' + err.message; }
    });
  }

  // ============================================================
  // GESTIÓN DE PLAN POR DNI
  // ============================================================
  function renderPlanManager() {
    const tbody = $('#planManagerTbody'); if (!tbody) return;
    tbody.innerHTML = '';
    const profiles = Store.listProfiles();
    if (!profiles.length) {
      tbody.appendChild(el('tr', {}, [el('td', { colspan:'6', style:'text-align:center; padding:20px; color:var(--color-text-dim);', textContent:'Sin socios registrados todavía.' })]));
      return;
    }
    profiles.forEach((p) => {
      const planSel = el('select', { 'data-role':'plan' });
      C.PLAN_IDS.forEach((pid) => {
        const opt = el('option', { value:pid, textContent:(C.PLANS[pid] && C.PLANS[pid].label) || pid });
        if (p.plan === pid) opt.selected = true;
        planSel.appendChild(opt);
      });
      const effective = Store.calcCarnetStatus(p);
      const days = Store.daysToExpire(p);
      const validTxt = p.carnetValidUntil ? new Date(p.carnetValidUntil).toLocaleDateString('es-AR') : '—';
      const statusClass = 'carnet-status-pill carnet-status-' + (effective === 'activo' && days !== null && days <= C.CARNET_WARN_DAYS ? 'por_vencer' : effective);
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [el('div', { style:'font-weight:700;', textContent:p.nombre || '—' }), el('div', { style:'font-size:0.7rem; color:var(--color-text-dim);', textContent:'DNI ' + (p.dni || '—') })]),
        el('td', {}, [el('code', { textContent:p.socioNumber || '—' })]),
        el('td', {}, [planSel]),
        el('td', {}, [el('span', { className:statusClass, textContent:effective }), el('div', { style:'font-size:0.7rem; color:var(--color-text-dim);', textContent:'Vence ' + validTxt })]),
        el('td', {}, [
          el('div', { className:'row-actions' }, [
            el('button', { type:'button', textContent:'Guardar plan', onclick: () => {
              const admin = requireAdmin(); if (!admin) return;
              try { Store.setProfilePlan(p.dni, planSel.value, admin); showMsg('Plan actualizado.', false); renderPlanManager(); renderAudit(); }
              catch (err) { showMsg('Error: ' + err.message, true); }
            }}),
            el('button', { type:'button', className:'btn-muted', textContent:'Renovar carnet', onclick: () => {
              const admin = requireAdmin(); if (!admin) return;
              try { Store.renewCarnet(p.dni, admin); showMsg('Carnet renovado.', false); renderPlanManager(); renderAudit(); }
              catch (err) { showMsg('Error: ' + err.message, true); }
            }}),
            el('button', { type:'button', className:'btn-danger', textContent: p.carnetStatus === 'suspendido' ? 'Reactivar' : 'Suspender', onclick: () => {
              const admin = requireAdmin(); if (!admin) return;
              try {
                Store.setCarnetStatus(p.dni, p.carnetStatus === 'suspendido' ? 'activo' : 'suspendido', admin);
                showMsg('Estado de carnet actualizado.', false); renderPlanManager(); renderAudit();
              } catch (err) { showMsg('Error: ' + err.message, true); }
            }})
          ])
        ])
      ]));
    });
  }

  // ============================================================
  // SUSCRIPCIÓN
  // ============================================================
  function initSubscription() {
    Store.subscribe((msg) => {
      if (!msg || msg.type !== 'STATE_CHANGED') return;
      renderOrganizations(); renderBenefitsTable(); renderExternalServicesForm(); renderPaymentForm(); renderPlanManager(); renderAudit();
    });
  }

  // ============================================================
  // BOOT
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => {
    initAdminInput();
    renderOrganizations();
    renderBenefitsTable();
    renderExternalServicesForm();
    initExternalServicesForm();
    renderPaymentForm();
    initPaymentForm();
    renderPlanManager();
    renderAudit();
    initExportAudit();
    initResetDemo();
    initSubscription();
  });
})();
