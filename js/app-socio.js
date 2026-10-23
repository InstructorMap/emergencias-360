/* ============================================================
   app-socio.js — Controlador de index.html
   Manejo SOS, GPS, ficha, beneficios, Área Protegida (B2B)
   y servicios tercerizados (Médico Virtual / Seguro al viajero).
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  if (!Store) {
    console.error('[app-socio] E360Store no disponible.');
    return;
  }

  const C = window.E360Config;

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

  let currentIncident = null;
  let currentLocation = null;
  let manualAddress = '';
  let activeLocality = 'Dolores';
  let b2bContext = null;

  // ============================================================
  // TABS
  // ============================================================
  function initTabs() {
    const navBtns = $$('.nav-btn');
    const panels = $$('.tab-panel');
    navBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        navBtns.forEach((b) => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        panels.forEach((p) => {
          const show = p.dataset.tab === target;
          p.hidden = !show;
        });
        if (target === 'beneficios') renderBenefits(activeLocality);
        if (target === 'ficha') { loadProfileIntoForm(); renderExternalServices(); }
      });
    });
  }

  // ============================================================
  // BANNER LEGAL
  // ============================================================
  function initBanner() {
    const btn = $('#btnToggleBanner');
    const detalle = $('#bannerDetalle');
    if (!btn || !detalle) return;
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      detalle.hidden = expanded;
      btn.textContent = expanded ? 'Ver aviso legal' : 'Ocultar aviso legal';
    });
  }

  // ============================================================
  // CONEXIÓN + BASE
  // ============================================================
  function initConnection() {
    const dot = $('#connDot');
    const text = $('#connText');
    function update() {
      const online = navigator.onLine;
      dot.className = 'dot ' + (online ? 'dot-online' : 'dot-offline');
      text.textContent = online ? 'Online' : 'Offline';
    }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  function initBaseSelector() {
    const select = $('#baseSelector');
    const ctx = Store.getActiveContext();
    select.value = ctx.activeBaseId;
    updateBasePhone(ctx.base.phone);

    select.addEventListener('change', () => {
      Store.setActiveBase(select.value);
      const newCtx = Store.getActiveContext();
      updateBasePhone(newCtx.base.phone);
    });
  }

  function updateBasePhone(phone) {
    const btn = $('#btnCallBase');
    if (btn && phone) btn.setAttribute('href', 'tel:' + String(phone).replace(/[^0-9+]/g, ''));
  }

  // ============================================================
  // B2B — Área Protegida por QR (?b2b=ID)
  // ============================================================
  function initB2BFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const b2bId = params.get('b2b');
    if (!b2bId) return;

    const est = Store.getB2BById(b2bId);
    if (!est) {
      console.warn('[app-socio] B2B no encontrado:', b2bId);
      return;
    }
    b2bContext = est;

    if (est.baseId && est.baseId !== Store.getActiveContext().activeBaseId) {
      Store.setActiveBase(est.baseId);
      const sel = $('#baseSelector');
      if (sel) sel.value = est.baseId;
      const ctx = Store.getActiveContext();
      updateBasePhone(ctx.base.phone);
    }

    const manualInput = $('#manualDir');
    const manualFallback = $('#manualFallback');
    if (manualInput && manualFallback) {
      manualInput.value = est.name + ' — ' + est.address;
      manualAddress = manualInput.value.trim();
      manualFallback.hidden = false;
    }

    const banner = $('#b2bBanner');
    if (banner) {
      banner.hidden = false;
      banner.innerHTML = '';
      const strong = document.createElement('strong');
      strong.textContent = '📍 Área Protegida Detectada por QR: ' + est.name;
      const info = document.createElement('div');
      info.textContent = est.address + ' · Base ' + est.baseId + ' · Rubro: ' + est.type;
      banner.appendChild(strong);
      banner.appendChild(info);
      if (est.protocol) {
        const proto = document.createElement('div');
        proto.className = 'b2b-proto';
        proto.textContent = 'Protocolo de ingreso: ' + est.protocol;
        banner.appendChild(proto);
      }
      if (est.tipoUnidadRequerida) {
        const tipo = document.createElement('div');
        tipo.className = 'b2b-proto';
        tipo.textContent = 'Tipo de unidad sugerida: ' + est.tipoUnidadRequerida;
        banner.appendChild(tipo);
      }
    }
  }

  // ============================================================
  // GPS
  // ============================================================
  function initGPS() {
    const status = $('#gpsStatus');
    const btn = $('#btnGps');
    const fallback = $('#manualFallback');
    const manualInput = $('#manualDir');

    btn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        status.textContent = 'GPS: no disponible en este dispositivo.';
        fallback.hidden = false;
        return;
      }
      status.textContent = 'GPS: obteniendo ubicación…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          currentLocation = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
          status.textContent =
            'GPS: ' + currentLocation.lat.toFixed(5) + ', ' + currentLocation.lng.toFixed(5) +
            ' (±' + Math.round(currentLocation.accuracy) + 'm)';
          fallback.hidden = true;
        },
        (err) => {
          console.warn('[app-socio] GPS error:', err);
          status.textContent = 'GPS: no se pudo obtener. Usá la dirección manual.';
          fallback.hidden = false;
        },
        { enableHighAccuracy: true, timeout: C.GPS_TIMEOUT_MS, maximumAge: C.GPS_MAX_AGE_MS }
      );
    });

    manualInput.addEventListener('input', () => {
      manualAddress = manualInput.value.trim();
    });
  }

  // ============================================================
  // SOS
  // ============================================================
  const HOLD_MS = C.SOS_HOLD_MS;
  let holdTimer = null;
  let holdStart = 0;
  let holdRAF = null;
  let sosFired = false;

  function setProgress(pct) {
    const btn = $('#btnSOS');
    if (!btn) return;
    btn.style.setProperty('--progress', pct + '%');
  }

  function startHold(e) {
    if (sosFired) return;
    if (e.type === 'touchstart') e.preventDefault();
    const btn = $('#btnSOS');
    btn.classList.add('pressing');
    holdStart = Date.now();

    function tick() {
      const elapsed = Date.now() - holdStart;
      const pct = Math.min(100, (elapsed / HOLD_MS) * 100);
      setProgress(pct);
      if (elapsed < HOLD_MS) {
        holdRAF = requestAnimationFrame(tick);
      }
    }
    holdRAF = requestAnimationFrame(tick);

    holdTimer = setTimeout(() => {
      sosFired = true;
      cancelHold(true);
      fireSOS();
    }, HOLD_MS);
  }

  function cancelHold(force) {
    const btn = $('#btnSOS');
    if (btn) btn.classList.remove('pressing');
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (holdRAF) { cancelAnimationFrame(holdRAF); holdRAF = null; }
    if (!force) setProgress(0);
  }

  function initSOSButton() {
    const btn = $('#btnSOS');
    if (!btn) return;

    btn.addEventListener('touchstart', startHold, { passive: false });
    btn.addEventListener('mousedown', startHold);
    btn.addEventListener('touchend', () => cancelHold(false));
    btn.addEventListener('mouseup', () => cancelHold(false));
    btn.addEventListener('mouseleave', () => cancelHold(false));
    btn.addEventListener('touchcancel', () => cancelHold(false));

    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!holdTimer) startHold(e);
      }
    });
    btn.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        cancelHold(false);
      }
    });
  }

  function fireSOS() {
    const activeProfile = Store.getActiveProfile();
    const profileDni = activeProfile ? activeProfile.dni : null;

    const incident = Store.createSOSIncident({
      location: currentLocation,
      manualAddress: manualAddress,
      profileDni: profileDni,
      b2bEstablishmentId: b2bContext ? b2bContext.id : null,
      notes: b2bContext ? ('Ingreso B2B: ' + b2bContext.name) : ''
    });

    currentIncident = incident;
    renderIncident(incident);
    setProgress(100);
    setTimeout(() => { setProgress(0); sosFired = false; }, 400);
  }

  // ============================================================
  // RENDER DE INCIDENTE
  // ============================================================
  const STATE_LABELS = {
    RECIBIDA_SERVIDOR: { text: 'Alerta emitida. Aguardando confirmación de un operador de central.', color: 'amber' },
    ACEPTADA_POR_CENTRAL: { text: 'Central Operativa confirmó recepción. Evaluando la situación.', color: 'blue' },
    CLASIFICADA: { text: 'Incidente clasificado por Central. Asignando recurso.', color: 'blue' },
    MOVIL_ASIGNADO: { text: 'Móvil asignado. Preparando salida.', color: 'green' },
    EN_CAMINO: { text: 'Móvil en camino. Mantené la calma y la línea disponible.', color: 'green' },
    EN_ESCENA: { text: 'El móvil arribó al lugar. El personal está asistiendo.', color: 'green' },
    EN_TRASLADO: { text: 'Traslado en curso hacia un centro asistencial.', color: 'green' },
    CERRADA: { text: 'Incidente cerrado por la Central Operativa.', color: 'green' },
    CANCELADA: { text: 'Incidente cancelado.', color: 'red' }
  };

  const TIMELINE_STEPS = [
    { key: 'RECIBIDA_SERVIDOR', label: 'Enviada / Recibida por servidor' },
    { key: 'ACEPTADA_POR_CENTRAL', label: 'Aceptada por Central' },
    { key: 'CLASIFICADA', label: 'Clasificada / Triage' },
    { key: 'MOVIL_ASIGNADO', label: 'Móvil asignado' },
    { key: 'EN_CAMINO', label: 'Móvil en camino' },
    { key: 'EN_ESCENA', label: 'Móvil en escena' },
    { key: 'EN_TRASLADO', label: 'En traslado' },
    { key: 'CERRADA', label: 'Incidente cerrado' }
  ];

  function renderIncident(incident) {
    const panel = $('#incidentPanel');
    const stateEl = $('#incidentState');
    const timelineEl = $('#timeline');
    if (!panel || !stateEl || !timelineEl) return;

    panel.hidden = false;
    const info = STATE_LABELS[incident.status] || { text: incident.status, color: 'amber' };
    stateEl.textContent = info.text;
    stateEl.setAttribute('data-color', info.color);

    timelineEl.innerHTML = '';
    const doneSet = new Set(incident.statusHistory.map((h) => h.status));

    TIMELINE_STEPS.forEach((step) => {
      const li = document.createElement('li');
      li.textContent = step.label;
      if (doneSet.has(step.key)) li.classList.add('done');
      timelineEl.appendChild(li);
    });
  }

  function initIncidentSubscription() {
    const latest = Store.getLatestIncident();
    if (latest) {
      currentIncident = latest;
      renderIncident(latest);
    }

    Store.subscribe((msg) => {
      if (!msg || msg.type !== 'STATE_CHANGED') return;
      const fresh = Store.getLatestIncident();
      if (fresh && currentIncident && fresh.id === currentIncident.id) {
        currentIncident = fresh;
        renderIncident(fresh);
      }
      renderBenefits(activeLocality);
      renderExternalServices();
    });
  }

  // ============================================================
  // FICHA
  // ============================================================
  function loadProfileIntoForm() {
    const dniInput = $('#fDni');
    if (!dniInput) return;
    const typedDni = dniInput.value.trim();
    const profile = typedDni ? Store.getProfile(typedDni) : Store.getActiveProfile();
    if (!profile) return;
    if (!typedDni) dniInput.value = profile.dni || '';
    $('#fNombre').value = profile.nombre || '';
    $('#fTelefono').value = profile.telefono || '';
    $('#fGrupo').value = profile.grupoSanguineo || '';
    $('#fAlergias').value = profile.alergias || '';
    $('#fPatologias').value = profile.patologias || '';
    $('#fContacto').value = profile.contacto || '';
  }

  function initFichaForm() {
    const form = $('#formFicha');
    const msg = $('#fichaMsg');
    if (!form) return;

    const dniInput = $('#fDni');
    dniInput.addEventListener('blur', loadProfileIntoForm);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      msg.textContent = '';

      const nombre = $('#fNombre').value.trim();
      const dni = $('#fDni').value.trim();
      const telefono = $('#fTelefono').value.trim();
      const consent = $('#fConsent').checked;

      if (!nombre || !dni || !telefono) {
        msg.style.color = 'var(--color-red)';
        msg.textContent = 'Completá nombre, DNI y teléfono.';
        return;
      }
      if (!consent) {
        msg.style.color = 'var(--color-red)';
        msg.textContent = 'Debés aceptar el Consentimiento Informado.';
        return;
      }

      try {
        Store.saveProfile({
          nombre,
          dni,
          telefono,
          grupoSanguineo: $('#fGrupo').value,
          alergias: $('#fAlergias').value.trim(),
          patologias: $('#fPatologias').value.trim(),
          contacto: $('#fContacto').value.trim()
        });
        msg.style.color = 'var(--color-green)';
        msg.textContent = 'Ficha guardada correctamente.';
        renderExternalServices();
      } catch (err) {
        msg.style.color = 'var(--color-red)';
        msg.textContent = 'Error al guardar: ' + err.message;
      }
    });
  }

  // ============================================================
  // SERVICIOS TERCERIZADOS (Médico Virtual / Seguro al viajero)
  // En esta entrega se muestran siempre que haya URL configurada.
  // En la Entrega 2 (planes) se gatean por plan ORO/PLATINO.
  // ============================================================
  function renderExternalServices() {
    const container = $('#externalServicesBlock');
    if (!container) return;
    container.innerHTML = '';

    const cfg = Store.getExternalServicesConfig();
    const labels = C.EXTERNAL_SERVICES_LABELS || {};
    const disclaimer = C.EXTERNAL_SERVICES_DISCLAIMER || '';

    const title = el('h3', { textContent: 'Servicios Tercerizados' });
    container.appendChild(title);

    const rows = [
      { key: 'medicoVirtual', url: cfg.medicoVirtualUrl, label: labels.medicoVirtual || 'Médico Virtual' },
      { key: 'seguroViajero', url: cfg.seguroViajeroUrl, label: labels.seguroViajero || 'Seguro al Viajero' }
    ];

    rows.forEach((r) => {
      const row = el('div', { className: 'ext-row' }, [
        el('span', { className: 'ext-label', textContent: r.label })
      ]);
      if (r.url) {
        row.appendChild(el('a', {
          className: 'ext-link',
          href: r.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          textContent: 'Abrir ↗'
        }));
      } else {
        row.appendChild(el('span', {
          className: 'ext-pending',
          textContent: '— Servicio no configurado —'
        }));
      }
      container.appendChild(row);
    });

    if (disclaimer) {
      container.appendChild(el('div', {
        className: 'ext-disclaimer',
        textContent: disclaimer
      }));
    }

    container.hidden = false;
  }

  // ============================================================
  // BENEFICIOS
  // ============================================================
  function renderBenefits(locality) {
    const list = $('#benefitsList');
    const empty = $('#benefitsEmpty');
    if (!list) return;
    list.innerHTML = '';

    const items = Store.getVisibleBenefits(locality);
    if (!items.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    items.forEach((b) => {
      const card = el('li', { className: 'benefit-card' }, [
        el('h3', { textContent: b.name }),
        el('p', { textContent: 'Categoría: ' + (b.category || '—') + ' · Localidad: ' + b.locality }),
        el('p', { className: 'benefit-desc', textContent: b.benefitDetail || '' }),
        el('p', { textContent: 'Convenio: ' + b.agreementRef + (b.validUntil ? ' · Vigencia: ' + b.validUntil : '') })
      ]);
      list.appendChild(card);
    });
  }

  function initBenefitsFilter() {
    $$('.btn-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.btn-filter').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeLocality = btn.dataset.loc;
        renderBenefits(activeLocality);
      });
    });
    renderBenefits(activeLocality);
  }

  // ============================================================
  // HERRAMIENTAS DE PRUEBA MVP
  // ============================================================
  function initTestTools() {
    const tools = $('#testTools');
    const toggle = $('#btnTestToggle');
    const panel = $('#testPanel');
    if (!tools || !toggle || !panel) return;

    const ctx = Store.getActiveContext();
    if (ctx.platformMode !== 'LOCAL_MVP') return;
    tools.hidden = false;

    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      panel.hidden = expanded;
    });

    $$('.btn-test[data-sim]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!currentIncident) {
          alert('Primero generá un incidente SOS.');
          return;
        }
        const sim = btn.dataset.sim;
        const map = {
          recibir: 'ACEPTADA_POR_CENTRAL',
          clasificar: 'CLASIFICADA',
          asignar: 'MOVIL_ASIGNADO',
          camino: 'EN_CAMINO'
        };
        const next = map[sim];
        if (!next) return;
        try {
          const updated = Store.transitionIncidentStatus(currentIncident.id, next);
          currentIncident = updated;
          renderIncident(updated);
        } catch (err) {
          alert('Transición no permitida: ' + err.message);
        }
      });
    });
  }

  // ============================================================
  // SERVICE WORKER (PWA)
  // ============================================================
  function initServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('[app-socio] SW registro falló:', err);
      });
    }
  }

  // ============================================================
  // BOOT
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => {
    initBanner();
    initConnection();
    initBaseSelector();
    initTabs();
    initGPS();
    initSOSButton();
    initIncidentSubscription();
    initFichaForm();
    initBenefitsFilter();
    initTestTools();
    initServiceWorker();
    initB2BFromQuery();
    renderExternalServices();

    const activeProfile = Store.getActiveProfile();
    if (activeProfile) {
      const dniInput = $('#fDni');
      if (dniInput && !dniInput.value) {
        dniInput.value = activeProfile.dni || '';
      }
      loadProfileIntoForm();
    }
  });
})();
