import { AppRuntime } from '../app-runtime'
import { DictionaryController } from './dictionary'
import { DictionaryEntryController } from './dictionary-entry'
import { DictionaryViewController } from './dictionary-view'
import { CustomCssEditorController } from './custom-css-editor'
import { EmbedBrowserController } from './embed-browser'
import { OnlineDictionaryController } from './online-dictionary'
import { AiController } from './ai'
import { AppController } from './app'
import { QueryHistoryController } from './query-history'
import { SearchPopoverController } from './search-popover'
import { SelectionToolbarController } from './selection-toolbar'
import { WordCaptureController } from './word-capture'
import { WordLookupController } from './word-lookup'
import { WordbookController } from './wordbook'
import { WordbookTagController } from './wordbook-tag'
import { KeyboardController } from './keyboard'
import { BrowseWordsController } from './browse-words'
import { TouchBarController } from './touch-bar'

export const registerIPCHandlers = (appRuntime: AppRuntime): void => {
  const controllers = [
    new AiController(appRuntime),
    new AppController(appRuntime),
    new DictionaryEntryController(appRuntime),
    new DictionaryController(appRuntime),
    new CustomCssEditorController(appRuntime),
    new DictionaryViewController(appRuntime),
    new EmbedBrowserController(appRuntime),
    new OnlineDictionaryController(appRuntime),
    new QueryHistoryController(appRuntime),
    new KeyboardController(appRuntime),
    new SearchPopoverController(appRuntime),
    new SelectionToolbarController(appRuntime),
    new WordCaptureController(appRuntime),
    new WordLookupController(appRuntime),
    new WordbookController(appRuntime),
    new WordbookTagController(appRuntime),
    new BrowseWordsController(appRuntime),
    new TouchBarController(appRuntime)
  ]

  controllers.forEach((controller) => controller.mount())
}
