import { Helpers } from 'tinkoff-invest-api';
import { OperationState } from 'tinkoff-invest-api/dist/generated/operations.js';
import { OrderDirection, OrderType, OrderExecutionReportStatus } from 'tinkoff-invest-api/dist/generated/orders.js';
import { configureBroker, tickBroker } from './system.spec.js';

describe('buy-sell orders', () => {

  const figi = 'BBG004730N88';

  beforeEach(async () => {
    await configureBroker();
  });

  async function getOrdersCount() {
    const { orders } = await testApi.orders.getOrders({ accountId: '' });
    return orders.length;
  }

  async function getOperations() {
    const { operations } = await testApi.operations.getOperations({
      figi,
      state: OperationState.OPERATION_STATE_EXECUTED,
      accountId: '',
    });
    return operations;
  }

  it('покупка по рыночной цене', async () => {
    assert.equal(await getOrdersCount(), 0);

    // создать заявку
    const res = await testApi.orders.postOrder({
      accountId: '',
      figi,
      quantity: 1,
      direction: OrderDirection.ORDER_DIRECTION_BUY,
      orderType: OrderType.ORDER_TYPE_MARKET,
      orderId: '1',
    });
    assert.equal(new Date().toISOString(), '2022-04-29T07:00:00.001Z');
    assert.equal(res.figi, figi);
    assert.equal(res.executionReportStatus, OrderExecutionReportStatus.EXECUTION_REPORT_STATUS_NEW);
    assert.deepEqual(res.initialOrderPrice, { units: 1228, nano: 600000000, currency: 'rub' });
    // 1228.6 * 0.003 = 3.6858
    assert.deepEqual(res.initialCommission, { units: 3, nano: 685800000, currency: 'rub' });
    assert.deepEqual(res.totalOrderAmount, { units: 1232, nano: 285800000, currency: 'rub' });
    assert.equal(await getOrdersCount(), 1);

    // check blocked money/figi
    const positions = await testApi.operations.getPositions({ accountId: '' });
    assert.deepEqual(positions.blocked, [{ units: 1232, nano: 285800000, currency: 'rub' }]);
    assert.deepEqual(positions.money, [{ units: 98767, nano: 714200000, currency: 'rub' }]);
    assert.deepEqual(positions.securities, []);

    await tickBroker();

    assert.equal(await getOrdersCount(), 0);

    // check operations
    const operations = await getOperations();
    assert.equal(operations.length, 2);
    assert.deepEqual(operations[ 0 ].payment, { units: -1228, nano: -600000000, currency: 'rub' });
    assert.equal(operations[ 0 ].date?.toISOString(), '2022-04-29T07:01:00.001Z');
    // 1228.6 * 0.003 = 3.6858
    assert.deepEqual(operations[ 1 ].payment, { units: -3, nano: -685800000, currency: 'rub' });

    // check balance and capital: 100_000 - (1228.6 + 3.6858) = 98767.7142
    const portfolio = await testApi.operations.getPortfolio({ accountId: '' });

    // check positions
    assert.equal(portfolio.positions.length, 1);
    assert.deepEqual(portfolio.positions[0].currentPrice, { units: 123, nano: 650000000, currency: 'rub' });
    assert.deepEqual(portfolio.positions[0].averagePositionPrice, { units: 122, nano: 860000000, currency: 'rub' });
    assert.deepEqual(portfolio.positions[0].averagePositionPriceFifo, { units: 122, nano: 860000000, currency: 'rub' });
    assert.deepEqual(portfolio.positions[0].quantityLots, { units: 1, nano: 0 });
    assert.deepEqual(portfolio.positions[0].quantity, { units: 10, nano: 0 });
    assert.equal(portfolio.positions[0].instrumentType, 'share');

    // check blocked money/figi
    const positionsUnblocked = await testApi.operations.getPositions({ accountId: '' });
    assert.deepEqual(positionsUnblocked.blocked, []);
    assert.deepEqual(positionsUnblocked.money, [{ units: 98767, nano: 714200000, currency: 'rub' }]);
    assert.deepEqual(positionsUnblocked.securities, [{ figi: 'BBG004730N88', balance: 10, blocked: 0 }]);

    // totals
    assert.deepEqual(portfolio.totalAmountCurrencies, { units: 98767, nano: 714200000, currency: 'rub' });
    assert.deepEqual(portfolio.totalAmountShares, { units: 1236, nano: 500000000, currency: 'rub' });
    // capital: 100_000 - (1228.6 + 3.6858) + 1236.5 = 100_004.2142
    // expectedYield: 100 * (100_004.2142 - 100_000 ) / 100_000 = 0.42142%
    assert.deepEqual(portfolio.expectedYield, { units: 0, nano: 4214200 });
  });

  it('продажа по рыночной цене', async () => {
    assert.equal(await getOrdersCount(), 0);

    // сначала покупаем 1 лот: цена 122.86 (+комиссия)
    await testApi.orders.postOrder({
      accountId: '',
      figi,
      quantity: 1,
      direction: OrderDirection.ORDER_DIRECTION_BUY,
      orderType: OrderType.ORDER_TYPE_MARKET,
      orderId: '1',
    });

    await tickBroker();

    // теперь продаем этот 1 лот: цена 123.65 (+комиссия)
    await testApi.orders.postOrder({
      accountId: '',
      figi,
      quantity: 1,
      direction: OrderDirection.ORDER_DIRECTION_SELL,
      orderType: OrderType.ORDER_TYPE_MARKET,
      orderId: '2',
    });
    // check blocked figi
    const positionsUnblocked = await testApi.operations.getPositions({ accountId: '' });
    assert.deepEqual(positionsUnblocked.securities, [{ figi: 'BBG004730N88', balance: 0, blocked: 10 }]);

    await tickBroker();

    // check operations
    const operations = await getOperations();
    assert.equal(operations.length, 4);
    assert.deepEqual(operations[ 0 ].payment, { units: -1228, nano: -600000000, currency: 'rub' });
    assert.deepEqual(operations[ 1 ].payment, { units: -3, nano: -685800000, currency: 'rub' });
    assert.deepEqual(operations[ 2 ].payment, { units: 1236, nano: 500000000, currency: 'rub' });
    // 1236.5 * 0.003 = 3.7095
    assert.deepEqual(operations[ 3 ].payment, { units: -3, nano: -709500000, currency: 'rub' });

    // check balance: 100_000 - (1228.6 + 3.6858) + (1236.5 - 3.7095) = 100000.5047
    const portfolio = await testApi.operations.getPortfolio({ accountId: '' });
    assert.deepEqual(portfolio.totalAmountCurrencies, { units: 100000, nano: 504700000, currency: 'rub' });

    // check portfolio positions
    assert.equal(portfolio.positions.length, 1);
    assert.deepEqual(portfolio.positions[0].quantityLots, { units: 0, nano: 0 });
    assert.deepEqual(portfolio.positions[0].quantity, { units: 0, nano: 0 });
    assert.deepEqual(portfolio.positions[0].averagePositionPrice, { units: 0, nano: 0, currency: 'rub' });
  });

  it('покупка по лимит-цене', async () => {
    const res = await testApi.orders.postOrder({
      accountId: '',
      figi,
      quantity: 10,
      price: Helpers.toQuotation(123), // предыдущая свеча: l=122.8, h=123.87, заявка должна исполниться
      direction: OrderDirection.ORDER_DIRECTION_BUY,
      orderType: OrderType.ORDER_TYPE_LIMIT,
      orderId: '1',
    });
    assert.deepEqual(res.initialOrderPrice, { units: 12300, nano: 0, currency: 'rub' });

    await tickBroker();
    assert.equal(await getOrdersCount(), 0);

    // check operations
    const { operations } = await testApi.operations.getOperations({
      figi,
      state: OperationState.OPERATION_STATE_EXECUTED,
      accountId: '',
    });
    assert.equal(operations.length, 2);
    assert.deepEqual(operations[ 0 ].payment, { units: -12300, nano: 0, currency: 'rub' });
    // 12300 * 0.003 = 36.9
    assert.deepEqual(operations[ 1 ].payment, { units: -36, nano: -900000000, currency: 'rub' });
  });

  it('отмена заявки: заблокированные средства возвращаются на баланс', async () => {
    const { orderId } = await testApi.orders.postOrder({
      accountId: '',
      figi,
      quantity: 1,
      price: Helpers.toQuotation(100),
      direction: OrderDirection.ORDER_DIRECTION_BUY,
      orderType: OrderType.ORDER_TYPE_LIMIT,
      orderId: '1',
    });

    await tickBroker();

    await testApi.orders.cancelOrder({ orderId, accountId: '' });
    assert.equal(await getOrdersCount(), 0);

    const positions = await testApi.operations.getPositions({ accountId: '' });
    assert.deepEqual(positions.money, [{ units: 100000, nano: 0, currency: 'rub' }]);

    const portfolio = await testApi.operations.getPortfolio({ accountId: '' });
    assert.deepEqual(portfolio.totalAmountCurrencies, { units: 100000, nano: 0, currency: 'rub' });
  });

  it('недостаточно лотов для продажи', async () => {
    const promise = testApi.orders.postOrder({
      accountId: '',
      figi,
      quantity: 5,
      direction: OrderDirection.ORDER_DIRECTION_SELL,
      orderType: OrderType.ORDER_TYPE_MARKET,
      orderId: '1',
    });
    await assert.rejects(promise, /Отрицательный баланс инструмента BBG004730N88: -50/);
  });

});
