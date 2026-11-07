/**
 * Shared visual tokens for LuckRead's X-inspired native social surfaces.
 * Keep these values centralized so feed, profile, composer and navigation
 * converge on one design language without duplicating screen-local colors.
 */
export const X_DESIGN_TOKENS = {
  colors: {
    light: {
      background: '#ffffff',
      surface: '#ffffff',
      text: '#0f1419',
      muted: '#536471',
      border: '#eff3f4',
      primary: '#1d9bf0',
      subtle: '#f7f9f9',
    },
    dark: {
      background: '#000000',
      surface: '#000000',
      text: '#e7e9ea',
      muted: '#71767b',
      border: '#2f3336',
      primary: '#1d9bf0',
      subtle: '#16181c',
    },
  },
  typography: {
    author: 15,
    body: 15,
    bodyLineHeight: 20,
    metadata: 13,
    action: 13,
  },
  spacing: {
    feedHorizontal: 12,
    feedVertical: 12,
    avatarGap: 12,
    bodyTop: 4,
    actionsTop: 12,
  },
  radius: {
    avatar: 999,
    media: 16,
  },
} as const;

export type XDesignColorScheme = keyof typeof X_DESIGN_TOKENS.colors;

export function getXDesignColors(colorScheme: XDesignColorScheme | null | undefined) {
  return colorScheme === 'dark' ? X_DESIGN_TOKENS.colors.dark : X_DESIGN_TOKENS.colors.light;
}
