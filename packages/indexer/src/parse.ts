import { createRequire } from 'node:module';
import { Language, Parser, type Node } from 'web-tree-sitter';
import type { SourceFile, SourceLanguage } from './walk';

export type CallFact = { callee: string; line: number; args: (string | null)[]; options: Record<string, string>; isNew: boolean; decorator: boolean };
export type SymbolFact = { name: string; kind: 'function' | 'class'; line: number };
export type FileFacts = { path: string; language: SourceLanguage; loc: number; imports: string[]; symbols: SymbolFact[]; calls: CallFact[]; envKeys: string[] };

const require = createRequire(import.meta.url);
const GRAMMAR: Record<SourceLanguage, string> = {
  typescript: 'tree-sitter-typescript.wasm', tsx: 'tree-sitter-tsx.wasm', javascript: 'tree-sitter-javascript.wasm', python: 'tree-sitter-python.wasm',
};
const STRING_TYPES = new Set(['string', 'template_string']);
const QUOTED = /^[a-zA-Z]*("""|'''|"|'|`)([\s\S]*)\1$/;
const TEMPLATE_SUBSTITUTION = /\$\{[^}]*\}/g;
const PROCESS_ENV = /^process\.env\.([A-Za-z_][A-Za-z0-9_]*)$/;
const PY_ENV_CALLEES = new Set(['os.getenv', 'os.environ.get']);
const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'function']);

let ready: Promise<void> | null = null;
const parsers = new Map<SourceLanguage, Promise<Parser>>();

const parserFor = (language: SourceLanguage): Promise<Parser> => {
  const cached = parsers.get(language);
  if (cached) return cached;
  const created = (ready ??= Parser.init()).then(async () => {
    const parser = new Parser();
    parser.setLanguage(await Language.load(require.resolve(`tree-sitter-wasms/out/${GRAMMAR[language]}`)));
    return parser;
  });
  parsers.set(language, created);
  return created;
};

export const literalValue = (text: string, type: string): string | null => {
  if (!STRING_TYPES.has(type)) return null;
  const normalized = type === 'template_string' ? text.replace(TEMPLATE_SUBSTITUTION, '${}') : text;
  return QUOTED.exec(normalized)?.[2] ?? null;
};

const valueOf = (node: Node | null | undefined): string | null => (node ? literalValue(node.text, node.type) : null);
const children = (node: Node | null | undefined): Node[] => (node ? node.namedChildren.filter((c): c is Node => c !== null) : []);
const lineOf = (node: Node) => node.startPosition.row + 1;
const compact = (text: string) => text.replace(/\s+/g, '');

const walk = (node: Node, visit: (n: Node) => void) => {
  visit(node);
  for (const child of children(node)) walk(child, visit);
};

const keyText = (node: Node | null): string | null => {
  if (!node) return null;
  return valueOf(node) ?? node.text;
};

const argumentsOf = (argsNode: Node | null) => {
  const args: (string | null)[] = [];
  const options: Record<string, string> = {};
  for (const arg of children(argsNode)) {
    if (arg.type === 'object') {
      args.push(null);
      for (const pair of children(arg).filter((p) => p.type === 'pair')) {
        const key = keyText(pair.childForFieldName('key'));
        const value = valueOf(pair.childForFieldName('value'));
        if (key && value !== null) options[key] = value;
      }
      continue;
    }
    if (arg.type === 'keyword_argument') {
      const value = valueOf(arg.childForFieldName('value'));
      const name = arg.childForFieldName('name')?.text;
      if (name && value !== null) options[name] = value;
      continue;
    }
    args.push(valueOf(arg));
  }
  return { args, options };
};

const collectScript = (root: Node, facts: FileFacts) => {
  walk(root, (node) => {
    switch (node.type) {
      case 'import_statement': {
        const source = valueOf(node.childForFieldName('source'));
        if (source) facts.imports.push(source);
        break;
      }
      case 'call_expression': {
        const fn = node.childForFieldName('function');
        if (!fn) break;
        const { args, options } = argumentsOf(node.childForFieldName('arguments'));
        const callee = compact(fn.text);
        if (callee === 'require' && args[0]) facts.imports.push(args[0]);
        facts.calls.push({ callee, line: lineOf(node), args, options, isNew: false, decorator: false });
        break;
      }
      case 'new_expression': {
        const ctor = node.childForFieldName('constructor');
        if (!ctor) break;
        const { args, options } = argumentsOf(node.childForFieldName('arguments'));
        facts.calls.push({ callee: compact(ctor.text), line: lineOf(node), args, options, isNew: true, decorator: false });
        break;
      }
      case 'member_expression': {
        const key = PROCESS_ENV.exec(compact(node.text))?.[1];
        if (key && !facts.envKeys.includes(key)) facts.envKeys.push(key);
        break;
      }
      case 'function_declaration':
      case 'class_declaration': {
        const name = node.childForFieldName('name')?.text;
        if (name) facts.symbols.push({ name, kind: node.type === 'class_declaration' ? 'class' : 'function', line: lineOf(node) });
        break;
      }
      case 'variable_declarator': {
        const value = node.childForFieldName('value');
        const name = node.childForFieldName('name')?.text;
        if (name && value && FUNCTION_VALUES.has(value.type)) facts.symbols.push({ name, kind: 'function', line: lineOf(node) });
        break;
      }
    }
  });
};

const collectPython = (root: Node, facts: FileFacts) => {
  const addEnv = (key: string | null) => {
    if (key && !facts.envKeys.includes(key)) facts.envKeys.push(key);
  };
  walk(root, (node) => {
    switch (node.type) {
      case 'import_statement':
        for (const name of children(node).filter((c) => c.type === 'dotted_name' || c.type === 'aliased_import')) {
          facts.imports.push((name.type === 'aliased_import' ? name.childForFieldName('name')?.text : name.text) ?? name.text);
        }
        break;
      case 'import_from_statement': {
        const module = node.childForFieldName('module_name')?.text;
        if (module) facts.imports.push(module);
        break;
      }
      case 'call': {
        const fn = node.childForFieldName('function');
        if (!fn) break;
        const { args, options } = argumentsOf(node.childForFieldName('arguments'));
        const callee = compact(fn.text);
        if (PY_ENV_CALLEES.has(callee)) addEnv(args[0] ?? null);
        facts.calls.push({ callee, line: lineOf(node), args, options, isNew: false, decorator: node.parent?.type === 'decorator' });
        break;
      }
      case 'subscript': {
        if (compact(node.childForFieldName('value')?.text ?? '') === 'os.environ') addEnv(valueOf(node.childForFieldName('subscript')));
        break;
      }
      case 'function_definition':
      case 'class_definition': {
        const name = node.childForFieldName('name')?.text;
        if (name) facts.symbols.push({ name, kind: node.type === 'class_definition' ? 'class' : 'function', line: lineOf(node) });
        break;
      }
    }
  });
};

export const parseFile = async (file: SourceFile): Promise<FileFacts> => {
  const facts: FileFacts = { path: file.path, language: file.language, loc: file.loc, imports: [], symbols: [], calls: [], envKeys: [] };
  const tree = (await parserFor(file.language)).parse(file.content);
  if (!tree) return facts;
  try {
    if (file.language === 'python') collectPython(tree.rootNode, facts);
    else collectScript(tree.rootNode, facts);
  } finally {
    tree.delete();
  }
  return facts;
};

export const parseRepository = async (files: SourceFile[]): Promise<FileFacts[]> => {
  const result: FileFacts[] = [];
  for (const file of files) result.push(await parseFile(file));
  return result;
};
