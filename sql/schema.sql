-- ============================================================
-- SGDE DUA FARMA S.A.C. - Esquema de base de datos (Supabase/Postgres)
-- Cumple numerales BPA 6.2.5.16 (control de accesos + auditoría),
-- 6.2.5.17 (backup / contingencia -> se gestiona desde el panel
-- de Supabase, ver LEEME_SUPABASE.md) y 6.2.5.18 (accesibilidad
-- documental: MOF y POEs vigentes).
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- USUARIOS Y ROLES (6.2.5.16) ----------
create table usuarios (
    id uuid primary key default gen_random_uuid(),
    username text unique not null,
    password text not null,          -- demo: texto plano (ver nota de seguridad en README)
    nombre text not null,
    rol text not null check (rol in ('admin','asistente','auxiliar')),
    activo boolean default true,
    created_at timestamptz default now()
);

-- ---------- PRODUCTOS (equivalente a BASE_DATOS del Excel) ----------
create table productos (
    id uuid primary key default gen_random_uuid(),
    codigo text unique not null,
    nombre text not null,
    presentacion text,
    reg_sanitario text,
    fabricante text,
    procedencia text,
    dam text default 'N.A',
    concentracion_forma text,
    condicion_almacen text default 'T° Ambiente Controlada',
    lote text,
    fecha_venc date,
    estado_embalaje text default 'CONFORME',
    stock numeric default 0,
    created_at timestamptz default now()
);

-- ---------- ACTA DE RECEPCIÓN (cabecera) ----------
create table recepciones (
    id uuid primary key default gen_random_uuid(),
    fecha date not null default current_date,
    guia_numero text,
    proveedor text,
    tipo_ingreso text,               -- Compra local / Importación / Otros
    usuario_registro text not null,
    created_at timestamptz default now()
);

-- ---------- ACTA DE RECEPCIÓN (detalle por producto) ----------
create table recepcion_detalle (
    id uuid primary key default gen_random_uuid(),
    recepcion_id uuid references recepciones(id) on delete cascade,
    producto_id uuid references productos(id),
    lote text,
    fecha_venc date,
    cant_solicitada numeric,
    cant_recibida numeric,
    estado_embalaje text default 'CONFORME'
);

-- ---------- KARDEX (un registro por movimiento, igual que el Excel) ----------
create table kardex_movimientos (
    id uuid primary key default gen_random_uuid(),
    producto_id uuid references productos(id),
    fecha date not null default current_date,
    guia_numero text,
    tipo_doc text,
    num_doc text,
    fecha_doc date,
    proveedor_cliente text,
    lote text,
    fecha_venc date,
    ingreso numeric default 0,
    salida numeric default 0,
    saldo numeric default 0,
    realizado_por text,
    verificado_por text,
    observaciones text,
    created_at timestamptz default now()
);

-- ---------- REPOSITORIO DOCUMENTAL: MOF / POEs (6.2.5.18) ----------
create table documentos (
    id uuid primary key default gen_random_uuid(),
    categoria text not null,          -- MOF, POE, Formato, Proveedor, etc.
    nombre text not null,
    version text not null,
    fecha_vigencia date,
    estado text default 'vigente' check (estado in ('vigente','obsoleto')),
    archivo_path text,                -- ruta del archivo dentro del bucket de Storage
    archivo_nombre text,              -- nombre original del archivo (ej. POE_recepcion.pdf)
    url_archivo text,                 -- se mantiene por compatibilidad (enlace externo opcional)
    subido_por text,
    created_at timestamptz default now()
);

-- ---------- BITÁCORA DE AUDITORÍA (6.2.5.16) ----------
create table log_auditoria (
    id uuid primary key default gen_random_uuid(),
    usuario text not null,
    accion text not null,             -- INSERT / UPDATE / DELETE / LOGIN
    tabla text not null,
    registro_id text,
    detalle text,
    fecha timestamptz default now()
);

-- ============================================================
-- TRIGGER: calcula el SALDO automáticamente en kardex_movimientos
-- (arrastra el saldo anterior del mismo producto + ingreso - salida)
-- ============================================================
create or replace function fn_calcular_saldo_kardex()
returns trigger as $$
declare
    saldo_anterior numeric;
begin
    select k.saldo into saldo_anterior
    from kardex_movimientos k
    where k.producto_id = new.producto_id
    order by k.created_at desc
    limit 1;

    if saldo_anterior is null then
        saldo_anterior := 0;
    end if;

    new.saldo := saldo_anterior + coalesce(new.ingreso,0) - coalesce(new.salida,0);

    update productos set stock = new.saldo where id = new.producto_id;

    return new;
end;
$$ language plpgsql;

create trigger trg_saldo_kardex
before insert on kardex_movimientos
for each row execute function fn_calcular_saldo_kardex();

-- ============================================================
-- Cuando se sube una nueva versión de un documento con el mismo
-- nombre+categoria, la versión anterior pasa a 'obsoleto' automáticamente
-- ============================================================
create or replace function fn_obsoletar_version_anterior()
returns trigger as $$
begin
    update documentos
       set estado = 'obsoleto'
     where categoria = new.categoria
       and nombre = new.nombre
       and id <> new.id
       and estado = 'vigente';
    return new;
end;
$$ language plpgsql;

create trigger trg_obsoletar_documento
after insert on documentos
for each row execute function fn_obsoletar_version_anterior();

-- ============================================================
-- Datos de prueba
-- ============================================================
insert into usuarios (username, password, nombre, rol) values
('admin', 'admin123', 'Director Técnico', 'admin'),
('asistente', 'asist123', 'Asistente de Almacén', 'asistente'),
('auxiliar', 'aux123', 'Auxiliar de Almacén', 'auxiliar');

insert into productos (codigo, nombre, presentacion, reg_sanitario, fabricante, procedencia) values
('D00031', 'PARACETAMOL 500MG', 'Caja x 100 tabletas', 'RS12345', 'LABORATORIOS ABC', 'PERÚ'),
('D00035', 'AMOXICILINA 500MG', 'Caja x 50 cápsulas', 'RS67890', 'LABORATORIOS XYZ', 'PERÚ');

insert into documentos (categoria, nombre, version, fecha_vigencia, subido_por) values
('MOF', 'Manual de Organización y Funciones', 'v1.0', current_date + interval '1 year', 'admin'),
('POE', 'POE Recepción de Productos', 'v2.0', current_date + interval '1 year', 'admin'),
('POE', 'Procedimiento ante pérdida o daño de documentación', 'v1.0', current_date + interval '1 year', 'admin');

-- Nota: en Supabase, activa Row Level Security (RLS) y crea policies
-- que exijan autenticación antes de permitir INSERT/UPDATE/DELETE
-- para un entorno real. Para esta demo académica se dejan las tablas
-- sin RLS (o con policies USING (true)) para simplificar las pruebas.
