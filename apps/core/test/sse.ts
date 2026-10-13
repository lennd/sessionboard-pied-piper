export const parseSse = (body: string): { event: string; data: unknown }[] =>
  body
    .split(/\r?\n\r?\n/)
    .map((part) => part.split(/\r?\n/))
    .filter((lines) => lines.some((l) => l.startsWith('event:')))
    .map((lines) => ({
      event: lines.find((l) => l.startsWith('event:'))!.slice('event:'.length).trim(),
      data: JSON.parse(lines.filter((l) => l.startsWith('data:')).map((l) => l.slice('data:'.length).trim()).join('\n')),
    }));
