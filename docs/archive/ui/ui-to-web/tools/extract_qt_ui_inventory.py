from __future__ import annotations

import ast
import json
from pathlib import Path

ROOT = Path('src/automataii/presentation/qt')
OUT = Path('ui-to-web/inventory')
OUT.mkdir(parents=True, exist_ok=True)

UI_CLASS_BASES = {
    'QWidget','QDialog','QMainWindow','QGraphicsView','QGraphicsScene','QGroupBox','QTabWidget',
    'QFrame','QScrollArea','QDockWidget','QToolBar','QMenuBar','QMenu','QListWidget','QTreeWidget',
    'QTableWidget','QLabel','QPushButton','QToolButton','QCheckBox','QRadioButton','QComboBox',
}
UI_CALLS = {
    'QPushButton','QToolButton','QAction','QMenu','QCheckBox','QRadioButton','QComboBox','QSpinBox',
    'QDoubleSpinBox','QSlider','QLineEdit','QLabel','QTabWidget','QGraphicsView','QGroupBox',
    'QDialogButtonBox','QListWidget','QTreeWidget','QTableWidget','QTextEdit','QPlainTextEdit',
    'QProgressBar','QStatusBar','QToolBar','QMenuBar','QScrollArea','QFrame','QStackedWidget',
}

def name_of(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        p = name_of(node.value)
        return f'{p}.{node.attr}' if p else node.attr
    if isinstance(node, ast.Subscript):
        return name_of(node.value)
    if isinstance(node, ast.Call):
        return name_of(node.func)
    return ''

def literal(node: ast.AST):
    try:
        return ast.literal_eval(node)
    except Exception:
        return None

def stringish(node: ast.AST) -> str | None:
    val = literal(node)
    if isinstance(val, str):
        return val
    if isinstance(node, ast.JoinedStr):
        parts = []
        for v in node.values:
            if isinstance(v, ast.Constant) and isinstance(v.value, str):
                parts.append(v.value)
            else:
                parts.append('{...}')
        return ''.join(parts)
    return None

def first_string_arg(call: ast.Call) -> str | None:
    for arg in call.args:
        s = stringish(arg)
        if s is not None:
            return s
    for kw in call.keywords:
        if kw.arg in {'text','title','label'}:
            s = stringish(kw.value)
            if s is not None:
                return s
    return None

records = []
class_records = []
for path in sorted(ROOT.rglob('*.py')):
    if '__pycache__' in path.parts:
        continue
    text = path.read_text(encoding='utf-8')
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        records.append({'file': str(path), 'error': str(exc)})
        continue
    lines = text.splitlines()
    imports_qt = any('PyQt6' in line or 'PySide' in line for line in lines[:120])
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            bases = [name_of(b) for b in node.bases]
            is_ui = imports_qt or any(b.split('.')[-1] in UI_CLASS_BASES for b in bases)
            methods = [n.name for n in node.body if isinstance(n, ast.FunctionDef)]
            if is_ui:
                class_records.append({
                    'file': str(path), 'line': node.lineno, 'class': node.name, 'bases': bases,
                    'methods': methods[:80],
                })
        elif isinstance(node, ast.Call):
            fn = name_of(node.func)
            short = fn.split('.')[-1]
            if short in UI_CALLS or short in {'addTab','addAction','addMenu','setWindowTitle','setObjectName','setToolTip','setStatusTip','setPlaceholderText','setText','addItem','addItems','setHeaderLabels','setHorizontalHeaderLabels'}:
                rec = {'file': str(path), 'line': getattr(node, 'lineno', None), 'call': fn}
                s = first_string_arg(node)
                if s is not None:
                    rec['text'] = s
                if short == 'addTab' and len(node.args) >= 2:
                    rec['tab_text'] = stringish(node.args[1])
                if short == 'addItems' and node.args:
                    val = literal(node.args[0])
                    if isinstance(val, list):
                        rec['items'] = [x for x in val if isinstance(x, str)]
                records.append(rec)

summary = {
    'source_root': str(ROOT),
    'file_count': sum(1 for _ in ROOT.rglob('*.py')),
    'ui_class_count': len(class_records),
    'ui_call_count': len(records),
    'classes_by_file': {},
}
for c in class_records:
    summary['classes_by_file'].setdefault(c['file'], []).append(c)

(OUT/'qt_ui_inventory.json').write_text(json.dumps({'summary': summary, 'classes': class_records, 'calls': records}, ensure_ascii=False, indent=2), encoding='utf-8')

# Markdown class and call inventory
md = ['# Qt UI Inventory\n', '', f'- Source root: `{ROOT}`', f'- Python files scanned: {summary["file_count"]}', f'- UI-ish classes: {len(class_records)}', f'- UI constructor/property calls: {len(records)}', '']
by_file = {}
for c in class_records:
    by_file.setdefault(c['file'], {'classes': [], 'calls': []})['classes'].append(c)
for r in records:
    by_file.setdefault(r['file'], {'classes': [], 'calls': []})['calls'].append(r)
for f in sorted(by_file):
    md.append(f'## `{f}`')
    if by_file[f]['classes']:
        md.append('')
        md.append('Classes:')
        for c in by_file[f]['classes']:
            bases = ', '.join(c['bases']) if c['bases'] else 'object'
            md.append(f'- L{c["line"]}: `{c["class"]}({bases})`')
    ui_calls = [r for r in by_file[f]['calls'] if r.get('text') or r['call'].split('.')[-1] in {'addTab','QPushButton','QToolButton','QAction','QMenu','QCheckBox','QRadioButton','QComboBox','QGroupBox','setWindowTitle','setToolTip','setStatusTip','setPlaceholderText','addItem','addItems'}]
    if ui_calls:
        md.append('')
        md.append('User-visible controls/text:')
        for r in ui_calls[:120]:
            text = r.get('tab_text') or r.get('text') or (', '.join(r.get('items', [])) if r.get('items') else '')
            text = text.replace('\n',' / ') if text else ''
            md.append(f'- L{r.get("line")}: `{r["call"]}`' + (f' → “{text}”' if text else ''))
        if len(ui_calls) > 120:
            md.append(f'- … {len(ui_calls)-120} more calls in JSON')
    md.append('')
(OUT/'qt_ui_inventory.md').write_text('\n'.join(md), encoding='utf-8')

# Source file index with rough category
cats = []
for p in sorted(ROOT.rglob('*.py')):
    rel = str(p)
    part = 'misc'
    if '/tabs/' in rel:
        part = 'tab'
    if '/dialogs/' in rel:
        part = 'dialog'
    if '/views/' in rel:
        part = 'canvas/view'
    if '/widgets/' in rel:
        part = 'widget'
    if '/graphics_items/' in rel:
        part = 'graphics item'
    if rel.endswith('main_window.py'):
        part = 'main window'
    cats.append((part, rel))
lines=['# UI Source File Index\n']
for part, rel in cats:
    lines.append(f'- `{rel}` — {part}')
(OUT/'source-files.md').write_text('\n'.join(lines), encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False, indent=2)[:4000])
