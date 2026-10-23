"""Refresh bundled character substat weights from the public DPR Calc Results charts."""

import json
import math
import posixpath
import re
from collections import defaultdict
from io import BytesIO
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen
from xml.etree import ElementTree as ET
from zipfile import ZipFile


SOURCE = 'https://docs.google.com/spreadsheets/d/1eoCTrwYIsRpacvL3KrcQpR5rwY3pbJ6gEljZdBj_DHs/export?format=xlsx'
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'src/game-data/character-substat-preferences.generated.ts'
N = {
    'm': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'c': 'http://schemas.openxmlformats.org/drawingml/2006/chart',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
STATS = {
    'ATK%': 'atkPercent', 'Flat ATK': 'atk', 'DEF%': 'defPercent',
    'Flat DEF': 'def', 'HP%': 'hpPercent', 'Flat HP': 'hp',
    'ER': 'energyRegen', 'Skill DMG%': 'skillDamage',
    'Lib DMG%': 'liberationDamage', 'BA DMG%': 'basicDamage',
    'Heavy DMG%': 'heavyDamage', 'CR': 'critRate', 'CD': 'critDamage',
}
ALIASES = {
    'Xuanling': 'Yangyang: Xuanling', 'XLY': 'Xiangli Yao',
    'Luuk': 'Luuk Herssen', 'Ciaconna': 'Ciaccona',
    'Qiuyuan 2x Forte': 'Qiuyuan', 'Qiuyuan MDPS': 'Qiuyuan',
    'Iuno MDPS': 'Iuno',
}
RANGE = re.compile(r"^(?:'((?:[^']|'')+)'|([^!]+))!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)$")


def cells_for(zipped, path, strings):
    cells = {}
    for cell in ET.fromstring(zipped.read(path)).findall('.//m:c', N):
        value = cell.find('m:v', N)
        if value is None:
            continue
        cells[cell.attrib['r']] = strings[int(value.text)] if cell.get('t') == 's' else value.text
    return cells


def chart_range(formula):
    match = RANGE.fullmatch(formula or '')
    if not match or match[3] != match[5]:
        raise ValueError(f'Unsupported chart range: {formula}')
    return (match[1] or match[2]).replace("''", "'"), match[3], range(int(match[4]), int(match[6]) + 1)


def main():
    try:
        with urlopen(SOURCE, timeout=60) as response:
            downloaded = response.read(25_000_001)
    except (URLError, TimeoutError) as error:
        if not OUTPUT.exists():
            raise
        print(f'Source unavailable; keeping bundled substat priorities: {error}')
        return
    if len(downloaded) > 25_000_000:
        raise ValueError('Source workbook exceeds 25 MB')
    workbook = BytesIO(downloaded)
    with ZipFile(workbook) as zipped:
        if sum(item.file_size for item in zipped.infolist()) > 100_000_000:
            raise ValueError('Expanded source workbook exceeds 100 MB')
        strings_xml = ET.fromstring(zipped.read('xl/sharedStrings.xml'))
        strings = [''.join(part.text or '' for part in item.findall('.//m:t', N))
                   for item in strings_xml.findall('m:si', N)]
        relationships = ET.fromstring(zipped.read('xl/_rels/workbook.xml.rels'))
        paths = {row.attrib['Id']: posixpath.normpath(posixpath.join('xl', row.attrib['Target'].lstrip('/')))
                 for row in relationships}
        workbook_xml = ET.fromstring(zipped.read('xl/workbook.xml'))
        sheets = {row.attrib['name']: paths[row.attrib[REL]]
                  for row in workbook_xml.findall('m:sheets/m:sheet', N)}
        roster_text = (ROOT / 'src/game-data/character-summaries.generated.ts').read_text(encoding='utf-8')
        roster = set(re.findall(r'^\s+"name": "([^"]+)",?$', roster_text, re.M))
        sheet_cells = {}
        graphs = defaultdict(list)
        skipped = []
        chart_count = 0

        for path in sorted(zipped.namelist()):
            if not re.fullmatch(r'xl/charts/chart\d+\.xml', path):
                continue
            chart = ET.fromstring(zipped.read(path))
            title = ''.join(part.text or '' for part in chart.findall('.//c:title//a:t', N))
            if 'Substat Value' not in title:
                continue
            chart_count += 1
            series = chart.find('.//c:barChart/c:ser', N)
            if series is None:
                raise ValueError(f'{path}: missing bar-chart data')
            category = chart_range(series.findtext('.//c:cat//c:f', namespaces=N))
            value = chart_range(series.findtext('.//c:val//c:f', namespaces=N))
            if category[0] != value[0] or len(category[2]) != len(value[2]):
                raise ValueError(f'{path}: mismatched category and value ranges')
            sheet = category[0]
            base = re.sub(r'\s*\(.*\)$', '', sheet)
            character = ALIASES.get(base, base)
            if character not in roster:
                skipped.append(f'{sheet}: character absent from roster')
                continue
            title_alias = 'Xuangling' if base == 'Xuanling' else 'Cartethiya' if base == 'Cartethyia' else base.split(' ')[0]
            if not title.lower().startswith(title_alias.lower()):
                skipped.append(f'{sheet}: chart title names another character')
                continue
            if sheet not in sheet_cells:
                sheet_cells[sheet] = cells_for(zipped, sheets[sheet], strings)
            cells = sheet_cells[sheet]
            measurements = {}
            for category_row, value_row in zip(category[2], value[2]):
                label = cells.get(f'{category[1]}{category_row}')
                raw = cells.get(f'{value[1]}{value_row}')
                if not str(label or '').strip() and not str(raw or '').strip():
                    continue
                if label not in STATS or raw is None:
                    raise ValueError(f'{path}: missing or unknown substat at row {category_row}: {label}')
                number = float(raw)
                if not math.isfinite(number) or number < 0 or STATS[label] in measurements:
                    raise ValueError(f'{path}: invalid or duplicate value for {label}')
                measurements[STATS[label]] = number
            if len(measurements) != len(STATS):
                raise ValueError(f'{path}: incomplete substat chart')
            peak = max(measurements.values())
            if peak <= 0:
                raise ValueError(f'{path}: chart has no positive values')
            graphs[character].append({key: value / peak * 4 for key, value in measurements.items()})

    if chart_count < 39 or len(graphs) < 30 or 'Suoming' not in graphs:
        raise ValueError(f'Incomplete source: {chart_count} charts, {len(graphs)} characters')
    result = {}
    for character, character_graphs in sorted(graphs.items()):
        weights = {}
        for stat in STATS.values():
            average = sum(graph.get(stat, 0) for graph in character_graphs) / len(character_graphs)
            weight = min(4, math.floor(average * 2 + 0.5) / 2)
            if weight:
                weights[stat] = weight
        result[character] = {'weights': weights}
    content = (f'// Generated by scripts/sync-character-substats.py from {SOURCE}. Do not edit.\n'
               f'export const sheetCharacterSubstatPreferences = {json.dumps(result, indent=2, ensure_ascii=False)} as const\n')
    if not OUTPUT.exists() or OUTPUT.read_text(encoding='utf-8') != content:
        OUTPUT.write_text(content, encoding='utf-8')
    print(f'Synced {len(result)} characters from {chart_count} charts; skipped: {skipped}')


if __name__ == '__main__':
    main()
