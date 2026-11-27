const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('../.test-tools/node_modules/@electric-sql/pglite');

(async () => {
    const db = new PGlite();
    const sql = file => fs.readFileSync(`sql/${file}`, 'utf8');
    const admin = '00000000-0000-0000-0000-000000000001';
    const asistente = '00000000-0000-0000-0000-000000000002';
    const auxiliar = '00000000-0000-0000-0000-000000000003';
    const sinPerfil = '00000000-0000-0000-0000-000000000004';
    const rol = async (id, nombre = 'authenticated') => {
        await db.exec(`reset role; set request.jwt.claim.sub = '${id}'; set role ${nombre}`);
    };
    const count = async table => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create schema auth;
        create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable
            as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
        grant usage on schema auth to authenticated;
        create schema storage;
        create table storage.buckets(id text primary key, name text, public boolean);
        create table storage.objects(bucket_id text, name text, updated_at timestamptz, metadata jsonb);
        alter table storage.objects enable row level security;
        grant usage on schema storage to anon, authenticated;
        grant select, insert, update, delete on storage.objects to anon, authenticated;
        create policy antigua on storage.objects for all using (true) with check (true);
    `);
    await db.exec(sql('schema.sql').replace('create extension if not exists "pgcrypto";', ''));
    for (const file of [
        'migracion_actas_kardex_excel.sql', 'migracion_edicion_kardex.sql', 'migracion_edicion_actas.sql',
        'migracion_salidas_kardex.sql', 'migracion_kardex_por_acta.sql', 'migracion_eliminar_kardex.sql',
        'migracion_documentos_salidas_kardex.sql', 'repositorios.sql', 'storage_documentos.sql', 'respaldo_completo.sql'
    ]) await db.exec(sql(file));

    await db.exec(`
        alter table public.usuarios add column password text;
        alter table public.productos disable row level security;
        grant select, insert, update, delete on productos, usuarios to anon;
        update storage.buckets set public = true;
        insert into auth.users values ('${admin}'), ('${asistente}'), ('${auxiliar}');
        insert into usuarios(username,nombre,rol,auth_user_id,password) values
            ('admin','Administrador','admin','${admin}','anterior'),
            ('asistente','Asistente','asistente','${asistente}','anterior'),
            ('auxiliar','Auxiliar','auxiliar','${auxiliar}','anterior');
        insert into storage.objects values ('documentos','manual.pdf'), ('repositorios','formato.pdf');
    `);
    await db.exec(sql('migracion_seguridad_auth.sql'));
    await db.exec(sql('migracion_seguridad_auth.sql'));
    await assert.rejects(db.query('select password from usuarios'), /does not exist/);
    assert.equal((await db.query('select count(*)::int n from storage.buckets where public')).rows[0].n, 0);

    await rol('', 'anon');
    await assert.rejects(count('usuarios'), /permission denied/);
    await assert.rejects(count('productos'), /permission denied/);
    await assert.rejects(count('kardex_por_acta'), /permission denied/);
    assert.equal(await count('storage.objects'), 0);
    await assert.rejects(db.exec("insert into storage.objects values ('documentos','no.pdf')"), /policy/);

    await rol(sinPerfil);
    assert.equal(await count('productos'), 0);
    assert.equal(await count('storage.objects'), 0);
    await rol(auxiliar);
    assert.equal(await count('usuarios'), 1);
    assert.equal(await count('productos'), 2);
    assert.equal(await count('storage.objects'), 2);
    await assert.rejects(db.exec("insert into productos(codigo,nombre) values ('P','no')"), /policy/);

    await rol(asistente);
    const producto = (await db.query("select id from productos where codigo = 'D00031'")).rows[0].id;
    const recepcion = (await db.query('select registrar_recepcion_completa($1,$2) as id', [
        JSON.stringify({ fecha: '2026-11-17', guia_numero: 'PRUEBA-RLS', proveedor: 'Prueba', usuario_registro: 'asistente' }),
        JSON.stringify([{ producto_id: producto, lote: 'P1', cant_solicitada: 10, cant_recibida: 10 }])
    ])).rows[0].id;
    const salida = {
        recepcion_id: recepcion, producto_id: producto, fecha: '2026-11-17', salida: 2,
        lote: 'P1', tipo_doc: 'Factura', num_doc: 'P1', guia_numero: 'P1', proveedor_cliente: 'Prueba'
    };
    const args = ['00000000-0000-0000-0000-000000000005', 'asistente', JSON.stringify(salida)];
    await db.query('select registrar_salida_kardex($1,$2,$3)', args);
    await db.query('select registrar_salida_kardex($1,$2,$3)', args);
    await assert.rejects(db.exec("insert into log_auditoria(usuario,accion,tabla) values ('admin','LOGIN','usuarios')"), /policy/);
    await assert.rejects(db.exec("insert into storage.objects values ('repositorios','no.pdf')"), /policy/);
    await db.exec("insert into storage.objects values ('documentos','version.pdf')");

    await rol(auxiliar);
    assert.equal(await count('kardex_por_acta'), 1);
    await rol(admin);
    assert.equal(await count('usuarios'), 3);
    await db.exec("update usuarios set activo = false where username = 'asistente'");
    await assert.rejects(db.exec("update usuarios set activo = false where username = 'admin'"), /policy/);
    await rol(asistente);
    assert.equal(await count('productos'), 0);
    assert.equal(await count('storage.objects'), 0);
    await db.close();
    console.log('OK seguridad: migración repetible, contraseña retirada, permisos por rol, Kardex y Storage privado.');
})().catch(error => {
    console.error(error.message, error.where || '');
    process.exitCode = 1;
});
