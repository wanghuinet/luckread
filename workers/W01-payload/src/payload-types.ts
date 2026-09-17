/* tslint:disable */
/* eslint-disable */
/**
 * Cloudflare D1 Payload baseline types.
 *
 * This file is an upstream baseline copied from the official
 * with-cloudflare-d1 template. It must be regenerated with
 * `payload generate:types` after LuckRead collections/contracts change.
 */
export type SupportedTimezones =
  | 'Pacific/Midway'
  | 'Pacific/Niue'
  | 'Pacific/Honolulu'
  | 'America/Anchorage'
  | 'America/Los_Angeles'
  | 'America/Denver'
  | 'America/Chicago'
  | 'America/New_York'
  | 'Europe/London'
  | 'Europe/Berlin'
  | 'Asia/Shanghai'
  | 'Asia/Tokyo'
  | 'Australia/Sydney'

export interface Config {
  auth: { users: UserAuthOperations }
  blocks: {}
  collections: {
    users: User
    media: Media
    'payload-kv': PayloadKv
    'payload-locked-documents': PayloadLockedDocument
    'payload-preferences': PayloadPreference
    'payload-migrations': PayloadMigration
  }
  collectionsJoins: {}
  collectionsSelect: {
    users: UsersSelect<false> | UsersSelect<true>
    media: MediaSelect<false> | MediaSelect<true>
    'payload-kv': PayloadKvSelect<false> | PayloadKvSelect<true>
    'payload-locked-documents': PayloadLockedDocumentsSelect<false> | PayloadLockedDocumentsSelect<true>
    'payload-preferences': PayloadPreferencesSelect<false> | PayloadPreferencesSelect<true>
    'payload-migrations': PayloadMigrationsSelect<false> | PayloadMigrationsSelect<true>
  }
  db: { defaultIDType: number }
  fallbackLocale: null
  globals: {}
  globalsSelect: {}
  locale: null
  widgets: { collections: CollectionsWidget }
  user: User
  jobs: { tasks: unknown; workflows: unknown }
}

export interface UserAuthOperations {
  forgotPassword: { email: string; password: string }
  login: { email: string; password: string }
  registerFirstUser: { email: string; password: string }
  unlock: { email: string; password: string }
}

export interface User {
  id: number
  updatedAt: string
  createdAt: string
  email: string
  resetPasswordToken?: string | null
  resetPasswordExpiration?: string | null
  salt?: string | null
  hash?: string | null
  loginAttempts?: number | null
  lockUntil?: string | null
  sessions?: { id: string; createdAt?: string | null; expiresAt: string }[] | null
  password?: string | null
  collection: 'users'
}

export interface Media {
  id: number
  alt: string
  updatedAt: string
  createdAt: string
  url?: string | null
  thumbnailURL?: string | null
  filename?: string | null
  mimeType?: string | null
  filesize?: number | null
  width?: number | null
  height?: number | null
}

export interface PayloadKv {
  id: number
  key: string
  data: { [k: string]: unknown } | unknown[] | string | number | boolean | null
}

export interface PayloadLockedDocument {
  id: number
  document?:
    | { relationTo: 'users'; value: number | User }
    | { relationTo: 'media'; value: number | Media }
    | null
  globalSlug?: string | null
  user: { relationTo: 'users'; value: number | User }
  updatedAt: string
  createdAt: string
}

export interface PayloadPreference {
  id: number
  user: { relationTo: 'users'; value: number | User }
  key?: string | null
  value?: { [k: string]: unknown } | unknown[] | string | number | boolean | null
  updatedAt: string
  createdAt: string
}

export interface PayloadMigration {
  id: number
  name?: string | null
  batch?: number | null
  updatedAt: string
  createdAt: string
}

export interface UsersSelect<T extends boolean = true> {
  updatedAt?: T; createdAt?: T; email?: T; resetPasswordToken?: T
  resetPasswordExpiration?: T; salt?: T; hash?: T; loginAttempts?: T; lockUntil?: T
  sessions?: T | { id?: T; createdAt?: T; expiresAt?: T }
}

export interface MediaSelect<T extends boolean = true> {
  alt?: T; updatedAt?: T; createdAt?: T; url?: T; thumbnailURL?: T
  filename?: T; mimeType?: T; filesize?: T; width?: T; height?: T
}

export interface PayloadKvSelect<T extends boolean = true> { key?: T; data?: T }
export interface PayloadLockedDocumentsSelect<T extends boolean = true> {
  document?: T; globalSlug?: T; user?: T; updatedAt?: T; createdAt?: T
}
export interface PayloadPreferencesSelect<T extends boolean = true> {
  user?: T; key?: T; value?: T; updatedAt?: T; createdAt?: T
}
export interface PayloadMigrationsSelect<T extends boolean = true> {
  name?: T; batch?: T; updatedAt?: T; createdAt?: T
}
export interface CollectionsWidget { data?: { [k: string]: unknown }; width: 'full' }
export interface Auth { [k: string]: unknown }

declare module 'payload' {
  export interface GeneratedTypes extends Config {}
}
