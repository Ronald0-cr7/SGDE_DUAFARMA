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
        .eq('producto_id', productoId).order('created_at', { ascending:true });
    if (error) return manejarErrorSupabase(error);
    KARDEX_ACTUAL = data || [];
    document.querySelector('#tabla-kardex tbody').innerHTML = KARDEX_ACTUAL.map(m => `<tr>
        <td>${escaparKardex(m.fecha)}</td><td>${escaparKardex(m.guia_numero)}</td><td>${escaparKardex(m.proveedor_cliente)}</td>
        <td>${escaparKardex(m.lote)}</td><td>${escaparKardex(m.fecha_venc)}</td><td>${m.ingreso || 0}</td><td>${m.salida || 0}</td>
        <td><strong>${m.saldo || 0}</strong></td><td>${escaparKardex(m.observaciones)}</td></tr>`).join('');
}

async function exportarKardexExcel() {
    if (!KARDEX_ACTUAL.length) return alert('No hay movimientos para exportar.');
    const producto = PRODUCTOS_CACHE.find(p => p.id === document.getElementById('kx-producto').value);
    try { await SGDEExcel.exportarKardexPlantilla(producto, KARDEX_ACTUAL); }
    catch (error) { console.error(error); alert('No se pudo generar el archivo Excel. Verifica tu conexión e inténtalo nuevamente.'); }
}
