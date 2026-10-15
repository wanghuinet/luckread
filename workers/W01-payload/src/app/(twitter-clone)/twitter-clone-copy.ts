import type { PublicLocale } from '../(frontend)/i18n/public-locale'

export type TwitterCloneCopy = {
  landing: { happeningNow: string; joinToday: string; signUp: string; or: string; signIn: string; termsNotice: string; alreadyHaveAccount: string; explore: string; shortVideos: string; creatorStudio: string; subscriptions: string }
  home: { home: string; explore: string; connections: string; following: string; bookmarks: string; videos: string; profile: string; post: string; profileAndSettings: string; exploreAll: string; forYou: string; followingTab: string; composePlaceholder: string; search: string; whatToExplore: string; articlesAndDiscussions: string; shortVideos: string; followingAndCreators: string; subscriptions: string; forCreators: string; creatorDescription: string; openCreatorStudio: string; apiProtection: string }
  feed: { timeline: string; noPublicContent: string; emptyDescription: string; exploreContent: string; loadMoreError: string; retry: string; loading: string; loadingMore: string }
}

const copy: Record<PublicLocale, TwitterCloneCopy> = {
  en: {
    landing: { happeningNow: 'Happening now', joinToday: 'Join LuckRead today.', signUp: 'Sign up with email', or: 'or', signIn: 'Sign in', termsNotice: "By signing up, you agree to LuckRead's terms and privacy practices. LuckRead account, publishing, and social actions remain protected by the existing account and permission services.", alreadyHaveAccount: 'Already have an account?', explore: 'Explore', shortVideos: 'Short videos', creatorStudio: 'Creator Studio', subscriptions: 'Subscriptions' },
    home: { home: 'Home', explore: 'Explore', connections: 'Connections', following: 'Following', bookmarks: 'Bookmarks', videos: 'Videos', profile: 'Profile', post: 'Post', profileAndSettings: 'Profile and settings', exploreAll: 'Explore all', forYou: 'For you', followingTab: 'Following', composePlaceholder: 'What is happening?!', search: 'Search LuckRead', whatToExplore: 'What to explore', articlesAndDiscussions: 'Articles and discussions', shortVideos: 'Short videos', followingAndCreators: 'Following and creators', subscriptions: 'Subscriptions', forCreators: 'For creators', creatorDescription: 'Publish articles, posts, and videos from the existing LuckRead creator workflow.', openCreatorStudio: 'Open Creator Studio', apiProtection: 'LuckRead account, content, social, and subscription actions stay connected to the existing APIs.' },
    feed: { timeline: 'LuckRead timeline', noPublicContent: 'No public content yet', emptyDescription: 'Explore available articles, discussions, and videos, or publish your first post if your account has creator access.', exploreContent: 'Explore content', loadMoreError: 'Unable to load more content.', retry: 'Retry', loading: 'Loading…', loadingMore: 'Loading more as you scroll' },
  },
  zh: {
    landing: { happeningNow: '正在发生的事', joinToday: '立即加入 LuckRead。', signUp: '使用邮箱注册', or: '或', signIn: '登录', termsNotice: '注册即表示你同意 LuckRead 的服务条款与隐私规则。账号、内容发布和社交操作继续由现有账户与权限服务保护。', alreadyHaveAccount: '已经有账号了？', explore: '发现内容', shortVideos: '短视频', creatorStudio: '创作者中心', subscriptions: '订阅' },
    home: { home: '首页', explore: '发现', connections: '关系', following: '关注中', bookmarks: '收藏夹', videos: '视频', profile: '个人主页', post: '发布', profileAndSettings: '个人主页与设置', exploreAll: '查看全部', forYou: '为你推荐', followingTab: '关注', composePlaceholder: '有什么新鲜事？', search: '搜索 LuckRead', whatToExplore: '探索内容', articlesAndDiscussions: '文章与讨论', shortVideos: '短视频', followingAndCreators: '关注与创作者', subscriptions: '订阅', forCreators: '创作者入口', creatorDescription: '通过 LuckRead 现有的创作者流程发布文章、动态和视频。', openCreatorStudio: '进入创作者中心', apiProtection: 'LuckRead 的账户、内容、社交与订阅操作继续连接现有 API。' },
    feed: { timeline: 'LuckRead 动态流', noPublicContent: '暂时没有公开内容', emptyDescription: '浏览可阅读的文章、讨论和视频；如果你的账号拥有创作者权限，也可以发布第一条动态。', exploreContent: '发现内容', loadMoreError: '暂时无法加载更多内容。', retry: '重试', loading: '正在加载…', loadingMore: '继续滚动以加载更多' },
  },
  tw: {
    landing: { happeningNow: '正在發生的事', joinToday: '立即加入 LuckRead。', signUp: '使用電子郵件註冊', or: '或', signIn: '登入', termsNotice: '註冊即表示你同意 LuckRead 的服務條款與隱私規則。帳號、內容發布和社交操作仍由現有帳戶與權限服務保護。', alreadyHaveAccount: '已經有帳號了？', explore: '探索內容', shortVideos: '短影片', creatorStudio: '創作者中心', subscriptions: '訂閱' },
    home: { home: '首頁', explore: '探索', connections: '關係', following: '追蹤中', bookmarks: '書籤', videos: '影片', profile: '個人主頁', post: '發布', profileAndSettings: '個人主頁與設定', exploreAll: '查看全部', forYou: '為你推薦', followingTab: '追蹤中', composePlaceholder: '有什麼新鮮事？', search: '搜尋 LuckRead', whatToExplore: '探索內容', articlesAndDiscussions: '文章與討論', shortVideos: '短影片', followingAndCreators: '追蹤與創作者', subscriptions: '訂閱', forCreators: '創作者入口', creatorDescription: '透過 LuckRead 現有的創作者流程發布文章、動態和影片。', openCreatorStudio: '進入創作者中心', apiProtection: 'LuckRead 的帳戶、內容、社交與訂閱操作繼續連接現有 API。' },
    feed: { timeline: 'LuckRead 動態流', noPublicContent: '暫時沒有公開內容', emptyDescription: '瀏覽可閱讀的文章、討論和影片；若你的帳號具備創作者權限，也可以發布第一則動態。', exploreContent: '探索內容', loadMoreError: '暫時無法載入更多內容。', retry: '重試', loading: '載入中…', loadingMore: '繼續捲動以載入更多' },
  },
}

export const getTwitterCloneCopy = (locale: PublicLocale): TwitterCloneCopy => copy[locale]
