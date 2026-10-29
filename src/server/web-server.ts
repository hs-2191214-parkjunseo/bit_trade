import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { BotEngine } from '../bot/bot-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createWebServer(botEngine: BotEngine) {
  const app = express();
  const publicPath = path.resolve(__dirname, '../../public');

  app.use(express.json());
  app.use(express.static(publicPath));

  // 헬스체크 엔드포인트 (클라우드 배포용)
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });

  // 상태 조회 API
  app.get('/api/status', (_req, res) => {
    try {
      const status = botEngine.getStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 루트 접속 시 대시보드 서빙
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  return app;
}
