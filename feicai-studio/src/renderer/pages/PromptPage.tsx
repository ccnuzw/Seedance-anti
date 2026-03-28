import PromptWorkspaceView from '@renderer/components/prompt-workspace/PromptWorkspaceView'
import { usePromptWorkspace } from '@renderer/hooks/usePromptWorkspace'
import './PromptPage.css'

interface PromptPageProps {
  embedded?: boolean
}

export default function PromptPage({ embedded = false }: PromptPageProps) {
  const workspace = usePromptWorkspace()
  return <PromptWorkspaceView embedded={embedded} workspace={workspace} />
}
