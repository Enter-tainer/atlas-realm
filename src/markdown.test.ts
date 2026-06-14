// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { renderMarkdown, stripMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(undefined as unknown as string)).toBe('');
  });

  it('renders plain text as paragraph', () => {
    expect(renderMarkdown('Hello')).toContain('Hello');
  });

  it('renders bold', () => {
    const result = renderMarkdown('**bold**');
    expect(result).toContain('<strong>bold</strong>');
  });

  it('renders italic', () => {
    const result = renderMarkdown('*italic*');
    expect(result).toContain('<em>italic</em>');
  });

  it('renders strikethrough', () => {
    const result = renderMarkdown('~~strike~~');
    expect(result).toContain('<del>strike</del>');
  });

  it('renders inline code', () => {
    const result = renderMarkdown('`code`');
    expect(result).toContain('<code>code</code>');
  });

  it('renders links', () => {
    const result = renderMarkdown('[link](https://example.com)');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener"');
    expect(result).toContain('>link</a>');
  });

  it('renders unordered lists', () => {
    const result = renderMarkdown('- item');
    expect(result).toContain('<li>item</li>');
  });

  it('renders blockquote content', () => {
    const result = renderMarkdown('> quote');
    expect(result).toContain('quote');
  });

  it('renders headings', () => {
    const r1 = renderMarkdown('# H1');
    expect(r1).toContain('H1');
    const r2 = renderMarkdown('## H2');
    expect(r2).toContain('H2');
  });

  it('renders code blocks', () => {
    const result = renderMarkdown('```\ncode block\n```');
    expect(result).toContain('code block');
  });

  it('renders mixed content', () => {
    const result = renderMarkdown('**bold** and *italic* and `code`');
    expect(result).toContain('bold');
    expect(result).toContain('italic');
    expect(result).toContain('code');
  });

  it('preserves line breaks in content', () => {
    const result = renderMarkdown('line1\n\nline2');
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('renderMarkdown security', () => {
  it('strips script tags', () => {
    const result = renderMarkdown('<script>alert(1)</script>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('</script>');
  });

  it('strips event handlers', () => {
    const result = renderMarkdown('<div onclick="alert(1)">text</div>');
    expect(result).not.toContain('onclick');
  });

  it('strips dangerous URL schemes', () => {
    const result = renderMarkdown('[bad](javascript:alert(1))');
    expect(result).not.toContain('javascript:');
  });

  it('allows safe image tags', () => {
    const result = renderMarkdown('![alt](https://example.com/img.png)');
    expect(result).toContain('src="https://example.com/img.png"');
  });

  it('allows safe links with proper attributes', () => {
    const result = renderMarkdown('[safe](https://example.com)');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener"');
    expect(result).not.toContain('javascript:');
  });
});

describe('stripMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(stripMarkdown('')).toBe('');
    expect(stripMarkdown(undefined as unknown as string)).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(stripMarkdown('plain text')).toBe('plain text');
  });

  it('strips bold markers', () => {
    expect(stripMarkdown('**bold**')).toBe('bold');
  });

  it('strips italic markers', () => {
    expect(stripMarkdown('*italic*')).toBe('italic');
  });

  it('strips strikethrough markers', () => {
    expect(stripMarkdown('~~strike~~')).toBe('strike');
  });

  it('strips inline code markers', () => {
    expect(stripMarkdown('`code`')).toBe('code');
  });

  it('strips link syntax, keeps link text', () => {
    expect(stripMarkdown('[text](url)')).toBe('text');
  });

  it('strips image syntax, keeps alt text', () => {
    expect(stripMarkdown('![alt](url)')).toBe('alt');
  });

  it('strips heading markers', () => {
    expect(stripMarkdown('# Heading')).toBe('Heading');
    expect(stripMarkdown('## Sub')).toBe('Sub');
  });

  it('strips blockquote markers', () => {
    expect(stripMarkdown('> quote')).toBe('quote');
  });

  it('strips unordered list markers', () => {
    expect(stripMarkdown('- item')).toBe('item');
    expect(stripMarkdown('* item')).toBe('item');
  });

  it('strips ordered list markers', () => {
    expect(stripMarkdown('1. first')).toBe('first');
  });

  it('preserves line breaks', () => {
    const result = stripMarkdown('line1\nline2');
    expect(result).toContain('\n');
  });

  it('strips horizontal rules', () => {
    expect(stripMarkdown('---')).toBe('');
  });
});
