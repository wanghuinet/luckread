import CheckoutClient from './CheckoutClient'

type CheckoutPageProps = { searchParams: Promise<{ orderId?: string | string[] }> }

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const query = await searchParams
  const orderId = typeof query.orderId === 'string' ? query.orderId : ''
  return (
    <main>
      <CheckoutClient orderId={orderId} />
    </main>
  )
}
