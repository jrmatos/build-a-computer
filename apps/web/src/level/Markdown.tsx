import { Fragment, type ReactNode } from 'react';

/**
 * Tiny Markdown subset for level text: paragraphs, pipe tables, bullet and
 * numbered lists, **bold**, *italic* and `code`. Builds React elements, never
 * HTML strings, so level text cannot inject markup. LVL-04's MDX renderer
 * replaces this when interactive widgets arrive.
 */
export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'code'; text: string };

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*```/.test(line)) {
      // Fenced code (e.g. a Toy-8 program): kept verbatim, line by line.
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      out.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (line.trim().startsWith('|') && isRule(lines[i + 1] ?? '')) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!));
      i--;
      out.push({ kind: 'table', head, rows });
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      const re = ul ? /^\s*[-*]\s+(.*)$/ : /^\s*\d+[.)]\s+(.*)$/;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i]!)) items.push(re.exec(lines[i++]!)![1]!);
      i--;
      out.push({ kind, items });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

/** Inline **bold**, *italic* and `code`. */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) out.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<code key={k++}>{m[3]}</code>);
    else out.push(<em key={k++}>{m[4]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={['md', className].filter(Boolean).join(' ')}>
      {parseBlocks(text).map((b, i) => {
        if (b.kind === 'p') return <p key={i}>{inline(b.text)}</p>;
        if (b.kind === 'code')
          return (
            <pre key={i} className="md-code">
              <code>{b.text}</code>
            </pre>
          );
        if (b.kind === 'table')
          return (
            <table key={i} className="md-table">
              <thead>
                <tr>
                  {b.head.map((h, j) => (
                    <th key={j}>{inline(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, n) => (
                      <td key={n}>{inline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        const List = b.kind;
        return (
          <List key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Fragment>{inline(it)}</Fragment>
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
