let currentSymbol = 'Rs.';

export function setCurrencySymbol(symbol: string): void {
  currentSymbol = symbol;
}

export function currencySymbol(): string {
  return currentSymbol;
}

/** 2500000 -> "Rs. 25,000.00". Integer arithmetic only. */
export function formatMoney(minor: number, symbol = currentSymbol): string {
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${minor < 0 ? '-' : ''}${symbol} ${whole}.${frac}`;
}

/** "25,000.5" -> 2500050. Returns null for anything that is not a non-negative amount with <= 2 decimals. */
export function parseMoney(input: string | number | null | undefined): number | null {
  const s = String(input ?? '').replace(/[,\s]/g, '');
  const m = /^(\d{1,13})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** 2500050 -> "25000.50" for form inputs. */
export function toAmountInput(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}
