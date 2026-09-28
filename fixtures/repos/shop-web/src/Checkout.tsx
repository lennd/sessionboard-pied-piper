import { createOrder, type Item } from './api';

export function Checkout({ items }: { items: Item[] }) {
  return <button onClick={() => createOrder(items)}>Pay</button>;
}
