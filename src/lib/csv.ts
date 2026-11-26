/**
 * CSV export helpers (Excel-friendly).
 *
 * - Every field is quoted, so commas, quotes and line breaks don't shift columns.
 * - A UTF-8 byte-order mark keeps Excel from garbling accented / non-English text.
 * - Formula-injection guard: customers type their own names and notes, so a value such as
 *   "=HYPERLINK(...)" could run as a formula when staff open the file. Cells starting with
 *   = + - @ (or tab / carriage return) get a leading apostrophe so Excel treats them as text.
 */
export type CsvValue = string | number | boolean | null | undefined;

export function csvField(value: CsvValue): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCSV(columns: string[], rows: CsvValue[][]): string {
  return '﻿' + [columns, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n');
}

export function downloadCSV(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** e.g. "items-2026-11-23.csv" */
export function csvFilename(prefix: string): string {
  return `${prefix}-${new Date().toLocaleDateString('en-CA')}.csv`;
}
