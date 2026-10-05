export type PublicLocale = 'zh' | 'en' | 'tw'

export const PUBLIC_LOCALE_COOKIE = 'luckread-ui-locale'

export const PUBLIC_LOCALES: ReadonlyArray<{ value: PublicLocale; label: string }> = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'tw', label: '繁中' },
]

export const normalizePublicLocale = (value: string | undefined | null): PublicLocale => {
  switch (value) {
    case 'en':
    case 'en-US':
      return 'en'
    case 'tw':
    case 'zh-TW':
      return 'tw'
    case 'zh':
    case 'zh-CN':
    default:
      return 'zh'
  }
}

export const readPublicLocaleCookie = (): PublicLocale => {
  if (typeof document === 'undefined') return 'zh'
  const match = document.cookie.match(/(?:^|; )luckread-ui-locale=([^;]*)/)
  if (!match) return 'zh'
  try {
    return normalizePublicLocale(decodeURIComponent(match[1]))
  } catch {
    return 'zh'
  }
}

type Copy = {
  common: {
    home: string
    discover: string
    creators: string
    about: string
    profile: string
    subscriptions: string
    login: string
    creatorCenter: string
    createNow: string
    explore: string
    backHome: string
    startCreating: string
  }
  home: {
    heroEyebrow: string
    heroTitle: string
    heroLead: string
    categoryAria: string
    exploreEyebrow: string
    exploreTitle: string
    exploreDescription: string
    feedEyebrow: string
    feedTitle: string
    feedAll: string
    highlightAria: string
    highlight: Array<{ eyebrow: string; title: string; body: string }>
    creatorEyebrow: string
    creatorTitle: string
    creatorDescription: string
    footerTagline: string
    footerDescription: string
    creatorCenter: string
  }
  content: {
    eyebrow: string
    title: string
    description: string
    typeAria: string
    tabs: { all: string; article: string; post: string; video: string }
    loading: string
    loadingAria: string
    error: string
    retry: string
    empty: string
    firstPublish: string
    published: string
    open: string
    more: string
    cover: string
  }
  detail: {
    loading: string
    notFound: string
    retry: string
    backDiscover: string
    published: string
    author: string
    own: string
    restricted: string
    following: string
    follow: string
    liked: string
    like: string
    favorited: string
    favorite: string
    generating: string
    copied: string
    share: string
    reporting: string
    report: string
    linkError: string
    networkError: string
    shareOpened: string
    bodyPreparing: string
    updatedAt: string
    tagAria: string
    cover: string
    image: string
    video: string
  }
  comments: {
    title: string
    formLabel: string
    replyPlaceholder: string
    commentPlaceholder: string
    cancelReply: string
    submitting: string
    submit: string
    restricted: string
    loading: string
    empty: string
    reader: string
    profile: string
    edit: string
    cancel: string
    saving: string
    save: string
    processing: string
    liked: string
    like: string
    deleting: string
    delete: string
    reply: string
    more: string
    tooManyReplies: string
    conflict: string
    loadError: string
    submitError: string
    likeError: string
    deleteError: string
    updateError: string
    networkError: string
  }
}

const copy: Record<PublicLocale, Copy> = {
  zh: {
    common: { home: '首页', discover: '发现', creators: '创作者', about: '关于 LuckRead', profile: '我的资料', subscriptions: '我的订阅', login: '登录', creatorCenter: '创作者中心', createNow: '立即创作', explore: '探索内容', backHome: '返回首页', startCreating: '开始创作' },
    home: {
      heroEyebrow: '发现 · 创作 · 连接', heroTitle: '让好内容<accent>被看见</accent>', heroLead: 'LuckRead 是面向新一代创作者与读者的内容平台。\n在这里，阅读获得启发，表达创造价值，人与人因内容相遇。',
      categoryAria: '内容类型', exploreEyebrow: 'A place for better content', exploreTitle: '不追逐喧嚣，<br />更在意内容本身。', exploreDescription: '我们希望把首页做成一扇安静而有力量的门：打开得快，读起来舒服，让真正有价值的观点、经验与作品，在更合适的场景里被发现。',
      feedEyebrow: 'Latest from LuckRead', feedTitle: '正在发生的内容', feedAll: '查看全部 ↗', highlightAria: '平台价值',
      highlight: [
        { eyebrow: '发现', title: '从日常阅读，到更广阔的世界', body: '汇聚图文、视频与深度内容，让每一次停留都有值得带走的东西。' },
        { eyebrow: '创作', title: '让每一种表达，都有被看见的机会', body: '一个创作者中心，覆盖文章、动态与视频发布，轻装上阵，持续创作。' },
        { eyebrow: '连接', title: '让人与内容，形成长期的价值连接', body: '从公开分享，到订阅与专业服务，建立更有温度、更有秩序的内容生态。' },
      ],
      creatorEyebrow: 'For creators', creatorTitle: '写下你的观点，<br />发布你的作品。', creatorDescription: '从一篇文章、一条动态到一段视频，LuckRead 为创作者准备了轻量、清晰、可持续的发布入口。', footerTagline: '让好内容被看见', footerDescription: '发现值得阅读的内容，也创造值得留下的内容。', creatorCenter: '进入创作者中心',
    },
    content: {
      eyebrow: 'EXPLORE LUCKREAD', title: '发现内容', description: '从文章、动态到视频，浏览已经通过发布流程并公开展示的内容。', typeAria: '内容类型筛选',
      tabs: { all: '全部', article: '文章', post: '动态', video: '视频' }, loading: '正在加载内容…', loadingAria: '正在加载公开内容', error: '内容加载失败', retry: '重新加载', empty: '还没有公开内容。', firstPublish: '发布第一篇内容', published: '已发布', open: '打开内容 ↗', more: '加载更多', cover: '内容封面',
    },
    detail: {
      loading: '正在加载内容…', notFound: '内容不存在。', retry: '重新加载', backDiscover: '← 返回发现', published: '已发布', author: '查看作者', own: '这是你的作品', restricted: '当前关系受屏蔽规则限制。', following: '已关注作者', follow: '关注作者', liked: '已点赞', like: '点赞', favorited: '已收藏', favorite: '收藏', generating: '生成中…', copied: '分享链接已复制', share: '分享', reporting: '举报中…', report: '举报',
      linkError: '分享链接生成失败，请稍后重试。', networkError: '网络异常，请稍后重试。', shareOpened: '已打开系统分享面板。', bodyPreparing: '正文内容正在准备中。', updatedAt: '更新于', tagAria: '内容标签与提及', cover: '封面', image: '配图', video: '视频',
    },
    comments: {
      title: '评论', formLabel: '发表评论', replyPlaceholder: '写下你的回复…', commentPlaceholder: '写下你的看法…', cancelReply: '取消回复', submitting: '提交中…', submit: '发表评论', restricted: '当前关系受屏蔽规则限制，暂不可发表评论或互动。', loading: '正在加载评论…', empty: '还没有评论，来发表第一条吧。', reader: '读者', profile: '查看主页', edit: '编辑', cancel: '取消', saving: '保存中…', save: '保存修改', processing: '处理中…', liked: '已赞', like: '赞', deleting: '删除中…', delete: '删除', reply: '回复', more: '加载更多评论',
      tooManyReplies: '该评论已有回复，暂不支持删除。', conflict: '评论已经被修改，请刷新后再编辑。', loadError: '评论加载失败', submitError: '评论提交失败，请稍后重试。', likeError: '评论点赞失败，请稍后重试。', deleteError: '评论删除失败，请稍后重试。', updateError: '评论修改失败，请稍后重试。', networkError: '网络异常，请稍后重试。',
    },
  },
  en: {
    common: { home: 'Home', discover: 'Discover', creators: 'Creators', about: 'About LuckRead', profile: 'My profile', subscriptions: 'My subscriptions', login: 'Sign in', creatorCenter: 'Creator Studio', createNow: 'Create now', explore: 'Explore content', backHome: 'Back home', startCreating: 'Start creating' },
    home: {
      heroEyebrow: 'DISCOVER · CREATE · CONNECT', heroTitle: 'Good content<accent> deserves to be seen</accent>', heroLead: 'LuckRead is a content platform for a new generation of creators and readers.\nRead for inspiration, create lasting value, and connect through ideas.',
      categoryAria: 'Content types', exploreEyebrow: 'A place for better content', exploreTitle: 'Less noise.<br />More room for the content itself.', exploreDescription: 'We want the home page to feel calm and useful: fast to open, comfortable to read, and built to surface ideas, experience, and work in the right context.',
      feedEyebrow: 'Latest from LuckRead', feedTitle: 'What is happening', feedAll: 'View all ↗', highlightAria: 'Platform values',
      highlight: [
        { eyebrow: 'Discover', title: 'From everyday reading to a wider world', body: 'Articles, video, and deep content worth taking with you.' },
        { eyebrow: 'Create', title: 'Give every form of expression a chance to be seen', body: 'One creator workspace for articles, posts, and video, designed for consistent publishing.' },
        { eyebrow: 'Connect', title: 'Build lasting value between people and content', body: 'From public sharing to subscriptions and professional services, with a clear content experience.' },
      ],
      creatorEyebrow: 'For creators', creatorTitle: 'Write your ideas,<br />publish your work.', creatorDescription: 'From an article or post to a video, LuckRead gives creators a lightweight, clear, sustainable publishing entry point.', footerTagline: 'Let good content be seen', footerDescription: 'Discover content worth reading, and create content worth keeping.', creatorCenter: 'Open Creator Studio',
    },
    content: {
      eyebrow: 'EXPLORE LUCKREAD', title: 'Discover content', description: 'Browse published articles, posts, and videos that have completed the publishing flow.', typeAria: 'Filter content type',
      tabs: { all: 'All', article: 'Articles', post: 'Posts', video: 'Videos' }, loading: 'Loading content…', loadingAria: 'Loading public content', error: 'Content could not be loaded.', retry: 'Retry', empty: 'No public content yet.', firstPublish: 'Publish the first piece', published: 'Published', open: 'Open content ↗', more: 'Load more', cover: 'Content cover',
    },
    detail: {
      loading: 'Loading content…', notFound: 'Content not found.', retry: 'Retry', backDiscover: '← Back to discover', published: 'Published', author: 'View creator', own: 'This is your work', restricted: 'This relationship is restricted by blocking rules.', following: 'Following', follow: 'Follow creator', liked: 'Liked', like: 'Like', favorited: 'Saved', favorite: 'Save', generating: 'Generating…', copied: 'Share link copied', share: 'Share', reporting: 'Reporting…', report: 'Report',
      linkError: 'Could not generate a share link. Please try again.', networkError: 'Network error. Please try again.', shareOpened: 'System share panel opened.', bodyPreparing: 'The body is being prepared.', updatedAt: 'Updated', tagAria: 'Content tags and mentions', cover: 'Cover', image: 'Image', video: 'Video',
    },
    comments: {
      title: 'Comments', formLabel: 'Leave a comment', replyPlaceholder: 'Write your reply…', commentPlaceholder: 'Share your thoughts…', cancelReply: 'Cancel reply', submitting: 'Submitting…', submit: 'Comment', restricted: 'This relationship is restricted by blocking rules. Comments and interactions are unavailable.', loading: 'Loading comments…', empty: 'No comments yet. Be the first to comment.', reader: 'Reader', profile: 'View profile', edit: 'Edit', cancel: 'Cancel', saving: 'Saving…', save: 'Save changes', processing: 'Working…', liked: 'Liked', like: 'Like', deleting: 'Deleting…', delete: 'Delete', reply: 'Reply', more: 'Load more comments',
      tooManyReplies: 'This comment has replies and cannot be deleted yet.', conflict: 'This comment changed. Refresh before editing.', loadError: 'Comments could not be loaded.', submitError: 'Comment could not be submitted. Please try again.', likeError: 'Comment like failed. Please try again.', deleteError: 'Comment could not be deleted. Please try again.', updateError: 'Comment could not be updated. Please try again.', networkError: 'Network error. Please try again.',
    },
  },
  tw: {
    common: { home: '首頁', discover: '探索', creators: '創作者', about: '關於 LuckRead', profile: '我的資料', subscriptions: '我的訂閱', login: '登入', creatorCenter: '創作者中心', createNow: '立即創作', explore: '探索內容', backHome: '返回首頁', startCreating: '開始創作' },
    home: {
      heroEyebrow: '發現 · 創作 · 連結', heroTitle: '讓好內容<accent>被看見</accent>', heroLead: 'LuckRead 是面向新一代創作者與讀者的內容平台。\n在這裡，閱讀獲得啟發，表達創造價值，人與人因內容相遇。',
      categoryAria: '內容類型', exploreEyebrow: 'A place for better content', exploreTitle: '不追逐喧囂，<br />更在意內容本身。', exploreDescription: '我們希望把首頁做成一扇安靜而有力量的門：開啟得快，讀起來舒服，讓真正有價值的觀點、經驗與作品，在更合適的場景裡被發現。',
      feedEyebrow: 'Latest from LuckRead', feedTitle: '正在發生的內容', feedAll: '查看全部 ↗', highlightAria: '平台價值',
      highlight: [
        { eyebrow: '發現', title: '從日常閱讀，到更廣闊的世界', body: '匯聚圖文、影片與深度內容，讓每一次停留都有值得帶走的東西。' },
        { eyebrow: '創作', title: '讓每一種表達，都有被看見的機會', body: '一個創作者中心，涵蓋文章、動態與影片發布，輕裝上陣，持續創作。' },
        { eyebrow: '連結', title: '讓人與內容，形成長期的價值連結', body: '從公開分享，到訂閱與專業服務，建立更有溫度、更有秩序的內容生態。' },
      ],
      creatorEyebrow: 'For creators', creatorTitle: '寫下你的觀點，<br />發布你的作品。', creatorDescription: '從一篇文章、一則動態到一段影片，LuckRead 為創作者準備輕量、清晰、可持續的發布入口。', footerTagline: '讓好內容被看見', footerDescription: '發現值得閱讀的內容，也創造值得留下的內容。', creatorCenter: '進入創作者中心',
    },
    content: {
      eyebrow: 'EXPLORE LUCKREAD', title: '探索內容', description: '從文章、動態到影片，瀏覽已完成發布流程並公開展示的內容。', typeAria: '內容類型篩選',
      tabs: { all: '全部', article: '文章', post: '動態', video: '影片' }, loading: '正在載入內容…', loadingAria: '正在載入公開內容', error: '內容載入失敗', retry: '重新載入', empty: '目前還沒有公開內容。', firstPublish: '發布第一篇內容', published: '已發布', open: '開啟內容 ↗', more: '載入更多', cover: '內容封面',
    },
    detail: {
      loading: '正在載入內容…', notFound: '內容不存在。', retry: '重新載入', backDiscover: '← 返回探索', published: '已發布', author: '查看作者', own: '這是你的作品', restricted: '目前關係受封鎖規則限制。', following: '已追蹤作者', follow: '追蹤作者', liked: '已按讚', like: '按讚', favorited: '已收藏', favorite: '收藏', generating: '產生中…', copied: '分享連結已複製', share: '分享', reporting: '檢舉中…', report: '檢舉',
      linkError: '分享連結產生失敗，請稍後再試。', networkError: '網路異常，請稍後再試。', shareOpened: '已開啟系統分享面板。', bodyPreparing: '正文內容準備中。', updatedAt: '更新於', tagAria: '內容標籤與提及', cover: '封面', image: '配圖', video: '影片',
    },
    comments: {
      title: '留言', formLabel: '發表留言', replyPlaceholder: '寫下你的回覆…', commentPlaceholder: '寫下你的看法…', cancelReply: '取消回覆', submitting: '提交中…', submit: '發表留言', restricted: '目前關係受封鎖規則限制，暫時無法留言或互動。', loading: '正在載入留言…', empty: '還沒有留言，來發表第一則吧。', reader: '讀者', profile: '查看主頁', edit: '編輯', cancel: '取消', saving: '儲存中…', save: '儲存修改', processing: '處理中…', liked: '已按讚', like: '按讚', deleting: '刪除中…', delete: '刪除', reply: '回覆', more: '載入更多留言',
      tooManyReplies: '此留言已有回覆，暫不支援刪除。', conflict: '留言已被修改，請重新整理後再編輯。', loadError: '留言載入失敗', submitError: '留言提交失敗，請稍後再試。', likeError: '留言按讚失敗，請稍後再試。', deleteError: '留言刪除失敗，請稍後再試。', updateError: '留言修改失敗，請稍後再試。', networkError: '網路異常，請稍後再試。',
    },
  },
}

export const setPublicLocaleCookie = (locale: PublicLocale): void => {
  if (typeof document === 'undefined') return
  document.cookie = PUBLIC_LOCALE_COOKIE + '=' + locale + '; Path=/; Max-Age=31536000; SameSite=Lax'
}

export const getPublicCopy = (locale: PublicLocale): Copy => copy[locale]
