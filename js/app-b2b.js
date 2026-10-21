/* ============================================================
   app-b2b.js — Controlador de b2b.html (Módulo 5)
   Alta/edición de establecimientos B2B (Hoteles, Balnearios,
   Comercios, Consultorios, Eventos) y tarjeta QR de emergencia.
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  if (!Store) {
    console.error('[app-b2b] E360Store no disponible.');
    return;
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const uiState = {
    baseFilter: 'ALL',
    operatorName: '',
    editingId: null
  };

  // ============================================================
  // Helper el() con fix H-01
  // ============================================================
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

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('es-AR');
    } catch (_) { return iso; }
  }

  function statusBadge(status) {
    return el('span', {
      className: 'badge badge-status-' + status,
      textContent: status
    });
  }

  // ============================================================
  // QR SIMULADO EN SVG PURO
  // ============================================================
  function buildQrSvg(seedStr) {
    // QR "visual" determinístico basado en hash del ID.
    // NO es un QR escaneable real, es un identificador visual
    // para el MVP. El botón "Probar Escaneo QR" hace la apertura
    // real de index.html?b2b=ID.
    const size = 21;
    const cell = 3;
    const total = size * cell;
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = ((hash << 5) - hash + seedStr.charCodeAt(i)) | 0;
    }
    const bits = [];
    let h = hash;
    for (let i = 0; i < size * size; i++) {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      bits.push((h >> 8) & 1);
    }
    // Marcadores de posición (finder patterns) en 3 esquinas
    function isFinder(x, y) {
      const inTopLeft = (x < 7 && y < 7);
      const inTopRight = (x >= size - 7 && y < 7);
      const inBottomLeft = (x < 7 && y >= size - 7);
      return inTopLeft || inTopRight || inBottomLeft;
    }
    function finderOn(x, y) {
      // borde + centro
      const localX = (x >= size - 7) ? x - (size - 7) : x;
      const localY = (y >= size - 7) ? y - (size - 7) : y;
      if (localX === 0 || localX === 6 || localY === 0 || localY === 6) return true;
      if (localX >= 2 && localX <= 4 && localY >= 2 && localY <= 4) return true;
      return false;
    }

    let rects = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        let on = bits[idx] === 1;
        if (isFinder(x, y)) on = finderOn(x, y);
        if (on) {
          rects += '<rect x="' + (x * cell) + '" y="' + (y * cell) + '" width="' + cell + '" height="' + cell + '" fill="#000"/>';
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" width="72" height="72" role="img" aria-label="QR de emergencia (visual demostrativo)">' +
      '<rect width="' + total + '" height="' + total + '" fill="#fff"/>' +
      rects +
      '</svg>';
  }

  // ============================================================
  // FORM
  // ============================================================
  function initForm() {
    const form = $('#b2bForm');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = $('#b2bMsg');
      msg.textContent = '';
      msg.style.color = '';

      if (!uiState.operatorName) {
        msg.style.color = 'var(--color-red)';
        msg.textContent = 'Ingresá tu nombre de operador / comercial responsable en la cabecera.';
        return;
      }

      const lat = $('#b2bLat').value ? parseFloat($('#b2bLat').value) : null;
      const lng = $('#b2bLng').value ? parseFloat($('#b2bLng').value) : null;
      const coords = (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng))
        ? { lat, lng }
        : null;

      const data = {
        id: uiState.editingId || undefined,
        name: $('#b2bName').value.trim(),
        type: $('#b2bType').value,
        baseId: $('#b2bBase').value,
        address: $('#b2bAddress').value.trim(),
        status: $('#b2bStatus').value,
        referencePhone: $('#b2bPhone').value.trim(),
        protocol: $('#b2bProtocol').value.trim(),
        coords
      };

      if (!data.name || !data.address) {
        msg.style.color = 'var(--color-red)';
        msg.textContent = 'Completá nombre y dirección.';
        return;
      }

      try {
        Store.saveB2BEstablishment(data, uiState.operatorName);
        msg.style.color = 'var(--color-green)';
        msg.textContent = uiState.editingId ? 'Establecimiento actualizado.' : 'Establecimiento creado.';
        resetForm();
        renderList();
      } catch (err) {
        msg.style.color = 'var(--color-red)';
        msg.textContent = 'Error: ' + err.message;
      }
    });

    $('#b2bCancelEdit').addEventListener('click', () => resetForm());
  }

  function resetForm() {
    uiState.editingId = null;
    $('#b2bId').value = '';
    $('#b2bName').value = '';
    $('#b2bType').value = 'Hotel / Complejo';
    $('#b2bBase').value = 'DOLORES';
    $('#b2bStatus').value = 'en_revision';
    $('#b2bAddress').value = '';
    $('#b2bLat').value = '';
    $('#b2bLng').value = '';
    $('#b2bPhone').value = '';
    $('#b2bProtocol').value = '';
    $('#b2bSubmit').textContent = 'Crear establecimiento';
    $('#b2bCancelEdit').hidden = true;
    $('#formTitle').textContent = 'Dar de alta un nuevo establecimiento / evento';
  }

  function loadIntoForm(est) {
    uiState.editingId = est.id;
    $('#b2bId').value = est.id;
    $('#b2bName').value = est.name || '';
    $('#b2bType').value = est.type || 'Hotel / Complejo';
    $('#b2bBase').value = est.baseId || 'DOLORES';
    $('#b2bStatus').value = est.status || 'en_revision';
    $('#b2bAddress').value = est.address || '';
    $('#b2bLat').value = (est.coords && est.coords.lat !== undefined && est.coords.lat !== null)
      ? String(est.coords.lat) : '';
    $('#b2bLng').value = (est.coords && est.coords.lng !== undefined && est.coords.lng !== null)
      ? String(est.coords.lng) : '';
    $('#b2bPhone').value = est.referencePhone || '';
    $('#b2bProtocol').value = est.protocol || '';
    $('#b2bSubmit').textContent = 'Guardar cambios';
    $('#b2bCancelEdit').hidden = false;
    $('#formTitle').textContent = 'Editar establecimiento: ' + est.name;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ============================================================
  // LISTADO
  // ============================================================
  function renderList() {
    const list = $('#b2bList');
    const empty = $('#b2bEmpty');
    list.innerHTML = '';

    const items = Store.getB2BEstablishments(uiState.baseFilter);
    if (!items.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    items.forEach((est) => {
      const url = 'index.html?b2b=' + encodeURIComponent(est.id);
      const coordsText = est.coords
        ? (est.coords.lat.toFixed(5) + ', ' + est.coords.lng.toFixed(5))
        : 'Sin coordenadas';

      const qrBox = el('div', { className: 'qr-box' });
      qrBox.innerHTML = buildQrSvg(est.id);
      qrBox.appendChild(el('div', { className: 'qr-info' }, [
        el('strong', { textContent: 'QR de Emergencia del Establecimiento' }),
        el('div', { textContent: 'ID: ' }),
        el('code', { textContent: est.id }),
        el('div', { textContent: 'Apunta a: ' + url })
      ]));

      const card = el('div', { className: 'b2b-est-card' }, [
        el('div', { className: 'est-top' }, [
          el('div', { className: 'est-name', textContent: est.name }),
          statusBadge(est.status)
        ]),
        el('div', { className: 'est-meta' }, [
          el('div', {}, [el('strong', { textContent: 'Rubro: ' }), el('span', { textContent: est.type })]),
          el('div', {}, [el('strong', { textContent: 'Base: ' }), el('span', { textContent: est.baseId })]),
          el('div', {}, [el('strong', { textContent: 'Dirección: ' }), el('span', { textContent: est.address })]),
          el('div', {}, [el('strong', { textContent: 'Coordenadas: ' }), el('span', { textContent: coordsText })]),
          el('div', {}, [el('strong', { textContent: 'Teléfono referente: ' }), el('span', { textContent: est.referencePhone || '—' })]),
          el('div', {}, [el('strong', { textContent: 'Alta: ' }), el('span', { textContent: fmtDate(est.createdAt) })])
        ]),
        el('div', { className: 'est-proto', textContent: 'Protocolo de ingreso: ' + (est.protocol || 'Sin protocolo registrado.') }),
        qrBox,
        el('div', { className: 'row-actions' }, [
          el('button', {
            type: 'button',
            textContent: '🔗 Probar Escaneo QR (Abrir Vista Socio con este Punto Fijo)',
            onclick: () => {
              window.open(url, '_blank', 'noopener');
            }
          }),
          el('button', {
            type: 'button', className: 'btn-muted',
            textContent: '✎ Editar',
            onclick: () => loadIntoForm(est)
          }),
          el('button', {
            type: 'button', className: est.status === 'activo' ? 'btn-danger' : '',
            textContent: est.status === 'activo' ? 'Suspender' : 'Activar',
            onclick: () => {
              const msg = $('#b2bMsg');
              if (!uiState.operatorName) {
                msg.style.color = 'var(--color-red)';
                msg.textContent = 'Ingresá tu nombre de operador / comercial responsable primero.';
                return;
              }
              try {
                const next = est.status === 'activo' ? 'suspendido' : 'activo';
                Store.toggleB2BStatus(est.id, next, uiState.operatorName);
                msg.style.color = 'var(--color-green)';
                msg.textContent = 'Estado cambiado a ' + next + '.';
                renderList();
              } catch (err) {
                msg.style.color = 'var(--color-red)';
                msg.textContent = 'Error: ' + err.message;
              }
            }
          })
        ])
      ]);

      list.appendChild(card);
    });
  }

  // ============================================================
  // OPERADOR / BASE
  // ============================================================
  function initOperatorInput() {
    const input = $('#b2bOperatorInput');
    input.addEventListener('input', () => {
      uiState.operatorName = input.value.trim();
    });
  }

  function initBaseSelector() {
    const sel = $('#b2bBaseSelector');
    sel.addEventListener('change', () => {
      uiState.baseFilter = sel.value;
      renderList();
    });
  }

  // ============================================================
  // SUSCRIPCIÓN
  // ============================================================
  function initSubscription() {
    Store.subscribe((msg) => {
      if (!msg || msg.type !== 'STATE_CHANGED') return;
      renderList();
    });
  }

  // ============================================================
  // BOOT
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => {
    initOperatorInput();
    initBaseSelector();
    initForm();
    initSubscription();
    resetForm();
    renderList();
  });
})();
