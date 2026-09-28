import express from 'express';
import { createOrderHandler, getOrderHandler } from './orders';

const app = express();
app.use(express.json());
app.post('/api/orders', createOrderHandler);
app.get('/api/orders/:id', getOrderHandler);
app.listen(Number(process.env.PORT ?? 3000));
