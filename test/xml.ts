// A small well-formedness check for the SVG we generate: every tag closes, no attribute twice,
// only the five XML entities. A browser shows nothing for an <img> whose SVG fails any of these.
export function xmlProblems(text: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/y;
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    const chunk = text.slice(i, lt === -1 ? text.length : lt);
    for (const m of chunk.matchAll(/&([^;\s]*);?/g)) {
      if (!/^(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+)$/.test(m[1]) || !m[0].endsWith(';')) problems.push(`bad entity ${m[0]}`);
    }
    if (lt === -1) break;
    tag.lastIndex = lt;
    const m = tag.exec(text);
    if (!m) {
      problems.push(`bad tag at ${lt}: ${text.slice(lt, lt + 40)}`);
      break;
    }
    const [, closing, name, attrs, selfClosing] = m;
    const names = [...attrs.matchAll(/([\w:.-]+)="/g)].map((a) => a[1]);
    const dup = names.find((n, j) => names.indexOf(n) !== j);
    if (dup) problems.push(`<${name}> has ${dup} twice`);
    if (closing) {
      if (stack.pop() !== name) problems.push(`</${name}> closes the wrong tag`);
    } else if (!selfClosing) stack.push(name);
    i = tag.lastIndex;
  }
  if (stack.length) problems.push(`unclosed: ${stack.join(', ')}`);
  return problems;
}
