import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile

from pypdf import PdfReader


DOCUMENT_IDS = [
    'suz-api-3.0.40', 'dynamic-client-token', 'gismt-api-getting-started',
    'true-api-deprecations', 'national-catalog-api', 'true-api',
]
VERSIONS = {
    'suz-api-3.0.40': 'API 3.0.40; guide 5.03, revision 67, 2026-09-24',
    'dynamic-client-token': 'Snapshot supplied by user; no independent version asserted',
    'gismt-api-getting-started': '39.0, 2026-08-04',
    'true-api-deprecations': 'Snapshot supplied by user; no independent version asserted',
    'national-catalog-api': '5.68, 2026-09-28',
    'true-api': '747.0, 2026-10-21',
}
ARCHIVE_SHA256 = '0d19ecd81e048088514ca83619c3e988790313901776f6f86639f02c47532032'
HTTP_METHOD = r'(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)'
HEADING = re.compile(r'^(\d+(?:\.\d+){1,6})\.?\s+([^\n]{5,})')


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def normalize_path(path, system):
    path = re.sub(r'<url[^>]*>', '', path, flags=re.I).strip()
    path = path.replace('<version>', 'api/{version}')
    path = re.sub(r'\s+', '', path.split('?')[0])
    if not path.startswith('/'):
        path = '/' + path
    if system == 'true-api' and not path.startswith('/api/'):
        path = '/api/v3/true-api' + path
    path = path.replace('{id_документа}', '{documentId}').replace('{типквитанции}', '{eventType}')
    if '/elk/' in path or '/edo/' in path:
        path = re.sub(r'\{(?:id|doc_id|edoDocumentId)\}', '{documentId}', path)
        path = path.replace('{event_id}', '{eventId}')
    return path


def sanitize(text):
    text = re.sub(r'(?im)^.*(?:curl -|clientToken\s*:|X-RegistrationKey\s*:|client_secret|password\s*["=:]).*$', '[credential/request example omitted]', text)
    text = re.sub(r'(?<![A-Za-z])01\d{14}21[^\s"<>]{5,}', '[marking example omitted]', text)
    text = re.sub(r'(?<![\w/])[A-Za-z0-9_+/=\-]{80,}(?![\w/])', '[long example omitted]', text)
    return text.replace('```', "'''")


def load_document(path, identifier, cache):
    cached = cache / identifier / 'pages.json' if cache else None
    if cached and cached.exists():
        raw = json.loads(cached.read_text())
        pages = [page if isinstance(page, str) else page['text'] for page in raw]
    else:
        pages = [page.extract_text() or '' for page in PdfReader(path).pages]
    records = []
    headings = []
    for page_number, page in enumerate(pages, 1):
        for line in page.splitlines():
            position = len(records)
            records.append({'page': page_number, 'text': line})
            match = HEADING.match(line)
            sidebar_heading = identifier == 'true-api' and 19 <= page_number <= 28 and any(heading['page'] == page_number for heading in headings)
            if match and '...' not in line and not sidebar_heading and (match[2][0].isupper() or match[2].startswith('(')):
                headings.append({'line': position, 'page': page_number, 'section': match[1], 'title': match[2].strip()})
    return {'id': identifier, 'path': path, 'pages': pages, 'lines': records, 'headings': headings}


def source_section(document, position):
    headings = [heading for heading in document['headings'] if heading['line'] <= position]
    heading = headings[-1] if headings else {'line': position, 'page': document['lines'][position]['page'], 'section': '', 'title': ''}
    depth = heading['section'].count('.')
    following = next((candidate['line'] for candidate in document['headings'] if candidate['line'] > position and candidate['section'].count('.') <= depth), len(document['lines']))
    return heading, following


def extract_operations(document):
    records = document['lines']
    declarations = []
    if document['id'] in ['true-api', 'national-catalog-api', 'dynamic-client-token']:
        positions = [index for index, record in enumerate(records) if re.match(r'^URL\s*:', record['text'])]
        for sequence, position in enumerate(positions):
            end = positions[sequence + 1] if sequence + 1 < len(positions) else len(records)
            nearby = records[position:min(end, position + 110)]
            method_record = next((record for record in nearby if re.match(r'^\*?Метод\s*:\s*\*?' + HTTP_METHOD, record['text'])), None)
            if not method_record and document['id'] == 'true-api' and records[position]['page'] == 373:
                method = 'GET'
                url_lines = [records[position]['text']]
            else:
                if not method_record:
                    raise ValueError(f'Missing method: {document["id"]} p{records[position]["page"]}')
                method = re.search(HTTP_METHOD, method_record['text'])[1]
                url_lines = [record['text'] for record in nearby[:nearby.index(method_record)]]
            raw_urls = []
            for line in url_lines:
                match = re.search(r'((?:<url[^>]*>)?/(?:api|v[234]|elk|auth|nk|lk|participants|cises|product|doc|receipt|documents|agreement-registry|warehouse|dispenser)[^\n]*)', line, re.I)
                if not match:
                    match = re.search(r'\b((?:v[234]/|agreement-registry/|dispenser/)[^\n]*)', line)
                if match and not line.startswith(('curl', '{', '<?')):
                    raw_urls.append(match[1].strip())
            if not raw_urls:
                raise ValueError(f'Missing URL: {document["id"]} p{records[position]["page"]}')
            heading, section_end = source_section(document, position)
            if document['id'] == 'dynamic-client-token':
                if records[position]['page'] == 11:
                    heading = {'line': next(index for index, record in enumerate(records) if record['page'] == 11), 'page': 11, 'section': '5', 'title': 'Запрос регистрации установки экземпляра интеграционного решения'}
                    section_end = next(index for index, record in enumerate(records) if record['page'] == 15)
                elif heading['section'].count('.') >= 2:
                    parent_section = heading['section'].rsplit('.', 1)[0]
                    parent = next((candidate for candidate in reversed(document['headings']) if candidate['line'] <= position and candidate['section'] == parent_section), None)
                    if parent:
                        heading, section_end = source_section(document, parent['line'])
            for raw_url in raw_urls:
                if document['id'] == 'dynamic-client-token' and '/auth/simpleSignIn/идентификатор' in raw_url:
                    raw_url = '<url стенда>/auth/simpleSignIn/{omsConnection}'
                declarations.append(make_declaration(document, position, section_end, heading, method, raw_url))
    elif document['id'] == 'suz-api-3.0.40':
        positions = [index for index, record in enumerate(records) if re.match(r'^URL\s', record['text'])]
        for position in positions:
            previous = '\n'.join(record['text'] for record in records[max(0, position - 6):position])
            matches = re.findall(r'HTTP\s+метод\s+' + HTTP_METHOD, previous, re.I)
            if not matches:
                raise ValueError(f'Missing SUZ method p{records[position]["page"]}')
            end = next((index for index in range(position + 1, min(len(records), position + 8)) if re.match(r'^(Параметры|Таблица|\d+(?:\.\d+)+\.)', records[index]['text'].strip())), position + 3)
            raw_url = ' '.join(record['text'] for record in records[position:end]).removeprefix('URL').strip()
            heading, section_end = source_section(document, position)
            if heading['title'].startswith('Запрос') and heading['section'].count('.') >= 3:
                parent_section = heading['section'].rsplit('.', 1)[0]
                parent = next((candidate for candidate in reversed(document['headings']) if candidate['line'] <= position and candidate['section'] == parent_section), None)
                if parent:
                    heading, section_end = source_section(document, parent['line'])
            section_number = heading['section']
            if section_number.count('.') > 2 and section_number.startswith('4.4.'):
                major_section = '.'.join(section_number.split('.')[:3])
                major = next(candidate for candidate in reversed(document['headings']) if candidate['line'] <= position and candidate['section'] == major_section)
                heading, section_end = source_section(document, major['line'])
            declarations.append(make_declaration(document, position, section_end, heading, matches[-1], raw_url))
    return declarations


def make_declaration(document, position, end, heading, method, raw_url):
    system = document['id']
    if system == 'dynamic-client-token':
        system = 'suz-registration-v2' if '/integration/connection' in raw_url else 'true-api'
    elif system == 'suz-api-3.0.40':
        if '/auth/key' in raw_url or '/auth/simpleSignIn' in raw_url:
            system = 'true-api'
        elif '<version>' in raw_url:
            system = 'mdlp-auth'
        else:
            system = 'suz'
    path = normalize_path(raw_url, system)
    query = re.findall(r'(?:\?|&)\s*([A-Za-z_][\w]*)\s*=', raw_url)
    start_page = heading['page']
    end_page = document['lines'][end - 1]['page'] if end > 0 else start_page
    return {
        'system': system, 'method': method.lower(), 'path': path, 'queryNames': query,
        'source': document['id'], 'declarationPage': document['lines'][position]['page'],
        'pages': [start_page, end_page], 'section': heading['section'], 'title': heading['title'],
        'text': '\n'.join(record['text'] for record in document['lines'][heading['line']:end]),
    }


def schema_object(properties=None, required=None):
    value = {'type': 'object', 'additionalProperties': True, 'properties': properties or {}}
    if required:
        value['required'] = required
    return value


def parameter(name, location='query', required=False, schema=None, description=None):
    return {'name': name, 'in': location, 'required': required, 'schema': schema or {'type': 'string'}, **({'description': description} if description else {})}


def set_body(operation, schema, description='Documented subset; consult source for conditional requirements.'):
    operation['requestBody'] = {'required': True, 'description': description, 'content': {'application/json': {'schema': schema}}}
    operation['x-contract-level'] = 'typed-subset'


def set_response(operation, schema, status='200'):
    operation['responses'][status] = {'description': 'Documented success response subset; HTTP success does not imply per-item/business success.', 'content': {'application/json': {'schema': schema}}}
    operation['x-contract-level'] = 'typed-subset'


def enrich(operation, system, method, path):
    string = {'type': 'string'}
    integer = {'type': 'integer'}
    gtin = {'type': 'string', 'description': 'Preserve leading zeros. Normalize only validated GTIN identifiers, never the raw DataMatrix.'}
    array_gtin = {'type': 'array', 'items': gtin}
    if system == 'national-catalog-api':
        operation['parameters'].append(parameter('format', schema={'type': 'string', 'enum': ['json', 'xml']}))
        if path in ['/v3/product', '/v3/feed-product', '/v3/short-product']:
            operation['parameters'] += [parameter(name, schema=gtin if name == 'gtin' else string) for name in ['gtin', 'good_id', 'gtins', 'good_ids']]
            operation['parameters'].append(parameter('cat_id', schema=integer))
            operation['x-constraints'] = ['Use a single selector or semicolon-delimited list selectors; do not mix single and list selectors.', 'Total selected IDs/GTINs in lists <=25. good_id takes precedence when both single selectors are supplied.']
            operation['parameters'].append(parameter('If-None-Match', 'header'))
            operation['responses']['304'] = {'description': 'Unchanged. Does not consume request quota.'}
            identifier = schema_object({'value': string, 'type': string, 'multiplier': integer, 'level': string})
            attribute = schema_object({name: integer if name in ['attr_id', 'attr_value_id', 'attr_group_id', 'value_id'] else string for name in ['attr_id', 'attr_name', 'attr_value_id', 'attr_value', 'attr_value_type', 'attr_group_id', 'attr_group_name', 'value_id']})
            card = schema_object({'good_id': integer, 'good_name': string, 'good_status': string, 'brand_id': integer, 'brand_name': string, 'identified_by': {'type': 'array', 'items': identifier}, 'good_attrs': {'type': 'array', 'items': attribute}, 'good_img': string, 'good_images': {'type': 'array', 'items': schema_object()}, 'categories': {'type': 'array', 'items': schema_object()}, 'create_date': string, 'update_date': string})
            set_response(operation, schema_object({'apiversion': integer, 'result': {'type': 'array', 'items': card}}))
        elif path == '/v3/attributes':
            operation['parameters'] += [parameter('cat_id', schema=integer), parameter('tnved'), parameter('is_set', schema={'type': 'boolean'}), parameter('attr_type', schema={'type': 'string', 'enum': ['a', 'b', 'm', 'r', 'o']})]
            operation['x-constraints'] = ['cat_id and tnved are mutually exclusive; attr_type requires cat_id, tnved or is_set.']
            operation['x-contract-level'] = 'typed-subset'
        elif path == '/v3/mark-check':
            set_body(operation, schema_object({'gtins': array_gtin, 'tnveds': {'type': 'array', 'items': string}}))
            operation['x-constraints'] = ['At least one list; total GTINs + TNVEDs <=100.']
        elif path == '/v4/rd-info-by-gtin':
            set_body(operation, schema_object({'gtin': gtin, 'inn': string}, ['gtin']))
    if system == 'true-api':
        if path.endswith('/auth/key'):
            operation['security'] = []
            operation['x-side-effects'] = 'authentication-challenge'
            set_response(operation, schema_object({'uuid': string, 'data': string}, ['uuid', 'data']))
        elif '/auth/simpleSignIn' in path:
            operation['security'] = []
            operation['x-side-effects'] = 'session-rotation'
            properties = {'uuid': string, 'data': {'type': 'string', 'description': 'Base64 attached CMS signature of challenge data; create with local authorized signer.'}}
            if not path.endswith('}'):
                properties.update({'inn': string, 'unitedToken': {'type': 'boolean'}})
            set_body(operation, schema_object(properties, ['uuid', 'data']))
            set_response(operation, schema_object({'token': string}))
        elif path.endswith('/product/info') and '/v4/' in path:
            set_body(operation, schema_object({'gtins': {**array_gtin, 'maxItems': 1000}, 'rdInfo': {'type': 'boolean'}}, ['gtins']))
            properties = {name: string for name in ['name', 'gtin', 'model', 'brand', 'fullName', 'type', 'size', 'color', 'textileType', 'structure', 'gender', 'country', 'productKind', 'productKindOther']}
            set_response(operation, schema_object({'results': {'type': 'array', 'items': schema_object(properties)}, 'total': integer}))
            operation['x-constraints'] = ['Only goods with goodTurnFlag=true and goodMarkFlag=true are returned. LP extension: True API pp831-832.']
        elif path.endswith(('/cises/info', '/cises/short/list', '/cises/aggregated/list')):
            set_body(operation, {'type': 'array', 'items': string, 'maxItems': 1000}, 'Bare array of identification codes, NOT {codes:[...]}. See source for code representation and group restrictions.')
        elif path.endswith('/cises/check'):
            set_body(operation, schema_object({'codes': {'type': 'array', 'items': string, 'maxItems': 1000}}, ['codes']))
            operation['x-constraints'] = ['Use full cryptographic codes; interval >=2 seconds. Do not log codes.']
        elif path.endswith('/doc/list') and '/v4/' in path:
            operation['parameters'] += [parameter('pg', required=True), parameter('limit', schema={'type': 'integer', 'maximum': 1000}), *[parameter(name) for name in ['senderInn', 'receiverInn', 'orderedColumnValue', 'did']]]
            operation['x-constraints'] = ['senderInn and receiverInn are mutually exclusive; paired cursor fields must preserve provider ordering.']
            operation['x-contract-level'] = 'typed-subset'
        elif '/v4/true-api/doc/{docId}/info' in path:
            operation['parameters'] += [parameter('pg'), parameter('body', schema={'type': 'boolean'}), parameter('content', schema={'type': 'boolean'}), parameter('limit', schema={'type': 'integer', 'maximum': 36000}), parameter('pageNumber', schema={'type': 'integer', 'minimum': 1})]
            operation['x-contract-level'] = 'typed-subset'
        elif path.endswith('/lk/documents/create'):
            operation['parameters'].append(parameter('pg', required=True))
            set_body(operation, schema_object({name: string for name in ['document_format', 'product_document', 'type', 'signature']}, ['document_format', 'product_document', 'type', 'signature']))
            operation['x-constraints'] = ['product_document: base64 of exact JSON/XML/CSV bytes. signature: detached CMS base64.', 'Second-title fields depend on document type; do not send irrelevant optional fields.', 'Submission is asynchronous; verify document and each CIS before advancing legal state.']
    unique = {}
    for entry in operation['parameters']:
        unique[(entry['in'], entry['name'])] = entry
    operation['parameters'] = list(unique.values())


def build_spec(system, declarations):
    hosts = {
        'national-catalog-api': [('https://api.nk.sandbox.crptech.ru', 'Sandbox'), ('https://апи.национальный-каталог.рф', 'Production')],
        'true-api': [('https://markirovka.sandbox.crptech.ru', 'Sandbox'), ('https://markirovka.crpt.ru', 'Production')],
        'suz': [('https://suz.sandbox.crptech.ru', 'Sandbox'), ('https://suzgrid.crpt.ru', 'Production')],
        'suz-registration-v2': [('https://suz-integrator.sandbox.crpt.tech', 'Sandbox, separate v2 registration guide'), ('https://suzgrid.crpt.ru:16443', 'Production, separate v2 registration guide')],
        'mdlp-auth': [('https://api.sb.mdlp.crpt.ru', 'Sandbox; MDLP only, outside clothing scope')],
    }
    schemes = {'TrueApiBearer': {'type': 'http', 'scheme': 'bearer'}, 'NationalCatalogApiKey': {'type': 'apiKey', 'in': 'query', 'name': 'apikey'}, 'SuzClientToken': {'type': 'apiKey', 'in': 'header', 'name': 'clientToken'}, 'RegistrationKey': {'type': 'apiKey', 'in': 'header', 'name': 'X-RegistrationKey'}}
    security = {'national-catalog-api': [{'NationalCatalogApiKey': []}, {'TrueApiBearer': []}], 'true-api': [{'TrueApiBearer': []}], 'suz': [{'SuzClientToken': []}], 'suz-registration-v2': [{'RegistrationKey': []}], 'mdlp-auth': []}
    spec = {'openapi': '3.0.3', 'info': {'title': f'CHZ / {system} / archive reference', 'version': '2026-10-27', 'description': 'Reconstructed from user-supplied PDF, NOT an official Swagger export. Complete method index with source documentation; typed schemas cover only explicitly marked subsets, not the entire protocol. No account access or live verification is implied. Default host deliberately cannot execute requests. National Catalog accepts API key OR Bearer, never both. Read linked source tables, group-specific requirements and conflicting examples before implementing an adapter.'}, 'servers': [{'url': 'https://example.invalid', 'description': 'Documentation-only default. Choose an authorized environment explicitly.'}, *[{'url': host, 'description': description} for host, description in hosts[system]]], 'security': security[system], 'paths': {}, 'components': {'securitySchemes': schemes}, 'x-origin': 'Reconstruction of API_CHZ.zip; no credentials; no live calls', 'x-source-index': '../../chz/sources/index.json', 'x-codegen-ready': False}
    grouped = {}
    for declaration in declarations:
        grouped.setdefault((declaration['method'], declaration['path']), []).append(declaration)
    for (method, path), sources in sorted(grouped.items(), key=lambda pair: (pair[0][1], pair[0][0])):
        substantive = [source for source in sources if not (source['source'] == 'true-api' and source['declarationPage'] in [10, 11])]
        chosen = next((source for source in substantive if source['source'] == system), (substantive or sources)[0])
        mutation = method in ['put', 'patch', 'delete'] or (method == 'post' and not re.search(r'/(?:info|list|search|check|check-export|history|balance|operations|rd/suggest|rd-info|mark-check|short/list|aggregated/list|history/list|validator/status|receipt/search|tn-ved/search)', path))
        if path.endswith(('/generate-gtins', '/feed-moderation', '/codes', '/order/codes/retry')):
            mutation = True
        source_links = []
        descriptions = []
        seen = set()
        for source in substantive or sources:
            key = (source['source'], source['section'], tuple(source['pages']))
            if key in seen:
                continue
            seen.add(key)
            start, end = source['pages']
            source_links.append({'document': source['source'], 'pages': [start, end], 'declarationPage': source['declarationPage'], 'section': source['section'], 'title': source['title']})
            excerpt = sanitize(source['text'])
            if len(excerpt) > 50000:
                excerpt = excerpt[:50000] + '\n[Long section truncated in Swagger description; complete tables remain in the linked original PDF.]'
            descriptions.append(f'### {source["source"]}, PDF pp. {start}-{end}, section {source["section"]}\n\n[Original PDF](/docs/chz/sources/{source["source"]}.pdf#page={start})\n\n```text\n{excerpt}\n```')
        operation = {'operationId': system.replace('-', '_') + '_' + method + '_' + re.sub(r'[^A-Za-z0-9]+', '_', path).strip('_'), 'summary': (chosen['title'] or f'{method.upper()} {path}')[:200], 'tags': [chosen['section'].split('.')[0] or 'Reference'], 'description': '**Source-documentation operation, not a complete generated-client contract.**\n\n' + '\n\n'.join(descriptions), 'parameters': [parameter(name, 'path', True) for name in re.findall(r'\{([^}]+)\}', path)], 'responses': {'default': {'description': 'See complete success/error tables in the source below. Unknown response shape is deliberately unrestricted.', 'content': {'application/json': {'schema': {}}}}}, 'x-contract-level': 'source-documentation', 'x-source': source_links, 'x-side-effects': 'mutation-or-document-generation' if mutation else 'read-only', 'x-live-verified': False}
        query_names = sorted({name for source in sources for name in source['queryNames']})
        operation['parameters'] += [parameter(name) for name in query_names if name != 'apikey']
        if system == 'suz-registration-v2' or (system == 'suz' and path == '/api/v3/integration/connection' and method == 'post'):
            operation['security'] = [{'RegistrationKey': []}]
            operation['parameters'].append(parameter('X-Signature', 'header', True, description='Signature mode differs between v2 registration and v3 core API. See source.'))
        if system == 'mdlp-auth':
            operation['x-project-scope'] = 'Not for lp; MDLP authentication only.'
        if 'feed-product-sign' in path and not path.endswith('-pkcs'):
            operation['deprecated'] = True
        enrich(operation, system, method, path)
        spec['paths'].setdefault(path, {})[method] = operation
    return spec


def build(args):
    root = args.output
    if sha256(args.archive.read_bytes()) != ARCHIVE_SHA256:
        raise ValueError('Archive version changed; review document mapping and contracts before rebuilding')
    documents = []
    with ZipFile(args.archive) as archive:
        entries = [entry for entry in archive.infolist() if entry.filename.lower().endswith('.pdf') and not entry.is_dir()]
        if len(entries) != len(DOCUMENT_IDS):
            raise ValueError('Unexpected PDF inventory; review archive mapping before continuing')
        for identifier, entry in zip(DOCUMENT_IDS, entries, strict=True):
            data = archive.read(entry)
            path = root / 'docs/chz/sources' / f'{identifier}.pdf'
            if path.exists() and path.read_bytes() != data:
                raise ValueError(f'Existing PDF differs: {path}')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            document = load_document(path, identifier, args.cache)
            document['sha256'] = sha256(data)
            document['bytes'] = len(data)
            try:
                document['archiveEntry'] = entry.filename.encode('cp437').decode('cp866')
            except (UnicodeError, LookupError):
                document['archiveEntry'] = entry.filename
            documents.append(document)
    manifest = {'archive': args.archive.name, 'archiveSha256': sha256(args.archive.read_bytes()), 'reviewedAt': '2026-10-27', 'totalPages': sum(len(document['pages']) for document in documents), 'documents': [{key: document[key] for key in ['id', 'archiveEntry', 'sha256', 'bytes']} | {'pages': len(document['pages']), 'version': VERSIONS[document['id']], 'file': f'{document["id"]}.pdf', 'textlessPages': [index + 1 for index, page in enumerate(document['pages']) if not page.strip()]} for document in documents]}
    write_json(root / 'docs/chz/sources/index.json', manifest)
    sections = {'description': 'Search index, not an executable API contract. Page numbers are 1-based PDF pages.', 'documents': [{'id': document['id'], 'pages': [{'page': index + 1, 'characters': len(text), 'headings': [heading['section'] + ' ' + heading['title'] for heading in document['headings'] if heading['page'] == index + 1], 'urls': sorted(set(re.findall(r'https?://[^\s<>"\)]+', text)))} for index, text in enumerate(document['pages'])]} for document in documents]}
    write_json(root / 'docs/chz/sources/section-index.json', sections)
    declarations = [entry for document in documents for entry in extract_operations(document)]
    systems = sorted(set(entry['system'] for entry in declarations))
    counts = {}
    for system in systems:
        spec = build_spec(system, [entry for entry in declarations if entry['system'] == system])
        if system == 'true-api':
            true_document = next(document for document in documents if document['id'] == 'true-api')
            payload_sections = []
            payload_descriptions = []
            for heading in true_document['headings']:
                if re.fullmatch(r'4\.1\.(?:[2-9]|1\d|2[01])', heading['section']) and heading['page'] >= 40:
                    _, section_end = source_section(true_document, heading['line'])
                    last_page = true_document['lines'][section_end - 1]['page']
                    payload_sections.append({'section': heading['section'], 'title': heading['title'], 'pages': [heading['page'], last_page], 'schemaStatus': 'source-documentation'})
                    text = sanitize('\n'.join(record['text'] for record in true_document['lines'][heading['line']:section_end]))
                    payload_descriptions.append(f'### {heading["section"]}. {heading["title"]}\n\n[PDF pp. {heading["page"]}-{last_page}](/docs/chz/sources/true-api.pdf#page={heading["page"]})\n\n```text\n{text}\n```')
            spec['x-document-payloads'] = payload_sections
            spec['paths']['/api/v3/true-api/lk/documents/create']['post']['description'] += '\n\n## Document payloads (source tables, not typed schemas)\n\n' + '\n\n'.join(payload_descriptions)
            sign_in = spec['paths']['/api/v3/true-api/auth/simpleSignIn']['post']
            set_response(sign_in, schema_object({'token': {'type': 'string'}, 'uuidToken': {'type': 'string'}, 'expireDate': {'type': 'string'}}))
        path = root / 'docs/openapi/chz' / f'{system}.openapi.json'
        write_json(path, spec)
        counts[system] = {'file': path.name, 'paths': len(spec['paths']), 'operations': sum(len(item) for item in spec['paths'].values()), 'typedSubsets': sum(operation['x-contract-level'] == 'typed-subset' for item in spec['paths'].values() for operation in item.values())}
    legacy = {'openapi': '3.0.3', 'info': {'title': 'CHZ / deprecated True API routes / do not implement', 'version': '2026-10-27', 'description': 'Historical index only. These methods are withdrawn or unsupported, not fallback endpoints. See true-api-deprecations.pdf. Relative paths use the v3 True API prefix unless shown otherwise.'}, 'servers': [{'url': 'https://example.invalid', 'description': 'Disabled historical reference'}], 'paths': {}}
    old_routes = [
        ('get', '/api/v3/true-api/facade/tnved/search', 'POST /api/v4/true-api/tn-ved/search', 2),
        ('get', '/api/v3/true-api/cises/listV2', 'POST /api/v4/true-api/cises/search', 2),
        ('get', '/api/v3/true-api/products/listV2', 'POST /api/v4/true-api/cises/search', 2),
        ('get', '/api/v3/true-api/cises/aggregated/list', 'POST /api/v3/true-api/cises/aggregated/list', 2),
        ('get', '/api/v3/true-api/products/info', 'POST /api/v3/true-api/cises/info; POST /api/v3/true-api/cises/short/list; POST /api/v4/true-api/product/info', 2),
        ('post', '/api/v3/true-api/km-owner-api/cises', 'POST /api/v3/true-api/cises/info', 2),
        ('get', '/api/v3/true-api/doc/{docId}/info', 'GET /api/v4/true-api/doc/{docId}/info', 2),
        ('get', '/api/v3/true-api/receipt/{receiptId}/info', 'GET /api/v4/true-api/receipt/{receiptId}/info', 2),
        ('get', '/api/v3/true-api/doc/listV2', 'GET /api/v4/true-api/doc/list', 2),
        ('get', '/api/v3/true-api/receipt/listV2', 'POST /api/v3/true-api/receipt/search', 3),
        ('get', '/api/v3/true-api/documents/{document_id}/info', 'GET /api/v4/true-api/doc/{docId}/info', 3),
        ('post', '/api/v3/true-api/elk/registration', 'Official registration UI; no replacement API asserted', 3),
        ('get', '/api/v3/true-api/elk/documents/status/{documentId}', 'Official registration UI; no replacement API asserted', 3),
        ('get', '/api/v3/true-api/product/info', 'POST /api/v4/true-api/product/info', 3),
        ('post', '/api/v3/true-api/documents/dropped-out/create', 'Unified document creation with WRITE_OFF; source spells /api/v3/lk/documents/create, unlike the full v3 True API base. Verify before calling.', 3),
        ('post', '/api/v3/true-api/product/route/gtin', 'POST /api/v4/true-api/product/info', 3),
        ('get', '/api/v4/true-api/receipt/list', 'POST /api/v3/true-api/receipt/search', 3),
        ('post', '/api/v3/true-api/documents/aggregation/create', 'Same method using JSON; XML variant withdrawn. Current method has group restrictions.', 3),
    ]
    for method, path, replacement, page in old_routes:
        legacy['paths'].setdefault(path, {})[method] = {'operationId': 'legacy_' + method + '_' + re.sub(r'[^A-Za-z0-9]+', '_', path).strip('_'), 'summary': 'DEPRECATED: ' + path, 'description': replacement, 'deprecated': True, 'parameters': [parameter(name, 'path', True) for name in re.findall(r'\{([^}]+)\}', path)], 'responses': {'default': {'description': 'Historical reference, do not execute'}}, 'x-contract-level': 'source-documentation', 'x-side-effects': 'historical-do-not-call', 'x-live-verified': False, 'x-replacement': replacement, 'x-source': [{'document': 'true-api-deprecations', 'pages': [page, page], 'declarationPage': page, 'section': 'Deprecated methods'}]}
    write_json(root / 'docs/openapi/chz/true-api-deprecated.openapi.json', legacy)
    counts['true-api-deprecated'] = {'file': 'true-api-deprecated.openapi.json', 'paths': len(legacy['paths']), 'operations': len(old_routes), 'typedSubsets': 0}
    inventory = {'description': 'Every formal URL declaration, including aliases and repeated report-task methods. Deprecated routes are inventoried separately. Entries without typed schemas still include source documentation in Swagger. No inferred account capability.', 'declarations': [{key: value for key, value in entry.items() if key != 'text'} for entry in declarations], 'deprecatedRoutes': [{'method': method, 'path': path, 'replacement': replacement, 'page': page} for method, path, replacement, page in old_routes], 'specifications': counts}
    write_json(root / 'docs/openapi/chz/coverage.json', inventory)
    print(json.dumps({'documents': len(documents), 'pages': manifest['totalPages'], 'declarations': len(declarations), 'specifications': counts}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--cache', type=Path)
    build(parser.parse_args())
