import { executeBacktest } from './backtester.js';

async function main() {
  const market = process.argv[2] || 'KRW-BTC';
  console.log(`=======================================================`);
  console.log(`🚀 [최적화 3대 퀀트 전략 백테스팅] 대상: ${market}`);
  console.log(`=======================================================\n`);

  const results = await executeBacktest(market, 60);

  console.log('📊 [백테스팅 결과 대조]');
  console.table(
    results.map((r) => ({
      전략명: r.strategyName,
      초기원금: `${Math.round(r.initialKrw).toLocaleString()}원`,
      최종평가금: `${Math.round(r.portfolioValue).toLocaleString()}원`,
      수익률: `${r.totalProfitRate >= 0 ? '+' : ''}${r.totalProfitRate.toFixed(2)}%`,
      최대낙폭MDD: `${r.maxDrawdown.toFixed(2)}%`,
      총체결수: `${r.totalTrades}회`,
      청산승률: `${r.winRate.toFixed(1)}%`,
    }))
  );
}

main().catch(console.error);
