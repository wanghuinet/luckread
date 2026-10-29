import CheckoutResultClient from './CheckoutResultClient'

type CheckoutResultPageProps = {
  searchParams: Promise<{
    orderId?: string | string[]
    contentId?: string | string[]
  }>
}

export default async function CheckoutResultPage({ searchParams }: CheckoutResultPageProps) {
  const query = await searchParams
  const orderId = typeof query.orderId === 'string' ? query.orderId : ''
  const contentId = typeof query.contentId === 'string' ? query.contentId : undefined

  return (
    <main>
      <CheckoutResultClient orderId={orderId} contentId={contentId} />
    </main>
  )
}
