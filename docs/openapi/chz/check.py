import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zipfile import ZipFile

from openapi_spec_validator import validate
from pypdf import PdfReader


HTTP_METHODS = {'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'}


def read_json(path):
    return json.loads(path.read_text())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check(root, archive_path):
    docs = root / 'docs'
    sources = docs / 'chz/sources'
    specs = docs / 'openapi/chz'
    manifest = read_json(sources / 'index.json')
    coverage = read_json(specs / 'coverage.json')
    index = read_json(sources / 'section-index.json')
    indexed_documents = {document['id']: document for document in index['documents']}
    documents = {}
    for document in manifest['documents']:
        path = sources / document['file']
        content = path.read_bytes()
        require(hashlib.sha256(content).hexdigest() == document['sha256'], f'PDF checksum mismatch: {path}')
        require(len(content) == document['bytes'], f'PDF size mismatch: {path}')
        page_count = len(PdfReader(path).pages)
        require(page_count == document['pages'], f'PDF page count mismatch: {path}')
        require([page['page'] for page in indexed_documents[document['id']]['pages']] == list(range(1, page_count + 1)), f'Missing indexed pages: {path}')
        documents[document['id']] = document
    require(sum(document['pages'] for document in documents.values()) == manifest['totalPages'], 'Page total mismatch')
    require(len(documents) == 6 and manifest['totalPages'] == 1881, 'Unexpected archive inventory')
    if archive_path:
        require(hashlib.sha256(archive_path.read_bytes()).hexdigest() == manifest['archiveSha256'], 'ZIP checksum mismatch')
        with ZipFile(archive_path) as archive:
            entries = [entry for entry in archive.infolist() if entry.filename.lower().endswith('.pdf') and not entry.is_dir()]
            archived_hashes = sorted(hashlib.sha256(archive.read(entry)).hexdigest() for entry in entries)
            require(archived_hashes == sorted(document['sha256'] for document in documents.values()), 'ZIP/PDF inventory mismatch')
    operations = {}
    all_ids = set()
    typed_count = 0
    for system, expected in coverage['specifications'].items():
        path = specs / expected['file']
        spec = read_json(path)
        validate(spec)
        require(spec['servers'][0]['url'] == 'https://example.invalid', f'Unsafe default host: {path}')
        count = 0
        typed = 0
        for route, item in spec['paths'].items():
            for method, operation in item.items():
                if method not in HTTP_METHODS:
                    continue
                count += 1
                identifier = operation['operationId']
                require(identifier not in all_ids, f'Duplicate operationId: {identifier}')
                all_ids.add(identifier)
                placeholders = set(re.findall(r'\{([^}]+)\}', route))
                actual = {entry['name'] for entry in operation.get('parameters', []) if entry['in'] == 'path' and entry.get('required')}
                require(actual == placeholders, f'Path parameters mismatch: {identifier}')
                require(operation['x-contract-level'] in ['source-documentation', 'typed-subset'], f'Unmarked schema level: {identifier}')
                require(operation['x-live-verified'] is False, f'Unsupported live-verification claim: {identifier}')
                typed += operation['x-contract-level'] == 'typed-subset'
                for source in operation['x-source']:
                    lower, upper = source['pages']
                    require(1 <= lower <= source['declarationPage'] <= upper <= documents[source['document']]['pages'], f'Invalid PDF location: {identifier}')
                operations[(system, method, route)] = operation
        require(count == expected['operations'] and typed == expected['typedSubsets'] and len(spec['paths']) == expected['paths'], f'Coverage summary mismatch: {path}')
        typed_count += typed
    for declaration in coverage['declarations']:
        key = (declaration['system'], declaration['method'], declaration['path'])
        require(key in operations, f'Missing operation: {key}')
        source_locations = {(source['document'], source['declarationPage']) for source in operations[key]['x-source']}
        is_overview = declaration['source'] == 'true-api' and declaration['declarationPage'] in [10, 11]
        require(is_overview or (declaration['source'], declaration['declarationPage']) in source_locations, f'Missing method provenance: {key}')
    for legacy in coverage['deprecatedRoutes']:
        operation = operations[('true-api-deprecated', legacy['method'], legacy['path'])]
        require(operation['deprecated'] is True and operation['x-replacement'] == legacy['replacement'], 'Deprecated route lost replacement')
    suz = read_json(specs / 'suz.openapi.json')
    suz_sections = {source['section'] for item in suz['paths'].values() for operation in item.values() for source in operation['x-source']}
    require({f'4.4.{number}' for number in range(1, 30)} <= suz_sections, 'A SUZ core method is missing')
    true_api = read_json(specs / 'true-api.openapi.json')
    tasks = true_api['paths']['/api/v3/true-api/dispenser/tasks']['post']
    require(len(tasks['x-source']) == 30, 'A report task variant is missing')
    require(len(true_api['x-document-payloads']) == 20, 'A document payload section is missing')
    broken_links = []
    markdown = [docs / 'openapi/chz/README.md', *sorted((docs / 'chz').glob('*.md'))]
    for path in markdown:
        for target in re.findall(r'(?<!!)\[[^\]]*\]\(([^)]+)\)', path.read_text()):
            parsed = urlsplit(target)
            if parsed.scheme or not parsed.path:
                continue
            destination = (path.parent / unquote(parsed.path)).resolve()
            if not destination.exists():
                broken_links.append(f'{path.relative_to(root)}: {target}')
    require(not broken_links, 'Broken local links: ' + '; '.join(broken_links))
    print(json.dumps({'validSpecifications': len(coverage['specifications']), 'operationsIncludingDeprecated': len(operations), 'typedSubsets': typed_count, 'sourceDeclarations': len(coverage['declarations']), 'documents': len(documents), 'pages': manifest['totalPages'], 'checkedMarkdownFiles': len(markdown), 'archiveVerified': bool(archive_path)}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('--archive', type=Path)
    arguments = parser.parse_args()
    check(arguments.root.resolve(), arguments.archive)
