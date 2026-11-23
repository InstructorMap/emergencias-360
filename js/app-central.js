/* ============================================================
   app-central.js v8.9 — Consola Operativa EMP (C1 + F2 + F3 + C2)
   - Login staff por email con spinner
   - F2: push FCM + on_duty + deep_link ?incident=
   - Mapa Leaflet con marcadores de incidentes y unidades
   - Control de límite de velocidad global
   - F3: PTT (con manejo de errores), adjuntos, export ZIP, incidente manual
   - Triage con tipo de guardia (107/ENF/AMB/DOM/VIR/AP/EP)
   - Botón de diagnóstico PTT (🔍) en el header
   - C2: requireOnline() en acciones críticas offline
   - F3-mejora: PTT flotante en central + unlock de audio limpio
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  const C = window.E360Config;
  if (!Store) { console.error('[app-central] E360Store no disponible.'); return; }

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (v === true) { node.setAttribute(k, ''); return; }
        if (k === 'className') { node.className = v; return; }
        if (k === 'textContent') { node.textContent = v; return; }
        if (k === 'onclick' && typeof v === 'function') { node.addEventListener('click', v); return; }
        if (k === 'innerHTML') { node.innerHTML = v; return; }
        node.setAttribute(k, v);
      });
    }
    (children || []).forEach((c) => {
      if (c === null || c === undefined) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  function fmtTime(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return iso; } }
  function fmtDateTime(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return iso; } }

  function toast(text) {
    let t = document.getElementById('e360Toast');
    if (!t) { t = document.createElement('div'); t.id = 'e360Toast'; document.body.appendChild(t); }
    t.textContent = text;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function runLoading(btn, fn, label) {
    if (typeof Store.withButtonLoading === 'function') {
      return await Store.withButtonLoading(btn, fn, label);
    }
    return await fn();
  }

  function fmtErr(err) {
    return typeof Store.humanizeError === 'function' ? Store.humanizeError(err) : (err.message || 'Error');
  }

  // C2: guarda offline. Devuelve true si puede seguir, false si bloqueó.
  function onlineOrToast() {
    if (typeof Store.requireOnline === 'function') return Store.requireOnline();
    const online = (typeof navigator !== 'undefined') ? navigator.onLine !== false : true;
    if (!online) {
      if (typeof Store.toastOfflineCritico === 'function') Store.toastOfflineCritico();
      return false;
    }
    return true;
  }

  const ui = {
    baseFilter: 'ALL',
    incidentFilter: 'active',
    selectedIncidentId: null,
    operatorId: null,
    operatorName: '',
    onDuty: true,
    lastPendingCount: 0,
    map: null,
    mapMarkers: {},
    pttIncidentId: null,
    pttConnected: false
  };

  // Alarmas de Central: distinguir nuevos ingresos de cambios de estado o GPS.
  const EMP_ALARM_FILES = [
    {file:'01_Alarma_Central_Clasica.wav',name:'Clásica de Central'},
    {file:'02_Sirena_Ascendente.wav',name:'Sirena ascendente'},
    {file:'03_Alerta_Triple_Despacho.wav',name:'Triple despacho'}
  ];
  const emergencyAlert = {initialized:false,known:new Set(),active:new Map(),enabled:false,timer:null,player:null,preview:null,choice:0};
  function pendingAlerts(){return Store.getIncidents('ALL').filter(i=>i.status==='RECIBIDA_SERVIDOR');}
  function alertLabel(inc){return [inc.priority||'SIN TRIAGE',inc.baseId||'BASE SIN DEFINIR',inc.manualAddress||'Ubicación en incidente'].join(' · ');}
  function alarmUrl(){return 'assets/audio/'+EMP_ALARM_FILES[emergencyAlert.choice].file;}
  function stopEmergencyTone(){
    if(emergencyAlert.timer){clearInterval(emergencyAlert.timer);emergencyAlert.timer=null;}
    if(emergencyAlert.player){emergencyAlert.player.pause();emergencyAlert.player.currentTime=0;}
  }
  function updateEmergencySoundButton(){
    const btn=document.getElementById('btnEmergencySound');
    if(!btn)return;
    btn.textContent=emergencyAlert.enabled?'🔊 Desactivar alarma':'🔔 Activar alarma';
    btn.setAttribute('aria-pressed',String(emergencyAlert.enabled));
  }
  function playEmergencyTone(){
    if(!emergencyAlert.enabled)return;
    if(!emergencyAlert.player)emergencyAlert.player=new Audio(alarmUrl());
    emergencyAlert.player.pause();
    emergencyAlert.player.src=alarmUrl();
    emergencyAlert.player.currentTime=0;
    emergencyAlert.player.play().catch(err=>console.warn('[Central] Audio de alarma bloqueado o no disponible:',err));
  }
  function setEmergencySoundEnabled(enabled){
    emergencyAlert.enabled=!!enabled;
    if(!enabled)stopEmergencyTone();
    else if(emergencyAlert.active.size&&!emergencyAlert.timer){
      playEmergencyTone();
      emergencyAlert.timer=setInterval(playEmergencyTone,6000);
    }
    updateEmergencySoundButton();
  }
  function renderEmergencyOverlay() {
    let overlay = document.getElementById('empEmergencyOverlay');
    if (!overlay) {
      overlay = document.createElement('section');
      overlay.id = 'empEmergencyOverlay';
      overlay.className = 'emp-emergency-overlay';
      overlay.setAttribute('role','alertdialog');
      overlay.setAttribute('aria-label','Emergencia entrante');
      document.body.appendChild(overlay);
    }
    const items = Array.from(emergencyAlert.active.values());
    overlay.hidden = items.length === 0;
    if (!items.length) { stopEmergencyTone(); return; }
    overlay.replaceChildren();
    const title = el('h2', {textContent: '🚨 NUEVA ALERTA DE EMERGENCIA'});
    overlay.appendChild(title);
    overlay.appendChild(el('p',{textContent:items.length === 1 ? 'Requiere atención de Central' : items.length + ' alertas requieren atención'}));
    const inc = items[0];
    overlay.appendChild(el('div',{className:'emp-emergency-description',textContent:alertLabel(inc)}));
    overlay.appendChild(el('div',{className:'emp-emergency-id',textContent:'Incidente: '+inc.id}));
    const actions=el('div',{className:'emp-emergency-actions'});
    const view=el('button',{type:'button',textContent:'VER INCIDENTE',onclick:()=>{
      ui.baseFilter='ALL';const sel=document.getElementById('centralBaseSelector');if(sel)sel.value='ALL';
      ui.incidentFilter='active';document.querySelectorAll('.btn-incident-filter').forEach(b=>b.classList.toggle('active',b.dataset.filter==='active'));
      ui.selectedIncidentId=inc.id;emergencyAlert.active.delete(String(inc.id));renderEmergencyOverlay();renderAll();
      document.querySelector('.central-col-2')?.scrollIntoView({behavior:'smooth',block:'start'});
    }});
    const dismiss=el('button',{type:'button',textContent:'SILENCIAR / CERRAR AVISO',onclick:()=>{
      emergencyAlert.active.delete(String(inc.id));renderEmergencyOverlay();
    }});
    actions.append(view,dismiss);overlay.appendChild(actions);
    if(emergencyAlert.enabled&&!emergencyAlert.timer){playEmergencyTone();emergencyAlert.timer=setInterval(playEmergencyTone,6000);}
  }
  function checkNewEmergencyAlerts() {
    const pending=pendingAlerts(), ids=new Set(pending.map(i=>String(i.id)));
    if (!emergencyAlert.initialized) {
      // Alertas aún pendientes deben mostrarse incluso tras recargar Central.
      pending.forEach(i=>{const id=String(i.id);emergencyAlert.known.add(id);emergencyAlert.active.set(id,i);});
      emergencyAlert.initialized=true;
      renderEmergencyOverlay();
      return;
    }
    pending.forEach(inc=>{
      const id=String(inc.id);
      if(!emergencyAlert.known.has(id)){
        emergencyAlert.known.add(id);
        emergencyAlert.active.set(id,inc);
      }
    });
    for(const id of emergencyAlert.active.keys())if(!ids.has(id))emergencyAlert.active.delete(id);
    renderEmergencyOverlay();
  }
  function initEmergencyAudio(){
    const controls=document.querySelector('.header-controls');
    if(!controls||document.getElementById('btnEmergencySound'))return;
    try{
      const stored=Number(localStorage.getItem('emp-central-alarm-choice'));
      if(Number.isInteger(stored)&&stored>=0&&stored<EMP_ALARM_FILES.length)emergencyAlert.choice=stored;
    }catch(_){}
    const wrapper=document.createElement('label');
    wrapper.className='emp-alarm-picker';
    wrapper.textContent='Sonido de alarma';
    const select=document.createElement('select');
    select.id='empAlarmChoice';
    select.setAttribute('aria-label','Elegir sonido de emergencia');
    EMP_ALARM_FILES.forEach((item,i)=>{
      const opt=document.createElement('option');opt.value=String(i);opt.textContent=item.name;select.appendChild(opt);
    });
    select.value=String(emergencyAlert.choice);
    select.addEventListener('change',()=>{
      emergencyAlert.choice=Number(select.value);
      try{localStorage.setItem('emp-central-alarm-choice',String(emergencyAlert.choice));}catch(_){}
      if(emergencyAlert.player){emergencyAlert.player.pause();emergencyAlert.player.src=alarmUrl();}
      if(emergencyAlert.preview){emergencyAlert.preview.pause();emergencyAlert.preview.src=alarmUrl();}
      toast('Alarma seleccionada: '+EMP_ALARM_FILES[emergencyAlert.choice].name);
    });
    wrapper.appendChild(select);
    const preview=el('button',{type:'button',id:'btnPreviewAlarm',className:'btn-emergency-sound',textContent:'▶ Probar sonido',onclick:()=>{
      if(!emergencyAlert.preview)emergencyAlert.preview=new Audio();
      const player=emergencyAlert.preview;
      if(!player.paused){player.pause();player.currentTime=0;return;}
      player.src=alarmUrl();player.currentTime=0;
      player.play().catch(err=>toast('No se pudo reproducir: '+(err.message||err)));
    }});
    const btn=el('button',{type:'button',id:'btnEmergencySound',className:'btn-emergency-sound',textContent:'🔔 Activar alarma',onclick:()=>{
      setEmergencySoundEnabled(!emergencyAlert.enabled);
      if(emergencyAlert.enabled){
        if(!emergencyAlert.active.size)playEmergencyTone();
        toast('Alarma activada');
      }else{
        if(emergencyAlert.preview){emergencyAlert.preview.pause();emergencyAlert.preview.currentTime=0;}
        toast('Alarma desactivada');
      }
    }});
    controls.prepend(btn);
    controls.insertBefore(preview,btn);
    controls.insertBefore(wrapper,preview);
    updateEmergencySoundButton();
    // La activación de audio requiere interacción del operador por política del navegador.
    // El aviso visual, en cambio, nunca depende de que el audio esté habilitado.
    const notice=document.createElement('span');
    notice.id='empAlarmStatusHint';
    notice.textContent='Para recibir sonido: tocá «Activar alarma» una vez.';
    notice.style.cssText='font-size:11px;color:#fbbf24;max-width:180px';
    controls.insertBefore(notice,wrapper);
  }

  // ============ MAPA LEAFLET ============
  function initMap() {
    const container = document.getElementById('mapContainer');
    if (!container || typeof L === 'undefined') {
      console.warn('[app-central] Leaflet no disponible o contenedor ausente.');
      return;
    }
    const baseCfg = (C.BASES && C.BASES.DOLORES) || {};
    const center = (baseCfg.coords && typeof baseCfg.coords.lat === 'number')
      ? [baseCfg.coords.lat, baseCfg.coords.lng]
      : [-36.3133, -56.9100];

    ui.map = L.map(container, {zoomControl:false,attributionControl:true,preferCanvas:true}).setView(center, 12);
    L.control.zoom({position:'bottomright'}).addTo(ui.map);
    // OpenStreetMap: mapa público sin clave de API ni marcas de agua de proveedor.
    const standard=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'© OpenStreetMap contributors'
    });
    standard.addTo(ui.map);
    setTimeout(() => { try { ui.map.invalidateSize(); } catch (_) {} }, 300);
  }

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

  function renderMapMarkers() {
    if (!ui.map) return;
    const incidents = Store.getIncidents(ui.baseFilter);
    const active = incidents.filter(i => ['CERRADA', 'CANCELADA'].indexOf(i.status) === -1);
    const seenKeys = new Set();
    const bounds = [];
    const missingDestinations=[];

    active.forEach(inc => {
      const loc=inc.location;
      const destLat=Number(loc?.lat ?? loc?.latitude);
      const destLng=Number(loc?.lng ?? loc?.lon ?? loc?.longitude);
      if (loc && Number.isFinite(destLat) && Number.isFinite(destLng) && Math.abs(destLat)<=90 && Math.abs(destLng)<=180) {
        const key = 'inc_' + inc.id;
        seenKeys.add(key);
        const latlng = [destLat, destLng];
        bounds.push(latlng);
        const popupHtml = '<strong>🚨 DESTINO DEL INCIDENTE</strong><br>' + inc.id + '<br>' +
          'Estado: ' + inc.status + '<br>' +
          (inc.manualAddress ? ('Dir: ' + inc.manualAddress + '<br>') : '') +
          (inc.profileDni ? ('DNI: ' + inc.profileDni + '<br>') : '');
        if (ui.mapMarkers[key]) {
          ui.mapMarkers[key].setLatLng(latlng);
          ui.mapMarkers[key].setPopupContent(popupHtml);
        } else {
          ui.mapMarkers[key] = L.marker(latlng, { icon: incidentIcon(inc.status), zIndexOffset: 1000 })
            .addTo(ui.map)
            .bindPopup(popupHtml);
        }
      } else { missingDestinations.push(inc); }

      if (inc.assignedUnitId && inc.unitLocation && typeof inc.unitLocation.lat === 'number') {
        const key = 'unit_' + inc.id;
        seenKeys.add(key);
        const latlng = [inc.unitLocation.lat, inc.unitLocation.lng];
        bounds.push(latlng);
        const speedTxt = (typeof inc.unitLocation.speed === 'number')
          ? (inc.unitLocation.speed * 3.6).toFixed(0) + ' km/h'
          : 'sin dato';
        const popupHtml = '<strong>' + inc.assignedUnitId + '</strong><br>' +
          'Incidente: ' + inc.id + '<br>' +
          'Velocidad: ' + speedTxt + '<br>' +
          'Actualizado: ' + (inc.unitLocation.ts ? fmtTime(inc.unitLocation.ts) : '—');
        if (ui.mapMarkers[key]) {
          ui.mapMarkers[key].setLatLng(latlng);
          ui.mapMarkers[key].setPopupContent(popupHtml);
          ui.mapMarkers[key].setIcon(unitIcon(inc.status));
        } else {
          ui.mapMarkers[key] = L.marker(latlng, { icon: unitIcon(inc.status) })
            .addTo(ui.map)
            .bindPopup(popupHtml);
        }
      }
    });

    Object.keys(ui.mapMarkers).forEach(key => {
      if (!seenKeys.has(key)) {
        try { ui.map.removeLayer(ui.mapMarkers[key]); } catch (_) {}
        delete ui.mapMarkers[key];
      }
    });

    // No confundir la posición del móvil con la ubicación de la emergencia.
    // Mostrar el detalle de cada incidente sin coordenadas y su dirección textual.
    const mapEl=document.getElementById('mapContainer');
    if(mapEl){
      let note=document.getElementById('empMissingDestinations');
      if(!note){note=document.createElement('div');note.id='empMissingDestinations';note.className='emp-map-location-note';mapEl.parentNode.insertBefore(note,mapEl.nextSibling);}
      note.replaceChildren();
      note.hidden=missingDestinations.length===0;
      if(missingDestinations.length){
        note.appendChild(el('strong',{textContent:'⚠ '+missingDestinations.length+' destino(s) sin punto GPS'}));
        note.appendChild(el('p',{textContent:'La dirección escrita no es una coordenada. El GPS del móvil no representa el domicilio del incidente.'}));
        missingDestinations.forEach(inc=>{
          const line=el('div',{className:'emp-missing-destination-row'});
          line.appendChild(el('span',{textContent:'Incidente '+String(inc.id).slice(0,12)+' · '+(inc.manualAddress||'Sin dirección registrada')}));
          if(inc.manualAddress){
            const link=el('a',{href:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(inc.manualAddress+', '+(inc.baseId==='LA_COSTA'?'Partido de La Costa':'Dolores')+', Buenos Aires, Argentina'),target:'_blank',rel:'noopener',textContent:'Buscar dirección ↗'});
            line.appendChild(link);
          }
          note.appendChild(line);
        });
      }
    }

    // Priorizar el destino del incidente seleccionado. Evitar reencuadrar
    // continuamente el mapa cuando el operador está explorando manualmente.
    const selected=active.find(i=>i.id===ui.selectedIncidentId);
    const selectedLoc=selected?.location;
    const validSelectedLoc=selectedLoc && Number.isFinite(Number(selectedLoc.lat ?? selectedLoc.latitude)) && Number.isFinite(Number(selectedLoc.lng ?? selectedLoc.longitude));
    const focus=validSelectedLoc ? {lat:Number(selectedLoc.lat ?? selectedLoc.latitude),lng:Number(selectedLoc.lng ?? selectedLoc.longitude)} : selected?.unitLocation;
    if(focus&&typeof focus.lat==='number'){
      const key=selected.id+':'+focus.lat.toFixed(5)+':'+focus.lng.toFixed(5);
      if(ui.lastMapFocus!==key){
        const target=[focus.lat,focus.lng];
        if(selected?.location && selected?.unitLocation && typeof selected.unitLocation.lat==='number'){
          ui.map.fitBounds([target,[selected.unitLocation.lat,selected.unitLocation.lng]],{padding:[55,55],maxZoom:16,animate:true});
        }else ui.map.setView(target,Math.max(ui.map.getZoom(),15),{animate:true});
        ui.lastMapFocus=key;
      }
    }else if(!ui.lastMapFocus&&bounds.length){
      if(bounds.length===1)ui.map.setView(bounds[0],14);
      else ui.map.fitBounds(bounds,{padding:[30,30],maxZoom:15});
      ui.lastMapFocus='initial';
    }
  }

  // ============ F2: PUSH Y ON_DUTY ============
  async function setOnDutyStatus(isOnDuty) {
    try {
      const rawState = typeof Store._getState === 'function' ? Store._getState() : null;
      const sb = rawState && rawState.supabase;
      const user = typeof Store.getUser === 'function' ? Store.getUser() : (rawState && rawState.user);
      const profileId = ui.operatorId || (rawState && rawState.profile && rawState.profile.id);
      if (!sb || (!profileId && !user)) return false;

      let query = sb.from('profiles').update({ on_duty: !!isOnDuty });
      if (profileId) query = query.eq('id', profileId);
      else query = query.eq('user_id', user.id);

      const { error } = await query;
      if (!error) {
        ui.onDuty = !!isOnDuty;
        return true;
      }
    } catch (e) {
      console.warn('[app-central] Error actualizando on_duty:', e);
    }
    return false;
  }

  async function initPushRegistration() {
    try {
      await setOnDutyStatus(true);
      const cap = window.E360Capacitor;
      if (!cap || typeof cap.registerPushToken !== 'function') return;

      const rawState = typeof Store._getState === 'function' ? Store._getState() : null;
      const sb = rawState && rawState.supabase;
      const authUser = typeof Store.getUser === 'function' ? Store.getUser() : (rawState && rawState.user);
      const targetUserId = (authUser && authUser.id) || ui.operatorId;
      if (!sb || !targetUserId) return;

      const res = await cap.registerPushToken(sb, targetUserId);
      if (!res || !res.ok) {
        console.error('[EMP Central] Push FCM no registrado:', res && res.error);
        toast('⚠ Notificaciones de emergencia no activadas: ' + ((res && res.error) || 'verificá permisos y Firebase'));
      } else {
        console.info('[EMP Central] Push FCM registrado correctamente');
      }
    } catch (err) {
      console.warn('[app-central] initPushRegistration:', err);
    }
  }

  function checkDeepLinkIncident() {
    try {
      const params = new URLSearchParams(window.location.search);
      const incId = params.get('incident');
      if (incId && Store.getIncidentById(incId)) {
        ui.selectedIncidentId = incId;
      }
    } catch (_) {}
  }

  // ============ LOGIN ============
  function showLogin() {
    const ov = $('#centralLoginOverlay'); if (ov) ov.hidden = false;
    const app = $('#centralApp'); if (app) app.hidden = true;
  }
  function hideLogin() {
    const ov = $('#centralLoginOverlay'); if (ov) ov.hidden = true;
    const app = $('#centralApp'); if (app) app.hidden = false;
  }

  function initLogin() {
    const form = $('#centralLoginForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#centralLoginMsg');
      const btn = $('#centralLoginBtn');
      const email = $('#centralLoginEmail').value.trim();
      const password = $('#centralLoginPassword').value;
      if (!email || !password) {
        if (msg) { msg.textContent = 'Completá email y contraseña.'; msg.style.color = '#DC2626'; }
        return;
      }
      await runLoading(btn, async () => {
        try {
          const profile = await Store.loginWithEmail(email, password);
          if (!profile || !(await Store.hasEMPRole(['operador','admin']))) {
            await Store.logout();
            throw new Error('Tu cuenta no tiene permisos de operador.');
          }
          ui.operatorName = profile.nombre || profile.dni;
          ui.operatorId = profile.id;
          hideLogin();
          await bootCentral();
          await initPushRegistration();
        } catch (err) {
          if (msg) { msg.textContent = fmtErr(err); msg.style.color = '#DC2626'; }
        }
      }, 'Ingresando…');
    });
    const logout = $('#centralLogout');
    if (logout) logout.addEventListener('click', async () => {
      if (!confirm('¿Cerrar sesión y salir de guardia?')) return;
      // F3-mejora: destruir PTT flotante al salir
      destroyFloatingPTT();
      await runLoading(logout, async () => {
        await setOnDutyStatus(false);
        await Store.logout();
        location.reload();
      }, 'Saliendo…');
    });
  }

  // ============ BRANDING ============
  async function applyBranding() {
    try {
      const b = typeof Store.applyBrandingToPage === 'function'
        ? await Store.applyBrandingToPage()
        : await Store.loadBranding();
      if (b && b.logoUrl) {
        const brand = $('#centralHeaderBrand');
        if (brand) {
          const svg = brand.querySelector('svg');
          if (svg) {
            const img = document.createElement('img');
            img.src = b.logoUrl;
            img.alt = 'EMP';
            img.className = 'emp-logo-chip';
            img.style.height = '38px';
            svg.replaceWith(img);
          }
        }
      }
    } catch (_) {}
  }

  // ============ FILTROS ============
  function initBaseSelector() {
    const sel = $('#centralBaseSelector');
    if (!sel) return;
    sel.value = ui.baseFilter;
    sel.addEventListener('change', () => {
      ui.baseFilter = sel.value;
      ui.selectedIncidentId = null;
      // F3-mejora: al cambiar base, si el PTT no corresponde al incidente seleccionado, destruirlo
      if (ui.pttIncidentId && ui.pttIncidentId !== ui.selectedIncidentId) destroyFloatingPTT();
      renderAll();
    });
  }

  function initIncidentFilters() {
    $$('.btn-incident-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.btn-incident-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ui.incidentFilter = btn.dataset.filter;
        renderIncidentList();
      });
    });
  }

  // ============ LÍMITE DE VELOCIDAD ============
  async function renderSpeedLimitControl() {
    const input = $('#speedLimitInput');
    const btn = $('#btnApplySpeedLimit');
    const status = $('#speedLimitStatus');
    if (!input || !btn) return;

    try {
      const current = await Store.getSpeedLimit();
      input.value = current;
      if (status) status.textContent = 'Límite actual: ' + current + ' km/h';
    } catch (err) {
      if (status) status.textContent = 'No se pudo leer el límite actual.';
    }

    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', async () => {
      if (!onlineOrToast()) return;
      const val = parseInt(input.value, 10);
      if (!val || val < 10 || val > 160) {
        if (status) status.textContent = 'Valor inválido (10–160 km/h).';
        return;
      }
      await runLoading(btn, async () => {
        try {
          await Store.setSpeedLimit(val);
          if (status) status.textContent = 'Límite guardado: ' + val + ' km/h';
          toast('Límite de velocidad actualizado a ' + val + ' km/h');
        } catch (err) {
          if (status) status.textContent = 'Error: ' + fmtErr(err);
        }
      }, 'Guardando…');
    });
  }

  // ============ BANDEJA ============
  function renderAlertCounter() {
    const counter = $('#alertCounter');
    if (!counter) return;
    const incidents = Store.getIncidents(ui.baseFilter);
    const pending = incidents.filter(i => i.status === 'RECIBIDA_SERVIDOR').length;
    counter.textContent = String(pending);
    if (pending > 0) counter.classList.add('pulse');
    else counter.classList.remove('pulse');
    ui.lastPendingCount = pending;
  }

  function renderIncidentList() {
    const list = $('#incidentList');
    const empty = $('#incidentEmpty');
    if (!list) return;
    list.innerHTML = '';
    const all = Store.getIncidents(ui.baseFilter);
    const closedStates = ['CERRADA', 'CANCELADA'];
    let items = ui.incidentFilter === 'active'
      ? all.filter(i => !closedStates.includes(i.status))
      : all.filter(i => closedStates.includes(i.status));
    if (!items.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    items.forEach(inc => {
      const pendingClass = inc.status === 'RECIBIDA_SERVIDOR' ? ' pending' : '';
      const selectedClass = inc.id === ui.selectedIncidentId ? ' selected' : '';
      const hasSupport = Array.isArray(inc.supportRequests) && inc.supportRequests.length > 0;
      list.appendChild(el('li', {
        className: 'incident-card' + pendingClass + selectedClass,
        onclick: () => { ui.selectedIncidentId = inc.id; renderIncidentList(); renderDetail(); }
      }, [
        el('div', { className: 'card-top' }, [
          el('span', { className: 'card-id', textContent: inc.id }),
          el('span', { className: 'card-time', textContent: fmtTime(inc.createdAt) })
        ]),
        el('div', { className: 'card-meta' }, [
          el('span', { className: 'badge badge-state-' + inc.status, textContent: inc.status }),
          inc.priority ? el('span', { className: 'badge badge-priority-' + inc.priority, textContent: inc.priority }) : null,
          hasSupport ? el('span', { className: 'badge badge-priority-ROJO', textContent: '🚨 PIDE APOYO' }) : null
        ].filter(Boolean)),
        el('div', { className: 'card-loc', textContent: 'Base: ' + (inc.baseId || 'DOLORES') + ' · ' + (inc.manualAddress || (inc.location ? ('GPS ' + inc.location.lat.toFixed(4) + ',' + inc.location.lng.toFixed(4)) : 'Sin ubicación')) })
      ]));
    });
  }

  // ============ DETALLE ============
  function kv(k, v) {
    return el('div', { className: 'kv' }, [
      el('span', { className: 'k', textContent: k }),
      el('span', { className: 'v', textContent: v || '—' })
    ]);
  }

  async function renderDetail() {
    const container = $('#detailContainer');
    if (!container) return;
    container.innerHTML = '';

    // F3-mejora: si el incidente seleccionado cambió y hay PTT de otro incidente, destruirlo
    if (ui.pttIncidentId && ui.pttIncidentId !== ui.selectedIncidentId) {
      destroyFloatingPTT();
    }

    if (!ui.selectedIncidentId) {
      container.appendChild(el('div', { className: 'detail-empty', textContent: 'Seleccioná un incidente.' }));
      renderFloatingPTT(null);
      return;
    }
    const inc = Store.getIncidentById(ui.selectedIncidentId);
    if (!inc) {
      container.appendChild(el('div', { className: 'detail-empty', textContent: 'Incidente no disponible.' }));
      renderFloatingPTT(null);
      return;
    }

    if (Array.isArray(inc.supportRequests) && inc.supportRequests.length > 0) {
      const supBlock = el('div', { className: 'alerta-clinica' }, [
        el('strong', { textContent: '🚨 SOLICITUDES DE APOYO EN ESCENA (' + inc.supportRequests.length + ')' })
      ]);
      inc.supportRequests.forEach(sr => {
        supBlock.appendChild(el('div', { className: 'clin-row' }, [
          el('strong', { textContent: sr.type + ': ' }),
          el('span', { textContent: (sr.notes || 'Sin detalle') + ' · (' + fmtTime(sr.ts) + ' - ' + (sr.requestedBy || 'guardia') + ')' })
        ]));
      });
      container.appendChild(supBlock);
    }

    if (inc.b2bEstablishmentId) {
      const est = Store.getB2BById(inc.b2bEstablishmentId);
      if (est) {
        const b2bBlock = el('div', { className: 'detail-block' }, [
          el('h3', { textContent: '📍 Ingreso por QR Área Protegida B2B' }),
          kv('Establecimiento', est.name),
          kv('Rubro', est.type),
          kv('Dirección', est.address),
          kv('Teléfono referente', est.referencePhone),
          kv('Protocolo', est.protocol)
        ]);
        container.appendChild(b2bBlock);
      }
    }

    const patientBlock = el('div', { className: 'detail-block' }, [el('h3', { textContent: 'Datos del Socio' })]);
    let profile = null;
    try {
      const profiles = Store.listProfiles();
      profile = profiles.find(p => p.dni === inc.profileDni);
    } catch (_) {}

    if (profile) {
      patientBlock.appendChild(kv('Nombre', profile.nombre));
      patientBlock.appendChild(kv('DNI', profile.dni));
      patientBlock.appendChild(kv('N° socio', profile.socioNumber));
      patientBlock.appendChild(kv('Plan', (C.PLANS[profile.plan] || {}).label || profile.plan));
      patientBlock.appendChild(kv('Teléfono', profile.telefono));
      patientBlock.appendChild(kv('Grupo sanguíneo', profile.grupoSanguineo));
      patientBlock.appendChild(kv('Alergias', profile.alergias));
      patientBlock.appendChild(kv('Patologías', profile.patologias));
      patientBlock.appendChild(kv('Contacto emergencia', profile.contacto));

      try {
        const meds = await Store.getMedicationsForProfile(profile.id);
        if (meds.length) {
          const medsBlock = el('div', { className: 'detail-block' }, [el('h3', { textContent: '💊 Medicación activa' })]);
          meds.forEach(m => {
            medsBlock.appendChild(el('div', { className: 'med-line' }, [
              el('strong', { textContent: m.nombre }),
              el('span', { textContent: ' — ' + (m.dosis || '') + (m.frecuencia ? ' · ' + m.frecuencia : '') + (m.horarios && m.horarios.length ? ' · ' + m.horarios.join(', ') : '') })
            ]));
          });
          patientBlock.appendChild(medsBlock);
        }
      } catch (_) {}
    } else {
      patientBlock.appendChild(el('div', { className: 'warn-operador', textContent: 'Socio sin ficha.' }));
    }

    const geoBlock = el('div', { className: 'detail-block' }, [el('h3', { textContent: 'Ubicación y ETA' })]);
    if (inc.location) {
      geoBlock.appendChild(kv('Coordenadas', inc.location.lat.toFixed(6) + ', ' + inc.location.lng.toFixed(6)));
      geoBlock.appendChild(el('a', {
        href: 'https://www.openstreetmap.org/?mlat=' + inc.location.lat + '&mlon=' + inc.location.lng + '#map=17/' + inc.location.lat + '/' + inc.location.lng,
        target: '_blank', rel: 'noopener', className: 'gps-link', textContent: '🗺 Abrir en OpenStreetMap'
      }));
    }
    if (inc.manualAddress) geoBlock.appendChild(kv('Dirección manual', inc.manualAddress));

    if (inc.assignedUnitId && inc.unitLocation) {
      const ul = inc.unitLocation;
      if (typeof ul.lat === 'number') {
        geoBlock.appendChild(kv('Posición unidad', ul.lat.toFixed(6) + ', ' + ul.lng.toFixed(6)));
      }
      if (typeof ul.speed === 'number') {
        geoBlock.appendChild(kv('Velocidad unidad', (ul.speed * 3.6).toFixed(0) + ' km/h'));
      }
      if (ul.ts) {
        geoBlock.appendChild(kv('Última actualización GPS', fmtTime(ul.ts)));
      }
    }

    try {
      const eta = Store.getIncidentEta(inc.id);
      if (eta && eta.hasEta) {
        geoBlock.appendChild(kv('ETA referencial', eta.etaMinutes + ' min (' + (eta.source === 'gps' ? 'GPS Móvil · velocidad real' : 'Estimación Base · 40 km/h') + ')'));
      }
    } catch (_) {}

    const actionsBlock = buildActions(inc);

    if (inc.assignedUnitId && ['EN_CAMINO', 'EN_ESCENA'].indexOf(inc.status) !== -1) {
      container.appendChild(patientBlock);
      container.appendChild(geoBlock);
      container.appendChild(actionsBlock);
      container.appendChild(buildPTTBlock(inc)); // bloque embebido (referencia + unlock contextual)
      container.appendChild(buildMediaBlock(inc));
    } else {
      container.appendChild(patientBlock);
      container.appendChild(geoBlock);
      container.appendChild(actionsBlock);
      container.appendChild(buildMediaBlock(inc));
    }

    if (inc.status === 'CERRADA' && inc.clinicalRecordNumber) {
      container.appendChild(buildExportBlock(inc));
    }

    const bitacoraBlock = el('div', { className: 'detail-block' }, [
      el('h3', { textContent: 'Bitácora' }),
      el('ul', { className: 'bitacora-list' }, (inc.statusHistory || []).slice().reverse().map(h =>
        el('li', {}, [
          el('strong', { textContent: h.status }),
          el('span', { textContent: ' · ' + fmtDateTime(h.ts) + ' · ' + (h.actor || 'system') }),
          h.detail ? el('div', { textContent: h.detail }) : null
        ].filter(Boolean))
      ))
    ]);
    container.appendChild(bitacoraBlock);

    // F3-mejora: render del PTT flotante
    renderFloatingPTT(inc);
  }

  function buildActions(inc) {
    const block = el('div', { className: 'detail-actions' });
    const op = ui.operatorName || 'central';

    const run = async (btn, fn, label) => {
      if (!onlineOrToast()) return;
      await runLoading(btn, async () => {
        try { await fn(); renderAll(); }
        catch (err) { alert('Acción rechazada: ' + fmtErr(err)); }
      }, label);
    };

    const appendCancelBtn = () => {
      const cancelBtn = el('button', {
        type: 'button', className: 'btn-action btn-danger', textContent: 'Cancelar Incidente',
        onclick: () => {
          if (!onlineOrToast()) return;
          const reason = prompt('Motivo de cancelación (obligatorio):');
          if (!reason) return;
          run(cancelBtn, () => Store.cancelIncident(inc.id, reason, op), 'Cancelando…');
        }
      });
      block.appendChild(cancelBtn);
    };

    switch (inc.status) {
      case 'RECIBIDA_SERVIDOR': {
        const bAck = el('button', {
          type: 'button', className: 'btn-action btn-warn', textContent: '1. Acusar recibo',
          onclick: () => run(bAck, () => Store.acknowledgeIncident(inc.id, op), 'Acusando recibo…')
        });
        block.appendChild(bAck);
        appendCancelBtn();
        return block;
      }
      case 'ACEPTADA_POR_CENTRAL': {
        const bTri = el('button', {
          type: 'button', className: 'btn-action btn-ok', textContent: 'Confirmar Triage',
          onclick: () => run(bTri, () => Store.triageIncident(
            inc.id,
            $('#triagePriority').value,
            $('#triageNotes').value,
            $('#triageGuardia').value,
            op
          ), 'Clasificando…')
        });
        block.appendChild(el('div', { className: 'inline-form' }, [
          el('label', {}, [
            el('span', { textContent: '2. Prioridad (Triage)' }),
            (function () {
              const sel = el('select', { id: 'triagePriority' });
              sel.appendChild(el('option', { value: 'ROJO', textContent: 'ROJO — Emergencia' }));
              sel.appendChild(el('option', { value: 'AMARILLO', textContent: 'AMARILLO — Urgencia' }));
              sel.appendChild(el('option', { value: 'VERDE', textContent: 'VERDE — Baja complejidad' }));
              return sel;
            })()
          ]),
          el('label', {}, [
            el('span', { textContent: 'Tipo de guardia' }),
            (function () {
              const sel = el('select', { id: 'triageGuardia' });
              sel.appendChild(el('option', { value: 'AMB', textContent: 'AMB — Ambulancia / móvil EMP' }));
              sel.appendChild(el('option', { value: '107', textContent: '107 — Emergencia pública' }));
              sel.appendChild(el('option', { value: 'ENF', textContent: 'ENF — Enfermería domiciliaria' }));
              sel.appendChild(el('option', { value: 'DOM', textContent: 'DOM — Guardia domiciliaria' }));
              sel.appendChild(el('option', { value: 'VIR', textContent: 'VIR — Teleconsulta' }));
              sel.appendChild(el('option', { value: 'AP', textContent: 'AP — Área Protegida B2B' }));
              sel.appendChild(el('option', { value: 'EP', textContent: 'EP — Evento Privado' }));
              return sel;
            })()
          ]),
          el('label', {}, [
            el('span', { textContent: 'Observación' }),
            el('textarea', { id: 'triageNotes', rows: '2', maxlength: '300' })
          ]),
          bTri
        ]));
        appendCancelBtn();
        return block;
      }
      case 'CLASIFICADA': {
        const units = Store.getFleet(inc.baseId).filter(u => u.status === 'disponible');
        const bAss = el('button', {
          type: 'button', className: 'btn-action btn-ok', textContent: 'Asignar',
          disabled: !units.length,
          onclick: () => run(bAss, () => Store.assignUnitToIncident(inc.id, $('#assignUnitId').value, $('#assignCrew').value, op), 'Asignando móvil…')
        });
        block.appendChild(el('div', { className: 'inline-form' }, [
          el('label', {}, [
            el('span', { textContent: '3. Asignar móvil' }),
            (function () {
              const sel = el('select', { id: 'assignUnitId' });
              if (!units.length) sel.appendChild(el('option', { value: '', textContent: '— Sin móviles —' }));
              else units.forEach(u => sel.appendChild(el('option', { value: u.id, textContent: u.unit + ' (' + u.tipoUnidad + ')' })));
              return sel;
            })()
          ]),
          el('label', {}, [
            el('span', { textContent: 'Dotación / notas' }),
            el('input', { type: 'text', id: 'assignCrew', maxlength: '120' })
          ]),
          bAss
        ]));
        appendCancelBtn();
        return block;
      }
      case 'MOVIL_ASIGNADO': {
        const bDisp = el('button', {
          type: 'button', className: 'btn-action btn-ok', textContent: '4. Confirmar salida — Móvil en camino',
          onclick: () => run(bDisp, () => Store.dispatchIncidentUnit(inc.id, op), 'Despachando…')
        });
        block.appendChild(bDisp);
        appendCancelBtn();
        return block;
      }
      case 'EN_CAMINO': {
        const bScn = el('button', {
          type: 'button', className: 'btn-action btn-ok', textContent: '5. Marcar arribo en escena',
          onclick: () => run(bScn, () => Store.markIncidentOnScene(inc.id, op), 'Marcando arribo…')
        });
        block.appendChild(bScn);
        appendCancelBtn();
        return block;
      }
      case 'EN_ESCENA': {
        const bTr = el('button', {
          type: 'button', className: 'btn-action', textContent: 'Registrar traslado',
          onclick: () => run(bTr, () => Store.markIncidentInTransit(inc.id, $('#destCenter').value, op), 'Registrando traslado…')
        });
        block.appendChild(el('div', { className: 'inline-form' }, [
          el('label', {}, [
            el('span', { textContent: '6. Centro receptor (traslado)' }),
            el('input', { type: 'text', id: 'destCenter', maxlength: '120', placeholder: 'Ej: Hospital San Roque' })
          ]),
          bTr,
          buildCloseForm(inc, op, run)
        ]));
        return block;
      }
      case 'EN_TRASLADO':
        block.appendChild(el('div', { className: 'inline-form' }, [buildCloseForm(inc, op, run)]));
        return block;
      case 'CERRADA':
      case 'CANCELADA':
        block.appendChild(el('div', { className: 'warn-operador', textContent: 'Incidente finalizado. Motivo: ' + (inc.closureReason || '—') }));
        if (inc.outcomeNotes) block.appendChild(el('div', { className: 'detail-block', textContent: inc.outcomeNotes }));
        return block;
      default:
        block.appendChild(el('div', { className: 'warn-operador', textContent: 'Estado no manejado: ' + inc.status }));
        return block;
    }
  }

  function buildCloseForm(inc, op, run) {
    const reasons = ['Atención en domicilio sin traslado', 'Traslado efectivo a centro de salud', 'Falsa alarma', 'Derivado a sistema público'];
    const sel = el('select', { id: 'closeReason' });
    reasons.forEach(r => sel.appendChild(el('option', { value: r, textContent: r })));
    const bCl = el('button', {
      type: 'button', className: 'btn-action btn-ok', textContent: 'Cerrar incidente',
      onclick: () => run(bCl, () => Store.closeIncident(inc.id, $('#closeReason').value, $('#closeNotes').value, op), 'Cerrando…')
    });
    return el('div', { className: 'inline-form' }, [
      el('label', {}, [el('span', { textContent: 'Motivo de cierre' }), sel]),
      el('label', {}, [el('span', { textContent: 'Notas de cierre (obligatorias)' }), el('textarea', { id: 'closeNotes', rows: '2', maxlength: '400' })]),
      bCl
    ]);
  }

  // ============ F3: PTT EMBEBIDO (referencia + unlock contextual) ============
  function buildPTTBlock(inc) {
    const block = el('div', { className: 'detail-block' }, [el('h3', { textContent: '📻 Comunicación PTT' })]);
    const pttReady = typeof window.E360PTT !== 'undefined';
    const stateEl = el('div', { className: 'ptt-status', textContent: pttReady ? 'PTT disponible. Usá el panel flotante (abajo a la derecha) para hablar.' : 'PTT no disponible en este dispositivo.' });

    if (!pttReady) {
      block.appendChild(stateEl);
      return block;
    }

    // F3-mejora: el botón de hablar ahora vive en el flotante.
    // Acá dejamos solo el botón de "Activar audio" si el autoplay bloqueó.
    try {
      const d = (window.E360PTT.debug ? window.E360PTT.debug() : null);
      if (d && d.remoteAudioExists && d.remoteAudioPaused) {
        const btnUnlock = el('button', {
          type: 'button',
          className: 'btn-action',
          textContent: '🔊 Activar audio',
          onclick: () => {
            window.E360PTT.unlockAudio().then(ok => toast(ok ? '🔊 Audio activado' : '❌ No se pudo activar'));
          }
        });
        block.appendChild(btnUnlock);
      }
    } catch (_) {}

    block.appendChild(stateEl);
    return block;
  }

  // ============ F3-mejora: PTT FLOTANTE EN CENTRAL ============
  function pttImage(name){return 'assets/ptt/ptt_'+name+'.png';}
  function updatePttVisual(wrapper,state){
    if(!wrapper)return;
    const img=wrapper.querySelector('.cv-ptt-image');
    if(img){img.src=pttImage(state);img.alt='PTT '+state.replaceAll('_',' ');}
    wrapper.dataset.pttState=state;
  }
  function makePttDraggable(wrapper,handle){
    let drag=null;
    handle.style.touchAction='none';
    handle.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      const rect=wrapper.getBoundingClientRect();
      drag={id:e.pointerId,dx:e.clientX-rect.left,dy:e.clientY-rect.top};
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove',e=>{
      if(!drag||drag.id!==e.pointerId)return;
      const x=Math.max(0,Math.min(window.innerWidth-wrapper.offsetWidth,e.clientX-drag.dx));
      const y=Math.max(0,Math.min(window.innerHeight-wrapper.offsetHeight,e.clientY-drag.dy));
      wrapper.style.left=x+'px';wrapper.style.top=y+'px';wrapper.style.right='auto';wrapper.style.bottom='auto';
    });
    const done=e=>{
      if(!drag||drag.id!==e.pointerId)return;
      drag=null;
      try{localStorage.setItem('emp-central-ptt-position',JSON.stringify({x:wrapper.offsetLeft,y:wrapper.offsetTop}));}catch(_){}
    };
    handle.addEventListener('pointerup',done);
    handle.addEventListener('pointercancel',done);
    try{
      const pos=JSON.parse(localStorage.getItem('emp-central-ptt-position')||'null');
      if(pos&&Number.isFinite(pos.x)&&Number.isFinite(pos.y)){
        wrapper.style.left=Math.max(0,Math.min(window.innerWidth-wrapper.offsetWidth,pos.x))+'px';
        wrapper.style.top=Math.max(0,Math.min(window.innerHeight-wrapper.offsetHeight,pos.y))+'px';
        wrapper.style.right='auto';wrapper.style.bottom='auto';
      }
    }catch(_){}
  }
  async function pttReadyCue(){
    // Indicador local breve: no sustituye la comprobación WebRTC de ambos extremos.
    try{
      const ctx=new (window.AudioContext||window.webkitAudioContext)();
      await ctx.resume();
      for(const [i,hz] of [740,1050].entries()){
        const osc=ctx.createOscillator(),gain=ctx.createGain(),at=ctx.currentTime+i*.11;
        osc.type='sine';osc.frequency.value=hz;
        gain.gain.setValueAtTime(.0001,at);gain.gain.linearRampToValueAtTime(.09,at+.015);
        gain.gain.exponentialRampToValueAtTime(.0001,at+.095);
        osc.connect(gain);gain.connect(ctx.destination);osc.start(at);osc.stop(at+.1);
      }
      setTimeout(()=>ctx.close().catch(()=>{}),600);
    }catch(_){}
  }

  function destroyFloatingPTT() {
    if (typeof window.E360PTT !== 'undefined') {
      try { window.E360PTT.destroy(); } catch (_) {}
    }
    ui.pttIncidentId = null;
    ui.pttConnected = false;
    const existing = document.getElementById('cvPttFloating');
    if (existing) existing.remove();
  }

  function renderFloatingPTT(incident) {
    let existing = document.getElementById('cvPttFloating');

    const canPTT = incident
      && ['EN_CAMINO', 'EN_ESCENA'].indexOf(incident.status) !== -1
      && typeof window.E360PTT !== 'undefined';

    if (!canPTT) {
      if (existing) existing.remove();
      return;
    }

    const isConnected = ui.pttIncidentId === incident.id && ui.pttConnected;

    // Re-render quirúrgico: si ya existe y el estado no cambió, solo actualizar
    if (existing) {
      const wasConnected = existing.dataset.connected === '1';
      if (wasConnected === isConnected) {
        // Actualizar botón conectar
        const connBtn = existing.querySelector('.cv-ptt-connect');
        if (connBtn) {
          connBtn.className = 'cv-ptt-connect' + (isConnected ? ' connected' : '');
          connBtn.innerHTML = isConnected ? '🔌<br>DESCONECTAR' : '🔗<br>CONECTAR';
        }
        const talkBtn = existing.querySelector('.cv-ptt-talk');
        if (talkBtn) talkBtn.disabled = !isConnected;
        if(existing.dataset.pttState!=='transmitiendo')updatePttVisual(existing,isConnected?'canal_abierto':'inactivo');
        // Mostrar/ocultar unlock según estado real
        updateUnlockButton(existing);
        return;
      }
      existing.remove();
      existing = null;
    }

    const wrapper = el('div', { className: 'cv-ptt-floating', id: 'cvPttFloating' });
    wrapper.dataset.connected = isConnected ? '1' : '0';
    const dragHandle=el('div',{className:'cv-ptt-drag',title:'Arrastrar PTT para moverlo'});
    dragHandle.appendChild(el('img',{src:pttImage('mover'),alt:'Mover PTT'}));
    dragHandle.appendChild(el('span',{textContent:'MOVER PTT'}));
    wrapper.appendChild(dragHandle);

    const statusEl = el('div', {
      className: 'cv-ptt-status',
      textContent: isConnected ? 'PTT conectado — presioná para hablar' : 'Conectá PTT para hablar con Guardia'
    });

    const connectBtn = el('button', {
      type: 'button',
      className: 'cv-ptt-connect' + (isConnected ? ' connected' : ''),
      innerHTML: isConnected ? '🔌<br>DESCONECTAR' : '🔗<br>CONECTAR',
      onclick: async () => {
        if (isConnected) {
          destroyFloatingPTT();
          toast('PTT desconectado');
          renderDetail();
        } else {
          if (!onlineOrToast()) return;
          try {
            updatePttVisual(wrapper,'abriendo_canal');
            const sb = Store._getState().supabase;
            const ok = await window.E360PTT.init(sb, incident.id, 'central');
            if (ok) {
              ui.pttIncidentId = incident.id;
              ui.pttConnected = true;
              toast('PTT conectado');
            } else {
              toast('❌ No se pudo conectar PTT (micrófono o canal)');
            }
          } catch (err) {
            toast('❌ Error PTT: ' + (err.message || 'desconocido'));
          }
          renderDetail();
        }
      }
    });

    const talkBtn = el('button', {
      type: 'button',
      className: 'cv-ptt-talk',
      textContent: '🎙 MANTENER PARA HABLAR',
      disabled: !isConnected
    });

    if (isConnected) {
      const startTalk = async (e) => {
        if (e) e.preventDefault();
        if (!onlineOrToast()) return;
        try {
          const sb = Store._getState().supabase;
          updatePttVisual(wrapper,'abriendo_canal');
          await window.E360PTT.startTalking(sb);
          await pttReadyCue();
          updatePttVisual(wrapper,'transmitiendo');
          talkBtn.textContent = '🔴 TRANSMITIENDO…';
          talkBtn.classList.add('is-transmitting');
          statusEl.textContent = '🔴 Transmitiendo a Guardia';
          if (navigator.vibrate) { try { navigator.vibrate(50); } catch (_) {} }
        } catch (err) {
          talkBtn.classList.remove('is-transmitting');
          updatePttVisual(wrapper,'canal_abierto');
          talkBtn.textContent = '🎙 MANTENER PARA HABLAR';
          statusEl.textContent = '❌ Error de conexión PTT';
          toast('❌ PTT error: ' + (err.message || 'desconocido'));
        }
      };
      const stopTalk = async (e) => {
        if (e) e.preventDefault();
        try {
          const sb = Store._getState().supabase;
          const path = await window.E360PTT.stopTalking(sb);
          talkBtn.textContent = '🎙 MANTENER PARA HABLAR';
          updatePttVisual(wrapper,'canal_abierto');
          talkBtn.classList.remove('is-transmitting');
          statusEl.textContent = path ? '✅ Clip guardado' : 'PTT detenido';
          if (path) { toast('Clip de audio guardado'); setTimeout(() => renderDetail(), 1500); }
        } catch (err) {
          talkBtn.classList.remove('is-transmitting');
          talkBtn.textContent = '🎙 MANTENER PARA HABLAR';
          statusEl.textContent = '❌ Error al detener PTT';
          toast('❌ ' + (err.message || 'error'));
        }
      };
      talkBtn.addEventListener('mousedown', startTalk);
      talkBtn.addEventListener('mouseup', stopTalk);
      talkBtn.addEventListener('mouseleave', stopTalk);
      talkBtn.addEventListener('touchstart', startTalk, { passive: false });
      talkBtn.addEventListener('touchend', stopTalk, { passive: false });
      talkBtn.addEventListener('touchcancel', stopTalk);
    }

    const visual=el('img',{className:'cv-ptt-image',src:pttImage(isConnected?'canal_abierto':'inactivo'),alt:'Estado PTT'});
    wrapper.appendChild(visual);
    wrapper.appendChild(statusEl);
    wrapper.appendChild(connectBtn);
    wrapper.appendChild(talkBtn);

    // F3-mejora: botón unlock contextual (solo si remoteAudioPaused)
    const unlockBtn = el('button', {
      type: 'button',
      className: 'cv-ptt-unlock',
      textContent: '🔊 Activar audio',
      style: 'display:none;',
      onclick: () => {
        window.E360PTT.unlockAudio().then(ok => {
          toast(ok ? '🔊 Audio activado' : '❌ No se pudo activar');
          updateUnlockButton(wrapper);
        });
      }
    });
    wrapper.appendChild(unlockBtn);

    document.body.appendChild(wrapper);
    makePttDraggable(wrapper,dragHandle);
    updateUnlockButton(wrapper);
  }

  // Muestra/oculta el botón unlock según el estado real de remoteAudio
  function updateUnlockButton(wrapper) {
    if (!wrapper) return;
    const unlockBtn = wrapper.querySelector('.cv-ptt-unlock');
    if (!unlockBtn) return;
    try {
      const d = window.E360PTT.debug();
      if (d && d.remoteAudioExists && d.remoteAudioPaused) {
        unlockBtn.style.display = 'block';
      } else {
        unlockBtn.style.display = 'none';
      }
    } catch (_) {
      unlockBtn.style.display = 'none';
    }
  }

  // ============ F3: MEDIA ============
  function buildMediaBlock(inc) {
    const block = el('div', { className: 'detail-block' }, [el('h3', { textContent: '📎 Adjuntos del incidente' })]);
    const listEl = el('div', { className: 'media-list', textContent: 'Cargando…' });

    const photoInput = document.createElement('input');
    photoInput.type = 'file';
    photoInput.accept = 'image/*';
    photoInput.capture = 'environment';
    photoInput.style.display = 'none';

    const photoBtn = el('button', {
      type: 'button', className: 'btn-action', textContent: '📷 Subir foto'
    });

    const videoBtn = el('button', {
      type: 'button', className: 'btn-action', textContent: '🎥 Grabar video (30s)'
    });

    const canUpload = ['RECIBIDA_SERVIDOR', 'ACEPTADA_POR_CENTRAL', 'CLASIFICADA', 'MOVIL_ASIGNADO', 'EN_CAMINO', 'EN_ESCENA'].indexOf(inc.status) !== -1;

    if (canUpload && typeof window.E360Media !== 'undefined') {
      const sb = Store._getState().supabase;

      photoBtn.addEventListener('click', () => {
        if (!onlineOrToast()) return;
        photoInput.click();
      });
      photoInput.addEventListener('change', async () => {
        if (!photoInput.files || !photoInput.files[0]) return;
        if (!onlineOrToast()) return;
        await runLoading(photoBtn, async () => {
          try {
            await window.E360Media.uploadPhoto(sb, inc.id, photoInput.files[0]);
            toast('Foto subida');
            await refreshMediaList();
          } catch (e) { toast('Error: ' + fmtErr(e)); }
        }, 'Subiendo…');
      });

      videoBtn.addEventListener('click', async () => {
        if (!onlineOrToast()) return;
        try {
          toast('Grabando 30s…');
          await window.E360Media.recordVideo(async (file) => {
            await runLoading(videoBtn, async () => {
              try {
                await window.E360Media.uploadVideo(sb, inc.id, file);
                toast('Video subido');
                await refreshMediaList();
              } catch (e) { toast('Error: ' + fmtErr(e)); }
            }, 'Subiendo…');
          });
        } catch (e) { toast('Error: ' + fmtErr(e)); }
      });
    }

    async function refreshMediaList() {
      try {
        const items = await Store.getIncidentMedia(inc.id);
        listEl.innerHTML = '';
        if (!items || items.length === 0) {
          listEl.appendChild(el('p', { className: 'empty-hint', textContent: 'Sin archivos adjuntos.' }));
          return;
        }
        items.forEach(m => {
          const row = el('div', { className: 'media-item' });
          const label = m.type === 'audio' ? '🎙' : m.type === 'photo' ? '📷' : '🎥';
          const tipo = m.type === 'audio' ? 'Audio' : m.type === 'photo' ? 'Foto' : 'Video';
          row.appendChild(el('span', { textContent: label + ' ' + tipo + ' — ' + new Date(m.created_at).toLocaleTimeString('es-AR') }));
          if (m.signedUrl) {
            const link = el('a', { href: m.signedUrl, target: '_blank', rel: 'noopener', className: 'media-link', textContent: 'Ver/Descargar' });
            row.appendChild(link);
          }
          listEl.appendChild(row);
        });
      } catch (e) {
        listEl.textContent = 'Error cargando adjuntos: ' + fmtErr(e);
      }
    }

    refreshMediaList();

    block.appendChild(listEl);
    if (canUpload && typeof window.E360Media !== 'undefined') {
      block.appendChild(el('div', { className: 'inline-form' }, [photoBtn, videoBtn]));
    }
    block.appendChild(photoInput);
    return block;
  }

  // ============ F3: EXPORT ZIP ============
  function buildExportBlock(inc) {
    const block = el('div', { className: 'detail-block' }, [
      el('h3', { textContent: '📦 Historia Clínica Exportada' }),
      el('div', { className: 'kv' }, [
        el('span', { className: 'k', textContent: 'N° HC' }),
        el('span', { className: 'v', textContent: inc.clinicalRecordNumber })
      ])
    ]);
    const btn = el('button', {
      type: 'button', className: 'btn-action btn-ok', textContent: '⬇ Descargar ZIP completo',
      onclick: async () => {
        if (!onlineOrToast()) return;
        await runLoading(btn, async () => {
          try {
            let exp = await Store.getIncidentExportUrl(inc.id);
            if (!exp?.url) {
              toast('Generando historia clínica y adjuntos…');
              await Store.generateIncidentExport(inc.id);
              exp = await Store.getIncidentExportUrl(inc.id);
            }
            if (!exp?.url) throw new Error('No se pudo obtener el archivo exportado');
            window.open(exp.url, '_blank', 'noopener');
          } catch (e) { alert('Error: ' + fmtErr(e)); }
        }, 'Generando enlace…');
      }
    });
    block.appendChild(btn);
    return block;
  }

  // ============ F3: INCIDENTE MANUAL ============
  function initNewIncidentButton() {
    const btn = $('#btnNewIncident');
    if (!btn) return;
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      if (!onlineOrToast()) return;
      openManualIncidentModal();
    });
  }

  function initPTTDiagButton() {
    let btn = document.getElementById('btnPttDiag');
    if (!btn) {
      btn = el('button', {
        type: 'button', id: 'btnPttDiag', className: 'btn-link-socio',
        textContent: '🔍', title: 'Diagnóstico PTT',
        onclick: () => openPTTDiag()
      });
      const controls = document.querySelector('.header-controls');
      if (controls) controls.insertBefore(btn, controls.firstChild);
    }
  }

  function openPTTDiag() {
    const ptt = window.E360PTT;
    if (!ptt || typeof ptt.debug !== 'function') {
      alert('PTT no disponible en esta página.');
      return;
    }
    const d = ptt.debug();
    const unlockBtn = d.remoteAudioPaused
      ? '\n\n👉 Tocá "Activar audio" en el panel flotante para desbloquear el sonido.'
      : '';
    const lines = [
      '=== DIAGNÓSTICO PTT ===', '',
      'INIT: ' + d.initialized,
      'PRESSING: ' + d.pressing,
      'INCIDENT: ' + (d.incidentId || 'none'),
      'ROLE: ' + (d.role || 'none'),
      'CHANNEL: ' + d.channelState, '',
      'PC EXISTS: ' + d.pcExists,
      'PC CONNECTION: ' + d.pcConnectionState,
      'PC ICE: ' + d.pcIceState,
      'PC SIGNALING: ' + d.pcSignalingState, '',
      'MIC ACTIVE: ' + d.localStreamActive + ' (' + d.localStreamTracks + ' tracks)', '',
      'REMOTE AUDIO EXISTS: ' + d.remoteAudioExists,
      'REMOTE AUDIO PAUSED: ' + d.remoteAudioPaused,
      'REMOTE AUDIO MUTED: ' + d.remoteAudioMuted,
      'REMOTE AUDIO VOLUME: ' + d.remoteAudioVolume,
      'REMOTE AUDIO STREAM: ' + d.remoteAudioHasStream, '',
      'TURN CACHED: ' + d.turnCached + ' (expira en ' + d.turnExpiryIn + 's)',
      'LAST ICE ERROR: ' + (d.lastIceError || 'ninguno'),
      'LAST SIGNALING ERROR: ' + (d.lastSignalingError || 'ninguno'),
      unlockBtn
    ];
    alert(lines.join('\n'));
  }

  function openManualIncidentModal() {
    const overlay = el('div', { className: 'modal-overlay' });
    const saveBtn = el('button', {
      type: 'button', className: 'btn-primary', textContent: 'Crear incidente',
      onclick: async () => {
        if (!onlineOrToast()) return;
        const guardiaCode = $('#miGuardia').value;
        const priority = $('#miPriority').value;
        const dni = $('#miDni').value.trim();
        const address = $('#miAddress').value.trim();
        const notes = $('#miNotes').value.trim();
        if (!guardiaCode) { toast('Elegí tipo de guardia'); return; }
        await runLoading(saveBtn, async () => {
          try {
            await Store.createManualIncident({
              guardiaCode,
              priority: priority || null,
              profileDni: dni || null,
              manualAddress: address || '',
              detail: notes || 'Incidente creado manualmente.'
            });
            if (overlay.parentNode) document.body.removeChild(overlay);
            toast('Incidente creado — alerta enviada a guardia');
            renderAll();
          } catch (e) { toast('Error: ' + fmtErr(e)); }
        }, 'Creando…');
      }
    });

    const modal = el('div', { className: 'modal-card' }, [
      el('h2', { textContent: 'Nuevo incidente manual' }),
      el('p', { textContent: 'Se envía directo a la guardia y aparece en la bandeja como RECIBIDA_SERVIDOR.' }),
      el('label', {}, [
        el('span', { textContent: 'Tipo de guardia' }),
        (function () {
          const sel = el('select', { id: 'miGuardia' });
          sel.appendChild(el('option', { value: 'AMB', textContent: 'AMB — Ambulancia / móvil EMP' }));
          sel.appendChild(el('option', { value: '107', textContent: '107 — Emergencia pública' }));
          sel.appendChild(el('option', { value: 'ENF', textContent: 'ENF — Enfermería domiciliaria' }));
          sel.appendChild(el('option', { value: 'DOM', textContent: 'DOM — Guardia domiciliaria' }));
          sel.appendChild(el('option', { value: 'VIR', textContent: 'VIR — Teleconsulta' }));
          sel.appendChild(el('option', { value: 'AP', textContent: 'AP — Área Protegida B2B' }));
          sel.appendChild(el('option', { value: 'EP', textContent: 'EP — Evento Privado' }));
          return sel;
        })()
      ]),
      el('label', {}, [
        el('span', { textContent: 'Prioridad inicial' }),
        (function () {
          const sel = el('select', { id: 'miPriority' });
          sel.appendChild(el('option', { value: '', textContent: 'Sin prioridad (se define en triage)' }));
          sel.appendChild(el('option', { value: 'ROJO', textContent: 'ROJO — Emergencia' }));
          sel.appendChild(el('option', { value: 'AMARILLO', textContent: 'AMARILLO — Urgencia' }));
          sel.appendChild(el('option', { value: 'VERDE', textContent: 'VERDE — Baja complejidad' }));
          return sel;
        })()
      ]),
      el('label', {}, [el('span', { textContent: 'DNI del socio (opcional)' }), el('input', { type: 'text', id: 'miDni', maxlength: '12' })]),
      el('label', {}, [el('span', { textContent: 'Dirección' }), el('input', { type: 'text', id: 'miAddress', maxlength: '160' })]),
      el('label', {}, [el('span', { textContent: 'Notas' }), el('textarea', { id: 'miNotes', rows: '2', maxlength: '300' })]),
      el('div', { className: 'modal-actions' }, [
        el('button', { type: 'button', className: 'btn-secondary', textContent: 'Cancelar', onclick: () => document.body.removeChild(overlay) }),
        saveBtn
      ])
    ]);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay);
  }

  // Tripulaciones declaradas por cada empleado al iniciar Guardia.
  let crewByUnit = {};
  async function refreshActiveCrew() {
    try {
      const st = Store._getState();
      const sb = st && st.supabase;
      if (!sb) return;
      const { data, error } = await sb.from('profiles')
        .select('nombre,base_id,guardia_unit_id,guardia_role,guardia_started_at')
        .eq('on_duty', true).not('guardia_unit_id','is',null);
      if (error) throw error;
      const next = {};
      (data || []).forEach(p => {
        const key = String(p.guardia_unit_id);
        (next[key] ||= []).push(p);
      });
      crewByUnit = next;
      renderFleet();
    } catch (err) { console.warn('[Central] Tripulación no disponible:', err); }
  }

  // ============ FLOTA ============
  function renderFleet() {
    const container = $('#fleetContainer');
    if (!container) return;
    container.innerHTML = '';
    const bases = Store.getBases();
    bases.forEach(base => {
      const units = Store.getFleet(base.id);
      container.appendChild(el('div', { className: 'fleet-base-header' }, [
        el('div', { className: 'fb-name', textContent: base.name }),
        el('div', { className: 'fb-phone', textContent: '📞 ' + base.phone })
      ]));
      const list = el('ul', { className: 'fleet-list' });
      units.forEach(u => {
        list.appendChild(el('li', { className: 'unit-card' }, [
          el('div', { className: 'unit-top' }, [
            el('span', { className: 'unit-name', textContent: u.unit }),
            el('span', { className: 'unit-pill unit-status-' + u.status, textContent: u.status.toUpperCase() })
          ]),
          el('div', { style: 'font-size:0.72rem;color:#94A3B8;', textContent: 'Tipo: ' + u.tipoUnidad }),
          el('div', { style: 'font-size:0.76rem;margin-top:5px;', textContent: (crewByUnit[String(u.id)] || []).length ? '👥 ' + crewByUnit[String(u.id)].map(p => (p.nombre || 'Personal') + ' (' + (p.guardia_role || 'Sin función') + ')').join(' · ') : 'Sin tripulación declarada' })
        ]));
      });
      container.appendChild(list);
      container.appendChild(el('div', { style: 'height:8px' }));
    });
  }

  function renderAll() {
    renderAlertCounter();
    renderIncidentList();
    renderDetail();
    renderFleet();
    renderMapMarkers();
  }

  function initSubscription() {
    Store.subscribe(msg => {
      if (!msg) return;
      if (msg.type === 'AUTH_CHANGED') { location.reload(); return; }
      if (msg.type === 'BRANDING_CHANGED') applyBranding();
      if (msg.type !== 'STATE_CHANGED') return;
      renderAll();
      checkNewEmergencyAlerts();
    });
  }

  async function bootCentral() {
    await applyBranding();
    initBaseSelector();
    initIncidentFilters();
    initNewIncidentButton();
    initPTTDiagButton();
    initEmergencyAudio();
    checkDeepLinkIncident();
    initMap();
    await renderSpeedLimitControl();
    initSubscription();
    // F3-mejora: ya NO se usa initAudioUnlockListener() global.
    // El botón "Activar audio" vive en el PTT flotante (contextual).
    renderAll();
    checkNewEmergencyAlerts();
    await refreshActiveCrew();
    // Refuerzo independiente del canal Realtime: sincronización SOS con Central abierta.
    let sosSyncBusy=false;
    async function syncSOS(){
      if(sosSyncBusy||document.getElementById('centralApp')?.hidden||document.hidden)return;
      sosSyncBusy=true;
      try{await Store.refreshIncidentsNow();renderAll();checkNewEmergencyAlerts();}
      catch(err){console.error('[Central] Falló actualización de SOS:',err);}
      finally{sosSyncBusy=false;}
    }
    const syncButton=el('button',{type:'button',className:'btn-emergency-sound',textContent:'↻ Actualizar SOS',onclick:syncSOS});
    document.querySelector('.header-controls')?.prepend(syncButton);
    setInterval(syncSOS,5000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncSOS();});
    syncSOS();
    setInterval(async () => { try { await Store.refreshFleet(); } catch (e) { console.warn('[Central] Flota:', e); } await refreshActiveCrew(); renderMapMarkers(); }, 15000);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await applyBranding();
    initLogin();
    const session = await Store.initSession();
    if (session.loggedIn && session.profile && await Store.hasEMPRole(['operador','admin'])) {
      ui.operatorName = session.profile.nombre || session.profile.dni;
      ui.operatorId = session.profile.id;
      hideLogin();
      await bootCentral();
      await initPushRegistration();
    } else {
      if (session.loggedIn) await Store.logout();
      showLogin();
    }
  });

  // F3-mejora: limpiar PTT flotante al cerrar la pestaña
  window.addEventListener('beforeunload', () => {
    destroyFloatingPTT();
  });

  window.addEventListener('resize', () => {
    if (ui.map) { try { ui.map.invalidateSize(); } catch (_) {} }
  });
})();
