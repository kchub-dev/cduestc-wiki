#!/usr/bin/env python3
import json, re, os

docs_dir = 'docs'
skip_files = {'changelog.md', 'contributing.md', 'project.md', 'test.md', 'index.md'}
knowledge = []

def clean_md(text):
    """清理 markdown 语法，保留纯文本"""
    text = re.sub(r'^---.*?---\s*', '', text, flags=re.DOTALL)
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
    """生成锚点 ID：中文保留原样，英文转小写去特殊字符"""
    text = re.sub(r'[^\w一-鿿\s-]', '', text)
    text = text.strip()
    return text

def split_by_sections(content, page_title, page_url):
    """按 ## / ### 标题分块，每块带 section 和 anchor"""
    # 提取所有标题及其位置
    heading_pattern = re.compile(r'^(#{1,4})\s+(.+)$', re.MULTILINE)
    headings = list(heading_pattern.finditer(content))

    if not headings:
        # 没有子标题，整篇作为一个块
        cleaned = clean_md(content)
        if len(cleaned) > 50:
            return [{'title': page_title, 'section': '', 'content': cleaned, 'url': page_url}]
        return []

    sections = []
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
        heading_text = match.group(2).strip()
        anchor = slugify(heading_text)

        # 块内容：从当前标题到下一个同级或更高级标题
        start = match.end()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(content)
        section_content = content[start:end].strip()

        # 构建层级上下文（如"宿舍 > 成都校区"）
        section_path = heading_text
        if level >= 3:
            # 找父标题
            for j in range(i - 1, -1, -1):
                parent_level = len(headings[j].group(1))
                if parent_level < level:
                    section_path = f"{headings[j].group(2).strip()} > {heading_text}"
                    break

        cleaned = clean_md(section_content)
        if len(cleaned) > 30:
            # 长内容再拆分（每段最多 1200 字）
            if len(cleaned) > 1200:
                paragraphs = [p.strip() for p in cleaned.split('\n\n') if p.strip()]
                chunk = ''
                for p in paragraphs:
                    if len(chunk) + len(p) > 1200 and chunk:
                        sections.append({
                            'title': page_title,
                            'section': section_path,
                            'content': chunk.strip(),
                            'url': f'{page_url}#{anchor}'
                        })
                        chunk = p
                    else:
                        chunk += '\n\n' + p if chunk else p
                if chunk.strip():
                    sections.append({
                        'title': page_title,
                        'section': section_path,
                        'content': chunk.strip(),
                        'url': f'{page_url}#{anchor}'
                    })
            else:
                sections.append({
                    'title': page_title,
                    'section': section_path,
                    'content': cleaned,
                    'url': f'{page_url}#{anchor}'
                })

    return sections

# 遍历所有 markdown 文件
for root, dirs, files in os.walk(docs_dir):
    for f in sorted(files):
        if not f.endswith('.md') or f in skip_files:
            continue
        path = os.path.join(root, f)
        with open(path, 'r', encoding='utf-8') as fh:
            content = fh.read()

        title_match = re.search(r'^#\s+(.+)', content, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else f.replace('.md', '')
        url = get_url(path)

        sections = split_by_sections(content, title, url)
        knowledge.extend(sections)

output_path = 'docs/public/knowledge.json'
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(knowledge, f, ensure_ascii=False, indent=2)

print(f'Generated {len(knowledge)} knowledge chunks -> {output_path}')

# 统计
has_section = sum(1 for k in knowledge if k.get('section'))
has_anchor = sum(1 for k in knowledge if '#' in k.get('url', ''))
print(f'  with section: {has_section}, with anchor: {has_anchor}')
