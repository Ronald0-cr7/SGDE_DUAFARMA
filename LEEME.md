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
del producto seleccionado, usando la librería SheetJS (sin backend extra).

## Módulo nuevo: Repositorios Digitales (estilo Google Drive)

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
| **6.2.5.17** — Backup y procedimiento ante pérdida | Supabase realiza backups automáticos de la base de datos (diarios en el plan gratuito, configurable point-in-time en planes pagos). Se recomienda documentar un POE de contingencia (ya incluido como documento de ejemplo en `schema.sql`). |
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
