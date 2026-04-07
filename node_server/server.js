/**
 * Node.js equivalent of server1.py
 * Mirrors the GET /conversations endpoint exactly.
 *
 * Endpoints:
 *   GET /conversations                         — list up to 50 conversations
 *   GET /conversations?conversation_id=<id>    — single conversation + stitched messages
 *   GET /conversations?database=<db>&conversation_id=<id>  — use a different DB
 *   GET /health                                — health check
 */

const express = require('express');
const cors    = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app  = express();
const PORT = 5001;
const MONGO_URI = 'mongodb://localhost:27017';

app.use(cors());
app.use(express.json());

// ── MongoDB client (shared) ────────────────────────────────────────────────
let client;
async function getDb(dbName = 'helio_intern') {
  if (!client) {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB');
  }
  return client.db(dbName);
}

// ── Serialize: convert ObjectId / Date to strings (deep) ──────────────────
function serialize(doc) {
  if (doc === null || doc === undefined) return doc;

  if (doc instanceof ObjectId) return doc.toHexString();
  if (doc instanceof Date)     return doc.toISOString();

  if (Array.isArray(doc)) {
    return doc.map(serialize);
  }

  if (typeof doc === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(doc)) {
      out[k] = serialize(v);
    }
    return out;
  }

  return doc;   // primitive — return as-is
}

// ── Helper: find conversation trying string _id first, ObjectId second ───────
async function findConversationById(db, id) {
  // Most IDs in this DB are stored as plain strings — try that first
  let conv = await db.collection('conversations').findOne({ _id: id });
  if (!conv && ObjectId.isValid(id) && id.length === 24) {
    conv = await db.collection('conversations').findOne({ _id: new ObjectId(id) });
  }
  return conv;
}

// ── GET /conversations ─────────────────────────────────────────────────────
app.get('/conversations', async (req, res) => {
  try {
    const dbName         = req.query.database        || 'helio_intern';
    const conversationId = req.query.conversation_id || null;

    const db = await getDb(dbName);

    // ── Single conversation with stitched messages ─────────────────────────
    if (conversationId) {
      const conversation = await findConversationById(db, conversationId);

      if (!conversation) {
        const sample = await db.collection('conversations').find({}).limit(5).toArray();
        const ids    = sample.map(c => c._id?.toString() ?? 'N/A');
        return res.status(404).json({
          status:  'error',
          message: `Conversation '${conversationId}' not found in database '${dbName}'.`,
          hint:    `Sample available IDs: ${ids.join(', ')}`
        });
      }

      // Stitch messages using the exact same _id type that was stored
      // Try string match first, then ObjectId
      let messages = await db.collection('messages')
        .find({ conversationId: conversation._id })
        .sort({ timestamp: 1 })
        .toArray();

      // If no messages found via stored _id, try the other type
      if (messages.length === 0) {
        const altId = (ObjectId.isValid(conversationId) && conversationId.length === 24)
          ? new ObjectId(conversationId)
          : conversationId;
        messages = await db.collection('messages')
          .find({ conversationId: altId })
          .sort({ timestamp: 1 })
          .toArray();
      }

      conversation.messages = messages;

      return res.json({
        status:        'success',
        database:      dbName,
        conversation:  serialize(conversation),
        message_count: messages.length
      });
    }

    // ── List conversations (no messages) ──────────────────────────────────
    const conversations = await db.collection('conversations').find({}).limit(50).toArray();
    return res.json({
      status:        'success',
      database:      dbName,
      conversations: serialize(conversations),
      count:         conversations.length
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── GET /health ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', server: 'node' });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Node server running at http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET /conversations                                  — list 50 conversations`);
  console.log(`  GET /conversations?conversation_id=<id>             — single conv + messages`);
  console.log(`  GET /conversations?database=<db>&conversation_id=<id>`);
  console.log(`  GET /health\n`);
});
