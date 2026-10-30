/* ============================================================
   app-landing.js v8.2 — Formulario "Hacete Socio" + Branding C1
   - Fetch ligero a /rest/v1/branding (favicon + colores dinámicos sin store.js)
   - Submit a la Edge Function submit-socio-request con spinner circular
   - Maneja paymentMethod 'ahora' o 'contactar'
   - Preselecciona plan desde los botones "Elegir plan"
   ============================================================ */

(function () {
  'use strict';

  const C = window.E360SupabaseConfig;
  if (!C || !C.URL) {
    console.warn('[app-landing] Falta js/supabase.config.js');
    return;
  }

  const EDGE_URL = C.URL + '/functions/v1/submit-socio-request';
  const BRANDING_REST_URL = C.URL + '/rest/v1/branding?id=eq.1&select=favicon_url,color_primary,color_secondary,color_accent,color_sos';
  const ANON_KEY = C.ANON_KEY;
  const BRANDING_CACHE_KEY = 'e360_branding';

  const $ = (s) => document.querySelector(s);

  // ============================================================
  // C1: BRANDING DINÁMICO LIGERO (Favicon + Colores CSS)
  // ============================================================
  function applyLandingBrandingDOM(b) {
    if (!b || typeof document === 'undefined') return;
    const root = document.documentElement;
    if (b.colorPrimary) {
      root.style.setProperty('--emp-blue', b.colorPrimary);
      root.style.setProperty('--color-blue', b.colorPrimary);
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) metaTheme.setAttribute('content', b.colorPrimary);
    }
    if (b.colorSecondary) root.style.setProperty('--emp-bordo', b.colorSecondary);
    if (b.colorAccent) {
      root.style.setProperty('--emp-orange', b.colorAccent);
      root.style.setProperty('--color-amber', b.colorAccent);
    }
    if (b.colorSos) {
      root.style.setProperty('--emp-sos', b.colorSos);
      root.style.setProperty('--color-primary', b.colorSos);
    }
    if (b.faviconUrl) {
      let link = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        if (document.head) document.head.appendChild(link);
      }
      if (link.getAttribute('href') !== b.faviconUrl) {
        link.setAttribute('href', b.faviconUrl);
      }
    }
  }

  async function initLandingBranding() {
    try {
      const raw = localStorage.getItem(BRANDING_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.data) applyLandingBrandingDOM(parsed.data);
      }
    } catch (_) {}

    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    try {
      const res = await fetch(BRANDING_REST_URL, {
        method: 'GET',
        headers: {
          'apikey': ANON_KEY,
          'Authorization': 'Bearer ' + ANON_KEY,
          'Accept': 'application/json'
        }
      });
      if (!res.ok) return;
      const rows = await res.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return;
      const data = {
        faviconUrl: row.favicon_url || '',
        colorPrimary: row.color_primary || '#0B3C78',
        colorSecondary: row.color_secondary || '#7A1C32',
        colorAccent: row.color_accent || '#EA580C',
        colorSos: row.color_sos || '#DC2626'
      };
      applyLandingBrandingDOM(data);
      try {
        const prevRaw = localStorage.getItem(BRANDING_CACHE_KEY);
        const prev = prevRaw ? (JSON.parse(prevRaw).data || {}) : {};
        localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify({
          cachedAt: new Date().toISOString(),
          data: { ...prev, ...data }
        }));
      } catch (_) {}
    } catch (_) {}
  }

  // Helper de botón con spinner circular (C1)
  async function withBtnLoading(btn, fn, loadingText) {
    if (!btn) return await fn();
    const wasDisabled = btn.disabled;
    const prevNodes = Array.from(btn.childNodes).map(n => n.cloneNode(true));
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = '';

    const sp = document.createElement('span');
    sp.className = 'e360-spinner';
    sp.setAttribute('aria-hidden', 'true');
    btn.appendChild(sp);

    const tx = document.createElement('span');
    tx.textContent = loadingText || 'Enviando…';
    btn.appendChild(tx);

    try {
      return await fn();
    } finally {
      btn.textContent = '';
      prevNodes.forEach(n => btn.appendChild(n));
      btn.disabled = wasDisabled;
      btn.classList.remove('is-loading');
      btn.removeAttribute('aria-busy');
    }
  }

  // Inicializar branding apenas arranca
  initLandingBranding();

  // Preseleccionar plan al clickear "Elegir plan"
  document.querySelectorAll('.plan-cta[data-plan]').forEach(btn => {
    btn.addEventListener('click', () => {
      const plan = btn.getAttribute('data-plan');
      const sel = $('#adPlan');
      if (sel) sel.value = plan;
    });
  });

  // Auto-calcular edad desde fecha de nacimiento
  const fechaNac = $('#adFechaNac');
  const edad = $('#adEdad');
  if (fechaNac && edad) {
    fechaNac.addEventListener('change', () => {
      const val = fechaNac.value;
      if (!val) return;
      const nac = new Date(val);
      const hoy = new Date();
      let e = hoy.getFullYear() - nac.getFullYear();
      const m = hoy.getMonth() - nac.getMonth();
      if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) e--;
      edad.value = e >= 0 ? e : '';
    });
  }

  // Setear fecha de hoy por defecto
  const fechaInput = $('#adFecha');
  if (fechaInput && !fechaInput.value) {
    const hoy = new Date();
    fechaInput.value = hoy.toISOString().slice(0, 10);
  }

  function showMsg(text, isError) {
    const msg = $('#adMsg');
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'form-msg ' + (isError ? 'error' : 'ok');
  }

  function getFormData() {
    return {
      nombre: ($('#adNombre') || {}).value?.trim() || '',
      dni: ($('#adDni') || {}).value?.trim() || '',
      telefono: ($('#adTelefono') || {}).value?.trim() || '',
      email: ($('#adEmail') || {}).value?.trim() || '',
      fecha: ($('#adFecha') || {}).value || null,
      direccion: ($('#adDireccion') || {}).value?.trim() || '',
      fechaNacimiento: ($('#adFechaNac') || {}).value || null,
      edad: ($('#adEdad') || {}).value || null,
      localidad: ($('#adLocalidad') || {}).value || '',
      obraSocial: ($('#adObraSocial') || {}).value?.trim() || '',
      lugarDerivacion: ($('#adDerivacion') || {}).value?.trim() || '',
      medicoCabecera: ($('#adMedico') || {}).value?.trim() || '',
      contactoFamiliar: ($('#adContactoFamiliar') || {}).value?.trim() || '',
      grupoFamiliarCantidad: ($('#adGrupoCant') || {}).value || null,
      grupoFamiliarConstitucion: ($('#adGrupoConst') || {}).value?.trim() || '',
      planInteres: ($('#adPlan') || {}).value || '',
      antecedentes: {
        hipertension: !!($('#adHipertension') || {}).checked,
        cardiaca: !!($('#adCardiaca') || {}).checked,
        motriz: !!($('#adMotriz') || {}).checked,
        congenita: !!($('#adCongenita') || {}).checked,
        dolor_cronico: !!($('#adDolorCronico') || {}).checked,
        epilepsia: !!($('#adEpilepsia') || {}).checked,
        diabetes: !!($('#adDiabetes') || {}).checked,
        asma: !!($('#adAsma') || {}).checked,
        otra: ($('#adOtra') || {}).value?.trim() || ''
      },
      mensaje: ($('#adMensaje') || {}).value?.trim() || '',
      paymentMethod: (document.querySelector('input[name="paymentMethod"]:checked') || {}).value || 'contactar'
    };
  }

  const form = $('#formAdhesion');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#btnEnviarAdhesion');
    const data = getFormData();

    if (!data.nombre) { showMsg('El nombre es obligatorio.', true); return; }
    if (!data.dni || data.dni.replace(/\D/g, '').length < 6) { showMsg('DNI inválido.', true); return; }
    if (!data.telefono) { showMsg('El teléfono es obligatorio.', true); return; }
    if (!data.planInteres) { showMsg('Seleccioná un plan.', true); return; }

    showMsg('', false);

    await withBtnLoading(btn, async () => {
      try {
        const res = await fetch(EDGE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + ANON_KEY,
            'apikey': ANON_KEY
          },
          body: JSON.stringify(data)
        });

        const json = await res.json();

        if (!res.ok || json.error) {
          throw new Error(json.error || 'No se pudo enviar la solicitud.');
        }

        if (json.paymentMethod === 'ahora') {
          showMsg('Solicitud recibida. Te redirigimos al pago…', false);
          setTimeout(() => {
            showMsg('El pago online estará disponible próximamente. Un asesor de EMP te contactará.', false);
          }, 2500);
        } else {
          showMsg('¡Solicitud recibida! Un asesor de EMP te contactará a la brevedad.', false);
        }

        form.reset();
        if (fechaInput) fechaInput.value = new Date().toISOString().slice(0, 10);
      } catch (err) {
        const isOffline = /Failed to fetch|NetworkError/i.test(String(err && err.message));
        showMsg(isOffline
          ? 'Sin conexión a internet. Verificá tu red o escribinos al 2245-406323.'
          : (err.message || 'Error al enviar. Intentá de nuevo.'), true);
      }
    }, 'Enviando solicitud…');
  });
})();
