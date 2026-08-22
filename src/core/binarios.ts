export function normalizar_binario(datos: unknown): ArrayBuffer {
  if (Object.prototype.toString.call(datos) === "[object ArrayBuffer]") {
    const binario = datos as ArrayBuffer;
    if (binario.byteLength === 0) throw new Error("El archivo recibido está vacío.");
    return binario.slice(0);
  }
  if (ArrayBuffer.isView(datos)) {
    if (datos.byteLength === 0) throw new Error("El archivo recibido está vacío.");
    return datos.buffer.slice(datos.byteOffset, datos.byteOffset + datos.byteLength) as ArrayBuffer;
  }
  if (Array.isArray(datos)) {
    if (datos.length === 0) throw new Error("El archivo recibido está vacío.");
    return new Uint8Array(datos).buffer;
  }
  throw new TypeError("Respuesta binaria nativa no reconocida.");
}
