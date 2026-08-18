document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { count: cProd } = await supabaseClient.from('productos').select('*', { count: 'exact', head: true });
        document.getElementById('kpi-productos').textContent = cProd ?? 0;

        const { count: cRec } = await supabaseClient.from('recepciones').select('*', { count: 'exact', head: true });
        document.getElementById('kpi-recepciones').textContent = cRec ?? 0;

        const { count: cDoc } = await supabaseClient.from('documentos').select('*', { count: 'exact', head: true }).eq('estado', 'vigente');
        document.getElementById('kpi-documentos').textContent = cDoc ?? 0;

        const hoy = new Date().toISOString().slice(0, 10);
        const { count: cAud } = await supabaseClient.from('log_auditoria').select('*', { count: 'exact', head: true }).gte('fecha', hoy);
        document.getElementById('kpi-auditoria').textContent = cAud ?? 0;
    } catch (e) {
        console.error(e);
    }

    const botonActualizar = document.getElementById('btn-actualizar-almacenamiento');
    if (botonActualizar) botonActualizar.addEventListener('click', cargarUsoAlmacenamiento);
    await cargarUsoAlmacenamiento();
});

const LIMITE_BD_BYTES = 500 * 1000 * 1000;
const LIMITE_STORAGE_BYTES = 1000 * 1000 * 1000;

function formatearBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const unidades = ['B', 'KB', 'MB', 'GB'];
    let valor = bytes;
    let indice = 0;
    while (valor >= 1000 && indice < unidades.length - 1) {
        valor /= 1000;
        indice++;
    }
    return `${valor.toFixed(indice < 2 ? 0 : 1)} ${unidades[indice]}`;
}

function actualizarMedidor(prefijo, usados, limite) {
    const porcentajeReal = limite > 0 ? (usados / limite) * 100 : 0;
    const porcentajeVisible = Math.min(porcentajeReal, 100);
    const barra = document.getElementById(`${prefijo}-espacio-barra`);
    const texto = document.getElementById(`${prefijo}-espacio-texto`);
    const clase = porcentajeReal >= 85 ? 'bg-danger' : porcentajeReal >= 70 ? 'bg-warning' : 'bg-success';

    barra.style.width = `${porcentajeVisible.toFixed(1)}%`;
    barra.textContent = `${porcentajeReal.toFixed(1)}%`;
    barra.setAttribute('aria-valuenow', porcentajeVisible.toFixed(1));
    barra.classList.remove('bg-success', 'bg-warning', 'bg-danger');
    barra.classList.add(clase);
    texto.textContent = `${formatearBytes(usados)} usados · ${formatearBytes(Math.max(limite - usados, 0))} libres`;
    return porcentajeReal;
}

async function cargarUsoAlmacenamiento() {
    const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
    if (!sesion || sesion.rol !== 'admin') return;

    const errorBox = document.getElementById('almacenamiento-error');
    const alerta = document.getElementById('almacenamiento-alerta');
    const boton = document.getElementById('btn-actualizar-almacenamiento');
    if (!errorBox || !alerta) return;

    errorBox.style.display = 'none';
    alerta.style.display = 'none';
    if (boton) boton.disabled = true;

    try {
        const { data, error } = await supabaseClient.rpc('obtener_uso_almacenamiento');
        if (error) throw error;
        const uso = Array.isArray(data) ? data[0] : data;
        if (!uso) throw new Error('Supabase no devolvió información de almacenamiento.');

        const porcentajeBd = actualizarMedidor('bd', Number(uso.database_bytes) || 0, LIMITE_BD_BYTES);
        const porcentajeStorage = actualizarMedidor('storage', Number(uso.storage_bytes) || 0, LIMITE_STORAGE_BYTES);
        const cantidad = Number(uso.storage_files) || 0;
        document.getElementById('storage-cantidad').textContent = `${cantidad} ${cantidad === 1 ? 'archivo' : 'archivos'}`;

        const maximo = Math.max(porcentajeBd, porcentajeStorage);
        if (maximo >= 85) {
            alerta.className = 'alert alert-danger mt-3 mb-0 py-2';
            alerta.textContent = 'Capacidad crítica: realiza una copia de seguridad y libera espacio o amplía el plan antes de subir más archivos.';
            alerta.style.display = 'block';
        } else if (maximo >= 70) {
            alerta.className = 'alert alert-warning mt-3 mb-0 py-2';
            alerta.textContent = 'Precaución: el almacenamiento superó el 70 %. Planifica una limpieza o ampliación de capacidad.';
            alerta.style.display = 'block';
        }
    } catch (error) {
        console.error('[Almacenamiento]', error);
        errorBox.innerHTML = 'No se pudo consultar el espacio. Ejecuta una vez el archivo <code>sql/uso_almacenamiento.sql</code> en el SQL Editor de Supabase.';
        errorBox.style.display = 'block';
    } finally {
        if (boton) boton.disabled = false;
    }
}
