/** Format integer minor units (cents) as a currency string. */
export function formatMinorUnits(minor: number, currency = 'USD'): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  if (hours >= 10) {
    return `${Math.round(hours)}h`;
  }

  const rounded = Math.round(hours * 10) / 10;

  return `${rounded}h`;
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}

export function formatDay(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
