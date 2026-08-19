/**
 * Display units for the physical properties of a thing.
 *
 * The server stores and returns ONE unit per measurement — millimetres, grams,
 * millilitres — and refuses anything else, so nothing here converts on the way
 * in or out of the API: these helpers exist purely so a person who thinks in
 * inches never has to see 304.8, and never has to type it either.
 *
 * The conversion factors are the same exact ones the server uses
 * (`backend/apps/api/src/domains/memory/physicalProperties.ts`). They are exact
 * by definition of the international inch and pound, so a value entered as
 * `12 in`, stored as 304.8, and rendered back is `12 in` again — round-tripping
 * is what makes an editable form honest.
 */

export type UnitSystem = 'metric' | 'imperial';

const MM_PER_INCH = 25.4;
const G_PER_OUNCE = 28.349523125;
const G_PER_POUND = 453.59237;
const ML_PER_FLUID_OUNCE = 29.5735295625;

/** Below this, imperial lengths read better in inches than in feet. */
const INCHES_PER_FOOT = 12;

/** Below this, imperial masses read better in ounces than in pounds. */
const OUNCES_PER_POUND = 16;

/** Rounds for display without pretending to a precision the value never had. */
function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/** Formats a number without a trailing `.0`, which reads as false precision. */
function trim(value: number): string {
  return String(value);
}

/** Canonical millimetres → the number a person types in this unit system. */
export function lengthFromMm(mm: number | null | undefined, system: UnitSystem): number | null {
  if (mm == null) {
    return null;
  }

  return system === 'imperial' ? round(mm / MM_PER_INCH, 2) : round(mm / 10, 2);
}

/** The number a person typed in this unit system → canonical millimetres. */
export function lengthToMm(value: number | null | undefined, system: UnitSystem): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return round(system === 'imperial' ? value * MM_PER_INCH : value * 10, 3);
}

/** Canonical grams → the number a person types in this unit system. */
export function massFromG(grams: number | null | undefined, system: UnitSystem): number | null {
  if (grams == null) {
    return null;
  }

  return system === 'imperial' ? round(grams / G_PER_POUND, 2) : round(grams / 1000, 3);
}

/** The number a person typed in this unit system → canonical grams. */
export function massToG(value: number | null | undefined, system: UnitSystem): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return round(system === 'imperial' ? value * G_PER_POUND : value * 1000, 3);
}

/** Canonical millilitres → the number a person types in this unit system. */
export function volumeFromMl(ml: number | null | undefined, system: UnitSystem): number | null {
  if (ml == null) {
    return null;
  }

  return system === 'imperial' ? round(ml / ML_PER_FLUID_OUNCE, 2) : round(ml / 1000, 3);
}

/** The number a person typed in this unit system → canonical millilitres. */
export function volumeToMl(value: number | null | undefined, system: UnitSystem): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return round(system === 'imperial' ? value * ML_PER_FLUID_OUNCE : value * 1000, 3);
}

/** The unit label a form field should wear. */
export const UNIT_LABELS: Record<UnitSystem, { length: string; mass: string; volume: string }> = {
  metric: { length: 'cm', mass: 'kg', volume: 'L' },
  imperial: { length: 'in', mass: 'lb', volume: 'fl oz' },
};

/**
 * A length for reading rather than editing — scaled to the unit that keeps the
 * number small ("3.2 m", not "3200 mm"; "2 ft 6 in" stays inches at "30 in").
 */
export function formatLength(mm: number | null | undefined, system: UnitSystem = 'metric'): string | null {
  if (mm == null) {
    return null;
  }

  if (system === 'imperial') {
    const inches = mm / MM_PER_INCH;

    return inches >= INCHES_PER_FOOT
      ? `${trim(round(inches / INCHES_PER_FOOT, 2))} ft`
      : `${trim(round(inches, 2))} in`;
  }

  if (mm >= 1000) {
    return `${trim(round(mm / 1000, 2))} m`;
  }

  if (mm >= 10) {
    return `${trim(round(mm / 10, 1))} cm`;
  }

  return `${trim(round(mm, 1))} mm`;
}

/** A mass for reading rather than editing. */
export function formatMass(grams: number | null | undefined, system: UnitSystem = 'metric'): string | null {
  if (grams == null) {
    return null;
  }

  if (system === 'imperial') {
    const ounces = grams / G_PER_OUNCE;

    return ounces >= OUNCES_PER_POUND
      ? `${trim(round(grams / G_PER_POUND, 2))} lb`
      : `${trim(round(ounces, 1))} oz`;
  }

  return grams >= 1000 ? `${trim(round(grams / 1000, 2))} kg` : `${trim(round(grams, 1))} g`;
}

/** A capacity for reading rather than editing. */
export function formatVolume(ml: number | null | undefined, system: UnitSystem = 'metric'): string | null {
  if (ml == null) {
    return null;
  }

  if (system === 'imperial') {
    const fluidOunces = ml / ML_PER_FLUID_OUNCE;

    return `${trim(round(fluidOunces, 1))} fl oz`;
  }

  return ml >= 1000 ? `${trim(round(ml / 1000, 2))} L` : `${trim(round(ml, 1))} mL`;
}

/**
 * The one-line size summary — `30 × 20 × 5 cm`.
 *
 * Every axis is rendered in the SAME unit, chosen from the largest of them, so
 * the three numbers stay comparable. Formatting each independently would give
 * "1.2 m × 40 cm × 8 cm", which no one can picture.
 */
export function formatDimensions(
  dimensions: { lengthMm?: number | null; widthMm?: number | null; heightMm?: number | null },
  system: UnitSystem = 'metric',
): string | null {
  const axes = [dimensions.lengthMm, dimensions.widthMm, dimensions.heightMm].filter(
    (value): value is number => value != null,
  );

  if (axes.length === 0) {
    return null;
  }

  const largest = Math.max(...axes);

  if (system === 'imperial') {
    const useFeet = largest / MM_PER_INCH >= INCHES_PER_FOOT;
    const divisor = useFeet ? MM_PER_INCH * INCHES_PER_FOOT : MM_PER_INCH;

    return `${axes.map((value) => trim(round(value / divisor, 2))).join(' × ')} ${useFeet ? 'ft' : 'in'}`;
  }

  const unit = largest >= 1000 ? 'm' : largest >= 10 ? 'cm' : 'mm';
  const divisor = unit === 'm' ? 1000 : unit === 'cm' ? 10 : 1;

  return `${axes.map((value) => trim(round(value / divisor, unit === 'mm' ? 1 : 2))).join(' × ')} ${unit}`;
}

/** Title-cases a stored lowercase term ('off white' → 'Off white') for display. */
export function formatTerm(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}
