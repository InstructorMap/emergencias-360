(function () {
  'use strict';
  function coordinates(location) {
    if (!location) return null;
    const values = [location.lat ?? location.latitude, location.lng ?? location.lon ?? location.longitude];
    if (values.some(value => typeof value !== 'number' && (typeof value !== 'string' || !value.trim()))) return null;
    const [lat, lng] = values.map(Number);
    return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180 ? [lat, lng] : null;
  }

  function create(map, notify) {
    const button = document.getElementById('empRoadButton');
    const output = document.getElementById('empRoadStatus');
    let current, identity, controller, line, route, earliest = 0;
    function clear() {
      controller?.abort();
      controller = null;
      if (line) map.removeLayer(line);
      line = null;
      route = null;
    }
    function update(incident) {
      current = incident;
      const target = coordinates(incident?.location);
      const key = JSON.stringify([incident?.id,incident?.assignedUnitId,incident?.status,target]);
      if (identity !== key) { clear(); identity = key; output.textContent = ''; }
      const origin = coordinates(incident?.unitLocation);
      const age = Date.now() - Date.parse(incident?.unitLocation?.ts);
      let reason = '';
      if (!incident) reason = 'Seleccioná un incidente.';
      else if (!incident.assignedUnitId) reason = 'Asigná un móvil para consultar su recorrido.';
      else if (!['MOVIL_ASIGNADO','EN_CAMINO'].includes(incident.status)) reason = 'Disponible durante la asignación y el trayecto al incidente.';
      else if (!target) reason = 'Destino sin coordenadas.';
      else if (!origin || !(age >= -60000 && age <= 120000)) reason = 'Se necesita una posición reciente del móvil.';
      else if (!navigator.onLine) reason = 'Sin conexión para consultar la ruta.';
      button.disabled = Boolean(reason || controller || Date.now() < earliest);
      if (reason) {
        clear();
        output.textContent = reason;
      } else if (route) {
        output.textContent = route.label + (String(origin) !== route.origin ? ' · Móvil desplazado. Recalculá para actualizar.' : '');
      } else if (!controller && !output.dataset.failed) output.textContent = '';
      if (reason) delete output.dataset.failed;
    }
    button.onclick = async () => {
      update(current);
      if (button.disabled) return;
      clear();
      notify();
      const start = coordinates(current.unitLocation), end = coordinates(current.location);
      const request = new AbortController();
      controller = request;
      earliest = Date.now() + 1500;
      button.disabled = true;
      delete output.dataset.failed;
      output.textContent = 'Calculando recorrido…';
      const timeout = setTimeout(() => request.abort(),12000);
      try {
        const pair = [start,end].map(([lat,lng]) => lng + ',' + lat).join(';');
        const response = await fetch('https://routing.openstreetmap.de/routed-car/route/v1/driving/' + pair +
          '?geometries=geojson&overview=simplified&radiuses=150;150', {
          signal:request.signal,credentials:'omit',referrerPolicy:'origin',cache:'no-store'
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (controller !== request) return;
        const result = data.routes?.[0];
        if (data.code !== 'Ok' || !Number.isFinite(result?.distance) || !Number.isFinite(result.duration) ||
            result.geometry?.type !== 'LineString' || !Array.isArray(result.geometry.coordinates)) throw new Error();
        const points = result.geometry.coordinates.map(([lng,lat]) => coordinates({lat,lng}));
        if (points.length < 2 || points.some(p => !p)) throw new Error();
        const distance = (result.distance/1000).toLocaleString('es-AR',{maximumFractionDigits:1});
        const label = distance + ' km · ' + Math.max(1,Math.round(result.duration/60)) +
          ' min estimados sin tránsito en vivo · calculada ' + new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
        route = {points,label,origin:String(start)};
        line = L.polyline(points,{color:'#1456b4',weight:5,opacity:0.9}).addTo(map);
        map.fitBounds(line.getBounds(),{padding:[30,30],maxZoom:16,animate:false});
      } catch {
        if (controller !== request) return;
        output.dataset.failed = '1';
        output.textContent = 'Ruta vial no disponible. Podés volver a consultar.';
      } finally {
        clearTimeout(timeout);
        if (controller === request) {
          controller = null;
          update(current);
          notify();
          setTimeout(() => update(current),Math.max(0,earliest-Date.now()));
        }
      }
    };
    return {update, snapshot:() => route};
  }
  window.EMPRoadRoute = {create};
})();
