import AssetWorkspaceView from '@renderer/components/asset-workspace/AssetWorkspaceView'
import { useAssetWorkspace } from '@renderer/hooks/useAssetWorkspace'
import './AssetPage.css'

export default function AssetPage() {
  const workspace = useAssetWorkspace()
  return <AssetWorkspaceView workspace={workspace} />
}
