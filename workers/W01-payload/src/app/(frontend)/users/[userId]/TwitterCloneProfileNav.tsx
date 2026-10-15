import type { MouseEvent } from 'react'

type ProfileContentType = 'post' | 'article' | 'video'

type Props = {
  selected: ProfileContentType
  labels: Record<ProfileContentType, string>
  onSelect: (type: ProfileContentType) => void
}

/**
 * A small, reusable profile-channel navigation adapted from ccrsxx/twitter-clone's
 * UserNav / UserNavLink composition. It owns only the selected presentation state;
 * the parent continues to fetch authorized LuckRead content.
 */
export default function TwitterCloneProfileNav({ selected, labels, onSelect }: Props) {
  const select = (event: MouseEvent<HTMLButtonElement>, type: ProfileContentType) => {
    event.preventDefault()
    onSelect(type)
  }

  return (
    <nav className="creator-profile-tabs" aria-label="作者内容频道" role="tablist">
      {(Object.keys(labels) as ProfileContentType[]).map((type) => (
        <button
          className={'creator-profile-tab' + (selected === type ? ' is-active' : '')}
          key={type}
          aria-selected={selected === type}
          role="tab"
          type="button"
          onClick={(event) => select(event, type)}
        >
          {labels[type]}
        </button>
      ))}
    </nav>
  )
}
