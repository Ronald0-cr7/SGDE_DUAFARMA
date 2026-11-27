// Copia de datos de la aplicación. Requiere la función sgde-backup y su SQL.
// Las claves privilegiadas permanecen en Supabase, nunca en este archivo.
(function () {
    'use strict';
    const TABLAS = ['usuarios','productos','recepciones','recepcion_detalle','kardex_movimientos',
        'documentos','log_auditoria','repositorios','carpetas','archivos_repositorio'];
    const MAGIC = new TextEncoder().encode('SGDEBK02');
    let ocupado = false;
    const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    function progreso(texto) {
        const el = document.getElementById('rp-backup-estado');
        if (el) el.textContent = texto;
    }
    function bloquear(valor) {
        ocupado = valor;
        ['btn-crear-backup','btn-restaurar-backup'].forEach(id => {
            const boton = document.getElementById(id);
            if (boton) boton.disabled = valor;
        });
    }
    function requisitos() {
        if (!exigirAdminRepositorio()) return false;
        if (!window.crypto?.subtle || typeof JSZip === 'undefined') {
            throw new Error('Abre el sistema mediante HTTPS o localhost y comprueba que cargó el componente ZIP.');
        }
        return true;
    }
    function pedirSecreto(titulo, explicacion, repetir = false) {
        return new Promise(resolve => {
            const dialog = document.createElement('dialog');
            dialog.style.cssText = 'width:min(480px,95vw);border:1px solid #666;border-radius:12px;padding:24px';
            const form = document.createElement('form'); form.method = 'dialog';
            const heading = document.createElement('h3'); heading.textContent = titulo;
            const help = document.createElement('p'); help.textContent = explicacion;
            const label = document.createElement('label'); label.textContent = 'Contraseña';
            const input = document.createElement('input'); input.type = 'password'; input.required = true;
            input.autocomplete = repetir ? 'new-password' : 'current-password'; input.className = 'form-control mb-3';
            label.appendChild(input);
            form.append(heading, help, label);
            let confirmacion;
            if (repetir) {
                input.minLength = 12;
                const label2 = document.createElement('label'); label2.textContent = 'Repite la contraseña de la copia';
                confirmacion = document.createElement('input'); confirmacion.type = 'password';
                confirmacion.autocomplete = 'new-password'; confirmacion.required = true;
                confirmacion.className = 'form-control mb-3'; label2.appendChild(confirmacion); form.appendChild(label2);
            }
            const error = document.createElement('p'); error.setAttribute('role', 'alert');
            const cancelar = document.createElement('button'); cancelar.type = 'button'; cancelar.textContent = 'Cancelar';
            cancelar.className = 'btn btn-secondary mr-2'; cancelar.onclick = () => dialog.close();
            const aceptar = document.createElement('button'); aceptar.type = 'submit'; aceptar.textContent = 'Continuar';
            aceptar.className = 'btn btn-success'; form.append(error, cancelar, aceptar); dialog.appendChild(form);
            let resultado = null;
            form.addEventListener('submit', e => {
                e.preventDefault();
                if (confirmacion && input.value !== confirmacion.value) {
                    error.textContent = 'Las contraseñas no coinciden.'; return;
                }
                resultado = input.value; dialog.close();
            });
            dialog.addEventListener('close', () => {
                input.value = ''; if (confirmacion) confirmacion.value = '';
                dialog.remove(); resolve(resultado);
            }, { once: true });
            document.body.appendChild(dialog); dialog.showModal(); input.focus();
        });
    }
    async function api(action, body, sesion, headers = {}) {
        const client = window.supabaseClient;
        const { data: { session }, error } = await client.auth.getSession();
        if (error || !session) throw new Error('Vuelve a iniciar sesión para continuar.');
        const base = client.supabaseUrl;
        const response = await fetch(`${base}/functions/v1/sgde-backup?action=${action}`, {
            method: 'POST', headers: {
                apikey: client.supabaseKey,
                Authorization: `Bearer ${session.access_token}`,
                ...(body instanceof Blob ? { 'Content-Type': body.type || 'application/octet-stream' } : { 'Content-Type': 'application/json' }),
                ...(sesion ? { 'x-backup-job': sesion.id, 'x-backup-token': sesion.token } : {}), ...headers,
            }, body: body instanceof Blob ? body : JSON.stringify(body),
        }).catch(() => { throw new Error('No se pudo contactar al servicio de respaldo. Comprueba la conexión y la instalación de la función sgde-backup.'); });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `El servicio de respaldo respondió ${response.status}. Comprueba su instalación.`);
        return data;
    }
    async function clave(password, salt) {
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
            material, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
    }
    async function descifrar(file, password) {
        const data = new Uint8Array(await file.arrayBuffer());
        if (data.length < 52 || !MAGIC.every((b, i) => data[i] === b)) {
            throw new Error('Selecciona una copia completa .sgde. Los ZIP antiguos solo contienen la biblioteca y no se pueden usar como copia completa.');
        }
        const key = await clave(password, data.slice(8,24));
        try {
            return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(24,36), additionalData: MAGIC }, key, data.slice(36));
        } catch (_) { throw new Error('Contraseña de la copia incorrecta o archivo dañado. No se modificó ningún registro.'); }
    }
    function validar(m, zip) {
        if (!m || m.formato !== 'SGDE_DUAFARMA_COMPLETO' || ![2, 3].includes(m.version) ||
            !m.tablas || !Array.isArray(m.esquema) || !Array.isArray(m.archivos) ||
            Object.keys(m.tablas).length !== TABLAS.length || TABLAS.some(t => !Array.isArray(m.tablas[t]))) {
            throw new Error('La copia no contiene los diez conjuntos de registros requeridos.');
        }
        const rutas = new Set();
        const entradas = new Set();
        for (const f of m.archivos) {
            const id = `${f.bucket}/${f.path}`;
            if (!['repositorios','documentos'].includes(f.bucket) || typeof f.path !== 'string' || !f.path ||
                !(m.version === 2 ? /^archivos\/[0-9]+$/.test(f.zip_path) :
                    /^(repositorios|documentos)\/(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\\\x00]+$/.test(f.zip_path)) || !/^[a-f0-9]{64}$/.test(f.sha256) ||
                !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > 50000000 ||
                rutas.has(id) || entradas.has(f.zip_path) || !zip.file(f.zip_path)) {
                throw new Error('La lista de archivos está incompleta, duplicada o tiene un formato inválido.');
            }
            rutas.add(id); entradas.add(f.zip_path);
        }
        for (const [tabla, campo, bucket] of [['documentos','archivo_path','documentos'], ['archivos_repositorio','storage_path','repositorios']]) {
            for (const r of m.tablas[tabla]) {
                if (r[campo] != null && !rutas.has(`${bucket}/${r[campo]}`)) throw new Error(`Falta un archivo de ${tabla}.`);
            }
        }
    }
    function segmento(valor) {
        const limpio = String(valor || 'Sin nombre').normalize('NFC')
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 100);
        return !limpio || /^\.+$/.test(limpio) ? 'Sin nombre' :
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(limpio) ? `_${limpio}` : limpio;
    }
    function organizar(tablas) {
        const usadas = new Set();
        function unica(ruta) {
            let resultado = ruta; let n = 2;
            const punto = ruta.lastIndexOf('.');
            const extension = punto > ruta.lastIndexOf('/') ? ruta.slice(punto) : '';
            const base = extension ? ruta.slice(0, punto) : ruta;
            while (usadas.has(resultado.toLowerCase())) resultado = `${base} (${n++})${extension}`;
            usadas.add(resultado.toLowerCase()); return resultado;
        }
        const repos = new Map(tablas.repositorios.map(r => [String(r.id), unica(`repositorios/${segmento(r.nombre)}`)]));
        const carpetas = new Map(tablas.carpetas.map(c => [String(c.id), c]));
        const rutas = new Map();
        function carpeta(id, visitadas = new Set()) {
            id = String(id);
            if (rutas.has(id)) return rutas.get(id);
            const c = carpetas.get(id);
            if (!c || visitadas.has(id)) throw new Error('La jerarquía de carpetas es inválida.');
            visitadas.add(id);
            const padre = c.carpeta_padre_id ? carpeta(c.carpeta_padre_id, visitadas) : repos.get(String(c.repositorio_id));
            if (!padre) throw new Error('Falta el repositorio de una carpeta.');
            const ruta = unica(`${padre}/${segmento(c.nombre)}`);
            rutas.set(id, ruta); return ruta;
        }
        tablas.carpetas.forEach(c => carpeta(c.id));
        const archivos = new Map();
        for (const a of tablas.archivos_repositorio) {
            const padre = a.carpeta_id ? carpeta(a.carpeta_id) : repos.get(String(a.repositorio_id));
            if (!padre) throw new Error('Falta el repositorio de un archivo.');
            let nombre = segmento(a.nombre || a.nombre_original);
            const ext = segmento(a.extension || '').replace(/^\./, '');
            if (a.extension && !nombre.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) nombre += `.${ext}`;
            const key = `repositorios/${a.storage_path}`;
            if (!archivos.has(key)) archivos.set(key, unica(`${padre}/${nombre}`));
        }
        const categorias = new Map();
        for (const d of tablas.documentos) {
            const categoria = d.categoria || 'Sin categoría';
            if (!categorias.has(categoria)) categorias.set(categoria, unica(`documentos/${segmento(categoria)}`));
            if (!d.archivo_path) continue;
            const key = `documentos/${d.archivo_path}`;
            if (!archivos.has(key)) archivos.set(key, unica(`${categorias.get(categoria)}/${segmento(d.archivo_nombre || d.nombre)}`));
        }
        return { archivos, directorios: [...repos.values(), ...rutas.values(), ...categorias.values()] };
    }
    async function crear() {
        if (ocupado) return;
        let credenciales;
        let writer;
        try {
            if (!requisitos()) return;
            bloquear(true);
            if (!window.showSaveFilePicker) throw new Error('Para crear el ZIP directamente en disco sin saturar la memoria, abre esta página en Chrome o Edge desde una ventana normal.');
            const handle = await window.showSaveFilePicker({
                suggestedName: `respaldo_completo_SGDE_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
                types: [{ description: 'Copia de seguridad ZIP', accept: { 'application/zip': ['.zip'] } }],
            });
            const password = await pedirSecreto('Autorizar descarga del respaldo', 'Ingresa tu contraseña ACTUAL de administrador para autorizar la descarga. No se cambiará tu contraseña ni se creará una nueva. El ZIP se podrá abrir sin contraseña. Evita cambios de otros usuarios durante la copia.');
            if (password === null) return;
            credenciales = { password };
            progreso('Leyendo registros de todos los módulos…');
            const snapshot = await api('snapshot', credenciales);
            const organizacion = organizar(snapshot.tablas);
            writer = await handle.createWritable();
            const zip = new BackupZip(writer); const archivos = [];
            for (const directorio of organizacion.directorios) await zip.agregar(`${directorio}/`, new Uint8Array());
            for (let i = 0; i < snapshot.archivos.length; i++) {
                const f = snapshot.archivos[i];
                progreso(`Descargando archivo ${i+1} de ${snapshot.archivos.length}…`);
                const { data, error } = await supabaseClient.storage.from(f.bucket).download(f.path);
                if (error) throw new Error(`No se pudo respaldar ${f.bucket}/${f.path}. No se generó una copia incompleta.`);
                const bytes = await data.arrayBuffer();
                if (bytes.byteLength > 50000000) throw new Error('La copia contiene un archivo mayor que el límite de restauración de 50 MB.');
                const zip_path = organizacion.archivos.get(`${f.bucket}/${f.path}`);
                if (!zip_path) throw new Error(`No se encontró la carpeta de ${f.bucket}/${f.path}.`);
                await zip.agregar(zip_path, bytes);
                archivos.push({ bucket: f.bucket, path: f.path, zip_path, bytes: bytes.byteLength,
                    tipo_mime: f.metadata?.mimetype || data.type, sha256: await hash(bytes) });
            }
            progreso('Comprobando que la información no haya cambiado…');
            const final = await api('snapshot', credenciales);
            if (final.revision !== snapshot.revision) throw new Error('Hubo cambios durante la copia. Vuelve a intentarlo sin otros usuarios trabajando.');
            const manifiesto = { formato: 'SGDE_DUAFARMA_COMPLETO', version: 3, creado_en: new Date().toISOString(),
                tablas: snapshot.tablas, esquema: snapshot.esquema, archivos };
            await zip.agregar('sgde.json', JSON.stringify(manifiesto));
            for (const tabla of TABLAS) await zip.agregar(`datos/${tabla}.json`, JSON.stringify(snapshot.tablas[tabla], null, 2));
            await zip.agregar('LEEME.txt', 'COPIA DE SEGURIDAD SGDE\r\n\r\nrepositorios/: repositorios y sus carpetas originales.\r\ndocumentos/: documentos organizados por categoría.\r\ndatos/: registros de cada módulo en JSON.\r\nsgde.json: manifiesto requerido para restaurar desde el sistema.\r\n\r\nGuarda el ZIP en un lugar privado. Incluye datos y perfiles del SGDE. Las contraseñas se administran en Supabase Auth.\r\n');
            progreso('Finalizando el ZIP…');
            await zip.cerrar(); writer = null;
            progreso(`ZIP guardado: ${TABLAS.reduce((n,t) => n + snapshot.tablas[t].length,0)} registros y ${archivos.length} archivos organizados por carpetas.`);
            await registrarAuditoria('BACKUP','sistema',null,`Copia completa ZIP generada: ${archivos.length} archivos`);
        } catch (error) {
            if (error.name === 'AbortError') { progreso('Creación de copia cancelada.'); return; }
            progreso('No se completó la copia de seguridad.'); alert(error.message);
        } finally {
            if (writer) await writer.abort().catch(() => {});
            if (credenciales) credenciales.password = ''; bloquear(false);
        }
    }
    async function restaurar(file) {
        if (ocupado || !file) return;
        let credenciales;
        try {
            if (!requisitos()) return;
            bloquear(true);
            const cabecera = new Uint8Array(await file.slice(0, 8).arrayBuffer());
            let contenido;
            if (MAGIC.every((b, i) => cabecera[i] === b)) {
                const secreto = await pedirSecreto('Abrir copia antigua', 'Ingresa la contraseña de esta copia antigua .sgde. Los ZIP nuevos no necesitan esta contraseña.');
                if (secreto === null) return;
                contenido = await descifrar(file, secreto);
            } else contenido = await file.arrayBuffer();
            progreso('Revisando la copia…');
            const zip = await JSZip.loadAsync(contenido);
            const entrada = zip.file('sgde.json');
            if (!entrada) throw new Error('Falta el manifiesto sgde.json.');
            const m = JSON.parse(await entrada.async('string')); validar(m, zip);
            // Verificar TODOS los archivos antes de subir o reemplazar nada.
            for (let i=0; i<m.archivos.length; i++) {
                const f=m.archivos[i]; progreso(`Validando archivo ${i+1} de ${m.archivos.length}…`);
                const bytes=await zip.file(f.zip_path).async('uint8array');
                if (bytes.byteLength!==f.bytes || await hash(bytes)!==f.sha256) throw new Error(`Archivo dañado: ${f.path}. No se modificaron los registros.`);
            }
            const total=TABLAS.reduce((n,t)=>n+m.tablas[t].length,0);
            if (!confirm(`Se reemplazarán los registros de TODOS los módulos por ${total} registros y ${m.archivos.length} archivos de la copia del ${m.creado_en}.\n\nTambién se restaurarán los perfiles y roles. Después de restaurar, vuelve a entrar con tu correo y contraseña actuales. Crea primero una copia del estado actual y evita cambios de otros usuarios.\n\n¿Continuar con la restauración completa?`)) return;
            const password = await pedirSecreto('Autorizar restauración completa','Ingresa tu contraseña actual de administrador para continuar.');
            if (password === null) return;
            credenciales={password,esquema:m.esquema};
            const sesion=await api('start',credenciales);
            const rutas=new Map(); const archivos=[];
            for(let i=0;i<m.archivos.length;i++) {
                const f=m.archivos[i]; progreso(`Restaurando y verificando archivo ${i+1} de ${m.archivos.length}…`);
                const bytes=await zip.file(f.zip_path).async('uint8array');
                const nuevo=await api('upload',new Blob([bytes],{type:f.tipo_mime||'application/octet-stream'}),sesion,
                    {'x-file-bucket':f.bucket,'x-file-sha256':f.sha256});
                rutas.set(`${f.bucket}/${f.path}`,nuevo.path);
                archivos.push({bucket:nuevo.bucket,path:nuevo.path,sha256:nuevo.sha256,bytes:nuevo.bytes});
            }
            for(const [tabla,campo,bucket] of [['documentos','archivo_path','documentos'],['archivos_repositorio','storage_path','repositorios']]) {
                m.tablas[tabla].forEach(r=>{if(r[campo]!=null) r[campo]=rutas.get(`${bucket}/${r[campo]}`);});
            }
            progreso('Restaurando todos los registros en una sola transacción…');
            try {
                await api('commit',{tablas:m.tablas,esquema:m.esquema,archivos},sesion);
            } catch (error) {
                // Una respuesta perdida no significa que PostgreSQL no confirmó.
                throw new Error(`${error.message}\nSi se perdió la conexión durante la confirmación, verifica el resultado con un administrador antes de repetir la restauración. Los archivos previos se conservan.`);
            }
            await supabaseClient.auth.signOut({ scope: 'local' });
            localStorage.removeItem('sesion_usuario'); sessionStorage.clear();
            alert('Restauración completa finalizada. Ingresa con un usuario y contraseña contenidos en la copia restaurada.');
            window.location.replace('../index.html');
        } catch(error) {
            progreso('La restauración no pudo confirmarse. Los archivos anteriores se conservan.'); alert(error.message);
        } finally { if(credenciales) credenciales.password=''; bloquear(false); }
    }
    window.SGDEBackup = { crear, restaurar };
})();
