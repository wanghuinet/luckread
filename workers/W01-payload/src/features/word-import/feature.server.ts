import { createServerFeature } from '@payloadcms/richtext-lexical'

export const WordImportFeature = createServerFeature({
  feature: {
    ClientFeature: './feature.client#WordImportFeatureClient',
  },
  dependencies: ['upload'],
  key: 'luckreadWordImport',
})
