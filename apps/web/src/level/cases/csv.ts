/** CSV text (RFC 4180): fields with a comma, quote, CR or LF, or edge spaces, are quoted with quotes doubled. */
export function csvField(v: string | number | undefined | null): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(fields: readonly (string | number | undefined | null)[]): string {
  return fields.map(csvField).join(',');
}

/** Rows joined with CRLF, ending with one. */
export function csvText(rows: readonly (readonly (string | number | undefined | null)[])[]): string {
  return rows.map(csvLine).join('\r\n') + '\r\n';
}

/** Offer CSV text as a file download. */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
