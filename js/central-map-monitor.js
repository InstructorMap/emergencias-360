(function () {
  'use strict';
  const status = document.getElementById('mapStatus');
  const parent = window.opener;
  if (!parent || parent.closed || !window.L) {
    status.textContent = parent && !window.L ? 'No se pudo cargar el mapa.' : 'Abrí esta vista desde Central.';
    return;
  }
  const map = L.map('monitorMap').setView([-36.31, -56.91], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors'
  }).addTo(map);
  const markers = new Map();
  let lastView, receivedAt = 0;
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.origin !== location.origin || event.source !== parent || data?.type !== 'emp-map') return;
    receivedAt = Date.now();
    const base = {ALL:'Todas las bases', DOLORES:'Dolores', LA_COSTA:'La Costa'}[data.base] || data.base;
    status.textContent = base + ' · ' + (!data.online ? 'Central sin red' : data.points.length + ' posiciones en mapa');
    const seen = new Set();
    for (const point of data.points) {
      seen.add(point.id);
      let marker = markers.get(point.id);
      const icon = point.unit ? EMPMapIcons.unitIcon : EMPMapIcons.incidentIcon;
      if (!marker) {
        marker = L.marker([point.lat,point.lng], {icon:icon(point.status)}).addTo(map);
        markers.set(point.id,marker);
      } else {
        marker.setLatLng([point.lat,point.lng]);
        if (marker.empStatus !== point.status) marker.setIcon(icon(point.status));
      }
      marker.empStatus = point.status;
      const label = document.createElement('span');
      label.textContent = (point.label || '') + ' · ' + (point.status || '');
      if (marker.getTooltip()) marker.setTooltipContent(label);
      else marker.bindTooltip(label);
    }
    for (const [id,marker] of markers) if (!seen.has(id)) { map.removeLayer(marker); markers.delete(id); }
    const view = JSON.stringify([data.base,data.selected,data.center,data.zoom]);
    if (view !== lastView) { map.setView(data.center,data.zoom); lastView = view; }
  });
  parent.postMessage('emp-map-ready',location.origin);
  setInterval(() => {
    if (parent.closed) { map.eachLayer(layer => map.removeLayer(layer)); status.textContent = 'Central cerrada'; window.close(); }
    else if (Date.now()-receivedAt > 30000) status.textContent = 'Sin actualización reciente de Central';
  },5000);
})();
