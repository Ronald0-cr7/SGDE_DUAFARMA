# Copia completa del SGDE

Los dos botones de Repositorios ahora utilizan un respaldo completo **de los datos de la aplicación**. Esta función requiere instalar el SQL y publicar la Edge Function; no tiene una alternativa insegura que escriba las diez tablas desde el navegador.

## Contenido

- Usuarios y roles, productos, cabeceras y detalles de recepción, movimientos de Kardex, documentos, auditoría, repositorios, carpetas y registros de archivos.
- Todos los archivos referenciados por `documentos.archivo_path` y `archivos_repositorio.storage_path`, incluidas versiones documentales anteriores que sigan registradas.
- Fechas, identificadores, estados y relaciones originales. Las vistas y actas/Excel generados se reconstruyen a partir de esos datos; no necesitan una copia adicional.
- Las columnas numéricas se transportan como texto dentro del manifiesto para conservar su precisión; PostgreSQL recupera los tipos numéricos al restaurar.
- Los enlaces externos se conservan como enlaces. El respaldo de perfiles incluye sus UUID de Auth. Los archivos huérfanos, el código, la configuración, los secretos y las cuentas de Supabase Auth quedan fuera de la copia.

La copia es un ZIP estándar sin contraseña. `repositorios/` conserva la jerarquía de repositorios y carpetas, `documentos/` agrupa por categoría, `datos/` contiene un JSON por tabla y `sgde.json` permite restaurar desde el sistema. Cada archivo tiene una huella SHA-256. Guarda el ZIP en un lugar privado. Los respaldos anteriores a Supabase Auth pueden contener contraseñas antiguas y requieren una migración separada.

## Instalación en Supabase

1. Ejecutar `sql/respaldo_completo.sql` en SQL Editor, después de las migraciones actuales del proyecto. No reemplaza ni elimina los datos existentes durante la instalación.
2. Vincular este directorio al proyecto correcto de Supabase y configurar el origen exacto del sitio (sin barra final). Ejemplo, sustituyendo dominio y referencia:

   ```powershell
   supabase link --project-ref TU_REFERENCIA
   supabase secrets set SGDE_BACKUP_ORIGINS="https://tu-dominio.example,http://localhost:5500"
   supabase functions deploy sgde-backup
   ```

3. La Edge Function utiliza `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY` de su entorno. Valida el token de Supabase Auth y el rol de administrador activo en cada solicitud. Verifica la contraseña actual al iniciar un respaldo o restauración y exige un token temporal adicional para las etapas de restauración.
4. Publicar también `html/repositorios.html`, `js/repositorios.js`, `js/backupZip.js` y `js/respaldoCompleto.js` en el alojamiento habitual. Usar HTTPS o localhost para Web Crypto. Los navegadores actuales deben soportar `<dialog>`.
5. Ensayar primero con un proyecto de pruebas y datos ficticios. La autorización para editar los archivos locales no equivale a haber instalado la función en el proyecto remoto.

## Crear una copia

1. Coordinar una ventana sin operaciones de otros usuarios.
2. Ingresar como administrador y pulsar **Crear copia de seguridad**.
3. Elegir dónde guardar el ZIP e ingresar únicamente la contraseña actual de administrador para autorizar la descarga. No se crea ni cambia una contraseña.
4. Mantener la pestaña abierta. El estado muestra la cantidad de archivos descargados. La función obtiene una instantánea consistente de las diez tablas y comprueba nuevamente su revisión al terminar las descargas. Si hay cambios, no genera la copia y solicita reintentar.
5. Comprobar que se guardó el `.zip` y que se pueden abrir sus archivos y carpetas.

## Restaurar una copia

1. Generar primero una copia del estado actual y cerrar las sesiones de los demás trabajadores.
2. Seleccionar el `.zip` completo, generado con el esquema actual. Antes de subir los archivos se comprueban el manifiesto, las referencias y todos los SHA-256.
3. Revisar el aviso e ingresar la contraseña del administrador actual.
4. Los archivos se cargan a rutas nuevas y se vuelven a descargar para verificar sus huellas en el servidor. Los anteriores no se sobrescriben ni eliminan. Se necesita espacio libre adicional equivalente al tamaño de los archivos recuperados.
5. El servidor comprueba las revisiones de los objetos verificados y reemplaza las diez tablas en una transacción. Conserva las claves foráneas activas; suspende temporalmente los triggers de negocio para no alterar saldos ni versiones al importar. Si falla una relación, un saldo, la auditoría u otra inserción, PostgreSQL revierte los registros y el estado de los triggers.
6. Se añade un evento RESTORE a la bitácora recuperada. Al finalizar, se cierra la sesión. Vuelve a ingresar con tu correo y contraseña actuales de Supabase Auth.

Si cambió la base durante la preparación, el servidor rechaza la restauración. Si se pierde la respuesta de confirmación, **no asumir que hubo reversión**: revisar los datos y la bitácora antes de repetir. Un token de una restauración completada no puede volver a ejecutar la operación.

## Alcance y precauciones

- Los antiguos ZIP `backup_biblioteca_*.zip` son parciales y el nuevo flujo los rechaza para evitar interpretarlos como copias completas. Conservarlos; para migrarlos se necesita un procedimiento separado.
- Se requiere la misma estructura de columnas y las migraciones de Kardex por acta. La función rechaza un esquema diferente o saldos inconsistentes; no repara automáticamente diferencias del respaldo.
- Límite de 50 MB por archivo y ZIP estándar menor que 4 GB, con un máximo de 65534 entradas. La creación escribe un archivo a la vez directamente en disco mediante Chrome o Edge y requiere HTTPS o localhost. Si falla, se aborta la escritura. La restauración todavía lee el ZIP completo en memoria; necesita memoria suficiente para el tamaño de la copia.
- Las sesiones de restauración vencen a las cuatro horas. Si una operación falla, pueden quedar archivos nuevos sin referencia en `sgde-restauraciones/<job-id>/`. No afectan los registros previos, pero ocupan espacio. Revisar y retirar solo objetos que no estén referenciados y pertenezcan a trabajos vencidos; nunca borrar una carpeta completa de restauración sin comprobar referencias.
- Se conservan también los archivos físicos anteriores a una restauración exitosa para evitar pérdidas. No se eliminan automáticamente. Su retención y eventual limpieza deben administrarse de forma explícita.
- Las tablas técnicas `sgde_backup_jobs` y `sgde_backup_files` son privadas para el rol de servicio y no forman parte de la copia de datos operativos.
- La restauración requiere que los UUID de Auth del respaldo existan en el proyecto y que la copia conserve como administrador activo a quien la restaura. Consulta [la guía de seguridad](SEGURIDAD_SUPABASE.md).
- Para un respaldo de infraestructura completo, mantener también exportaciones de PostgreSQL, código y configuración de despliegue mediante herramientas administrativas. Esta función respalda los datos de los módulos existentes, no sustituye un plan de recuperación del proyecto Supabase.

## Comprobación

`pruebas/validar-respaldo-completo.cjs` prueba la transacción SQL, permisos, referencias, revisiones y reversión ante errores en PGlite. `pruebas/validar-respaldo-frontend.cjs` prueba ZIP organizado, escritura incremental, hashes, restauración y descarte de copias incompletas con Node.js, jsdom y JSZip. `pruebas/validar-respaldo-servidor.cjs` comprueba las rutas de la Edge Function con un cliente Supabase simulado (Node.js 22.16 o superior). Las pruebas locales no sustituyen el ensayo de la Edge Function y la recuperación en un proyecto Supabase separado.

Comandos desde la raíz, con Node.js instalado:

```powershell
npm install --prefix .test-tools --ignore-scripts --no-audit --no-fund
node pruebas/validar-respaldo-completo.cjs
node pruebas/validar-respaldo-frontend.cjs
node --disable-warning=ExperimentalWarning pruebas/validar-respaldo-servidor.cjs
node pruebas/validar-kardex-actas.cjs
```

Validación local realizada: las cuatro suites anteriores pasaron, incluidas más de 1000 filas y cantidades decimales de alta precisión. No se desplegó la función ni se ejecutó una restauración sobre Supabase remoto.
