import Decimal from 'decimal.js';

// Configure decimal precision and rounding mode (HALF_UP is standard banking rounding)
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export const toDecimal = (val: number | string | Decimal): Decimal => {
  if (val instanceof Decimal) return val;
  if (typeof val === 'number' && isNaN(val)) return new Decimal(0);
  if (!val) return new Decimal(0);
  return new Decimal(val);
};

export const addMoney = (...values: (number | string | Decimal)[]): Decimal => {
  return values.reduce<Decimal>((acc, cur) => acc.plus(toDecimal(cur)), new Decimal(0));
};

export const subMoney = (a: number | string | Decimal, b: number | string | Decimal): Decimal => {
  return toDecimal(a).minus(toDecimal(b));
};

export const mulMoney = (a: number | string | Decimal, b: number | string | Decimal): Decimal => {
  return toDecimal(a).times(toDecimal(b));
};

export const divMoney = (a: number | string | Decimal, b: number | string | Decimal): Decimal => {
  const decB = toDecimal(b);
  if (decB.isZero()) return new Decimal(0);
  return toDecimal(a).dividedBy(decB);
};

/**
 * Format money with given decimals (default 3 for Jordanian Dinar JD - Fils)
 */
export const formatMoney = (val: number | string | Decimal, decimals: number = 3, currencySymbol: string = 'د.أ'): string => {
  const dec = toDecimal(val);
  const formattedNumber = dec.toFixed(decimals);
  // Add thousands commas
  const parts = formattedNumber.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const result = parts.join('.');
  return `${result} ${currencySymbol}`;
};

export const roundMoney = (val: number | string | Decimal, decimals: number = 3): number => {
  return toDecimal(val).toDecimalPlaces(decimals).toNumber();
};
