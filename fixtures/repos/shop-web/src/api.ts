export type Item = { sku: string; qty: number };

export const createOrder = (items: Item[]) =>
  fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) });

export const getOrder = (id: string) => fetch(`/api/orders/${id}`);
