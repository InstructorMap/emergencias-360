/* ============================================================
   js/media.js — Adjuntos de incidente EMP (F3)
   - Comprime fotos a JPEG ~1MB con canvas
   - Graba/limita videos a 30s 720p con MediaRecorder
   - Sube a Storage (incident-media) y registra en incident_media
   - Devuelve URLs firmadas de 5 min para visualización
   ============================================================ */

(function (global) {
  'use strict';

  const MAX_PHOTO_BYTES = 1024 * 1024;      // 1 MB
  const MAX_VIDEO_SECONDS = 30;
  const VIDEO_WIDTH = 1280;                  // 720p
  const VIDEO_HEIGHT = 720;
  const SIGNED_URL_TTL = 300;                // 5 min

  // ============ COMPRESIÓN DE FOTO ============
  async function compressPhoto(file) {
    if (!file.type.startsWith('image/')) throw new Error('No es una imagen.');
    if (file.size <= MAX_PHOTO_BYTES) return file;

    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;

    // Escalar a máx 1600px del lado mayor
    const maxSide = 1600;
    if (width > maxSide || height > maxSide) {
      const ratio = Math.min(maxSide / width, maxSide / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);

    // Bajar calidad progresivamente hasta llegar a 1MB
    let quality = 0.85;
    let blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    while (blob && blob.size > MAX_PHOTO_BYTES && quality > 0.4) {
      quality -= 0.1;
      blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    }

    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  }

  // ============ GRABACIÓN DE VIDEO ============
  async function recordVideo(onStop) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: VIDEO_WIDTH }, height: { ideal: VIDEO_HEIGHT }, facingMode: 'environment' },
        audio: true
      });
    } catch (e) {
      throw new Error('No se pudo acceder a la cámara: ' + e.message);
    }

    const chunks = [];
    let mime = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mime)) {
      mime = 'video/webm';
    }
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const stopTimer = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, MAX_VIDEO_SECONDS * 1000);

    recorder.onstop = () => {
      clearTimeout(stopTimer);
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: mime });
      const file = new File([blob], 'video_' + Date.now() + '.webm', { type: mime });
      if (typeof onStop === 'function') onStop(file);
    };

    recorder.start();
    return {
      stop: () => {
        if (recorder.state === 'recording') recorder.stop();
      }
    };
  }

  // ============ SUBIDA ============
  async function uploadMedia(supabase, incidentId, file, type) {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const folder = type === 'photo' ? 'fotos' : type === 'video' ? 'videos' : 'audio';
    const path = folder + '/' + incidentId + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.' + ext;

    const { data, error } = await supabase.storage
      .from('incident-media')
      .upload(path, file, { contentType: file.type, upsert: false });

    if (error) throw new Error('Error subiendo archivo: ' + error.message);

    const { data: userData } = await supabase.auth.getUser();
    const { error: insertErr } = await supabase.from('incident_media').insert({
      incident_id: incidentId,
      type: type,
      storage_path: data.path,
      uploaded_by: userData?.user?.email || 'desconocido',
      duration_seconds: type === 'video' ? MAX_VIDEO_SECONDS : null
    });

    if (insertErr) throw new Error('Error registrando media: ' + insertErr.message);
    return data.path;
  }

  // ============ LISTAR Y FIRMAR URLS ============
  async function listIncidentMedia(supabase, incidentId) {
    const { data, error } = await supabase
      .from('incident_media')
      .select('*')
      .eq('incident_id', incidentId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return [];

    // Firmar URLs de descarga
    const paths = data.map(m => m.storage_path);
    const { data: signed, error: signErr } = await supabase.storage
      .from('incident-media')
      .createSignedUrls(paths, SIGNED_URL_TTL);

    if (signErr) console.warn('[media] Error firmando URLs:', signErr);

    const urlMap = {};
    (signed || []).forEach(s => {
      if (s.signedUrl && s.path) urlMap[s.path] = s.signedUrl;
    });

    return data.map(m => ({
      ...m,
      signedUrl: urlMap[m.storage_path] || null
    }));
  }

  // ============ API PÚBLICA ============
  global.E360Media = {
    async uploadPhoto(supabase, incidentId, file) {
      const compressed = await compressPhoto(file);
      return uploadMedia(supabase, incidentId, compressed, 'photo');
    },

    async uploadVideo(supabase, incidentId, file) {
      return uploadMedia(supabase, incidentId, file, 'video');
    },

    recordVideo,
    listIncidentMedia,
    compressPhoto,

    async deleteMedia(supabase, mediaId, storagePath) {
      const { error: delErr } = await supabase.storage
        .from('incident-media')
        .remove([storagePath]);
      if (delErr) console.warn('[media] Error borrando archivo:', delErr);

      const { error } = await supabase.from('incident_media').delete().eq('id', mediaId);
      if (error) throw new Error(error.message);
      return true;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
