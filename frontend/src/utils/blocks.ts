import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, Paragraph, PhrasingContent } from 'mdast';

// ── Types ────────────────────────────────────────────────────────────────────

export type BlockType = 'paragraph' | 'heading' | 'list' | 'quote' | 'code' | 'image' | 'video';

export type Block =
  | { id: string; type: 'paragraph'; content: string }
  | { id: string; type: 'heading'; level: 2 | 3 | 4; content: string }
  | { id: string; type: 'list'; ordered: boolean; items: string[] }
  | { id: string; type: 'quote'; content: string; attribution?: string }
  | { id: string; type: 'code'; language?: string; code: string }
  | { id: string; type: 'image'; src: string; caption?: string; rotation?: 0 | 90 | 180 | 270; pendingFile?: File }
  | { id: string; type: 'video'; src?: string; url?: string; caption?: string; pendingFile?: File };

function uid(): string {
  return crypto.randomUUID();
}

export function createBlock(type: BlockType): Block {
  const id = uid();
  switch (type) {
    case 'paragraph': return { id, type: 'paragraph', content: '' };
    case 'heading': return { id, type: 'heading', level: 2, content: '' };
    case 'list': return { id, type: 'list', ordered: false, items: [''] };
    case 'quote': return { id, type: 'quote', content: '' };
    case 'code': return { id, type: 'code', code: '' };
    case 'image': return { id, type: 'image', src: '' };
    case 'video': return { id, type: 'video' };
  }
}

export function moveBlock(blocks: Block[], from: number, to: number): Block[] {
  if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return blocks;
  const arr = [...blocks];
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  return arr;
}

function parseRotation(title?: string | null): 0 | 90 | 180 | 270 | undefined {
  const m = title?.match(/^r:(\d+)$/);
  if (!m) return undefined;
  const n = parseInt(m[1]);
  return (n === 90 || n === 180 || n === 270) ? n : undefined;
}

// ── Markdown → Blocks ────────────────────────────────────────────────────────

function inlineToMd(nodes: PhrasingContent[]): string {
  return nodes.map(n => {
    switch (n.type) {
      case 'text': return n.value;
      case 'strong': return `**${inlineToMd(n.children as PhrasingContent[])}**`;
      case 'emphasis': return `_${inlineToMd(n.children as PhrasingContent[])}_`;
      case 'inlineCode': return `\`${n.value}\``;
      case 'link': return `[${inlineToMd(n.children as PhrasingContent[])}](${n.url})`;
      case 'image': return `![${n.alt ?? ''}](${n.url})`;
      case 'html': return n.value;
      case 'break': return '\n';
      case 'delete': return `~~${inlineToMd(n.children as PhrasingContent[])}~~`;
      default: return '';
    }
  }).join('');
}

export function parseMarkdown(md: string): Block[] {
  if (!md.trim()) return [createBlock('paragraph')];

  const tree = unified().use(remarkParse).parse(md) as Root;
  const blocks: Block[] = [];

  for (const node of tree.children) {
    switch (node.type) {
      case 'paragraph': {
        const hasImage = node.children.some(c => c.type === 'image');
        if (hasImage) {
          // Split paragraph into separate image blocks and text blocks.
          // Handles: single image, multiple images, mixed image+text.
          let textBuf: PhrasingContent[] = [];
          for (const child of node.children) {
            if (child.type === 'image') {
              if (textBuf.length > 0) {
                const txt = inlineToMd(textBuf).trim();
                if (txt) blocks.push({ id: uid(), type: 'paragraph', content: txt });
                textBuf = [];
              }
              const rotation = parseRotation(child.title);
              blocks.push({ id: uid(), type: 'image', src: child.url, caption: child.alt || undefined, rotation });
            } else {
              textBuf.push(child as PhrasingContent);
            }
          }
          if (textBuf.length > 0) {
            const txt = inlineToMd(textBuf).trim();
            if (txt) blocks.push({ id: uid(), type: 'paragraph', content: txt });
          }
          break;
        }
        const content = inlineToMd(node.children as PhrasingContent[]);
        if (content.trim()) blocks.push({ id: uid(), type: 'paragraph', content });
        break;
      }
      case 'heading': {
        const level = Math.max(2, Math.min(4, node.depth)) as 2 | 3 | 4;
        const content = inlineToMd(node.children as PhrasingContent[]);
        blocks.push({ id: uid(), type: 'heading', level, content });
        break;
      }
      case 'list': {
        const items = node.children.map(li => {
          const para = li.children[0];
          if (para?.type === 'paragraph') return inlineToMd((para as Paragraph).children as PhrasingContent[]);
          return '';
        }).filter(Boolean);
        if (items.length) blocks.push({ id: uid(), type: 'list', ordered: !!node.ordered, items });
        break;
      }
      case 'blockquote': {
        const paras = node.children.filter(c => c.type === 'paragraph') as Paragraph[];
        // If last para starts with "— ", treat as attribution
        const allText = paras.map(p => inlineToMd(p.children as PhrasingContent[]));
        const last = allText[allText.length - 1] ?? '';
        if (allText.length > 1 && (last.startsWith('— ') || last.startsWith('- '))) {
          blocks.push({
            id: uid(), type: 'quote',
            content: allText.slice(0, -1).join('\n'),
            attribution: last.replace(/^[—-]\s*/, ''),
          });
        } else {
          blocks.push({ id: uid(), type: 'quote', content: allText.join('\n') });
        }
        break;
      }
      case 'code': {
        blocks.push({ id: uid(), type: 'code', language: node.lang ?? undefined, code: node.value });
        break;
      }
      default: {
        if ('value' in node && typeof (node as { value: unknown }).value === 'string') {
          const v = ((node as { value: string }).value).trim();
          if (v) blocks.push({ id: uid(), type: 'paragraph', content: v });
        }
        break;
      }
    }
  }

  return blocks.length > 0 ? blocks : [createBlock('paragraph')];
}

// ── Blocks → Markdown ────────────────────────────────────────────────────────

export function serializeBlock(block: Block): string {
  switch (block.type) {
    case 'paragraph':
      return block.content || '';
    case 'heading':
      return `${'#'.repeat(block.level)} ${block.content}`;
    case 'list':
      return block.items
        .map((item, i) => block.ordered ? `${i + 1}. ${item}` : `- ${item}`)
        .join('\n');
    case 'quote': {
      const lines = block.content.split('\n').map(l => `> ${l}`);
      if (block.attribution) lines.push(`> — ${block.attribution}`);
      return lines.join('\n');
    }
    case 'code': {
      const lang = block.language ?? '';
      return `\`\`\`${lang}\n${block.code}\n\`\`\``;
    }
    case 'image':
      if (!block.src) return '';
      return block.rotation
        ? `![${block.caption ?? ''}](${block.src} "r:${block.rotation}")`
        : `![${block.caption ?? ''}](${block.src})`;
    case 'video':
      if (block.url) return `[▶ ${block.caption ?? 'video'}](${block.url})`;
      if (block.src) return `![${block.caption ?? ''}](${block.src})`;
      return '';
  }
}

export function serializeBlocks(blocks: Block[]): string {
  return blocks
    .map(serializeBlock)
    .filter(Boolean)
    .join('\n\n');
}
