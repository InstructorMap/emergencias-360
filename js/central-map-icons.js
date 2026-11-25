(function () {
  'use strict';
  function incidentIcon(status) {
    const urgent=status==='RECIBIDA_SERVIDOR';
    return L.divIcon({
      className:'emp-map-incident',
      html:'<div class="emp-destination-pin '+(urgent?'emp-destination-urgent':'')+'"><span class="emp-destination-cross">✚</span><span class="emp-destination-caption">INCIDENTE</span></div>',
      iconSize:[98,60],iconAnchor:[49,56],popupAnchor:[0,-50]
    });
  }

  function unitIcon(status) {
    const phase=status==='EN_ESCENA'?'atencion':status==='EN_CAMINO'||status==='EN_TRASLADO'?'camino':'disponible';
    const ambulance='<svg viewBox="0 0 72 44" width="56" height="35" role="img" aria-label="Móvil de emergencia EMP" xmlns="http://www.w3.org/2000/svg">'+
      '<path d="M6 10 Q6 6 11 6 H43 Q47 6 47 11 V33 H6Z" fill="#f4f9ff" stroke="#b5d2e9" stroke-width="1.4"/>'+
      '<path d="M47 17 H58 L68 27 V33 H47Z" fill="#f4f9ff" stroke="#b5d2e9" stroke-width="1.4"/>'+
      '<path d="M50 20 H57 L63 26 H50Z" fill="#276b9a"/>'+
      '<rect x="7" y="23" width="60" height="5" rx="1" fill="#e64353"/>'+
      '<rect x="20" y="13" width="4" height="13" rx="1" fill="#d5233e"/>'+
      '<rect x="15" y="17" width="14" height="4" rx="1" fill="#d5233e"/>'+
      '<rect x="32" y="3" width="11" height="5" rx="2" fill="#30b8ff"/>'+
      '<circle cx="19" cy="34" r="6" fill="#101b2b" stroke="#e1f3ff" stroke-width="2"/>'+
      '<circle cx="57" cy="34" r="6" fill="#101b2b" stroke="#e1f3ff" stroke-width="2"/>'+
      '<text x="29" y="14" font-size="7" font-weight="900" fill="#1a5a86">EMP</text></svg>';
    return L.divIcon({
      className:'emp-map-unit emp-map-unit-'+phase,
      html:'<div class="emp-ambulance-marker emp-ambulance-vector">'+ambulance+'<span class="emp-ambulance-led"></span></div>',
      iconSize:[74,59],iconAnchor:[37,54],popupAnchor:[0,-45]
    });
  }

  window.EMPMapIcons = {incidentIcon, unitIcon};
})();
