import { cookies } from 'next/headers'

import { normalizePublicLocale, type PublicLocale } from '../../../(frontend)/i18n/public-locale'
import BillingHistoryPage from '../../../(frontend)/me/billing-history/BillingHistoryPage'
import TwitterCloneSecondaryPageLayout from '../../TwitterCloneSecondaryPageLayout'

export const dynamic = 'force-dynamic'

const titleFor = (locale: PublicLocale) => locale === 'en'
  ? 'Billing and orders'
  : locale === 'tw'
    ? '帳單與訂單'
    : '账单与订单'

export default async function TwitterCloneBillingHistoryPage() {
  const locale = normalizePublicLocale((await cookies()).get('luckread-ui-locale')?.value)
  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={titleFor(locale)} active="none">
      <BillingHistoryPage />
    </TwitterCloneSecondaryPageLayout>
  )
}
