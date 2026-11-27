document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('login-form');
    const mensaje = document.getElementById('error-msg');
    const boton = form.querySelector('button[type="submit"]');
    localStorage.removeItem('sesion_usuario');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        mensaje.style.display = 'none';
        boton.disabled = true;
        boton.textContent = 'Verificando…';

        try {
            const email = document.getElementById('login-usuario').value.trim();
            const password = document.getElementById('login-password').value;
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) {
                mensaje.textContent = 'Correo o contraseña incorrectos.';
                mensaje.style.display = 'block';
                return;
            }

            const perfil = await obtenerPerfilSGDE();
            if (!perfil) {
                await supabaseClient.auth.signOut({ scope: 'local' });
                mensaje.textContent = 'Tu cuenta no tiene un perfil activo en el SGDE.';
                mensaje.style.display = 'block';
                return;
            }

            guardarPerfilSGDE(perfil);
            await registrarAuditoria('LOGIN', 'usuarios', perfil.id, 'Inicio de sesión');
            window.location.replace('./html/dashboard.html');
        } catch (error) {
            console.error(error);
            mensaje.textContent = 'No se pudo iniciar sesión. Revisa la conexión e inténtalo de nuevo.';
            mensaje.style.display = 'block';
        } finally {
            boton.disabled = false;
            boton.textContent = 'Ingresar al sistema';
        }
    });
});
