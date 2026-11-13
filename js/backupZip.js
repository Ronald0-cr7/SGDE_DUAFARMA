// ZIP estándar sin compresión: escribe cada entrada directamente en disco.
// Conserva en memoria solo un archivo y el índice central del ZIP.
(function () {
    'use strict';
    const encoder = new TextEncoder();
    const tabla = Uint32Array.from({ length: 256 }, (_, n) => {
        for (let k = 0; k < 8; k++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
        return n >>> 0;
    });
    function crc32(bytes) {
        let crc = 0xffffffff;
        for (const b of bytes) crc = tabla[(crc ^ b) & 255] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }
    class BackupZip {
        constructor(writer) { this.writer = writer; this.offset = 0; this.entradas = []; }
        async escribir(bytes) { await this.writer.write(bytes); this.offset += bytes.byteLength; }
        async agregar(nombre, contenido) {
            const bytes = typeof contenido === 'string' ? encoder.encode(contenido) : new Uint8Array(contenido);
            const name = encoder.encode(nombre);
            if (name.length > 65535 || this.entradas.length >= 65534 ||
                this.offset + 30 + name.length + bytes.length >= 0xffffffff) {
                throw new Error('El respaldo supera los límites ZIP (4 GB o 65534 entradas). No se completó la copia.');
            }
            const crc = crc32(bytes);
            const header = new Uint8Array(30 + name.length);
            const view = new DataView(header.buffer);
            view.setUint32(0, 0x04034b50, true);
            view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
            view.setUint16(12, 33, true); // 1980-01-01, fecha DOS válida
            view.setUint32(14, crc, true);
            view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true);
            view.setUint16(26, name.length, true); header.set(name, 30);
            this.entradas.push({ name, crc, size: bytes.length, offset: this.offset });
            await this.escribir(header); await this.escribir(bytes);
        }
        async cerrar() {
            const inicio = this.offset;
            const centralSize = this.entradas.reduce((n, e) => n + 46 + e.name.length, 0);
            if (inicio + centralSize + 22 >= 0xffffffff) throw new Error('El respaldo supera el límite ZIP de 4 GB.');
            for (const e of this.entradas) {
                const header = new Uint8Array(46 + e.name.length);
                const v = new DataView(header.buffer);
                v.setUint32(0, 0x02014b50, true);
                v.setUint16(4, 20, true); v.setUint16(6, 20, true);
                v.setUint16(8, 0x800, true); v.setUint16(14, 33, true);
                v.setUint32(16, e.crc, true); v.setUint32(20, e.size, true);
                v.setUint32(24, e.size, true); v.setUint16(28, e.name.length, true);
                v.setUint32(42, e.offset, true); header.set(e.name, 46);
                await this.escribir(header);
            }
            const end = new Uint8Array(22); const v = new DataView(end.buffer);
            v.setUint32(0, 0x06054b50, true);
            v.setUint16(8, this.entradas.length, true); v.setUint16(10, this.entradas.length, true);
            v.setUint32(12, this.offset - inicio, true); v.setUint32(16, inicio, true);
            await this.escribir(end); await this.writer.close();
        }
    }
    window.BackupZip = BackupZip;
})();
