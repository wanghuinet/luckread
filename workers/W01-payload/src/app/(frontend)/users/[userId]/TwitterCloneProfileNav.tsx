import type { MouseEvent } from 'react'

type ProfileContentType = 'posts' | 'replies' | 'media' | 'likes' | 'articles'

type Props = {
  selected: ProfileContentType
  labels: Record<ProfileContentType, string>
  onSelect: (type: ProfileContentType) => void
}

/** Adapted from ccrsxx/twitter-clone's UserNav / UserNavLink composition. */
export default function TwitterCloneProfileNav({ selected, labels, onSelect }: Props) {
  const select = (event: MouseEvent<HTMLButtonElement>, type: ProfileContentType) => {
    event.preventDefault()
    onSelect(type)
  }

  return (
    <nav className="hover-animation flex justify-between overflow-x-auto border-b border-light-border dark:border-dark-border" aria-label="作者内容频道" role="tablist">
      {(Object.keys(labels) as ProfileContentType[]).map((type) => {
        const active = selected === type
        return (
          <button
            className="main-tab dark-bg-tab flex min-w-0 flex-1 justify-center hover:bg-light-primary/10 dark:hover:bg-dark-primary/10"
            key={type}
            aria-selected={active}
            role="tab"
            type="button"
            onClick={(event) => select(event, type)}
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
