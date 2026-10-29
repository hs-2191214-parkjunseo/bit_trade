import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { BotEngine } from '../bot/bot-engine.js';
import { executeBacktest } from '../backtest/backtester.js';

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

  // 타깃 코인 변경 API
  app.post('/api/market', async (req, res) => {
    try {
      const { market } = req.body;
      if (!market) throw new Error('market 파라미터가 필요합니다 (예: KRW-ETH)');
      const result = await botEngine.changeMarket(market);
      res.json({ success: true, market: botEngine.market, result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 백테스트 실행 API
  app.get('/api/backtest', async (_req, res) => {
    try {
      const results = await executeBacktest(botEngine.market, 60);
      res.json({ success: true, results });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 수동 가상 테스트 주문 API
  app.post('/api/trade/manual', async (req, res) => {
    try {
      const { strategyId, side, amountOrVolume } = req.body;
      const order = await botEngine.manualTrade(strategyId, side, parseFloat(amountOrVolume));
      res.json({ success: true, order });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 가상 계좌 전체 초기화 API
  app.post('/api/reset', (_req, res) => {
    try {
      botEngine.resetAll();
      res.json({ success: true, message: '모든 가상 계좌가 초기화되었습니다.' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 기타 모든 경로는 대시보드 SPA 서빙
  app.use((_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  return app;
}
