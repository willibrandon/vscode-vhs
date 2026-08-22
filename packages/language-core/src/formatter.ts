export interface FormatOptions {
  readonly insertFinalNewline?: boolean;
}

export function formatVhs(text: string, options: FormatOptions = {}): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = splitLines(text).map(trimTrailingWhitespace).join(newline);
  if (options.insertFinalNewline === false) return normalized;
  return `${removeFinalNewlines(normalized, newline)}${newline}`;
}

function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue;
    const end = index > start && text.charCodeAt(index - 1) === 13 ? index - 1 : index;
    lines.push(text.slice(start, end));
    start = index + 1;
  }
  lines.push(text.slice(start));
  return lines;
}

function trimTrailingWhitespace(line: string): string {
  let end = line.length;
  while (end > 0) {
    const code = line.charCodeAt(end - 1);
    if (code !== 9 && code !== 32) break;
    end -= 1;
  }
  return line.slice(0, end);
}

function removeFinalNewlines(text: string, newline: string): string {
  let end = text.length;
  if (newline === "\n") {
    while (end > 0 && text.charCodeAt(end - 1) === 10) end -= 1;
  } else {
    while (end > 1 && text.charCodeAt(end - 2) === 13 && text.charCodeAt(end - 1) === 10) end -= 2;
  }
  return text.slice(0, end);
}
