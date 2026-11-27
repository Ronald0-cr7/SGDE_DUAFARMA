# Activar Supabase Auth y RLS en SGDE

Haz el cambio en una ventana de mantenimiento. El sitio actualizado inicia sesión con el **correo** de Supabase Auth. El nombre de usuario del SGDE se conserva para perfiles y auditoría. Mantén un respaldo privado de los datos y archivos antes de la migración. Los respaldos viejos pueden contener contraseñas en texto plano.

## 1. Vincular las cuentas

En **Authentication → Users** crea una cuenta confirmada por cada usuario activo, con su correo verificado y una **contraseña nueva**. Si ya existe una cuenta legítima, confirma que pertenece a esa persona. Deshabilita el registro público para este sistema interno.

En **SQL Editor**, ejecuta este bloque por cada perfil que vayas a vincular. Cambia el usuario y el UUID del ejemplo por los valores reales. El UUID se copia de **Authentication → Users**. La consulta devuelve el perfil vinculado.

```sql
alter table public.usuarios add column if not exists auth_user_id uuid unique
    references auth.users(id) on delete set null;

update public.usuarios
set auth_user_id = '00000000-0000-0000-0000-000000000000'
where username = 'USUARIO_SGDE'
returning username, rol, activo, auth_user_id;
```

En una instalación nueva, crea primero la cuenta en Auth y su perfil administrador mediante SQL.

```sql
insert into public.usuarios (username, nombre, rol, auth_user_id)
values ('admin', 'Director Técnico', 'admin', '00000000-0000-0000-0000-000000000000');
```

Los perfiles inactivos pueden quedarse sin cuenta. Para volver a activarlos, vincúlalos primero. Si algún perfil activo pertenece a alguien que ya no debe ingresar, desactívalo antes de la migración.

## 2. Aplicar SQL y publicar

1. En Supabase, ejecuta [la migración de seguridad](sql/migracion_seguridad_auth.sql). El script se detiene si queda un perfil activo sin vincular o falta un administrador activo. Retira la columna de contraseñas, activa las políticas en la base de datos y hace privados los buckets `documentos` y `repositorios`.
2. Ejecuta la versión actual de [respaldo completo](sql/respaldo_completo.sql).
3. Publica las dos Edge Functions. Sustituye `TU_REFERENCIA` y el dominio por los valores del proyecto. Si necesitas varios orígenes, sepáralos con comas. Usa solo el origen, sin ruta ni barra final.

   ```powershell
   supabase link --project-ref TU_REFERENCIA
   supabase secrets set SGDE_ALLOWED_ORIGINS="https://tu-sitio.example" SGDE_BACKUP_ORIGINS="https://tu-sitio.example"
   supabase functions deploy sgde-usuarios
   supabase functions deploy sgde-backup
   ```

4. Publica el sitio actualizado. Los archivos de los buckets privados se descargan desde la sesión del SGDE. Si guardaste enlaces públicos antiguos como enlaces externos, sustitúyelos por archivos gestionados en Documentos.
5. Aplica [la migración de administración de cuentas](sql/migracion_crud_auth.sql) para restringir la edición de perfiles a la Edge Function y proteger al último administrador vinculado. En una actualización, despliega primero la nueva versión de `sgde-usuarios`, publica el formulario actualizado y aplica esta migración.

## 3. Comprobar

- Comprueba que el administrador entra con su correo y que puede gestionar usuarios y descargar un respaldo nuevo.
- Con una cuenta de prueba, crea el usuario desde el formulario, comprueba el correo en Authentication, edítalo, desactívalo, actívalo y elimínalo. El perfil eliminado queda inactivo y desvinculado en el SGDE. Los respaldos anteriores que referencien el UUID eliminado requieren resolver ese vínculo antes de restaurarlos.
- Usuarios y Roles lista las cuentas de Authentication, incluidas las que todavía no tienen perfil. Para habilitar el ingreso al SGDE de una cuenta existente, ábrela con Actualizar y marca **Dar acceso al SGDE y asignar un rol**. Luego prueba el inicio de sesión con el correo y la contraseña de esa cuenta.
- Con un asistente, prueba recepción, Kardex y edición de documentos. Con un auxiliar, comprueba que la consulta funciona y que los cambios se rechazan.
- Confirma que una sesión sin perfil o con un perfil inactivo no ve los datos y que los archivos privados requieren una sesión autorizada.
- Ejecuta **Security Advisor** de Supabase otra vez y revisa las tablas que figuran en cada alerta. Revisa los registros disponibles para evaluar accesos anteriores.

Genera un respaldo nuevo después de la migración. La restauración desde la aplicación requiere el nuevo esquema y las cuentas de Auth correspondientes.
