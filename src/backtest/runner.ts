import { executeBacktest, executeAllMarketsBacktest } from './backtester.js';

async function main() {
  const arg = process.argv[2] || 'KRW-BTC';

  if (arg === '--ranking' || arg === '-r') {
    console.log(`=======================================================`);
    console.log(`🏆 [업비트 상위 10개 종목 60일 전수 랭킹 백테스팅]`);
    console.log(`=======================================================\n`);

    const rankings = await executeAllMarketsBacktest(10);
    console.table(
      rankings.map((r, i) => ({
        순위: `#${i + 1}`,
        종목: `${r.name} (${r.symbol})`,
        최적전략: r.bestStrategy,
        최고수익률: `${r.bestProfitRate >= 0 ? '+' : ''}${r.bestProfitRate.toFixed(2)}%`,
        승률: `${r.bestWinRate.toFixed(1)}%`,
        체결수: `${r.totalTrades}회`,
      }))
    );
  } else {
    console.log(`=======================================================`);
    console.log(`🚀 [최적화 3대 퀀트 전략 백테스팅] 대상: ${arg}`);
    console.log(`=======================================================\n`);

    const results = await executeBacktest(arg, 60);

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
}

main().catch(console.error);
