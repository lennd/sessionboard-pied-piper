import os

import psycopg
import requests
from bullmq import Worker


def charge(order_id):
    response = requests.post("https://api.stripe.com/v1/charges", data={"order": order_id}, headers={"Authorization": os.environ["STRIPE_KEY"]})
    response.raise_for_status()


async def process(job, token):
    order_id = job.data["orderId"]
    charge(order_id)
    with psycopg.connect(os.getenv("DATABASE_URL")) as conn:
        conn.execute("update orders set status = 'paid' where id = %s", (order_id,))


worker = Worker("orders", process)
