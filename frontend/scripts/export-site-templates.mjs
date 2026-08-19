#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizedToBackendDocument } from '../src/api/adapters.js';
import { SITE_TEMPLATES } from '../src/content/siteTemplates.js';

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, '../../backend/app/templates/site_templates.json');

const payload = SITE_TEMPLATES.map((template) => ({
  slug: template.slug,
  name: template.name,
  description: template.description,
  category: template.category,
  contentType: template.contentType || 'generic',
  sectionKey: template.sectionKey || '',
  routePath: template.routePath || '',
  document: normalizedToBackendDocument({
    locale: 'ru',
    layout: template.layout,
    pageMeta: template.pageMeta,
    content: template.content,
  }),
}));

writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Exported ${payload.length} templates to ${output}`);
