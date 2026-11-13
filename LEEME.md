# SGDE DUA FARMA — Sistema de Gestión Documental Electrónica (prototipo de tesis)

Prototipo funcional construido siguiendo el mismo esquema de arquitectura
del proyecto de referencia "Hospedaje Ruby": frontend estático (HTML/CSS/JS)
+ Supabase como backend (base de datos Postgres con autenticación y API
lista para usar, sin necesidad de programar un servidor propio).

## Estructura de carpetas

```
SGDE_DUAFARMA/
├── index.html          -> Pantalla de login
├── html/                -> Todas las páginas internas del sistema
│   ├── dashboard.html
│   ├── recepcion.html   -> Registrar Acta de recepción (genera Kardex automático)
│   ├── kardex.html      -> Consultar Kardex por producto
│   ├── documentos.html  -> Repositorio de MOF / POEs (control de versión)
│   ├── auditoria.html   -> Bitácora de auditoría (solo Director Técnico)
│   └── usuarios.html    -> Gestión de usuarios y roles (solo Director Técnico)
├── css/
│   ├── sb-admin-2.min.css   -> plantilla visual (SB Admin 2)
│   └── estilos.css          -> ajustes propios
├── js/
│   ├── supabaseClient.js -> conexión única a Supabase
│   ├── login.js          -> autenticación
│   ├── rol_guard.js      -> control de accesos por rol (protege cada página)
│   ├── dashboard.js / recepcion.js / kardex.js / documentos.js / auditoria.js / usuarios.js
│   └── sb-admin-2.min.js
└── sql/
    └── schema.sql   -> tablas, triggers de auditoría/saldo y datos de prueba
```

## Instalación (10 minutos)

1. Crea una cuenta gratuita en https://supabase.com y un nuevo proyecto.
2. En tu proyecto: **SQL Editor** → pega todo el contenido de `sql/schema.sql` → Ejecutar.
   Esto crea las tablas (`usuarios`, `productos`, `recepciones`, `recepcion_detalle`,
   `kardex_movimientos`, `documentos`, `log_auditoria`), los triggers automáticos
   y usuarios/productos de prueba.
3. Ve a **Project Settings → API** y copia la `Project URL` y la `anon public key`.
4. Abre `js/supabaseClient.js` y reemplaza:
   ```js
   const SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
   const SUPABASE_ANON_KEY = "TU-ANON-KEY-PUBLICA";
   ```
5. Abre `index.html` directamente en el navegador (o súbelo a cualquier hosting
   estático) e inicia sesión con `admin / admin123`.

## Subir y descargar archivos (PDF, Word, Excel) — Supabase Storage

Ya se conectó el módulo **Documentos** a Supabase Storage, para que puedas
subir tus archivos reales desde tu PC y descargarlos de nuevo. Falta un
paso único de configuración en tu proyecto Supabase:

1. Ve a tu proyecto en supabase.com → menú lateral **Storage**.
2. Clic en **New bucket** → nombre exacto: `documentos` → marca
   **Public bucket** (para esta demo académica; en producción real se
   usarían URLs firmadas en vez de bucket público) → **Create bucket**.
3. Si ya habías ejecutado `sql/schema.sql` antes de esta actualización,
   corre además `sql/migracion_archivos.sql` en el SQL Editor (agrega las
   columnas necesarias para guardar la ruta del archivo).
4. Listo. En **Documentos**, el formulario ahora tiene un campo "Archivo"
   (en vez de un link) — selecciona un PDF, Word o Excel de tu PC y súbelo.
   En la tabla de abajo, cada documento tiene un enlace de descarga que
   trae el archivo tal cual lo subiste.

**Bonus — exportar reportes:** en el módulo **Kardex**, el botón
"Exportar a Excel" genera y descarga un archivo `.xlsx` real del kardex
del producto seleccionado, usando la librería ExcelJS (sin backend extra).

## Actas multiproducto y formatos Excel

Si la base de datos ya estaba creada antes de esta actualización, ejecuta una vez
`sql/migracion_actas_kardex_excel.sql` en el **SQL Editor** de Supabase. La
migración conserva los datos actuales y agrega los campos del formato físico,
la relación Acta–Kardex y una función transaccional para guardar todos los
productos del acta sin dejar registros incompletos.

En **Recepción** se pueden agregar varias filas de productos a una misma acta.
Al guardarla se crea el ingreso correspondiente en el Kardex de cada producto.
La tabla de actas ofrece los botones **Ver** y **Excel**. En **Kardex**, el botón
de exportación genera el formato `FOR-ALM-011 / VERSIÓN 001`. Ambos archivos
se generan como `.xlsx` sin macros mediante ExcelJS.

## Registro de salidas del Kardex

Para separar los Kardex por **acta y producto**, ejecuta en el SQL Editor de
Supabase `sql/migracion_kardex_por_acta.sql`, después de las migraciones de la
lista siguiente. Conserva los movimientos y recalcula los saldos por acta.
No vuelvas a ejecutar `schema.sql` sobre una base de datos que ya existe.

Requisitos previos, en este orden (solo si aún no están instalados):

1. `sql/migracion_actas_kardex_excel.sql`
2. `sql/migracion_edicion_kardex.sql`
3. `sql/migracion_edicion_actas.sql`
4. `sql/migracion_salidas_kardex.sql`
5. `sql/migracion_kardex_por_acta.sql` (**nueva corrección; ejecutar al final**)
6. `sql/migracion_eliminar_kardex.sql` (botón Eliminar Kardex; ejecutar después del paso 5)

**Fechas:** indica Desde/Hasta y pulsa **Mostrar por fechas**. Se filtran los
Kardex por la fecha del acta, incluyendo ambos extremos, en el selector y la
lista. **Mostrar todos** limpia el filtro. Cada Kardex conserva todo su historial.

**Eliminar Kardex:** selecciona el Kardex y pulsa el botón. Admin y asistente
pueden eliminarlo previa confirmación si no tiene salidas y el producto no tiene
salidas antiguas pendientes de asignar. Se eliminan sus ingresos y únicamente
ese producto del acta; si el acta queda vacía, se elimina su cabecera. Se conserva
el resto de productos y Kardex, se recalcula el stock y se guarda en auditoría
una copia de los movimientos y detalles eliminados. La operación es transaccional.

En Kardex, selecciona el **acta y producto** y pulsa **Registrar Salida**.
La salida queda fijada a ese Kardex. Completa fecha, cliente, documento, lote y
cantidad. El vencimiento se toma del lote seleccionado. Cada acta mantiene su
propio saldo incluso si otra tiene el mismo producto, lote y vencimiento.
El stock del catálogo es la suma total, mientras que la cabecera y el Excel del
Kardex muestran únicamente el saldo del acta elegida.
Si el documento es una guía, su número también llena
la columna Guía R. del Excel. Para una factura puedes indicar la guía aparte.

Las salidas de la versión anterior sin acta aparecen en **Salidas anteriores
pendientes de asignar**. Elige su acta real y pulsa **Asignar acta**. No se
asignan automáticamente por lote. Hasta resolverlas se bloquean nuevas salidas
y exportaciones del producto afectado. La asignación conserva la cantidad,
el movimiento y el stock total; descuenta del Kardex seleccionado y deja auditoría.
Una salida antigua que consumió varias actas necesita conciliación antes de
asignarla: no se divide ni se inventa su origen automáticamente.

Las salidas pueden editarse o eliminarse en su Kardex y recalculan su saldo.
Un acta con salidas vinculadas no se puede reconstruir ni eliminar, para evitar
borrar el historial de despachos. Las actas sin salidas conservan su edición.

El servidor valida el stock disponible y guarda movimiento, nuevo stock y
auditoría en una transacción. Se conserva el historial y se actualiza la pantalla
sin recargar. Un reintento desde el formulario conserva el identificador para
evitar duplicados si se perdió la respuesta del servidor. Admin y asistente
pueden registrar; auxiliar conserva la consulta y exportación.

La nueva función sigue la autenticación propia existente del prototipo. El
nombre de usuario lo proporciona el navegador; esto no sustituye Supabase Auth
ni políticas RLS para un despliegue productivo.

**Excel:** usa **Exportar a Excel** o **Descargar Kardex**. Abre el `.xlsx` en
Excel y selecciona **Archivo → Imprimir**; el archivo incluye área de impresión
y orientación horizontal. `pruebas/Kardex_ACTA_A_ejemplo.xlsx` contiene un ejemplo
ficticio con la identificación del acta y exclusivamente sus movimientos.
Los historiales de más de 16 movimientos permiten varias páginas y repiten
la cabecera; la numeración de páginas aparece en el pie de impresión.

**Verificación local:** `npm.cmd ci --prefix .test-tools` y después
`node pruebas/validar-kardex-actas.cjs`. Las pruebas usan PostgreSQL local en memoria
(PGlite), el formulario HTML con jsdom y un XLSX real con ExcelJS. No escriben
en Supabase. La migración debe instalarse y verificarse también en el proyecto
remoto; las pruebas locales no demuestran su estado desplegado.

## Repositorios Digitales (estilo Google Drive)

Permite crear repositorios, carpetas y subcarpetas, subir cualquier tipo de
archivo (PDF, Word, Excel, imágenes, etc.), verlos, descargarlos, renombrarlos,
eliminarlos y buscarlos por nombre.

**Instalación (una sola vez):**
1. En el SQL Editor de Supabase, ejecuta todo el contenido de `sql/repositorios.sql`.
   Esto crea las tablas `repositorios`, `carpetas`, `archivos_repositorio`, el
   bucket de Storage `repositorios` (separado del bucket `documentos`) y sus
   políticas de acceso, además de 2 repositorios de ejemplo.
2. Si tenías una sesión iniciada antes de esta actualización, **cierra sesión
   y vuelve a entrar** — el nuevo módulo se agregó a los permisos por rol y
   la sesión guardada en el navegador necesita refrescarse.
3. Entra al menú lateral → **Repositorios**.

**Cómo se usa:**
- Selecciona o crea un repositorio arriba.
- Dentro, usa "Nueva carpeta" y "Subir archivo" para organizar tu documentación,
  igual que en Google Drive (puedes entrar en una carpeta y crear subcarpetas
  dentro de ella).
- Cada tarjeta (carpeta o archivo) tiene un menú de tres puntos con
  Renombrar / Eliminar. Al hacer clic en un archivo se abre su información
  (nombre, tipo, tamaño, fecha de carga) con botón de descarga.
- La barra de búsqueda filtra archivos por nombre dentro del repositorio activo,
  y cada resultado tiene un botón "Ir a la carpeta" para ubicarlo.
- El rol **Auxiliar** solo puede ver y descargar (no crear/subir/eliminar);
  solo el **Director Técnico (admin)** puede eliminar repositorios completos.

## Cómo cumple cada numeral de BPA

| Numeral | Cómo lo resuelve el sistema |
|---|---|
| **6.2.5.16** — Solo personal autorizado, con registro de cambios | Login con roles (`rol_guard.js`), y cada INSERT/UPDATE relevante escribe automáticamente en `log_auditoria` (usuario, acción, tabla, fecha) — visible en el módulo **Auditoría**. |
| **6.2.5.17** — Backup y procedimiento ante pérdida | El respaldo completo en ZIP de los datos de los módulos requiere instalar la migración y la Edge Function descritas en [RESPALDO_COMPLETO.md](RESPALDO_COMPLETO.md). Incluye las diez tablas operativas y los archivos referenciados de Documentos y Repositorios. Debe comprobarse mediante un simulacro; no se presupone la disponibilidad de copias recuperables del proveedor en el plan gratuito. |
| **6.2.5.18** — Acceso del personal al MOF/POEs vigentes | Módulo **Documentos**: cada usuario ve la versión vigente; al subir una nueva versión, la anterior se marca "obsoleta" automáticamente (trigger `fn_obsoletar_version_anterior`). |

## Flujo de demostración sugerido para la sustentación

1. Inicia sesión como `admin`.
2. Ve a **Recepción** → registra la recepción de un producto (ej. D00031) → esto
   crea el Acta y automáticamente genera el movimiento en el **Kardex** con el
   saldo ya calculado (equivalente digital de tu Excel automatizado con macros).
3. Ve a **Kardex** → selecciona el producto → verifica el movimiento y el saldo.
4. Ve a **Documentos** → sube una nueva versión del POE de recepción → verifica
   que la anterior pasó a "obsoleta".
5. Ve a **Auditoría** → muestra que cada acción anterior quedó registrada con
   usuario y hora exacta.
6. Cierra sesión, entra como `auxiliar` → muestra que no puede ver Auditoría
   ni Usuarios, y que los formularios de creación están ocultos (solo lectura).

## Nota de seguridad (para la sección de limitaciones de tu tesis)

- Las contraseñas se guardan en texto plano en la tabla `usuarios`, igual que en
  el proyecto de referencia. Para un entorno de producción real, lo correcto
  sería usar **Supabase Auth** (con hash bcrypt) en vez de una tabla propia.
- La bitácora de auditoría se registra desde el frontend (JavaScript) después
  de cada operación. Es válido para este prototipo académico, pero un sistema
  productivo debería moverla a triggers de base de datos o a una Edge Function,
  para que no pueda omitirse aunque el usuario manipule el navegador.
- Actualmente las tablas no tienen Row Level Security (RLS) activado, para
  simplificar las pruebas con la `anon key`. En producción se deben crear
  policies que exijan autenticación real (Supabase Auth) antes de leer/escribir.
