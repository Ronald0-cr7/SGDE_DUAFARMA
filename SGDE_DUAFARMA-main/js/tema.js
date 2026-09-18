(function () {
    const CLAVE = 'sgde_tema';
    const raiz = document.documentElement;

    function aplicarTema(tema) {
        const oscuro = tema === 'oscuro';
        raiz.classList.toggle('tema-oscuro', oscuro);
        localStorage.setItem(CLAVE, oscuro ? 'oscuro' : 'claro');
        const boton = document.getElementById('btn-cambiar-tema');
        if (boton) {
            boton.innerHTML = oscuro
                ? '☀️<span> Fondo claro</span>'
                : '🌙<span> Fondo negro</span>';
            boton.setAttribute('aria-label', oscuro ? 'Cambiar a fondo claro' : 'Cambiar a fondo negro');
            boton.title = boton.getAttribute('aria-label');
        }
    }

    aplicarTema(localStorage.getItem(CLAVE) || 'claro');

    document.addEventListener('DOMContentLoaded', () => {
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.id = 'btn-cambiar-tema';
        boton.className = 'btn-cambiar-tema';
        boton.addEventListener('click', () => {
            aplicarTema(raiz.classList.contains('tema-oscuro') ? 'claro' : 'oscuro');
        });
        document.body.appendChild(boton);
        aplicarTema(localStorage.getItem(CLAVE) || 'claro');
    });
})();
