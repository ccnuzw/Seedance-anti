import { useEffect } from 'react'
import { Outlet, useBlocker } from 'react-router-dom'
import {
  confirmDocumentLeave,
  guardDocumentUnload,
  hasUnsavedDocuments
} from '@renderer/stores/documentDraftStore'

export default function DocumentNavigationGuard() {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search) &&
      hasUnsavedDocuments()
  )
  useEffect(() => {
    window.addEventListener('beforeunload', guardDocumentUnload)
    return () => window.removeEventListener('beforeunload', guardDocumentUnload)
  }, [])
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (confirmDocumentLeave()) blocker.proceed()
    else blocker.reset()
  }, [blocker])
  return <Outlet />
}
