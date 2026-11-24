import type { IconComponent } from './IconBase.tsx';
import {
  FileCss,
  FileGeneric,
  FileHtml,
  FileImage,
  FileJs,
  FileJson,
  FileMd,
  FileTs,
} from './icons.tsx';

export function fileIconFor(name: string): IconComponent {
  const clean = name.trim().toLowerCase();
  const base = clean.split(/[/\\]/).pop() ?? clean;
  const dotIndex = base.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === base.length - 1) {
    return FileGeneric;
  }
  const ext = base.slice(dotIndex + 1);
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return FileTs;
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return FileJs;
    case 'json':
    case 'jsonc':
    case 'json5':
    case 'webmanifest':
      return FileJson;
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
    case 'pcss':
      return FileCss;
    case 'html':
    case 'htm':
    case 'xhtml':
    case 'vue':
    case 'svelte':
      return FileHtml;
    case 'md':
    case 'mdx':
    case 'markdown':
      return FileMd;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
    case 'bmp':
    case 'avif':
      return FileImage;
    default:
      return FileGeneric;
  }
}
