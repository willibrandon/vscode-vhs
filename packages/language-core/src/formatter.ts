export interface FormatOptions {
  readonly insertFinalNewline?: boolean;
}

export function formatVhs(text: string, options: FormatOptions = {}): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = text
    .split(/\r?\n/u)
    .map((line) => line.replace(/[\t ]+$/u, ""))
    .join(newline);
  if (options.insertFinalNewline === false) return normalized;
  return `${normalized.replace(/(?:\r?\n)*$/u, "")}${newline}`;
}
