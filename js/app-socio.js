/* ============================================================
   app-socio.js v7.1 — Controlador de socio.html
   - Login DNI + contraseña, cambio obligatorio primer login
   - Credencial con logo dinámico + QR verificado + código rotativo
   - Modo público ?carnet= y ?pulsera= (sin login)
   - Medicación con lista del día + CRUD + notificaciones nativas (F1)
   - Historial de incidentes del socio
   - Recategorización de plan vía socio_request
   - PDF de credencial con jsPDF
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  const C = window.E360Config;
  const QR = window.E360QR || null;

  if (!Store || !C) {
    console.error('[app-socio] Faltan dependencias core.');
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

  let currentIncident = null;
  let currentLocation = null;
  let manualAddress = '';
  let activeLocality = 'Dolores';
  let b2bContext = null;
  let credencialInterval = null;
  let credencialCodigo = null;
  let credencialSegundos = 180;
  let activeFamilyIndex = 0;
  let branding = null;

  const MODO_MAYOR_KEY = 'e360_modo_mayor';
  const CODIGO_DURACION_SEG = 180;

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
  // BRANDING
  // ============================================================
  async function loadBranding() {
    branding = await Store.loadBranding();
    if (branding && branding.logoUrl) {
      const headerBrand = $('#headerBrand');
      if (headerBrand) {
        const svg = headerBrand.querySelector('svg');
        if (svg) {
          const img = document.createElement('img');
          img.src = branding.logoUrl;
          img.alt = 'EMP';
          img.style.height = '38px';
          img.style.width = 'auto';
          svg.replaceWith(img);
        }
      }
      const ctLogo = $('#ctLogo');
      if (ctLogo) {
        ctLogo.innerHTML = '<img src="' + branding.logoUrl + '" alt="EMP" style="max-width:140px;max-height:44px;" />';
      }
      const loginLogo = $('#loginLogo');
      if (loginLogo) {
        loginLogo.innerHTML = '<img src="' + branding.logoUrl + '" alt="EMP" style="max-width:180px;max-height:56px;" />';
      }
      if (branding.faviconUrl) {
        let link = document.querySelector('link[rel="icon"]');
        if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
        link.href = branding.faviconUrl;
      }
    }
  }

  // ============================================================
  // MODO PÚBLICO: ?carnet= y ?pulsera=
  // ============================================================
  function getPublicMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('carnet')) return { mode: 'carnet', token: params.get('carnet') };
    if (params.has('pulsera')) return { mode: 'pulsera', token: params.get('pulsera') };
    return null;
  }

  async function renderPublicVerify(mode, token) {
    const appNormal = $('#appNormal');
    const publicMode = $('#publicVerifyMode');
    if (appNormal) appNormal.hidden = true;
    if (publicMode) publicMode.hidden = false;

    let data = null;
    let isPulsera = false;
    try {
      if (mode === 'carnet') {
        data = await Store.getPublicCarnetInfo(token);
      } else {
        data = await Store.getPublicPulseraInfo(token);
        isPulsera = true;
      }
    } catch (e) {
      data = null;
    }

    if (!publicMode) return;
    publicMode.innerHTML = '';

    const header = el('header', { className: 'pub-header' }, [
      el('a', { href: 'index.html', className: 'emp-brand' }, [
        (function () {
          if (branding && branding.logoUrl) {
            const img = document.createElement('img');
            img.src = branding.logoUrl;
            img.alt = 'EMP';
            img.style.height = '38px';
            return img;
          }
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 140 48');
          svg.innerHTML = '<text x="0" y="34" font-family="Montserrat, sans-serif" font-size="30" font-weight="900" fill="#0B3C78">EMP</text><path d="M2 40 h22 l5 -10 l7 18 l6 -14 l4 6 h94" stroke="#EA580C" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
          return svg;
        })()
      ]),
      el('span', { className: 'pub-badge', textContent: isPulsera ? 'EMERGENCIA' : 'VERIFICACIÓN' })
    ]);
    publicMode.appendChild(header);

    if (!data) {
      publicMode.appendChild(el('div', { className: 'pub-card pub-invalid' }, [
        el('div', { className: 'pub-icon', textContent: '❌' }),
        el('h1', { textContent: isPulsera ? 'Pulsera no registrada' : 'Credencial no válida' }),
        el('p', { textContent: isPulsera
          ? 'El código escaneado no corresponde a una pulsera activa de EMP.'
          : 'El código escaneado no corresponde a un socio registrado en EMP.' }),
        el('p', { className: 'pub-hint', textContent: 'Verificá el código o consultá en administración.' })
      ]));
      return;
    }

    if (isPulsera) {
      const card = el('div', { className: 'pub-card pub-pulsera pub-sos-alert' }, [
        el('div', { className: 'pub-sos-header', textContent: '🚨 EMERGENCIA — DATOS DEL SOCIO' }),
        el('h1', { className: 'pub-name', textContent: data.nombre || '—' }),
        el('div', { className: 'pub-info-grid' }, [
          pubInfoRow('N° Socio', data.socioNumber || '—'),
          pubInfoRow('DNI', data.dni || '—'),
          pubInfoRow('Plan', data.planLabel || '—'),
          pubInfoRow('Grupo sanguíneo', data.grupoSanguineo || 'No informado'),
        ]),
        data.alergias ? el('div', { className: 'pub-alert pub-alert-red' }, [
          el('strong', { textContent: '⚠ ALERGIAS' }),
          el('div', { textContent: data.alergias })
        ]) : null,
        data.patologias ? el('div', { className: 'pub-alert' }, [
          el('strong', { textContent: 'Patologías' }),
          el('div', { textContent: data.patologias })
        ]) : null,
        data.medications && data.medications.length ? el('div', { className: 'pub-meds' }, [
          el('strong', { textContent: '💊 Medicación activa' }),
          el('ul', {}, data.medications.map(m => el('li', { textContent: m.nombre + (m.dosis ? ' — ' + m.dosis : '') + (m.frecuencia ? ' · ' + m.frecuencia : '') })))
        ]) : null,
        el('div', { className: 'pub-actions' }, [
          el('a', { href: 'tel:2245444600', className: 'btn-sos-call', textContent: '🚨 LLAMAR A EMP 2245-444600' }),
          data.contacto ? el('a', { href: 'tel:' + String(data.contacto).replace(/[^\d+]/g, ''), className: 'btn-secondary', textContent: '📞 ' + data.contacto }) : null
        ].filter(Boolean)),
        el('p', { className: 'pub-hint', textContent: 'Si es una emergencia real, llamá también al 107 (SAME) o 911 (Policía).' })
      ].filter(Boolean));
      publicMode.appendChild(card);
    } else {
      const statusClass = 'pub-' + data.carnetStatus;
      const statusLabel = { activo: 'ACTIVO', vencido: 'VENCIDO', suspendido: 'SUSPENDIDO' }[data.carnetStatus] || data.carnetStatus;
      const icon = { activo: '✅', vencido: '⏰', suspendido: '⛔' }[data.carnetStatus] || '❔';
      const validUntilTxt = data.carnetValidUntil ? new Date(data.carnetValidUntil).toLocaleDateString('es-AR') : '—';

      const card = el('div', { className: 'pub-card ' + statusClass }, [
        el('div', { className: 'pub-icon', textContent: icon }),
        el('h1', { textContent: 'Credencial ' + statusLabel }),
        pubInfoRow('N° de socio', data.socioNumber || '—'),
        pubInfoRow('Titular', data.nombre),
        pubInfoRow('Plan', data.planLabel),
        pubInfoRow('DNI', data.dniMasked),
        pubInfoRow('Vigencia', validUntilTxt),
        data.carnetStatus === 'activo' && data.daysToExpire !== null ? pubInfoRow('Días restantes', String(data.daysToExpire)) : null,
        el('p', { className: 'pub-hint', textContent: 'Datos mínimos de verificación. No se exponen datos clínicos.' })
      ].filter(Boolean));
      publicMode.appendChild(card);
    }

    publicMode.appendChild(el('a', { href: 'index.html', className: 'btn-primary', textContent: 'Volver al sitio', style: 'display:block;margin:24px auto;max-width:300px;text-align:center;' }));
  }

  function pubInfoRow(k, v) {
    return el('div', { className: 'pub-info-row' }, [
      el('span', { className: 'pub-k', textContent: k }),
      el('span', { className: 'pub-v', textContent: v })
    ]);
  }

  // ============================================================
  // LOGIN
  // ============================================================
  function showLogin() {
    const overlay = $('#loginOverlay');
    if (overlay) overlay.hidden = false;
    const app = $('#appNormal');
    if (app) app.hidden = true;
  }

  function hideLogin() {
    const overlay = $('#loginOverlay');
    if (overlay) overlay.hidden = true;
    const app = $('#appNormal');
    if (app) app.hidden = false;
  }

  function initLoginForm() {
    const form = $('#loginForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#loginMsg');
      const btn = $('#loginBtn');
      const dni = $('#loginDni').value.trim();
      const password = $('#loginPassword').value;
      if (!dni || !password) { if (msg) { msg.textContent = 'Completá DNI y contraseña.'; msg.style.color = 'var(--emp-sos)'; } return; }
      if (btn) { btn.disabled = true; btn.textContent = 'Ingresando…'; }
      try {
        const profile = await Store.login(dni, password);
        if (msg) { msg.textContent = ''; }
        if (profile && profile.mustChangePassword) {
          showChangePassword();
        } else {
          hideLogin();
          renderAll();
        }
      } catch (err) {
        if (msg) { msg.textContent = err.message || 'Error al ingresar.'; msg.style.color = 'var(--emp-sos)'; }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Ingresar'; }
      }
    });
  }

  function showChangePassword() {
    const overlay = $('#changePasswordOverlay');
    if (overlay) overlay.hidden = false;
  }
  function hideChangePassword() {
    const overlay = $('#changePasswordOverlay');
    if (overlay) overlay.hidden = true;
  }

  function initChangePasswordForm() {
    const form = $('#changePasswordForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#changePasswordMsg');
      const btn = $('#changePasswordBtn');
      const p1 = $('#newPassword').value;
      const p2 = $('#newPasswordConfirm').value;
      if (p1.length < 6) { if (msg) { msg.textContent = 'Mínimo 6 caracteres.'; msg.style.color = 'var(--emp-sos)'; } return; }
      if (p1 !== p2) { if (msg) { msg.textContent = 'Las contraseñas no coinciden.'; msg.style.color = 'var(--emp-sos)'; } return; }
      if (btn) { btn.disabled = true; btn.textContent = 'Cambiando…'; }
      try {
        await Store.changePassword(p1);
        hideChangePassword();
        hideLogin();
        renderAll();
        toast('Contraseña cambiada');
      } catch (err) {
        if (msg) { msg.textContent = err.message || 'Error al cambiar contraseña.'; msg.style.color = 'var(--emp-sos)'; }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Cambiar contraseña'; }
      }
    });
  }

  function initLogout() {
    const btn = $('#btnLogout');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!confirm('¿Cerrar sesión?')) return;
      await Store.logout();
      location.reload();
    });
  }

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
        panels.forEach((p) => { p.hidden = p.dataset.tab !== target; });

        if (target === 'beneficios') renderBenefits(activeLocality);
        if (target === 'ficha') { loadProfileIntoForm(); renderMedicacion(); renderMisIncidentes(); renderPagos(); }
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
    const dot = $('#connDot'), text = $('#connText');
    function update() {
      const online = navigator.onLine;
      if (dot) dot.className = 'dot ' + (online ? 'dot-online' : 'dot-offline');
      if (text) text.textContent = online ? 'Online' : 'Offline';
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
    select.addEventListener('change', () => {
      Store.setActiveBase(select.value);
      const newCtx = Store.getActiveContext();
      updateBasePhone(newCtx.base.phone);
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

  // ============================================================
  // PILL SOCIO
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
    if (st === 'activo') { pill.textContent = '✓ Socio Habilitado'; pill.className = 'pill-socio-habilitado pill-socio-ok'; }
    else if (st === 'suspendido') { pill.textContent = '⛔ Suspendido'; pill.className = 'pill-socio-habilitado pill-socio-bad'; }
    else { pill.textContent = '⏰ Vencido'; pill.className = 'pill-socio-habilitado pill-socio-warn'; }

    const av = $('#avatarCircle');
    if (av && profile.nombre) {
      const parts = profile.nombre.split(/[\s,]+/).filter(Boolean);
      const initials = (parts[0] ? parts[0][0] : '') + (parts[1] ? parts[1][0] : '');
      av.textContent = initials.toUpperCase() || 'MP';
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
      banner.appendChild(el('strong', { textContent: '📍 Área Protegida Detectada por QR: ' + est.name }));
      banner.appendChild(el('div', { textContent: est.address + ' · Base ' + est.baseId + ' · Rubro: ' + est.type }));
      if (est.protocol) banner.appendChild(el('div', { className: 'b2b-proto', textContent: 'Protocolo: ' + est.protocol }));
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
      if (!navigator.geolocation) { if (status) status.textContent = 'GPS: no disponible.'; if (fallback) fallback.hidden = false; return; }
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
  // SOS
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
      setProgress(Math.min(100, (elapsed / HOLD_MS) * 100), btnId);
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
  }

  async function fireSOS() {
    const activeProfile = Store.getActiveProfile();
    try {
      const incident = await Store.createSOSIncident({
        location: currentLocation, manualAddress: manualAddress,
        profileDni: activeProfile ? activeProfile.dni : null,
        b2bEstablishmentId: b2bContext ? b2bContext.id : null,
        notes: b2bContext ? ('Ingreso B2B: ' + b2bContext.name) : ''
      });
      currentIncident = incident;
      renderIncident(incident);
      setProgress(100, 'btnSOS');
      setProgress(100, 'btnSOSInicio');
      setTimeout(() => { setProgress(0, 'btnSOS'); setProgress(0, 'btnSOSInicio'); sosFired = false; }, 400);
    } catch (err) {
      toast('Error al emitir SOS: ' + err.message);
      sosFired = false;
    }
  }

  // ============================================================
  // RENDER INCIDENTE
  // ============================================================
  const STATE_LABELS = {
    RECIBIDA_SERVIDOR: { text: 'Alerta emitida. Aguardando confirmación de central.', color: 'amber' },
    ACEPTADA_POR_CENTRAL: { text: 'Central confirmó recepción.', color: 'blue' },
    CLASIFICADA: { text: 'Incidente clasificado. Asignando recurso.', color: 'blue' },
    MOVIL_ASIGNADO: { text: 'Móvil asignado. Preparando salida.', color: 'green' },
    EN_CAMINO: { text: 'Móvil en camino.', color: 'green' },
    EN_ESCENA: { text: 'El móvil arribó al lugar.', color: 'green' },
    EN_TRASLADO: { text: 'Traslado en curso.', color: 'green' },
    CERRADA: { text: 'Incidente cerrado.', color: 'green' },
    CANCELADA: { text: 'Incidente cancelado.', color: 'red' }
  };
  const TIMELINE_STEPS = [
    { key: 'RECIBIDA_SERVIDOR', label: 'Enviada' },
    { key: 'ACEPTADA_POR_CENTRAL', label: 'Aceptada' },
    { key: 'CLASIFICADA', label: 'Clasificada' },
    { key: 'MOVIL_ASIGNADO', label: 'Móvil asignado' },
    { key: 'EN_CAMINO', label: 'En camino' },
    { key: 'EN_ESCENA', label: 'En escena' },
    { key: 'EN_TRASLADO', label: 'En traslado' },
    { key: 'CERRADA', label: 'Cerrado' }
  ];

  function renderIncident(incident) {
    const panel = $('#incidentPanel'), stateEl = $('#incidentState'), timelineEl = $('#timeline');
    if (!panel || !stateEl || !timelineEl) return;
    panel.hidden = false;
    const info = STATE_LABELS[incident.status] || { text: incident.status, color: 'amber' };
    stateEl.textContent = info.text;
    stateEl.setAttribute('data-color', info.color);
    timelineEl.innerHTML = '';
    const doneSet = new Set((incident.statusHistory || []).map(h => h.status));
    TIMELINE_STEPS.forEach(step => {
      const li = document.createElement('li');
      li.textContent = step.label;
      if (doneSet.has(step.key)) li.classList.add('done');
      timelineEl.appendChild(li);
    });
    const etaBlock = $('#etaBlock'), etaMain = $('#etaMain'), etaSource = $('#etaSource');
    if (etaBlock && etaMain) {
      try {
        const eta = Store.getIncidentEta(incident.id);
        if (eta.hasEta) {
          etaBlock.hidden = false;
          etaMain.textContent = 'Llegada estimada: ' + eta.etaMinutes + ' min';
          etaMain.className = 'eta-main ' + (eta.etaMinutes <= 5 ? 'eta-eta-near' : 'eta-eta-normal');
          if (etaSource) etaSource.textContent = 'Fuente: ' + eta.source;
        } else etaBlock.hidden = true;
      } catch (_) { etaBlock.hidden = true; }
    }
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
    Store.subscribe((msg) => {
      if (!msg) return;
      if (msg.type === 'AUTH_CHANGED') { location.reload(); return; }
      if (msg.type !== 'STATE_CHANGED') return;
      if (Store.getActiveProfile()) {
        renderPillSocio();
        renderInicio();
        if (!$('#tab-credencial').hidden) renderCredencial();
        if (!$('#tab-ficha').hidden) { renderMedicacion(); renderMisIncidentes(); renderPagos(); }
      }
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
    const profile = Store.getActiveProfile();
    if (!profile) return;
    if ($('#fNombre')) $('#fNombre').value = profile.nombre || '';
    if ($('#fDni')) $('#fDni').value = profile.dni || '';
    if ($('#fCuil')) $('#fCuil').value = profile.cuil || '';
    if ($('#fTelefono')) $('#fTelefono').value = profile.telefono || '';
    if ($('#fGrupo')) $('#fGrupo').value = profile.grupoSanguineo || '';
    if ($('#fAlergias')) $('#fAlergias').value = profile.alergias || '';
    if ($('#fPatologias')) $('#fPatologias').value = profile.patologias || '';
    if ($('#fContacto')) $('#fContacto').value = profile.contacto || '';
    const planLabel = $('#currentPlanLabel');
    if (planLabel) planLabel.textContent = (C.PLANS[profile.plan] || {}).label || profile.plan;
  }

  function initFichaForm() {
    const form = $('#formFicha'), msg = $('#fichaMsg');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (msg) msg.textContent = '';
      const nombre = $('#fNombre').value.trim();
      const telefono = $('#fTelefono').value.trim();
      const consent = $('#fConsent').checked;
      if (!nombre || !telefono) { if (msg) { msg.style.color = 'var(--emp-sos)'; msg.textContent = 'Completá nombre y teléfono.'; } return; }
      if (!consent) { if (msg) { msg.style.color = 'var(--emp-sos)'; msg.textContent = 'Debés aceptar el Consentimiento Informado.'; } return; }
      try {
        await Store.saveProfile({
          nombre, telefono,
          cuil: $('#fCuil').value.trim(),
          grupoSanguineo: $('#fGrupo').value,
          alergias: $('#fAlergias').value.trim(),
          patologias: $('#fPatologias').value.trim(),
          contacto: $('#fContacto').value.trim()
        });
        if (msg) { msg.style.color = '#16A34A'; msg.textContent = 'Ficha guardada.'; }
        renderPillSocio();
        renderInicio();
        renderCredencial();
        renderPagos();
      } catch (err) {
        if (msg) { msg.style.color = 'var(--emp-sos)'; msg.textContent = 'Error: ' + err.message; }
      }
    });
  }

  // ============================================================
  // MEDICACIÓN (con parches F1)
  // ============================================================
  function renderMedicacion() {
    const hoy = $('#medicacionHoy');
    const lista = $('#medicacionLista');
    const count = $('#medicacionCount');
    if (!hoy || !lista) return;

    // Banner APK: mostrar solo si NO está en Capacitor
    const banner = $('#medicacionBanner');
    if (banner) {
      if (window.E360Capacitor && window.E360Capacitor.isNative) {
        banner.hidden = true;
      } else {
        banner.hidden = false;
      }
    }

    const meds = Store.getMedications();
    if (count) count.textContent = String(meds.length);

    // Dosis de hoy
    const today = new Date().toISOString();
    const doses = Store.getDosesForDay(today);
    hoy.innerHTML = '';
    if (!doses.length) {
      hoy.appendChild(el('p', { className: 'empty-hint', textContent: 'Sin dosis programadas para hoy.' }));
    } else {
      hoy.appendChild(el('h3', { className: 'dosis-title', textContent: 'Hoy' }));
      doses.forEach(d => {
        const med = meds.find(m => m.id === d.medicationId);
        const hora = new Date(d.scheduledAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const taken = d.status === 'tomada';
        hoy.appendChild(el('div', { className: 'dosis-item ' + (taken ? 'dosis-tomada' : 'dosis-pendiente') }, [
          el('div', { className: 'dosis-info' }, [
            el('strong', { textContent: (med ? med.nombre : '—') + (med && med.dosis ? ' — ' + med.dosis : '') }),
            el('span', { className: 'dosis-hora', textContent: hora })
          ]),
          taken ? el('span', { className: 'dosis-check', textContent: '✅ Tomada' }) :
            el('button', { type: 'button', className: 'btn-secondary', textContent: 'Marcar tomada', onclick: async () => {
              try { await Store.logDose(d.id, 'tomada', ''); renderMedicacion(); toast('Dosis registrada'); }
              catch (e) { toast('Error: ' + e.message); }
            }})
        ]));
      });
    }

    // Lista de medicaciones
    lista.innerHTML = '';
    if (!meds.length) {
      lista.appendChild(el('p', { className: 'empty-hint', textContent: 'No hay medicaciones cargadas.' }));
    } else {
      meds.forEach(m => {
        lista.appendChild(el('div', { className: 'medicacion-card' }, [
          el('div', { className: 'med-top' }, [
            el('strong', { textContent: m.nombre }),
            el('button', { type: 'button', className: 'btn-muted', textContent: '✕', title: 'Eliminar', onclick: async () => {
              if (!confirm('¿Eliminar ' + m.nombre + '?')) return;
              try {
                await Store.deleteMedication(m.id);
                // Cancelar notificaciones nativas si está en Capacitor (F1)
                if (window.E360Capacitor && window.E360Capacitor.isNative) {
                  try { await window.E360Capacitor.cancelMedicationReminders(m.id); } catch (_) {}
                }
                renderMedicacion();
                toast('Medicación eliminada');
              }
              catch (e) { toast('Error: ' + e.message); }
            }})
          ]),
          el('div', { className: 'med-meta' }, [
            m.dosis ? el('span', { textContent: 'Dosis: ' + m.dosis }) : null,
            m.frecuencia ? el('span', { textContent: 'Frecuencia: ' + m.frecuencia }) : null,
            m.horarios && m.horarios.length ? el('span', { textContent: 'Horarios: ' + m.horarios.join(', ') }) : null
          ].filter(Boolean)),
          m.notas ? el('p', { className: 'med-notas', textContent: m.notas }) : null
        ]));
      });
    }
  }

  function initMedicacionForm() {
    const btn = $('#btnAddMedicacion');
    if (btn) btn.addEventListener('click', () => openMedicacionModal());

    // Botón Descargar APK
    const btnAPK = $('#btnDescargarAPK');
    if (btnAPK) {
      btnAPK.addEventListener('click', () => {
        window.open('https://github.com/instructormap/emergencias-360/actions', '_blank', 'noopener');
      });
    }
  }

  function openMedicacionModal(existing) {
    const overlay = el('div', { className: 'modal-overlay' });
    const modal = el('div', { className: 'modal-card' }, [
      el('h2', { textContent: existing ? 'Editar medicación' : 'Agregar medicación' }),
      el('label', {}, [el('span', { textContent: 'Nombre' }), el('input', { type: 'text', id: 'medNombre', value: existing ? existing.nombre : '', maxlength: '80', required: true })]),
      el('label', {}, [el('span', { textContent: 'Dosis (ej. 1 comprimido)' }), el('input', { type: 'text', id: 'medDosis', value: existing ? existing.dosis : '', maxlength: '60' })]),
      el('label', {}, [el('span', { textContent: 'Frecuencia (ej. cada 8 hs)' }), el('input', { type: 'text', id: 'medFrecuencia', value: existing ? existing.frecuencia : '', maxlength: '60' })]),
      el('label', {}, [el('span', { textContent: 'Horarios (ej. 08:00, 20:00)' }), el('input', { type: 'text', id: 'medHorarios', value: existing ? (existing.horarios || []).join(', ') : '', maxlength: '80', placeholder: '08:00, 20:00' })]),
      el('label', {}, [el('span', { textContent: 'Notas' }), el('textarea', { id: 'medNotas', rows: '2', maxlength: '200' }, [existing && existing.notas ? document.createTextNode(existing.notas) : null])]),
      el('div', { className: 'modal-actions' }, [
        el('button', { type: 'button', className: 'btn-secondary', textContent: 'Cancelar', onclick: () => document.body.removeChild(overlay) }),
        el('button', { type: 'button', className: 'btn-primary', textContent: 'Guardar', onclick: async () => {
          const nombre = $('#medNombre').value.trim();
          if (!nombre) { toast('Ingresá el nombre'); return; }
          const horarios = $('#medHorarios').value.split(',').map(s => s.trim()).filter(Boolean);
          try {
            const savedMed = await Store.saveMedication({
              id: existing ? existing.id : undefined,
              nombre, dosis: $('#medDosis').value.trim(),
              frecuencia: $('#medFrecuencia').value.trim(),
              horarios, notas: $('#medNotas').value.trim()
            });

            // Programar dosis de hoy
            if (savedMed && horarios.length) {
              try { await Store.scheduleDosesForMedication(savedMed.id, new Date().toISOString()); } catch (_) {}
            }

            // Programar notificaciones nativas si está en Capacitor (F1)
            if (window.E360Capacitor && window.E360Capacitor.isNative) {
              try {
                const perm = await window.E360Capacitor.requestPermissions();
                if (perm.granted) {
                  await window.E360Capacitor.scheduleMedicationReminders(savedMed);
                  if (perm.exactAlarm) {
                    toast('Recordatorio programado. Sonará con la app cerrada.');
                  } else {
                    toast('Recordatorio programado (puede atrasarse unos minutos).');
                  }
                } else {
                  toast('Permiso denegado. El recordatorio solo sonará con la app abierta.');
                }
              } catch (e) {
                console.warn('[app-socio] Error programando notificación:', e);
              }
            }

            document.body.removeChild(overlay);
            renderMedicacion();
            toast('Medicación guardada');
          } catch (e) { toast('Error: ' + e.message); }
        }})
      ])
    ]);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay);
  }

  // ============================================================
  // MIS INCIDENTES
  // ============================================================
  function renderMisIncidentes() {
    const container = $('#misIncidentes');
    if (!container) return;
    container.innerHTML = '';
    const list = Store.getMyIncidents();
    if (!list.length) {
      container.appendChild(el('p', { className: 'empty-hint', textContent: 'Sin incidentes registrados.' }));
      return;
    }
    list.forEach(inc => {
      const fecha = new Date(inc.createdAt).toLocaleString('es-AR');
      container.appendChild(el('div', { className: 'incidente-item' }, [
        el('div', { className: 'inc-top' }, [
          el('strong', { textContent: (STATE_LABELS[inc.status] || {}).text || inc.status }),
          el('span', { className: 'inc-fecha', textContent: fecha })
        ]),
        inc.manualAddress ? el('div', { className: 'inc-meta', textContent: inc.manualAddress }) : null
      ]));
    });
  }

  // ============================================================
  // CREDENCIAL
  // ============================================================
  function generarCodigo3Digitos() { return String(Math.floor(100 + Math.random() * 900)); }
  function formatoTiempo(seg) { const m = Math.floor(seg / 60); const s = seg % 60; return m + ':' + (s < 10 ? '0' + s : s); }

  function startCredencialTimer() {
    stopCredencialTimer();
    if (!credencialCodigo) { credencialCodigo = generarCodigo3Digitos(); credencialSegundos = CODIGO_DURACION_SEG; }
    updateCodigoUI();
    credencialInterval = setInterval(() => {
      credencialSegundos -= 1;
      if (credencialSegundos <= 0) { credencialCodigo = generarCodigo3Digitos(); credencialSegundos = CODIGO_DURACION_SEG; }
      updateCodigoUI();
    }, 1000);
  }
  function stopCredencialTimer() { if (credencialInterval) { clearInterval(credencialInterval); credencialInterval = null; } }
  function updateCodigoUI() {
    const cod = $('#csCodigo'); const ren = $('#csRenueva');
    if (cod && credencialCodigo) cod.textContent = credencialCodigo.split('').join(' ');
    if (ren) ren.textContent = formatoTiempo(credencialSegundos);
  }

  function getActiveFamilyMember() {
    const profile = Store.getActiveProfile();
    if (!profile) return null;
    const family = Array.isArray(profile.familyGroup) && profile.familyGroup.length ? profile.familyGroup : [{ id: 'self', nombre: profile.nombre, dni: profile.dni, cuil: profile.cuil, orden: profile.orden || '00', filial: profile.filial || profile.baseId }];
    if (activeFamilyIndex >= family.length) activeFamilyIndex = 0;
    return family[activeFamilyIndex];
  }

  function buildCarnetUrl(profile) {
    const origin = window.location.origin + window.location.pathname;
    return origin + '?carnet=' + encodeURIComponent(profile.carnetToken || '');
  }
  function buildCarnetQrPayload(profile) { return '?carnet=' + encodeURIComponent(profile.carnetToken || ''); }

  function renderCredencial() {
    const profile = Store.getActiveProfile();
    if (!profile) return;
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

    const qrWrap = $('#qrSvgWrap');
    if (qrWrap) {
      qrWrap.innerHTML = '';
      if (QR && typeof QR.toSvg === 'function' && profile.carnetToken) {
        try { qrWrap.innerHTML = QR.toSvg(buildCarnetQrPayload(profile), 220); }
        catch (e) {
          qrWrap.appendChild(el('div', { className: 'qr-fallback' }, [
            el('div', { style: 'font-weight:700;color:#7A1C32;margin-bottom:6px;', textContent: 'Escaneá o dictá este ID' }),
            el('div', { style: 'font-family:monospace;font-size:0.85rem;word-break:break-all;background:#F4F8FD;padding:8px;border-radius:8px;', textContent: (profile.socioNumber || '—') + ' · ' + (profile.carnetToken || '—') })
          ]));
        }
      } else {
        qrWrap.appendChild(el('div', { className: 'qr-fallback', textContent: 'QR no disponible' }));
      }
    }

    const pildorasWrap = $('#gfPildoras');
    if (pildorasWrap) {
      pildorasWrap.innerHTML = '';
      const family = Array.isArray(profile.familyGroup) && profile.familyGroup.length ? profile.familyGroup : [{ id: 'self', nombre: profile.nombre, dni: profile.dni }];
      family.forEach((m, idx) => {
        const activa = idx === activeFamilyIndex;
        pildorasWrap.appendChild(el('button', {
          type: 'button',
          className: 'gf-pildora' + (activa ? ' gf-pildora-activa' : ''),
          onclick: () => { activeFamilyIndex = idx; renderCredencial(); }
        }, [
          el('span', { className: 'gf-nombre', textContent: m.nombre || '—' }),
          el('span', { className: 'gf-dni', textContent: 'DNI ' + (m.dni || '—') })
        ]));
      });
    }
    updateCodigoUI();
  }

  function initShareCredencial() {
    const btn = $('#btnShareCredencial');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const profile = Store.getActiveProfile();
      if (!profile || !profile.carnetToken) { toast('Sin credencial.'); return; }
      const url = buildCarnetUrl(profile);
      if (navigator.share) navigator.share({ title: 'Credencial EMP', url }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Enlace copiado'), () => toast('No se pudo copiar'));
      else toast('Enlace: ' + url);
    });
  }

  function initDownloadPDF() {
    const btn = $('#btnDownloadPDF');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const profile = Store.getActiveProfile();
      if (!profile) return;
      if (!window.jspdf || !window.jspdf.jsPDF) { toast('PDF no disponible todavía'); return; }
      try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [85.6, 54] });
        doc.setFillColor(11, 60, 120);
        doc.rect(0, 0, 85.6, 54, 'F');
        doc.setFillColor(122, 28, 50);
        doc.rect(0, 40, 85.6, 14, 'F');
        if (branding && branding.logoUrl) {
          try {
            const img = new Image(); img.crossOrigin = 'anonymous'; img.src = branding.logoUrl;
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
            doc.addImage(img, 'PNG', 4, 4, 24, 8);
          } catch (_) {}
        }
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8); doc.setFont('helvetica', 'bold');
        const plan = C.PLANS[profile.plan] || { label: profile.plan };
        doc.text('PLAN ' + plan.label.toUpperCase(), 82, 8, { align: 'right' });
        doc.setFontSize(11); doc.setFont('helvetica', 'bold');
        doc.text(profile.nombre || '—', 4, 20);
        doc.setFontSize(6); doc.setFont('helvetica', 'normal');
        doc.text('CUIL / DNI', 4, 28);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
        doc.text((profile.cuil || '—') + ' / ' + (profile.dni || '—'), 4, 32);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
        doc.text('N° SOCIO', 40, 28);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
        doc.text(profile.socioNumber || '—', 40, 32);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
        doc.text('ORDEN', 4, 37);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
        doc.text((profile.orden || '00'), 4, 41);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
        doc.text('SEDE', 40, 37);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
        doc.text((profile.baseId || 'DOLORES').toUpperCase(), 40, 41);
        doc.setFontSize(4); doc.setTextColor(255, 255, 255);
        doc.text('ASARI S.A.S. — Proveedor Tecnológico · EMP Prestador Operativo · No sustituye 107/911', 42.8, 51.5, { align: 'center' });
        if (QR && typeof QR.toCanvas === 'function' && profile.carnetToken) {
          try {
            const canvas = document.createElement('canvas');
            QR.toCanvas(canvas, buildCarnetQrPayload(profile), 300);
            doc.addImage(canvas.toDataURL('image/png'), 'PNG', 62, 10, 20, 20);
          } catch (_) {}
        }
        doc.save('credencial_EMP_' + (profile.socioNumber || 'socio') + '.pdf');
        toast('Credencial descargada');
      } catch (e) { toast('Error al generar PDF: ' + e.message); }
    });
  }

  // ============================================================
  // BENEFICIOS
  // ============================================================
  function renderBenefits(locality) {
    const list = $('#benefitsList'), empty = $('#benefitsEmpty');
    if (!list) return;
    list.innerHTML = '';
    const items = Store.getVisibleBenefits(locality);
    const hint = $('#planBenefitsHint');
    const profile = Store.getActiveProfile();
    if (hint) {
      hint.innerHTML = '';
      if (profile && profile.plan) {
        const plan = C.PLANS[profile.plan] || { label: profile.plan };
        hint.textContent = 'Tu plan ' + plan.label + ' incluye ' + (plan.pharmacyDiscountLabel || (plan.pharmacyDiscount || 0) + '%') + ' de descuento en farmacia.';
        hint.hidden = false;
      } else hint.hidden = true;
    }
    if (!items.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    items.forEach(b => {
      list.appendChild(el('li', { className: 'benefit-card' }, [
        el('h3', { textContent: b.name }),
        el('p', { textContent: 'Categoría: ' + (b.category || '—') + ' · Localidad: ' + b.locality }),
        el('p', { className: 'benefit-desc', textContent: b.benefitDetail || '' }),
        el('p', { textContent: 'Convenio: ' + b.agreementRef + (b.validUntil ? ' · Vigencia: ' + b.validUntil : '') })
      ]));
    });
  }
  function initBenefitsFilter() {
    $$('.btn-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.btn-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeLocality = btn.dataset.loc;
        renderBenefits(activeLocality);
      });
    });
    renderBenefits(activeLocality);
  }

  // ============================================================
  // PAGOS
  // ============================================================
  function renderPagos() {
    const container = $('#pagosContainer');
    if (!container) return;
    container.innerHTML = '';
    const profile = Store.getActiveProfile();
    const cfg = Store.getPaymentConfigPublic();
    if (!profile) return;
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
    const cuota = (cfg.cuotas && cfg.cuotas[profile.plan]) || '';
    container.appendChild(el('div', { className: 'pagos-card' }, [
      el('h2', { textContent: 'Estado de tu Plan' }),
      el('div', { className: 'pagos-row' }, [el('span', { className: 'pk', textContent: 'Plan actual' }), el('span', { className: 'pv', textContent: plan.label })]),
      el('div', { className: 'pagos-row' }, [el('span', { className: 'pk', textContent: 'N° de socio' }), el('span', { className: 'pv', textContent: profile.socioNumber || '—' })]),
      el('div', { className: 'pagos-row' }, [el('span', { className: 'pk', textContent: 'Estado' }), el('span', { className: 'pv' }, [el('span', { className: 'carnet-status-pill ' + meta.cls, textContent: meta.icon + ' ' + meta.label })])]),
      el('div', { className: 'pagos-row' }, [el('span', { className: 'pk', textContent: 'Vigencia' }), el('span', { className: 'pv', textContent: validTxt })]),
      cuota ? el('div', { className: 'pagos-row' }, [el('span', { className: 'pk', textContent: 'Cuota mensual' }), el('span', { className: 'pv', textContent: '$ ' + cuota })]) : null
    ].filter(Boolean)));
  }

  // ============================================================
  // RECATEGORIZACIÓN
  // ============================================================
  function initRecategorizacion() {
    const btn = $('#btnRecategorizar');
    if (!btn) return;
    btn.addEventListener('click', () => openRecategorizacionModal());
  }
  function openRecategorizacionModal() {
    const profile = Store.getActiveProfile();
    if (!profile) return;
    const overlay = el('div', { className: 'modal-overlay' });
    const modal = el('div', { className: 'modal-card' }, [
      el('h2', { textContent: 'Solicitar cambio de plan' }),
      el('p', { textContent: 'Tu plan actual es ' + ((C.PLANS[profile.plan] || {}).label || profile.plan) + '. El cambio se coordina con un administrador para el pago de la diferencia.' }),
      el('label', {}, [el('span', { textContent: 'Plan solicitado' }), (function () {
        const sel = el('select', { id: 'recPlan' });
        C.PLAN_IDS.forEach(pid => {
          if (pid !== profile.plan) sel.appendChild(el('option', { value: pid, textContent: (C.PLANS[pid] || {}).label || pid }));
        });
        return sel;
      })()]),
      el('label', {}, [el('span', { textContent: 'Mensaje (opcional)' }), el('textarea', { id: 'recMsg', rows: '2', maxlength: '200' })]),
      el('div', { className: 'modal-actions' }, [
        el('button', { type: 'button', className: 'btn-secondary', textContent: 'Cancelar', onclick: () => document.body.removeChild(overlay) }),
        el('button', { type: 'button', className: 'btn-primary', textContent: 'Enviar solicitud', onclick: async () => {
          const planSel = $('#recPlan').value;
          const msg = $('#recMsg').value.trim();
          try {
            await Store.submitRecategorizacion(profile.dni, profile.plan, planSel, msg);
            document.body.removeChild(overlay);
            toast('Solicitud enviada. Un administrador te contactará.');
          } catch (e) { toast('Error: ' + e.message); }
        }})
      ])
    ]);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay);
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
  // ACCESOS RÁPIDOS
  // ============================================================
  function initAccesosRapidos() {
    $$('.acceso-rapido').forEach(btn => {
      btn.addEventListener('click', () => { const goto = btn.dataset.goto; if (goto) switchTab(goto); });
    });
    $$('.servicio-item').forEach(li => {
      li.addEventListener('click', () => {
        if (li.id === 'servicioTeleconsulta' || li.id === 'servicioPulsera') switchTab('ficha');
        else if (li.id === 'servicioFarmacia') switchTab('beneficios');
        else toast('Próximamente.');
      });
    });
  }

  // ============================================================
  // RENDER ALL
  // ============================================================
  function renderAll() {
    renderPillSocio();
    renderInicio();
    renderCredencial();
    renderBenefits(activeLocality);
    renderMedicacion();
    renderMisIncidentes();
    renderPagos();
    const profile = Store.getActiveProfile();
    if (profile) loadProfileIntoForm();
  }

  // ============================================================
  // BOOT
  // ============================================================
  document.addEventListener('DOMContentLoaded', async () => {
    const pub = getPublicMode();
    if (pub) {
      branding = await Store.loadBranding();
      await renderPublicVerify(pub.mode, pub.token);
      return;
    }

    const session = await Store.initSession();
    await loadBranding();

    initModoMayor();
    initBanner();
    initConnection();
    initLoginForm();
    initChangePasswordForm();
    initLogout();
    initBaseSelector();
    initTabs();
    initGPS();
    initSOSButton('btnSOS');
    initSOSButton('btnSOSInicio');
    initIncidentSubscription();
    initFichaForm();
    initMedicacionForm();
    initBenefitsFilter();
    initShareCredencial();
    initDownloadPDF();
    initRecategorizacion();
    initAccesosRapidos();
    initB2BFromQuery();

    if (session.loggedIn) {
      if (session.mustChangePassword) {
        showChangePassword();
      } else {
        hideLogin();
        renderAll();
      }
    } else {
      showLogin();
    }
  });
})();
