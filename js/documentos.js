// ============================================================
// documentos.js — Repositorio MOF/POE con archivos reales
// (PDF, Word, Excel) guardados en Supabase Storage.
//
// Requiere que exista un bucket llamado "documentos" en tu
// proyecto de Supabase (Storage -> New bucket -> nombre: documentos,
// marcarlo como "Public bucket" para que la descarga funcione con
// una URL directa). Ver LEEME.md para el paso a paso.
// ============================================================

const BUCKET = 'documentos';

document.addEventListener('DOMContentLoaded', async () => {
    const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
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
                categoria, nombre, version,
                fecha_vigencia: vigencia,
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
            manejarErrorSupabase(err, 'No se pudo subir el archivo. Revisa que el bucket "documentos" exista en Supabase Storage.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-upload"></i> Subir versión';
        }
    });
});

async function cargarDocumentos() {
    const { data, error } = await supabaseClient
        .from('documentos')
        .select('*')
        .order('categoria')
        .order('created_at', { ascending: false });
    if (error) return manejarErrorSupabase(error);

    const tbody = document.querySelector('#tabla-documentos tbody');
    tbody.innerHTML = data.map(d => {
        const enlace = d.archivo_path
            ? `<a href="#" onclick="descargarDocumento('${d.archivo_path}','${(d.archivo_nombre || 'documento').replace(/'/g, "")}'); return false;">
                 <i class="fas fa-download"></i> ${d.archivo_nombre || 'Descargar'}
               </a>`
            : (d.url_archivo ? `<a href="${d.url_archivo}" target="_blank">Ver enlace</a>` : '-');

        return `
        <tr class="${d.estado === 'obsoleto' ? 'text-muted' : ''}">
            <td>${d.categoria}</td><td>${d.nombre}</td><td>${d.version}</td>
            <td>${d.fecha_vigencia || ''}</td>
            <td><span class="badge badge-${d.estado === 'vigente' ? 'success' : 'secondary'}">${d.estado}</span></td>
            <td>${enlace}</td>
            <td class="solo-escritura text-nowrap">
                <button class="btn btn-sm btn-outline-primary" title="Editar" onclick='abrirEdicionDocumento(${JSON.stringify(d)})'>
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" title="Eliminar" onclick="eliminarDocumento('${d.id}','${d.archivo_path || ''}','${(d.nombre || '').replace(/'/g, "")}')">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        </tr>`;
    }).join('');

    if (window.jQuery) {
        document.querySelectorAll('.solo-escritura').forEach(el => {
            const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
            if (sesion && sesion.rol === 'auxiliar') el.style.display = 'none';
        });
    }
}

// ------------------------------------------------------------
// Editar documento (metadata + reemplazo opcional del archivo)
// ------------------------------------------------------------
function abrirEdicionDocumento(doc) {
    document.getElementById('ed-id').value = doc.id;
    document.getElementById('ed-archivo-path-actual').value = doc.archivo_path || '';
    document.getElementById('ed-categoria').value = doc.categoria;
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

        const cambios = { categoria, nombre, version, fecha_vigencia: vigencia };

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

            // Borra el archivo anterior del bucket, si existía
            if (archivoPathActual) {
                await supabaseClient.storage.from(BUCKET).remove([archivoPathActual]);
            }
        }

        const { error: errUpdate } = await supabaseClient
            .from('documentos').update(cambios).eq('id', id);
        if (errUpdate) throw errUpdate;

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
async function descargarDocumento(path, nombreOriginal) {
    try {
        const { data, error } = await supabaseClient.storage.from(BUCKET).download(path);
        if (error) throw error;

        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombreOriginal || 'documento';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        manejarErrorSupabase(err, 'No se pudo descargar el archivo.');
    }
}
