export * from './index'

declare module './index' {
  interface MdxKeyScanner extends AsyncIterable<DictionaryEntry> {}
  interface MdxEntryScanner extends AsyncIterable<DictionaryRawEntry> {}
  interface MddKeyScanner extends AsyncIterable<DictionaryEntry> {}
  interface MddEntryScanner extends AsyncIterable<DictionaryRawEntry> {}
  interface MddListKeyScanner extends AsyncIterable<MddListDictionaryEntry> {}
  interface MddListEntryScanner extends AsyncIterable<DictionaryRawEntry> {}
}
