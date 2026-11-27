const accesosPorRolSGDE = {
    admin: ['dashboard', 'recepcion', 'productos', 'kardex', 'documentos', 'repositorios', 'auditoria', 'usuarios'],
    asistente: ['dashboard', 'recepcion', 'productos', 'kardex', 'documentos', 'repositorios'],
    auxiliar: ['dashboard', 'productos', 'kardex', 'documentos', 'repositorios']
};

window.perfilSGDEListo = (async () => {
    try {
        const perfil = await obtenerPerfilSGDE();
        if (!perfil || !accesosPorRolSGDE[perfil.rol]) {
            localStorage.removeItem('sesion_usuario');
            window.location.replace('../index.html');
            return null;
        }

        const pagina = window.location.pathname.split('/').pop().replace('.html', '').toLowerCase();
        if (!accesosPorRolSGDE[perfil.rol].includes(pagina)) {
            window.location.replace('dashboard.html');
            return null;
        }

        guardarPerfilSGDE(perfil);
        const nombre = document.getElementById('nombre-usuario-sesion');
        if (nombre) nombre.textContent = perfil.nombre + ' (' + perfil.rol + ')';
        if (perfil.rol === 'auxiliar') {
            document.querySelectorAll('.solo-escritura').forEach(el => el.style.display = 'none');
        }
        if (perfil.rol !== 'admin') {
            document.querySelectorAll('.solo-admin').forEach(el => el.style.display = 'none');
        }
        return perfil;
    } catch (error) {
        console.error(error);
        localStorage.removeItem('sesion_usuario');
        window.location.replace('../index.html');
        return null;
    }
})();

window.cerrarSesion = async function cerrarSesion() {
    const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
    if (error) return manejarErrorSupabase(error, 'No se pudo cerrar la sesión.');
    localStorage.removeItem('sesion_usuario');
    sessionStorage.clear();
    window.location.replace('../index.html');
};
