// ============================================================
// rol_guard.js — Verifica sesión y controla accesos por rol
// en TODAS las páginas dentro de /html. Cumple 6.2.5.16.
// ============================================================
(function () {
    const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
    const pagina = window.location.pathname.split('/').pop().replace('.html', '').toLowerCase();

    if (!sesion) {
        window.location.href = '../index.html';
        return;
    }

    // Páginas restringidas a admin
    const SOLO_ADMIN = ['auditoria', 'usuarios'];
    if (SOLO_ADMIN.includes(pagina) && sesion.rol !== 'admin') {
        alert('⚠️ No tienes permisos para acceder a este módulo.');
        window.location.href = 'dashboard.html';
        return;
    }

    // Sincroniza sesiones creadas antes de incorporar módulos nuevos.
    const accesosPorRol = {
        admin: ['dashboard', 'recepcion', 'productos', 'kardex', 'documentos', 'repositorios', 'auditoria', 'usuarios'],
        asistente: ['dashboard', 'recepcion', 'productos', 'kardex', 'documentos', 'repositorios'],
        auxiliar: ['dashboard', 'productos', 'kardex', 'documentos', 'repositorios']
    };
    if (accesosPorRol[sesion.rol]) {
        sesion.acceso = accesosPorRol[sesion.rol];
        localStorage.setItem('sesion_usuario', JSON.stringify(sesion));
    }

    if (sesion.acceso && !sesion.acceso.includes(pagina)) {
        alert('⚠️ Tu rol (' + sesion.rol + ') no tiene acceso a este módulo.');
        window.location.href = 'dashboard.html';
        return;
    }

    // Rol de solo lectura: oculta botones de crear/editar/eliminar
    document.addEventListener('DOMContentLoaded', () => {
        const nombreEl = document.getElementById('nombre-usuario-sesion');
        if (nombreEl) nombreEl.textContent = sesion.nombre + ' (' + sesion.rol + ')';

        if (sesion.rol === 'auxiliar') {
            document.querySelectorAll('.solo-escritura').forEach(el => el.style.display = 'none');
        }
        if (sesion.rol !== 'admin') {
            document.querySelectorAll('.solo-admin').forEach(el => el.style.display = 'none');
        }
    });
})();

// Disponible en todas las páginas internas.
window.cerrarSesion = function cerrarSesion() {
    localStorage.removeItem('sesion_usuario');
    sessionStorage.clear();
    window.location.replace('../index.html');
};
