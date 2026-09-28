import { Queue } from 'bullmq';
import { db } from './db';

const ordersQueue = new Queue('orders');

export async function createOrderHandler(req, res) {
  const { rows } = await db.query('insert into orders (items, status) values ($1, $2) returning id', [JSON.stringify(req.body.items), 'pending']);
  await ordersQueue.add('process-order', { orderId: rows[0].id });
  res.status(202).json({ orderId: rows[0].id });
}

export async function getOrderHandler(req, res) {
  const { rows } = await db.query('select id, status from orders where id = $1', [req.params.id]);
  res.json(rows[0] ?? null);
}
