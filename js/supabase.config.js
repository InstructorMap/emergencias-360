/* ============================================================
   supabase.config.js — Configuración de conexión Supabase
   Cargar ANTES de config.js en todos los HTML.
   La anon key es pública por diseño: su seguridad depende
   exclusivamente de las políticas RLS de cada tabla en Supabase.
   Habilitá RLS en TODAS las tablas antes de usarla en producción.
   ============================================================ */

window.E360SupabaseConfig = {
  URL: 'https://ebrukqxnhfpatoeukaqc.supabase.co',
  ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVicnVrcXhuaGZwYXRvZXVrYXFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MjIwMjAsImV4cCI6MjEwODE5ODAyMH0.q8QOvbcvM4wpGEFIQodrvK1ocl60_qbcodmXFp-YjSE',
  TABLES: {
    profiles: 'profiles',
    incidents: 'incidents',
    benefits: 'benefits',
    b2b: 'b2b_establishments',
    audit: 'audit_logs'
  }
};
