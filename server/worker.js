import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { Worker } from 'bullmq';
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers';
import { QdrantVectorStore } from '@langchain/qdrant';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
  ...(process.env.REDIS_TLS === 'true' && { tls: {} }),
};

// Module-level singletons (created once, reused across all jobs)
const embeddings = new HuggingFaceTransformersEmbeddings({
  model: 'Xenova/all-MiniLM-L6-v2',
});

const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
  ...(process.env.QDRANT_API_KEY && { apiKey: process.env.QDRANT_API_KEY }),
  checkCompatibility: false,
});

const worker = new Worker(
  'file-upload-queue',
  async (job) => {
    const data = JSON.parse(job.data);
    const userId = data.userId || 'anonymous';

    console.log(`Processing job for user: ${userId} | file: ${data.filename}`);

    // Download the PDF from Cloudinary
    const response = await fetch(data.cloudinaryUrl);
    if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.statusText}`);

    const buffer = await response.arrayBuffer();
    const blob = new Blob([buffer], { type: 'application/pdf' });

    // Load, split, embed, store
    const docs = await new PDFLoader(blob).load();
    console.log(`Loaded ${docs.length} pages`);

    const chunks = await new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    }).splitDocuments(docs);

    const chunksWithUser = chunks.map((chunk) => ({
      ...chunk,
      metadata: { ...chunk.metadata, userId },
    }));

    console.log(`Split into ${chunks.length} chunks`);

    await QdrantVectorStore.fromDocuments(chunksWithUser, embeddings, {
      client: qdrantClient,
      collectionName: process.env.QDRANT_COLLECTION_NAME || 'pdf-rag-collection',
    });

    console.log(`Stored ${chunks.length} chunks in Qdrant for user: ${userId}`);
  },
  {
    concurrency: 5,
    connection: redisConnection,
  }
);

worker.on('completed', (job) => console.log(`Job ${job.id} done`));
worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err.message));
