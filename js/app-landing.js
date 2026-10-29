/* ============================================================
   app-landing.js — Formulario "Hacete Socio" en la landing
   - Submit a la Edge Function submit-socio-request
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
  const ANON_KEY = C.ANON_KEY;

  const $ = (s) => document.querySelector(s);

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

    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
    showMsg('', false);

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
        // TODO E2: redirigir a Mercado Pago con json.initPoint
        setTimeout(() => {
          showMsg('El pago online estará disponible próximamente. Un asesor te contactará.', false);
        }, 2500);
      } else {
        showMsg('¡Solicitud recibida! Un asesor te contactará a la brevedad.', false);
      }

      form.reset();
      if (fechaInput) fechaInput.value = new Date().toISOString().slice(0, 10);
    } catch (err) {
      showMsg(err.message || 'Error al enviar. Intentá de nuevo.', true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar solicitud'; }
    }
  });
})();
