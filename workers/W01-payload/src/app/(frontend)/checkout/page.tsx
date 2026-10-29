import CheckoutClient from './CheckoutClient'

type CheckoutPageProps = { searchParams: Promise<{ orderId?: string | string[]; contentId?: string | string[] }> }

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const query = await searchParams
  const orderId = typeof query.orderId === 'string' ? query.orderId : ''
  const contentId = typeof query.contentId === 'string' ? query.contentId : undefined
  return (
    <main>
      <CheckoutClient orderId={orderId} contentId={contentId} />
    </main>
  )
}
