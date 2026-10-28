/* ============================================================
   app-socio.js — Controlador de socio.html (v6.2)
   - 5 tabs: Inicio, SOS, Credencial, Beneficios, Cuenta/Ficha
   - Credencial con N° SOCIO (4 columnas) + QR payload corto
   - Regeneración defensiva de carnetToken + fallback visible
   - Modo Adulto Mayor (WCAG AAA) persistente en localStorage
   - Configuración Supabase en caliente
   - Preserva: SOS 1.5s (tab-sos + btnSOSInicio sincronizados),
     GPS, ETA, ficha, beneficios, ?b2b=, ?pulsera=, ?carnet=,
     test tools, toast, helper el() con guard exacto.
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  const C = window.E360Config;
  const QR = window.E360QR || null;

  if (!Store || !C) {
    console.error('[app-socio] Faltan dependencias core.', {
      E360Config: typeof window.E360Config,
      E360StateMachine: typeof window.E360StateMachine,
      E360Store: typeof window.E360Store,
      E360QR: typeof window.E360QR
    });
    return;
  }

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

  // Estado local
  let currentIncident = null;
  let currentLocation = null;
  let manualAddress = '';
  let activeLocality = 'Dolores';
  let b2bContext = null;
  let credencialInterval = null;
  let credencialCodigo = null;
  let credencialSegundos = 180;
  let activeFamilyIndex = 0;

  const MODO_MAYOR_KEY = 'e360_modo_mayor';
  const CODIGO_DURACION_SEG = 180; // 3:00

  // ============================================================
  // MODO ADULTO MAYOR
  // ============================================================
  function initModoMayor() {
    const btn = $('#btnModoMayor');
    if (!btn) return;
    const activo = (function () {
      try { return localStorage.getItem(MODO_MAYOR_KEY) === '1'; } catch (_) { return false; }
    })();
    document.body.classList.toggle('modo-mayor', activo);
    btn.setAttribute('aria-pressed', activo ? 'true' : 'false');
    btn.addEventListener('click', () => {
      const ahora = !document.body.classList.contains('modo-mayor');
      document.body.classList.toggle('modo-mayor', ahora);
      btn.setAttribute('aria-pressed', ahora ? 'true' : 'false');
      try { localStorage.setItem(MODO_MAYOR_KEY, ahora ? '1' : '0'); } catch (_) {}
    });
  }

  // ============================================================
  // VERIFICACIÓN PÚBLICA ?carnet=TOKEN
  // ============================================================
  function isCarnetMode() {
    return new URLSearchParams(window.location.search).has('carnet');
  }

  function renderCarnetVerifyMode() {
    const token = new URLSearchParams(window.location.search).get('carnet');
    const data = token ? Store.getProfileByCarnetToken(token) : null;

    document.body.classList.add('carnet-verify-mode');
    const main = document.querySelector('.app-main');
    const nav = document.querySelector('.bottom-nav');
    const footer = document.querySelector('.asari-footer');
    const tools = document.getElementById('testTools');
    const header = document.querySelector('.app-header');

    if (nav) nav.hidden = true;
    if (tools) tools.hidden = true;

    if (header) {
      header.innerHTML = '';
      const brand = document.createElement('a');
      brand.className = 'emp-brand';
      brand.href = 'index.html';
      brand.innerHTML =
        '<svg viewBox="0 0 120 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<text x="0" y="34" font-family="Montserrat, sans-serif" font-size="34" font-weight="900" fill="#0B3C78" letter-spacing="1">EMP</text>' +
        '<path d="M2 40 h22 l5 -10 l7 18 l6 -14 l4 6 h74" stroke="#EA580C" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
        '<span class="emp-brand-text"><span class="emp-brand-name">EMP</span>' +
        '<span class="emp-brand-claim">Verificación de Credencial</span></span>';
      header.appendChild(brand);
    }

    if (main) {
      main.innerHTML = '';
      const wrap = el('section', { className: 'carnet-verify-wrap', role: 'main' });

      if (!data) {
        wrap.appendChild(el('div', { className: 'carnet-verify-card carnet-verify-invalid' }, [
          el('div', { className: 'cv-icon', textContent: '❌' }),
          el('h1', { textContent: 'Credencial no válida' }),
          el('p', { textContent: 'El código escaneado no corresponde a un socio registrado en EMP.' }),
          el('p', { className: 'cv-hint', textContent: 'Verificá el QR o consultá en administración.' })
        ]));
      } else {
        const statusClass = 'carnet-verify-' + data.carnetStatus;
        const statusLabel = { activo: 'ACTIVO', vencido: 'VENCIDO', suspendido: 'SUSPENDIDO' }[data.carnetStatus] || data.carnetStatus.toUpperCase();
        const icon = { activo: '✅', vencido: '⏰', suspendido: '⛔' }[data.carnetStatus] || '❔';
        const validUntilTxt = data.carnetValidUntil
          ? new Date(data.carnetValidUntil).toLocaleDateString('es-AR')
          : '—';
        wrap.appendChild(el('div', { className: 'carnet-verify-card ' + statusClass }, [
          el('div', { className: 'cv-icon', textContent: icon }),
          el('h1', { textContent: 'Credencial ' + statusLabel }),
          el('div', { className: 'cv-row' }, [
            el('span', { className: 'cv-k', textContent: 'N° de socio' }),
            el('span', { className: 'cv-v', textContent: data.socioNumber || '—' })
          ]),
          el('div', { className: 'cv-row' }, [
            el('span', { className: 'cv-k', textContent: 'Titular' }),
            el('span', { className: 'cv-v', textContent: data.nombre })
          ]),
          el('div', { className: 'cv-row' }, [
            el('span', { className: 'cv-k', textContent: 'Plan' }),
            el('span', { className: 'cv-v', textContent: data.planLabel })
          ]),
          el('div', { className: 'cv-row' }, [
            el('span', { className: 'cv-k', textContent: 'DNI' }),
            el('span', { className: 'cv-v', textContent: data.dniMasked })
          ]),
          el('div', { className: 'cv-row' }, [
            el('span', { className: 'cv-k', textContent: 'Vigencia' }),
            el('span', { className: 'cv-v', textContent: validUntilTxt })
          ]),
          data.carnetStatus === 'activo' && data.daysToExpire !== null
            ? el('div', { className: 'cv-row' }, [
                el('span', { className: 'cv-k', textContent: 'Días restantes' }),
                el('span', { className: 'cv-v', textContent: String(data.daysToExpire) })
              ])
            : null,
          el('p', { className: 'cv-hint', textContent: 'Datos mínimos de verificación. No se exponen datos clínicos.' })
        ].filter(Boolean)));
      }

      const back = el('a', { href: 'index.html', className: 'btn-primary', textContent: 'Volver al inicio' });
      wrap.appendChild(back);
      main.appendChild(wrap);
    }

    if (footer) footer.hidden = false;
  }

  // ============================================================
  // TABS (5 tabs)
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
        panels.forEach((p) => { p.hidden = p.dataset.tab !== target; });

        if (target === 'beneficios') renderBenefits(activeLocality);
        if (target === 'ficha') { loadProfileIntoForm(); renderExternalServices(); renderPlanSelector(); renderPagos(); renderSupabaseConfig(); }
        if (target === 'credencial') { renderCredencial(); startCredencialTimer(); } else { stopCredencialTimer(); }
        if (target === 'inicio') renderInicio();
      });
    });
  }

  function switchTab(target) {
    const btn = $$('.nav-btn').find(b => b.dataset.target === target);
    if (btn) btn.click();
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
    const dot = $('#connDot'), text = $('#connText'), mode = $('#connMode');
    function update() {
      const online = navigator.onLine;
      if (dot) dot.className = 'dot ' + (online ? 'dot-online' : 'dot-offline');
      if (text) text.textContent = online ? 'Online' : 'Offline';
      if (mode) {
        try {
          const st = Store.getSupabaseStatus();
          mode.textContent = st.connected ? 'SUPABASE LIVE' : 'LOCAL MVP';
          mode.className = 'conn-mode ' + (st.connected ? 'conn-mode-live' : 'conn-mode-local');
        } catch (_) { mode.textContent = 'LOCAL MVP'; }
      }
    }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  function initBaseSelector() {
    const select = $('#baseSelector');
    if (!select) return;
    const ctx = Store.getActiveContext();
    select.value = ctx.activeBaseId;
    updateBasePhone(ctx.base.phone);
    updateBaseSelectorLabel(ctx.base);
    select.addEventListener('change', () => {
      Store.setActiveBase(select.value);
      const newCtx = Store.getActiveContext();
      updateBasePhone(newCtx.base.phone);
      updateBaseSelectorLabel(newCtx.base);
      renderInicio();
    });
  }

  function updateBasePhone(phone) {
    const btn = $('#btnCallBase');
    const btnInicio = $('#btnCallBaseInicio');
    const tel = phone ? String(phone).replace(/[^0-9+]/g, '') : '';
    if (btn && tel) btn.setAttribute('href', 'tel:' + tel);
    if (btnInicio && tel) {
      btnInicio.setAttribute('href', 'tel:' + tel);
      btnInicio.textContent = '📞 ' + phone;
    }
  }

  function updateBaseSelectorLabel(base) {
    const opt = document.querySelector('#baseSelector option[value="' + (base && base.id) + '"]');
    if (opt && base) opt.textContent = base.id === 'LA_COSTA' ? 'La Costa' : 'Dolores';
  }

  // ============================================================
  // PILL SOCIO HABILITADO
  // ============================================================
  function renderPillSocio() {
    const pill = $('#pillSocio');
    if (!pill) return;
    const profile = Store.getActiveProfile();
    if (!profile) {
      pill.textContent = 'Sin socio';
      pill.className = 'pill-socio-habilitado pill-socio-none';
      return;
    }
    const st = Store.calcCarnetStatus(profile);
    if (st === 'activo') {
      pill.textContent = '✓ Socio Habilitado';
      pill.className = 'pill-socio-habilitado pill-socio-ok';
    } else if (st === 'suspendido') {
      pill.textContent = '⛔ Suspendido';
      pill.className = 'pill-socio-habilitado pill-socio-bad';
    } else {
      pill.textContent = '⏰ Vencido';
      pill.className = 'pill-socio-habilitado pill-socio-warn';
    }
  }

  // ============================================================
  // B2B
  // ============================================================
  function initB2BFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const b2bId = params.get('b2b');
    if (!b2bId) return;
    const est = Store.getB2BById(b2bId);
    if (!est) return;
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
    switchTab('sos');
  }

  // ============================================================
  // GPS
  // ============================================================
  function initGPS() {
    const status = $('#gpsStatus');
    const btn = $('#btnGps');
    const fallback = $('#manualFallback');
    const manualInput = $('#manualDir');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!navigator.geolocation) { if (status) status.textContent = 'GPS: no disponible en este dispositivo.'; if (fallback) fallback.hidden = false; return; }
      if (status) status.textContent = 'GPS: obteniendo ubicación…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          if (status) status.textContent = 'GPS: ' + currentLocation.lat.toFixed(5) + ', ' + currentLocation.lng.toFixed(5) + ' (±' + Math.round(currentLocation.accuracy) + 'm)';
          if (fallback) fallback.hidden = true;
        },
        () => { if (status) status.textContent = 'GPS: no se pudo obtener. Usá la dirección manual.'; if (fallback) fallback.hidden = false; },
        { enableHighAccuracy: true, timeout: C.GPS_TIMEOUT_MS, maximumAge: C.GPS_MAX_AGE_MS }
      );
    });
    if (manualInput) manualInput.addEventListener('input', () => { manualAddress = manualInput.value.trim(); });
  }

  // ============================================================
  // SOS (sincronizado entre tab-inicio y tab-sos)
  // ============================================================
  const HOLD_MS = C.SOS_HOLD_MS;
  let holdTimer = null, holdStart = 0, holdRAF = null, sosFired = false;

  function setProgress(pct, btnId) {
    const btn = document.getElementById(btnId || 'btnSOS');
    if (!btn) return;
    btn.style.setProperty('--progress', pct + '%');
  }

  function startHold(e, btnId) {
    if (sosFired) return;
    if (e.type === 'touchstart') e.preventDefault();
    const btn = document.getElementById(btnId || 'btnSOS');
    if (!btn) return;
    btn.classList.add('pressing');
    holdStart = Date.now();
    function tick() {
      const elapsed = Date.now() - holdStart;
      const pct = Math.min(100, (elapsed / HOLD_MS) * 100);
      setProgress(pct, btnId);
      if (elapsed < HOLD_MS) holdRAF = requestAnimationFrame(tick);
    }
    holdRAF = requestAnimationFrame(tick);
    holdTimer = setTimeout(() => { sosFired = true; cancelHold(true, btnId); fireSOS(); }, HOLD_MS);
  }

  function cancelHold(force, btnId) {
    const btn = document.getElementById(btnId || 'btnSOS');
    if (btn) btn.classList.remove('pressing');
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (holdRAF) { cancelAnimationFrame(holdRAF); holdRAF = null; }
    if (!force) setProgress(0, btnId);
  }

  function initSOSButton(btnId) {
    const btn = document.getElementById(btnId || 'btnSOS');
    if (!btn) return;
    btn.addEventListener('touchstart', (e) => startHold(e, btnId), { passive: false });
    btn.addEventListener('mousedown', (e) => startHold(e, btnId));
    btn.addEventListener('touchend', () => cancelHold(false, btnId));
    btn.addEventListener('mouseup', () => cancelHold(false, btnId));
    btn.addEventListener('mouseleave', () => cancelHold(false, btnId));
    btn.addEventListener('touchcancel', () => cancelHold(false, btnId));
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!holdTimer) startHold(e, btnId); } });
    btn.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cancelHold(false, btnId); } });
  }

  function fireSOS() {
    const activeProfile = Store.getActiveProfile();
    const profileDni = activeProfile ? activeProfile.dni : null;
    const incident = Store.createSOSIncident({
      location: currentLocation, manualAddress: manualAddress, profileDni: profileDni,
      b2bEstablishmentId: b2bContext ? b2bContext.id : null,
      notes: b2bContext ? ('Ingreso B2B: ' + b2bContext.name) : ''
    });
    currentIncident = incident;
    renderIncident(incident);
    setProgress(100, 'btnSOS');
    setProgress(100, 'btnSOSInicio');
    setTimeout(() => {
      setProgress(0, 'btnSOS');
      setProgress(0, 'btnSOSInicio');
      sosFired = false;
    }, 400);
  }

  // ============================================================
  // RENDER INCIDENTE + ETA
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
    const panel = $('#incidentPanel'), stateEl = $('#incidentState'), timelineEl = $('#timeline');
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

    // ETA referencial (v6.1)
    const etaBlock = $('#etaBlock'), etaMain = $('#etaMain'), etaSource = $('#etaSource');
    if (etaBlock && etaMain) {
      try {
        const eta = Store.getIncidentEta(incident.id);
        if (eta.hasEta) {
          etaBlock.hidden = false;
          etaMain.textContent = 'Llegada estimada: ' + eta.etaMinutes + ' min';
          etaMain.className = 'eta-main ' + (eta.etaMinutes <= 5 ? 'eta-eta-near' : 'eta-eta-normal');
          if (etaSource) etaSource.textContent = 'Fuente: ' + eta.source;
        } else {
          etaBlock.hidden = true;
        }
      } catch (_) { etaBlock.hidden = true; }
    }

    // Estado en Inicio
    const estadoInicio = $('#incidentEstadoInicio');
    if (estadoInicio) {
      if (incident.status === 'CERRADA' || incident.status === 'CANCELADA') {
        estadoInicio.textContent = 'Sin incidentes activos';
        estadoInicio.className = 'card-sos-estado';
      } else {
        estadoInicio.textContent = info.text;
        estadoInicio.className = 'card-sos-estado card-sos-estado-activo';
      }
    }
  }

  function initIncidentSubscription() {
    const latest = Store.getLatestIncident();
    if (latest) { currentIncident = latest; renderIncident(latest); }
    Store.subscribe((msg) => {
      if (!msg || msg.type !== 'STATE_CHANGED') return;
      const fresh = Store.getLatestIncident();
      if (fresh && currentIncident && fresh.id === currentIncident.id) {
        currentIncident = fresh; renderIncident(fresh);
      }
      renderBenefits(activeLocality);
      renderExternalServices();
      renderPillSocio();
      renderInicio();
      if (!$('#tab-credencial')?.hidden) renderCredencial();
      if (!$('#tab-ficha')?.hidden) { renderPagos(); renderPlanSelector(); }
    });
  }

  // ============================================================
  // INICIO
  // ============================================================
  function renderInicio() {
    const profile = Store.getActiveProfile();
    const ctx = Store.getActiveContext();

    const estadoInicio = $('#incidentEstadoInicio');
    if (estadoInicio) {
      const latest = Store.getLatestIncident();
      if (latest && latest.status !== 'CERRADA' && latest.status !== 'CANCELADA') {
        const info = STATE_LABELS[latest.status] || { text: latest.status };
        estadoInicio.textContent = info.text;
        estadoInicio.className = 'card-sos-estado card-sos-estado-activo';
      } else {
        estadoInicio.textContent = 'Sin incidentes activos';
        estadoInicio.className = 'card-sos-estado';
      }
    }

    updateBasePhone(ctx.base.phone);

    const farm = $('#servicioFarmacia');
    if (farm && profile) {
      const plan = C.PLANS[profile.plan] || {};
      const label = farm.querySelector('.si-label');
      if (label) label.textContent = 'Farmacias Adheridas (' + (plan.pharmacyDiscountLabel || plan.pharmacyDiscount + '%') + ')';
    }
  }

  // ============================================================
  // FICHA
  // ============================================================
  function loadProfileIntoForm() {
    const dniInput = $('#fDni'); if (!dniInput) return;
    const typedDni = dniInput.value.trim();
    const profile = typedDni ? Store.getProfile(typedDni) : Store.getActiveProfile();
    if (!profile) return;
    if (!typedDni) dniInput.value = profile.dni || '';
    if ($('#fNombre')) $('#fNombre').value = profile.nombre || '';
    if ($('#fCuil')) $('#fCuil').value = profile.cuil || '';
    if ($('#fTelefono')) $('#fTelefono').value = profile.telefono || '';
    if ($('#fGrupo')) $('#fGrupo').value = profile.grupoSanguineo || '';
    if ($('#fAlergias')) $('#fAlergias').value = profile.alergias || '';
    if ($('#fPatologias')) $('#fPatologias').value = profile.patologias || '';
    if ($('#fContacto')) $('#fContacto').value = profile.contacto || '';
  }

  function initFichaForm() {
    const form = $('#formFicha'), msg = $('#fichaMsg'); if (!form) return;
    const dniInput = $('#fDni');
    if (dniInput) dniInput.addEventListener('blur', loadProfileIntoForm);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (msg) msg.textContent = '';
      const nombre = $('#fNombre').value.trim();
      const dni = $('#fDni').value.trim();
      const telefono = $('#fTelefono').value.trim();
      const consent = $('#fConsent').checked;
      if (!nombre || !dni || !telefono) { if (msg) { msg.style.color = 'var(--emp-sos)'; msg.textContent = 'Completá nombre, DNI y teléfono.'; } return; }
      if (!consent) { if (msg) { msg.style.color = 'var(--emp-sos)'; msg.textContent = 'Debés aceptar el Consentimiento Informado.'; } return; }
      try {
        const existing = Store.getProfile(dni);
        Store.saveProfile({
          nombre, dni, telefono,
          cuil: $('#fCuil') ? $('#fCuil').value.trim() : '',
          grupoSanguineo: $('#fGrupo').value,
          alergias: $('#fAlergias').value.trim(),
          patologias: $('#fPatologias').value.trim(),
          contacto: $('#fContacto').value.trim(),
          plan: existing ? existing.plan : (Store.getActiveProfile() ? Store.getActiveProfile().plan : C.DEFAULT_PLAN),
          familyGroup: existing ? existing.familyGroup : undefined
        });
        if (msg) { msg.style.color = '#16A34A'; msg.textContent = 'Ficha guardada correctamente.'; }
        renderExternalServices();
        renderPillSocio();
        renderPagos();
        renderInicio();
        renderCredencial();
      } catch (err) {
        if (msg) { msg.style.color = 'var(--emp-sos)'; msg.textContent = 'Error al guardar: ' + err.message; }
      }
    });
  }

  // ============================================================
  // PLAN SELECTOR (tab-ficha)
  // ============================================================
  function renderPlanSelector() {
    const sel = $('#planSelector');
    if (!sel) return;
    const profile = Store.getActiveProfile();
    if (profile && profile.plan) sel.value = profile.plan;
    if (!sel.dataset.bound) {
      sel.dataset.bound = '1';
      sel.addEventListener('change', () => {
        const p = Store.getActiveProfile();
        if (!p) { toast('Guardá tu ficha primero.'); return; }
        try {
          Store.setProfilePlan(p.dni, sel.value, 'socio_app_demo');
          toast('Plan actualizado a ' + (C.PLANS[sel.value] || {}).label);
          renderPillSocio();
          renderInicio();
          renderCredencial();
          renderPagos();
        } catch (err) {
          toast('Error: ' + err.message);
        }
      });
    }
  }

  // ============================================================
  // CREDENCIAL VIRTUAL
  // ============================================================
  function generarCodigo3Digitos() {
    return String(Math.floor(100 + Math.random() * 900));
  }

  function formatoTiempo(seg) {
    const m = Math.floor(seg / 60);
    const s = seg % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function startCredencialTimer() {
    stopCredencialTimer();
    if (!credencialCodigo) {
      credencialCodigo = generarCodigo3Digitos();
      credencialSegundos = CODIGO_DURACION_SEG;
    }
    updateCodigoUI();
    credencialInterval = setInterval(() => {
      credencialSegundos -= 1;
      if (credencialSegundos <= 0) {
        credencialCodigo = generarCodigo3Digitos();
        credencialSegundos = CODIGO_DURACION_SEG;
      }
      updateCodigoUI();
    }, 1000);
  }

  function stopCredencialTimer() {
    if (credencialInterval) { clearInterval(credencialInterval); credencialInterval = null; }
  }

  function updateCodigoUI() {
    const cod = $('#csCodigo');
    const ren = $('#csRenueva');
    if (cod && credencialCodigo) {
      cod.textContent = credencialCodigo.split('').join(' ');
    }
    if (ren) ren.textContent = formatoTiempo(credencialSegundos);
  }

  function getActiveFamilyMember() {
    const profile = Store.getActiveProfile();
    if (!profile) return null;
    const family = Array.isArray(profile.familyGroup) && profile.familyGroup.length
      ? profile.familyGroup
      : [{ id: 'self', nombre: profile.nombre, dni: profile.dni, cuil: profile.cuil, orden: profile.orden || '00', filial: profile.filial || profile.baseId }];
    if (activeFamilyIndex >= family.length) activeFamilyIndex = 0;
    return family[activeFamilyIndex];
  }

  // Payload corto para el QR: solo el token. El escáner lo resuelve
  // contra el mismo origen (socio.html?carnet=<token>).
  // Esto evita el límite de 76 bytes de qr.js v4.
  function buildCarnetQrPayload(profile) {
    return '?carnet=' + encodeURIComponent(profile.carnetToken || '');
  }

  // URL completa para compartir por link / WhatsApp.
  function buildCarnetUrl(profile) {
    const origin = window.location.origin + window.location.pathname;
    return origin + '?carnet=' + encodeURIComponent(profile.carnetToken || '');
  }

  function renderCredencial() {
    const profile = Store.getActiveProfile();
    const tarjeta = $('#credencialTarjeta');
    if (!profile) {
      if (tarjeta) tarjeta.style.display = 'none';
      const nombre = $('#ctNombre');
      if (nombre) nombre.textContent = 'Sin socio activo';
      return;
    }
    if (tarjeta) tarjeta.style.display = '';

    // Regeneración defensiva: si el perfil migrado no tiene carnetToken,
    // forzamos un saveProfile para que se genere uno nuevo.
    if (!profile.carnetToken) {
      try {
        Store.saveProfile({
          dni: profile.dni,
          nombre: profile.nombre || '—',
          telefono: profile.telefono || '—'
        });
        const fresh = Store.getActiveProfile();
        if (fresh && fresh.carnetToken) {
          return renderCredencial();
        }
      } catch (_) {}
    }

    const plan = C.PLANS[profile.plan] || { label: profile.plan };
    if ($('#ctPlanLabel')) $('#ctPlanLabel').textContent = 'PLAN ' + (plan.label || profile.plan).toUpperCase();

    const member = getActiveFamilyMember();
    if ($('#ctNombre')) $('#ctNombre').textContent = (member && member.nombre) || profile.nombre || '—';
    if ($('#ctCuilDni')) {
      const cuil = (member && member.cuil) || profile.cuil || '—';
      const dni = (member && member.dni) || profile.dni || '—';
      $('#ctCuilDni').textContent = cuil + ' / ' + dni;
    }
    if ($('#ctSocio')) $('#ctSocio').textContent = profile.socioNumber || '—';
    if ($('#ctOrden')) $('#ctOrden').textContent = (member && member.orden) || profile.orden || '00';
    if ($('#ctSede')) $('#ctSede').textContent = ((member && member.filial) || profile.filial || profile.baseId || 'DOLORES').toUpperCase();

    // QR: payload corto + fallback visible con el token como texto.
    const qrWrap = $('#qrSvgWrap');
    if (qrWrap) {
      qrWrap.innerHTML = '';
      if (QR && typeof QR.toSvg === 'function' && profile.carnetToken) {
        try {
          const svg = QR.toSvg(buildCarnetQrPayload(profile), 220);
          qrWrap.innerHTML = svg;
        } catch (e) {
          const fallback = document.createElement('div');
          fallback.className = 'qr-fallback';
          fallback.innerHTML = '<div style="font-weight:700;color:#7A1C32;margin-bottom:6px;">Escaneá el código o dictá este ID</div>' +
            '<div style="font-family:monospace;font-size:0.85rem;word-break:break-all;background:#F4F8FD;padding:8px;border-radius:8px;">' +
            (profile.socioNumber || '—') + '<br>' + (profile.carnetToken || '—') + '</div>';
          qrWrap.appendChild(fallback);
        }
      } else {
        const fallback = document.createElement('div');
        fallback.className = 'qr-fallback';
        fallback.innerHTML = '<div style="font-weight:700;color:#7A1C32;margin-bottom:6px;">QR no disponible</div>' +
          '<div style="font-family:monospace;font-size:0.8rem;background:#F4F8FD;padding:8px;border-radius:8px;">' +
          (profile.socioNumber || '—') + '</div>';
        qrWrap.appendChild(fallback);
      }
    }

    // Grupo familiar en píldoras
    const pildorasWrap = $('#gfPildoras');
    if (pildorasWrap) {
      pildorasWrap.innerHTML = '';
      const family = Array.isArray(profile.familyGroup) && profile.familyGroup.length
        ? profile.familyGroup
        : [{ id: 'self', nombre: profile.nombre, dni: profile.dni }];
      family.forEach((m, idx) => {
        const activa = idx === activeFamilyIndex;
        const btn = el('button', {
          type: 'button',
          className: 'gf-pildora' + (activa ? ' gf-pildora-activa' : ''),
          onclick: () => { activeFamilyIndex = idx; renderCredencial(); }
        }, [
          el('span', { className: 'gf-nombre', textContent: m.nombre || '—' }),
          el('span', { className: 'gf-dni', textContent: 'DNI ' + (m.dni || '—') })
        ]);
        pildorasWrap.appendChild(btn);
      });
    }

    updateCodigoUI();
  }

  function initShareCredencial() {
    const btn = $('#btnShareCredencial');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const profile = Store.getActiveProfile();
      if (!profile || !profile.carnetToken) { toast('Sin credencial para compartir.'); return; }
      const url = buildCarnetUrl(profile);
      if (navigator.share) {
        navigator.share({ title: 'Credencial EMP', url }).catch(() => {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => toast('Enlace copiado'), () => toast('No se pudo copiar'));
      } else {
        toast('Enlace: ' + url);
      }
    });
  }

  // ============================================================
  // SERVICIOS TERCERIZADOS
  // ============================================================
  function renderExternalServices() {
    const container = $('#externalServicesBlock');
    if (!container) return;
    container.innerHTML = '';

    const cfg = Store.getExternalServicesConfig();
    const profile = Store.getActiveProfile();
    const plan = profile ? (C.PLANS[profile.plan] || C.PLANS[C.DEFAULT_PLAN]) : C.PLANS[C.DEFAULT_PLAN];
    const labels = C.EXTERNAL_SERVICES_LABELS || {};
    const disclaimer = C.EXTERNAL_SERVICES_DISCLAIMER || '';

    container.appendChild(el('h3', { textContent: 'Servicios Tercerizados' }));

    const rows = [
      { key: 'medicoVirtual', url: cfg.medicoVirtualUrl, label: labels.medicoVirtual, allowed: !!plan.hasVirtualDoc },
      { key: 'seguroViajero', url: cfg.seguroViajeroUrl, label: labels.seguroViajero, allowed: !!plan.hasTravel }
    ];

    rows.forEach((r) => {
      const row = el('div', { className: 'ext-row' }, [el('span', { className: 'ext-label', textContent: r.label })]);
      if (!r.allowed) {
        row.appendChild(el('span', { className: 'ext-pending', textContent: 'No incluido en tu plan ' + plan.label }));
      } else if (r.url) {
        row.appendChild(el('a', { className: 'ext-link', href: r.url, target: '_blank', rel: 'noopener noreferrer', textContent: 'Abrir ↗' }));
      } else {
        row.appendChild(el('span', { className: 'ext-pending', textContent: '— Servicio no configurado —' }));
      }
      container.appendChild(row);
    });

    if (disclaimer) container.appendChild(el('div', { className: 'ext-disclaimer', textContent: disclaimer }));
    container.hidden = false;
  }

  // ============================================================
  // BENEFICIOS
  // ============================================================
  function renderBenefits(locality) {
    const list = $('#benefitsList'), empty = $('#benefitsEmpty'); if (!list) return;
    list.innerHTML = '';
    const items = Store.getVisibleBenefits(locality);
    const hint = $('#planBenefitsHint');
    const profile = Store.getActiveProfile();
    if (hint) {
      hint.innerHTML = '';
      if (profile && profile.plan) {
        const plan = C.PLANS[profile.plan] || { label: profile.plan, pharmacyDiscount: 0 };
        hint.textContent = 'Tu plan ' + plan.label + ' incluye ' + (plan.pharmacyDiscountLabel || (plan.pharmacyDiscount || 0) + '%') + ' de descuento en farmacia.';
        hint.hidden = false;
      } else { hint.hidden = true; }
    }
    if (!items.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    items.forEach((b) => {
      list.appendChild(el('li', { className: 'benefit-card' }, [
        el('h3', { textContent: b.name }),
        el('p', { textContent: 'Categoría: ' + (b.category || '—') + ' · Localidad: ' + b.locality }),
        el('p', { className: 'benefit-desc', textContent: b.benefitDetail || '' }),
        el('p', { textContent: 'Convenio: ' + b.agreementRef + (b.validUntil ? ' · Vigencia: ' + b.validUntil : '') })
      ]));
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
  // PAGOS (dentro de tab-ficha)
  // ============================================================
  function renderPagos() {
    const container = $('#pagosContainer'); if (!container) return;
    container.innerHTML = '';
    const profile = Store.getActiveProfile();
    const cfg = Store.getPaymentConfig();

    if (!profile) {
      container.appendChild(el('div', { className: 'pagos-empty' }, [
        el('p', { textContent: 'Completá tu ficha para ver el estado de tu plan y tus pagos.' })
      ]));
      return;
    }

    const plan = C.PLANS[profile.plan] || { label: profile.plan };
    const meta = (function () {
      const st = Store.calcCarnetStatus(profile);
      const days = Store.daysToExpire(profile);
      if (st === 'suspendido') return { st, label: 'SUSPENDIDO', cls: 'carnet-status-suspendido', icon: '⛔' };
      if (st === 'vencido') return { st, label: 'VENCIDO', cls: 'carnet-status-vencido', icon: '⏰' };
      if (days !== null && days <= C.CARNET_WARN_DAYS) return { st: 'por_vencer', label: 'POR VENCER', cls: 'carnet-status-por_vencer', icon: '⚠️' };
      return { st: 'activo', label: 'ACTIVO', cls: 'carnet-status-activo', icon: '✅' };
    })();
    const validTxt = profile.carnetValidUntil ? new Date(profile.carnetValidUntil).toLocaleDateString('es-AR') : '—';
    const days = Store.daysToExpire(profile);
    const cuota = (cfg.cuotas && cfg.cuotas[profile.plan]) || '';

    container.appendChild(el('div', { className: 'pagos-card' }, [
      el('h2', { textContent: 'Estado de tu Plan' }),
      el('div', { className: 'pagos-row' }, [
        el('span', { className: 'pk', textContent: 'Plan actual' }),
        el('span', { className: 'pv', textContent: plan.label })
      ]),
      el('div', { className: 'pagos-row' }, [
        el('span', { className: 'pk', textContent: 'N° de socio' }),
        el('span', { className: 'pv', textContent: profile.socioNumber || '—' })
      ]),
      el('div', { className: 'pagos-row' }, [
        el('span', { className: 'pk', textContent: 'Estado de la credencial' }),
        el('span', { className: 'pv' }, [el('span', { className: 'carnet-status-pill ' + meta.cls, textContent: meta.icon + ' ' + meta.label })])
      ]),
      el('div', { className: 'pagos-row' }, [
        el('span', { className: 'pk', textContent: 'Vigencia' }),
        el('span', { className: 'pv', textContent: validTxt })
      ]),
      cuota ? el('div', { className: 'pagos-row' }, [
        el('span', { className: 'pk', textContent: 'Cuota mensual' }),
        el('span', { className: 'pv', textContent: '$ ' + cuota })
      ]) : null,
      (meta.st === 'por_vencer' && days !== null)
        ? el('div', { className: 'pagos-warn', textContent: '⚠️ Tu credencial vence en ' + days + ' días. Renová tu cuota para mantenerla activa.' })
        : null,
      (meta.st === 'vencido')
        ? el('div', { className: 'pagos-warn', textContent: '⏰ Tu credencial está vencida. Contactá a administración para renovar.' })
        : null
    ].filter(Boolean)));

    const payCard = el('div', { className: 'pagos-card' }, [el('h2', { textContent: 'Pagar cuota' })]);
    if (cfg.mercadoPagoEnabled && cfg.mercadoPagoPublicKey) {
      payCard.appendChild(el('p', { className: 'pagos-note', textContent: 'Pago online habilitado vía Mercado Pago.' }));
      payCard.appendChild(el('button', {
        type: 'button', className: 'btn-primary',
        textContent: '💳 Pagar con Mercado Pago',
        onclick: () => toast('Integración con Mercado Pago pendiente de conexión del SDK en esta demo.')
      }));
    } else if (cfg.mercadoPagoEnabled && !cfg.mercadoPagoPublicKey) {
      payCard.appendChild(el('p', { className: 'pagos-note', textContent: 'Pago online habilitado pero falta configurar la Public Key en el Panel Admin.' }));
    } else {
      payCard.appendChild(el('p', { className: 'pagos-note', textContent: 'Pagos online no habilitados todavía.' }));
      payCard.appendChild(el('p', { className: 'pagos-note', textContent: 'Para abonar tu cuota, contactá a administración:' }));
      payCard.appendChild(el('div', { className: 'pagos-contact' }, [
        el('a', { href: 'tel:2245444602', textContent: '📞 Dolores: 2245-444602' }),
        el('a', { href: 'tel:2246526777', textContent: '📞 La Costa: 2246-526777' }),
        el('a', { href: 'https://wa.me/5492245406323', target: '_blank', rel: 'noopener', textContent: '💬 WhatsApp: 2245-406323' })
      ]));
    }
    container.appendChild(payCard);

    const benefitsCard = el('div', { className: 'pagos-card' }, [el('h2', { textContent: 'Prestaciones incluidas en tu plan' })]);
    const feats = [
      { ok: true, label: 'Emergencias / Urgencias / Enfermería / Traslados locales' },
      { ok: true, label: 'Cobertura Costa Atlántica (roaming Dolores ↔ La Costa)' },
      { ok: true, label: 'Descuento farmacia ' + (plan.pharmacyDiscountLabel || plan.pharmacyDiscount + '%') },
      { ok: !!plan.hasRemis, label: 'Remis en ambulancia (discapacidad)' },
      { ok: !!plan.hasApp, label: 'Acceso completo a la APP' },
      { ok: !!plan.hasTravel || !!plan.hasTravelerAssistance, label: 'Seguro al viajero' },
      { ok: !!plan.hasVirtualDoc || !!plan.hasTelemedicine, label: 'Médico virtual (5 especialistas, 24/365)' },
      { ok: !!plan.hasPulsera || !!plan.hasSosBracelet, label: 'Pulsera SOS con geolocalización' },
      { ok: !!plan.hasHomeButton, label: 'Botón fijo SOS en domicilio' }
    ];
    feats.forEach((f) => {
      benefitsCard.appendChild(el('div', { className: 'pagos-feat ' + (f.ok ? 'ok' : 'no') }, [
        el('span', { className: 'pf-icon', textContent: f.ok ? '✅' : '❌' }),
        el('span', { className: 'pf-label', textContent: f.label })
      ]));
    });
    container.appendChild(benefitsCard);
  }

  // ============================================================
  // SUPABASE CONFIG UI
  // ============================================================
  function renderSupabaseConfig() {
    const urlInput = $('#sbUrl'), keyInput = $('#sbKey'), msg = $('#sbMsg');
    if (!urlInput || !keyInput) return;
    try {
      const u = localStorage.getItem('e360_supabase_url') || '';
      const k = localStorage.getItem('e360_supabase_anon_key') || '';
      if (!urlInput.value) urlInput.value = u;
      if (!keyInput.value) keyInput.value = k;
    } catch (_) {}
    if (msg) {
      const st = Store.getSupabaseStatus();
      msg.textContent = st.connected ? ('Conectado a ' + st.url + ' (' + st.mode + ')') : ('Modo ' + st.mode + (st.lastError ? ' — ' + st.lastError : ''));
      msg.style.color = st.connected ? '#16A34A' : '#64748B';
    }
  }

  function initSupabaseConfig() {
    const btn = $('#btnSaveSb');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const url = ($('#sbUrl') || {}).value || '';
      const key = ($('#sbKey') || {}).value || '';
      const msg = $('#sbMsg');
      try {
        const st = Store.configureSupabaseConnection(url, key);
        if (msg) {
          msg.textContent = st.connected ? ('Conectado (' + st.mode + ')') : ('Modo ' + st.mode + (st.lastError ? ' — ' + st.lastError : ''));
          msg.style.color = st.connected ? '#16A34A' : '#64748B';
        }
        const mode = $('#connMode');
        if (mode) {
          mode.textContent = st.connected ? 'SUPABASE LIVE' : 'LOCAL MVP';
          mode.className = 'conn-mode ' + (st.connected ? 'conn-mode-live' : 'conn-mode-local');
        }
        toast('Conexión guardada.');
      } catch (err) {
        if (msg) { msg.textContent = 'Error: ' + err.message; msg.style.color = 'var(--emp-sos)'; }
      }
    });
  }

  // ============================================================
  // TEST TOOLS
  // ============================================================
  function initTestTools() {
    const tools = $('#testTools'), toggle = $('#btnTestToggle'), panel = $('#testPanel');
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
        if (!currentIncident) { alert('Primero generá un incidente SOS.'); return; }
        const map = { recibir:'ACEPTADA_POR_CENTRAL', clasificar:'CLASIFICADA', asignar:'MOVIL_ASIGNADO', camino:'EN_CAMINO' };
        const next = map[btn.dataset.sim]; if (!next) return;
        try {
          const updated = Store.transitionIncidentStatus(currentIncident.id, next);
          currentIncident = updated; renderIncident(updated);
        } catch (err) { alert('Transición no permitida: ' + err.message); }
      });
    });
  }

  function initServiceWorker() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ============================================================
  // TOAST
  // ============================================================
  let toastTimer = null;
  function toast(text) {
    let t = document.getElementById('e360Toast');
    if (!t) { t = document.createElement('div'); t.id = 'e360Toast'; document.body.appendChild(t); }
    t.textContent = text;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ============================================================
  // ACCESOS RÁPIDOS (grilla 2x2)
  // ============================================================
  function initAccesosRapidos() {
    $$('.acceso-rapido').forEach((btn) => {
      btn.addEventListener('click', () => {
        const goto = btn.dataset.goto;
        if (goto) switchTab(goto);
      });
    });
    $$('.servicio-item').forEach((li) => {
      li.addEventListener('click', () => {
        if (li.id === 'servicioTeleconsulta' || li.id === 'servicioPulsera') {
          switchTab('ficha');
        } else if (li.id === 'servicioFarmacia') {
          switchTab('beneficios');
        } else {
          toast('Próximamente.');
        }
      });
    });
  }

  // ============================================================
  // BOOT
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => {
    if (isCarnetMode()) { renderCarnetVerifyMode(); return; }

    initModoMayor();
    initBanner();
    initConnection();
    initBaseSelector();
    initTabs();
    initGPS();
    initSOSButton('btnSOS');
    initSOSButton('btnSOSInicio');
    initIncidentSubscription();
    initFichaForm();
    initBenefitsFilter();
    initTestTools();
    initServiceWorker();
    initB2BFromQuery();
    initAccesosRapidos();
    initShareCredencial();
    initSupabaseConfig();

    renderExternalServices();
    renderPillSocio();
    renderInicio();
    renderCredencial();
    renderPlanSelector();
    renderPagos();
    renderSupabaseConfig();

    const activeProfile = Store.getActiveProfile();
    if (activeProfile) {
      const dniInput = $('#fDni');
      if (dniInput && !dniInput.value) dniInput.value = activeProfile.dni || '';
      loadProfileIntoForm();
    }
  });
})();
