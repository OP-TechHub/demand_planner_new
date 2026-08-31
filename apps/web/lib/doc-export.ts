/**
 * Word export, without a dependency.
 *
 * Word, Google Docs and Pages all open an HTML document served as
 * `application/msword`, and they keep its tables and inline styles — which is
 * why the sheets that use this are styled inline rather than with classes. The
 * result is a normal, editable .doc, not a screenshot, so whoever receives it
 * can annotate it before passing it on.
 *
 * The MSO conditional block below is what tells Word the page setup; other
 * readers ignore it as an HTML comment.
 */
export function elementToDocHtml(html: string, title: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page { size: A4; margin: 16mm; }
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #000; }
table { border-collapse: collapse; }
</style>
</head>
<body>${html}</body>
</html>`;
}

/**
 * Download a rendered element as a .doc.
 *
 * The BOM matters: without it Word guesses the encoding from the locale and
 * mangles anything non-ASCII (the en dashes and “curly quotes” in the sheets).
 */
export function downloadDoc(filename: string, elementId: string, title: string): boolean {
  const el = document.getElementById(elementId);
  if (!el) return false;
  const blob = new Blob(['﻿', elementToDocHtml(el.outerHTML, title)], {
    type: 'application/msword;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.doc') ? filename : `${filename}.doc`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/** Filename-safe slug. Falls back to `fallback` rather than returning ''. */
export function slugify(s: string, fallback = 'document'): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
