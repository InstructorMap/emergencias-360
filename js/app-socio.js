/* ============================================================
   app-socio.js — Controlador de index.html
   SOS, GPS, ficha, beneficios, B2B, servicios tercerizados,
   carnet digital (QR + N° socio), tab Pagos y verificación ?carnet=.
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  const C = window.E360Config;
  const QR = window.E360QR;
  if (!Store) { console.error('[app-socio] E360Store no disponible.'); return; }

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
  // VERIFICACIÓN PÚBLICA ?carnet=TOKEN
  // ============================================================
  function isCarnetMode() {
    return new URLSearchParams(window.location.search).has('carnet');
  }

  function renderCarnetVerifyMode() {
    const token = new URLSearchParams(window.location.search).get('carnet');
    const data = token ? Store.getProfileByCarnetToken(token) : null;

    // Ocultar todo lo normal, mostrar panel de verificación
    document.body.classList.add('carnet-verify-mode');
    const main = document.querySelector('.app-main');
    const nav = document.querySelector('.bottom-nav');
    const footer = document.querySelector('.asari-footer');
    const tools = document.getElementById('testTools');
    const header = document.querySelector('.app-header');

    if (nav) nav.hidden = true;
    if (tools) tools.hidden = true;

    // Limpiar header y dejar solo isologo + título
    if (header) {
      header.innerHTML = '';
      const brand = document.createElement('a');
      brand.className = 'emp-brand';
      brand.href = 'index.html';
      brand.innerHTML =
        '<svg viewBox="0 0 120 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<text x="0" y="34" font-family="Montserrat, sans-serif" font-size="34" font-weight="900" fill="#3D5CA4" letter-spacing="1">EMP</text>' +
        '<path d="M2 40 h22 l5 -10 l7 18 l6 -14 l4 6 h74" stroke="#FB0100" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
        '<span class="emp-brand-text"><span class="emp-brand-name">EMP</span>' +
        '<span class="emp-brand-claim">Verificación de Carnet Digital</span></span>';
      header.appendChild(brand);
    }

    if (main) {
      main.innerHTML = '';
      const wrap = el('section', { className: 'carnet-verify-wrap', role: 'main' });

      if (!data) {
        wrap.appendChild(el('div', { className: 'carnet-verify-card carnet-verify-invalid' }, [
          el('div', { className: 'cv-icon', textContent: '❌' }),
          el('h1', { textContent: 'Carnet no válido' }),
          el('p', { textContent: 'El código escaneado no corresponde a un socio registrado en Emergencias 360.' }),
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
          el('h1', { textContent: 'Carnet ' + statusLabel }),
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
  // TABS (incluye 4to tab Pagos)
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
        if (target === 'ficha') { loadProfileIntoForm(); renderExternalServices(); renderCarnetBlock(); }
        if (target === 'pagos') renderPagos();
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
    const dot = $('#connDot'), text = $('#connText');
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
  // HEADER: BADGE DE PLAN
  // ============================================================
  function renderPlanBadge() {
    const slot = $('#planBadgeSlot');
    if (!slot) return;
    slot.innerHTML = '';
    const profile = Store.getActiveProfile();
    if (!profile || !profile.plan) {
      slot.appendChild(el('span', { className: 'plan-badge plan-badge-none', textContent: 'Sin plan' }));
      return;
    }
    const plan = C.PLANS[profile.plan] || { label: profile.plan };
    slot.appendChild(el('span', {
      className: 'plan-badge plan-badge-' + profile.plan.toLowerCase(),
      textContent: 'Plan ' + plan.label
    }));
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
      if (!navigator.geolocation) { status.textContent = 'GPS: no disponible en este dispositivo.'; fallback.hidden = false; return; }
      status.textContent = 'GPS: obteniendo ubicación…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          status.textContent = 'GPS: ' + currentLocation.lat.toFixed(5) + ', ' + currentLocation.lng.toFixed(5) + ' (±' + Math.round(currentLocation.accuracy) + 'm)';
          fallback.hidden = true;
        },
        (err) => { status.textContent = 'GPS: no se pudo obtener. Usá la dirección manual.'; fallback.hidden = false; },
        { enableHighAccuracy: true, timeout: C.GPS_TIMEOUT_MS, maximumAge: C.GPS_MAX_AGE_MS }
      );
    });
    manualInput.addEventListener('input', () => { manualAddress = manualInput.value.trim(); });
  }

  // ============================================================
  // SOS
  // ============================================================
  const HOLD_MS = C.SOS_HOLD_MS;
  let holdTimer = null, holdStart = 0, holdRAF = null, sosFired = false;

  function setProgress(pct) {
    const btn = $('#btnSOS'); if (!btn) return;
    btn.style.setProperty('--progress', pct + '%');
  }

  function startHold(e) {
    if (sosFired) return;
    if (e.type === 'touchstart') e.preventDefault();
    const btn = $('#btnSOS'); btn.classList.add('pressing');
    holdStart = Date.now();
    function tick() {
      const elapsed = Date.now() - holdStart;
      const pct = Math.min(100, (elapsed / HOLD_MS) * 100);
      setProgress(pct);
      if (elapsed < HOLD_MS) holdRAF = requestAnimationFrame(tick);
    }
    holdRAF = requestAnimationFrame(tick);
    holdTimer = setTimeout(() => { sosFired = true; cancelHold(true); fireSOS(); }, HOLD_MS);
  }

  function cancelHold(force) {
    const btn = $('#btnSOS'); if (btn) btn.classList.remove('pressing');
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (holdRAF) { cancelAnimationFrame(holdRAF); holdRAF = null; }
    if (!force) setProgress(0);
  }

  function initSOSButton() {
    const btn = $('#btnSOS'); if (!btn) return;
    btn.addEventListener('touchstart', startHold, { passive: false });
    btn.addEventListener('mousedown', startHold);
    btn.addEventListener('touchend', () => cancelHold(false));
    btn.addEventListener('mouseup', () => cancelHold(false));
    btn.addEventListener('mouseleave', () => cancelHold(false));
    btn.addEventListener('touchcancel', () => cancelHold(false));
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!holdTimer) startHold(e); } });
    btn.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cancelHold(false); } });
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
    setProgress(100);
    setTimeout(() => { setProgress(0); sosFired = false; }, 400);
  }

  // ============================================================
  // RENDER INCIDENTE
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
      renderPlanBadge();
      renderCarnetBlock();
      if (!$('#tab-pagos')?.hidden) renderPagos();
    });
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
    $('#fNombre').value = profile.nombre || '';
    $('#fTelefono').value = profile.telefono || '';
    $('#fGrupo').value = profile.grupoSanguineo || '';
    $('#fAlergias').value = profile.alergias || '';
    $('#fPatologias').value = profile.patologias || '';
    $('#fContacto').value = profile.contacto || '';
  }

  function initFichaForm() {
    const form = $('#formFicha'), msg = $('#fichaMsg'); if (!form) return;
    const dniInput = $('#fDni');
    dniInput.addEventListener('blur', loadProfileIntoForm);
    form.addEventListener('submit', (e) => {
      e.preventDefault(); msg.textContent = '';
      const nombre = $('#fNombre').value.trim();
      const dni = $('#fDni').value.trim();
      const telefono = $('#fTelefono').value.trim();
      const consent = $('#fConsent').checked;
      if (!nombre || !dni || !telefono) { msg.style.color = 'var(--color-red)'; msg.textContent = 'Completá nombre, DNI y teléfono.'; return; }
      if (!consent) { msg.style.color = 'var(--color-red)'; msg.textContent = 'Debés aceptar el Consentimiento Informado.'; return; }
      try {
        Store.saveProfile({
          nombre, dni, telefono,
          grupoSanguineo: $('#fGrupo').value,
          alergias: $('#fAlergias').value.trim(),
          patologias: $('#fPatologias').value.trim(),
          contacto: $('#fContacto').value.trim()
        });
        msg.style.color = 'var(--color-green)';
        msg.textContent = 'Ficha guardada correctamente.';
        renderExternalServices();
        renderCarnetBlock();
        renderPlanBadge();
        renderPagos();
      } catch (err) {
        msg.style.color = 'var(--color-red)';
        msg.textContent = 'Error al guardar: ' + err.message;
      }
    });
  }

  // ============================================================
  // CARNET DIGITAL
  // ============================================================
  function carnetStatusMeta(profile) {
    const st = Store.calcCarnetStatus(profile);
    const days = Store.daysToExpire(profile);
    if (st === 'suspendido') return { st: 'suspendido', label: 'SUSPENDIDO', cls: 'carnet-status-suspendido', icon: '⛔' };
    if (st === 'vencido') return { st: 'vencido', label: 'VENCIDO', cls: 'carnet-status-vencido', icon: '⏰' };
    if (days !== null && days <= C.CARNET_WARN_DAYS) return { st: 'por_vencer', label: 'POR VENCER', cls: 'carnet-status-por_vencer', icon: '⚠️' };
    return { st: 'activo', label: 'ACTIVO', cls: 'carnet-status-activo', icon: '✅' };
  }

  function buildCarnetUrl(profile) {
    const origin = window.location.origin + window.location.pathname;
    return origin + '?carnet=' + encodeURIComponent(profile.carnetToken);
  }

  function renderCarnetBlock() {
    const container = $('#carnetBlock');
    if (!container) return;
    container.innerHTML = '';
    const profile = Store.getActiveProfile();
    if (!profile) {
      container.appendChild(el('div', { className: 'carnet-empty', textContent: 'Guardá tu ficha para generar tu carnet digital.' }));
      container.hidden = false;
      return;
    }
    const meta = carnetStatusMeta(profile);
    const validTxt = profile.carnetValidUntil ? new Date(profile.carnetValidUntil).toLocaleDateString('es-AR') : '—';
    const plan = C.PLANS[profile.plan] || { label: profile.plan };

    container.appendChild(el('div', { className: 'carnet-card ' + meta.cls }, [
      el('div', { className: 'carnet-header' }, [
        el('div', { className: 'carnet-brand' }, [
          el('span', { className: 'carnet-emp', textContent: 'EMP' }),
          el('span', { className: 'carnet-sub', textContent: 'Emergencias Médicas Privadas' })
        ]),
        el('div', { className: 'carnet-status-pill ' + meta.cls }, [
          el('span', { textContent: meta.icon + ' ' }),
          el('span', { textContent: meta.label })
        ])
      ]),
      el('div', { className: 'carnet-body' }, [
        el('div', { className: 'carnet-qr' }, [
          (function () {
            try {
              const div = document.createElement('div');
              div.innerHTML = QR.toSvg(buildCarnetUrl(profile), 180);
              return div.firstChild;
            } catch (e) {
              return el('div', { className: 'carnet-qr-fallback', textContent: 'QR no disponible' });
            }
          })()
        ]),
        el('div', { className: 'carnet-data' }, [
          el('div', { className: 'carnet-row' }, [
            el('span', { className: 'ck', textContent: 'N° de socio' }),
            el('span', { className: 'cv', textContent: profile.socioNumber || '—' })
          ]),
          el('div', { className: 'carnet-row' }, [
            el('span', { className: 'ck', textContent: 'Titular' }),
            el('span', { className: 'cv', textContent: profile.nombre || '—' })
          ]),
          el('div', { className: 'carnet-row' }, [
            el('span', { className: 'ck', textContent: 'DNI' }),
            el('span', { className: 'cv', textContent: profile.dni || '—' })
          ]),
          el('div', { className: 'carnet-row' }, [
            el('span', { className: 'ck', textContent: 'Plan' }),
            el('span', { className: 'cv cv-plan', textContent: plan.label })
          ]),
          el('div', { className: 'carnet-row' }, [
            el('span', { className: 'ck', textContent: 'Vigencia' }),
            el('span', { className: 'cv', textContent: validTxt })
          ])
        ])
      ]),
      el('div', { className: 'carnet-actions' }, [
        el('button', {
          type: 'button', className: 'btn-secondary',
          textContent: '📋 Copiar N° de socio',
          onclick: () => copySocioNumber(profile.socioNumber)
        }),
        el('button', {
          type: 'button', className: 'btn-secondary',
          textContent: '⬇ Descargar carnet',
          onclick: () => downloadCarnet(profile)
        }),
        el('button', {
          type: 'button', className: 'btn-secondary',
          textContent: '🔍 Verificar (abrir link)',
          onclick: () => window.open(buildCarnetUrl(profile), '_blank', 'noopener')
        })
      ]),
      el('p', { className: 'carnet-legal', textContent: 'Carnet digital personal. El QR abre la verificación pública del estado del carnet. No expone datos clínicos.' })
    ]));
    container.hidden = false;
  }

  function copySocioNumber(num) {
    if (!num) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(num).then(() => toast('N° de socio copiado: ' + num), () => toast('No se pudo copiar.'));
    } else {
      toast('Tu N° de socio es: ' + num);
    }
  }

  function downloadCarnet(profile) {
    try {
      const c = document.createElement('canvas');
      const W = 720, H = 420;
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#F8FAFC'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#3D5CA4'; ctx.fillRect(0, 0, W, 90);
      ctx.fillStyle = '#fff';
      ctx.font = '900 44px Montserrat, sans-serif';
      ctx.fillText('EMP', 32, 62);
      ctx.font = '500 18px Poppins, sans-serif';
      ctx.fillText('Emergencias Médicas Privadas', 140, 55);
      ctx.fillStyle = '#FB0100';
      ctx.fillRect(0, 90, W, 6);
      // QR
      const qrCanvas = document.createElement('canvas');
      QR.toCanvas(qrCanvas, buildCarnetUrl(profile), 240);
      ctx.drawImage(qrCanvas, 32, 130, 240, 240);
      // Datos
      const meta = carnetStatusMeta(profile);
      const plan = C.PLANS[profile.plan] || { label: profile.plan };
      const validTxt = profile.carnetValidUntil ? new Date(profile.carnetValidUntil).toLocaleDateString('es-AR') : '—';
      ctx.fillStyle = '#0F172A';
      ctx.font = '800 26px Poppins, sans-serif';
      ctx.fillText(profile.nombre || '—', 300, 165);
      ctx.font = '600 16px Poppins, sans-serif';
      ctx.fillStyle = '#4A5568';
      ctx.fillText('N° socio: ' + (profile.socioNumber || '—'), 300, 200);
      ctx.fillText('DNI: ' + (profile.dni || '—'), 300, 228);
      ctx.fillText('Plan: ' + plan.label, 300, 256);
      ctx.fillText('Vigencia: ' + validTxt, 300, 284);
      ctx.fillStyle = meta.st === 'activo' ? '#16A34A' : meta.st === 'por_vencer' ? '#D97706' : '#DC2626';
      ctx.font = '800 18px Poppins, sans-serif';
      ctx.fillText(meta.label, 300, 320);
      ctx.fillStyle = '#64748B';
      ctx.font = '400 12px Poppins, sans-serif';
      ctx.fillText('Tecnología provista por ASARI S.A.S. — Esta app NO sustituye al 107 / 911 / Bomberos.', 32, 398);

      const url = c.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'carnet_EMP_' + (profile.socioNumber || 'socio') + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast('Carnet descargado.');
    } catch (err) {
      toast('Error al descargar: ' + err.message);
    }
  }

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
  // SERVICIOS TERCERIZADOS (gateados por plan)
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
        hint.textContent = 'Tu plan ' + plan.label + ' incluye ' + (plan.pharmacyDiscount || 0) + '% de descuento en farmacia.';
        hint.hidden = false;
      } else { hint.hidden = true; }
    }
    if (!items.length) { empty.hidden = false; return; }
    empty.hidden = true;
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
  // TAB PAGOS
  // ============================================================
  function renderPagos() {
    const container = $('#pagosContainer'); if (!container) return;
    container.innerHTML = '';
    const profile = Store.getActiveProfile();
    const cfg = Store.getPaymentConfig();

    if (!profile) {
      container.appendChild(el('div', { className: 'pagos-empty' }, [
        el('p', { textContent: 'Completá tu ficha para ver el estado de tu plan y tus pagos.' }),
        el('button', { type: 'button', className: 'btn-primary', textContent: 'Ir a Mi Ficha', onclick: () => switchTab('ficha') })
      ]));
      return;
    }

    const plan = C.PLANS[profile.plan] || { label: profile.plan };
    const meta = carnetStatusMeta(profile);
    const validTxt = profile.carnetValidUntil ? new Date(profile.carnetValidUntil).toLocaleDateString('es-AR') : '—';
    const days = Store.daysToExpire(profile);
    const cuota = (cfg.cuotas && cfg.cuotas[profile.plan]) || '';

    // Estado del plan
    const card = el('div', { className: 'pagos-card' }, [
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
        el('span', { className: 'pk', textContent: 'Estado del carnet' }),
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
        ? el('div', { className: 'pagos-warn', textContent: '⚠️ Tu carnet vence en ' + days + ' días. Renová tu cuota para mantenerlo activo.' })
        : null,
      (meta.st === 'vencido')
        ? el('div', { className: 'pagos-warn', textContent: '⏰ Tu carnet está vencido. Contactá a administración para renovar.' })
        : null
    ].filter(Boolean));
    container.appendChild(card);

    // Botón de pago
    const payCard = el('div', { className: 'pagos-card' }, [
      el('h2', { textContent: 'Pagar cuota' })
    ]);
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

    // Prestaciones del plan
    const benefitsCard = el('div', { className: 'pagos-card' }, [
      el('h2', { textContent: 'Prestaciones incluidas en tu plan' })
    ]);
    const feats = [
      { ok: true, label: 'Emergencias / Urgencias / Enfermería / Traslados locales' },
      { ok: true, label: 'Cobertura Costa Atlántica (roaming Dolores ↔ La Costa)' },
      { ok: true, label: 'Descuento farmacia ' + (plan.pharmacyDiscount || 0) + '%' },
      { ok: !!plan.hasRemis, label: 'Remis en ambulancia (discapacidad)' },
      { ok: !!plan.hasApp, label: 'Acceso completo a la APP' },
      { ok: !!plan.hasTravel, label: 'Seguro al viajero' },
      { ok: !!plan.hasVirtualDoc, label: 'Médico virtual (5 especialistas, 24/365)' },
      { ok: !!plan.hasPulsera, label: 'Pulsera SOS con geolocalización' },
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
  // BOOT
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => {
    if (isCarnetMode()) { renderCarnetVerifyMode(); return; }

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
    renderCarnetBlock();
    renderPlanBadge();
    renderPagos();

    const activeProfile = Store.getActiveProfile();
    if (activeProfile) {
      const dniInput = $('#fDni');
      if (dniInput && !dniInput.value) dniInput.value = activeProfile.dni || '';
      loadProfileIntoForm();
    }
  });
})();
