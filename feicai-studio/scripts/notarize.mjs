import { notarize } from '@electron/notarize'

export function resolveNotaryCredentials(env = process.env) {
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
    return {
      tool: 'notarytool',
      appleApiKey: env.APPLE_API_KEY,
      appleApiKeyId: env.APPLE_API_KEY_ID,
      appleApiIssuer: env.APPLE_API_ISSUER
    }
  }

  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return {
      tool: 'notarytool',
      appleId: env.APPLE_ID,
      appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: env.APPLE_TEAM_ID
    }
  }

  return null
}

export default async function notarizeApp(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.FEICAI_SKIP_NOTARIZE === '1') {
    console.log('[notarize] FEICAI_SKIP_NOTARIZE=1，跳过 notarization。')
    return
  }

  const credentials = resolveNotaryCredentials()
  if (!credentials) {
    console.log('[notarize] 未检测到 Apple notarization 凭证，跳过 notarization。')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = `${context.appOutDir}/${appName}.app`

  console.log(`[notarize] 开始公证 ${appPath}`)
  await notarize({
    appPath,
    ...credentials
  })
  console.log('[notarize] notarization 完成。')
}
