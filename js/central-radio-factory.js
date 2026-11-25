/* ============================================================
   js/ptt.js — Push-to-Talk EMP (F3) + debug()
   - destroy() elimina #gvPttFloating para forzar recreación
   - SIN unlock anticipado (evita AbortError)
   - startRecording recrea localStream si el track está muerto
   - private: true (canal privado con RLS)
   ============================================================ */

(function (global) {
 global.E360CreateRadio = function(sharedStream) {
  'use strict';

  let pc = null;
  let localStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let currentIncidentId = null;
  let currentRole = null;
  let signalChannel = null;
  let remoteAudio = null, remoteSpeaking=false;
  let sessionGeneration = 0;
  let pressGeneration = 0;
  function muteMicrophone() {
    localStream?.getAudioTracks().forEach(track => { track.enabled = false; });
  }
  let isPressing = false;
  let isInitialized = false;

  let cachedIceServers = null;
  let iceServersExpiry = 0;
  let lastIceError = null;
  let lastSignalingError = null;

  async function fetchIceServers(supabase) {
    if (cachedIceServers && Date.now() < iceServersExpiry) {
      return cachedIceServers;
    }
    try {
      const { data, error } = await supabase.functions.invoke('get-turn-credentials', {
        body: { ttl: 3600 }
      });
      if (error) throw error;
      if (!data || !data.iceServers) throw new Error('Respuesta inválida de TURN');
      const servers = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
      cachedIceServers = [{ urls: 'stun:stun.l.google.com:19302' }, ...servers];
      iceServersExpiry = Date.now() + (50 * 60 * 1000);
      lastIceError = null;
      return cachedIceServers;
    } catch (e) {
      lastIceError = e.message || String(e);
      console.warn('[ptt] Sin credenciales TURN, usando solo STUN:', e);
      return [{ urls: 'stun:stun.l.google.com:19302' }];
    }
  }

  async function initSignaling(supabase, incidentId, role) {
    const generation = sessionGeneration;
    currentIncidentId = incidentId;
    currentRole = role;

    signalChannel = supabase.channel('ptt_' + incidentId, {
      config: {
        broadcast: { self: false, acknowledgeBroadcasts: true },
        private: true
      }
    });

    await new Promise((resolve, reject) => {
      signalChannel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          lastSignalingError = 'subscribe: ' + status + ' — ' + (err ? err.message : 'sin detalle');
          reject(new Error('Canal de señalización falló: ' + status + ' — ' + (err ? err.message : 'sin detalle')));
        }
      });
    });

    if (generation !== sessionGeneration) throw new Error('Canal interrumpido');
    signalChannel
      .on('broadcast', { event: 'ptt_offer' }, async ({ payload }) => {
        if (payload.from === currentRole) return;
        await handleOffer(supabase, payload.sdp);
      })
      .on('broadcast', { event: 'ptt_answer' }, async ({ payload }) => {
        if (payload.from === currentRole) return;
        if (pc && pc.signalingState === 'have-local-offer') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          } catch (e) {
            lastSignalingError = 'answer: ' + e.message;
            console.warn('[ptt] Error aplicando answer:', e);
          }
        }
      })
      .on('broadcast', { event: 'ptt_ice' }, async ({ payload }) => {
        if (pc && payload.candidate && payload.from !== currentRole) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch (e) {
            lastSignalingError = 'ice: ' + e.message;
            console.warn('[ptt] ICE error:', e);
          }
        }
      })
      .on('broadcast', { event: 'ptt_start' }, () => {
        remoteSpeaking=true;
        if (remoteAudio) {
          try {
            remoteAudio.muted = true;
            global.E360LiveArbiter?.request(currentIncidentId,remoteAudio);
            const p = remoteAudio.play();
            if (p !== undefined) p.catch(() => {});
          } catch (_) {}
        }
      })
      .on('broadcast', { event: 'ptt_stop' }, () => {
        remoteSpeaking=false;
        if (remoteAudio) { global.E360LiveArbiter?.release(currentIncidentId); try { remoteAudio.muted = true; } catch (_) {} }
      });
  }

  async function createPeerConnection(supabase) {
    if (pc) { try { pc.close(); } catch (_) {} pc = null; }
    const generation = sessionGeneration;
    const iceServers = await fetchIceServers(supabase);
    if (generation !== sessionGeneration) throw new Error('Canal cerrado');
    pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate && signalChannel) {
        signalChannel.send({
          type: 'broadcast', event: 'ptt_ice',
          payload: { candidate: event.candidate.toJSON(), from: currentRole }
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc) console.log('[ptt] ICE state:', pc.iceConnectionState);
    };

    pc.ontrack = (event) => {
      if (!remoteAudio) {
        remoteAudio = new Audio();
        remoteAudio.autoplay = true;
        remoteAudio.playsInline = true;
      }
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.muted = true;
      if(remoteSpeaking)global.E360LiveArbiter?.request(currentIncidentId,remoteAudio);
      const playPromise = remoteAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch((e) => {
          console.warn('[ptt] Autoplay bloqueado en ontrack, reintentando con click:', e);
          const unlock = () => {
            if (remoteAudio) remoteAudio.play().catch(() => {});
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
          };
          document.addEventListener('click', unlock);
          document.addEventListener('touchstart', unlock);
        });
      }
    };

    return pc;
  }

  async function startAsCaller(supabase) {
    if (!localStream) throw new Error('Sin micrófono');
    if (!signalChannel) throw new Error('Canal de señalización no inicializado');

    await createPeerConnection(supabase);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sendResult = await signalChannel.send({
      type: 'broadcast',
      event: 'ptt_offer',
      payload: { sdp: pc.localDescription.toJSON(), from: currentRole }
    });

    if (sendResult && sendResult.ok === false) {
      throw new Error('El servidor Realtime rechazó la oferta SDP. ¿Política RLS?');
    }
  }

  async function handleOffer(supabase, sdp) {
    // Incoming offers are receive-only. A local press creates its own sending peer.
    if (!signalChannel) return;
    await createPeerConnection(supabase);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signalChannel.send({
        type: 'broadcast', event: 'ptt_answer',
        payload: { sdp: pc.localDescription.toJSON() }
      });
    } catch (e) {
      lastSignalingError = 'handleOffer: ' + e.message;
      console.warn('[ptt] Error respondiendo oferta:', e);
    }
  }

  async function startRecording() {
    if (!isPressing || !localStream?.getAudioTracks().some(t => t.readyState === 'live')) return;

    recordedChunks = [];
    try {
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      mediaRecorder = new MediaRecorder(localStream, { mimeType: mime });
    } catch (e) { return; }
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.start();
  }

  async function stopRecordingAndUpload(supabase) {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return null;
    return new Promise((resolve) => {
      const incidentId = currentIncidentId;
      mediaRecorder.onstop = async () => {
        if (recordedChunks.length === 0) { resolve(null); return; }
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const fileName = 'audio/' + incidentId + '/ptt_' + Date.now() + '.webm';
        try {
          const { data, error } = await supabase.storage
            .from('incident-media')
            .upload(fileName, blob, { contentType: 'audio/webm', upsert: false });
          if (error) throw error;
          const { data: userData } = await supabase.auth.getUser();
          await supabase.from('incident_media').insert({
            incident_id: incidentId, type: 'audio',
            storage_path: data.path,
            uploaded_by: userData?.user?.email || 'desconocido',
            duration_seconds: Math.max(1, Math.round(blob.size / 16000))
          });
          resolve(data.path);
        } catch (e) { resolve(null); }
      };
      try { mediaRecorder.stop(); } catch (_) { resolve(null); }
    });
  }

  return {
    async init(supabase, incidentId, role) {
      if (isInitialized || localStream || signalChannel) this.destroy();
      const generation = ++sessionGeneration;
      try {
        const stream = sharedStream.clone();
        if (generation !== sessionGeneration) {
          stream.getTracks().forEach(track => track.stop());
          return false;
        }
        localStream = stream;
        muteMicrophone();
      } catch (e) {
        lastSignalingError = 'getUserMedia: ' + e.message;
        return false;
      }
      await initSignaling(supabase, incidentId, role);
      if (generation !== sessionGeneration) return false;
      isInitialized = true;
      return true;
    },

    async startTalking(supabase) {
      if (!isInitialized || isPressing) return;
      if (navigator.onLine === false || !localStream) throw new Error('Radio sin conexión');
      const press = ++pressGeneration;
      isPressing = true;
      localStream.getAudioTracks().forEach(track => { track.enabled = true; });
      try {
        await startAsCaller(supabase);
        if (press !== pressGeneration) return;
        await startRecording();
        if (press !== pressGeneration) return;
        if (signalChannel) {
          signalChannel.send({ type: 'broadcast', event: 'ptt_start', payload: {} });
        }
      } catch (e) {
        if (press !== pressGeneration) return;
        muteMicrophone();
        isPressing = false;
        lastSignalingError = 'startTalking: ' + e.message;
        console.error('[ptt] startTalking falló:', e);
        throw e;
      }
    },

    async stopTalking(supabase) {
      if (!isPressing) return null;
      ++pressGeneration;
      muteMicrophone();
      isPressing = false;
      if (signalChannel) signalChannel.send({ type: 'broadcast', event: 'ptt_stop', payload: {} });
      const closingPeer = pc;
      const path = await stopRecordingAndUpload(supabase);
      closingPeer?.close();
      if (pc === closingPeer) pc = null;
      return path;
    },

    isActive() { return isPressing; },
    isReady() { return isInitialized; },

    debug() {
      return {
        initialized: isInitialized,
        pressing: isPressing,
        incidentId: currentIncidentId,
        role: currentRole,
        channelState: signalChannel ? signalChannel.state : 'none',
        pcExists: !!pc,
        pcConnectionState: pc ? pc.connectionState : 'none',
        pcIceState: pc ? pc.iceConnectionState : 'none',
        pcSignalingState: pc ? pc.signalingState : 'none',
        localStreamActive: localStream ? localStream.getAudioTracks().some(t => t.enabled && !t.muted) : false,
        localStreamTracks: localStream ? localStream.getAudioTracks().length : 0,
        remoteAudioExists: !!remoteAudio,
        remoteAudioPaused: remoteAudio ? remoteAudio.paused : null,
        remoteAudioMuted: remoteAudio ? remoteAudio.muted : null,
        remoteAudioVolume: remoteAudio ? remoteAudio.volume : null,
        remoteAudioHasStream: remoteAudio && remoteAudio.srcObject ? true : false,
        turnCached: !!cachedIceServers,
        turnExpiryIn: cachedIceServers ? Math.max(0, Math.round((iceServersExpiry - Date.now()) / 1000)) : 0,
        lastIceError: lastIceError,
        lastSignalingError: lastSignalingError
      };
    },

    setReceiveVolume(value) { if(remoteAudio) remoteAudio.volume=Math.max(0.2,Math.min(1,Number(value)||1)); },
    unlockAudio() {
      if (!remoteAudio) return Promise.resolve(false);
      if(remoteSpeaking)global.E360LiveArbiter?.request(currentIncidentId,remoteAudio);
      const p = remoteAudio.play();
      if (p === undefined) return Promise.resolve(true);
      return p.then(() => true).catch(() => false);
    },

    destroy() {
      ++sessionGeneration;
      ++pressGeneration;
      muteMicrophone();
      remoteSpeaking=false;
      global.E360LiveArbiter?.release(currentIncidentId);
      if (pc) { try { pc.close(); } catch (_) {} pc = null; }
      if (localStream) { localStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} }); localStream = null; }
      if (signalChannel) { try { signalChannel.unsubscribe(); } catch (_) {} signalChannel = null; }
      if (remoteAudio) { try { remoteAudio.pause(); } catch (_) {} remoteAudio.srcObject = null; remoteAudio = null; }
      isPressing = false;
      isInitialized = false;
      currentIncidentId = null;
      currentRole = null;
      lastIceError = null;
      lastSignalingError = null;


    }
  };
 };
})(typeof window !== 'undefined' ? window : globalThis);
