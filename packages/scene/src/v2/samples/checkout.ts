import type { SceneInput } from '../schema';
import { defineScene } from './define';

type Lang = 'es' | 'en';

const RESERVE_SNIPPET = [
  'export async function reserveStock(tx: Tx, items: Item[]) {',
  '  for (const item of items) {',
  "    const row = await tx.one('SELECT qty FROM stock WHERE sku = $1 FOR UPDATE', [item.sku]);",
  '    if (row.qty < item.qty) throw new OutOfStock(item.sku);',
  "    await tx.none('UPDATE stock SET qty = qty - $1 WHERE sku = $2', [item.qty, item.sku]);",
  '  }',
  '}',
].join('\n');

const CHARGE_SNIPPET = [
  'export async function charge(order: Order) {',
  '  return stripe.paymentIntents.create(',
  "    { amount: order.totalCents, currency: 'usd', customer: order.customerId },",
  '    { idempotencyKey: `order-${order.id}` },',
  '  );',
  '}',
].join('\n');

const API_SNIPPET = [
  "router.post('/orders', auth, async (req, res) => {",
  '  const order = await orders.create(req.user.id, req.body.items);',
  "  await queue.send('orders', { orderId: order.id, attempt: 1 });",
  '  res.status(202).json({ orderId: order.id });',
  '});',
].join('\n');

const build = (lang: Lang): SceneInput => {
  const L = (es: string, en: string) => (lang === 'es' ? es : en);
  return {
    id: `checkout-${lang}`,
    title: L('Checkout y procesamiento de órdenes', 'Checkout & order processing'),
    summary: L(
      'Cómo una compra viaja desde el botón "Pagar" hasta el stock reservado, el cobro y el mail de confirmación.',
      'How a purchase travels from the "Pay" button to reserved stock, payment and the confirmation email.',
    ),
    language: lang,
    nodes: [
      {
        id: 'checkout', label: 'Checkout', role: 'actor', kind: 'React page', repo: 'web-store',
        summary: L('La página donde el cliente confirma la compra.', 'The page where the customer confirms the purchase.'),
      },
      {
        id: 'api', label: 'Orders API', role: 'compute', kind: 'REST API (Express)', repo: 'orders-api',
        summary: L('Valida la orden, la guarda y la encola; responde 202 sin esperar el procesamiento.', 'Validates and stores the order, enqueues it and answers 202 without waiting for processing.'),
        scale: {
          low: { status: 'ok', note: L('Holgada, ~5% de su capacidad.', 'Comfortable, ~5% of capacity.') },
          medium: { status: 'ok', note: L('~40% de uso, sin fila.', '~40% busy, no queueing.') },
          high: { status: 'strained', note: L('~90%: empieza a encolar requests.', '~90%: requests start to queue.') },
          strategy: 'horizontal',
          advice: L('Es stateless: sumar instancias detrás del balanceador.', 'Stateless: add instances behind the load balancer.'),
        },
        code: { repo: 'orders-api', path: 'src/routes/orders.ts', startLine: 12, endLine: 16, language: 'typescript', snippet: API_SNIPPET },
      },
      {
        id: 'orders-queue', label: 'orders queue', role: 'channel', kind: 'SQS queue', repo: 'orders-api',
        summary: L('Desacopla la API del procesamiento y absorbe picos.', 'Decouples the API from processing and absorbs spikes.'),
        scale: {
          low: { status: 'ok', note: L('Casi siempre vacía.', 'Almost always empty.') },
          medium: { status: 'ok', note: L('Absorbe el pico sin problema.', 'Absorbs the spike without trouble.') },
          high: { status: 'strained', note: L('Crece la profundidad: la fila real está en quien consume.', 'Depth grows: the real bottleneck is the consumer.') },
          strategy: 'horizontal',
          advice: L('Escalar consumidores; procesar de forma idempotente (entrega at-least-once).', 'Scale consumers; process idempotently (at-least-once delivery).'),
        },
      },
      {
        id: 'worker', label: 'Order worker', role: 'compute', kind: 'Node worker ×2', repo: 'orders-api',
        summary: L('Toma órdenes de la cola, reserva stock, cobra y avisa.', 'Takes orders from the queue, reserves stock, charges and notifies.'),
        scale: {
          low: { status: 'ok', note: L('Una orden a la vez, sin espera.', 'One order at a time, no waiting.') },
          medium: { status: 'limit', note: L('Los 2 workers casi siempre ocupados; se forma fila en la cola.', 'Both workers are almost always busy; a queue builds up.') },
          high: { status: 'saturated', note: L('Saturado: la fila crece sin parar.', 'Saturated: the queue keeps growing.') },
          strategy: 'horizontal',
          advice: L('Sumar workers… pero más workers empujan más carga al inventario, que no escala igual.', 'Add workers… but more workers push more load onto inventory, which does not scale the same way.'),
        },
      },
      {
        id: 'reserve-stock', label: 'reserveStock()', role: 'logic', kind: L('función transaccional', 'transactional function'), parent: 'worker',
        summary: L('Reserva el stock de todos los ítems dentro de una transacción.', 'Reserves stock for every item inside one transaction.'),
        complexity: { time: 'O(k)', space: 'O(1)', note: L('k = ítems de la orden; un round-trip por ítem.', 'k = items in the order; one round-trip per item.') },
        code: { repo: 'orders-api', path: 'src/worker/reserve.ts', startLine: 8, endLine: 14, language: 'typescript', snippet: RESERVE_SNIPPET },
      },
      {
        id: 'lock-rows', label: 'lock rows', role: 'logic', kind: 'SELECT … FOR UPDATE', parent: 'reserve-stock',
        summary: L('Bloquea la fila de cada producto para que nadie más la venda.', 'Locks each product row so nobody else can sell it.'),
        complexity: { time: 'O(k log n)', note: L('Búsqueda por índice en n productos.', 'Index lookup over n products.') },
      },
      {
        id: 'check-qty', label: 'check quantity', role: 'logic', kind: L('validación', 'validation'), parent: 'reserve-stock',
        summary: L('Si no alcanza el stock, aborta la transacción.', 'Aborts the transaction when there is not enough stock.'),
        complexity: { time: 'O(1)' },
      },
      {
        id: 'stock-row', label: 'stock row', role: 'data', kind: L('fila de la tabla stock', 'stock table row'), parent: 'reserve-stock',
        summary: L('La cantidad disponible de un SKU.', 'The available quantity of one SKU.'),
      },
      {
        id: 'charge', label: 'charge()', role: 'logic', kind: L('llamada a pagos', 'payment call'), parent: 'worker', change: 'modified',
        summary: L('Cobra la orden con una clave de idempotencia.', 'Charges the order with an idempotency key.'),
        complexity: { time: 'O(1)', note: L('Dominado por la latencia del proveedor (~700ms).', 'Dominated by provider latency (~700ms).') },
        code: { repo: 'orders-api', path: 'src/worker/charge.ts', startLine: 3, endLine: 8, language: 'typescript', snippet: CHARGE_SNIPPET },
      },
      {
        id: 'emit', label: 'emit(order.paid)', role: 'logic', kind: L('evento de dominio', 'domain event'), parent: 'worker', change: 'added',
        summary: L('Publica que la orden quedó paga.', 'Publishes that the order was paid.'),
      },
      {
        id: 'inventory', label: 'Inventory DB', role: 'storage', kind: 'PostgreSQL', repo: 'orders-api',
        summary: L('Guarda el stock y lo bloquea por fila durante la reserva.', 'Stores stock and locks it per row during reservation.'),
        scale: {
          low: { status: 'ok', note: L('Sin contención.', 'No contention.') },
          medium: { status: 'strained', note: L('Esperas cortas en productos populares.', 'Short waits on popular products.') },
          high: { status: 'saturated', note: L('El lock por fila serializa las reservas del mismo producto.', 'Row locks serialize reservations of the same product.') },
          strategy: 'none',
          advice: L('Sumar réplicas no ayuda: particionar stock por SKU o usar reservas optimistas.', 'Replicas do not help: partition stock per SKU or use optimistic reservations.'),
        },
      },
      {
        id: 'payments', label: 'Payments', role: 'external', kind: 'Stripe API',
        summary: L('Proveedor externo que cobra la tarjeta.', 'External provider that charges the card.'),
        scale: {
          low: { status: 'ok', note: L('Sin problemas.', 'No issues.') },
          medium: { status: 'ok', note: L('Dentro de los rate limits.', 'Within rate limits.') },
          high: { status: 'strained', note: L('Respuestas 429 por rate limit.', '429 responses from rate limiting.') },
          strategy: 'external',
          advice: L('Backoff exponencial y reintentos idempotentes.', 'Exponential backoff and idempotent retries.'),
        },
      },
      {
        id: 'email', label: 'Email provider', role: 'external', kind: 'transactional email',
        summary: L('Envía la confirmación al cliente.', 'Sends the confirmation to the customer.'),
        scale: {
          low: { status: 'ok', note: L('Sin problemas.', 'No issues.') },
          medium: { status: 'ok', note: L('Sin problemas.', 'No issues.') },
          high: { status: 'ok', note: L('Asíncrono: un atraso no bloquea la compra.', 'Asynchronous: delays do not block the purchase.') },
          strategy: 'external',
        },
      },
    ],
    edges: [
      { id: 'e-checkout-api', from: 'checkout', to: 'api', kind: 'sync', label: 'POST /orders' },
      { id: 'e-api-queue', from: 'api', to: 'orders-queue', kind: 'async', label: 'enqueue' },
      { id: 'e-queue-worker', from: 'orders-queue', to: 'worker', kind: 'async', label: 'consume' },
      { id: 'e-reserve-inventory', from: 'reserve-stock', to: 'inventory', kind: 'write', label: 'reserve stock' },
      { id: 'e-lock-inventory', from: 'lock-rows', to: 'inventory', kind: 'read', label: 'FOR UPDATE' },
      { id: 'e-lock-check', from: 'lock-rows', to: 'check-qty', kind: 'calls' },
      { id: 'e-check-row', from: 'check-qty', to: 'stock-row', kind: 'write', label: 'qty - k' },
      { id: 'e-reserve-charge', from: 'reserve-stock', to: 'charge', kind: 'calls' },
      { id: 'e-charge-emit', from: 'charge', to: 'emit', kind: 'calls' },
      { id: 'e-charge-payments', from: 'charge', to: 'payments', kind: 'calls', label: 'charge' },
      { id: 'e-emit-email', from: 'emit', to: 'email', kind: 'async', label: 'order.paid' },
    ],
    steps: [
      {
        id: 's1', narration: L('El cliente toca "Pagar": el checkout envía la orden a la API.', 'The customer presses "Pay": checkout sends the order to the API.'),
        focus: ['api'], travel: { edgeId: 'e-checkout-api', payload: 'POST' },
        payload: { format: 'json', after: '{\n  "items": [{ "sku": "TSHIRT-M", "qty": 2 }],\n  "total": 59.8\n}' },
      },
      {
        id: 's2', narration: L('La API valida, guarda la orden y la encola. Responde 202 al instante.', 'The API validates, stores and enqueues the order. It answers 202 right away.'),
        focus: ['orders-queue'], travel: { edgeId: 'e-api-queue', payload: 'order' },
        payload: { format: 'json', before: '{ "items": [...], "total": 59.8 }', after: '{\n  "orderId": "ord_91",\n  "attempt": 1\n}' },
      },
      {
        id: 's3', narration: L('Un worker libre toma la orden de la cola y la procesa.', 'A free worker takes the order from the queue and processes it.'),
        focus: ['worker'], travel: { edgeId: 'e-queue-worker', payload: 'ord_91' }, expand: 'worker',
        substeps: [
          {
            id: 's3-1', narration: L('Reserva el stock de cada ítem dentro de una transacción.', 'Reserves stock for each item inside a transaction.'),
            focus: ['reserve-stock', 'inventory'], travel: { edgeId: 'e-reserve-inventory', payload: 'reserve' }, expand: 'reserve-stock',
            substeps: [
              {
                id: 's3-1-1', narration: L('Bloquea la fila del producto: nadie más puede venderlo hasta que termine.', 'Locks the product row: nobody else can sell it until this finishes.'),
                focus: ['lock-rows', 'inventory'], travel: { edgeId: 'e-lock-inventory', payload: 'FOR UPDATE' },
                annotate: [{ nodeId: 'lock-rows', text: L('1 reserva a la vez por SKU', '1 reservation at a time per SKU') }],
              },
              {
                id: 's3-1-2', narration: L('La base devuelve la fila bloqueada con la cantidad actual.', 'The database returns the locked row with the current quantity.'),
                focus: ['lock-rows'], travel: { edgeId: 'e-lock-inventory', reverse: true, payload: 'qty = 3' },
              },
              {
                id: 's3-1-3', narration: L('Verifica que alcance: 3 disponibles, se piden 2.', 'Checks there is enough: 3 available, 2 requested.'),
                focus: ['check-qty'], travel: { edgeId: 'e-lock-check' },
              },
              {
                id: 's3-1-4', narration: L('Descuenta la cantidad; el lock se libera al hacer commit.', 'Decrements the quantity; the lock is released on commit.'),
                focus: ['stock-row'], travel: { edgeId: 'e-check-row', payload: '-2' },
                payload: { format: 'sql', before: 'qty = 3', after: "UPDATE stock SET qty = qty - 2\nWHERE sku = 'TSHIRT-M';  -- qty = 1" },
              },
            ],
          },
          { id: 's3-2', narration: L('Con el stock reservado, pasa a cobrar.', 'With stock reserved, it moves on to charge.'), focus: ['charge'], travel: { edgeId: 'e-reserve-charge' } },
          { id: 's3-3', narration: L('Si el cobro sale bien, emite el evento de orden paga.', 'When the charge succeeds, it emits the order-paid event.'), focus: ['emit'], travel: { edgeId: 'e-charge-emit' } },
        ],
      },
      {
        id: 's4', narration: L('El worker cobra con el proveedor de pagos usando una clave de idempotencia.', 'The worker charges through the payment provider with an idempotency key.'),
        focus: ['payments'], highlight: ['worker'], travel: { edgeId: 'e-charge-payments', payload: '$59.80' },
      },
      {
        id: 's5', narration: L('El evento dispara el mail de confirmación. Fin del recorrido.', 'The event triggers the confirmation email. End of the walkthrough.'),
        focus: ['email'], travel: { edgeId: 'e-emit-email', payload: 'order.paid' },
      },
    ],
    risks: [
      {
        id: 'r-lock', category: 'performance', severity: 'high', nodeIds: ['lock-rows', 'inventory'],
        title: L('Contención de locks en productos populares', 'Lock contention on popular products'),
        explanation: L('Todas las reservas de un mismo SKU esperan en fila por el mismo lock de fila.', 'Every reservation of the same SKU waits in line for the same row lock.'),
        mitigation: L('Particionar el stock en "buckets" por SKU o reservar de forma optimista con reintento.', 'Split stock into per-SKU buckets or reserve optimistically with retry.'),
      },
      {
        id: 'r-double-charge', category: 'reliability', severity: 'critical', nodeIds: ['charge', 'orders-queue'],
        title: L('Doble cobro si el mensaje se reentrega', 'Double charge when a message is redelivered'),
        explanation: L('La cola entrega al menos una vez: si el worker muere después de cobrar, otro worker vuelve a cobrar.', 'The queue delivers at least once: if a worker dies after charging, another worker charges again.'),
        mitigation: L('Clave de idempotencia por orden (ya aplicada en este cambio) y registrar el cobro antes de confirmar el mensaje.', 'Per-order idempotency key (added in this change) and record the charge before acknowledging the message.'),
      },
      {
        id: 'r-deadlock', category: 'reliability', severity: 'medium', nodeIds: ['lock-rows'],
        title: L('Deadlocks entre órdenes', 'Deadlocks between orders'),
        explanation: L('Dos órdenes que bloquean los mismos SKUs en distinto orden pueden trabarse mutuamente.', 'Two orders locking the same SKUs in a different order can block each other.'),
        mitigation: L('Ordenar los ítems por SKU antes de bloquear.', 'Sort items by SKU before locking.'),
      },
      {
        id: 'r-amount', category: 'security', severity: 'high', nodeIds: ['api'],
        title: L('El total viene del cliente', 'The total comes from the client'),
        explanation: L('Si la API confía en el total enviado por el navegador, un usuario puede pagar menos.', 'If the API trusts the total sent by the browser, a user can pay less.'),
        mitigation: L('Recalcular precios y total del lado servidor.', 'Recompute prices and totals on the server.'),
      },
      {
        id: 'r-pci', category: 'security', severity: 'medium', nodeIds: ['payments', 'checkout'],
        title: L('Datos de tarjeta', 'Card data'),
        explanation: L('Los datos de tarjeta nunca deben pasar por nuestros servidores.', 'Card data must never pass through our servers.'),
        mitigation: L('Tokenizar en el navegador con el SDK del proveedor.', 'Tokenize in the browser with the provider SDK.'),
      },
      {
        id: 'r-roundtrips', category: 'complexity', severity: 'low', nodeIds: ['reserve-stock'],
        title: L('Un round-trip por ítem', 'One round-trip per item'),
        explanation: L('reserveStock hace k consultas secuenciales: O(k) viajes a la base mientras sostiene locks.', 'reserveStock issues k sequential queries: O(k) database trips while holding locks.'),
        mitigation: L('Bloquear y actualizar todos los SKUs en una sola consulta.', 'Lock and update all SKUs in a single query.'),
      },
    ],
  };
};

export const checkoutEs = defineScene(build('es'));
export const checkoutEn = defineScene(build('en'));
