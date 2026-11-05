// ============================================================
// Edge Function: get-turn-credentials
// Genera credenciales TURN temporales de Cloudflare para WebRTC
// Secrets requeridos: CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN
// ============================================================

import { corsHeaders } from 'npm:@supabase/supabase-js@^2/cors';

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const turnKeyId = Deno.env.get('CLOUDFLARE_TURN_KEY_ID');
    const turnApiToken = Deno.env.get('CLOUDFLARE_TURN_API_TOKEN');

    if (!turnKeyId || !turnApiToken) {
      throw new Error('Faltan secrets CLOUDFLARE_TURN_KEY_ID o CLOUDFLARE_TURN_API_TOKEN.');
    }

    // TTL de 1 hora (3600s). Cloudflare acepta hasta 48hs (172800s)
    const body = await req.json().catch(() => ({}));
    const ttl = Math.min(Number(body.ttl) || 3600, 172800);

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKeyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${turnApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Cloudflare TURN API error ${response.status}: ${errText}`);
    }

    const data = await response.json();

    // Filtrar URLs con puerto 53 (bloqueado por navegadores)
    if (data.iceServers && Array.isArray(data.iceServers.urls)) {
      data.iceServers.urls = data.iceServers.urls.filter(
        (url: string) => !url.includes(':53?') && !url.includes(':53&')
      );
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[get-turn-credentials] Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
