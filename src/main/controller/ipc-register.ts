import { AppRuntime } from '../app-runtime'
import { DictionaryController } from './dictionary'
import { DictionaryEntryController } from './dictionary-entry'
import { DictionaryViewController } from './dictionary-view'
import { CustomCssEditorController } from './custom-css-editor'
import { EmbedBrowserController } from './embed-browser'
import { NotificationController } from './notification'
import { OnlineDictionaryController } from './online-dictionary'
import { AiController } from './ai'
import { AppController } from './app'
import { QueryHistoryController } from './query-history'
import { SearchPopoverController } from './search-popover'
import { SelectionToolbarController } from './selection-toolbar'
import { TtsController } from './tts'
import { WordCaptureController } from './word-capture'
import { WordLookupController } from './word-lookup'
import { WordbookController } from './wordbook'
import { KeyboardController } from './keyboard'

export const registerIPCHandlers = (appRuntime: AppRuntime): void => {
  const controllers = [
    new AiController(appRuntime),
    new AppController(appRuntime),
    new DictionaryEntryController(appRuntime),
    new DictionaryController(appRuntime),
    new CustomCssEditorController(appRuntime),
    new DictionaryViewController(appRuntime),
    new EmbedBrowserController(appRuntime),
    new NotificationController(appRuntime),
    new OnlineDictionaryController(appRuntime),
    new QueryHistoryController(appRuntime),
    new KeyboardController(appRuntime),
    new SearchPopoverController(appRuntime),
    new SelectionToolbarController(appRuntime),
    new TtsController(appRuntime),
    new WordCaptureController(appRuntime),
    new WordLookupController(appRuntime),
    new WordbookController(appRuntime)
  ]

  controllers.forEach((controller) => controller.mount())
}
