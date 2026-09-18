// ============================================================
//  supabaseClient.js
//  Cliente único de Supabase para todo el SGDE DUA FARMA.
//  Mismo patrón usado en el proyecto de referencia (Hospedaje Ruby):
//  se guarda en window.supabaseClient para que nunca truene aunque
//  el <script> se incluya más de una vez en la misma página.
//
//  Debe cargarse así, en este orden, ANTES de cualquier otro script:
//
//  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//  <script src="../js/supabaseClient.js"></script>
//  <script src="../js/recepcion.js"></script>  <!-- u otro módulo -->
// ============================================================

if (!window.supabaseClient) {
    // 1. Reemplaza estos dos valores con los de TU proyecto Supabase
    //    (Project Settings -> API en supabase.com), luego de ejecutar
    //    sql/schema.sql en el SQL Editor de tu proyecto.
    const SUPABASE_URL = "https://afsjkqhkouyswvhkkquw.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmc2prcWhrb3V5c3d2aGtrcXV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MzM2MTksImV4cCI6MjEwMjUwOTYxOX0.QqEP4JL_3uiuJ6kgVT3HQZSH1GjGOJKNLRHF4FRoyiU";

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.error('[Supabase] El SDK no se cargó. Verifica el <script> del CDN de supabase-js.');
    } else {
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
}
var supabaseClient = window.supabaseClient;

// ------------------------------------------------------------
// Helper genérico de errores
// ------------------------------------------------------------
function manejarErrorSupabase(error, mensajeUsuario) {
    console.error("[Supabase]", error);
    alert(mensajeUsuario || `Ocurrió un error al comunicarse con la base de datos: ${error?.message || error}`);
}

// ------------------------------------------------------------
// Registrar una acción en la bitácora de auditoría (6.2.5.16)
// Se llama después de cada INSERT/UPDATE/DELETE relevante.
// ------------------------------------------------------------
async function registrarAuditoria(accion, tabla, registroId, detalle) {
    const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
    const usuario = sesion ? sesion.usuario : 'desconocido';
    try {
        await supabaseClient.from('log_auditoria').insert([{
            usuario, accion, tabla, registro_id: String(registroId || ''), detalle: detalle || ''
        }]);
    } catch (e) {
        console.error('[Auditoria] No se pudo registrar:', e);
    }
}
