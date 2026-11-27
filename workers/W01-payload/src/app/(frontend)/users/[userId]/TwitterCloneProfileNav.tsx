import type { KeyboardEvent, MouseEvent } from 'react'

type ProfileContentType = 'posts' | 'replies' | 'media' | 'likes' | 'articles'

type Props = {
  selected: ProfileContentType
  labels: Record<ProfileContentType, string>
  onSelect: (type: ProfileContentType) => void
}

const profileChannels: ProfileContentType[] = ['posts', 'replies', 'media', 'likes', 'articles']

/** Adapted from ccrsxx/twitter-clone's UserNav / UserNavLink composition. */
export default function TwitterCloneProfileNav({ selected, labels, onSelect }: Props) {
  const select = (event: MouseEvent<HTMLButtonElement>, type: ProfileContentType) => {
    event.preventDefault()
    onSelect(type)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: ProfileContentType) => {
    const currentIndex = profileChannels.indexOf(current)
    let nextIndex = currentIndex

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % profileChannels.length
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + profileChannels.length) % profileChannels.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = profileChannels.length - 1
    else return

    event.preventDefault()
    const nextType = profileChannels[nextIndex]
    const nextTab = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#profile-tab-${nextType}`)
    nextTab?.focus()
    onSelect(nextType)
  }

  return (
    <nav className="hover-animation flex justify-between overflow-x-auto border-b border-light-border dark:border-dark-border" aria-label="作者内容频道" role="tablist">
      {profileChannels.map((type) => {
        const active = selected === type
        return (
          <button
            className="main-tab dark-bg-tab flex min-w-0 flex-1 justify-center hover:bg-light-primary/10 dark:hover:bg-dark-primary/10"
            key={type}
            id={`profile-tab-${type}`}
            aria-controls="profile-tabpanel"
            aria-selected={active}
            role="tab"
            tabIndex={active ? 0 : -1}
            type="button"
            onClick={(event) => select(event, type)}
            onKeyDown={(event) => handleKeyDown(event, type)}
          >
            <span className="px-3 md:px-6">
              <span className={'flex flex-col gap-3 whitespace-nowrap pt-3 font-bold transition-colors duration-200 ' + (active ? 'text-light-primary dark:text-dark-primary' : 'text-light-secondary dark:text-dark-secondary')}>
                {labels[type]}
                <i aria-hidden="true" className={'h-1 rounded-full bg-main-accent transition duration-200 ' + (active ? 'scale-100 opacity-100' : 'scale-50 opacity-0')} />
              </span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
