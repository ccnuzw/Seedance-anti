import DeliveryWorkspaceView from '@renderer/components/delivery-workspace/DeliveryWorkspaceView'
import { useDeliveryWorkspace } from '@renderer/hooks/useDeliveryWorkspace'
import './SectionPage.css'
import './DeliveryPage.css'

export default function DeliveryPage() {
  const workspace = useDeliveryWorkspace()
  return <DeliveryWorkspaceView workspace={workspace} />
}
