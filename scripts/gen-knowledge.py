#!/usr/bin/env python3
import json, re, os

docs_dir = 'docs'
skip_files = {'changelog.md', 'contributing.md', 'project.md', 'test.md', 'index.md'}
knowledge = []

def clean_md(text):
    text = re.sub(r'^---.*?---\s*', '', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'!\[.*?\]\(.*?\)', '', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = re.sub(r':::.*?\n', '', text)
    text = re.sub(r':::', '', text)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    text = re.sub(r'\`([^`]+)\`', r'\1', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

for root, dirs, files in os.walk(docs_dir):
    for f in sorted(files):
        if not f.endswith('.md') or f in skip_files:
            continue
        path = os.path.join(root, f)
        with open(path, 'r', encoding='utf-8') as fh:
            content = fh.read()

        title_match = re.search(r'^#\s+(.+)', content, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else f.replace('.md', '')

        cleaned = clean_md(content)
        if len(cleaned) > 50:
            paragraphs = [p.strip() for p in cleaned.split('\n\n') if p.strip()]
            current_chunk = ''
            for p in paragraphs:
                if len(current_chunk) + len(p) > 800 and current_chunk:
                    knowledge.append({'title': title, 'content': current_chunk.strip()})
                    current_chunk = p
                else:
                    current_chunk += '\n\n' + p if current_chunk else p
            if current_chunk.strip():
                knowledge.append({'title': title, 'content': current_chunk.strip()})

output_path = 'docs/public/knowledge.json'
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(knowledge, f, ensure_ascii=False, indent=2)

print(f'Generated {len(knowledge)} knowledge chunks -> {output_path}')
