#!/usr/bin/env python3
import base64, hashlib, json, math, os, re, struct, unicodedata
from collections import Counter

docs_dir = 'docs'
knowledge = []
MAX_CHUNK_LENGTH = 650
OVERLAP_LENGTH = 80
MIN_MERGE_LENGTH = 300
SEMANTIC_DIMENSION = 64
SEMANTIC_VOCAB_SIZE = 512
SEMANTIC_MODEL_VERSION = 'lsa-v1'

def clean_md(text):
    """清理 markdown 语法，保留纯文本"""
    text = re.sub(r'^---.*?---\s*', '', text, flags=re.DOTALL)
    text = re.sub(r'```[\s\S]*?```', '', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'!\[.*?\]\(.*?\)', '', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = re.sub(r':::.*?\n', '', text)
    text = re.sub(r':::', '', text)
    # 移除 JS/Vue import 语句
    text = re.sub(r'^import\s+.*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'^const\s+\w+\s*=\s*import.*$', '', text, flags=re.MULTILINE)
    # 移除 frontmatter 残留
    text = re.sub(r'^(sidebar|author|layout)\s*:.*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    text = re.sub(r'\`([^`]+)\`', r'\1', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def get_url(filepath):
    rel = os.path.relpath(filepath, docs_dir)
    url = '/' + rel.replace('.md', '').replace('\\', '/')
    if url.endswith('/index'):
        url = url[:-5]
    return url

def slugify(text):
    """复刻 VitePress 默认 slugify，确保知识库深链和页面锚点一致。"""
    text = re.sub(r'!\[([^\]]*)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    text = unicodedata.normalize('NFKD', text)
    text = re.sub(r'[\u0300-\u036f]', '', text)
    text = re.sub(r'[\x00-\x1f]', '', text)
    text = text.strip().lower()
    text = re.sub(r'[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"\'“”‘’<>,.?/]+', '-', text)
    text = re.sub(r'-{2,}', '-', text)
    text = re.sub(r'^-+|-+$', '', text)
    return re.sub(r'^(\d)', r'_\1', text)

def get_overlap(text, max_length):
    tail = text[-max_length:]
    boundary = max(tail.rfind(mark) for mark in '。！？!?')
    return tail[boundary + 1:].strip() if boundary >= 0 else tail

def split_text(text):
    """按段落和句子拆分，控制块长并保留句边界附近的少量重叠。"""
    units = []
    for paragraph in [part.strip() for part in text.split('\n\n') if part.strip()]:
        sentences = [part.strip() for part in re.split(r'(?<=[。！？!?])', paragraph) if part.strip()]
        for sentence in sentences or [paragraph]:
            if len(sentence) <= MAX_CHUNK_LENGTH:
                units.append(sentence)
                continue
            units.extend(sentence[index:index + MAX_CHUNK_LENGTH]
                         for index in range(0, len(sentence), MAX_CHUNK_LENGTH))

    chunks = []
    current = ''
    for unit in units:
        if current and len(current) + len(unit) + 2 > MAX_CHUNK_LENGTH:
            chunks.append(current.strip())
            overlap = get_overlap(current, OVERLAP_LENGTH)
            candidate = f'{overlap}\n\n{unit}' if overlap else unit
            current = candidate if len(candidate) <= MAX_CHUNK_LENGTH else unit
        else:
            current = f'{current}\n\n{unit}' if current else unit
    if current.strip():
        chunks.append(current.strip())
    return chunks

def merge_small_sections(sections, page_url):
    """把相邻短节合成可检索上下文，合并后退回页面级链接避免错误锚点。"""
    merged = []
    for section in sections:
        if merged:
            previous = merged[-1]
            combined_length = len(previous['content']) + len(section['content']) + 2
            if (len(previous['content']) < MIN_MERGE_LENGTH or len(section['content']) < MIN_MERGE_LENGTH) \
                and combined_length <= MAX_CHUNK_LENGTH:
                previous['content'] += f"\n\n{section['section']}\n{section['content']}"
                previous['section'] = f"{previous['section']} | {section['section']}"
                previous['url'] = page_url
                continue
        merged.append(section)
    return merged

def normalize_for_embedding(value):
    return ''.join(character for character in value.lower()
                   if not character.isspace() and not unicodedata.category(character).startswith('P'))

def semantic_tokens(value):
    """Tokenize Chinese phrases and Latin words for the corpus LSA model."""
    text = normalize_for_embedding(value)
    tokens = []
    chinese = ''.join(character for character in text if '\u4e00' <= character <= '\u9fff')
    for length in (2, 3, 4):
        tokens.extend(chinese[index:index + length]
                      for index in range(max(0, len(chinese) - length + 1)))
    tokens.extend(re.findall(r'[a-z0-9]+', text))
    return tokens

def quantize_vector(vector):
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    quantized = [max(-127, min(127, round(value / norm * 127))) for value in vector]
    return base64.b64encode(struct.pack(f'{len(quantized)}b', *quantized)).decode('ascii')

def stable_projection(context_index):
    """Map a PPMI context row into a compact deterministic latent space."""
    digest = hashlib.sha256(f'{SEMANTIC_MODEL_VERSION}:{context_index}'.encode()).digest()
    return int.from_bytes(digest[:2], 'big') % SEMANTIC_DIMENSION, 1.0 if digest[2] & 1 else -1.0

def build_semantic_model(entries):
    """Train a compact corpus-level LSA embedding from document co-occurrence.

    This is a real distributional embedding: terms that occur in the same
    documents share PPMI context vectors, then a deterministic projection
    reduces them to 64 dimensions. It needs no network model or runtime service.
    """
    document_tokens = [Counter(semantic_tokens(' '.join([
        entry.get('title', ''), entry.get('section', ''), entry.get('content', '')
    ]))) for entry in entries]
    document_frequency = Counter()
    for tokens in document_tokens:
        document_frequency.update(tokens.keys())

    vocabulary = [token for token, frequency in document_frequency.most_common()
                  if frequency >= 2][:SEMANTIC_VOCAB_SIZE]
    vocabulary.sort()
    token_index = {token: index for index, token in enumerate(vocabulary)}
    size = len(vocabulary)
    cooccurrence = [[0.0] * size for _ in range(size)]
    for tokens in document_tokens:
        present = [token_index[token] for token in tokens if token in token_index]
        for left in present:
            for right in present:
                if left != right:
                    cooccurrence[left][right] += 1.0

    column_totals = [sum(row[column] for row in cooccurrence) for column in range(size)]
    total = sum(column_totals) or 1.0
    token_vectors = {}
    for row_index, row in enumerate(cooccurrence):
        row_total = sum(row) or 1.0
        projected = [0.0] * SEMANTIC_DIMENSION
        for context_index, count in enumerate(row):
            if not count or not column_totals[context_index]:
                continue
            ppmi = max(0.0, math.log((count * total) / (row_total * column_totals[context_index])))
            dimension, sign = stable_projection(context_index)
            projected[dimension] += ppmi * sign
        token_vectors[vocabulary[row_index]] = quantize_vector(projected)

    entry_embeddings = []
    for tokens in document_tokens:
        vector = [0.0] * SEMANTIC_DIMENSION
        total_weight = 0.0
        for token, frequency in tokens.items():
            encoded = token_vectors.get(token)
            if not encoded:
                continue
            raw = base64.b64decode(encoded)
            idf = math.log((len(entries) + 1) / (document_frequency[token] + 1)) + 1
            weight = min(frequency, 3) * idf
            total_weight += weight
            for index, value in enumerate(struct.unpack(f'{SEMANTIC_DIMENSION}b', raw)):
                vector[index] += value * weight
        entry_embeddings.append(quantize_vector(vector) if total_weight else '')

    return {
        'model': SEMANTIC_MODEL_VERSION,
        'dimension': SEMANTIC_DIMENSION,
        'tokens': token_vectors,
    }, entry_embeddings

def split_by_sections(content, page_title, page_url):
    """按 ## / ### 标题分块，每块带 section 和 anchor"""
    # 提取所有标题及其位置
    heading_pattern = re.compile(r'^(#{1,4})\s+(.+)$', re.MULTILINE)
    masked_content = re.sub(
        r'```[\s\S]*?```',
        lambda match: re.sub(r'[^\n]', ' ', match.group(0)),
        content,
    )
    headings = list(heading_pattern.finditer(masked_content))

    if not headings:
        # 没有子标题，整篇作为一个块
        cleaned = clean_md(content)
        if len(cleaned) > 50:
            return [{'title': page_title, 'section': '', 'content': cleaned, 'url': page_url}]
        return []

    sections = []
    used_anchors = {}
    heading_stack = []
    # 标题前的内容（引言）
    intro_end = headings[0].start()
    intro = content[:intro_end].strip()
    if intro:
        cleaned = clean_md(intro)
        if len(cleaned) > 50:
            sections.append({
                'title': page_title,
                'section': '',
                'content': cleaned,
                'url': page_url
            })

    # 按标题分块
    for i, match in enumerate(headings):
        level = len(match.group(1))  # ## = 2, ### = 3
        heading_text = clean_md(match.group(2).strip())
        base_anchor = slugify(heading_text)
        duplicate_count = used_anchors.get(base_anchor, 0)
        used_anchors[base_anchor] = duplicate_count + 1
        anchor = base_anchor if duplicate_count == 0 else f'{base_anchor}-{duplicate_count}'

        # 块内容：从当前标题到下一个同级或更高级标题
        start = match.end()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(content)
        section_content = content[start:end].strip()

        # 构建层级上下文（如"宿舍 > 成都校区"）
        while heading_stack and heading_stack[-1][0] >= level:
            heading_stack.pop()
        heading_stack.append((level, heading_text))
        section_path = ' > '.join(item[1] for item in heading_stack)

        cleaned = clean_md(section_content)
        if len(cleaned) > 30:
            if len(cleaned) > MAX_CHUNK_LENGTH:
                chunks = split_text(cleaned)
                for ch in chunks:
                    sections.append({
                        'title': page_title,
                        'section': section_path,
                        'content': ch,
                        'url': f'{page_url}#{anchor}'
                    })
            else:
                sections.append({
                    'title': page_title,
                    'section': section_path,
                    'content': cleaned,
                    'url': f'{page_url}#{anchor}'
                })

    return merge_small_sections(sections, page_url)

# 遍历所有 markdown 文件
for root, dirs, files in os.walk(docs_dir):
    dirs[:] = [directory for directory in dirs if directory not in {'.vitepress', 'public'}]
    for f in sorted(files):
        if not f.endswith('.md'):
            continue
        path = os.path.join(root, f)
        with open(path, 'r', encoding='utf-8') as fh:
            content = fh.read()

        title_match = re.search(r'^#\s+(.+)', content, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else f.replace('.md', '')
        url = get_url(path)

        sections = split_by_sections(content, title, url)
        knowledge.extend(sections)

semantic_model, embeddings = build_semantic_model(knowledge)
for entry, embedding in zip(knowledge, embeddings):
    entry['embedding'] = embedding

output_path = 'docs/public/knowledge.json'
serialized_knowledge = json.dumps(knowledge, ensure_ascii=False, indent=2) + '\n'
version = hashlib.sha256(serialized_knowledge.encode('utf-8')).hexdigest()[:12]
versioned_filename = f'knowledge.{version}.json'
versioned_path = os.path.join('docs/public', versioned_filename)

shards = {'core': [], 'campus': [], 'study': [], 'life': []}
for entry in knowledge:
    first_segment = entry['url'].split('/')[1] if entry['url'].startswith('/') else ''
    shard = first_segment if first_segment in {'campus', 'study', 'life'} else 'core'
    shards[shard].append(entry)

shard_files = {}
for shard_name, shard_entries in shards.items():
    filename = f'knowledge.{shard_name}.{version}.json'
    shard_files[shard_name] = filename
    with open(os.path.join('docs/public', filename), 'w', encoding='utf-8') as f:
        json.dump(shard_entries, f, ensure_ascii=False, indent=2)
        f.write('\n')

for filename in os.listdir('docs/public'):
    if re.fullmatch(r'knowledge(?:\.[a-z]+)?\.[0-9a-f]{12}\.json', filename) \
        and filename not in {versioned_filename, *shard_files.values()}:
        os.remove(os.path.join('docs/public', filename))

for path in (output_path, versioned_path):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(serialized_knowledge)

with open('docs/public/knowledge-manifest.json', 'w', encoding='utf-8') as f:
    json.dump({
        'version': version,
        'file': versioned_filename,
        'shards': shard_files,
        'entries': len(knowledge),
        'semantic': semantic_model,
    }, f, ensure_ascii=False, indent=2)
    f.write('\n')

print(f'Generated {len(knowledge)} knowledge chunks -> {output_path}')

# 统计
has_section = sum(1 for k in knowledge if k.get('section'))
has_anchor = sum(1 for k in knowledge if '#' in k.get('url', ''))
print(f'  with section: {has_section}, with anchor: {has_anchor}')
