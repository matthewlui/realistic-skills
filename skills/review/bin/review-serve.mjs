#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_BODY = 4 * 1024 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidSlug(s) {
  return typeof s === 'string' && SLUG.test(s);
}

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

class TooLarge extends Error {}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new TooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createReviewServer({ root }) {
  return createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch {
      return send(res, 400, 'text/plain', 'bad request');
    }
    const parts = pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && parts.length === 0) {
      const entries = await readdir(root, { withFileTypes: true });
      const slugs = entries.filter((e) => e.isDirectory() && isValidSlug(e.name)).map((e) => e.name);
      const items = slugs.map((s) => `<li><a href="/${s}/">${s}</a></li>`).join('');
      return send(res, 200, 'text/html; charset=utf-8',
        `<!doctype html><title>review</title><h1>Reviews</h1><ul>${items}</ul>`);
    }

    const [slug, tail] = parts;
    if (!isValidSlug(slug) || parts.length > 2) return send(res, 404, 'text/plain', 'not found');

    try {
      if (req.method === 'GET' && (tail === undefined || tail === 'index.html')) {
        return send(res, 200, 'text/html; charset=utf-8',
          await readFile(join(root, slug, 'index.html')));
      }
      if (req.method === 'GET' && tail === 'review.json') {
        return send(res, 200, 'application/json; charset=utf-8',
          await readFile(join(root, slug, 'review.json')));
      }
      if (req.method === 'POST' && tail === 'review') {
        await readFile(join(root, slug, 'review.json'));
        let raw;
        try {
          raw = await readBody(req);
        } catch (err) {
          if (err instanceof TooLarge) return send(res, 413, 'text/plain', 'body too large');
          throw err;
        }
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return send(res, 400, 'text/plain', 'body must be JSON');
        }
        await writeFile(join(root, slug, 'review.json'), JSON.stringify(parsed, null, 2));
        return send(res, 200, 'application/json', '{"ok":true}');
      }
    } catch {
      return send(res, 404, 'text/plain', 'not found');
    }
    return send(res, 404, 'text/plain', 'not found');
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? '.review';
  const port = Number(process.env.REVIEW_PORT ?? 8778);
  createReviewServer({ root }).listen(port, '127.0.0.1', () => {
    console.log(`review serving ${root} at http://127.0.0.1:${port}`);
  });
}
