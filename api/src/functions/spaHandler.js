const { app } = require('@azure/functions');
const fs = require('node:fs/promises');
const path = require('node:path');

// Root of the Function App (the folder that contains host.json).
const APP_ROOT = path.resolve(__dirname, '..', '..');

// Directory holding the built SPA. Relative values are resolved against the
// Function App root, so "../client/dist" points at the Vite build output.
const DIST_DIR = path.resolve(APP_ROOT, process.env.SPA_DIST_PATH || '../client/dist');
const INDEX_FILE = path.join(DIST_DIR, 'index.html');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.wasm': 'application/wasm',
};

function contentTypeFor(filePath) {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// Vite emits content-hashed file names under /assets, so those can be cached
// forever. Everything else (index.html, public/ files) must be revalidated.
function cacheControlFor(relativePath) {
    return relativePath.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

// Maps a URL pathname to an absolute path inside DIST_DIR, or null if the
// pathname is malformed or would escape DIST_DIR (e.g. "/../host.json").
function resolveInDist(pathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        return null;
    }
    if (decoded.includes('\0')) {
        return null;
    }
    const resolved = path.resolve(DIST_DIR, '.' + path.posix.normalize('/' + decoded));
    if (resolved !== DIST_DIR && !resolved.startsWith(DIST_DIR + path.sep)) {
        return null;
    }
    return resolved;
}

async function readFileIfExists(filePath) {
    try {
        const stat = await fs.stat(filePath);
        return stat.isFile() ? await fs.readFile(filePath) : null;
    } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
            return null;
        }
        throw err;
    }
}

function fileResponse(request, filePath, body) {
    return {
        status: 200,
        headers: {
            'Content-Type': contentTypeFor(filePath),
            'Cache-Control': cacheControlFor(path.relative(DIST_DIR, filePath).split(path.sep).join('/')),
            'X-Content-Type-Options': 'nosniff',
        },
        body: request.method === 'HEAD' ? undefined : body,
    };
}

app.http('spaHandler', {
    methods: ['GET', 'HEAD'],
    authLevel: 'anonymous',
    // Catch-all: more specific routes such as "api/status" take precedence.
    route: '{*path}',
    handler: async (request, context) => {
        const { pathname } = new URL(request.url);

        // Unknown API routes should 404 as JSON rather than return the SPA shell.
        if (pathname === '/api' || pathname.startsWith('/api/')) {
            return { status: 404, jsonBody: { error: 'Not Found', path: pathname } };
        }

        const filePath = resolveInDist(pathname);
        if (!filePath) {
            return { status: 400, body: 'Bad Request' };
        }

        const asset = await readFileIfExists(filePath);
        if (asset) {
            return fileResponse(request, filePath, asset);
        }

        // A missing file with an extension (e.g. /assets/old-hash.js) is a real
        // 404; serving index.html for it would only produce a confusing MIME error.
        if (path.extname(filePath) && filePath !== DIST_DIR) {
            return { status: 404, body: 'Not Found' };
        }

        // Client-side route (/, /about, /users/42, ...): serve the SPA shell.
        const index = await readFileIfExists(INDEX_FILE);
        if (!index) {
            context.error(`SPA build not found at ${INDEX_FILE}`);
            return {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                body: `SPA build not found at ${INDEX_FILE}. Run "npm run build" from the repository root.`,
            };
        }
        return fileResponse(request, INDEX_FILE, index);
    },
});
