import appIconAssetUrl from './assets/icon.png'
import excalifontAssetUrl from './assets/fonts/Excalifont-Regular.woff2'
import xiaolaiAssetUrl from './assets/fonts/Xiaolai-Regular.ttf'
import xiaolaiMonoAssetUrl from './assets/fonts/XiaolaiMono-Regular.ttf'

export const appIconUrl = appIconAssetUrl

export function absoluteAssetUrl(assetUrl: string): string {
  return new URL(assetUrl, window.location.href).href
}

export const iframeFontUrls = {
  excalifont: absoluteAssetUrl(excalifontAssetUrl),
  xiaolai: absoluteAssetUrl(xiaolaiAssetUrl),
  xiaolaiMono: absoluteAssetUrl(xiaolaiMonoAssetUrl)
}
