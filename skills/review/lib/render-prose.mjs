const BLOCK_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'tr', 'pre', 'blockquote'];
const OPEN_TAG = new RegExp(`<(${BLOCK_TAGS.join('|')})((?:\\s[^>]*)?)>`, 'gi');

export function assignBlockIds(html, startAt = 1) {
  const src = String(html);

  // Ids already in the source are authoritative and are never reissued, so a
  // stale or reset startAt cannot mint a duplicate and make anchors ambiguous.
  const taken = new Set();
  for (const m of src.matchAll(/\sdata-b="([^"]+)"/g)) taken.add(m[1]);

  let n = startAt;
  const mint = () => {
    while (taken.has(`b${n}`)) n++;
    const id = `b${n++}`;
    taken.add(id);
    return id;
  };

  const out = src.replace(OPEN_TAG, (whole, tag, attrs) => {
    if (/\sdata-b\s*=/i.test(attrs)) return whole;
    return `<${tag}${attrs} data-b="${mint()}">`;
  });

  while (taken.has(`b${n}`)) n++;
  return { html: out, nextBlock: n };
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'",
  nbsp: ' ', middot: '·', mdash: '—', ndash: '–', hellip: '…',
};

function decodeEntities(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    if (/^#x/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    const key = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : whole;
  });
}

export function collectBlocks(html) {
  const blocks = [];
  const re = new RegExp(
    `<(${BLOCK_TAGS.join('|')})(?:\\s[^>]*)?\\sdata-b="([^"]+)"(?:[^>]*)?>([\\s\\S]*?)</\\1>`,
    'gi'
  );
  for (const m of String(html).matchAll(re)) {
    const text = decodeEntities(m[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    blocks.push({ id: m[2], text });
  }
  return blocks;
}
