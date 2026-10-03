const UNITS = ["B", "KB", "MB", "GB", "TB"];
const numberFormat = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 });

/** Tamanho legível em base 1024 (ex.: 1536 -> "1,5 KB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  // Compara o valor já arredondado para 1048575 B dar "1 MB" e não "1024 KB".
  while (unit < UNITS.length - 1 && Math.round(value * 10) / 10 >= 1024) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${numberFormat.format(value)} ${UNITS[unit]}`;
}
