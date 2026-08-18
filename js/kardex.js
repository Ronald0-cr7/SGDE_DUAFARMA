let PRODUCTOS_CACHE = [];
let KARDEX_ACTUAL = [];

document.addEventListener('DOMContentLoaded', async () => {
    const sel = document.getElementById('kx-producto');

    const { data: productos, error } = await supabaseClient.from('productos').select('*').order('nombre');
    if (error) return manejarErrorSupabase(error);
    PRODUCTOS_CACHE = productos;
    sel.innerHTML = productos.map(p => `<option value="${p.id}">${p.codigo} - ${p.nombre}</option>`).join('');

    sel.addEventListener('change', () => cargarKardex(productos));
    if (productos.length) cargarKardex(productos);
});

async function cargarKardex(productos) {
    const productoId = document.getElementById('kx-producto').value;
    const producto = productos.find(p => p.id === productoId);

    document.getElementById('kx-cabecera').innerHTML = producto ? `
        <div class="row">
            <div class="col-md-3"><strong>Código:</strong> ${producto.codigo}</div>
            <div class="col-md-3"><strong>Presentación:</strong> ${producto.presentacion || ''}</div>
            <div class="col-md-3"><strong>Fabricante:</strong> ${producto.fabricante || ''}</div>
            <div class="col-md-3"><strong>Stock actual:</strong> <span class="font-weight-bold">${producto.stock}</span></div>
        </div>` : '';

    const { data, error } = await supabaseClient
        .from('kardex_movimientos')
        .select('*')
        .eq('producto_id', productoId)
        .order('created_at', { ascending: true });
    if (error) return manejarErrorSupabase(error);

    KARDEX_ACTUAL = data;
    const tbody = document.querySelector('#tabla-kardex tbody');
    tbody.innerHTML = data.map(m => `
        <tr>
            <td>${m.fecha}</td><td>${m.guia_numero || ''}</td><td>${m.proveedor_cliente || ''}</td>
            <td>${m.lote || ''}</td><td>${m.fecha_venc || ''}</td>
            <td>${m.ingreso}</td><td>${m.salida}</td><td><strong>${m.saldo}</strong></td>
            <td>${m.observaciones || ''}</td>
        </tr>`).join('');
}

// Exporta el kardex actualmente visible a un archivo .xlsx descargable
function exportarKardexExcel() {
    if (!KARDEX_ACTUAL.length) { alert('No hay movimientos para exportar.'); return; }

    const sel = document.getElementById('kx-producto');
    const producto = PRODUCTOS_CACHE.find(p => p.id === sel.value);

    const filas = KARDEX_ACTUAL.map(m => ({
        'Fecha': m.fecha, 'N° Guía': m.guia_numero, 'Proveedor/Cliente': m.proveedor_cliente,
        'Lote': m.lote, 'F. Venc.': m.fecha_venc, 'Ingreso': m.ingreso, 'Salida': m.salida,
        'Saldo': m.saldo, 'Realizado por': m.realizado_por, 'Verificado por': m.verificado_por,
        'Observaciones': m.observaciones
    }));

    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Kardex');

    const nombreArchivo = `Kardex_${producto ? producto.codigo : 'producto'}_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(libro, nombreArchivo);
}
