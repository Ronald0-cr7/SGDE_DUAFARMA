// ============================================================
// documentos.js — Repositorio MOF/POE con archivos reales
// (PDF, Word, Excel) guardados en Supabase Storage.
//
// Las descargas del bucket documentos usan la sesión de Supabase.
// ============================================================

const BUCKET = 'documentos';
const fechaLima = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
});
let documentosCargados = [];

function fechaDocumento(valor) {
    const fecha = valor instanceof Date ? valor : new Date(valor);
    if (!valor || !Number.isFinite(fecha.getTime())) return '';
    const partes = Object.fromEntries(fechaLima.formatToParts(fecha).map(({type, value}) => [type, value]));
    return `${partes.year}-${partes.month}-${partes.day}`;
}

const hoyLocal = () => fechaDocumento(new Date());

document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.perfilSGDEListo) return;
    const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
    const filtros = document.getElementById('form-filtrar-documentos');
    filtros.addEventListener('submit', e => {
        e.preventDefault();
        renderizarDocumentos();
    });
    filtros.addEventListener('reset', () => queueMicrotask(renderizarDocumentos));
    document.getElementById('dc-buscar').addEventListener('input', renderizarDocumentos);
    document.querySelector('#tabla-documentos tbody').addEventListener('click', e => {
        const boton = e.target.closest('[data-documento]');
        if (!boton) return;
        e.preventDefault();
        const doc = documentosCargados.find(d => d.id === boton.dataset.documento);
        if (!doc) return;
        if (boton.classList.contains('descargar-documento')) return descargarDocumento(doc);
        if (sesion?.rol === 'auxiliar') return;
        if (boton.classList.contains('editar-documento')) return abrirEdicionDocumento(doc);
        eliminarDocumento(doc.id, doc.archivo_path, doc.nombre);
    });
    await cargarDocumentos();

    const formEditar = document.getElementById('form-editar-documento');
    if (formEditar) {
        formEditar.addEventListener('submit', async (e) => {
            e.preventDefault();
            await guardarEdicionDocumento(sesion);
        });
    }

    const form = document.getElementById('form-documento');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-subir-doc');
        const archivoInput = document.getElementById('dc-archivo');
        const archivo = archivoInput.files[0];

        if (!archivo) {
            alert('Selecciona un archivo (PDF, Word o Excel).');
            return;
        }
        const codigo = document.getElementById('dc-codigo').value.trim();
        if (!codigo) return alert('Ingresa el código del documento.');

        btn.disabled = true;
        btn.textContent = 'Subiendo...';

        try {
            const categoria = document.getElementById('dc-categoria').value;
            const nombre = document.getElementById('dc-nombre').value.trim();
            const version = document.getElementById('dc-version').value.trim();
            const vigencia = document.getElementById('dc-vigencia').value || null;

            // Ruta única dentro del bucket: categoria/nombre-version-timestamp.ext
            const extension = archivo.name.split('.').pop();
            const rutaSegura = `${categoria}/${nombre.replace(/[^a-zA-Z0-9-_]/g, '_')}_${version}_${Date.now()}.${extension}`;

            // 1) Subir el archivo binario al bucket
            const { error: errUpload } = await supabaseClient
                .storage
                .from(BUCKET)
                .upload(rutaSegura, archivo, { cacheControl: '3600', upsert: false });
            if (errUpload) throw errUpload;

            // 2) Guardar la referencia del archivo en la tabla documentos
            const registro = {
                codigo, categoria, nombre, version,
                fecha_vigencia: vigencia,
                estado: vigencia && vigencia < hoyLocal() ? 'obsoleto' : 'vigente',
                archivo_path: rutaSegura,
                archivo_nombre: archivo.name,
                subido_por: sesion.usuario
            };
            const { data, error: errInsert } = await supabaseClient
                .from('documentos').insert([registro]).select().single();
            if (errInsert) throw errInsert;

            // el trigger fn_obsoletar_version_anterior ya marca la version previa como obsoleta
            await registrarAuditoria('INSERT', 'documentos', data.id, `Nueva versión ${version} de "${nombre}" (${archivo.name})`);

            alert('✅ Documento subido correctamente. La versión anterior (si existía) quedó marcada como obsoleta.');
            form.reset();
            await cargarDocumentos();
        } catch (err) {
            manejarErrorSupabase(err, `No se pudo registrar el documento. ${err.message || ''}`);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-upload"></i> Subir versión';
        }
    });
});

async function cargarDocumentos() {
    const hoy = hoyLocal();
    const { error: errorVigencia } = await supabaseClient.from('documentos')
        .update({ estado: 'obsoleto' }).eq('estado', 'vigente').lt('fecha_vigencia', hoy);
    if (errorVigencia) console.error('No se pudo actualizar la vigencia de los documentos:', errorVigencia);
    const documentos = [];
    const limite = 500;
    for (let inicio = 0; ; inicio += limite) {
        const { data, error } = await supabaseClient.from('documentos').select('*')
            .order('categoria').order('created_at', { ascending: false }).order('id')
            .range(inicio, inicio + limite - 1);
        if (error) return manejarErrorSupabase(error);
        documentos.push(...data);
        if (data.length < limite) break;
    }
    documentosCargados = documentos;
    renderizarDocumentos();
}

function escaparDocumento(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

function filtrarDocumentos(documentos, texto, desde, hasta) {
    const normalizar = valor => String(valor ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
    const busqueda = normalizar(texto);
    return documentos.filter(d => {
        const fecha = fechaDocumento(d.created_at);
        return (!desde || fecha >= desde) && (!hasta || (fecha && fecha <= hasta))
            && (!busqueda || [d.codigo, d.nombre, d.categoria].some(valor => normalizar(valor).includes(busqueda)));
    });
}

function renderizarDocumentos() {
    const hoy = hoyLocal();
    const desde = document.getElementById('dc-desde').value;
    const hasta = document.getElementById('dc-hasta').value;
    const estadoFiltro = document.getElementById('dc-filtro-estado');
    if (desde && hasta && desde > hasta) {
        estadoFiltro.textContent = 'La fecha de inicio no puede ser posterior a la fecha final.';
        return;
    }
    const data = filtrarDocumentos(documentosCargados, document.getElementById('dc-buscar').value, desde, hasta);
    estadoFiltro.textContent = `${data.length} documento(s). El rango se aplica a la fecha de registro.`;
    const tbody = document.querySelector('#tabla-documentos tbody');
    const soloLectura = JSON.parse(localStorage.getItem('sesion_usuario') || 'null')?.rol === 'auxiliar';
    tbody.innerHTML = data.map(d => {
        const estado = d.estado === 'obsoleto' || (d.fecha_vigencia && d.fecha_vigencia < hoy) ? 'obsoleto' : 'vigente';
        const id = escaparDocumento(d.id);
        const externo = /^https?:\/\//i.test(d.url_archivo || '') ? escaparDocumento(d.url_archivo) : '';
        const enlace = d.archivo_path
            ? `<a href="#" class="descargar-documento" data-documento="${id}">
                 <i class="fas fa-download"></i> ${escaparDocumento(d.archivo_nombre || 'Descargar')}
               </a>`
            : (externo ? `<a href="${externo}" target="_blank" rel="noopener noreferrer">Ver enlace</a>` : '—');

        return `
        <tr class="${estado === 'obsoleto' ? 'text-muted' : ''}">
            <td>${escaparDocumento(d.codigo || '—')}</td><td>${escaparDocumento(d.categoria)}</td>
            <td>${escaparDocumento(d.nombre)}</td><td>${escaparDocumento(d.version)}</td>
            <td>${fechaDocumento(d.created_at)}</td><td>${escaparDocumento(d.fecha_vigencia)}</td>
            <td><span class="badge badge-${estado === 'vigente' ? 'success' : 'secondary'}">${estado}</span></td>
            <td>${enlace}</td>
            ${soloLectura ? '' : `<td class="solo-escritura text-nowrap">
                <button type="button" class="btn btn-sm btn-outline-primary editar-documento" title="Editar" data-documento="${id}">
                    <i class="fas fa-edit"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger" title="Eliminar" data-documento="${id}">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>`}
        </tr>`;
    }).join('');

}

// ------------------------------------------------------------
// Editar documento (metadata + reemplazo opcional del archivo)
// ------------------------------------------------------------
function abrirEdicionDocumento(doc) {
    document.getElementById('ed-id').value = doc.id;
    document.getElementById('ed-archivo-path-actual').value = doc.archivo_path || '';
    document.getElementById('ed-categoria').value = doc.categoria;
    document.getElementById('ed-codigo').value = doc.codigo || '';
    document.getElementById('ed-codigo').required = Boolean(doc.codigo);
    document.getElementById('ed-nombre').value = doc.nombre;
    document.getElementById('ed-version').value = doc.version;
    document.getElementById('ed-vigencia').value = doc.fecha_vigencia || '';
    document.getElementById('ed-archivo').value = '';
    $('#modal-editar-doc').modal('show');
}

async function guardarEdicionDocumento(sesion) {
    const btn = document.getElementById('btn-guardar-edicion');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        const id = document.getElementById('ed-id').value;
        const archivoPathActual = document.getElementById('ed-archivo-path-actual').value;
        const categoria = document.getElementById('ed-categoria').value;
        const nombre = document.getElementById('ed-nombre').value.trim();
        const version = document.getElementById('ed-version').value.trim();
        const vigencia = document.getElementById('ed-vigencia').value || null;
        const nuevoArchivo = document.getElementById('ed-archivo').files[0];

        const codigo = document.getElementById('ed-codigo').value.trim();
        if (document.getElementById('ed-codigo').required && !codigo) return alert('Ingresa el código del documento.');
        const cambios = { codigo: codigo || null, categoria, nombre, version, fecha_vigencia: vigencia };
        if (vigencia && vigencia < hoyLocal()) cambios.estado = 'obsoleto';

        // Si el usuario seleccionó un archivo nuevo, lo sube y reemplaza el anterior
        if (nuevoArchivo) {
            const extension = nuevoArchivo.name.split('.').pop();
            const rutaSegura = `${categoria}/${nombre.replace(/[^a-zA-Z0-9-_]/g, '_')}_${version}_${Date.now()}.${extension}`;

            const { error: errUpload } = await supabaseClient
                .storage.from(BUCKET)
                .upload(rutaSegura, nuevoArchivo, { cacheControl: '3600', upsert: false });
            if (errUpload) throw errUpload;

            cambios.archivo_path = rutaSegura;
            cambios.archivo_nombre = nuevoArchivo.name;

        }

        const { error: errUpdate } = await supabaseClient
            .from('documentos').update(cambios).eq('id', id).select('id').single();
        if (errUpdate) throw errUpdate;
        if (cambios.archivo_path && archivoPathActual) {
            await supabaseClient.storage.from(BUCKET).remove([archivoPathActual]);
        }

        await registrarAuditoria('UPDATE', 'documentos', id, `Documento "${nombre}" editado (v${version})`);

        $('#modal-editar-doc').modal('hide');
        await cargarDocumentos();
    } catch (err) {
        manejarErrorSupabase(err, 'No se pudo guardar la edición del documento.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Guardar cambios';
    }
}

// ------------------------------------------------------------
// Eliminar documento (registro + archivo en Storage)
// ------------------------------------------------------------
async function eliminarDocumento(id, archivoPath, nombre) {
    if (!confirm(`¿Eliminar el documento "${nombre}"? Esta acción no se puede deshacer.`)) return;

    try {
        if (archivoPath) {
            const { error: errRemove } = await supabaseClient.storage.from(BUCKET).remove([archivoPath]);
            if (errRemove) throw errRemove;
        }

        const { error: errDelete } = await supabaseClient.from('documentos').delete().eq('id', id);
        if (errDelete) throw errDelete;

        await registrarAuditoria('DELETE', 'documentos', id, `Documento "${nombre}" eliminado`);
        await cargarDocumentos();
    } catch (err) {
        manejarErrorSupabase(err, 'No se pudo eliminar el documento.');
    }
}

// Descarga el archivo desde Storage y fuerza el guardado con su nombre original
async function descargarDocumento(doc) {
    try {
        const { data, error } = await supabaseClient.storage.from(BUCKET).download(doc.archivo_path);
        if (error) throw error;

        const esWord = /\.docx$/i.test(doc.archivo_nombre || doc.archivo_path);
        const contenido = esWord && doc.codigo ? await agregarCodigoWord(data, doc.codigo) : data;
        const url = URL.createObjectURL(contenido);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.archivo_nombre || 'documento';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
        manejarErrorSupabase(err, `No se pudo descargar el archivo. ${err.message || ''}`);
    }
}
