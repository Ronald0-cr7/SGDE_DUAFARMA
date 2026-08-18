// ============================================================
// login.js — Autenticación contra la tabla `usuarios` de Supabase
// ============================================================

const sesionExistente = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
if (sesionExistente && window.location.pathname.toLowerCase().endsWith('index.html')) {
    window.location.href = './html/dashboard.html';
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('login-form');
    if (!form) return;

    const inputUsuario = document.getElementById('login-usuario');
    const inputPassword = document.getElementById('login-password');
    const err = document.getElementById('error-msg');
    const btnSubmit = form.querySelector('button[type="submit"]');

    // Módulos visibles según el rol (6.2.5.16 - control de accesos)
    const ACCESOS_POR_ROL = {
        admin:     ['dashboard', 'recepcion', 'kardex', 'documentos', 'repositorios', 'auditoria', 'usuarios'],
        asistente: ['dashboard', 'recepcion', 'kardex', 'documentos', 'repositorios'],
        auxiliar:  ['dashboard', 'kardex', 'documentos', 'repositorios']
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (err) err.style.display = 'none';

        const usuario = inputUsuario.value.trim();
        const password = inputPassword.value.trim();

        if (!usuario || !password) {
            if (err) { err.textContent = 'Ingresa usuario y contraseña.'; err.style.display = 'block'; }
            return;
        }

        if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = 'Verificando...'; }

        try {
            const { data, error } = await supabaseClient
                .from('usuarios')
                .select('id, username, password, nombre, rol, activo')
                .eq('username', usuario)
                .eq('activo', true)
                .maybeSingle();

            if (error) throw error;

            if (!data || data.password !== password) {
                if (err) { err.textContent = 'Usuario o contraseña incorrectos.'; err.style.display = 'block'; }
                return;
            }

            const sesion = {
                usuario: data.username,
                rol: data.rol,
                nombre: data.nombre,
                acceso: ACCESOS_POR_ROL[data.rol] || []
            };
            localStorage.setItem('sesion_usuario', JSON.stringify(sesion));

            await registrarAuditoria('LOGIN', 'usuarios', data.id, `Inicio de sesión de ${data.username} (${data.rol})`);

            window.location.href = './html/dashboard.html';
        } catch (error) {
            console.error(error);
            if (err) { err.textContent = 'No se pudo conectar con la base de datos. Revisa supabaseClient.js.'; err.style.display = 'block'; }
        } finally {
            if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Ingresar al sistema'; }
        }
    });
});

function cerrarSesion() {
    localStorage.removeItem('sesion_usuario');
    window.location.href = '../index.html';
}
