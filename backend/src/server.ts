import * as http from 'http';
import express from 'express';
import { SpaceTreeStore } from './SpaceTreeStore';
import { TCPServer } from './TCPServer';
import { WebSocketServer } from './WebSocketServer';
import { createRestRouter } from './RestApiRouter';

const TCP_PORT  = parseInt(process.env['STV_TCP_PORT']  ?? '7421', 10);
const HTTP_PORT = parseInt(process.env['STV_HTTP_PORT'] ?? '7422', 10);

// --- Shared store ---
const store = new SpaceTreeStore(200);

// --- TCP server (receives from C++ spacetrees) ---
const tcpServer = new TCPServer(store, TCP_PORT);
tcpServer.listen();

// --- HTTP + WebSocket server (serves browser) ---
const app = express();
app.use(express.json());

// CORS for local dev (frontend on :5173, backend on :7422)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use('/api', createRestRouter(store));

// Simple health check
app.get('/', (_req, res) => {
  res.send('SpaceTreeVisualizer backend running');
});

const httpServer = http.createServer(app);
new WebSocketServer(httpServer, store);

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[http] REST + WebSocket listening on :${HTTP_PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[server] shutting down');
  httpServer.close();
  process.exit(0);
});
