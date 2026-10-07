'use client'

import { useMemo, useState } from 'react'
import type { ArticleEditorPlugin, ArticleEditorPluginContext, EditorMediaAsset } from './ArticleEditorPlugin.js'
import EditorPluginErrorBoundary from './EditorPluginErrorBoundary.js'
import {
  ARTICLE_MAX_BLOCKS,
  ARTICLE_CODE_LANGUAGES,
  ARTICLE_MAX_BLOCK_TEXT,
  ARTICLE_TABLE_MAX_COLUMNS,
  ARTICLE_TABLE_MAX_ROWS,