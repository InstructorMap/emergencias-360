/* ============================================================
   app-b2b.js v8.2 — Módulo B2B EMP (C1 Aplicado)
   - Login staff (admin/operador) por email con spinner
   - applyBrandingToPage() en el boot y pantalla de login
   - Alta/edición de establecimientos con withButtonLoading
   - Toggle status con spinner
   - QR de emergencia por establecimiento
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  const QR = window.E360QR;
  if (!Store) { console.error('[app-b2b] E360Store no disponible.'); return; }

  const $ = (s) => document.querySelector(s);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (v === true) { node.setAttribute(k, ''); return; }
        if (k === 'className') { node.className = v; return; }
        if (k === 'textContent') { node.textContent = v; return; }
        if (k === 'onclick' && typeof v === 'function') { node.addEventListener('click', v); return; }
        if (k === 'innerHTML') { node.innerHTML = v; return; }
        node.setAttribute(k, v);
      });
    }
    (children || []).forEach((c) => {
      if (c === null || c === undefined) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  function toast(text) {
    let t = document.getElementById('e360Toast');
    if (!t) { t = document.createElement('div'); t.id = 'e360Toast'; document.body.appendChild(t); }
    t.textContent = text;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function runLoading(btn, fn, label) {
    if (typeof Store.withButtonLoading === 'function') {
      return await Store.withButtonLoading(btn, fn, label);
    }
    return await fn();
  }

  function fmtErr(err) {
    return typeof Store.humanizeError === 'function' ? Store.humanizeError(err) : (err.message || 'Error');
  }

  const ui = { baseFilter: 'ALL', editingId: null };

  function showLogin() {
    const ov = $('#b2bLoginOverlay'); if (ov) ov.hidden = false;
    const app = $('#b2bApp'); if (app) app.hidden = true;
  }
  function hideLogin() {
    const ov = $('#b2bLoginOverlay'); if (ov) ov.hidden = true;
    const app = $('#b2bApp'); if (app) app.hidden = false;
  }

  function initLogin() {
    const form = $('#b2bLoginForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#b2bLoginMsg');
      const btn = $('#b2bLoginBtn');
      const email = $('#b2bLoginEmail').value.trim();
      const password = $('#b2bLoginPassword').value;
      if (!email || !password) {
        if (msg) { msg.textContent = 'Completá email y contraseña.'; msg.style.color = '#DC2626'; }
        return;
      }
      await runLoading(btn, async () => {
        try {
          const profile = await Store.loginWithEmail(email, password);
          if (!profile || (profile.role !== 'admin' && profile.role !== 'operador')) {
            await Store.logout();
            throw new Error('Tu cuenta no tiene permisos.');
          }
          hideLogin();
          await bootB2B();
        } catch (err) {
          if (msg) { msg.textContent = fmtErr(err); msg.style.color = '#DC2626'; }
        }
      }, 'Ingresando…');
    });

    const logout = $('#b2bLogout');
    if (logout) logout.addEventListener('click', async () => {
      if (!confirm('¿Cerrar sesión?')) return;
      await runLoading(logout, async () => {
        await Store.logout();
        location.reload();
      }, 'Saliendo…');
    });
  }

  async function applyBranding() {
    try {
      const b = typeof Store.applyBrandingToPage === 'function'
        ? await Store.applyBrandingToPage()
        : await Store.loadBranding();
      if (b && b.logoUrl) {
        const brand = $('#b2bHeaderBrand');
        if (brand) {
          const svg = brand.querySelector('svg');
          if (svg) {
            const img = document.createElement('img');
            img.src = b.logoUrl;
            img.alt = 'EMP';
            img.className = 'emp-logo-chip';
            img.style.height = '38px';
            svg.replaceWith(img);
          }
        }
      }
    } catch (_) {}
  }

  function initBaseFilter() {
    const sel = $('#b2bBaseSelector');
    if (!sel) return;
    sel.value = ui.baseFilter;
    sel.addEventListener('change', () => { ui.baseFilter = sel.value; renderList(); });
  }

  function resetForm() {
    ui.editingId = null;
    if ($('#b2bId')) $('#b2bId').value = '';
    if ($('#b2bName')) $('#b2bName').value = '';
    if ($('#b2bType')) $('#b2bType').value = 'Hotel / Complejo';
    if ($('#b2bBase')) $('#b2bBase').value = 'DOLORES';
    if ($('#b2bStatus')) $('#b2bStatus').value = 'en_revision';
    if ($('#b2bAddress')) $('#b2bAddress').value = '';
    if ($('#b2bPhone')) $('#b2bPhone').value = '';
    if ($('#b2bTipoUnidad')) $('#b2bTipoUnidad').value = 'COMUN';
    if ($('#b2bProtocol')) $('#b2bProtocol').value = '';
    if ($('#b2bSubmit')) $('#b2bSubmit').textContent = 'Crear establecimiento';
    if ($('#b2bCancelEdit')) $('#b2bCancelEdit').hidden = true;
    if ($('#formTitle')) $('#formTitle').textContent = 'Nuevo establecimiento B2B';
  }

  function initForm() {
    const form = $('#b2bForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#b2bMsg');
      const btn = $('#b2bSubmit');
      if (msg) msg.textContent = '';
      const data = {
        id: ui.editingId || undefined,
        name: $('#b2bName').value.trim(),
        type: $('#b2bType').value,
        baseId: $('#b2bBase').value,
        status: $('#b2bStatus').value,
        address: $('#b2bAddress').value.trim(),
        referencePhone: $('#b2bPhone').value.trim(),
        tipoUnidadRequerida: $('#b2bTipoUnidad').value,
        protocol: $('#b2bProtocol').value.trim()
      };
      if (!data.name || !data.address) {
        if (msg) { msg.style.color = '#DC2626'; msg.textContent = 'Nombre y dirección obligatorios.'; }
        return;
      }
      await runLoading(btn, async () => {
        try {
          await Store.saveB2BEstablishment(data, 'admin');
          if (msg) { msg.style.color = '#16A34A'; msg.textContent = ui.editingId ? 'Actualizado.' : 'Creado.'; }
          toast(ui.editingId ? 'Establecimiento actualizado' : 'Establecimiento creado');
          resetForm();
          renderList();
        } catch (err) {
          if (msg) { msg.style.color = '#DC2626'; msg.textContent = 'Error: ' + fmtErr(err); }
        }
      }, 'Guardando…');
    });
    const cancel = $('#b2bCancelEdit');
    if (cancel) cancel.addEventListener('click', () => resetForm());
  }

  function loadIntoForm(est) {
    ui.editingId = est.id;
    if ($('#b2bId')) $('#b2bId').value = est.id;
    if ($('#b2bName')) $('#b2bName').value = est.name || '';
    if ($('#b2bType')) $('#b2bType').value = est.type || 'Hotel / Complejo';
    if ($('#b2bBase')) $('#b2bBase').value = est.baseId || 'DOLORES';
    if ($('#b2bStatus')) $('#b2bStatus').value = est.status || 'en_revision';
    if ($('#b2bAddress')) $('#b2bAddress').value = est.address || '';
    if ($('#b2bPhone')) $('#b2bPhone').value = est.referencePhone || '';
    if ($('#b2bTipoUnidad')) $('#b2bTipoUnidad').value = est.tipoUnidadRequerida || 'COMUN';
    if ($('#b2bProtocol')) $('#b2bProtocol').value = est.protocol || '';
    if ($('#b2bSubmit')) $('#b2bSubmit').textContent = 'Guardar cambios';
    if ($('#b2bCancelEdit')) $('#b2bCancelEdit').hidden = false;
    if ($('#formTitle')) $('#formTitle').textContent = 'Editar: ' + est.name;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function buildQRBox(est) {
    const url = 'socio.html?b2b=' + encodeURIComponent(est.id);
    const box = el('div', { className: 'qr-box' });
    if (QR && typeof QR.toSvg === 'function') {
      try { box.innerHTML = QR.toSvg(url, 90); } catch (_) {}
    }
    box.appendChild(el('div', { className: 'qr-info' }, [
      el('strong', { textContent: 'QR de Emergencia' }),
      el('div', { textContent: 'ID: ' + est.id }),
      el('div', { textContent: 'Apunta a: ' + url })
    ]));
    return box;
  }

  function renderList() {
    const list = $('#b2bList');
    const empty = $('#b2bEmpty');
    if (!list) return;
    list.innerHTML = '';
    const items = Store.getB2BEstablishments(ui.baseFilter);
    if (!items.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    items.forEach(est => {
      const toggleBtn = el('button', {
        type: 'button',
        className: est.status === 'activo' ? 'btn-danger' : '',
        textContent: est.status === 'activo' ? 'Suspender' : 'Activar',
        onclick: async () => {
          await runLoading(toggleBtn, async () => {
            try {
              const next = est.status === 'activo' ? 'suspendido' : 'activo';
              await Store.toggleB2BStatus(est.id, next, 'admin');
              toast('Estado: ' + next);
              renderList();
            } catch (err) { toast('Error: ' + fmtErr(err)); }
          }, 'Actualizando…');
        }
      });

      const card = el('div', { className: 'b2b-est-card' }, [
        el('div', { className: 'est-top' }, [
          el('div', { className: 'est-name', textContent: est.name }),
          el('span', { className: 'badge badge-status-' + est.status, textContent: est.status })
        ]),
        el('div', { className: 'est-meta' }, [
          el('div', {}, [el('strong', { textContent: 'Rubro: ' }), el('span', { textContent: est.type })]),
          el('div', {}, [el('strong', { textContent: 'Base: ' }), el('span', { textContent: est.baseId })]),
          el('div', {}, [el('strong', { textContent: 'Dirección: ' }), el('span', { textContent: est.address })]),
          el('div', {}, [el('strong', { textContent: 'Teléfono: ' }), el('span', { textContent: est.referencePhone || '—' })]),
          el('div', {}, [el('strong', { textContent: 'Unidad requerida: ' }), el('span', { textContent: est.tipoUnidadRequerida || 'COMUN' })])
        ]),
        el('div', { className: 'est-proto', textContent: 'Protocolo: ' + (est.protocol || 'Sin protocolo.') }),
        buildQRBox(est),
        el('div', { className: 'row-actions' }, [
          el('button', { type: 'button', textContent: '🔗 Probar QR', onclick: () => window.open('socio.html?b2b=' + encodeURIComponent(est.id), '_blank', 'noopener') }),
          el('button', { type: 'button', className: 'btn-muted', textContent: '✎ Editar', onclick: () => loadIntoForm(est) }),
          toggleBtn
        ])
      ]);
      list.appendChild(card);
    });
  }

  async function bootB2B() {
    await applyBranding();
    initBaseFilter();
    initForm();
    resetForm();
    renderList();
    Store.subscribe(msg => {
      if (!msg || msg.type === 'AUTH_CHANGED') { if (msg && msg.type === 'AUTH_CHANGED') location.reload(); return; }
      if (msg.type === 'BRANDING_CHANGED') applyBranding();
      if (msg.type === 'STATE_CHANGED') renderList();
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await applyBranding();
    initLogin();
    const session = await Store.initSession();
    if (session.loggedIn && session.profile && (session.profile.role === 'admin' || session.profile.role === 'operador')) {
      hideLogin();
      await bootB2B();
    } else {
      if (session.loggedIn) await Store.logout();
      showLogin();
    }
  });
})();
