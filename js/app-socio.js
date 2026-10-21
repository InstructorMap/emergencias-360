/* ============================================================
   app-socio.js — Controlador de index.html
   Manejo SOS, GPS, ficha, beneficios y sincronización en vivo.
   Soporta el ciclo completo de estados de la Central Operativa.
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  if (!Store) {
    console.error('[app-socio] E360Store no disponible.');
    return;
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'className') node.className = attrs[k];
        else if (k === 'textContent') node.textContent = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    (children || []).forEach((c) => {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  let currentIncident = null;
  let currentLocation = null;
  let manualAddress = '';
  let activeLocality = 'Dolores';

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
        if (target === 'ficha') loadProfileIntoForm();
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
    if (btn) btn.setAttribute('href', 'tel:' + phone);
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
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });

    manualInput.addEventListener('input', () => {
      manualAddress = manualInput.value.trim();
    });
  }

  // ============================================================
  // SOS
  // ============================================================
  const HOLD_MS = 1500;
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
      notes: ''
    });

    currentIncident = incident;
    renderIncident(incident);
    setProgress(100);
    setTimeout(() => { setProgress(0); sosFired = false; }, 400);
  }

  // ============================================================
  // RENDER DE INCIDENTE (con nuevos estados)
  // ============================================================
  const STATE_LABELS = {
    RECIBIDA_SERVIDOR: {
      text: 'Alerta emitida. Aguardando confirmación de un operador de central.',
      color: 'amber'
    },
    ACEPTADA_POR_CENTRAL: {
      text: 'Central Operativa confirmó recepción. Evaluando la situación.',
      color: 'blue'
    },
    CLASIFICADA: {
      text: 'Incidente clasificado por Central. Asignando recurso.',
      color: 'blue'
    },
    MOVIL_ASIGNADO: {
      text: 'Móvil asignado. Preparando salida.',
      color: 'green'
    },
    EN_CAMINO: {
      text: 'Móvil en camino. Mantené la calma y la línea disponible.',
      color: 'green'
    },
    EN_ESCENA: {
      text: 'El móvil arribó al lugar. El personal está asistiendo.',
      color: 'green'
    },
    EN_TRASLADO: {
      text: 'Traslado en curso hacia un centro asistencial.',
      color: 'green'
    },
    CERRADA: {
      text: 'Incidente cerrado por la Central Operativa.',
      color: 'green'
    },
    CANCELADA: {
      text: 'Incidente cancelado.',
      color: 'red'
    }
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
      } catch (err) {
        msg.style.color = 'var(--color-red)';
        msg.textContent = 'Error al guardar: ' + err.message;
      }
    });
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
        el('p', { textContent: 'Localidad: ' + b.locality }),
        el('p', { className: 'benefit-desc', textContent: b.description })
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
          aceptar: 'ACEPTADA_POR_CENTRAL',
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

    const openCentral = $('#btnOpenCentral');
    if (openCentral) {
      openCentral.addEventListener('click', () => {
        window.open('central.html', '_blank');
      });
    }
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

    // Precarga del perfil activo (H-02)
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
