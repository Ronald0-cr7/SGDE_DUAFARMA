# Kardex independiente por acta y producto

## Corrección del requisito

Cada combinación acta/producto tiene su propio Kardex. Dos actas que reciben
el mismo producto y el mismo lote conservan saldos y salidas independientes.
La implementación anterior agrupaba por producto; queda sustituida por esta
corrección. El catálogo conserva el stock total del producto.

## Cambios

- `sql/migracion_kardex_por_acta.sql`: usa `recepcion_id` también para las
  salidas, exige que el producto pertenezca al acta y calcula disponibilidad
  por acta/producto/lote/vencimiento. Recalcula saldos históricos por acta,
  conservando cantidades e identificadores. La vista `kardex_por_acta` devuelve
  un saldo por acta/producto. Debe ejecutarse después de las migraciones previas.
- `js/kardex.js` y `html/kardex.html`: selector y lista por acta/producto;
  formulario de salida fijado al Kardex abierto; consultas con ambos filtros;
  cabecera con saldo propio. El aviso de una salida se limpia al cambiar de acta.
- `js/exportacionExcel.js`: exportación por acta, identificación en cabecera y
  nombre de archivo, rechazo de movimientos ajenos al Kardex seleccionado.
- Salidas antiguas sin acta: se conservan y aparecen como pendientes. Un operador
  elige el acta real y la función `asignar_salida_acta` valida disponibilidad,
  conserva el stock total y registra auditoría. No se infiere origen por lote.
  Mientras existan pendientes, se bloquean nuevas salidas y exportaciones del
  producto. Si una salida antigua consumió varias actas, requiere conciliación;
  la herramienta no la divide automáticamente.
- La edición y eliminación de salidas recalculan el saldo del Kardex y stock
  total. La reconstrucción/eliminación de actas con salidas se rechaza para que
  no desaparezcan despachos al borrar sus ingresos.

## Evidencia local

`node pruebas/validar-kardex-actas.cjs` ejecuta esquema y migraciones en PGlite,
el HTML/JS con jsdom y genera/reabre un XLSX real con ExcelJS. Comprueba:

1. Actas A/B, mismo producto, lote y vencimiento: 200 y 300 independientes.
2. Migración y asignación explícita de una salida antigua de 50 al acta A:
   A queda en 150, B en 300; stock total 450 sin duplicar la salida.
3. Salidas y agotamiento de A no alteran los movimientos ni saldo de B.
4. Rechazo por exceso, cantidad cero/negativa, auxiliar y reintento en otra acta.
5. Edición/eliminación de una salida actualizan solo su Kardex y stock total.
6. Acta con salidas no se elimina ni reconstruye; acta sin salidas puede editarse.
7. Fallo de auditoría revierte la salida y su actualización de stock.
8. Formulario fijado al acta; consulta y cabecera sin movimientos de otras actas.
9. XLSX con identificación del acta y saldo propio; rechaza datos de otra acta.
10. Acta multiproducto: una salida de un producto no altera el otro Kardex.

Ejemplo generado: `pruebas/Kardex_ACTA_A_ejemplo.xlsx`. El comando antiguo
`node pruebas/validar-kardex.cjs` redirige a las pruebas actuales.

## Pendiente fuera del proyecto

Actualización: filtro inclusivo por fecha del acta en selector y listado; botón
Eliminar Kardex con confirmación. `sql/migracion_eliminar_kardex.sql` añade la
eliminación de un acta/producto sin salidas, conservando otros productos del acta
y recalculando stock. Las pruebas cubren filtro vacío, límites, rango inválido,
cancelación, auxiliar, protección de salidas, eliminación en acta multiproducto,
acta vacía, auditoría y reversión completa cuando falla la auditoría.

No se aplicó la migración a Supabase ni se inspeccionaron sus registros reales.
Hay que ejecutar la nueva migración y asignar las salidas antiguas según su
origen real. Las pruebas locales no comprueban dos conexiones concurrentes ni
la impresión física. Se mantienen las limitaciones de autenticación propia del
prototipo; el usuario proviene de la sesión del navegador.
