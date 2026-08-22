export function resolver_indice_fragmento(valor: string | undefined, total_fragmentos: number): number | null {
  if (valor === undefined || !/^\d+$/.test(valor)) return null;
  const indice = Number(valor);
  return Number.isSafeInteger(indice) && indice < total_fragmentos ? indice : null;
}
