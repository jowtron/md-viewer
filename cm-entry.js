// Entry point for the CodeMirror bundle. Built into src/codemirror.bundle.js
// via `npm run build:cm` (see package.json). The bundle is vendored — re-run
// the build only when this file or its dependencies change.

import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { search, searchKeymap, openSearchPanel, closeSearchPanel } from "@codemirror/search";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";

window.CM = {
  EditorState,
  EditorView,
  Compartment,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  markdown,
  search,
  searchKeymap,
  openSearchPanel,
  closeSearchPanel,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
};
