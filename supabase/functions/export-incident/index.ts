// ============================================================
// Edge Function: export-incident
// Genera ZIP + PDF de historia clínica al cerrar un incidente.
// Se dispara por Database Webhook en UPDATE de incidents cuando
// status pasa a CERRADA.
// Requiere: FCM_SERVICE_ACCOUNT no; usa service_role interno.
// ============================================================

import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import JSZip from 'https://esm.sh/jszip@3.10.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============ HELPERS ============
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return iso; }
}

function safeText(t: any): string {
  if (t === null || t === undefined) return '—';
  return String(t);
}

// ============ PDF ============
async function generatePdf(incident: any, profile: any, mediaList: any[], hcNumber: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // --- PÁGINA 1: PORTADA ---
  let page = doc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  let y = height - 60;

  page.drawText('EMP - EMERGENCIAS MÉDICAS PRIVADAS', {
    x: 50, y, size: 16, font: fontBold, color: rgb(0.04, 0.24, 0.47)
  });
  y -= 22;
  page.drawText('HISTORIA CLÍNICA', {
    x: 50, y, size: 12, font: fontBold, color: rgb(0.48, 0.11, 0.20)
  });
  y -= 30;

  page.drawText('N° Historia Clínica:', { x: 50, y, size: 10, font: fontBold });
  page.drawText(hcNumber, { x: 180, y, size: 10, font });
  y -= 18;
  page.drawText('N° Incidente:', { x: 50, y, size: 10, font: fontBold });
  page.drawText(safeText(incident.id), { x: 180, y, size: 10, font });
  y -= 18;
  page.drawText('Fecha de cierre:', { x: 50, y, size: 10, font: fontBold });
  page.drawText(fmtDate(incident.created_at), { x: 180, y, size: 10, font });
  y -= 18;
  page.drawText('Sede:', { x: 50, y, size: 10, font: fontBold });
  page.drawText(incident.base_id === 'LA_COSTA' ? 'La Costa (LC)' : 'Dolores (DL)', { x: 180, y, size: 10, font });
  y -= 18;
  page.drawText('Tipo de guardia:', { x: 50, y, size: 10, font: fontBold });
  page.drawText(safeText(incident.guardia_code), { x: 180, y, size: 10, font });
  y -= 30;

  // Datos del socio
  page.drawText('DATOS DEL SOCIO', { x: 50, y, size: 11, font: fontBold, color: rgb(0.04, 0.24, 0.47) });
  y -= 18;
  const socioFields: [string, string][] = [
    ['Nombre', safeText(profile?.nombre)],
    ['DNI', safeText(profile?.dni)],
    ['N° Socio', profile?.dni ? ('EMP-' + String(profile.dni).padStart(6, '0')) : '—'],
    ['Plan', safeText(profile?.plan)],
    ['Teléfono', safeText(profile?.telefono)],
    ['Grupo sanguíneo', safeText(profile?.grupo_sanguineo)],
    ['Alergias', safeText(profile?.alergias)],
    ['Patologías', safeText(profile?.patologias)],
    ['Contacto emergencia', safeText(profile?.contacto)],
  ];
  for (const [k, v] of socioFields) {
    page.drawText(k + ':', { x: 50, y, size: 9, font: fontBold });
    page.drawText(v.length > 70 ? v.slice(0, 70) + '…' : v, { x: 170, y, size: 9, font });
    y -= 14;
  }
  y -= 10;

  // Datos del incidente
  page.drawText('DATOS DEL INCIDENTE', { x: 50, y, size: 11, font: fontBold, color: rgb(0.04, 0.24, 0.47) });
  y -= 18;
  const incFields: [string, string][] = [
    ['Estado final', safeText(incident.status)],
    ['Prioridad', safeText(incident.priority)],
    ['Dirección', safeText(incident.manual_address)],
    ['Motivo de cierre', safeText(incident.closure_reason)],
    ['Notas de cierre', safeText(incident.outcome_notes)],
    ['Centro receptor', safeText(incident.destination_center)],
  ];
  for (const [k, v] of incFields) {
    page.drawText(k + ':', { x: 50, y, size: 9, font: fontBold });
    page.drawText(v.length > 70 ? v.slice(0, 70) + '…' : v, { x: 170, y, size: 9, font });
    y -= 14;
  }

  // --- PÁGINA 2: BITÁCORA ---
  page = doc.addPage([595, 842]);
  y = 780;
  page.drawText('BITÁCORA DEL INCIDENTE', { x: 50, y, size: 12, font: fontBold, color: rgb(0.04, 0.24, 0.47) });
  y -= 25;
  const history = Array.isArray(incident.status_history) ? incident.status_history : [];
  for (const h of history) {
    if (y < 60) { page = doc.addPage([595, 842]); y = 780; }
    page.drawText('• ' + safeText(h.status), { x: 50, y, size: 9, font: fontBold });
    page.drawText(fmtDate(h.ts) + ' · ' + safeText(h.actor), { x: 220, y, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 12;
    if (h.detail) {
      page.drawText('  ' + String(h.detail).slice(0, 100), { x: 50, y, size: 8, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 14;
    }
  }

  // --- PÁGINA FINAL: ÍNDICE DE ARCHIVOS ---
  page = doc.addPage([595, 842]);
  y = 780;
  page.drawText('ÍNDICE DE ARCHIVOS ADJUNTOS', { x: 50, y, size: 12, font: fontBold, color: rgb(0.04, 0.24, 0.47) });
  y -= 25;
  page.drawText('Tipo', { x: 50, y, size: 9, font: fontBold });
  page.drawText('Archivo', { x: 130, y, size: 9, font: fontBold });
  page.drawText('Subido por', { x: 400, y, size: 9, font: fontBold });
  y -= 15;
  for (const m of mediaList) {
    if (y < 60) { page = doc.addPage([595, 842]); y = 780; }
    page.drawText(safeText(m.type).toUpperCase(), { x: 50, y, size: 8, font });
    page.drawText(String(m.storage_path || '').slice(-40), { x: 130, y, size: 8, font });
    page.drawText(safeText(m.uploaded_by), { x: 400, y, size: 8, font });
    y -= 12;
  }
  if (mediaList.length === 0) {
    page.drawText('Sin archivos adjuntos.', { x: 50, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
  }

  // Footer legal en todas las páginas
  const pages = doc.getPages();
  for (const p of pages) {
    p.drawText('ASARI S.A.S. Proveedor Tecnológico · EMP Prestador Operativo', {
      x: 50, y: 30, size: 7, font, color: rgb(0.5, 0.5, 0.5)
    });
  }

  return await doc.save();
}

// ============ ZIP ============
async function buildZip(
  incident: any,
  pdfBytes: Uint8Array,
  mediaFiles: { type: string; path: string; bytes: Uint8Array }[],
  hcNumber: string
): Promise<Uint8Array> {
  const zip = new JSZip();
  const root = zip.folder(hcNumber)!;

  // PDF
  root.file('historia_clinica.pdf', pdfBytes);

  // Resumen TXT
  const resumen = [
    'EMP - EMERGENCIAS MÉDICAS PRIVADAS',
    'Historia Clínica: ' + hcNumber,
    'Incidente: ' + incident.id,
    'Fecha de cierre: ' + fmtDate(incident.created_at),
    'Sede: ' + (incident.base_id === 'LA_COSTA' ? 'La Costa' : 'Dolores'),
    'Guardia: ' + safeText(incident.guardia_code),
    '',
    'Archivos adjuntos: ' + mediaFiles.length,
    'Generado automáticamente por el sistema EMP.'
  ].join('\n');
  root.file('resumen.txt', resumen);

  // Archivos por tipo
  const audioFolder = root.folder('audio')!;
  const fotosFolder = root.folder('fotos')!;
  const videosFolder = root.folder('videos')!;

  for (const f of mediaFiles) {
    const name = f.path.split('/').pop() || 'archivo';
    if (f.type === 'audio') audioFolder.file(name, f.bytes);
    else if (f.type === 'photo') fotosFolder.file(name, f.bytes);
    else if (f.type === 'video') videosFolder.file(name, f.bytes);
  }

  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ============ HANDLER ============
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');

    const sb = createClient(supabaseUrl, serviceRoleKey);
    const payload = await req.json();

    // Soportar webhook (record + old_record) o llamada directa (incident_id)
    const rec = payload.record || payload;
    const old = payload.old_record || {};
    const incidentId = rec.id;
    if (!incidentId) throw new Error('Falta incident_id en el payload.');

    // Solo procesar si pasó a CERRADA
    if (rec.status !== 'CERRADA') {
      return new Response(JSON.stringify({ ok: true, skipped: 'no_cerrada' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
      });
    }

    // Esperar a que el trigger de la BD haya asignado el número
    let hcNumber = rec.clinical_record_number;
    if (!hcNumber) {
      const { data: fresh } = await sb.from('incidents')
        .select('clinical_record_number')
        .eq('id', incidentId)
        .maybeSingle();
      hcNumber = fresh?.clinical_record_number;
    }
    if (!hcNumber) throw new Error('El incidente no tiene número de historia clínica asignado.');

    // Leer datos del socio
    let profile = null;
    if (rec.profile_dni) {
      const { data: p } = await sb.from('profiles')
        .select('*')
        .eq('dni', rec.profile_dni)
        .maybeSingle();
      profile = p;
    }

    // Leer media
    const { data: mediaList } = await sb.from('incident_media')
      .select('*')
      .eq('incident_id', incidentId);

    // Descargar archivos
    const mediaFiles: { type: string; path: string; bytes: Uint8Array }[] = [];
    for (const m of (mediaList || [])) {
      try {
        const { data: fileData, error } = await sb.storage
          .from('incident-media')
          .download(m.storage_path);
        if (error || !fileData) { console.warn('No se pudo bajar:', m.storage_path); continue; }
        const bytes = new Uint8Array(await fileData.arrayBuffer());
        mediaFiles.push({ type: m.type, path: m.storage_path, bytes });
      } catch (e) {
        console.warn('Error descargando:', m.storage_path, e);
      }
    }

    // Generar PDF
    const pdfBytes = await generatePdf(rec, profile, mediaList || [], hcNumber);

    // Generar ZIP
    const zipBytes = await buildZip(rec, pdfBytes, mediaFiles, hcNumber);

    // Subir ZIP a incident-exports
    const zipPath = hcNumber + '/historia_clinica_' + hcNumber + '.zip';
    const { error: upErr } = await sb.storage
      .from('incident-exports')
      .upload(zipPath, zipBytes, { contentType: 'application/zip', upsert: true });
    if (upErr) throw new Error('Error subiendo ZIP: ' + upErr.message);

    // Guardar path en el incidente
    await sb.from('incidents').update({ export_zip_path: zipPath }).eq('id', incidentId);

    return new Response(JSON.stringify({
      ok: true,
      hc_number: hcNumber,
      zip_path: zipPath,
      files: mediaFiles.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[export-incident] ERROR:', message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
    });
  }
});
