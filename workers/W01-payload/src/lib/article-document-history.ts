import type { ArticleDocument } from './article-document.js'
import { tryDeserializeArticleDocument } from './article-document.js'

export const ARTICLE_DOCUMENT_HISTORY_LIMIT = 30

export type ArticleDocumentHistory = {
  past: string[]
  future: string[]
  limit: number
  lastRecordKey: string | null
}

export type ArticleDocumentHistoryRecordOptions = {
  coalesceKey?: string
}

const snapshot = (document: ArticleDocument): string => JSON.stringify(document)

export const createArticleDocumentHistory = (
  limit = ARTICLE_DOCUMENT_HISTORY_LIMIT,
): ArticleDocumentHistory => ({
  past: [],
  future: [],
  limit: Math.max(1, Math.min(limit, ARTICLE_DOCUMENT_HISTORY_LIMIT)),
  lastRecordKey: null,
})

export const recordArticleDocumentHistory = (
  history: ArticleDocumentHistory,
  current: ArticleDocument,
  next: ArticleDocument,
  options: ArticleDocumentHistoryRecordOptions = {},
): ArticleDocumentHistory => {
  const currentSnapshot = snapshot(current)
  const nextSnapshot = snapshot(next)
  if (currentSnapshot === nextSnapshot) return history

  const recordKey = options.coalesceKey ?? null
  if (recordKey && history.lastRecordKey === recordKey) {
    return {
      ...history,
      future: [],
      lastRecordKey: recordKey,
    }
  }

  const past = [...history.past, currentSnapshot]
  return {
    ...history,
    past: past.slice(-history.limit),
    future: [],
    lastRecordKey: recordKey,
  }
}

export const undoArticleDocumentHistory = (
  history: ArticleDocumentHistory,
  current: ArticleDocument,
): { history: ArticleDocumentHistory; document: ArticleDocument | null } => {
  const previousSnapshot = history.past.at(-1)
  if (!previousSnapshot) return { history, document: null }

  const previous = tryDeserializeArticleDocument(previousSnapshot)
  if (!previous) {
    return {
      history: {
        ...history,
        past: history.past.slice(0, -1),
        lastRecordKey: null,
      },
      document: null,
    }
  }

  return {
    history: {
      ...history,
      past: history.past.slice(0, -1),
      future: [...history.future, snapshot(current)],
      lastRecordKey: null,
    },
    document: previous,
  }
}

export const redoArticleDocumentHistory = (
  history: ArticleDocumentHistory,
  current: ArticleDocument,
): { history: ArticleDocumentHistory; document: ArticleDocument | null } => {
  const nextSnapshot = history.future.at(-1)
  if (!nextSnapshot) return { history, document: null }

  const next = tryDeserializeArticleDocument(nextSnapshot)
  if (!next) {
    return {
      history: {
        ...history,
        future: history.future.slice(0, -1),
        lastRecordKey: null,
      },
      document: null,
    }
  }

  return {
    history: {
      ...history,
      past: history.past.slice(0, -1),
      future: [...history.future, snapshot(current)],
      lastRecordKey: null,
    },
    document: next,
  }
}

export const redoArticleDocumentHistory = (
  history: ArticleDocumentHistory,
  current: ArticleDocument,
): { history: ArticleDocumentHistory; document: ArticleDocument | null } => {
  const nextSnapshot = history.future.at(-1)
  if (!nextSnapshot) return { history, document: null }

  const next = tryDeserializeArticleDocument(nextSnapshot)
  if (!next) {
    return {
      history: {
        ...history,
        future: history.future.slice(0, -1),
        lastRecordKey: null,
      },
      document: null,
    }
  }

  return {
    history: {
      ...history,
      past: [...history.past, snapshot(current)].slice(-history.limit),
      future: history.future.slice(0, -1),
      lastRecordKey: null,
    },
    document: next,
  }
}
