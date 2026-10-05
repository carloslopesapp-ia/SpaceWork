const UNITS = ["B", "KB", "MB", "GB", "TB"];
const numberFormat = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });

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

/** Data legível (ex.: "03/10/2026") a partir de milissegundos Unix, no fuso do utilizador; "—" se o valor não for uma data. */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}
