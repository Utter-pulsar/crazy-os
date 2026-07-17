// App-wide constants shared across main / preload / renderer.

/** Display name (window title, About panel, tray tooltip). */
export const APP_NAME = 'Crazy OS'

/** Author shown in the Version/About panel. */
export const APP_AUTHOR = 'Utter_pulsar'

/** GitHub repo backing auto-update (owner/repo). */
export const GITHUB_OWNER = 'Utter-pulsar'
export const GITHUB_REPO = 'crazy-os'

/**
 * userData folder name. Dev (`npm run dev`) appends "-dev" so hacking on the app
 * never reads or clobbers the real data of an installed copy on the same machine.
 */
export const USERDATA_DIR = 'crazy-os'
