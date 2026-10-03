import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('LuckRead H5 blue design system', () => {
  it('defines shared blue design tokens and applies them to shared frontend surfaces', () => {
    const styles = read('src/app/(frontend)/styles.css')
    const login = read('src/app/(frontend)/login/login.css')
    const register = read('src/app/(frontend)/register/register.css')
    const publish = read('src/app/(frontend)/publish/publish.css')
    const subscriptions = read('src/app/(frontend)/me/subscriptions/subscriptions.css')

    expect(styles).toContain('--lr-blue-600: #2563eb')
    expect(styles).toContain('--lr-h5-bg: #f5f9ff')
    expect(styles).toContain('.lr-auth-shell')
    expect(styles).toContain('.content-browse')
    expect(styles).toContain('.content-detail')
    expect(styles).toContain('.my-subscriptions')
    expect(styles).toContain('.lr-publish-shell')

    expect(login).toContain('#2563eb')
    expect(register).toContain('#2563eb')
    expect(publish).toContain('#2563eb')
    expect(subscriptions).toContain('#175cd3')
  })

  it('does not introduce another frontend page directory for the blue redesign', () => {
    const styles = read('src/app/(frontend)/styles.css')
    expect(styles).toContain('LuckRead Blue H5 design system')
  })
})
