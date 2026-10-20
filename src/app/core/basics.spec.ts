import { addDays, addMonths, daysInclusive, isDate, monthRange, previousPeriod } from './dates';
import { formatMoney, parseMoney, toAmountInput } from './money';

describe('money', () => {
  it('formats integer minor units as PKR', () => {
    expect(formatMoney(2500000)).toBe('Rs. 25,000.00');
    expect(formatMoney(5)).toBe('Rs. 0.05');
    expect(formatMoney(-123456)).toBe('-Rs. 1,234.56');
    expect(formatMoney(100, '$')).toBe('$ 1.00');
  });

  it('parses user input without floating point error', () => {
    expect(parseMoney('25,000')).toBe(2500000);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('0.29')).toBe(29); // 0.29 * 100 = 28.999999999999996 in floats
    expect(parseMoney('1.005')).toBeNull(); // > 2 decimals rejected, never silently rounded
    expect(parseMoney('-5')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('12.')).toBe(1200);
  });

  it('round-trips through the form input format', () => {
    for (const v of [1, 29, 100, 2500050, 999999999999]) expect(parseMoney(toAmountInput(v))).toBe(v);
  });

  it('sums many small amounts exactly', () => {
    let total = 0;
    for (let i = 0; i < 1000; i++) total += parseMoney('0.10')!;
    expect(total).toBe(10000);
  });
});

describe('dates', () => {
  it('handles leap years at month boundaries', () => {
    expect(monthRange('2024-02')).toEqual(['2024-02-01', '2024-02-29']);
    expect(monthRange('2023-02')).toEqual(['2023-02-01', '2023-02-28']);
    expect(monthRange('2000-02')[1]).toBe('2000-02-29');
    expect(monthRange('1900-02')[1]).toBe('1900-02-28');
    expect(monthRange('2024-12')[1]).toBe('2024-12-31');
  });

  it('moves across year boundaries', () => {
    expect(addMonths('2024-01', -1)).toBe('2023-12');
    expect(addMonths('2024-11', 3)).toBe('2025-02');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
  });

  it('computes previous periods', () => {
    expect(previousPeriod('2024-03-01', '2024-03-31')).toEqual(['2024-02-01', '2024-02-29']);
    expect(previousPeriod('2024-01-01', '2024-01-31')).toEqual(['2023-12-01', '2023-12-31']);
    expect(previousPeriod('2024-03-10', '2024-03-19')).toEqual(['2024-02-29', '2024-03-09']);
    expect(daysInclusive('2024-02-01', '2024-02-29')).toBe(29);
  });

  it('validates calendar dates', () => {
    expect(isDate('2024-02-29')).toBe(true);
    expect(isDate('2023-02-29')).toBe(false);
    expect(isDate('2024-13-01')).toBe(false);
    expect(isDate('24-1-1')).toBe(false);
  });
});
