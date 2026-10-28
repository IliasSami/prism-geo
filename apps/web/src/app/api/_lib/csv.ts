/**
 * A spreadsheet cell, quoted, with formula injection neutralised (CWE-1236): a value that starts
 * with = + - @ | a tab or CR, after leading spaces, or with their full-width forms, gets a '
 * prefix so Excel and Sheets show it as text.
 */
export function sanitizeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  const risky = /^[=+\-@\t\r|＝＋－＠]/;
  if (risky.test(str) || risky.test(str.trimStart())) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}
