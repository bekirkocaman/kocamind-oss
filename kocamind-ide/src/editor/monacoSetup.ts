import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

/**
 * KocaMind Monaco temaları (kocamind-dark ve kocamind-light)
 * Web'in claude-theme.css ve SyntaxHighlighter renk diline uyumlu:
 * Sıcak koyu zemin (#151515), kiremit vurgu (#d97757 / #b5532f), mor yok.
 */

interface MonacoEnvironmentGlobal {
  MonacoEnvironment?: {
    getWorker: (moduleId: string, label: string) => Worker;
  };
}

(self as MonacoEnvironmentGlobal).MonacoEnvironment = {
  getWorker(_id: string, label: string): Worker {
    if (label === 'json') {
      return new jsonWorker();
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker();
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker();
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

monaco.editor.defineTheme('kocamind-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    // Nötr metin ve yorumlar
    { token: '', foreground: 'f9f9f7' },
    { token: 'comment', foreground: '7c7b76', fontStyle: 'italic' },
    { token: 'delimiter', foreground: '95948f' },
    { token: 'delimiter.bracket', foreground: 'a6a5a0' },
    { token: 'operator', foreground: 'a6a5a0' },

    // Anahtar kelimeler: sıcak kiremit vurgu
    { token: 'keyword', foreground: 'd97757' },
    { token: 'keyword.control', foreground: 'd97757' },
    { token: 'storage', foreground: 'd97757' },
    { token: 'storage.type', foreground: 'e08e72' },

    // Dizgeler: sakin adaçayı yeşili
    { token: 'string', foreground: '8ab882' },
    { token: 'string.regexp', foreground: '6dba82' },
    { token: 'string.escape', foreground: 'e2a64f' },

    // Sayılar ve sabitler: sıcak kehribar
    { token: 'number', foreground: 'e2a64f' },
    { token: 'constant', foreground: 'e2a64f' },
    { token: 'constant.language', foreground: 'e2a64f' },

    // Fonksiyonlar, tipler ve etiketler: sakin mavi ve sıcak altın
    { token: 'entity.name.function', foreground: '6fa8f5' },
    { token: 'support.function', foreground: '6fa8f5' },
    { token: 'type', foreground: 'e5c07b' },
    { token: 'type.identifier', foreground: 'e5c07b' },
    { token: 'entity.name.type', foreground: 'e5c07b' },
    { token: 'tag', foreground: 'e08e72' },
    { token: 'attribute.name', foreground: 'd19a66' },
    { token: 'attribute.value', foreground: '8ab882' },

    // Değişken ve özellikler
    { token: 'variable', foreground: 'f9f9f7' },
    { token: 'identifier', foreground: 'f9f9f7' },
    { token: 'property', foreground: 'd5d4ce' },

    // Geçersiz sözdizimi
    { token: 'invalid', foreground: 'e5675a' },
  ],
  colors: {
    'editor.background': '#151515',
    'editor.foreground': '#f9f9f7',
    'editorGutter.background': '#151515',
    'editor.lineHighlightBackground': '#20201f99',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#d9775740',
    'editor.inactiveSelectionBackground': '#d9775722',
    'editor.selectionHighlightBackground': '#d977571f',
    'editor.wordHighlightBackground': '#d977571f',
    'editor.wordHighlightStrongBackground': '#d9775733',
    'editorCursor.foreground': '#d97757',
    'editorCursor.background': '#151515',
    'editorLineNumber.foreground': '#666561',
    'editorLineNumber.activeForeground': '#f9f9f7',
    'editorIndentGuide.background': '#2a2a29',
    'editorIndentGuide.background1': '#2a2a29',
    'editorIndentGuide.activeBackground': '#353533',
    'editorIndentGuide.activeBackground1': '#353533',
    'editorWhitespace.foreground': '#2a2a29',
    'editorBracketMatch.background': '#d9775724',
    'editorBracketMatch.border': '#d9775766',
    'editor.findMatchBackground': '#e2a64f40',
    'editor.findMatchHighlightBackground': '#e2a64f20',
    'editorOverviewRuler.border': '#00000000',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#35353380',
    'scrollbarSlider.hoverBackground': '#353533cc',
    'scrollbarSlider.activeBackground': '#a6a5a066',
    'editorWidget.background': '#20201f',
    'editorWidget.foreground': '#f9f9f7',
    'editorWidget.border': '#2a2a29',
    'editorSuggestWidget.background': '#20201f',
    'editorSuggestWidget.border': '#2a2a29',
    'editorSuggestWidget.foreground': '#f9f9f7',
    'editorSuggestWidget.selectedBackground': '#2c2c2a',
    'editorSuggestWidget.highlightForeground': '#d97757',
    'editorHoverWidget.background': '#20201f',
    'editorHoverWidget.border': '#2a2a29',
    'input.background': '#111111',
    'input.border': '#353533',
    'input.foreground': '#f9f9f7',
    'focusBorder': '#d97757',
    'editorError.foreground': '#e5675a',
    'editorWarning.foreground': '#e2a64f',
    'editorInfo.foreground': '#6fa8f5',
  },
});

monaco.editor.defineTheme('kocamind-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '131313' },
    { token: 'comment', foreground: '7c7b76', fontStyle: 'italic' },
    { token: 'delimiter', foreground: '666561' },
    { token: 'delimiter.bracket', foreground: '5e5d59' },
    { token: 'operator', foreground: '5e5d59' },

    // Anahtar kelimeler: sıcak kiremit
    { token: 'keyword', foreground: 'b5532f' },
    { token: 'keyword.control', foreground: 'b5532f' },
    { token: 'storage', foreground: 'b5532f' },
    { token: 'storage.type', foreground: 'a0482a' },

    // Dizgeler: sakin yeşil
    { token: 'string', foreground: '3b7d4f' },
    { token: 'string.regexp', foreground: '3b7d4f' },
    { token: 'string.escape', foreground: 'a8670f' },

    // Sayılar ve sabitler: sıcak kehribar
    { token: 'number', foreground: 'a8670f' },
    { token: 'constant', foreground: 'a8670f' },
    { token: 'constant.language', foreground: 'a8670f' },

    // Fonksiyonlar, tipler ve etiketler
    { token: 'entity.name.function', foreground: '2c6bd1' },
    { token: 'support.function', foreground: '2c6bd1' },
    { token: 'type', foreground: '8f5319' },
    { token: 'type.identifier', foreground: '8f5319' },
    { token: 'entity.name.type', foreground: '8f5319' },
    { token: 'tag', foreground: 'b5532f' },
    { token: 'attribute.name', foreground: '7a4b2a' },
    { token: 'attribute.value', foreground: '3b7d4f' },

    { token: 'variable', foreground: '131313' },
    { token: 'identifier', foreground: '131313' },
    { token: 'property', foreground: '3d3c38' },

    { token: 'invalid', foreground: 'c2412d' },
  ],
  colors: {
    'editor.background': '#f9f9f7',
    'editor.foreground': '#131313',
    'editorGutter.background': '#f9f9f7',
    'editor.lineHighlightBackground': '#f0efec',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#b5532f38',
    'editor.inactiveSelectionBackground': '#b5532f1f',
    'editor.selectionHighlightBackground': '#b5532f1a',
    'editor.wordHighlightBackground': '#b5532f1a',
    'editor.wordHighlightStrongBackground': '#b5532f29',
    'editorCursor.foreground': '#b5532f',
    'editorCursor.background': '#f9f9f7',
    'editorLineNumber.foreground': '#95948f',
    'editorLineNumber.activeForeground': '#131313',
    'editorIndentGuide.background': '#e2e1dc',
    'editorIndentGuide.background1': '#e2e1dc',
    'editorIndentGuide.activeBackground': '#cfcec8',
    'editorIndentGuide.activeBackground1': '#cfcec8',
    'editorWhitespace.foreground': '#e2e1dc',
    'editorBracketMatch.background': '#b5532f20',
    'editorBracketMatch.border': '#b5532f66',
    'editor.findMatchBackground': '#a8670f33',
    'editor.findMatchHighlightBackground': '#a8670f1a',
    'editorOverviewRuler.border': '#00000000',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#cfcec880',
    'scrollbarSlider.hoverBackground': '#cfcec8cc',
    'scrollbarSlider.activeBackground': '#66656166',
    'editorWidget.background': '#ffffff',
    'editorWidget.foreground': '#131313',
    'editorWidget.border': '#e2e1dc',
    'editorSuggestWidget.background': '#ffffff',
    'editorSuggestWidget.border': '#e2e1dc',
    'editorSuggestWidget.foreground': '#131313',
    'editorSuggestWidget.selectedBackground': '#e7e6e1',
    'editorSuggestWidget.highlightForeground': '#b5532f',
    'editorHoverWidget.background': '#ffffff',
    'editorHoverWidget.border': '#e2e1dc',
    'input.background': '#ffffff',
    'input.border': '#cfcec8',
    'input.foreground': '#131313',
    'focusBorder': '#b5532f',
    'editorError.foreground': '#c2412d',
    'editorWarning.foreground': '#a8670f',
    'editorInfo.foreground': '#2c6bd1',
  },
});

loader.config({ monaco });
