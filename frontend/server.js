import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4173;

// Proxy /api requests to backend service
app.use('/api', createProxyMiddleware({
  target: 'http://backend:8080',
  changeOrigin: true,
  pathRewrite: {
    '^/api': '', // Strip /api prefix
  },
  logLevel: 'info',
}));

// Serve static files from dist
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback: serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend server listening on port ${PORT}`);
  console.log(`API proxy: /api → http://backend:8080`);
});
