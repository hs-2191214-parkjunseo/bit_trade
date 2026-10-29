import dotenv from 'dotenv';
dotenv.config();

import { BotEngine } from './bot/bot-engine.js';
import { createWebServer } from './server/web-server.js';

const PORT = process.env.PORT || 3000;
const TARGET_MARKET = process.env.TARGET_MARKET || 'KRW-BTC';
const INITIAL_SEED = parseInt(process.env.INITIAL_SEED || '1000000', 10);

async function main() {
  console.log(`=======================================================`);
  console.log(`🤖 업비트 모의투자 자동매매 봇 & 대시보드 서버 기동`);
  console.log(`   - 대상 코인: ${TARGET_MARKET}`);
  console.log(`   - 전략당 가상 원금: ${INITIAL_SEED.toLocaleString()}원 (총 6개 전략)`);
  console.log(`   - 서버 포트: ${PORT}`);
  console.log(`=======================================================`);

  // 1. 봇 엔진 초기화 및 기동
  const botEngine = new BotEngine(TARGET_MARKET, INITIAL_SEED);
  await botEngine.start();

  // 2. 웹 서버 시작
  const app = createWebServer(botEngine);
  app.listen(PORT, () => {
    console.log(`🚀 대시보드 웹 서버 실행 완료: http://localhost:${PORT}`);
    console.log(`   모바일/외부 브라우저에서 실시간 수익률 및 전략 시그널 확인 가능`);
  });

  // 프로세스 종료 처리
  process.on('SIGINT', () => {
    console.log('\n[종료 요청] 봇 및 서버를 안전하게 종료합니다...');
    botEngine.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});
