import { cookies } from 'next/headers'

import { normalizePublicLocale, type PublicLocale } from '../../../(frontend)/i18n/public-locale'
import MySubscriptionsPage from '../../../(frontend)/me/subscriptions/MySubscriptionsPage'
import TwitterCloneSecondaryPageLayout from '../../TwitterCloneSecondaryPageLayout'

export const dynamic = 'force-dynamic'

const titleFor = (locale: PublicLocale) => locale === 'en'
  ? 'Subscriptions'
  : locale === 'tw'
    ? '訂閱'
    : '我的订阅'

export default async function TwitterCloneSubscriptionsPage() {
  const locale = normalizePublicLocale((await cookies()).get('luckread-ui-locale')?.value)
  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={titleFor(locale)} active="subscriptions">
      <MySubscriptionsPage />
    </TwitterCloneSecondaryPageLayout>
  )
}
