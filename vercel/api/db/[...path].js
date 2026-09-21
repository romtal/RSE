// Vercel serverless function emulating a minimal Firestore-like
// document/collection store on top of Postgres, so the client-side
// polyfill (vercel-polyfill.js) can offer the same db.doc()/db.collection()
// interface the app already uses via window.claude.use("db") on claude.ai.
//
// Table: documents(path TEXT PRIMARY KEY, data JSONB, updated_at TIMESTAMPTZ)
//
// Routing convention (path = the URL segments after /api/db/, joined by "/"):
//   - even number of segments  -> a DOCUMENT path (e.g. services/abc)
//       GET    -> { exists, data }
//       PUT    -> body = full document data, upsert (used for set())
//       PATCH  -> body = partial data, merged into existing (used for update())
//       DELETE -> removes the row
//   - odd number of segments   -> a COLLECTION path (e.g. services or services/abc/criteria)
//       GET    -> { docs: [{id, data}, ...] }  (direct children only, one level deep)
//       POST   -> body = data, server generates an id, inserts as a new document, returns { id }
//
// This intentionally supports only what app.js actually uses: doc get/set/update/delete,
// collection get (used to build onSnapshot polling in the polyfill), and add() via POST.
// No transactions, no query filters beyond "direct children of this collection path" —
// app.js does its own sorting/filtering client-side after fetching a collection.

const { Pool } = require("pg");

let pool;
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL (ou POSTGRES_URL) n'est pas configurée dans les variables d'environnement Vercel.");
    }
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes("sslmode=") ? undefined : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

// Cached across invocations on a warm serverless container (a real perf win:
// this avoids re-running CREATE TABLE/CREATE INDEX on every request). But the
// cache must only hold a SUCCESSFUL result: if the first attempt fails (e.g.
// the database is still waking up on a cold start) or a later table check
// fails, we must retry on the next call rather than wedging the whole warm
// container into permanently rethrowing that one failure.
let schemaReady = null;
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool()
      .query(`
        CREATE TABLE IF NOT EXISTS documents (
          path TEXT PRIMARY KEY,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS documents_path_prefix_idx ON documents (path text_pattern_ops);
      `)
      .catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// A segment may contain letters, digits, and _-.~:@+ — enough for our own
// generated ids (Math.random-based, alphanumeric) and human-chosen service
// ids, while rejecting anything that could be used to break out of the
// simple prefix-matching scheme below.
const SEGMENT_RE = /^[A-Za-z0-9_\-.~:@+]+$/;

function normalizePath(rawSegments) {
  const segments = (Array.isArray(rawSegments) ? rawSegments : [rawSegments]).filter(Boolean);
  if (segments.length === 0) throw httpError(400, "Chemin vide.");
  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg) || seg === "." || seg === "..") {
      throw httpError(400, `Segment de chemin invalide: "${seg}"`);
    }
  }
  return segments.join("/");
}

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function genId() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return await new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(httpError(400, "JSON invalide dans le corps de la requête."));
      }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    await ensureSchema();
    const path = normalizePath(req.query.path);
    const segCount = path.split("/").length;
    const isDocument = segCount % 2 === 0;
    const db = getPool();

    if (isDocument) {
      if (req.method === "GET") {
        const r = await db.query("SELECT data FROM documents WHERE path = $1", [path]);
        if (r.rowCount === 0) {
          res.status(200).json({ exists: false, data: null });
        } else {
          res.status(200).json({ exists: true, data: r.rows[0].data });
        }
        return;
      }
      if (req.method === "PUT") {
        const body = await readBody(req);
        await db.query(
          `INSERT INTO documents (path, data, updated_at) VALUES ($1, $2::jsonb, now())
           ON CONFLICT (path) DO UPDATE SET data = $2::jsonb, updated_at = now()`,
          [path, JSON.stringify(body)]
        );
        res.status(200).json({ ok: true });
        return;
      }
      if (req.method === "PATCH") {
        const body = await readBody(req);
        await db.query(
          `INSERT INTO documents (path, data, updated_at) VALUES ($1, $2::jsonb, now())
           ON CONFLICT (path) DO UPDATE SET data = documents.data || $2::jsonb, updated_at = now()`,
          [path, JSON.stringify(body)]
        );
        res.status(200).json({ ok: true });
        return;
      }
      if (req.method === "DELETE") {
        await db.query("DELETE FROM documents WHERE path = $1", [path]);
        res.status(200).json({ ok: true });
        return;
      }
      res.status(405).json({ error: "Méthode non supportée pour un document." });
      return;
    } else {
      // Collection: direct children only (path + "/" + one more segment, no deeper).
      const prefix = path + "/";
      if (req.method === "GET") {
        const r = await db.query(
          `SELECT path, data FROM documents
           WHERE path LIKE $1 || '%'
             AND path NOT LIKE $1 || '%/%'`,
          [prefix]
        );
        const docs = r.rows.map((row) => ({ id: row.path.slice(prefix.length), data: row.data }));
        res.status(200).json({ docs });
        return;
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        const id = genId();
        const fullPath = prefix + id;
        await db.query(
          `INSERT INTO documents (path, data, updated_at) VALUES ($1, $2::jsonb, now())`,
          [fullPath, JSON.stringify(body)]
        );
        res.status(200).json({ id });
        return;
      }
      res.status(405).json({ error: "Méthode non supportée pour une collection." });
      return;
    }
  } catch (err) {
    const status = err.statusCode || 500;
    if (status === 500) console.error("api/db error:", err);
    res.status(status).json({ error: err.message || "Erreur serveur." });
  }
};
