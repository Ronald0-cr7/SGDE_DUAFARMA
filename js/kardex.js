let PRODUCTOS_CACHE = [];
let KARDEX_ACTUAL = [];

document.addEventListener('DOMContentLoaded', async () => {
    const sel = document.getElementById('kx-producto');
    const { data: productos, error } = await supabaseClient.from('productos').select('*').order('nombre');
    if (error) return manejarErrorSupabase(error);
    PRODUCTOS_CACHE = productos || [];
    sel.innerHTML = PRODUCTOS_CACHE.map(p => `<option value="${p.id}">${escaparKardex(p.codigo)} - ${escaparKardex(p.nombre)}</option>`).join('');
    renderListaKardex();
    sel.addEventListener('change', cargarKardex);
    document.querySelector('#tabla-lista-kardex tbody').addEventListener('click', descargarKardexDeLista);
    document.querySelector('#tabla-kardex tbody').addEventListener('click', manejarAccionKardex);
    document.getElementById('form-movimiento').addEventListener('submit', guardarMovimientoKardex);
    if (PRODUCTOS_CACHE.length) cargarKardex();
});

function escaparKardex(texto) {
    return String(texto ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]);
}

function renderListaKardex() {
    document.querySelector('#tabla-lista-kardex tbody').innerHTML = PRODUCTOS_CACHE.map(producto => `<tr>
        <td><strong>${escaparKardex(producto.codigo)}</strong></td>
        <td>${escaparKardex(producto.nombre)}</td>
        <td>${escaparKardex(producto.fabricante)}</td>
        <td><strong>${Number(producto.stock || 0)}</strong></td>
        <td><button type="button" class="btn btn-success btn-sm descargar-kardex-producto" data-id="${producto.id}">
            <i class="fas fa-file-excel"></i> Descargar Kardex
        </button></td></tr>`).join('');
}

async function descargarKardexDeLista(e) {
    const boton = e.target.closest('.descargar-kardex-producto');
    if (!boton) return;
    const producto = PRODUCTOS_CACHE.find(p => p.id === boton.dataset.id);
    if (!producto) return;
    boton.disabled = true;
    try {
        const { data, error } = await supabaseClient.from('kardex_movimientos').select('*')
            .eq('producto_id', producto.id).order('created_at', { ascending:true });
        if (error) throw error;
        await SGDEExcel.exportarKardexPlantilla(producto, data || []);
    } catch (error) {
        console.error('[Kardex Excel]', error);
        alert(`No se pudo generar el Kardex: ${error?.message || 'error desconocido'}`);
    } finally {
        boton.disabled = false;
    }
}

async function cargarKardex() {
    const productoId = document.getElementById('kx-producto').value;
    const producto = PRODUCTOS_CACHE.find(p => p.id === productoId);
    document.getElementById('kx-cabecera').innerHTML = producto ? `<div class="row">
        <div class="col-md-3"><strong>Código:</strong> ${escaparKardex(producto.codigo)}</div>
        <div class="col-md-3"><strong>Presentación:</strong> ${escaparKardex(producto.presentacion)}</div>
        <div class="col-md-3"><strong>Fabricante:</strong> ${escaparKardex(producto.fabricante)}</div>
        <div class="col-md-3"><strong>Stock actual:</strong> <span class="font-weight-bold">${producto.stock || 0}</span></div></div>` : '';
    const { data, error } = await supabaseClient.from('kardex_movimientos').select('*')
        .eq('producto_id', productoId).order('created_at', { ascending:true }).order('id', { ascending:true });
    if (error) return manejarErrorSupabase(error);
    KARDEX_ACTUAL = data || [];
    const puedeEditar = JSON.parse(localStorage.getItem('sesion_usuario') || 'null')?.rol !== 'auxiliar';
    document.querySelector('#tabla-kardex tbody').innerHTML = KARDEX_ACTUAL.map(m => `<tr>
        <td>${escaparKardex(m.fecha)}</td><td>${escaparKardex(m.guia_numero)}</td><td>${escaparKardex(m.proveedor_cliente)}</td>
        <td>${escaparKardex(m.lote)}</td><td>${escaparKardex(m.fecha_venc)}</td><td>${m.ingreso || 0}</td><td>${m.salida || 0}</td>
        <td><strong>${m.saldo || 0}</strong></td><td>${escaparKardex(m.observaciones)}</td>
        <td class="text-nowrap">${!puedeEditar ? '<span class="text-muted">Solo lectura</span>' : m.recepcion_id ? '<span class="text-muted" title="Movimiento generado por un acta">Acta vinculada</span>' : `
            <button type="button" class="btn btn-sm btn-outline-primary editar-movimiento" data-id="${m.id}" title="Editar movimiento" aria-label="Editar movimiento"><i class="fas fa-pen"></i></button>
            <button type="button" class="btn btn-sm btn-outline-danger eliminar-movimiento" data-id="${m.id}" title="Eliminar movimiento" aria-label="Eliminar movimiento"><i class="fas fa-trash"></i></button>`}</td></tr>`).join('');
}

async function manejarAccionKardex(e) {
    if (JSON.parse(localStorage.getItem('sesion_usuario') || 'null')?.rol === 'auxiliar') return;
    const boton = e.target.closest('.editar-movimiento, .eliminar-movimiento');
    if (!boton) return;
    const movimiento = KARDEX_ACTUAL.find(m => m.id === boton.dataset.id);
    if (!movimiento || movimiento.recepcion_id) return;
    if (boton.classList.contains('editar-movimiento')) {
        for (const [campo, valor] of Object.entries({
            id: movimiento.id, fecha: movimiento.fecha, guia: movimiento.guia_numero,
            proveedor: movimiento.proveedor_cliente, lote: movimiento.lote,
            vencimiento: movimiento.fecha_venc, ingreso: movimiento.ingreso ?? 0,
            salida: movimiento.salida ?? 0, observaciones: movimiento.observaciones
        })) document.getElementById(`km-${campo}`).value = valor ?? '';
        $('#modal-movimiento').modal('show');
        return;
    }
    if (!confirm('¿Eliminar este movimiento de Kardex? Los saldos y el stock se recalcularán.')) return;
    boton.disabled = true;
    try {
        const { data, error } = await supabaseClient.from('kardex_movimientos').delete()
            .eq('id', movimiento.id).is('recepcion_id', null).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se eliminó el movimiento. Actualiza la página e inténtalo de nuevo.');
        await registrarAuditoria('DELETE', 'kardex_movimientos', movimiento.id, `Movimiento eliminado del producto ${movimiento.producto_id}`);
        await refrescarKardex();
    } catch (error) {
        manejarErrorSupabase(error, `No se pudo eliminar el movimiento: ${error.message}`);
    } finally { boton.disabled = false; }
}

async function guardarMovimientoKardex(e) {
    e.preventDefault();
    if (JSON.parse(localStorage.getItem('sesion_usuario') || 'null')?.rol === 'auxiliar') return;
    const form = e.currentTarget;
    const boton = form.querySelector('[type="submit"]');
    const id = document.getElementById('km-id').value;
    const anterior = KARDEX_ACTUAL.find(m => m.id === id);
    if (!anterior || anterior.recepcion_id) return;
    const ingreso = Number(document.getElementById('km-ingreso').value);
    const salida = Number(document.getElementById('km-salida').value);
    if (!Number.isFinite(ingreso) || !Number.isFinite(salida) || ingreso < 0 || salida < 0) {
        alert('Ingreso y salida deben ser números no negativos.'); return;
    }
    const registro = {
        fecha: document.getElementById('km-fecha').value,
        guia_numero: document.getElementById('km-guia').value.trim(),
        proveedor_cliente: document.getElementById('km-proveedor').value.trim(),
        lote: document.getElementById('km-lote').value.trim(),
        fecha_venc: document.getElementById('km-vencimiento').value || null,
        ingreso, salida,
        observaciones: document.getElementById('km-observaciones').value.trim()
    };
    boton.disabled = true;
    try {
        const { data, error } = await supabaseClient.from('kardex_movimientos').update(registro)
            .eq('id', id).is('recepcion_id', null).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se actualizó el movimiento. Actualiza la página e inténtalo de nuevo.');
        await registrarAuditoria('UPDATE', 'kardex_movimientos', id, `Movimiento actualizado del producto ${anterior.producto_id}`);
        $('#modal-movimiento').modal('hide');
        await refrescarKardex();
    } catch (error) {
        manejarErrorSupabase(error, `No se pudo actualizar el movimiento: ${error.message}`);
    } finally { boton.disabled = false; }
}

async function refrescarKardex() {
    const id = document.getElementById('kx-producto').value;
    const { data, error } = await supabaseClient.from('productos').select('*').order('nombre');
    if (error) return manejarErrorSupabase(error);
    PRODUCTOS_CACHE = data || [];
    renderListaKardex();
    const selector = document.getElementById('kx-producto');
    selector.innerHTML = PRODUCTOS_CACHE.map(p => `<option value="${p.id}">${escaparKardex(p.codigo)} - ${escaparKardex(p.nombre)}</option>`).join('');
    selector.value = id;
    await cargarKardex();
}

async function exportarKardexExcel() {
    if (!KARDEX_ACTUAL.length) return alert('No hay movimientos para exportar.');
    const producto = PRODUCTOS_CACHE.find(p => p.id === document.getElementById('kx-producto').value);
    try { await SGDEExcel.exportarKardexPlantilla(producto, KARDEX_ACTUAL); }
    catch (error) { console.error(error); alert('No se pudo generar el archivo Excel. Verifica tu conexión e inténtalo nuevamente.'); }
}
