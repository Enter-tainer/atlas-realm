import { marked } from 'marked';
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'a',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'del',
  'img',
];

const SANITIZE_CONFIG: Record<string, unknown> = {
  ALLOWED_TAGS,
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title'],
  ALLOW_DATA_ATTR: false,
};

function sanitizeHtml(html: string): string {
  const purify = DOMPurify as unknown as Record<string, unknown>;
  const sanitize: (d: string, c: unknown) => string =
    typeof purify.sanitize === 'function'
      ? (purify.sanitize as (d: string, c: unknown) => string)
      : (DOMPurify as unknown as (d: string, c: unknown) => string);
  return sanitize(html, SANITIZE_CONFIG);
}

export function renderMarkdown(md: string): string {
  if (!md) return '';
  const raw = marked.parse(md, { async: false }) as string;
  let sanitized = sanitizeHtml(raw);
  sanitized = sanitized.replace(/<a\s/g, '<a target="_blank" rel="noopener" ');
  sanitized = sanitized.replace(/ href=["']?javascript:[^"'\s>]*/gi, ' href=""');
  return sanitized;
}

export function stripMarkdown(md: string): string {
  if (!md) return '';
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .trim();
}
