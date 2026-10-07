import 'dotenv/config';
import { v2 as cloudinary } from 'cloudinary';
import { QdrantClient } from '@qdrant/js-client-rest';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Queue } from 'bullmq';
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers';
import { QdrantVectorStore } from '@langchain/qdrant';
import { GoogleGenAI } from '@google/genai';

// ── Constants ──────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_QUERY_LENGTH = 1000;
const ALLOWED_MIME = 'application/pdf';

// ── Cloudinary ─────────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Gemini ─────────────────────────────────────────────────────────────────────
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ── Redis (Upstash TLS-ready) ──────────────────────────────────────────────────
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
  ...(process.env.REDIS_TLS === 'true' && { tls: {} }),
};

const queue = new Queue('file-upload-queue', { connection: redisConnection });

// Created once at startup — reused across all requests (critical for performance)
const embeddings = new HuggingFaceTransformersEmbeddings({
  model: 'Xenova/all-MiniLM-L6-v2',
});

const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
  ...(process.env.QDRANT_API_KEY && { apiKey: process.env.QDRANT_API_KEY }),
  checkCompatibility: false,
});

// ── Multer — memory only, 10MB cap, PDF only ───────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== ALLOWED_MIME) {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  },
});

// ── Rate limiters ──────────────────────────────────────────────────────────────
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 5,                     // 5 uploads per minute per IP
  message: { error: 'Too many uploads. Please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 30,                    // 30 chat requests per minute per IP
  message: { error: 'Too many requests. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Express App ────────────────────────────────────────────────────────────────
const app = express();

// Helmet sets ~15 security headers (XSS, clickjacking, MIME sniffing, etc.)
app.use(helmet());

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

// Reject oversized JSON/text bodies early
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Strip X-Powered-By (already done by helmet but be explicit)
app.disable('x-powered-by');

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'All Good!' });
});

// ── Upload PDF ─────────────────────────────────────────────────────────────────
app.post('/upload/pdf', uploadLimiter, upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file received.' });
  }

  // Sanitize userId — only allow alphanumeric + underscores/hyphens
  const rawUserId = String(req.body.userId || 'anonymous');
  const userId = rawUserId.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128) || 'anonymous';

  // Double-check file size (multer should catch this but be safe)
  if (req.file.size > MAX_FILE_BYTES) {
    return res.status(413).json({ error: `File too large. Max ${MAX_FILE_SIZE_MB}MB allowed.` });
  }

  try {
    const cloudinaryUrl = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          folder: 'pdf-rag-uploads',
          public_id: `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
        },
        (err, result) => (err ? reject(err) : resolve(result.secure_url))
      );
      stream.end(req.file.buffer);
    });

    await queue.add('file-ready', JSON.stringify({
      filename: req.file.originalname,
      cloudinaryUrl,
      userId,
    }));

    res.json({ message: 'uploaded' });
  } catch (err) {
    console.error('Upload failed:', err.message);
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

// Multer error handler (file size / type violations)
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File too large. Max ${MAX_FILE_SIZE_MB}MB allowed.` });
  }
  if (err.message === 'Only PDF files are allowed') {
    return res.status(415).json({ error: 'Only PDF files are accepted.' });
  }
  next(err);
});

// ── Chat ───────────────────────────────────────────────────────────────────────
app.get('/chat', chatLimiter, async (req, res) => {
  const rawQuery = String(req.query.message || '').trim();
  const rawUserId = String(req.query.userId || 'anonymous');

  if (!rawQuery) {
    return res.status(400).json({ error: 'Message is required.' });
  }
  if (rawQuery.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: `Message too long. Max ${MAX_QUERY_LENGTH} characters.` });
  }

  // Sanitize userId
  const userId = rawUserId.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128) || 'anonymous';

  const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
    client: qdrantClient,
    collectionName: process.env.QDRANT_COLLECTION_NAME || 'pdf-rag-collection',
  });

  const retriever = vectorStore.asRetriever({
    k: 2,
    filter: {
      must: [{ key: 'metadata.userId', match: { value: userId } }],
    },
  });

  const docs = await retriever.invoke(rawQuery);

  const systemPrompt = `You are a helpful AI Assistant who answers the user query based on the available context from PDF File.
Context:
${JSON.stringify(docs)}`;

  let responseText = '';
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: systemPrompt + '\n\nUser Query: ' + rawQuery,
    });
    responseText = result.text;
  } catch (err) {
    console.error('Gemini error:', err.message);
    let message = err.message || String(err);
    try {
      const parsed = JSON.parse(message);
      if (parsed.error?.message) message = parsed.error.message;
    } catch (_) {}
    responseText = `Gemini API Error: ${message}`;
  }

  res.json({ message: responseText, docs });
});

// ── Global error handler ───────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
